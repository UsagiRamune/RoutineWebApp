'use client'

// UI หน้าร่างกาย: ชั่งวันนี้ + BMI, แนวโน้มน้ำหนัก 30 วัน, กิจกรรม (ก้าว/แคล manual), เวย์/อาหารเสริม
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  BodyMetric, HealthDaily, Supplement, SupplementLog, SupplementSlot, NutritionPlan,
} from '@/lib/supabase/types'
import { todayKey, dateKeyOffset, TZ } from '@/lib/dates'
import { weightAsOf, weightDeltaColor } from '@/lib/nutrition'
import { Scale, Ruler, Footprints, Flame, Pill, Plus, X } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar,
} from 'recharts'

interface Props {
  today: string
  metrics: BodyMetric[] // 40 วันล่าสุด เรียง ascending
  health: HealthDaily[] // 14 วันล่าสุด เรียง ascending
  latestHeight: number | null
  supplements: Supplement[]
  supplementLogs: SupplementLog[]
  plan: NutritionPlan
}

const inputCls = 'bg-[#14171F] border border-[#2A2F3D] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#7C8394] min-h-[40px]'

const SLOT_ORDER: SupplementSlot[] = ['wake', 'sleep', 'workout', 'anytime']
const SLOT_LABELS: Record<SupplementSlot, string> = {
  wake: 'ตอนตื่น', sleep: 'ก่อนนอน', workout: 'หลังออกกำลัง', anytime: 'เมื่อไหร่ก็ได้',
}

function fmtHHMM(iso: string) {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
}

function bmiBand(bmi: number): string {
  if (bmi < 18.5) return 'น้ำหนักน้อย'
  if (bmi < 23) return 'ปกติ'
  if (bmi < 25) return 'ท้วม'
  if (bmi < 30) return 'อ้วนระดับ 1'
  return 'อ้วนระดับ 2'
}

