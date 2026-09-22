'use client'

// หน้า landing ของ workout: day picker (เลือกดู/เล่นวันไหนก็ได้ ไม่ผูกกับวันนี้จริง) + สอง card น้ำหนักเท่ากัน
// "เช้า"/"เย็น" + ประวัติล่าสุด — เริ่มแล้วสลับไปโชว์ WorkoutPlayer (ไม่ต้องแยก route)
// เช้า ใช้ MorningWalkSection.tsx ตัวเดียวกับที่ /morning-walk ใช้ (ไม่มี logic ซ้ำ — ดู #6 ในงาน redesign)
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  WorkoutDayWithExercises, WorkoutExerciseRef, WorkoutSessionWithDay,
  MorningWalkCheck, MorningWalkExercise,
} from '@/lib/supabase/types'
import WorkoutPlayer, { buildSteps } from '@/components/workout/WorkoutPlayer'
import MorningWalkSection from '@/components/morningwalk/MorningWalkSection'
import DayChip from '@/components/ui/DayChip'
import BlockRow from '@/components/workout/BlockRow'
import { Play, RotateCcw, X, Trash2 } from 'lucide-react'

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
  morningConnected: boolean
  morningCheck: MorningWalkCheck | null
  warmupExercises: MorningWalkExercise[]
  cooldownExercises: MorningWalkExercise[]
}

// ตรงกับ convention เดิมของแอป (EditRoutinePanel.tsx, CalendarPanel.tsx) — 0=อาทิตย์
const WEEKDAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const EVENING_ACCENT = '#F0A345' // เย็น = ส้ม ตาม spec (เช้า = ฟ้า อยู่ใน MorningWalkSection.tsx)
const COMPLETED_COLOR = '#6FCF7A' // เขียวจาง — ไม่เคยมี "เขียว" จริงในแอปมาก่อน (เช็คทั้งโค้ดแล้ว) เพิ่งตั้งค่าใหม่
// ตามที่ขอชัดเจนรอบนี้ ("muted green") บันทึกไว้ใน design.md แล้วให้เป็นค่าประจำต่อไป

function estimateSeconds(exercises: { duration_seconds: number | null }[]): number {
  // ท่าจับเวลาใช้เวลาจริงตามที่ตั้ง ท่านับครั้งไม่มีเวลาที่แน่นอน ประมาณคร่าวๆ ที่ ~20 วิ/ท่า
  return exercises.reduce((s, e) => s + (e.duration_seconds ?? 20), 0)
}

function fmtMinutes(seconds: number): string {
  return `~${Math.max(1, Math.round(seconds / 60))} นาที`
}

// นับว่าเซสชันค้างไว้เหลือกี่ท่า (รวม main×rounds) เทียบกับที่ทำ/ข้ามไปแล้ว — ใช้ buildSteps ตัวเดียวกับ
// ที่ WorkoutPlayer ใช้จริงตอนเล่น กันตัวเลขไม่ตรงกันระหว่างหน้า landing กับตอนเล่นจริง
function remainingCount(day: WorkoutDayWithExercises, s: IncompleteSession): number {
  const total = buildSteps(day).filter(st => st.type === 'exercise').length
  return Math.max(0, total - s.exercises_done.length - s.exercises_skipped.length)
}

