// Google Calendar push notification (events.watch) เรียกเข้ามาที่นี่ตรงๆ — ไม่มี user session
// (browser ไม่ได้เป็นคนยิง Google เป็นคนยิง) auth เองด้วย X-Goog-Channel-Token เทียบกับ secret ที่ตั้งไว้
// ตอน register channel เท่านั้น ต้อง exempt path นี้ออกจาก middleware auth redirect เหมือน /api/cron
import { createCronClient } from '@/lib/supabase/cron'
import { syncCalendarToCache } from '@/lib/google/calendar-sync'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-goog-channel-token')
  const expected = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Google ส่ง state "sync" เป็น handshake ตอนสร้าง channel ครั้งแรกเสมอ (ไม่มีข้อมูลจริงให้ sync) —
  // ค่าอื่นที่ Google Calendar ส่งจริงตอนมีการเปลี่ยนแปลงคือ "exists" (บางเคส "update") ยังไงก็ตาม
  // ขอแค่ไม่ใช่ "sync" ให้ถือว่าต้อง resync เสมอ กันเคสมีค่าอื่นเพิ่มมาในอนาคตที่เรายังไม่รู้จัก
  const resourceState = request.headers.get('x-goog-resource-state')
  if (resourceState === 'sync') {
    return NextResponse.json({ ok: true, skipped: 'sync handshake' })
  }

  let supabase: ReturnType<typeof createCronClient>
  try {
    supabase = createCronClient()
  } catch (err) {
    console.error('[calendar webhook] service client error:', err)
    // ตอบ 200 ไปก่อน (ไม่ใช่ error ของฝั่ง Google) กัน Google คิดว่า endpoint พังแล้วเลิกส่งต่อ —
    // ปัญหาจริงจะโผล่ใน log ให้ตามแก้เอง ไม่ใช่สิ่งที่ Google ควร retry
    return NextResponse.json({ ok: false })
  }

  const { data: conn } = await supabase.from('google_connections')
    .select('refresh_token').limit(1).maybeSingle()
  if (!conn?.refresh_token) {
    return NextResponse.json({ ok: true, skipped: 'no connection' })
  }

  // ตอบเร็วตามที่ Google ต้องการ แต่ต้อง await sync ให้จบก่อน respond จริงๆ — serverless function
  // อาจถูก freeze ทันทีหลังส่ง response กลับ ถ้าไม่ await งาน sync อาจไม่ทันรันจบ
  const result = await syncCalendarToCache(supabase, request.nextUrl.origin, conn.refresh_token)
  if (!result.ok) console.error('[calendar webhook] sync error:', result.error)

  return NextResponse.json({ ok: true })
}
