'use client'

// เครื่องเล่นวอร์มอัพ/คูลดาวน์ก่อน-หลังเดินเช้า — ง่ายกว่า WorkoutPlayer มาก: ไล่ท่าเดียวรอบเดียว
// ไม่มีรอบ/พักคั่นระหว่างท่า (สองบล็อกนี้เป็นเซสชันแยกอิสระจากกัน ไม่ใช่เซสชันต่อเนื่องเดียว)
// รีใช้ pattern จับเวลา+prep buffer 3 วิ จาก WorkoutPlayer.tsx ตรงๆ
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MorningWalkBlock, MorningWalkExercise, WorkoutCategory, WorkoutExerciseRef } from '@/lib/supabase/types'
import CountdownRing from '@/components/workout/CountdownRing'
import { Check, SkipForward, X } from 'lucide-react'

interface Props {
  block: MorningWalkBlock
  label: string
  exercises: MorningWalkExercise[] // เฉพาะ block นี้ เรียง sort_order มาแล้วจากผู้เรียก
  sessionId: string
  startedAtMs: number
  today: string
  onFinish: () => void
}

const CATEGORY_LABEL: Record<WorkoutCategory, string> = {
  strength: 'Strength', cardio: 'Cardio', core: 'Core', stretch: 'Stretch',
}

function vibrate(ms: number) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms)
  } catch {
    // เบราว์เซอร์ไม่รองรับ/ไม่อนุญาต — เฉยไว้ ไม่ใช่ฟีเจอร์หลัก
  }
}

