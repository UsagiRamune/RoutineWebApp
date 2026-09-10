// ลงทะเบียน Google Calendar push notification channel (events.watch) สำหรับ "ปฏิทินหลัก" เท่านั้น
// (ตั้งใจไม่ทำทุกปฏิทิน — เซ็ตอัพนี้มีแค่ 2 ปฏิทิน ไม่คุ้มจะดูแล channel หลายอัน) เรียกจาก:
//   - app/api/calendar/callback/route.ts (ครั้งแรกที่เชื่อมสำเร็จ)
//   - app/api/cron/hourly/route.ts (renew ก่อน channel หมดอายุ — Google ไม่ renew ให้เองอัตโนมัติ)
import { randomUUID } from 'crypto'
import { calendarFor } from '@/lib/google/calendar'

export type RegisterChannelResult =
  | { ok: true; expiration: string }
  | { ok: false; reason: string }

export async function registerPrimaryCalendarChannel(
  supabase: any, origin: string, refreshToken: string
): Promise<RegisterChannelResult> {
  // Google บังคับ webhook address ต้องเป็น HTTPS public URL จริง — localhost/http ใช้ไม่ได้แน่นอน
  // (จะได้ error จาก Google ตรงๆ) ข้ามเงียบๆ ตอน dev แทนที่จะพังทุกครั้งที่รันโลคัล
  if (!origin.startsWith('https://')) {
    console.warn('[calendar-channel] ข้าม register: origin ไม่ใช่ https (dev/local) —', origin)
    return { ok: false, reason: 'non-https origin (dev/local)' }
  }
  const token = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN
  if (!token) {
    console.warn('[calendar-channel] ข้าม register: ยังไม่ได้ตั้ง GOOGLE_CALENDAR_WEBHOOK_TOKEN')
    return { ok: false, reason: 'GOOGLE_CALENDAR_WEBHOOK_TOKEN not set' }
  }

  const cal = calendarFor(origin, refreshToken)

  // มี channel เดิมอยู่ไหม — ถ้ามีลอง stop ก่อน (best-effort เฉยๆ ถ้าพังหรือหมดอายุไปแล้วก็ไม่เป็นไร)
  // กัน channel เก่าค้างอยู่ฝั่ง Google เรื่อยๆ ทุกครั้งที่ renew
  const { data: existing } = await supabase.from('google_calendar_channels')
    .select('channel_id, resource_id').eq('calendar_id', 'primary').maybeSingle()
  if (existing?.channel_id && existing?.resource_id) {
    await cal.channels.stop({
      requestBody: { id: existing.channel_id, resourceId: existing.resource_id },
    }).catch(() => {})
  }

  const channelId = randomUUID()
  // ขอ ~7 วัน — Google อาจให้สั้นกว่านี้ (คุมสูงสุดฝั่ง Google เอง ไม่ได้ผูกกับสิ่งที่เราขอเสมอไป)
  // ต้องอ่านค่า expiration จริงจาก response กลับมาเก็บ ห้ามสมมติว่าได้ตามที่ขอ
  const requestedExpirationMs = Date.now() + 7 * 24 * 3600 * 1000

  try {
    const res = await cal.events.watch({
      calendarId: 'primary',
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: `${origin}/api/calendar/webhook`,
        token,
        expiration: String(requestedExpirationMs),
      },
    })

    const resourceId = res.data.resourceId
    if (!resourceId) return { ok: false, reason: 'Google response missing resourceId' }

    const actualExpirationMs = res.data.expiration ? Number(res.data.expiration) : requestedExpirationMs
    console.log('[calendar-channel] registered — requested expiration ms:', requestedExpirationMs,
      'actual (from Google response):', res.data.expiration ?? '(ไม่ส่งมา ใช้ค่าที่ขอแทน)')

    const expirationIso = new Date(actualExpirationMs).toISOString()
    const { error } = await supabase.from('google_calendar_channels').upsert({
      calendar_id: 'primary',
      channel_id: res.data.id ?? channelId,
      resource_id: resourceId,
      expiration: expirationIso,
    }, { onConflict: 'calendar_id' })
    if (error) return { ok: false, reason: `db upsert error: ${error.message}` }

    return { ok: true, expiration: expirationIso }
  } catch (err) {
    console.error('[calendar-channel] register error:', err)
    return { ok: false, reason: err instanceof Error ? err.message : 'unknown error' }
  }
}
