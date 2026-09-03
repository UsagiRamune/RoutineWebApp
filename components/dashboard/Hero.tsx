'use client'

// hero การ์ดบนสุดของ dashboard: แคลอรี/โปรตีน/น้ำวันนี้เทียบเป้า + สถานะ IF + แบนเนอร์เตือนดื่มน้ำ
// + แถวสรุปย่อด้านล่าง: น้ำหนัก/ก้าว/น้ำ
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { IfSettings, NutritionPlan } from '@/lib/supabase/types'
import { ifStatus, fmtHM, weightDeltaColor } from '@/lib/nutrition'
import { GlassWater } from 'lucide-react'
import WaterReminderBanner from '@/components/WaterReminderBanner'

interface Props {
  today: string
  todayLabel: string
  caloriesEaten: number
  caloriesTarget: number | null
  proteinEaten: number
  proteinTarget: number | null
  glassesToday: number
  goalGlasses: number
  lastDrinkAt: string | null
  ifSettings: IfSettings | null
  latestWeight: number | null
  weightDelta7: number | null
  stepsToday: number | null
  plan: NutritionPlan
}

export default function Hero({
  today, todayLabel, caloriesEaten, caloriesTarget, proteinEaten, proteinTarget,
  glassesToday, goalGlasses, lastDrinkAt, ifSettings,
  latestWeight, weightDelta7, stepsToday, plan,
}: Props) {
  const supabase = createClient()

  const [glassDelta, setGlassDelta] = useState(0)
  const [localLastDrink, setLocalLastDrink] = useState(lastDrinkAt)
  const currentGlasses = glassesToday + glassDelta

  async function addGlass() {
    setGlassDelta(d => d + 1)
    setLocalLastDrink(new Date().toISOString())
    await supabase.from('water_entries').insert({ date: today })
  }

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ifSettings?.enabled) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ifSettings?.enabled])

  const status = ifSettings?.enabled ? ifStatus(ifSettings, new Date(now)) : null
  const ifChip = ifSettings?.enabled && status
    ? (status.eating ? `กินได้ถึง ${ifSettings.eat_end.slice(0, 5)}` : `fast อีก ${fmtHM(status.remainingSec)}`)
    : null

  const caloriesGap = caloriesTarget !== null ? caloriesTarget - caloriesEaten : null
  const caloriesPct = caloriesTarget ? Math.min(100, (caloriesEaten / caloriesTarget) * 100) : 0
  const overTarget = caloriesTarget !== null && caloriesEaten > caloriesTarget

  const proteinGap = proteinTarget !== null ? proteinTarget - proteinEaten : null
  const glassesLeft = Math.max(0, goalGlasses - currentGlasses)

  return (
    <>
      <WaterReminderBanner
        glassesToday={currentGlasses} goalGlasses={goalGlasses}
        lastDrinkAt={localLastDrink} onLog={addGlass} />

      {/* ครอบ max-w เองตรงนี้ เพื่อให้ banner ด้านบนยังเต็มความกว้างจอจริงๆ */}
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-5 mb-6">
          {/* row 1: วันที่ + สถานะ IF */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-[#7C8394]">{todayLabel}</p>
            {ifChip && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-[#14171F] border border-[#2A2F3D]
                text-[#4FC1E0] font-medium">
                {ifChip}
              </span>
            )}
          </div>

          {/* row 2: แคลอรี่ */}
          <p className="text-4xl font-semibold tabular-nums">
            {Math.round(caloriesEaten)}
            {caloriesTarget !== null && (
              <span className="text-lg text-[#7C8394] font-normal"> / {caloriesTarget} kcal</span>
            )}
          </p>
          <p className={`text-xs mt-1 ${overTarget ? 'text-[#F0A345]' : 'text-[#7C8394]'}`}>
            {caloriesTarget === null
              ? 'ยังไม่ตั้งเป้า — ไปตั้งที่หน้าโภชนาการ'
              : caloriesGap !== null && caloriesGap >= 0
                ? `ขาดอีก ${caloriesGap} kcal`
                : `เกิน ${Math.abs(caloriesGap ?? 0)} kcal`}
          </p>

          {caloriesTarget !== null && (
            <div className="h-2 bg-[#14171F] rounded-full overflow-hidden mt-2 mb-4">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${caloriesPct}%`, background: overTarget ? '#F0A345' : '#4FC1E0' }} />
            </div>
          )}
          {caloriesTarget === null && <div className="mb-4" />}

          {/* protein */}
          <p className="text-xs text-[#7C8394] mb-4">
            โปรตีน {Math.round(proteinEaten)}
            {proteinTarget !== null && `/${proteinTarget}`} ก.
            {proteinGap !== null && proteinGap > 0 && ` ขาด ${proteinGap} ก.`}
          </p>

          {/* row 3: สรุปย่อ น้ำหนัก/ก้าว/น้ำ */}
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[#2A2F3D]">
            <Link href="/health" className="text-center">
              <p className="text-sm font-semibold tabular-nums"
                style={{ color: weightDeltaColor(weightDelta7, plan) }}>
                {latestWeight != null ? latestWeight.toFixed(1) : '—'}
              </p>
              <p className="text-[10px] text-[#7C8394]">
                {latestWeight == null ? 'ยังไม่ได้ชั่ง' : (
                  <>
                    กก.
                    {weightDelta7 != null && weightDelta7 !== 0 && (
                      ` ${weightDelta7 > 0 ? '↑' : '↓'}${Math.abs(weightDelta7).toFixed(1)}`
                    )}
                  </>
                )}
              </p>
            </Link>
            <div className="text-center">
              <p className="text-sm font-semibold tabular-nums">{stepsToday ?? '—'}</p>
              <p className="text-[10px] text-[#7C8394]">ก้าว</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold tabular-nums">{currentGlasses}/{goalGlasses}</p>
              <p className="text-[10px] text-[#7C8394]">น้ำ (แก้ว)</p>
            </div>
          </div>

          <button onClick={addGlass}
            className="w-full mt-2 py-2 rounded-lg bg-[#14171F] border border-[#2A2F3D]
              text-xs font-semibold text-[#EDEAE0] flex items-center justify-center gap-1.5 min-h-[40px]">
            <GlassWater size={13} className="text-[#4FC1E0]" />
            +1 แก้ว{glassesLeft > 0 && ` (เหลือ ${glassesLeft})`}
          </button>
        </div>
      </div>
    </>
  )
}
