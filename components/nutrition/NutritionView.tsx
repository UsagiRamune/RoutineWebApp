'use client'

// UI หน้าโภชนาการ: ประเมินอาหารด้วย AI, เป้าหมาย, น้ำดื่ม, IF timer
// (อาหารเสริม/เวย์ย้ายไปอยู่หน้าร่างกาย /health แล้ว)
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  FoodEntry, WaterEntry, WaterContainer, IfSettings, NutritionProfile,
  MealType, NutritionPlan,
} from '@/lib/supabase/types'
import { ifStatus, fmtRemaining } from '@/lib/nutrition'
import { remainingInContainer } from '@/lib/water'
import { TZ } from '@/lib/dates'
import { GlassWater, Plus, X, Trash2, Sparkles } from 'lucide-react'
import Toggle from '@/components/ui/Toggle'

interface Props {
  today: string
  entries: FoodEntry[]
  waterEntries: WaterEntry[]
  containers: WaterContainer[]
  ifSettings: IfSettings | null
  profile: NutritionProfile | null
}

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other']
const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'มื้อเช้า', lunch: 'มื้อเที่ยง', dinner: 'มื้อเย็น', snack: 'ของว่าง', other: 'อื่นๆ',
}

const PLAN_LABELS: Record<NutritionPlan, string> = {
  cut: 'ลดน้ำหนัก', normal: 'ปกติ', bulk: 'สร้างกล้าม',
}

interface Draft {
  name: string; calories: string; protein: string; carbs: string; fat: string; note: string
}
const emptyDraft: Draft = { name: '', calories: '', protein: '', carbs: '', fat: '', note: '' }

interface EstimateDraft {
  name: string; calories: string; protein: string; carbs: string; fat: string
  confidence: 'low' | 'medium' | 'high'; assumptions: string
}

function guessMeal(): MealType {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour12: false, hour: '2-digit' }))
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 18) return 'snack'
  if (h < 22) return 'dinner'
  return 'other'
}

function fmtHHMM(iso: string) {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
}

const CONFIDENCE_COLOR: Record<string, string> = {
  low: '#E4574A', medium: '#F0A345', high: '#4FC1E0',
}

