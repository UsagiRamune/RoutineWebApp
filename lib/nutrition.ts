// คำนวณสถานะ intermittent fasting ณ เวลาปัจจุบัน (ยึด wall clock ของ Asia/Bangkok เสมอ)
import { TZ } from './dates'
import { NutritionPlan } from './supabase/types'

interface IfWindow {
  enabled: boolean
  eat_start: string // 'HH:MM' หรือ 'HH:MM:SS'
  eat_end: string
}

export interface IfStatusResult {
  eating: boolean
  remainingSec: number
}

function toSec(t: string) {
  const [h, m, s] = t.split(':').map(Number)
  return h * 3600 + m * 60 + (s || 0)
}

export function ifStatus(settings: IfWindow, now: Date = new Date()): IfStatusResult | null {
  if (!settings.enabled) return null

  const clock = now.toLocaleString('en-US', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const nowSec = toSec(clock)
  const startSec = toSec(settings.eat_start)
  const endSec = toSec(settings.eat_end)
  const crossesMidnight = endSec <= startSec

  const eating = crossesMidnight
    ? nowSec >= startSec || nowSec < endSec
    : nowSec >= startSec && nowSec < endSec

  const remainingSec = eating
    ? (crossesMidnight && nowSec >= startSec ? (86400 - nowSec) + endSec : endSec - nowSec)
    : (nowSec < startSec ? startSec - nowSec : (86400 - nowSec) + startSec)

  return { eating, remainingSec }
}

export function fmtRemaining(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h} ชม. ${m} นาที`
}

// รูปแบบสั้น H:MM ไว้ใช้ในชิปเล็กๆ เช่น "fast อีก 4:44"
export function fmtHM(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

// หาน้ำหนักล่าสุดที่บันทึกไว้ ณ วันที่ระบุหรือก่อนหน้า — metrics ต้องเรียงตามวันที่ ascending มาก่อน
// (ไม่ใช่ทุกวันจะมีการชั่ง จึงต้องหาค่าล่าสุดที่มีจริงแทนการมองหาแค่วันนั้นตรงๆ)
export function weightAsOf(
  targetDate: string, metrics: { date: string; weight_kg: number | null }[]
): number | null {
  for (let i = metrics.length - 1; i >= 0; i--) {
    if (metrics[i].date <= targetDate && metrics[i].weight_kg != null) return metrics[i].weight_kg
  }
  return null
}

// สีบอกทิศทางน้ำหนักเทียบเป้า: cut ลงคือดี, bulk ขึ้นคือดี, normal ไม่ตัดสิน
export function weightDeltaColor(delta: number | null, plan: NutritionPlan): string {
  if (delta == null || plan === 'normal' || delta === 0) return '#7C8394'
  const good = plan === 'cut' ? delta < 0 : delta > 0
  return good ? '#4FC1E0' : '#F0A345'
}
