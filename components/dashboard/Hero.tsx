'use client'

// hero การ์ดบนสุดของ dashboard: แคลอรี/โปรตีนวันนี้เทียบเป้า + สถานะ IF + ปุ่มหลับ-ตื่น
// + แบนเนอร์เตือนดื่มน้ำ (pacing ตาม hoursAwake) + แถวสรุปย่อ น้ำหนัก/ก้าว/น้ำ
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { IfSettings, NutritionPlan, WaterContainer } from '@/lib/supabase/types'
import { ifStatus, fmtHM, weightDeltaColor } from '@/lib/nutrition'
import { computeWaterPacing } from '@/lib/water'
import {
  getCurrentState, shouldPromptWake, getWaterScheduleAnchor,
  pressSleep, pressWake, confirmInferredWake, editEventTime, SleepState,
} from '@/lib/sleep'
import { TZ } from '@/lib/dates'
import { GlassWater } from 'lucide-react'
import WaterReminderBanner from '@/components/WaterReminderBanner'

interface Props {
  today: string
  todayLabel: string
  caloriesEaten: number
  caloriesTarget: number | null
  proteinEaten: number
  proteinTarget: number | null
  waterMlToday: number
  waterTargetMl: number
  mlPerSip: number
  windowHours: number
  frontloadRatio: number
  assumedSleepHours: number
  containers: WaterContainer[]
  ifSettings: IfSettings | null
  latestWeight: number | null
  weightDelta7: number | null
  stepsToday: number | null
  plan: NutritionPlan
}

function fmtHHMM(d: Date) {
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
}

