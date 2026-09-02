// วันที่ฝั่ง server ต้อง pin Asia/Bangkok เสมอ — server รันที่ UTC (Vercel) แต่ผู้ใช้อยู่ UTC+7
export const TZ = 'Asia/Bangkok'

export function todayKey(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ })
}

export function dateKeyOffset(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('sv-SE', { timeZone: TZ })
}