export default function NutritionView({
  today, entries, waterEntries, containers, ifSettings, profile,
}: Props) {
  const supabase = createClient()
  const router = useRouter()

  // ---------- macro summary ----------

  const totals = entries.reduce((acc, e) => ({
    calories: acc.calories + (e.calories ?? 0),
    protein: acc.protein + (e.protein_g ?? 0),
    carbs: acc.carbs + (e.carbs_g ?? 0),
    fat: acc.fat + (e.fat_g ?? 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 })

  // ---------- food input: AI ประเมิน / กรอกเอง ----------

  const [addMeal, setAddMeal] = useState<MealType>(() => guessMeal())
  const [description, setDescription] = useState('')
  const [estimating, setEstimating] = useState(false)
  const [estimateError, setEstimateError] = useState('')
  const [estimateDraft, setEstimateDraft] = useState<EstimateDraft | null>(null)
  const [manualMode, setManualMode] = useState(false)
  const [manualDraft, setManualDraft] = useState<Draft>(emptyDraft)

  async function runEstimate() {
    if (!description.trim()) return
    setEstimating(true)
    setEstimateError('')
    setEstimateDraft(null)
    try {
      const res = await fetch('/api/nutrition/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim(), meal: MEAL_LABELS[addMeal] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const r = data.result
      setEstimateDraft({
        name: r.name ?? description.trim(),
        calories: String(r.calories ?? ''),
        protein: String(r.protein_g ?? ''),
        carbs: String(r.carbs_g ?? ''),
        fat: String(r.fat_g ?? ''),
        confidence: r.confidence ?? 'medium',
        assumptions: r.assumptions ?? '',
      })
    } catch (err) {
      setEstimateError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    } finally {
      setEstimating(false)
    }
  }

  function updateEstimateDraft(field: keyof EstimateDraft, value: string) {
    setEstimateDraft(p => p ? { ...p, [field]: value } : p)
  }

  async function saveEstimate() {
    if (!estimateDraft) return
    await supabase.from('food_entries').insert({
      date: today, meal: addMeal,
      name: estimateDraft.name.trim() || description.trim(),
      calories: estimateDraft.calories === '' ? null : Math.max(0, parseInt(estimateDraft.calories) || 0),
      protein_g: estimateDraft.protein === '' ? null : Math.max(0, parseFloat(estimateDraft.protein) || 0),
      carbs_g: estimateDraft.carbs === '' ? null : Math.max(0, parseFloat(estimateDraft.carbs) || 0),
      fat_g: estimateDraft.fat === '' ? null : Math.max(0, parseFloat(estimateDraft.fat) || 0),
      note: `AI ประเมิน (${estimateDraft.confidence})`,
    })
    setEstimateDraft(null)
    setDescription('')
  }

  function updateManualDraft(field: keyof Draft, value: string) {
    setManualDraft(p => ({ ...p, [field]: value }))
  }

  async function saveManual() {
    if (!manualDraft.name.trim()) return
    await supabase.from('food_entries').insert({
      date: today, meal: addMeal,
      name: manualDraft.name.trim(),
      calories: manualDraft.calories === '' ? null : Math.max(0, parseInt(manualDraft.calories) || 0),
      protein_g: manualDraft.protein === '' ? null : Math.max(0, parseFloat(manualDraft.protein) || 0),
      carbs_g: manualDraft.carbs === '' ? null : Math.max(0, parseFloat(manualDraft.carbs) || 0),
      fat_g: manualDraft.fat === '' ? null : Math.max(0, parseFloat(manualDraft.fat) || 0),
      note: manualDraft.note.trim() || null,
    })
    setManualDraft(emptyDraft)
  }

  async function deleteFood(id: string) {
    await supabase.from('food_entries').delete().eq('id', id)
  }

  // ---------- water (ml) ----------

  interface OptimisticWater { id: string; ml: number; container: string | null; created_at: string }
  const [optimisticEntries, setOptimisticEntries] = useState<OptimisticWater[]>([])
  useEffect(() => { setOptimisticEntries([]) }, [waterEntries])

  const allWaterEntries = [...waterEntries, ...optimisticEntries]
  const currentMl = allWaterEntries.reduce((s, w) => s + (w.ml ?? 0), 0)
  const targetMl = profile?.daily_water_ml ?? 4000
  const overMl = currentMl - targetMl
  const remainingHint = overMl < 0 ? remainingInContainer(-overMl, containers) : null

  async function addWater(ml: number, container: string | null) {
    if (ml <= 0) return
    setOptimisticEntries(p => [...p, {
      id: `temp-${Date.now()}`, ml, container, created_at: new Date().toISOString(),
    }])
    await supabase.from('water_entries').insert({ date: today, ml, container })
  }

  async function removeWater(id: string) {
    if (id.startsWith('temp-')) return
    await supabase.from('water_entries').delete().eq('id', id)
  }

  const [manualMlOpen, setManualMlOpen] = useState(false)
  const [manualMl, setManualMl] = useState('')

  async function saveManualMl() {
    const ml = Math.max(0, parseInt(manualMl) || 0)
    if (ml <= 0) return
    await addWater(ml, null)
    setManualMl('')
    setManualMlOpen(false)
  }

  // ---------- จัดการภาชนะ ----------

  const [containerManageOpen, setContainerManageOpen] = useState(false)
  const [newContainer, setNewContainer] = useState({ name: '', ml: '' })

  async function addContainer() {
    const ml = Math.max(1, parseInt(newContainer.ml) || 0)
    if (!newContainer.name.trim() || ml <= 0) return
    await supabase.from('water_containers').insert({
      name: newContainer.name.trim(), ml, sort_order: containers.length + 1,
    })
    setNewContainer({ name: '', ml: '' })
  }
  async function editContainer(id: string, field: 'name' | 'ml', value: string) {
    if (field === 'ml') {
      const ml = Math.max(1, parseInt(value) || 0)
      if (ml > 0) await supabase.from('water_containers').update({ ml }).eq('id', id)
    } else {
      if (value.trim()) await supabase.from('water_containers').update({ name: value.trim() }).eq('id', id)
    }
  }
  async function removeContainer(id: string) {
    await supabase.from('water_containers').update({ is_active: false }).eq('id', id)
  }

  // ---------- intermittent fasting ----------

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ifSettings?.enabled) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ifSettings?.enabled])

  const status = ifSettings?.enabled ? ifStatus(ifSettings, new Date(now)) : null

  async function setIfEnabled(enabled: boolean) {
    await supabase.from('if_settings').upsert({ id: 1, enabled })
  }

  async function setIfTime(field: 'eat_start' | 'eat_end', value: string) {
    if (!value) return
    await supabase.from('if_settings').upsert({ id: 1, [field]: value })
  }

  // ---------- targets ----------

  const [selectedPlan, setSelectedPlan] = useState<NutritionPlan>(profile?.plan ?? 'cut')
  const [calculating, setCalculating] = useState(false)
  const [targetsError, setTargetsError] = useState('')

  async function calcTargets() {
    setCalculating(true)
    setTargetsError('')
    try {
      const res = await fetch('/api/nutrition/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      router.refresh()
    } catch (err) {
      setTargetsError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    } finally {
      setCalculating(false)
    }
  }

  // ---------- render ----------

  const inputCls = 'bg-[#14171F] border border-[#2A2F3D] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#7C8394] min-h-[40px]'

  return (
    <main className="min-h-screen bg-[#14171F] text-[#EDEAE0] pb-16">
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <h1 className="text-xl font-semibold mb-6">โภชนาการ</h1>

        <div className="lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6 lg:items-start">
          {/* ---------- คอลัมน์ซ้าย: เพิ่มอาหาร + meal log ---------- */}
          <div>
            {/* สรุปแมโคร */}
            <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
              <p className="text-3xl font-semibold tabular-nums">
                {Math.round(totals.calories)} <span className="text-sm font-normal text-[#7C8394]">kcal</span>
              </p>
              <div className="flex gap-2 mt-2">
                <span className="text-xs px-2 py-1 rounded-md bg-[#14171F] border border-[#2A2F3D]">
                  โปรตีน {totals.protein.toFixed(0)} ก.
                </span>
                <span className="text-xs px-2 py-1 rounded-md bg-[#14171F] border border-[#2A2F3D]">
                  คาร์บ {totals.carbs.toFixed(0)} ก.
                </span>
                <span className="text-xs px-2 py-1 rounded-md bg-[#14171F] border border-[#2A2F3D]">
                  ไขมัน {totals.fat.toFixed(0)} ก.
                </span>
              </div>
            </div>

            {/* เพิ่มอาหาร */}
            <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
              <div className="flex flex-wrap gap-1.5 mb-3">
                {MEALS.map(m => (
                  <button key={m} onClick={() => setAddMeal(m)}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold border min-h-[40px]
                      ${addMeal === m ? 'bg-[#EDEAE0] text-[#14171F] border-[#EDEAE0]' : 'border-[#2A2F3D] text-[#7C8394]'}`}>
                    {MEAL_LABELS[m]}
                  </button>
                ))}
              </div>

              {!manualMode ? (
                <>
                  <textarea value={description} rows={2}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="พิมพ์คร่าวๆ เช่น กะเพราหมูกรอบไข่ดาว ข้าวน้อย ไข่ 2 ฟอง"
                    className={`w-full ${inputCls} resize-none`} />
                  <button onClick={runEstimate} disabled={estimating || !description.trim()}
                    className="w-full mt-2 py-2.5 rounded-lg bg-[#EDEAE0] text-[#14171F]
                      text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5">
                    <Sparkles size={14} /> {estimating ? 'กำลังประเมิน...' : 'ให้ AI ตีเป็นแคล'}
                  </button>
                  {estimateError && <p className="text-xs text-[#E4574A] mt-2">{estimateError}</p>}

                  {estimateDraft && (
                    <div className="mt-3 border-2 border-[#4FC1E0] bg-[#16232B] rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <input value={estimateDraft.name}
                          onChange={e => updateEstimateDraft('name', e.target.value)}
                          className="flex-1 bg-transparent text-sm font-medium outline-none
                            border-b border-transparent focus:border-[#2A2F3D]" />
                        <span className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ml-2"
                          style={{ color: CONFIDENCE_COLOR[estimateDraft.confidence],
                            border: `1px solid ${CONFIDENCE_COLOR[estimateDraft.confidence]}` }}>
                          {estimateDraft.confidence}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <input value={estimateDraft.calories} type="number" placeholder="kcal"
                          onChange={e => updateEstimateDraft('calories', e.target.value)}
                          className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg px-2 py-1.5 text-xs outline-none" />
                        <input value={estimateDraft.protein} type="number" placeholder="P"
                          onChange={e => updateEstimateDraft('protein', e.target.value)}
                          className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg px-2 py-1.5 text-xs outline-none" />
                        <input value={estimateDraft.carbs} type="number" placeholder="C"
                          onChange={e => updateEstimateDraft('carbs', e.target.value)}
                          className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg px-2 py-1.5 text-xs outline-none" />
                        <input value={estimateDraft.fat} type="number" placeholder="F"
                          onChange={e => updateEstimateDraft('fat', e.target.value)}
                          className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg px-2 py-1.5 text-xs outline-none" />
                      </div>
                      {estimateDraft.assumptions && (
                        <p className="text-[11px] text-[#7C8394]">{estimateDraft.assumptions}</p>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => setEstimateDraft(null)}
                          className="flex-1 py-2 rounded-lg border border-[#2A2F3D] text-xs text-[#7C8394]">
                          ยกเลิก
                        </button>
                        <button onClick={saveEstimate}
                          className="flex-1 py-2 rounded-lg bg-[#4FC1E0] text-[#14171F] text-xs font-semibold">
                          บันทึก
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <input value={manualDraft.name} placeholder="ชื่ออาหาร..."
                    onChange={e => updateManualDraft('name', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveManual()}
                    className={`w-full ${inputCls}`} />
                  <div className="grid grid-cols-4 gap-2">
                    <input value={manualDraft.calories} type="number" min="0" placeholder="kcal"
                      onChange={e => updateManualDraft('calories', e.target.value)}
                      className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg px-2 py-2 text-xs outline-none" />
                    <input value={manualDraft.protein} type="number" min="0" placeholder="P (ก.)"
                      onChange={e => updateManualDraft('protein', e.target.value)}
                      className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg px-2 py-2 text-xs outline-none" />
                    <input value={manualDraft.carbs} type="number" min="0" placeholder="C (ก.)"
                      onChange={e => updateManualDraft('carbs', e.target.value)}
                      className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg px-2 py-2 text-xs outline-none" />
                    <input value={manualDraft.fat} type="number" min="0" placeholder="F (ก.)"
                      onChange={e => updateManualDraft('fat', e.target.value)}
                      className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg px-2 py-2 text-xs outline-none" />
                  </div>
                  <div className="flex gap-2">
                    <input value={manualDraft.note} placeholder="โน้ต (ถ้ามี)..."
                      onChange={e => updateManualDraft('note', e.target.value)}
                      className={`flex-1 min-w-0 ${inputCls}`} />
                    <button onClick={saveManual}
                      className="px-4 rounded-lg bg-[#EDEAE0] text-[#14171F]
                        text-xs font-semibold flex-shrink-0 min-h-[40px]">เพิ่ม</button>
                  </div>
                </div>
              )}

              <button onClick={() => setManualMode(m => !m)}
                className="text-xs text-[#7C8394] mt-3 underline">
                {manualMode ? 'ใช้ AI ประเมินแทน' : 'กรอกเองแบบละเอียด'}
              </button>
            </div>

            {/* meal log */}
            {MEALS.map(meal => {
              const mealEntries = entries.filter(e => e.meal === meal)
              if (mealEntries.length === 0) return null
              return (
                <section key={meal} className="mb-6">
                  <h2 className="text-sm font-semibold mb-2">{MEAL_LABELS[meal]}</h2>
                  {mealEntries.map(e => (
                    <div key={e.id}
                      className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-3 mb-2
                        flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{e.name}</p>
                        <p className="text-xs text-[#7C8394] tabular-nums">
                          {e.calories ?? 0} kcal
                          {(e.protein_g || e.carbs_g || e.fat_g) &&
                            ` · P${e.protein_g ?? 0} C${e.carbs_g ?? 0} F${e.fat_g ?? 0}`}
                          {e.note && ` · ${e.note}`}
                        </p>
                      </div>
                      <button onClick={() => deleteFood(e.id)}
                        className="text-[#7C8394] p-2 flex-shrink-0"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </section>
              )
            })}
            {entries.length === 0 && (
              <p className="text-xs text-[#7C8394]">ยังไม่มีบันทึกอาหารวันนี้</p>
            )}
          </div>

          {/* ---------- คอลัมน์ขวา: เป้าหมาย, น้ำ, IF ---------- */}
          <div>
            {/* เป้าหมาย */}
            <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
              <p className="text-xs text-[#7C8394] mb-2">เป้าหมาย</p>
              <div className="flex gap-2 mb-3">
                {(['cut', 'normal', 'bulk'] as const).map(p => (
                  <button key={p} onClick={() => setSelectedPlan(p)}
                    className={`flex-1 px-2 py-2 rounded-lg text-xs font-semibold border min-h-[40px]
                      ${selectedPlan === p ? 'bg-[#EDEAE0] text-[#14171F] border-[#EDEAE0]' : 'border-[#2A2F3D] text-[#7C8394]'}`}>
                    {PLAN_LABELS[p]}
                  </button>
                ))}
              </div>
              {profile ? (
                <div className="text-xs text-[#7C8394] space-y-0.5 mb-3">
                  <p>แคลอรี่: {profile.daily_calories ?? '—'} kcal</p>
                  <p>โปรตีน: {profile.daily_protein_g ?? '—'} ก.</p>
                  <p>น้ำ: {(profile.daily_water_ml / 1000).toFixed(1)} ล./วัน</p>
                  {profile.ai_rationale && <p className="mt-1.5 italic">{profile.ai_rationale}</p>}
                </div>
              ) : (
                <p className="text-xs text-[#7C8394] mb-3">ยังไม่ตั้งเป้า</p>
              )}
              <button onClick={calcTargets} disabled={calculating}
                className="w-full py-2.5 rounded-lg bg-[#EDEAE0] text-[#14171F]
                  text-sm font-semibold disabled:opacity-50">
                {calculating ? 'กำลังคำนวณ...' : 'คำนวณเป้าใหม่'}
              </button>
              {targetsError && <p className="text-xs text-[#E4574A] mt-2">{targetsError}</p>}
            </div>

            {/* น้ำดื่ม */}
            <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-[#7C8394] flex items-center gap-1.5">
                  <GlassWater size={13} /> น้ำดื่ม
                </p>
                <span className="text-xs tabular-nums text-[#7C8394]">
                  {(currentMl / 1000).toFixed(2)}/{(targetMl / 1000).toFixed(2)} ล.
                  {overMl > 0 && (
                    <span className="text-[#4FC1E0] ml-1.5">เกินเป้า +{(overMl / 1000).toFixed(1)} ล.</span>
                  )}
                </span>
              </div>
              {remainingHint && (
                <p className="text-[10px] text-[#7C8394] mb-2">{remainingHint}</p>
              )}

              <div className="flex flex-wrap gap-2 mb-2">
                {containers.map(c => (
                  <button key={c.id} onClick={() => addWater(c.ml, c.name)}
                    className="px-3 py-2 rounded-lg bg-[#14171F] border border-[#2A2F3D]
                      text-xs font-semibold min-h-[40px]">
                    {c.name} +{c.ml}
                  </button>
                ))}
              </div>

              {!manualMlOpen ? (
                <button onClick={() => setManualMlOpen(true)}
                  className="text-xs text-[#7C8394] underline">+ กรอกเอง</button>
              ) : (
                <div className="flex gap-2">
                  <input type="number" min="0" value={manualMl}
                    onChange={e => setManualMl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveManualMl()}
                    placeholder="ml"
                    className="flex-1 min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                      px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]" />
                  <button onClick={saveManualMl}
                    className="px-3 rounded-lg bg-[#EDEAE0] text-[#14171F] text-xs font-semibold">
                    เพิ่ม
                  </button>
                </div>
              )}

              {allWaterEntries.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {allWaterEntries.map(e => (
                    <div key={e.id} className="flex items-center justify-between text-xs text-[#7C8394]">
                      <span className="tabular-nums">
                        {fmtHHMM(e.created_at)} · {e.ml} ml{e.container ? ` (${e.container})` : ''}
                      </span>
                      {!e.id.startsWith('temp-') && (
                        <button onClick={() => removeWater(e.id)} className="p-1.5">
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setContainerManageOpen(o => !o)}
                className="text-xs text-[#7C8394] mt-2 underline">
                {containerManageOpen ? 'ปิด' : 'จัดการภาชนะ'}
              </button>

              {containerManageOpen && (
                <div className="mt-2 pt-2 border-t border-[#2A2F3D] space-y-2">
                  {containers.map(c => (
                    <div key={c.id} className="flex items-center gap-2">
                      <input defaultValue={c.name} placeholder="ชื่อภาชนะ..."
                        onBlur={e => e.target.value !== c.name && editContainer(c.id, 'name', e.target.value)}
                        className="flex-1 min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                          px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]" />
                      <input defaultValue={c.ml} type="number" min="1" placeholder="ml"
                        onBlur={e => String(c.ml) !== e.target.value && editContainer(c.id, 'ml', e.target.value)}
                        className="w-20 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                          px-2 py-1.5 text-xs outline-none focus:border-[#7C8394]" />
                      <button onClick={() => removeContainer(c.id)}
                        className="text-[#7C8394] p-1"><X size={14} /></button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <input value={newContainer.name} placeholder="เพิ่มภาชนะใหม่..."
                      onChange={e => setNewContainer(p => ({ ...p, name: e.target.value }))}
                      className="flex-1 min-w-0 bg-transparent border border-dashed border-[#2A2F3D]
                        rounded-lg px-3 py-1.5 text-sm outline-none
                        focus:border-[#7C8394] placeholder:text-[#7C8394]" />
                    <input value={newContainer.ml} type="number" min="1" placeholder="ml"
                      onChange={e => setNewContainer(p => ({ ...p, ml: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && addContainer()}
                      className="w-20 bg-transparent border border-dashed border-[#2A2F3D]
                        rounded-lg px-3 py-1.5 text-xs outline-none
                        focus:border-[#7C8394] placeholder:text-[#7C8394]" />
                    <button onClick={addContainer}
                      className="text-[#7C8394] p-1"><Plus size={14} /></button>
                  </div>
                </div>
              )}
            </div>

            {/* IF timer */}
            {ifSettings && (
              <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-[#7C8394]">Intermittent Fasting</p>
                  <Toggle checked={ifSettings.enabled} onChange={() => setIfEnabled(!ifSettings.enabled)} />
                </div>

                {ifSettings.enabled && status && (
                  <p className="text-sm font-medium mb-3">
                    {status.eating
                      ? `อยู่ในช่วงกิน เหลือ ${fmtRemaining(status.remainingSec)}`
                      : `กำลัง fast เหลือ ${fmtRemaining(status.remainingSec)} ถึงจะกินได้`}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-[#7C8394] block mb-1">เริ่มกินได้</label>
                    <input type="time" defaultValue={ifSettings.eat_start.slice(0, 5)}
                      onBlur={e => setIfTime('eat_start', e.target.value)}
                      className={`w-full ${inputCls}`} />
                  </div>
                  <div>
                    <label className="text-xs text-[#7C8394] block mb-1">หยุดกิน</label>
                    <input type="time" defaultValue={ifSettings.eat_end.slice(0, 5)}
                      onBlur={e => setIfTime('eat_end', e.target.value)}
                      className={`w-full ${inputCls}`} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
