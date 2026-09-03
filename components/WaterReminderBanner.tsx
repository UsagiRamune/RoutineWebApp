'use client'

// แบนเนอร์เตือนดื่มน้ำ — คำนวณจาก pace ที่ควรจะเป็นในช่วงเวลาตื่น (08:00–24:00 Asia/Bangkok)
// เทียบกับแก้วที่ดื่มจริงวันนี้ + เวลาที่ดื่มแก้วล่าสุด แสดงเฉพาะฝั่ง client (กัน hydration mismatch)
import { useEffect, useState } from 'react'
import { GlassWater } from 'lucide-react'
import { TZ } from '@/lib/dates'

interface Props {
  glassesToday: number
  goalGlasses: number
  lastDrinkAt: string | null
  onLog: () => void
}

const SUPPRESS_KEY = 'water-reminder-suppress-until'
const SUPPRESS_MINUTES = 60
const WAKE_HOUR = 8
const SLEEP_HOUR = 24

function bangkokClockParts(now: Date) {
  const s = now.toLocaleString('en-US', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit',
  })
  const [h, m] = s.split(':').map(Number)
  return { h, m }
}

export default function WaterReminderBanner({ glassesToday, goalGlasses, lastDrinkAt, onLog }: Props) {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      const suppressUntil = localStorage.getItem(SUPPRESS_KEY)
      if (suppressUntil && Date.now() < Number(suppressUntil)) { setVisible(false); return }
    } catch { /* localStorage อาจใช้ไม่ได้ในบางเบราว์เซอร์ — ข้ามไปแสดงตามปกติ */ }

    const now = new Date()
    const { h, m } = bangkokClockParts(now)
    if (h < WAKE_HOUR || h >= SLEEP_HOUR) { setVisible(false); return }

    const minutesSinceWake = (h - WAKE_HOUR) * 60 + m
    const windowMinutes = (SLEEP_HOUR - WAKE_HOUR) * 60
    const expected = Math.floor(goalGlasses * minutesSinceWake / windowMinutes)

    const lastDrinkMinutesAgo = lastDrinkAt
      ? (now.getTime() - new Date(lastDrinkAt).getTime()) / 60000
      : Infinity

    setVisible(glassesToday < expected && lastDrinkMinutesAgo > 90)
  }, [glassesToday, goalGlasses, lastDrinkAt])

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(SUPPRESS_KEY, String(Date.now() + SUPPRESS_MINUTES * 60000))
    } catch { /* เขียนไม่ได้ก็ไม่เป็นไร แค่จะโผล่มาอีกครั้งเร็วขึ้น */ }
  }

  if (!visible || dismissed) return null

  const now = new Date()
  const { h, m } = bangkokClockParts(now)
  const minutesSinceWake = (h - WAKE_HOUR) * 60 + m
  const windowMinutes = (SLEEP_HOUR - WAKE_HOUR) * 60
  const expected = Math.floor(goalGlasses * minutesSinceWake / windowMinutes)

  return (
    <div className="w-full bg-[#1B1F2A] border-b-2 border-[#4FC1E0]">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        <GlassWater size={22} className="text-[#4FC1E0] flex-shrink-0" />
        <p className="text-sm flex-1 min-w-0">
          ได้เวลาดื่มน้ำ — ตามเป้าต้องได้ {expected} แก้วแล้ว ตอนนี้ {glassesToday}
        </p>
        <button onClick={onLog}
          className="px-4 py-2.5 rounded-lg bg-[#4FC1E0] text-[#14171F]
            text-sm font-semibold flex-shrink-0">
          ดื่มแล้ว +1
        </button>
        <button onClick={dismiss}
          className="text-xs text-[#7C8394] flex-shrink-0 px-2 py-2.5">
          ไว้ก่อน
        </button>
      </div>
    </div>
  )
}