export default function WorkoutLanding({
  days, history, today, todayWeekday, incompleteSession,
  morningConnected, morningCheck, warmupExercises, cooldownExercises,
}: Props) {
  const supabase = createClient()
  const [selectedWeekday, setSelectedWeekday] = useState(todayWeekday)
  const [session, setSession] = useState<ActiveSession | null>(null)
  const [starting, setStarting] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  // ลบแบบ optimistic ทันที (ไม่รอ realtime round-trip) — RealtimeRefresher จะ sync ของจริงตามมาอยู่แล้ว
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())

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

  async function deleteSession(id: string) {
    if (!confirm('ลบ session นี้เลยไหม?')) return
    setDeletedIds(prev => new Set(prev).add(id))
    const res = await fetch('/api/workout/session', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      // ลบไม่สำเร็จ (เช่น server เช็คแล้วว่าจบไปแล้วจริงๆ) เอากลับมาโชว์เหมือนเดิม
      setDeletedIds(prev => { const next = new Set(prev); next.delete(id); return next })
      const data = await res.json().catch(() => ({}))
      alert(data.error ?? 'ลบไม่สำเร็จ')
    }
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
  const circuitSeconds = day
    ? estimateSeconds(main) * day.rounds +
      (main.length > 1 ? (main.length - 1) * day.exercise_rest_seconds * day.rounds : 0) +
      (day.rounds > 1 ? (day.rounds - 1) * day.round_rest_seconds : 0)
    : 0

  const visibleHistory = history.filter(s => !deletedIds.has(s.id))

  return (
    <main className="min-h-screen bg-[#171412] text-[#EDEAE0] pb-16">
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <h1 className="text-xl font-semibold mb-4">ออกกำลังกาย</h1>

        {incompleteForOtherDay && !bannerDismissed && (
          <div className="bg-[#201C19] border border-[#F0A345] rounded-xl p-3 mb-4
            flex items-center gap-2">
            <p className="text-xs flex-1 min-w-0">
              มีเซสชันค้างไว้: <span className="font-medium">{incompleteDay?.label}</span> — เล่นต่อ?
            </p>
            <button onClick={jumpAndResume}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#F0A345] text-[#171412]
                flex-shrink-0">
              เล่นต่อ
            </button>
            <button onClick={() => setBannerDismissed(true)}
              className="text-[#8A8178] p-1 flex-shrink-0"><X size={14} /></button>
          </div>
        )}

        {/* day picker — 5-state เดียวกับ CalendarPanel.tsx (today ทึบ/selected เป็นวงแหวน/ปกติจาง)
            เลือกดู/เล่นวันอื่นได้ ไม่กระทบว่า "วันนี้" ของ dashboard/ประวัติคือวันไหน — คุมแค่การ์ด "เย็น" */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {sortedDays.map(d => (
            <div key={d.day_of_week} className="flex flex-col items-center gap-1 flex-shrink-0">
              <DayChip label={WEEKDAY_LABELS[d.day_of_week]}
                today={d.day_of_week === todayWeekday}
                selected={d.day_of_week === selectedWeekday}
                onClick={() => setSelectedWeekday(d.day_of_week)}
                todayColor={EVENING_ACCENT} ringColor={EVENING_ACCENT} size={32} />
            </div>
          ))}
        </div>

        {/* สอง card น้ำหนักเท่ากัน: เช้า + เย็น — desktop 2 คอลัมน์เท่ากัน, มือถือเรียงเช้าก่อนเย็น */}
        <div className="grid lg:grid-cols-2 gap-4 mb-4">
          <MorningWalkSection
            today={today}
            connected={morningConnected}
            check={morningCheck}
            warmupExercises={warmupExercises}
            cooldownExercises={cooldownExercises}
            oauthError={null}
          />

          <div className="bg-[#201C19] border border-[#332D28] rounded-xl p-5">
            <p className="text-[11px] tracking-[0.05em] uppercase mb-1.5" style={{ color: EVENING_ACCENT }}>
              เย็น
            </p>

            {!day || day.kind === 'rest' ? (
              <>
                <h2 className="text-lg font-semibold mb-1">{day?.label ?? '—'}</h2>
                <p className="text-sm text-[#8A8178]">วันพัก — ไม่มีโปรแกรมเย็นวันนี้</p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold mb-3">{day.label}</h2>

                {/* block breakdown — list row ตาม design.md เหมือนการ์ดเช้า วันเบา (light) จะมีแค่
                    คูลดาวน์แถวเดียวโดยธรรมชาติ ไม่ต้องเติมให้เท่าวันหนัก */}
                <div className="divide-y divide-[#332D28] mb-4">
                  {warmup.length > 0 && (
                    <BlockRow label="วอร์มอัพ" count={warmup.length} color={EVENING_ACCENT}
                      timeLabel={fmtMinutes(estimateSeconds(warmup))} />
                  )}
                  {main.length > 0 && (
                    <BlockRow label={`Circuit × ${day.rounds} รอบ`} count={main.length} color={EVENING_ACCENT}
                      timeLabel={fmtMinutes(circuitSeconds)} />
                  )}
                  {cooldown.length > 0 && (
                    <BlockRow label="คูลดาวน์" count={cooldown.length} color={EVENING_ACCENT}
                      timeLabel={fmtMinutes(estimateSeconds(cooldown))} />
                  )}
                </div>

                {incompleteForSelectedDay ? (
                  <div className="flex gap-2">
                    <button onClick={() => resume(incompleteForSelectedDay)} disabled={starting}
                      className="flex-1 min-h-[48px] rounded-xl bg-[#F0A345] text-[#171412]
                        text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                      <Play size={16} /> เล่นต่อ (ค้างไว้ {remainingCount(day, incompleteForSelectedDay)} ท่า)
                    </button>
                    <button onClick={() => startFresh(incompleteForSelectedDay)} disabled={starting}
                      title="เริ่มใหม่ (ทิ้งความคืบหน้าเดิม)"
                      className="min-h-[48px] px-3 rounded-xl border border-[#332D28] text-[#8A8178]
                        disabled:opacity-50">
                      <RotateCcw size={16} />
                    </button>
                  </div>
                ) : (
                  <button onClick={start} disabled={starting}
                    className="w-full min-h-[48px] rounded-xl bg-[#F0A345] text-[#171412]
                      text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                    <Play size={16} /> เริ่ม
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* ประวัติล่าสุด — รวมทั้งเช้า(วอร์ม/คูล)และเย็น เรียงตามวันที่ล่าสุด */}
        {visibleHistory.length > 0 && (
          <div className="bg-[#201C19] border border-[#332D28] rounded-xl p-4">
            <p className="text-xs text-[#8A8178] mb-2">ประวัติล่าสุด</p>
            <div className="divide-y divide-[#332D28]">
              {visibleHistory.map(s => {
                const isMorning = s.session_type === 'morning_warmup' || s.session_type === 'morning_cooldown'
                const barColor = isMorning ? '#4FC1E0' : EVENING_ACCENT
                const label = s.session_type === 'morning_warmup' ? 'วอร์มอัพเช้า'
                  : s.session_type === 'morning_cooldown' ? 'คูลดาวน์เช้า'
                  : s.workout_days?.label ?? '?'
                return (
                  <div key={s.id} className="flex items-center gap-3 py-2 pl-3 border-l-2"
                    style={{ borderColor: barColor }}>
                    <span className="text-xs text-[#8A8178] tabular-nums w-16 flex-shrink-0">
                      {new Date(s.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-sm">{label}</span>
                    {s.completed_at ? (
                      <span className="text-xs flex-shrink-0" style={{ color: COMPLETED_COLOR }}>
                        ✓ <span className="font-mono">{s.active_minutes ?? '?'}</span> นาที
                      </span>
                    ) : (
                      <span className="text-xs text-[#8A8178] flex-shrink-0">ค้างอยู่</span>
                    )}
                    {/* ปุ่มลบ — โชว์เฉพาะแถวที่ยังไม่จบ (completed_at เป็น null) เท่านั้น ไม่ใช่ disabled
                        แค่ไม่มีเลยสำหรับแถวที่จบแล้ว */}
                    {!s.completed_at && (
                      <button onClick={() => deleteSession(s.id)} title="ลบ session ที่ค้างไว้"
                        className="text-[#E4574A] p-1 flex-shrink-0"><Trash2 size={13} /></button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
