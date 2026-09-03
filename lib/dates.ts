// วันที่ฝั่ง server ต้อง pin Asia/Bangkok เสมอ — server รันที่ UTC (Vercel) แต่ผู้ใช้อยู่ UTC+7
// และ "วันที่" ของแอปนี้ไม่ได้ตัดตอนเที่ยงคืน — ใช้ app_settings.day_rollover_hour แทน
// (ค่าเริ่มต้น 4: กิจกรรมก่อนตี 4 ถือเป็นของ "เมื่อวาน" กันเผลอนอนดึกแล้วข้อมูลกระโดดวันแรงเกิน)
export const TZ = 'Asia/Bangkok'
export const DEFAULT_ROLLOVER_HOUR = 4

function keyForMs(ms: number, rolloverHour: number): string {
  return new Date(ms - rolloverHour * 3600000).toLocaleDateString('sv-SE', { timeZone: TZ })
}

// sync ทั้งคู่ — ใช้ default rollover (4) ได้เลยถ้าไม่ได้ query app_settings มา
// เรียกจาก client component ได้ตรงๆ ปลอดภัย (ไม่แตะ DB) — เผื่อไม่ได้ custom rollover ก็ยังถูกต้อง
// ในเคสส่วนใหญ่ (ค่า default ตรงกับที่ตั้งไว้ใน DB อยู่แล้ว)
export function todayKey(rolloverHour: number = DEFAULT_ROLLOVER_HOUR): string {
  return keyForMs(Date.now(), rolloverHour)
}

export function dateKeyOffset(offsetDays: number, rolloverHour: number = DEFAULT_ROLLOVER_HOUR): string {
  return keyForMs(Date.now() + offsetDays * 86400000, rolloverHour)
}

// หา date key ของ timestamp ใดๆ (ไม่ใช่แค่ "ตอนนี้") ตาม rollover — ใช้ตอนต้องรู้ว่า
// เหตุการณ์ที่เกิดเวลาหนึ่งๆ (เช่น เข้านอนตอนตี 1) นับเป็นข้อมูลของวันไหน
export function dateKeyForTimestamp(ts: string | Date, rolloverHour: number = DEFAULT_ROLLOVER_HOUR): string {
  const ms = typeof ts === 'string' ? new Date(ts).getTime() : ts.getTime()
  return keyForMs(ms, rolloverHour)
}

// duck-typed ให้ทำงานได้ทั้ง server client (@/lib/supabase/server) และ browser client
// (@/lib/supabase/client) โดยไม่ต้อง import ทั้งสองแบบเข้ามาในไฟล์นี้ (กันปัญหา next/headers
// หลุดเข้า client bundle เพราะไฟล์นี้ถูก client component import อยู่แล้ว)
export interface SupabaseLike {
  from: (table: string) => any
}

// async — server component เรียกแล้วส่ง supabase client เข้ามา จะ query app_settings.day_rollover_hour
// จริง ถ้าอ่านไม่ได้ (error/ยังไม่มีแถว) fallback เป็น DEFAULT_ROLLOVER_HOUR เงียบๆ ไม่ throw
export async function getRolloverHour(supabase: SupabaseLike): Promise<number> {
  try {
    const { data } = await supabase.from('app_settings')
      .select('day_rollover_hour').eq('id', 1).maybeSingle()
    return data?.day_rollover_hour ?? DEFAULT_ROLLOVER_HOUR
  } catch {
    return DEFAULT_ROLLOVER_HOUR
  }
}

// timestamp ที่ "วันนี้" (ตาม rollover) เริ่มต้นจริงๆ — ใช้เทียบขอบเขต query ช่วงเวลาของวัน
// (เช่น "ส่งอีเมลไปกี่ครั้งแล้วตั้งแต่ต้นวัน") ต้องใช้ instant จริง ไม่ใช่แค่ date string
export function rolloverBoundaryIso(dateKey: string, rolloverHour: number = DEFAULT_ROLLOVER_HOUR): string {
  return new Date(`${dateKey}T${String(rolloverHour).padStart(2, '0')}:00:00+07:00`).toISOString()
}

// hour/minute/weekday ปัจจุบันตาม Asia/Bangkok wall clock — ใช้ในโค้ดฝั่ง server (cron) ที่รันบน UTC
// weekday: 0=อาทิตย์ (ตรงกับ convention ของ routines.remind_days ในแอปนี้)
export function bangkokNow(d: Date = new Date()): { hour: number; minute: number; weekday: number; dateKey: string } {
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const weekdayStr = d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' })
  const weekday = WEEKDAYS.indexOf(weekdayStr)
  const timeStr = d.toLocaleTimeString('en-US', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit',
  })
  const [hour, minute] = timeStr.split(':').map(Number)
  return { hour: hour === 24 ? 0 : hour, minute, weekday, dateKey: d.toLocaleDateString('sv-SE', { timeZone: TZ }) }
}
