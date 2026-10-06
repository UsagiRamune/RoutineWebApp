// Google Calendar push notification (events.watch) เรียกเข้ามาที่นี่ตรงๆ — ไม่มี user session
// (browser ไม่ได้เป็นคนยิง Google เป็นคนยิง) auth เองด้วย X-Goog-Channel-Token เทียบกับ secret ที่ตั้งไว้
// ตอน register channel เท่านั้น ต้อง exempt path นี้ออกจาก middleware auth redirect เหมือน /api/cron
// (เช็คแล้วใน middleware.ts ยังมีอยู่จริง — ดูรายงาน)
//
// ทุก hit (ไม่ว่าผลจะเป็นยังไง) ต้องบันทึก last_webhook_at/state/result/error ไว้ที่แถว channel ที่
// X-Goog-Channel-ID ตรงกัน ให้ debug ได้ว่า Google ยิงมาจริงไหม/บ่อยแค่ไหน/ผลลัพธ์เป็นยังไง (เดิมไม่เก็บ
// เลยสักอย่าง เป็นสาเหตุหนึ่งที่ debug ปัญหา webhook ไม่เข้าไม่ได้)
import { createCronClient } from '@/lib/supabase/cron'
import { syncCalendarToCache } from '@/lib/google/calendar-sync'
import { WebhookResult } from '@/lib/supabase/types'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-goog-channel-token')
  const expected = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN
  const channelId = request.headers.get('x-goog-channel-id')
  const resourceState = request.headers.get('x-goog-resource-state')

  let supabase: ReturnType<typeof createCronClient>
  try {
    supabase = createCronClient()
  } catch (err) {
    console.error('[calendar webhook] service client error:', err)
    // ตอบ 200 ไปก่อน (ไม่ใช่ error ของฝั่ง Google) กัน Google คิดว่า endpoint พังแล้วเลิกส่งต่อ —
    // ปัญหาจริงจะโผล่ใน log ให้ตามแก้เอง ไม่ใช่สิ่งที่ Google ควร retry
    return NextResponse.json({ ok: false })
  }

  // บันทึกผลของ hit นี้ไว้ที่แถว channel ที่ channel_id ตรงกัน — หาไม่เจอก็แค่ log ไว้ ไม่ throw/บล็อก response
  async function recordWebhookHit(result: WebhookResult, error: string | null) {
    if (!channelId) {
      console.error('[calendar webhook] ไม่มี X-Goog-Channel-ID header ใน hit นี้ — บันทึกไม่ได้')
      return
    }
    const { data: row, error: findError } = await supabase.from('google_calendar_channels')
      .select('id').eq('channel_id', channelId).maybeSingle()
    if (findError) {
      console.error('[calendar webhook] lookup channel error:', findError.message)
      return
    }
    if (!row) {
      console.error('[calendar webhook] ไม่มีแถว channel ที่ channel_id ตรงกับ hit นี้:', channelId)
      return
    }
    const { error: updateError } = await supabase.from('google_calendar_channels').update({
      last_webhook_at: new Date().toISOString(),
      last_webhook_state: resourceState,
      last_webhook_result: result,
      last_webhook_error: error,
    }).eq('id', row.id)
    if (updateError) console.error('[calendar webhook] update channel error:', updateError.message)
  }

  if (!expected || token !== expected) {
    await recordWebhookHit('rejected_token', null)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Google ส่ง state "sync" เป็น handshake ตอนสร้าง channel ครั้งแรกเสมอ (ไม่มีข้อมูลจริงให้ sync) —
  // ค่าอื่นที่ Google Calendar ส่งจริงตอนมีการเปลี่ยนแปลงคือ "exists" (บางเคส "update") ยังไงก็ตาม
  // ขอแค่ไม่ใช่ "sync" ให้ถือว่าต้อง resync เสมอ กันเคสมีค่าอื่นเพิ่มมาในอนาคตที่เรายังไม่รู้จัก
  if (resourceState === 'sync') {
    await recordWebhookHit('ok', null)
    return NextResponse.json({ ok: true, skipped: 'sync handshake' })
  }

  const { data: conn } = await supabase.from('google_connections')
    .select('refresh_token').limit(1).maybeSingle()
  if (!conn?.refresh_token) {
    await recordWebhookHit('ok', 'no connection')
    return NextResponse.json({ ok: true, skipped: 'no connection' })
  }

  // ตอบเร็วตามที่ Google ต้องการ แต่ต้อง await sync ให้จบก่อน respond จริงๆ — serverless function
  // อาจถูก freeze ทันทีหลังส่ง response กลับ ถ้าไม่ await งาน sync อาจไม่ทันรันจบ
  try {
    const result = await syncCalendarToCache(supabase, request.nextUrl.origin, conn.refresh_token, 'webhook')
    if (!result.ok) {
      console.error('[calendar webhook] sync error:', result.error)
      await recordWebhookHit('error', result.error)
    } else {
      await recordWebhookHit('ok', null)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('[calendar webhook] unexpected error:', err)
    await recordWebhookHit('error', message)
  }

  return NextResponse.json({ ok: true })
}
