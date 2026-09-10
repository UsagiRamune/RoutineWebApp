'use client'

// จับเวลาทำงานต่อ task: ▶ เริ่ม/■ หยุด (นาฬิกาเดินสดระหว่างจับ) + ทางเลือกกรอกนาทีเองสำหรับ backfill
// รันได้ log เดียวต่อ task พร้อมกัน (running = log ล่าสุดที่มี clock_in แต่ยังไม่มี clock_out)
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { todayKey } from '@/lib/dates'
import { ProjectWorkLog } from '@/lib/supabase/types'
import { Play, Square, Clock } from 'lucide-react'

interface Props {
  taskId: string
  workLogs: ProjectWorkLog[]
}

function fmtElapsed(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000))
  const h = String(Math.floor(secs / 3600)).padStart(2, '0')
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0')
  const s = String(secs % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

export default function TaskWorkLog({ taskId, workLogs }: Props) {
  const supabase = createClient()

  const serverRunning = workLogs
    .filter(l => l.clock_in && !l.clock_out)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  // undefined = ยังไม่มี optimistic override ให้ยึดตามข้อมูลจาก server; null/object = ผู้ใช้เพิ่งกดเอง
  // รอ realtime refresh ยืนยันอีกที (กันจอกระพริบระหว่างกดปุ่มกับ DB เขียนเสร็จ)
  const [localRunning, setLocalRunning] = useState<ProjectWorkLog | null | undefined>(undefined)
  const running = localRunning !== undefined ? localRunning : serverRunning

  // นาฬิกาเดินสด — เริ่ม null เสมอ (server/client render รอบแรกต้องตรงกัน กัน hydration mismatch)
  // ค่อยตั้งเวลาจริงใน useEffect ซึ่งรันฝั่ง client เท่านั้น เหมือน timer อื่นๆ ในแอปนี้
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (!running) { setNow(null); return }
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running?.id])

  const [manualOpen, setManualOpen] = useState(false)
  const [minutes, setMinutes] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function start() {
    if (running || busy) return
    setBusy(true)
    const { data } = await supabase.from('project_work_logs').insert({
      task_id: taskId, date: todayKey(), clock_in: new Date().toISOString(), clock_out: null, minutes: null,
    }).select().single()
    if (data) setLocalRunning(data as ProjectWorkLog)
    setBusy(false)
  }

  async function stop() {
    if (!running || busy) return
    setBusy(true)
    const mins = Math.max(1, Math.round((Date.now() - new Date(running.clock_in!).getTime()) / 60000))
    await supabase.from('project_work_logs').update({
      clock_out: new Date().toISOString(), minutes: mins,
    }).eq('id', running.id)
    setLocalRunning(null)
    setBusy(false)
  }

  async function saveManual() {
    const mins = parseInt(minutes, 10)
    if (!mins || mins <= 0) return
    await supabase.from('project_work_logs').insert({
      task_id: taskId, date: todayKey(), minutes: mins, note: note.trim() || null,
    })
    setMinutes('')
    setNote('')
    setManualOpen(false)
  }

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
      {running ? (
        <button onClick={stop} disabled={busy}
          className="flex items-center gap-1 text-[10px] text-[#F0A345] px-1.5 py-0.5 rounded-full
            border border-[#F0A345] disabled:opacity-50 tabular-nums">
          <Square size={9} fill="currentColor" />
          {now !== null ? fmtElapsed(now - new Date(running.clock_in!).getTime()) : '00:00:00'}
        </button>
      ) : (
        <button onClick={start} disabled={busy}
          className="flex items-center gap-1 text-[10px] text-[#7C8394] p-1 disabled:opacity-50">
          <Play size={11} /> เริ่มจับเวลา
        </button>
      )}

      {!manualOpen ? (
        <button onClick={() => setManualOpen(true)}
          className="flex items-center gap-1 text-[10px] text-[#7C8394] p-1">
          <Clock size={11} /> กรอกเวลาเอง
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <input type="number" min={1} autoFocus value={minutes} placeholder="นาที"
            onChange={e => setMinutes(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveManual()}
            className="w-14 bg-[#14171F] border border-[#2A2F3D] rounded-lg px-1.5 py-1 text-xs outline-none" />
          <input value={note} placeholder="โน้ต (ไม่บังคับ)"
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveManual()}
            className="w-24 bg-[#14171F] border border-[#2A2F3D] rounded-lg px-1.5 py-1 text-xs outline-none" />
          <button onClick={saveManual} className="text-[10px] text-[#4FC1E0] px-1">บันทึก</button>
          <button onClick={() => setManualOpen(false)} className="text-[10px] text-[#7C8394] px-1">ยกเลิก</button>
        </div>
      )}
    </div>
  )
}
