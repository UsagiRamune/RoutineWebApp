'use client'

// UI หน้า "วันนี้" — checklist (optimistic), timer + session พร้อม timestamp,
// รายละเอียดแบบ topic/subtopic เพิ่มลบอิสระ
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  CategoryWithRoutines, TimeEntry, DetailTopic,
} from '@/lib/supabase/types'
import { LogOut, Play, Square, History, Plus, X, Pencil } from 'lucide-react'
import Link from 'next/link'
import EditRoutinePanel from '@/components/EditRoutinePanel'
import CalendarPanel from '@/components/CalendarPanel'
import { TZ } from '@/lib/dates'

interface Props {
  categories: CategoryWithRoutines[]
  today: string
}

export default function TodayView({ categories, today }: Props) {
  const router = useRouter()
  const supabase = createClient()

  // นาฬิกาเดินทุกวินาที
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // ---------- optimistic checklist ----------
  // เก็บสถานะติ๊ก "ทับ" ข้อมูลจาก server: กดปุ๊บเปลี่ยนปุ๊บ ไม่รอฐานข้อมูล
  const [optimisticTicks, setOptimisticTicks] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<string | null>(null) // id ของ routine ที่กำลังแก้
  const [newName, setNewName] = useState<Record<string, string>>({}) // ช่องเพิ่ม routine ต่อหมวด

  function isDone(itemId: string, serverDone: boolean) {
    return optimisticTicks[itemId] ?? serverDone
  }

  async function toggleItem(itemId: string, currentlyDone: boolean) {
    setOptimisticTicks((p) => ({ ...p, [itemId]: !currentlyDone })) // จอเปลี่ยนทันที
    if (currentlyDone) {
      await supabase.from('item_completions')
        .delete().eq('routine_item_id', itemId).eq('date', today)
    } else {
      await supabase.from('item_completions')
        .insert({ routine_item_id: itemId, date: today })
    }
    // ไม่ต้อง router.refresh() เอง — RealtimeRefresher จัดการให้
  }

  // ---------- time helpers ----------

  function fmtClock(iso: string) {
    return new Date(iso).toLocaleTimeString('th-TH', {
      hour: '2-digit', minute: '2-digit', timeZone: TZ,
    })
  }

  function fmtRunning(e: TimeEntry) {
    const secs = Math.max(0, Math.floor((now - new Date(e.clock_in).getTime()) / 1000))
    const h = String(Math.floor(secs / 3600)).padStart(2, '0')
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0')
    const s = String(secs % 60).padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  function minutesOfEntry(e: TimeEntry) {
    const start = new Date(e.clock_in).getTime()
    const end = e.clock_out ? new Date(e.clock_out).getTime() : now
    return Math.max(0, Math.floor((end - start) / 60000))
  }

  function fmtDuration(mins: number) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`
  }

  // ---------- timer actions ----------

  async function clockIn(routineId: string) {
    await supabase.from('time_entries').insert({ routine_id: routineId, date: today })
  }

  async function clockOut(entryId: string) {
    await supabase.from('time_entries')
      .update({ clock_out: new Date().toISOString() }).eq('id', entryId)
  }

  async function addRoutine(categoryId: string) {
    const name = (newName[categoryId] ?? '').trim()
    if (!name) return
    await supabase.from('routines').insert({ category_id: categoryId, name })
    setNewName((p) => ({ ...p, [categoryId]: '' }))
  }

  // ---------- details (topic/subtopic) ----------

  async function saveDetails(entryId: string, details: DetailTopic[]) {
    await supabase.from('time_entries').update({ details }).eq('id', entryId)
  }

  function addTopic(e: TimeEntry) {
    saveDetails(e.id, [
      ...e.details,
      { id: crypto.randomUUID(), title: '', subs: [] },
    ])
  }

  function editTopic(e: TimeEntry, topicId: string, title: string) {
    saveDetails(e.id, e.details.map(t => t.id === topicId ? { ...t, title } : t))
  }

  function removeTopic(e: TimeEntry, topicId: string) {
    saveDetails(e.id, e.details.filter(t => t.id !== topicId))
  }

  function addSub(e: TimeEntry, topicId: string) {
    saveDetails(e.id, e.details.map(t =>
      t.id === topicId
        ? { ...t, subs: [...t.subs, { id: crypto.randomUUID(), text: '' }] }
        : t
    ))
  }

  function editSub(e: TimeEntry, topicId: string, subId: string, text: string) {
    saveDetails(e.id, e.details.map(t =>
      t.id === topicId
        ? { ...t, subs: t.subs.map(s => s.id === subId ? { ...s, text } : s) }
        : t
    ))
  }

  function removeSub(e: TimeEntry, topicId: string, subId: string) {
    saveDetails(e.id, e.details.map(t =>
      t.id === topicId
        ? { ...t, subs: t.subs.filter(s => s.id !== subId) }
        : t
    ))
  }

  async function logout() {
    await supabase.auth.signOut({ scope: 'local' })
    router.push('/login')
  }

  // ---------- render ----------

  const dateLabel = new Date().toLocaleDateString('th-TH', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ,
  })

  return (
    <main className="min-h-screen bg-[#14171F] text-[#EDEAE0] pb-16">
      <div className="max-w-lg mx-auto px-4 pt-8">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold">วันนี้</h1>
            <p className="text-sm text-[#7C8394]">{dateLabel}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/history"
              className="p-2 rounded-lg border border-[#2A2F3D] text-[#7C8394]">
              <History size={18} />
            </Link>
            <button onClick={logout}
              className="p-2 rounded-lg border border-[#2A2F3D] text-[#7C8394]">
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <CalendarPanel />

        {categories.map((cat) => (
          <section key={cat.id} className="mb-8">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: cat.color }} />
              {cat.name}
            </h2>

            {cat.routines.filter(r => r.is_active).map((routine) => {

              // ---- checklist ----
              if (cat.kind === 'checklist') {
                const items = routine.routine_items.filter(i => i.is_active)
                return (
                  <div key={routine.id}
                    className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-3">
                    <div className="flex items-center gap-2 mb-3">
                      <p className="font-medium text-sm">{routine.name}</p>
                      <button onClick={() => setEditing(editing === routine.id ? null : routine.id)}
                        className="text-[#7C8394]"><Pencil size={12} /></button>
                    </div>
                    {items.map((item) => {
                      const serverDone = item.item_completions?.some(
                        (c) => c.date === today
                      ) ?? false
                      const done = isDone(item.id, serverDone)
                      return (
                        <button key={item.id}
                          onClick={() => toggleItem(item.id, done)}
                          className="w-full flex items-center gap-3 py-2 text-left">
                          <span className={`w-5 h-5 rounded-md border-2 flex-shrink-0
                            flex items-center justify-center text-xs
                            ${done ? 'border-transparent text-[#14171F]' : 'border-[#7C8394]'}`}
                            style={done ? { background: cat.color } : {}}>
                            {done && '✓'}
                          </span>
                          <span className={`text-sm ${done ? 'text-[#7C8394] line-through' : ''}`}>
                            {item.name}
                            {item.detail && (
                              <span className="text-[#7C8394] ml-2 text-xs">{item.detail}</span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                    {editing === routine.id && (
                      <EditRoutinePanel routine={routine} kind={cat.kind}
                        today={today} onClose={() => setEditing(null)} />
                    )}
                  </div>
                )
              }

              // ---- timed ----
              const todayEntries = routine.time_entries
                .filter(e => e.date === today)
                .sort((a, b) => a.clock_in.localeCompare(b.clock_in))
              const running = todayEntries.find(e => !e.clock_out)
              const totalMins = todayEntries.reduce((s, e) => s + minutesOfEntry(e), 0)
              const target = routine.daily_targets.find(t => t.date === today)
              const targetMins = target?.target_minutes ?? null

              return (
                <div key={routine.id}
                  className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-3">

                  {/* หัว: ชื่อ + timer ใหญ่ + ปุ่มเดียว */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{routine.name}</p>
                      <button onClick={() => setEditing(editing === routine.id ? null : routine.id)}
                        className="text-[#7C8394]"><Pencil size={12} /></button>
                    </div>
                    {running ? (
                      <button onClick={() => clockOut(running.id)}
                        className="flex items-center gap-2 text-sm font-semibold
                          px-3 py-1.5 rounded-lg text-[#14171F] tabular-nums"
                        style={{ background: cat.color }}>
                        <Square size={12} /> {fmtRunning(running)}
                      </button>
                    ) : (
                      <button onClick={() => clockIn(routine.id)}
                        className="flex items-center gap-1.5 text-xs font-semibold
                          px-3 py-1.5 rounded-lg border border-[#2A2F3D]">
                        <Play size={12} /> เริ่มจับเวลา
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-[#7C8394] mb-2">
                    รวมวันนี้ {fmtDuration(totalMins)}
                    {targetMins !== null && ` / เป้า ${fmtDuration(targetMins)}`}
                  </p>

                  {targetMins !== null && targetMins > 0 && (
                    <div className="h-1.5 bg-[#14171F] rounded-full overflow-hidden mb-3">
                      <div className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, (totalMins / targetMins) * 100)}%`,
                          background: cat.color,
                        }} />
                    </div>
                  )}

                  {/* sessions: timestamp เริ่ม-จบ + details */}
                  {todayEntries.map((e) => (
                    <div key={e.id}
                      className="border-t border-[#2A2F3D] pt-2 mt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#7C8394] tabular-nums">
                          {fmtClock(e.clock_in)}
                          {' – '}
                          {e.clock_out ? fmtClock(e.clock_out) : 'กำลังจับ...'}
                          <span className="ml-2">({fmtDuration(minutesOfEntry(e))})</span>
                        </span>
                        <button onClick={() => addTopic(e)}
                          className="flex items-center gap-1 text-xs text-[#7C8394]">
                          <Plus size={12} /> หัวข้อ
                        </button>
                      </div>

                      {e.details.map((topic) => (
                        <div key={topic.id} className="mt-1.5 ml-1">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ background: cat.color }} />
                            <input
                              defaultValue={topic.title}
                              placeholder="หัวข้อ..."
                              onBlur={(ev) => {
                                if (ev.target.value !== topic.title)
                                  editTopic(e, topic.id, ev.target.value)
                              }}
                              className="flex-1 bg-transparent text-sm outline-none
                                border-b border-transparent focus:border-[#2A2F3D] py-0.5"
                            />
                            <button onClick={() => addSub(e, topic.id)}
                              className="text-[#7C8394] p-1"><Plus size={12} /></button>
                            <button onClick={() => removeTopic(e, topic.id)}
                              className="text-[#7C8394] p-1"><X size={12} /></button>
                          </div>

                          {topic.subs.map((sub) => (
                            <div key={sub.id} className="flex items-center gap-1.5 ml-5 mt-0.5">
                              <span className="text-[#7C8394] text-xs">•</span>
                              <input
                                defaultValue={sub.text}
                                placeholder="รายละเอียดย่อย..."
                                onBlur={(ev) => {
                                  if (ev.target.value !== sub.text)
                                    editSub(e, topic.id, sub.id, ev.target.value)
                                }}
                                className="flex-1 bg-transparent text-xs outline-none
                                  border-b border-transparent focus:border-[#2A2F3D] py-0.5"
                              />
                              <button onClick={() => removeSub(e, topic.id, sub.id)}
                                className="text-[#7C8394] p-1"><X size={12} /></button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ))}
                  {editing === routine.id && (
                    <EditRoutinePanel routine={routine} kind={cat.kind}
                      today={today} onClose={() => setEditing(null)} />
                  )}
                </div>
              )
            })}

            <div className="flex gap-2">
              <input
                value={newName[cat.id] ?? ''}
                onChange={(e) => setNewName((p) => ({ ...p, [cat.id]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addRoutine(cat.id)}
                placeholder={`+ เพิ่ม routine ใน${cat.name}...`}
                className="flex-1 bg-transparent border border-dashed border-[#2A2F3D]
                  rounded-xl px-4 py-2.5 text-sm outline-none
                  focus:border-[#7C8394] placeholder:text-[#7C8394]" />
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}