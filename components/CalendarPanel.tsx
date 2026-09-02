'use client'

// แผงปฏิทิน: อีเวนต์ 7 วันข้างหน้า + เพิ่ม/ลบ (sync ตรงกับ Google Calendar)
import { useEffect, useState, useCallback } from 'react'
import { CalendarDays, CheckSquare, Plus, X } from 'lucide-react'

interface CalEvent {
  id: string
  title: string
  start: string
  allDay: boolean
  calendarName?: string
  calendarId?: string
}

interface GTask {
  id: string
  listId: string
  listName: string
  title: string
  notes: string
  due: string
}

export default function CalendarPanel() {
  const [state, setState] =
    useState<'loading' | 'notConnected' | 'ready' | 'error'>('loading')
  const [events, setEvents] = useState<CalEvent[]>([])
  const [tasks, setTasks] = useState<GTask[]>([])
  const [taskLists, setTaskLists] = useState<{ id: string; name: string }[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    title: '', date: '', time: '', description: '',
    kind: 'event' as 'event' | 'task', listId: '',
    repeat: 'none', repeatUntil: '',
  })
  const [days, setDays] = useState(7)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/calendar?days=${days}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (!data.connected) { setState('notConnected'); return }
      setEvents(data.events)
      setTasks(data.tasks ?? [])
      setTaskLists(data.taskLists ?? [])
      setState('ready')
    } catch {
      setState('error')
    }
  }, [days])

  useEffect(() => { load() }, [load])

  // ตั้ง task list เริ่มต้นให้เองเมื่อโหลดมาแล้วแต่ยังไม่ได้เลือก
  useEffect(() => {
    if (taskLists.length > 0 && !form.listId)
      setForm(p => ({ ...p, listId: taskLists[0].id }))
  }, [taskLists, form.listId])

  async function addEvent() {
    if (!form.title.trim() || !form.date) return
    await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        form.kind === 'task'
          ? {
              kind: 'task',
              title: form.title.trim(),
              date: form.date,
              description: form.description || undefined,
              listId: form.listId || undefined,
            }
          : {
              title: form.title.trim(),
              date: form.date,
              time: form.time || undefined,
              repeat: form.repeat,
              repeatUntil: form.repeatUntil || undefined,
            }
      ),
    })
    setForm(p => ({
      ...p, title: '', date: '', time: '', description: '',
      repeat: 'none', repeatUntil: '',
    }))
    setAdding(false)
    load()
  }

  async function completeTask(t: GTask) {
    setTasks(p => p.filter(x => x.id !== t.id)) // หายจากจอทันที ไม่รอ Google
    await fetch('/api/calendar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: t.id, listId: t.listId }),
    })
  }

  async function removeEvent(id: string) {
    if (!confirm('ลบอีเวนต์นี้ออกจาก Google Calendar?')) return
    await fetch('/api/calendar', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: id }),
    })
    load()
  }

  function fmtEvent(e: CalEvent) {
    const d = new Date(e.start)
    const day = d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })
    if (e.allDay) return day
    return `${day} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`
  }

  function fmtTaskDue(due: string) {
    return new Date(due).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  const inputCls = 'bg-[#14171F] border border-[#2A2F3D] rounded-lg px-2 py-1.5 text-xs outline-none'

  if (state === 'loading') return null

  return (
    <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-[#7C8394] flex items-center gap-1.5">
          <CalendarDays size={13} /> ปฏิทิน
        </p>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-[#2A2F3D] overflow-hidden text-[10px]">
            {[7, 30].map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-2 py-1 ${days === d
                  ? 'bg-[#EDEAE0] text-[#14171F] font-semibold'
                  : 'text-[#7C8394]'}`}>
                {d === 7 ? '7 วัน' : 'เดือน'}
              </button>
            ))}
          </div>
          {state === 'ready' && (
            <button onClick={() => setAdding(a => !a)}
              className="text-[#7C8394]"><Plus size={14} /></button>
          )}
        </div>
      </div>

      {state === 'notConnected' && (
        <a href="/api/calendar/auth"
          className="block text-center text-sm font-semibold rounded-lg
            border border-[#2A2F3D] py-2 mt-2">
          เชื่อม Google Calendar
        </a>
      )}
      {state === 'error' && (
        <p className="text-xs text-[#E4574A] mt-1">
          ดึงปฏิทินไม่สำเร็จ — <a href="/api/calendar/auth" className="underline">เชื่อมใหม่</a>
        </p>
      )}

      {state === 'ready' && (
        <>
          {tasks.length === 0 && events.length === 0 && (
            <p className="text-xs text-[#7C8394] mt-1">ว่าง ไม่มีอีเวนต์ 7 วันนี้</p>
          )}
          {tasks.map(t => (
            <div key={t.id} className="flex items-center gap-2 py-1">
              <button onClick={() => completeTask(t)} title="ทำเสร็จแล้ว"
                className="text-[#7C8394] hover:text-[#4FC1E0] flex-shrink-0">
                <CheckSquare size={14} />
              </button>
              <span className="text-xs text-[#7C8394] w-24 flex-shrink-0 tabular-nums">
                {fmtTaskDue(t.due)}
              </span>
              <span className="text-sm flex-1 min-w-0 truncate">
                {t.title}
                <span className="text-[10px] text-[#7C8394] ml-1.5">☑ {t.listName}</span>
              </span>
            </div>
          ))}
          {events.map(e => (
            <div key={e.id} className="flex items-center gap-2 py-1">
              <span className="text-xs text-[#7C8394] w-28 flex-shrink-0 tabular-nums">
                {fmtEvent(e)}
              </span>
              <span className="text-sm flex-1 min-w-0 truncate">
                {e.title}
                {e.calendarName && e.calendarId !== 'primary' && (
                  <span className="text-[10px] text-[#7C8394] ml-1.5">({e.calendarName})</span>
                )}
                </span>
              <button onClick={() => removeEvent(e.id)}
                className="text-[#7C8394] p-1 w-7 flex justify-center flex-shrink-0">
                <X size={12} />
              </button>
            </div>
          ))}

          {adding && (
            <div className="mt-2 space-y-2">
              <div className="flex rounded-md border border-[#2A2F3D] overflow-hidden text-[10px] w-fit">
                {(['event', 'task'] as const).map(k => (
                  <button key={k} onClick={() => setForm(p => ({ ...p, kind: k }))}
                    className={`px-2 py-1 ${form.kind === k
                      ? 'bg-[#EDEAE0] text-[#14171F] font-semibold'
                      : 'text-[#7C8394]'}`}>
                    {k === 'event' ? 'กิจกรรม' : 'Task'}
                  </button>
                ))}
              </div>

              {form.kind === 'event' ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2">
                    <input placeholder="ชื่ออีเวนต์..." value={form.title}
                      onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                      className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                        px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]" />
                    <input type="date" value={form.date}
                      onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                      className="bg-[#14171F] border border-[#2A2F3D] rounded-lg
                        px-2 py-1.5 text-xs outline-none" />
                    <input type="time" value={form.time}
                      onChange={e => setForm(p => ({ ...p, time: e.target.value }))}
                      className="bg-[#14171F] border border-[#2A2F3D] rounded-lg
                        px-2 py-1.5 text-xs outline-none" />
                    <button onClick={addEvent}
                      className="px-3 rounded-lg bg-[#EDEAE0] text-[#14171F]
                        text-xs font-semibold">เพิ่ม</button>
                  </div>
                  <div className="grid grid-cols-[1fr_1fr] gap-2">
                    <select value={form.repeat}
                      onChange={e => setForm(p => ({ ...p, repeat: e.target.value }))}
                      className={inputCls}>
                      <option value="none">ไม่ทำซ้ำ</option>
                      <option value="daily">ทุกวัน</option>
                      <option value="weekly">ทุกสัปดาห์ (วันเดียวกับวันที่เลือก)</option>
                      <option value="monthly">ทุกเดือน</option>
                    </select>
                    <input type="date" value={form.repeatUntil}
                      disabled={form.repeat === 'none'}
                      onChange={e => setForm(p => ({ ...p, repeatUntil: e.target.value }))}
                      title="ทำซ้ำจนถึงวันนี้ (เว้นว่าง = ไม่มีวันจบ)"
                      className={`${inputCls} disabled:opacity-40`} />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input placeholder="ชื่อ Task..." value={form.title}
                      onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                      className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                        px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]" />
                    <input type="date" value={form.date}
                      onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                      className="bg-[#14171F] border border-[#2A2F3D] rounded-lg
                        px-2 py-1.5 text-xs outline-none" />
                  </div>
                  <input placeholder="รายละเอียด (ถ้ามี)..." value={form.description}
                    onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg
                      px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]" />
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <select value={form.listId}
                      onChange={e => setForm(p => ({ ...p, listId: e.target.value }))}
                      className="min-w-0 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                        px-2 py-1.5 text-xs outline-none">
                      {taskLists.map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                    <button onClick={addEvent}
                      className="px-3 rounded-lg bg-[#EDEAE0] text-[#14171F]
                        text-xs font-semibold">เพิ่ม</button>
                  </div>
                  <p className="text-[10px] text-[#7C8394]">
                    Task ระบุได้แค่วัน ไม่มีเวลา (ข้อจำกัดของ Google Tasks)
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}