// value ให้ input type="datetime-local" (ต้องเป็นเวลา local ของ browser ไม่ใช่ ISO UTC)
function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Hero({
  today, todayLabel, caloriesEaten, caloriesTarget, proteinEaten, proteinTarget,
  waterMlToday, waterTargetMl, mlPerSip, windowHours, frontloadRatio, assumedSleepHours,
  containers, ifSettings,
  latestWeight, weightDelta7, stepsToday, plan,
}: Props) {
  const supabase = createClient()

  // ---------- นาฬิกาเดิน (ใช้ร่วมกันทั้ง IF / หลับ-ตื่น / pacing น้ำ) ----------
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const status = ifSettings?.enabled ? ifStatus(ifSettings, new Date(nowTick)) : null
  const ifChip = ifSettings?.enabled && status
    ? (status.eating ? `กินได้ถึง ${ifSettings.eat_end.slice(0, 5)}` : `fast อีก ${fmtHM(status.remainingSec)}`)
    : null

  // ---------- หลับ-ตื่น ----------
  const [sleepState, setSleepState] = useState<SleepState | null>(null)
  const [wakePrompt, setWakePrompt] = useState<{ show: boolean; sessionId: string | null }>({ show: false, sessionId: null })
  const [waterAnchor, setWaterAnchor] = useState<Date | null>(null)
  const [sleepBusy, setSleepBusy] = useState(false)
  const [editingTime, setEditingTime] = useState(false)
  const [timeInput, setTimeInput] = useState('')

  async function refreshSleep() {
    const [state, prompt, anchor] = await Promise.all([
      getCurrentState(), shouldPromptWake(), getWaterScheduleAnchor(),
    ])
    setSleepState(state)
    setWakePrompt(prompt)
    setWaterAnchor(anchor)
  }

  useEffect(() => { refreshSleep() }, [])

  async function handleSleepToggle() {
    if (!sleepState || sleepBusy) return
    setSleepBusy(true)
    if (sleepState.state === 'awake') await pressSleep()
    else await pressWake()
    await refreshSleep()
    setSleepBusy(false)
  }

  async function handleWakeConfirm(confirmed: boolean) {
    if (confirmed && wakePrompt.sessionId) {
      await confirmInferredWake(wakePrompt.sessionId)
    }
    setWakePrompt({ show: false, sessionId: null })
    await refreshSleep()
  }

  function openEditTime() {
    if (!sleepState) return
    setTimeInput(toDatetimeLocalValue(sleepState.since))
    setEditingTime(true)
  }

  async function saveEditTime() {
    if (!sleepState?.sessionId || !timeInput) return
    const iso = new Date(timeInput).toISOString()
    const field = sleepState.state === 'asleep' ? 'sleep_at' : 'wake_at'
    await editEventTime(sleepState.sessionId, field, iso)
    setEditingTime(false)
    await refreshSleep()
  }

  const asleep = sleepState?.state === 'asleep'
  const hoursAsleep = asleep && sleepState ? (nowTick - sleepState.since.getTime()) / 3600000 : 0
  const wakeEstimate = asleep && sleepState
    ? new Date(sleepState.since.getTime() + assumedSleepHours * 3600000) : null
  const hoursAwake = waterAnchor ? Math.max(0, (nowTick - waterAnchor.getTime()) / 3600000) : 0

  // ---------- น้ำ (ml) ----------
  const [waterMlDelta, setWaterMlDelta] = useState(0)
  const currentMl = waterMlToday + waterMlDelta

  async function logWater(ml: number, container: string | null) {
    setWaterMlDelta(d => d + ml)
    await supabase.from('water_entries').insert({ date: today, ml, container })
  }

  const pacing = computeWaterPacing({
    hoursAwake, actualTodayMl: currentMl, targetMl: waterTargetMl,
    windowHours, frontloadRatio, mlPerSip, asleep,
  })
  const primaryContainer = containers.length > 0
    ? [...containers].sort((a, b) => b.ml - a.ml)[0] : null

  // ---------- แคลอรี่/โปรตีน ----------
  const caloriesGap = caloriesTarget !== null ? caloriesTarget - caloriesEaten : null
  const caloriesPct = caloriesTarget ? Math.min(100, (caloriesEaten / caloriesTarget) * 100) : 0
  const overTarget = caloriesTarget !== null && caloriesEaten > caloriesTarget
  const proteinGap = proteinTarget !== null ? proteinTarget - proteinEaten : null

  return (
    <>
      {wakePrompt.show && (
        <div className="w-full bg-[#1B1F2A] border-b-2 border-[#F0A345]">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
            <p className="text-sm flex-1 min-w-0">ตื่นแล้วใช่ไหม?</p>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => handleWakeConfirm(true)}
                className="px-4 py-2.5 rounded-lg bg-[#F0A345] text-[#14171F] text-sm font-semibold min-h-[40px]">
                ตื่นแล้ว
              </button>
              <button onClick={() => handleWakeConfirm(false)}
                className="px-4 py-2.5 rounded-lg border border-[#2A2F3D] text-xs text-[#7C8394] min-h-[40px]">
                ยังไม่ตื่น
              </button>
            </div>
          </div>
        </div>
      )}

      <WaterReminderBanner pacing={pacing} primaryContainer={primaryContainer}
        onLog={logWater} />

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

          {/* ปุ่มหลับ-ตื่น */}
          <div className="pt-3 border-t border-[#2A2F3D]">
            <div className="flex items-center gap-2">
              <button onClick={handleSleepToggle} disabled={!sleepState || sleepBusy}
                className="flex-1 py-2.5 rounded-lg bg-[#14171F] border border-[#2A2F3D]
                  text-sm font-semibold disabled:opacity-50 min-h-[40px]">
                {asleep ? '☀️ ตื่นแล้ว' : '😴 เข้านอน'}
              </button>
              <button onClick={openEditTime} disabled={!sleepState}
                className="text-xs text-[#7C8394] px-2 disabled:opacity-50">
                แก้เวลา
              </button>
            </div>

            {asleep && (
              <p className="text-xs text-[#7C8394] mt-2">
                หลับมา {hoursAsleep.toFixed(1)} ชม.
                {wakeEstimate && ` · น่าจะตื่นราว ${fmtHHMM(wakeEstimate)}`}
              </p>
            )}

            {editingTime && (
              <div className="flex items-center gap-2 mt-2">
                <input type="datetime-local" value={timeInput}
                  onChange={e => setTimeInput(e.target.value)}
                  className="flex-1 min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                    px-2 py-1.5 text-xs outline-none focus:border-[#7C8394]" />
                <button onClick={saveEditTime}
                  className="px-3 py-1.5 rounded-lg bg-[#EDEAE0] text-[#14171F] text-xs font-semibold">
                  บันทึก
                </button>
                <button onClick={() => setEditingTime(false)}
                  className="text-xs text-[#7C8394]">ยกเลิก</button>
              </div>
            )}
          </div>

          {/* row 3: สรุปย่อ น้ำหนัก/ก้าว/น้ำ */}
          <div className="grid grid-cols-3 gap-2 pt-3 mt-3 border-t border-[#2A2F3D]">
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
              <p className="text-sm font-semibold tabular-nums">
                {(currentMl / 1000).toFixed(1)}/{(waterTargetMl / 1000).toFixed(1)}
              </p>
              <p className="text-[10px] text-[#7C8394]">น้ำ (ล.)</p>
            </div>
          </div>

          <button onClick={() => logWater(mlPerSip, null)}
            className="w-full mt-2 py-2 rounded-lg bg-[#14171F] border border-[#2A2F3D]
              text-xs font-semibold text-[#EDEAE0] flex items-center justify-center gap-1.5 min-h-[40px]">
            <GlassWater size={13} className="text-[#4FC1E0]" />
            + จิบ {mlPerSip} ml
          </button>
        </div>
      </div>
    </>
  )
}
