'use client'

// หน้าประวัติ: กราฟ (week/month/year), drill-down รายวัน,
// แก้/ลบ session ย้อนหลัง, บันทึกน้ำหนัก, สตรีค
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  BodyMetric, CategoryWithRoutines, DailyTarget,
  ItemCompletionWithItem, TimeEntryWithRoutine, DetailTopic,
} from '@/lib/supabase/types'
import { ArrowLeft, X, Flame } from 'lucide-react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import ReactMarkdown from 'react-markdown'

type ViewMode = 'week' | 'month' | 'year'

interface Props {
  view: ViewMode
  today: string
  entries: TimeEntryWithRoutine[]
  completions: ItemCompletionWithItem[]
  targets: DailyTarget[]
  metrics: BodyMetric[]
  categories: CategoryWithRoutines[]
}

export default function HistoryView({
  view, today, entries, completions, targets, metrics, categories,
}: Props) {
    const router = useRouter()
    const supabase = createClient()
    const [selectedDay, setSelectedDay] = useState<string | null>(today)
    const [aiState, setAiState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
    const [aiText, setAiText] = useState('')

  // ---------- aggregate ----------

  function minutesOf(e: TimeEntryWithRoutine) {
    if (!e.clock_out) return 0 // ตัวที่ยังจับอยู่ไม่นับใน history
    return Math.max(0, Math.floor(
      (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 60000))
  }

  // รวมนาทีต่อวัน + น้ำหนัก → data ให้กราฟ
  const chartData = useMemo(() => {
    const byDay = new Map<string, number>()
    for (const e of entries) {
      byDay.set(e.date, (byDay.get(e.date) ?? 0) + minutesOf(e))
    }
    const weightByDay = new Map(metrics.map(m => [m.date, m.weight_kg]))

    if (view === 'year') {
      // รายปี: ยุบเป็นรายเดือน
      const byMonth = new Map<string, number>()
      for (const [d, mins] of byDay) {
        const key = d.slice(0, 7) // "2026-09"
        byMonth.set(key, (byMonth.get(key) ?? 0) + mins)
      }
      const weightByMonth = new Map<string, number>()
      for (const m of metrics) {
        if (m.weight_kg != null) weightByMonth.set(m.date.slice(0, 7), m.weight_kg)
      }
      return [...byMonth.keys()].sort().map(k => ({
        key: k,
        label: new Date(k + '-01').toLocaleDateString('th-TH', { month: 'short' }),
        hours: +((byMonth.get(k) ?? 0) / 60).toFixed(1),
        weight: weightByMonth.get(k) ?? null,
      }))
    }

    // week/month: รายวัน — สร้างครบทุกวันแม้วันว่าง กราฟจะได้ไม่โหว่
    const days = view === 'week' ? 7 : 30
    const out = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toLocaleDateString('sv-SE')
      out.push({
        key,
        label: d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
        hours: +((byDay.get(key) ?? 0) / 60).toFixed(1),
        weight: weightByDay.get(key) ?? null,
      })
    }
    return out
  }, [entries, metrics, view])

  // สตรีคต่อ routine: นับวันติดกันถอยหลังจากวันนี้ที่มี "ร่องรอยการทำ"
  const streaks = useMemo(() => {
    const activeByDay = new Map<string, Set<string>>() // date -> set(routine_id)
    for (const e of entries) {
      if (!activeByDay.has(e.date)) activeByDay.set(e.date, new Set())
      activeByDay.get(e.date)!.add(e.routine_id)
    }
    for (const c of completions) {
      const rid = c.routine_items?.routine_id
      if (!rid) continue
      if (!activeByDay.has(c.date)) activeByDay.set(c.date, new Set())
      activeByDay.get(c.date)!.add(rid)
    }
    const result: { name: string; days: number; color: string }[] = []
    for (const cat of categories) {
      for (const r of cat.routines.filter(x => x.is_active)) {
        let days = 0
        for (let i = 0; ; i++) {
          const d = new Date()
          d.setDate(d.getDate() - i)
          const key = d.toLocaleDateString('sv-SE')
          if (activeByDay.get(key)?.has(r.id)) days++
          else if (i === 0) continue // วันนี้ยังไม่ทำ ไม่ตัดสตรีค ไปเช็คเมื่อวานต่อ
          else break
        }
        if (days > 0) result.push({ name: r.name, days, color: cat.color })
      }
    }
    return result.sort((a, b) => b.days - a.days)
  }, [entries, completions, categories])

  const dayEntries = selectedDay
    ? entries.filter(e => e.date === selectedDay)
    : []
  const dayCompletions = selectedDay
    ? completions.filter(c => c.date === selectedDay)
    : []

  // ---------- actions ----------

  async function saveWeight(form: { weight: string; height: string; note: string }) {
    await supabase.from('body_metrics').upsert({
      date: today,
      weight_kg: form.weight === '' ? null : parseFloat(form.weight),
      height_cm: form.height === '' ? null : parseFloat(form.height),
      note: form.note || null,
    }, { onConflict: 'date' })
    router.refresh()
  }

  async function editEntryTime(e: TimeEntryWithRoutine,
    field: 'clock_in' | 'clock_out', hhmm: string) {
    if (!hhmm) return
    const iso = new Date(`${e.date}T${hhmm}:00`).toISOString()
    await supabase.from('time_entries').update({ [field]: iso }).eq('id', e.id)
    router.refresh()
  }

  async function deleteEntry(id: string) {
    if (!confirm('ลบ session นี้ทิ้งถาวร?')) return
    await supabase.from('time_entries').delete().eq('id', id)
    router.refresh()
  }

    async function saveDetails(entryId: string, details: DetailTopic[]) {
    await supabase.from('time_entries').update({ details }).eq('id', entryId)
    router.refresh()
  }

    async function analyze() {
        setAiState('loading')
        try {
        const days = view === 'week' ? 7 : view === 'month' ? 30 : 90
        const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
            setAiText(data.analysis)
            setAiState('done')
        } catch (err) {
            setAiText(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
            setAiState('error')
        }
  }

  // ---------- render ----------

  const [wForm, setWForm] = useState({ weight: '', height: '', note: '' })
  const latestMetric = metrics[metrics.length - 1]

  function fmtHHMM(iso: string) {
    return new Date(iso).toLocaleTimeString('th-TH',
      { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <main className="min-h-screen bg-[#14171F] text-[#EDEAE0] pb-16">
      <div className="max-w-lg mx-auto px-4 pt-8">

        {/* header + toggle */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 rounded-lg border border-[#2A2F3D] text-[#7C8394]">
              <ArrowLeft size={18} />
            </Link>
            <h1 className="text-xl font-semibold">ประวัติ</h1>
          </div>
          <div className="flex rounded-lg border border-[#2A2F3D] overflow-hidden text-xs">
            {(['week', 'month', 'year'] as const).map(v => (
              <Link key={v} href={`/history?view=${v}`}
                className={`px-3 py-1.5 ${view === v
                  ? 'bg-[#EDEAE0] text-[#14171F] font-semibold'
                  : 'text-[#7C8394]'}`}>
                {v === 'week' ? 'สัปดาห์' : v === 'month' ? 'เดือน' : 'ปี'}
              </Link>
            ))}
          </div>
        </div>

        {/* chart */}
        <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
          <p className="text-xs text-[#7C8394] mb-2">
            ชั่วโมงที่จับเวลา{metrics.length > 0 && ' + น้ำหนัก (เส้น)'}
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}
                onClick={(s) => {
                  if (view !== 'year' && s?.activeLabel) {
                    const found = chartData.find(d => d.label === s.activeLabel)
                    if (found) setSelectedDay(found.key)
                  }
                }}>
                <CartesianGrid stroke="#2A2F3D" vertical={false} />
                <XAxis dataKey="label" stroke="#7C8394" fontSize={10}
                  tickLine={false} axisLine={false}
                  interval={view === 'month' ? 4 : 0} />
                <YAxis yAxisId="h" stroke="#7C8394" fontSize={10}
                  tickLine={false} axisLine={false} width={26} />
                <YAxis yAxisId="w" orientation="right" stroke="#9B7EDE"
                  fontSize={10} tickLine={false} axisLine={false} width={30}
                  domain={['dataMin - 2', 'dataMax + 2']} hide={metrics.length === 0} />
                <Tooltip
                  position={{ y: 10 }}
                  isAnimationActive={false}
                  contentStyle={{ background: '#1B1F2A', border: '1px solid #2A2F3D',
                    borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#EDEAE0' }} />
                <Bar yAxisId="h" dataKey="hours" name="ชม."
                  fill="#4FC1E0" radius={[4, 4, 0, 0]} cursor="pointer" />
                <Line yAxisId="w" dataKey="weight" name="กก." stroke="#9B7EDE"
                  strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {view !== 'year' && (
            <p className="text-[10px] text-[#7C8394] mt-1">แตะแท่งเพื่อดูรายละเอียดวันนั้น</p>
          )}
        </div>

        {/* streaks */}
        {streaks.length > 0 && (
          <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
            <p className="text-xs text-[#7C8394] mb-2">สตรีค</p>
            <div className="flex flex-wrap gap-2">
              {streaks.map(s => (
                <span key={s.name}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5
                    rounded-lg border border-[#2A2F3D]">
                  <Flame size={12} style={{ color: s.color }} />
                  {s.name} <b>{s.days} วัน</b>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* AI analysis */}
        <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#7C8394]">วิเคราะห์ด้วย AI</p>
            <button onClick={analyze} disabled={aiState === 'loading'}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg
                bg-[#EDEAE0] text-[#14171F] disabled:opacity-50">
              {aiState === 'loading' ? 'กำลังวิเคราะห์...'
                : `วิเคราะห์ช่วง${view === 'week' ? 'สัปดาห์' : view === 'month' ? 'เดือน' : '90 วัน'}`}
            </button>
          </div>
          {aiState === 'done' && (
            <div className="mt-3 text-sm leading-relaxed
              [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1
              [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-0.5
              [&_p]:mb-2 [&_strong]:font-semibold">
              <ReactMarkdown>{aiText}</ReactMarkdown>
            </div>
          )}
          {aiState === 'error' && (
            <p className="mt-3 text-sm text-[#E4574A]">{aiText}</p>
          )}
        </div>

        {/* body metrics */}
        <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-[#7C8394]">บันทึกร่างกาย (วันนี้)</p>
            {latestMetric?.weight_kg != null && (
              <p className="text-xs text-[#7C8394]">
                ล่าสุด {latestMetric.weight_kg} กก.
                ({new Date(latestMetric.date).toLocaleDateString('th-TH',
                  { day: 'numeric', month: 'short' })})
              </p>
            )}
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input type="number" step="0.1" placeholder="น้ำหนัก (กก.)"
              value={wForm.weight}
              onChange={e => setWForm(p => ({ ...p, weight: e.target.value }))}
              className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]"
            />
            <input type="number" step="0.5" placeholder="ส่วนสูง (ซม.)"
              value={wForm.height}
              onChange={e => setWForm(p => ({ ...p, height: e.target.value }))}
              className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]"
            />
            <button onClick={() => saveWeight(wForm)}
              className="px-4 rounded-lg bg-[#EDEAE0] text-[#14171F]
                text-sm font-semibold">บันทึก</button>
          </div>
        </div>

        {/* day drill-down */}
        {selectedDay && (
          <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium">
                {new Date(selectedDay).toLocaleDateString('th-TH',
                  { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <button onClick={() => setSelectedDay(null)}
                className="text-[#7C8394]"><X size={16} /></button>
            </div>

            {dayEntries.length === 0 && dayCompletions.length === 0 && (
              <p className="text-xs text-[#7C8394]">วันนี้ไม่มีบันทึก</p>
            )}

            {dayEntries.map(e => (
              <div key={e.id} className="border-t border-[#2A2F3D] py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm">{e.routines?.name ?? '?'}</span>
                  <input type="time" defaultValue={fmtHHMM(e.clock_in)}
                    onBlur={ev => editEntryTime(e, 'clock_in', ev.target.value)}
                    className="bg-[#14171F] border border-[#2A2F3D] rounded px-2 py-0.5
                      text-xs outline-none" />
                  <span className="text-xs text-[#7C8394]">–</span>
                  <input type="time"
                    defaultValue={e.clock_out ? fmtHHMM(e.clock_out) : ''}
                    onBlur={ev => editEntryTime(e, 'clock_out', ev.target.value)}
                    className="bg-[#14171F] border border-[#2A2F3D] rounded px-2 py-0.5
                      text-xs outline-none" />
                  <button onClick={() => deleteEntry(e.id)}
                    className="text-[#E4574A] ml-auto p-1 w-7 flex justify-center flex-shrink-0">
                    <X size={12} />
                    </button>
                </div>

                {/* topics — แก้ย้อนหลังได้เหมือนหน้า Today */}
                {e.details.map(topic => (
                  <div key={topic.id} className="ml-2 mt-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#7C8394] flex-shrink-0" />
                      <input defaultValue={topic.title}
                        onBlur={ev => ev.target.value !== topic.title && saveDetails(e.id,
                          e.details.map(t => t.id === topic.id
                            ? { ...t, title: ev.target.value } : t))}
                        className="flex-1 min-w-0 bg-transparent text-sm outline-none
                          border-b border-transparent focus:border-[#2A2F3D]" />
                      <button onClick={() => saveDetails(e.id,
                        e.details.filter(t => t.id !== topic.id))}
                        className="text-[#7C8394] p-1 w-7 flex justify-center flex-shrink-0">
                        <X size={12} />
                      </button>
                    </div>
                    {topic.subs.map(sub => (
                      <div key={sub.id} className="flex items-center gap-1.5">
                        <span className="text-[#7C8394] text-xs ml-5">•</span>
                        <input defaultValue={sub.text}
                          onBlur={ev => ev.target.value !== sub.text && saveDetails(e.id,
                            e.details.map(t => t.id === topic.id
                              ? { ...t, subs: t.subs.map(s => s.id === sub.id
                                  ? { ...s, text: ev.target.value } : s) } : t))}
                          className="flex-1 min-w-0 bg-transparent text-xs outline-none
                            border-b border-transparent focus:border-[#2A2F3D]" />
                        <button onClick={() => saveDetails(e.id,
                          e.details.map(t => t.id === topic.id
                            ? { ...t, subs: t.subs.filter(s => s.id !== sub.id) } : t))}
                          className="text-[#7C8394] p-1 w-7 flex justify-center flex-shrink-0">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}

            {dayCompletions.length > 0 && (
              <div className="border-t border-[#2A2F3D] pt-2 mt-1">
                <p className="text-xs text-[#7C8394] mb-1">
                  Checklist ({dayCompletions.length} รายการ)
                </p>
                <p className="text-xs">
                  {dayCompletions.map(c => c.routine_items?.name).filter(Boolean).join(' · ')}
                </p>
              </div>
            )}
          </div>
        )}

      </div>
    </main>
  )
}