export default function BodyView({
  today, metrics, health, latestHeight, supplements, supplementLogs, plan,
}: Props) {
  const supabase = createClient()
  const router = useRouter()
  const yesterday = dateKeyOffset(-1)

  const todayMetric = metrics.find(m => m.date === today)
  const todayHealth = health.find(h => h.date === today)
  const yesterdayHealth = health.find(h => h.date === yesterday)

  // ---------- ก) ชั่งวันนี้ ----------

  const [localMetric, setLocalMetric] = useState({
    weight: todayMetric?.weight_kg ?? null,
    height: todayMetric?.height_cm ?? latestHeight,
  })
  useEffect(() => {
    setLocalMetric({
      weight: todayMetric?.weight_kg ?? null,
      height: todayMetric?.height_cm ?? latestHeight,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayMetric?.weight_kg, todayMetric?.height_cm, latestHeight])

  const [metricSavedFlash, setMetricSavedFlash] = useState(false)
  function flashMetricSaved() {
    setMetricSavedFlash(true)
    setTimeout(() => setMetricSavedFlash(false), 1500)
  }

  async function saveMetricField(field: 'weight' | 'height', raw: string) {
    const num = raw.trim() === '' ? null : parseFloat(raw)
    const next = { ...localMetric, [field]: (num != null && !isNaN(num)) ? num : null }
    setLocalMetric(next)
    await supabase.from('body_metrics').upsert({
      date: today, weight_kg: next.weight, height_cm: next.height,
    }, { onConflict: 'date' })
    flashMetricSaved()
  }

  const bmi = (localMetric.weight != null && localMetric.height != null && localMetric.height > 0)
    ? localMetric.weight / ((localMetric.height / 100) ** 2)
    : null

  // ---------- ข) แนวโน้ม ----------

  const days30 = Array.from({ length: 30 }, (_, i) => dateKeyOffset(-(29 - i)))
  const trendData = days30.map(d => ({
    key: d,
    label: new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: TZ }),
    weight: metrics.find(m => m.date === d)?.weight_kg ?? null,
  }))
  const weighInCount = metrics.filter(m => m.weight_kg != null).length

  const latestW = weightAsOf(today, metrics)
  const w7 = weightAsOf(dateKeyOffset(-7), metrics)
  const w30 = weightAsOf(dateKeyOffset(-30), metrics)
  const delta7 = (latestW != null && w7 != null) ? latestW - w7 : null
  const delta30 = (latestW != null && w30 != null) ? latestW - w30 : null

  // ---------- ค) กิจกรรมวันนี้ ----------

  const [localHealth, setLocalHealth] = useState({
    steps: todayHealth?.steps ?? null,
    calories_burned: todayHealth?.calories_burned ?? null,
    resting_hr: todayHealth?.resting_hr ?? null,
    sleep_minutes: todayHealth?.sleep_minutes ?? null,
  })
  useEffect(() => {
    setLocalHealth({
      steps: todayHealth?.steps ?? null,
      calories_burned: todayHealth?.calories_burned ?? null,
      resting_hr: todayHealth?.resting_hr ?? null,
      sleep_minutes: todayHealth?.sleep_minutes ?? null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayHealth?.steps, todayHealth?.calories_burned, todayHealth?.resting_hr, todayHealth?.sleep_minutes])

  const [showMore, setShowMore] = useState(false)
  const [healthSavedFlash, setHealthSavedFlash] = useState(false)
  function flashHealthSaved() {
    setHealthSavedFlash(true)
    setTimeout(() => setHealthSavedFlash(false), 1500)
  }

  async function saveHealthField(field: keyof typeof localHealth, raw: string) {
    const value = raw.trim() === '' ? null : Math.max(0, parseInt(raw) || 0)
    const next = { ...localHealth, [field]: value }
    setLocalHealth(next)
    await supabase.from('health_daily').upsert({
      date: today, ...next, source: 'manual',
    }, { onConflict: 'date' })
    flashHealthSaved()
  }

  async function saveDaySteps(date: string, raw: string) {
    const value = raw.trim() === '' ? null : Math.max(0, parseInt(raw) || 0)
    const existing = health.find(h => h.date === date)
    await supabase.from('health_daily').upsert({
      date,
      steps: value,
      calories_burned: existing?.calories_burned ?? null,
      resting_hr: existing?.resting_hr ?? null,
      sleep_minutes: existing?.sleep_minutes ?? null,
      source: 'manual',
    }, { onConflict: 'date' })
    router.refresh()
  }

  const days14 = Array.from({ length: 14 }, (_, i) => dateKeyOffset(-(13 - i)))
  const stepsChartData = days14.map(key => ({
    key,
    label: new Date(key).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: TZ }),
    steps: health.find(h => h.date === key)?.steps ?? 0,
  }))
  const hasHealthData = health.length > 0

  // ---------- ง) เวย์โปรตีน / อาหารเสริม ----------

  const [optimisticSupp, setOptimisticSupp] = useState<Record<string, boolean>>({})
  const [optimisticTakenAt, setOptimisticTakenAt] = useState<Record<string, string>>({})
  const takenIds = new Set(supplementLogs.map(l => l.supplement_id))

  function isTaken(id: string) {
    return optimisticSupp[id] ?? takenIds.has(id)
  }
  function takenAtFor(id: string): string | null {
    if (id in optimisticSupp) return optimisticSupp[id] ? (optimisticTakenAt[id] ?? null) : null
    return supplementLogs.find(l => l.supplement_id === id)?.taken_at ?? null
  }
  async function toggleSupplement(id: string) {
    const taken = isTaken(id)
    setOptimisticSupp(p => ({ ...p, [id]: !taken }))
    if (!taken) setOptimisticTakenAt(p => ({ ...p, [id]: new Date().toISOString() }))
    if (taken) {
      await supabase.from('supplement_logs').delete().eq('supplement_id', id).eq('date', today)
    } else {
      await supabase.from('supplement_logs').insert({ supplement_id: id, date: today })
    }
  }

  const [manageOpen, setManageOpen] = useState(false)
  const [newSupp, setNewSupp] = useState({ name: '', dose: '', slot: 'anytime' as SupplementSlot })

  async function addSupplement() {
    if (!newSupp.name.trim()) return
    await supabase.from('supplements').insert({
      name: newSupp.name.trim(), dose: newSupp.dose.trim() || null,
      slot: newSupp.slot, sort_order: supplements.length + 1,
    })
    setNewSupp({ name: '', dose: '', slot: 'anytime' })
  }
  async function editSupplement(id: string, field: 'name' | 'dose', value: string) {
    await supabase.from('supplements').update({ [field]: value || null }).eq('id', id)
  }
  async function setSupplementSlot(id: string, slot: SupplementSlot) {
    await supabase.from('supplements').update({ slot }).eq('id', id)
  }
  async function removeSupplement(id: string) {
    await supabase.from('supplements').update({ is_active: false }).eq('id', id)
  }

  const supplementsBySlot = SLOT_ORDER.map(slot => ({
    slot, items: supplements.filter(s => s.slot === slot),
  })).filter(g => g.items.length > 0 || g.slot === 'anytime')

  // ---------- render ----------

  return (
    <main className="min-h-screen bg-[#14171F] text-[#EDEAE0] pb-16">
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <h1 className="text-xl font-semibold mb-6">ร่างกาย</h1>

        <div className="lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6 lg:items-start">
          {/* ---------- คอลัมน์ซ้าย: ชั่งวันนี้ + แนวโน้ม ---------- */}
          <div>
            {/* ก) ชั่งวันนี้ */}
            <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-[#7C8394]">ชั่งวันนี้</p>
                <span className={`text-xs text-[#4FC1E0] transition-opacity ${metricSavedFlash ? 'opacity-100' : 'opacity-0'}`}>
                  บันทึกแล้ว
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[#7C8394] flex items-center gap-1 mb-1">
                    <Scale size={12} /> น้ำหนัก (กก.)
                  </label>
                  <input key={`weight-${today}`} type="number" min="0" step="0.1" inputMode="decimal"
                    defaultValue={localMetric.weight ?? ''}
                    placeholder="0.0"
                    onBlur={e => saveMetricField('weight', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg px-3 py-2.5
                      text-2xl font-semibold tabular-nums outline-none focus:border-[#4FC1E0] min-h-[48px]" />
                </div>
                <div>
                  <label className="text-[10px] text-[#7C8394] flex items-center gap-1 mb-1">
                    <Ruler size={12} /> ส่วนสูง (ซม.)
                  </label>
                  <input key={`height-${today}`} type="number" min="0" step="0.1"
                    defaultValue={localMetric.height ?? ''}
                    placeholder="0.0"
                    onBlur={e => saveMetricField('height', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg px-3 py-2.5
                      text-lg font-semibold tabular-nums outline-none focus:border-[#7C8394] min-h-[48px]" />
                </div>
              </div>

              {bmi != null && (
                <p className="text-xs text-[#7C8394] mt-3">
                  BMI {bmi.toFixed(1)} · {bmiBand(bmi)}
                </p>
              )}
            </div>

            {/* ข) แนวโน้ม */}
            <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
              <p className="text-xs text-[#7C8394] mb-2">แนวโน้ม</p>

              {weighInCount < 2 ? (
                <p className="text-xs text-[#7C8394] py-4">ชั่งอีกครั้งพรุ่งนี้เพื่อดูแนวโน้ม</p>
              ) : (
                <>
                  <div className="flex gap-4 mb-3">
                    <div>
                      <p className="text-lg font-semibold tabular-nums"
                        style={{ color: weightDeltaColor(delta7, plan) }}>
                        {delta7 != null ? `${delta7 > 0 ? '+' : ''}${delta7.toFixed(1)}` : '—'}
                      </p>
                      <p className="text-[10px] text-[#7C8394]">7 วันก่อน</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold tabular-nums"
                        style={{ color: weightDeltaColor(delta30, plan) }}>
                        {delta30 != null ? `${delta30 > 0 ? '+' : ''}${delta30.toFixed(1)}` : '—'}
                      </p>
                      <p className="text-[10px] text-[#7C8394]">30 วันก่อน</p>
                    </div>
                  </div>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData}>
                        <CartesianGrid stroke="#2A2F3D" vertical={false} />
                        <XAxis dataKey="label" stroke="#7C8394" fontSize={10}
                          tickLine={false} axisLine={false} interval={4} />
                        <YAxis stroke="#7C8394" fontSize={10} tickLine={false} axisLine={false}
                          width={36} domain={['dataMin - 1', 'dataMax + 1']} />
                        <Tooltip
                          isAnimationActive={false}
                          contentStyle={{ background: '#1B1F2A', border: '1px solid #2A2F3D',
                            borderRadius: 8, fontSize: 12 }}
                          labelStyle={{ color: '#EDEAE0' }} />
                        <Line dataKey="weight" name="กก." stroke="#4FC1E0" strokeWidth={2}
                          dot={{ r: 3 }} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ---------- คอลัมน์ขวา: กิจกรรม + เวย์/อาหารเสริม ---------- */}
          <div>
            {/* ค) กิจกรรมวันนี้ */}
            <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-[#7C8394]">กิจกรรมวันนี้</p>
                <span className={`text-xs text-[#4FC1E0] transition-opacity ${healthSavedFlash ? 'opacity-100' : 'opacity-0'}`}>
                  บันทึกแล้ว
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[#7C8394] flex items-center gap-1 mb-1">
                    <Footprints size={12} /> ก้าว
                  </label>
                  <input key={`steps-${today}`} type="number" min="0" inputMode="numeric"
                    defaultValue={localHealth.steps ?? ''}
                    placeholder="0"
                    onBlur={e => saveHealthField('steps', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg px-3 py-2
                      text-lg font-semibold tabular-nums outline-none focus:border-[#4FC1E0] min-h-[44px]" />
                </div>
                <div>
                  <label className="text-[10px] text-[#7C8394] flex items-center gap-1 mb-1">
                    <Flame size={12} /> แคลจากกิจกรรม
                  </label>
                  <input key={`cal-${today}`} type="number" min="0" inputMode="numeric"
                    defaultValue={localHealth.calories_burned ?? ''}
                    placeholder="0"
                    onBlur={e => saveHealthField('calories_burned', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg px-3 py-2
                      text-lg font-semibold tabular-nums outline-none focus:border-[#F0A345] min-h-[44px]" />
                </div>
              </div>
              <p className="text-[10px] text-[#7C8394] mt-1.5">ไม่รวมการเผาผลาญพื้นฐาน (BMR)</p>

              <button onClick={() => setShowMore(o => !o)}
                className="text-xs text-[#7C8394] mt-3 underline">
                {showMore ? 'ซ่อน' : 'เพิ่มเติม'}
              </button>

              {showMore && (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <label className="text-[10px] text-[#7C8394] block mb-1">ชีพจรขณะพัก (bpm)</label>
                    <input key={`hr-${today}`} type="number" min="0"
                      defaultValue={localHealth.resting_hr ?? ''}
                      onBlur={e => saveHealthField('resting_hr', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      className={`w-full ${inputCls}`} />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#7C8394] block mb-1">เวลานอน (นาที)</label>
                    <input key={`sleep-${today}`} type="number" min="0"
                      defaultValue={localHealth.sleep_minutes ?? ''}
                      onBlur={e => saveHealthField('sleep_minutes', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      className={`w-full ${inputCls}`} />
                  </div>
                </div>
              )}

              {yesterdayHealth?.steps == null && (
                <div className="flex items-center gap-2 bg-[#14171F] border border-dashed border-[#2A2F3D]
                  rounded-lg px-3 py-2 mt-3">
                  <span className="text-xs text-[#7C8394] flex-1">ลืมกรอกเมื่อวานหรือเปล่า?</span>
                  <input type="number" min="0" placeholder="ก้าวเมื่อวาน..."
                    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    onBlur={e => e.target.value && saveDaySteps(yesterday, e.target.value)}
                    className="w-28 bg-[#1B1F2A] border border-[#2A2F3D] rounded-lg px-2 py-1.5
                      text-xs outline-none focus:border-[#7C8394] min-h-[36px]" />
                </div>
              )}

              {!hasHealthData && (
                <p className="text-xs text-[#7C8394] mt-3">
                  กรอกก้าวกับแคลจากแอปนาฬิกาวันละครั้ง — ใช้เวลา 10 วิ
                </p>
              )}

              {hasHealthData && (
                <div className="h-32 mt-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stepsChartData}>
                      <CartesianGrid stroke="#2A2F3D" vertical={false} />
                      <XAxis dataKey="label" stroke="#7C8394" fontSize={9}
                        tickLine={false} axisLine={false} interval={1} />
                      <YAxis stroke="#7C8394" fontSize={9} tickLine={false} axisLine={false} width={32} />
                      <Tooltip
                        isAnimationActive={false}
                        contentStyle={{ background: '#1B1F2A', border: '1px solid #2A2F3D',
                          borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: '#EDEAE0' }} />
                      <Bar dataKey="steps" name="ก้าว" fill="#4FC1E0" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="divide-y divide-[#2A2F3D] mt-2">
                {days14.slice().reverse().map(d => {
                  const row = health.find(x => x.date === d)
                  const label = new Date(d).toLocaleDateString('th-TH',
                    { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })
                  return (
                    <div key={d} className="flex items-center gap-2 py-1.5">
                      <span className="text-xs text-[#7C8394] w-20 flex-shrink-0">{label}</span>
                      <input type="number" min="0" defaultValue={row?.steps ?? ''} placeholder="—"
                        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        onBlur={e => {
                          const same = (row?.steps ?? '') === (e.target.value === '' ? '' : parseInt(e.target.value))
                          if (!same) saveDaySteps(d, e.target.value)
                        }}
                        className="flex-1 min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                          px-2 py-1.5 text-xs tabular-nums outline-none focus:border-[#7C8394] min-h-[36px]" />
                      <span className="text-[10px] text-[#7C8394] flex-shrink-0">ก้าว</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ง) เวย์โปรตีน / อาหารเสริม */}
            <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-[#7C8394] flex items-center gap-1.5">
                  <Pill size={13} /> เวย์โปรตีน / อาหารเสริม
                </p>
                <button onClick={() => setManageOpen(o => !o)}
                  className="text-xs text-[#7C8394]">
                  {manageOpen ? 'ปิด' : 'จัดการ'}
                </button>
              </div>

              {supplements.length === 0 && !manageOpen && (
                <p className="text-xs text-[#7C8394]">ยังไม่มีรายการ — กด "จัดการ" เพื่อเพิ่ม</p>
              )}

              {supplementsBySlot.map(({ slot, items }) => (
                <div key={slot} className={slot === 'workout' ? 'opacity-70' : ''}>
                  {items.length > 0 && (
                    <p className="text-[10px] text-[#7C8394] uppercase tracking-wide mt-2 mb-1">
                      {SLOT_LABELS[slot]}
                    </p>
                  )}
                  {items.map(s => {
                    const taken = isTaken(s.id)
                    const takenAt = takenAtFor(s.id)
                    return (
                      <button key={s.id} onClick={() => toggleSupplement(s.id)}
                        className="w-full flex items-center gap-3 py-2 text-left">
                        <span className={`w-5 h-5 rounded-md border-2 flex-shrink-0
                          flex items-center justify-center text-xs
                          ${taken ? 'border-transparent bg-[#4FC1E0] text-[#14171F]' : 'border-[#7C8394]'}`}>
                          {taken && '✓'}
                        </span>
                        <span className={`text-sm flex-1 min-w-0 ${taken ? 'text-[#7C8394] line-through' : ''}`}>
                          {s.name}
                          {s.dose && <span className="text-[#7C8394] ml-2 text-xs">{s.dose}</span>}
                        </span>
                        {taken && takenAt && (
                          <span className="text-[10px] text-[#7C8394] tabular-nums flex-shrink-0">
                            {fmtHHMM(takenAt)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}

              {manageOpen && (
                <div className="mt-2 pt-2 border-t border-[#2A2F3D] space-y-2">
                  {supplements.map(s => (
                    <div key={s.id} className="flex items-center gap-2 flex-wrap">
                      <input defaultValue={s.name} placeholder="ชื่อ..."
                        onBlur={e => e.target.value !== s.name &&
                          editSupplement(s.id, 'name', e.target.value)}
                        className="flex-1 min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                          px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]" />
                      <input defaultValue={s.dose ?? ''} placeholder="ขนาด"
                        onBlur={e => e.target.value !== (s.dose ?? '') &&
                          editSupplement(s.id, 'dose', e.target.value)}
                        className="w-20 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                          px-2 py-1.5 text-xs outline-none focus:border-[#7C8394]" />
                      <select defaultValue={s.slot}
                        onChange={e => setSupplementSlot(s.id, e.target.value as SupplementSlot)}
                        className="bg-[#14171F] border border-[#2A2F3D] rounded-lg
                          px-2 py-1.5 text-xs outline-none">
                        {SLOT_ORDER.map(sl => (
                          <option key={sl} value={sl}>{SLOT_LABELS[sl]}</option>
                        ))}
                      </select>
                      <button onClick={() => removeSupplement(s.id)}
                        className="text-[#7C8394] p-1"><X size={14} /></button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 flex-wrap">
                    <input value={newSupp.name} placeholder="เพิ่มอาหารเสริมใหม่..."
                      onChange={e => setNewSupp(p => ({ ...p, name: e.target.value }))}
                      className="flex-1 min-w-0 bg-transparent border border-dashed border-[#2A2F3D]
                        rounded-lg px-3 py-1.5 text-sm outline-none
                        focus:border-[#7C8394] placeholder:text-[#7C8394]" />
                    <input value={newSupp.dose} placeholder="ขนาด"
                      onChange={e => setNewSupp(p => ({ ...p, dose: e.target.value }))}
                      className="w-20 bg-transparent border border-dashed border-[#2A2F3D]
                        rounded-lg px-3 py-1.5 text-xs outline-none
                        focus:border-[#7C8394] placeholder:text-[#7C8394]" />
                    <select value={newSupp.slot}
                      onChange={e => setNewSupp(p => ({ ...p, slot: e.target.value as SupplementSlot }))}
                      className="bg-transparent border border-dashed border-[#2A2F3D]
                        rounded-lg px-2 py-1.5 text-xs outline-none">
                      {SLOT_ORDER.map(sl => (
                        <option key={sl} value={sl} className="bg-[#14171F]">{SLOT_LABELS[sl]}</option>
                      ))}
                    </select>
                    <button onClick={addSupplement}
                      className="text-[#7C8394] p-1"><Plus size={14} /></button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
