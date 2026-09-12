'use client'

// หน้า landing ของ workout: day picker (เลือกดู/เล่นวันไหนก็ได้ ไม่ผูกกับวันนี้จริง) + การ์ดสรุปของวันที่
// เลือก + ปุ่มเริ่ม/เล่นต่อ + ประวัติย่อ — เริ่มแล้วสลับไปโชว์ WorkoutPlayer (ไม่ต้องแยก route)
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  WorkoutDayKind, WorkoutDayWithExercises, WorkoutExerciseRef, WorkoutSessionWithDay,
} from '@/lib/supabase/types'
import WorkoutPlayer, { buildSteps } from '@/components/workout/WorkoutPlayer'
import { Play, RotateCcw, X } from 'lucide-react'

// เซสชันของ "วันนี้" (date จริง) ที่ยังไม่จบ — เห็นแค่ field ที่ต้องใช้ต่อ ไม่เอาทั้งแถว
interface IncompleteSession {
  id: string
  day_id: string
  started_at: string
  exercises_done: WorkoutExerciseRef[]
  exercises_skipped: WorkoutExerciseRef[]
}

interface ActiveSession {
  id: string
  startedAtMs: number
  initialDone: WorkoutExerciseRef[]
  initialSkipped: WorkoutExerciseRef[]
}

interface Props {
  days: WorkoutDayWithExercises[]
  history: WorkoutSessionWithDay[]
  today: string
  todayWeekday: number
  incompleteSession: IncompleteSession | null
}

// ตรงกับ convention เดิมของแอป (EditRoutinePanel.tsx, CalendarPanel.tsx) — 0=อาทิตย์
const WEEKDAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

const KIND_DOT_COLOR: Record<WorkoutDayKind, string> = {
  heavy: '#F0A345', light: '#4FC1E0', rest: '#7C8394',
}

function estimateSeconds(exercises: { duration_seconds: number | null }[]): number {
  // ท่าจับเวลาใช้เวลาจริงตามที่ตั้ง ท่านับครั้งไม่มีเวลาที่แน่นอน ประมาณคร่าวๆ ที่ ~20 วิ/ท่า
  return exercises.reduce((s, e) => s + (e.duration_seconds ?? 20), 0)
}

function fmtMinutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} นาที`
}

// นับว่าเซสชันค้างไว้เหลือกี่ท่า (รวม main×rounds) เทียบกับที่ทำ/ข้ามไปแล้ว — ใช้ buildSteps ตัวเดียวกับ
// ที่ WorkoutPlayer ใช้จริงตอนเล่น กันตัวเลขไม่ตรงกันระหว่างหน้า landing กับตอนเล่นจริง
function remainingCount(day: WorkoutDayWithExercises, s: IncompleteSession): number {
  const total = buildSteps(day).filter(st => st.type === 'exercise').length
  return Math.max(0, total - s.exercises_done.length - s.exercises_skipped.length)
}

export default function WorkoutLanding({ days, history, today, todayWeekday, incompleteSession }: Props) {
  const supabase = createClient()
  const [selectedWeekday, setSelectedWeekday] = useState(todayWeekday)
  const [session, setSession] = useState<ActiveSession | null>(null)
  const [starting, setStarting] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const sortedDays = [...days].sort((a, b) => a.day_of_week - b.day_of_week)
  const day = sortedDays.find(d => d.day_of_week === selectedWeekday) ?? null

  const incompleteDay = incompleteSession
    ? sortedDays.find(d => d.id === incompleteSession.day_id) ?? null : null
  // เซสชันค้างไว้ตรงกับวันที่เลือกอยู่ตอนนี้พอดีไหม — ถ้าใช่โชว์ "เล่นต่อ" แทนปุ่มเริ่มปกติ
  const incompleteForSelectedDay = incompleteSession && day && incompleteSession.day_id === day.id
    ? incompleteSession : null
  // ถ้าเซสชันค้างไว้เป็นวันอื่น (ไม่ใช่วันที่กำลังดูอยู่) โชว์แบนเนอร์เตือนแยก กัน state ของ picker บัง
  const incompleteForOtherDay = incompleteSession && incompleteDay && !incompleteForSelectedDay
    ? incompleteSession : null

  async function startNew(targetDay: WorkoutDayWithExercises) {
    setStarting(true)
    // date = วันนี้จริงเสมอ (ตอนที่กำลัง log อยู่) แต่ day_id = โปรแกรมของ "วันที่เลือก" ในตัวเลือก —
    // เล่นโปรแกรมจันทร์ในวันเสาร์ก็ยังบันทึกว่า "เล่นจันทร์ เมื่อวันเสาร์" ให้ analyze/history อ่านถูก
    const { data } = await supabase.from('workout_sessions').insert({
      date: today, day_id: targetDay.id, started_at: new Date().toISOString(),
    }).select().single()
    setStarting(false)
    if (data) {
      setSession({
        id: data.id, startedAtMs: new Date(data.started_at).getTime(),
        initialDone: [], initialSkipped: [],
      })
    }
  }

  async function start() {
    if (!day || starting) return
    startNew(day)
  }

  function resume(s: IncompleteSession) {
    setSession({
      id: s.id, startedAtMs: new Date(s.started_at).getTime(),
      initialDone: s.exercises_done, initialSkipped: s.exercises_skipped,
    })
  }

  async function startFresh(s: IncompleteSession) {
    if (!day || starting) return
    setStarting(true)
    // ปิดเซสชันเก่าไว้ก่อน ไม่ปล่อยค้างตลอดไป — คำนวณ active_minutes/merge health_daily แบบเดียวกับ
    // จบเวิร์กเอาต์ตามปกติ (นับเวลาที่ใช้ไปจริงก่อนตัดสินใจเริ่มใหม่)
    const completedAt = new Date()
    const minutes = Math.max(0, Math.round(
      (completedAt.getTime() - new Date(s.started_at).getTime()) / 60000))
    await supabase.from('workout_sessions').update({
      completed_at: completedAt.toISOString(), active_minutes: minutes,
    }).eq('id', s.id)
    fetch('/api/workout/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: today, activeMinutes: minutes }),
    }).catch(() => {})
    setStarting(false)
    startNew(day)
  }

  function jumpAndResume() {
    if (!incompleteSession || !incompleteDay) return
    setSelectedWeekday(incompleteDay.day_of_week)
    setBannerDismissed(true)
    resume(incompleteSession)
  }

  if (session && day) {
    return (
      <WorkoutPlayer day={day} sessionId={session.id} startedAtMs={session.startedAtMs}
        today={today} initialDone={session.initialDone} initialSkipped={session.initialSkipped}
        onFinish={() => setSession(null)} />
    )
  }

  const warmup = day?.workout_exercises.filter(e => e.block === 'warmup') ?? []
  const main = day?.workout_exercises.filter(e => e.block === 'main') ?? []
  const cooldown = day?.workout_exercises.filter(e => e.block === 'cooldown') ?? []

  return (
    <main className="min-h-screen bg-[#14171F] text-[#EDEAE0] pb-16">
      <div className="max-w-lg mx-auto px-4 pt-8">
        <h1 className="text-xl font-semibold mb-4">ออกกำลังกาย</h1>

        {incompleteForOtherDay && !bannerDismissed && (
          <div className="bg-[#1B1F2A] border border-[#F0A345] rounded-xl p-3 mb-4
            flex items-center gap-2">
            <p className="text-xs flex-1 min-w-0">
              มีเซสชันค้างไว้: <span className="font-medium">{incompleteDay?.label}</span> — เล่นต่อ?
            </p>
            <button onClick={jumpAndResume}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#F0A345] text-[#14171F]
                flex-shrink-0">
              เล่นต่อ
            </button>
            <button onClick={() => setBannerDismissed(true)}
              className="text-[#7C8394] p-1 flex-shrink-0"><X size={14} /></button>
          </div>
        )}

        {/* day picker — เลือกดู/เล่นวันอื่นได้ ไม่กระทบว่า "วันนี้" ของ dashboard/ประวัติคือวันไหน */}
        <div className="flex gap-1.5 mb-4 overflow-x-auto">
          {sortedDays.map(d => {
            const active = d.day_of_week === selectedWeekday
            const isToday = d.day_of_week === todayWeekday
            return (
              <button key={d.day_of_week} onClick={() => setSelectedWeekday(d.day_of_week)}
                className={`flex flex-col items-center justify-center gap-1 w-11 h-14 flex-shrink-0
                  rounded-xl transition-colors
                  ${active ? 'bg-[#EDEAE0] text-[#14171F]' : 'bg-[#1B1F2A] text-[#EDEAE0]'}
                  ${!active && isToday ? 'ring-1 ring-[#4FC1E0]' : ''}
                  ${!active ? 'border border-[#2A2F3D]' : ''}`}>
                <span className="text-xs font-semibold">{WEEKDAY_LABELS[d.day_of_week]}</span>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: KIND_DOT_COLOR[d.kind] }} />
              </button>
            )
          })}
        </div>

        <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-5 mb-4">
          {!day || day.kind === 'rest' ? (
            <>
              <p className="text-sm font-medium mb-1">{day?.label ?? '—'}</p>
              <p className="text-sm text-[#7C8394]">
                {selectedWeekday === todayWeekday
                  ? 'วันนี้วันพัก — เดินเช้าตามสบาย' : 'วันพัก — เดินเช้าตามสบาย'}
              </p>
            </>
          ) : day.kind === 'light' ? (
            <>
              <p className="text-sm font-medium mb-1">{day.label}</p>
              <p className="text-xs text-[#7C8394] mb-4">คูลดาวน์/ยืดเหยียด {cooldown.length} ท่า
                {' '}· ประมาณ {fmtMinutes(estimateSeconds(cooldown))}</p>
              {incompleteForSelectedDay ? (
                <div className="flex gap-2">
                  <button onClick={() => resume(incompleteForSelectedDay)} disabled={starting}
                    className="flex-1 min-h-[48px] rounded-xl bg-[#4FC1E0] text-[#14171F]
                      text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                    <Play size={16} /> เล่นต่อ (ค้างไว้ {remainingCount(day, incompleteForSelectedDay)} ท่า)
                  </button>
                  <button onClick={() => startFresh(incompleteForSelectedDay)} disabled={starting}
                    title="เริ่มใหม่ (ทิ้งความคืบหน้าเดิม)"
                    className="min-h-[48px] px-3 rounded-xl border border-[#2A2F3D] text-[#7C8394]
                      disabled:opacity-50">
                    <RotateCcw size={16} />
                  </button>
                </div>
              ) : (
                <button onClick={start} disabled={starting}
                  className="w-full min-h-[48px] rounded-xl bg-[#4FC1E0] text-[#14171F]
                    text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  <Play size={16} /> เริ่ม
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-sm font-medium mb-1">{day.label}</p>
              <p className="text-xs text-[#7C8394] mb-3">
                วอร์มอัพ {warmup.length} ท่า · Circuit {main.length} ท่า × {day.rounds} รอบ
                {' '}· คูลดาวน์ {cooldown.length} ท่า
              </p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                <span className="text-[10px] px-2 py-1 rounded-full border border-[#2A2F3D] text-[#7C8394]">
                  วอร์มอัพ ~{fmtMinutes(estimateSeconds(warmup))}
                </span>
                <span className="text-[10px] px-2 py-1 rounded-full border border-[#2A2F3D] text-[#7C8394]">
                  Circuit ~{fmtMinutes(
                    estimateSeconds(main) * day.rounds +
                    (main.length > 1 ? (main.length - 1) * day.exercise_rest_seconds * day.rounds : 0) +
                    (day.rounds > 1 ? (day.rounds - 1) * day.round_rest_seconds : 0)
                  )}
                </span>
                <span className="text-[10px] px-2 py-1 rounded-full border border-[#2A2F3D] text-[#7C8394]">
                  คูลดาวน์ ~{fmtMinutes(estimateSeconds(cooldown))}
                </span>
              </div>
              {incompleteForSelectedDay ? (
                <div className="flex gap-2">
                  <button onClick={() => resume(incompleteForSelectedDay)} disabled={starting}
                    className="flex-1 min-h-[48px] rounded-xl bg-[#4FC1E0] text-[#14171F]
                      text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                    <Play size={16} /> เล่นต่อ (ค้างไว้ {remainingCount(day, incompleteForSelectedDay)} ท่า)
                  </button>
                  <button onClick={() => startFresh(incompleteForSelectedDay)} disabled={starting}
                    title="เริ่มใหม่ (ทิ้งความคืบหน้าเดิม)"
                    className="min-h-[48px] px-3 rounded-xl border border-[#2A2F3D] text-[#7C8394]
                      disabled:opacity-50">
                    <RotateCcw size={16} />
                  </button>
                </div>
              ) : (
                <button onClick={start} disabled={starting}
                  className="w-full min-h-[48px] rounded-xl bg-[#4FC1E0] text-[#14171F]
                    text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  <Play size={16} /> เริ่มออกกำลังกาย
                </button>
              )}
            </>
          )}
        </div>

        {history.length > 0 && (
          <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4">
            <p className="text-xs text-[#7C8394] mb-2">ประวัติล่าสุด</p>
            <div className="space-y-1.5">
              {history.map(s => (
                <div key={s.id} className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-[#7C8394] w-20 flex-shrink-0 tabular-nums">
                    {new Date(s.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[#7C8394]">
                    {s.workout_days?.label ?? '?'}
                  </span>
                  {s.completed_at ? (
                    <span className="text-[#4FC1E0] text-xs flex-shrink-0">
                      ✓ {s.active_minutes ?? '?'} นาที
                    </span>
                  ) : (
                    <span className="text-[#7C8394] text-xs flex-shrink-0">ยังไม่จบ</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
