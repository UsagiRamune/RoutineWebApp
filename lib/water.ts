// คำนวณ pacing น้ำดื่มจาก hoursAwake — front-load ช่วง 3 ชม.แรกหลังตื่น แล้วไล่เชิงเส้นถึง window
export interface WaterPacingInput {
  hoursAwake: number
  actualTodayMl: number
  targetMl: number
  windowHours: number
  frontloadRatio: number
  mlPerSip: number
  asleep: boolean
}

export interface WaterPacingResult {
  expectedByNowMl: number
  deficitMl: number
  sips: number
  pastWindow: boolean
  allNighter: boolean
  message: string | null // ข้อความสถานะพิเศษ (ครบช่วง/ตื่นมานาน) — null ถ้าไม่มีอะไรพิเศษ
}

export function computeWaterPacing(input: WaterPacingInput): WaterPacingResult {
  const { hoursAwake, actualTodayMl, targetMl, windowHours, frontloadRatio, mlPerSip, asleep } = input

  if (asleep) {
    return { expectedByNowMl: 0, deficitMl: 0, sips: 0, pastWindow: false, allNighter: false, message: null }
  }

  const allNighter = hoursAwake > 20
  const pastWindow = hoursAwake > windowHours

  let expectedByNowMl: number
  if (hoursAwake >= windowHours) {
    expectedByNowMl = targetMl
  } else if (hoursAwake <= 3) {
    expectedByNowMl = targetMl * frontloadRatio * (hoursAwake / 3)
  } else {
    const frontloadAmount = targetMl * frontloadRatio
    const remainingRatio = 1 - frontloadRatio
    const remainingHours = Math.max(0.0001, windowHours - 3)
    const progress = Math.min(1, (hoursAwake - 3) / remainingHours)
    expectedByNowMl = frontloadAmount + targetMl * remainingRatio * progress
  }
  expectedByNowMl = Math.min(targetMl, Math.round(expectedByNowMl))

  // เกินช่วงดื่มน้ำของวัน หรือ ตื่นข้ามคืน (all-nighter) → หยุดเตือน ไม่มี deficit ให้ไล่ตาม
  const stopReminding = pastWindow || allNighter
  const deficitMl = stopReminding ? 0 : Math.max(0, expectedByNowMl - actualTodayMl)
  const sips = Math.round(deficitMl / mlPerSip)

  let message: string | null = null
  if (allNighter) message = `ตื่นมา ${Math.floor(hoursAwake)} ชม. แล้ว`
  else if (pastWindow) message = 'ครบช่วงดื่มน้ำของวันแล้ว'

  return { expectedByNowMl, deficitMl, sips, pastWindow, allNighter, message }
}

// แสดง "เหลืออีก ~N <ภาชนะ>" โดยเลือกภาชนะที่ใหญ่สุดที่ "พอดี" กับปริมาณที่เหลือ (ไม่ใหญ่เกินจนนับเป็น 0)
export function remainingInContainer(
  remainingMl: number, containers: { name: string; ml: number }[]
): string | null {
  if (remainingMl <= 0 || containers.length === 0) return null
  const sorted = [...containers].sort((a, b) => b.ml - a.ml)
  const fitting = sorted.find(c => c.ml <= remainingMl) ?? sorted[sorted.length - 1]
  const count = Math.max(1, Math.round(remainingMl / fitting.ml))
  return `เหลืออีก ~${count} ${fitting.name}`
}
