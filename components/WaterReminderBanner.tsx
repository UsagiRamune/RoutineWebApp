'use client'

// แบนเนอร์เตือนดื่มน้ำ — ใช้ pacing ตาม hoursAwake (front-load + ramp เชิงเส้น) จาก lib/water.ts
// แสดงเฉพาะฝั่ง client (กัน hydration mismatch) เพราะขึ้นกับเวลาปัจจุบันจริง + localStorage
import { useEffect, useState } from 'react'
import { GlassWater } from 'lucide-react'
import { WaterPacingResult } from '@/lib/water'
import { WaterContainer } from '@/lib/supabase/types'

interface Props {
  pacing: WaterPacingResult
  primaryContainer: WaterContainer | null
  onLog: (ml: number, container: string | null) => void
}

const SUPPRESS_KEY = 'water-reminder-suppress-until'
const SUPPRESS_MINUTES = 60

export default function WaterReminderBanner({ pacing, primaryContainer, onLog }: Props) {
  const [suppressed, setSuppressed] = useState(true) // เริ่ม true กัน flash ก่อนเช็ค localStorage เสร็จ (กัน hydration mismatch)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      const suppressUntil = localStorage.getItem(SUPPRESS_KEY)
      setSuppressed(!!suppressUntil && Date.now() < Number(suppressUntil))
    } catch {
      setSuppressed(false) // localStorage ใช้ไม่ได้ในบางเบราว์เซอร์ — ข้ามไปแสดงตามปกติ
    }
  }, [])

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(SUPPRESS_KEY, String(Date.now() + SUPPRESS_MINUTES * 60000))
    } catch { /* เขียนไม่ได้ก็ไม่เป็นไร แค่จะโผล่มาอีกครั้งเร็วขึ้น */ }
  }

  const shouldShow = pacing.deficitMl > 0 && pacing.sips > 0
  if (!shouldShow || suppressed || dismissed) return null

  return (
    <div className="w-full bg-[#1B1F2A] border-b-2 border-[#4FC1E0]">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
        <GlassWater size={22} className="text-[#4FC1E0] flex-shrink-0" />
        <p className="text-sm flex-1 min-w-0">
          ตามหลังเป้า {pacing.deficitMl} ml — จิบสัก {pacing.sips} อึกในชั่วโมงนี้
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          {primaryContainer && (
            <button onClick={() => onLog(primaryContainer.ml, primaryContainer.name)}
              className="px-4 py-2.5 rounded-lg bg-[#4FC1E0] text-[#14171F]
                text-sm font-semibold min-h-[40px]">
              {primaryContainer.name} +{primaryContainer.ml}
            </button>
          )}
          <button onClick={() => onLog(200, null)}
            className="px-3 py-2.5 rounded-lg border border-[#2A2F3D] text-[#EDEAE0]
              text-xs font-semibold min-h-[40px]">
            + จิบ 200
          </button>
          <button onClick={dismiss}
            className="text-xs text-[#7C8394] px-2 py-2.5">
            ไว้ก่อน
          </button>
        </div>
      </div>
    </div>
  )
}