export default function MorningWalkPlayer({
  block, label, exercises, sessionId, startedAtMs, today, onFinish,
}: Props) {
  const supabase = createClient()
  const [index, setIndex] = useState(0)
  const [sideStep, setSideStep] = useState<1 | 2>(1)
  const [secondsLeft, setSecondsLeft] = useState(() => exercises[0]?.duration_seconds ?? 0)
  const [prepping, setPrepping] = useState(() => exercises[0]?.duration_seconds != null)
  const [prepSecondsLeft, setPrepSecondsLeft] = useState(3)
  const [doneList, setDoneList] = useState<WorkoutExerciseRef[]>([])
  const [skippedList, setSkippedList] = useState<WorkoutExerciseRef[]>([])
  const [phase, setPhase] = useState<'active' | 'summary'>(exercises.length === 0 ? 'summary' : 'active')
  const [finalMinutes, setFinalMinutes] = useState(0)

  const ex = exercises[index]

  async function finish(done: WorkoutExerciseRef[], skipped: WorkoutExerciseRef[]) {
    const completedAt = new Date()
    const minutes = Math.max(0, Math.round((completedAt.getTime() - startedAtMs) / 60000))
    await supabase.from('workout_sessions').update({
      completed_at: completedAt.toISOString(), active_minutes: minutes,
      exercises_done: done, exercises_skipped: skipped,
    }).eq('id', sessionId)
    // นับรวมเข้า active_minutes ของวันด้วย (endpoint นี้ generic อยู่แล้ว ไม่ผูกกับ workout day)
    fetch('/api/workout/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: today, activeMinutes: minutes }),
    }).catch(() => {})
    setFinalMinutes(minutes)
    setPhase('summary')
  }

  function handleExitClick() {
    if (confirm('จบตอนนี้เลยไหม? ท่าที่ยังไม่ถึงจะไม่ถูกนับว่าทำ')) finish(doneList, skippedList)
  }

  function goTo(nextIndex: number, done: WorkoutExerciseRef[], skipped: WorkoutExerciseRef[]) {
    if (nextIndex >= exercises.length) { finish(done, skipped); return }
    const next = exercises[nextIndex]
    setIndex(nextIndex)
    setSideStep(1)
    setSecondsLeft(next.duration_seconds ?? 0)
    setPrepping(next.duration_seconds != null)
    setPrepSecondsLeft(3)
  }

  function complete(outcome: 'done' | 'skip') {
    const ref: WorkoutExerciseRef = { exercise_id: ex.id, round: 1 }
    const nextDone = outcome === 'done' ? [...doneList, ref] : doneList
    const nextSkipped = outcome === 'skip' ? [...skippedList, ref] : skippedList
    setDoneList(nextDone)
    setSkippedList(nextSkipped)
    goTo(index + 1, nextDone, nextSkipped)
  }

  function finishTimedEarly() {
    if (ex.per_side && sideStep === 1) { setSideStep(2); setSecondsLeft(ex.duration_seconds!) }
    else complete('done')
  }

  // prep buffer 3 วิ ก่อนท่าที่ต้องจับเวลาทุกครั้ง
  useEffect(() => {
    if (phase !== 'active' || !prepping) return
    if (prepSecondsLeft <= 0) { setPrepping(false); return }
    const t = setTimeout(() => setPrepSecondsLeft(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, prepping, prepSecondsLeft])

  // นาฬิกานับถอยหลังจริงของท่าจับเวลา
  useEffect(() => {
    if (phase !== 'active' || !ex || prepping || ex.duration_seconds == null) return
    const interval = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          queueMicrotask(() => {
            vibrate(200)
            if (ex.per_side && sideStep === 1) { setSideStep(2); setSecondsLeft(ex.duration_seconds!) }
            else complete('done')
          })
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, sideStep, prepping])

  if (phase === 'summary') {
    return (
      <div className="min-h-screen bg-[#171412] text-[#EDEAE0] flex flex-col">
        <div className="max-w-lg mx-auto w-full px-4 pt-10 pb-16 flex-1">
          <p className="text-xs text-[#8A8178] mb-1">จบแล้ว</p>
          <h1 className="text-2xl font-semibold mb-6">{label}</h1>

          <div className="bg-[#201C19] border border-[#332D28] rounded-xl p-5 mb-4 text-center">
            <p className="text-4xl font-bold tabular-nums text-[#4FC1E0]">{finalMinutes}</p>
            <p className="text-xs text-[#8A8178] mt-1">นาที</p>
          </div>

          {exercises.length > 0 && (
            <div className="bg-[#201C19] border border-[#332D28] rounded-xl p-4 mb-4">
              <p className="text-sm">
                <span className="text-2xl font-semibold">{doneList.length}</span>
                <span className="text-[#8A8178]">/{exercises.length} ท่าที่ทำ</span>
              </p>
            </div>
          )}

          <button onClick={onFinish}
            className="w-full min-h-[48px] rounded-xl bg-[#EDEAE0] text-[#171412] text-sm font-semibold mt-4">
            เสร็จสิ้น
          </button>
        </div>
      </div>
    )
  }

  if (!ex) return null

  const progress = (index / exercises.length) * 100
  const isTimed = ex.duration_seconds != null

  if (prepping) {
    return (
      <div className="min-h-screen bg-[#171412] text-[#EDEAE0] flex flex-col">
        <Header progress={progress} onExit={handleExitClick} />
        <div className="max-w-lg mx-auto w-full px-4 flex-1 flex flex-col items-center justify-center text-center">
          <p className="text-sm text-[#8A8178] mb-2">เตรียมตัว...</p>
          <h2 className="text-xl font-semibold mb-6">{ex.name}</h2>
          <CountdownRing totalSeconds={3} secondsLeft={prepSecondsLeft} color="#F0A345" />
          <button onClick={() => setPrepping(false)}
            className="mt-8 min-h-[48px] px-6 text-sm text-[#8A8178]">
            เริ่มเลย
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#171412] text-[#EDEAE0] flex flex-col">
      <Header progress={progress} onExit={handleExitClick} />

      <div className="max-w-lg mx-auto w-full px-4 flex-1 flex flex-col pb-10">
        <div className="flex items-center justify-between mt-2 mb-4">
          <p className="text-sm text-[#8A8178]">{label}</p>
          <p className="text-xs text-[#8A8178]">ท่า {index + 1}/{exercises.length}</p>
        </div>

        {ex.category && (
          <span className="self-start text-[10px] px-2 py-0.5 rounded-full border border-[#332D28]
            text-[#8A8178] mb-2">
            {CATEGORY_LABEL[ex.category]}
          </span>
        )}

        <h1 className="text-2xl font-semibold mb-3">{ex.name}</h1>
        <p className="text-base leading-relaxed text-[#EDEAE0]/90 mb-6">{ex.instructions}</p>

        <div className="flex-1 flex flex-col items-center justify-center">
          {isTimed ? (
            <>
              <CountdownRing totalSeconds={ex.duration_seconds!} secondsLeft={secondsLeft}
                color="#4FC1E0" label={ex.per_side ? `ข้างที่ ${sideStep}` : undefined} />
              <button onClick={finishTimedEarly}
                className="flex items-center gap-1.5 min-h-[48px] px-4 mt-6 rounded-xl
                  bg-[#4FC1E0] text-[#171412] text-sm font-semibold">
                <Check size={16} /> เสร็จแล้ว
              </button>
            </>
          ) : (
            <>
              {ex.reps_label && (
                <p className="text-3xl font-bold text-[#4FC1E0] mb-8">{ex.reps_label}</p>
              )}
              <button onClick={() => complete('done')}
                className="w-full min-h-[56px] rounded-xl bg-[#4FC1E0] text-[#171412]
                  text-base font-semibold flex items-center justify-center gap-2">
                <Check size={18} /> ทำเสร็จแล้ว ถัดไป
              </button>
            </>
          )}
        </div>

        <button onClick={() => complete('skip')}
          className="flex items-center justify-center gap-1.5 min-h-[48px] mt-4 text-sm text-[#8A8178]">
          <SkipForward size={14} /> ข้ามท่านี้
        </button>
      </div>
    </div>
  )
}

function Header({ progress, onExit }: { progress: number; onExit: () => void }) {
  return (
    <div className="sticky top-0 bg-[#171412] z-10">
      <div className="max-w-lg mx-auto w-full px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="h-1.5 flex-1 bg-[#332D28] rounded-full overflow-hidden mr-3">
          <div className="h-full bg-[#4FC1E0] rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <button onClick={onExit} className="flex items-center gap-1 text-xs text-[#8A8178] flex-shrink-0">
          <X size={14} /> จบตอนนี้
        </button>
      </div>
    </div>
  )
}
