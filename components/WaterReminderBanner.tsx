'use client'

// การ์ดลอยเตือนดื่มน้ำ — ใช้ pacing ตาม hoursAwake (front-load + ramp เชิงเส้น) จาก lib/water.ts
// แสดงเฉพาะฝั่ง client (กัน hydration mismatch) เพราะขึ้นกับเวลาปัจจุบันจริง + localStorage
// (แยกอิสระจากอีเมลเตือนน้ำของ cron รายชั่วโมง — คนละระบบ ประเมิน pacing เดียวกันแยกกันคนละฝั่ง
// ไม่ได้ sync ให้ยิงพร้อมกันเป๊ะๆ)
import { useEffect, useState } from 'react'
import { GlassWater, X } from 'lucide-react'
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
  const [entered, setEntered] = useState(false) // slide/fade-in เข้าที่หลัง mount

  useEffect(() => {
    try {
      const suppressUntil = localStorage.getItem(SUPPRESS_KEY)
      setSuppressed(!!suppressUntil && Date.now() < Number(suppressUntil))
    } catch {
      setSuppressed(false) // localStorage ใช้ไม่ได้ในบางเบราว์เซอร์ — ข้ามไปแสดงตามปกติ
    }
  }, [])

  const shouldShow = pacing.deficitMl > 0 && pacing.sips > 0

  useEffect(() => {
    if (shouldShow && !suppressed && !dismissed) {
      const t = setTimeout(() => setEntered(true), 10)
      return () => clearTimeout(t)
    }
    setEntered(false)
  }, [shouldShow, suppressed, dismissed])

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(SUPPRESS_KEY, String(Date.now() + SUPPRESS_MINUTES * 60000))
    } catch { /* เขียนไม่ได้ก็ไม่เป็นไร แค่จะโผล่มาอีกครั้งเร็วขึ้น */ }
  }

  if (!shouldShow || suppressed || dismissed) return null

  // deficitMl = max(0, expected - actual) เฉพาะตอนไม่ pastWindow/allNighter (เงื่อนไข shouldShow ข้างบนกันไว้แล้ว)
  // → ย้อนเลข actual กลับจาก expected ตรงๆ ได้ ไม่ต้องเพิ่ม prop ใหม่
  const actualMl = pacing.expectedByNowMl - pacing.deficitMl

  return (
    <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-[360px]
      transition-all duration-300 ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
      <div className="relative bg-[#1B1F2A] border border-[#2A2F3D] rounded-2xl shadow-lg shadow-black/40 p-4">
        <button onClick={dismiss} aria-label="ปิด"
          className="absolute top-2.5 right-2.5 text-[#7C8394] p-1">
          <X size={14} />
        </button>

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#4FC1E0]/15 flex items-center justify-center flex-shrink-0">
            <GlassWater size={20} className="text-[#4FC1E0]" />
          </div>
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-sm font-semibold">ได้เวลาดื่มน้ำ</p>
            <p className="text-xs text-[#7C8394] mt-0.5">
              ตามเป้าต้องได้ {pacing.expectedByNowMl} ml แล้ว ตอนนี้ {actualMl} ml
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          {primaryContainer && (
            <button onClick={() => onLog(primaryContainer.ml, primaryContainer.name)}
              className="flex-1 py-2.5 rounded-lg bg-[#4FC1E0] text-[#14171F]
                text-sm font-semibold min-h-[40px]">
              + {primaryContainer.name} {primaryContainer.ml}
            </button>
          )}
          <button onClick={() => onLog(200, null)}
            className="px-3 py-2.5 rounded-lg border border-[#2A2F3D] text-[#EDEAE0]
              text-xs font-semibold min-h-[40px] flex-shrink-0">
            + จิบ 200
          </button>
        </div>
        <button onClick={dismiss}
          className="w-full text-center text-xs text-[#7C8394] mt-2 py-1">
          ไว้ก่อน
        </button>
      </div>
    </div>
  )
}
