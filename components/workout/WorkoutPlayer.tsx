'use client'

// เครื่องเล่นออกกำลังกาย: warmup (เรียงครั้งเดียว) → main (circuit วนตาม rounds) → cooldown (เรียงครั้งเดียว) → สรุป
// สร้าง flat "steps" ล่วงหน้าทั้งเวิร์กเอาต์ (ท่า + หน้าจอพักคั่น) เดินหน้าทีละ index เดียว
// ง่ายกว่าไล่ nested state (phase/round/exercise) แยกกันหลายตัว
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  WorkoutBlock, WorkoutCategory, WorkoutDayWithExercises, WorkoutExercise, WorkoutExerciseRef,
} from '@/lib/supabase/types'
import CountdownRing from '@/components/workout/CountdownRing'
import { Play, Pause, X, SkipForward, Check } from 'lucide-react'

interface Props {
  day: WorkoutDayWithExercises
  sessionId: string
  startedAtMs: number
  today: string
  onFinish: () => void
  // resume เซสชันที่ค้างไว้ (มี exercises_done/exercises_skipped อยู่แล้วจากรอบก่อน) — ถ้าไม่ส่งมา
  // ถือเป็นเซสชันใหม่ล้วนๆ (เริ่มจาก step แรกเสมอ)
  initialDone?: WorkoutExerciseRef[]
  initialSkipped?: WorkoutExerciseRef[]
}

export interface ExerciseStep {
  type: 'exercise'
  block: WorkoutBlock
  exercise: WorkoutExercise
  round: number
  blockIndex: number
  blockTotal: number
  globalIndex: number
  totalExercise: number
}

interface RestStep {
  type: 'rest'
  restKind: 'exercise' | 'round'
  seconds: number
  nextLabel: string | null
  precedingCount: number
  totalExercise: number
}

export type FlowStep = ExerciseStep | RestStep

const CATEGORY_LABEL: Record<WorkoutCategory, string> = {
  strength: 'Strength', cardio: 'Cardio', core: 'Core', stretch: 'Stretch',
}

export function buildSteps(day: WorkoutDayWithExercises): FlowStep[] {
  const byBlock = (b: WorkoutBlock) => day.workout_exercises
    .filter(e => e.block === b).slice().sort((a, b2) => a.sort_order - b2.sort_order)
  const warmup = byBlock('warmup')
  const main = byBlock('main')
  const cooldown = byBlock('cooldown')
  const totalExercise = warmup.length + main.length * day.rounds + cooldown.length

  const steps: FlowStep[] = []
  let gi = 0

  for (let i = 0; i < warmup.length; i++) {
    gi++
    steps.push({
      type: 'exercise', block: 'warmup', exercise: warmup[i], round: 1,
      blockIndex: i, blockTotal: warmup.length, globalIndex: gi, totalExercise,
    })
  }

  for (let round = 1; round <= day.rounds; round++) {
    for (let i = 0; i < main.length; i++) {
      gi++
      steps.push({
        type: 'exercise', block: 'main', exercise: main[i], round,
        blockIndex: i, blockTotal: main.length, globalIndex: gi, totalExercise,
      })
      const isLastOfRound = i === main.length - 1
      const isVeryLast = round === day.rounds && isLastOfRound
      if (!isVeryLast) {
        if (isLastOfRound) {
          steps.push({
            type: 'rest', restKind: 'round', seconds: day.round_rest_seconds,
            nextLabel: main[0]?.name ?? null, precedingCount: gi, totalExercise,
          })
        } else {
          steps.push({
            type: 'rest', restKind: 'exercise', seconds: day.exercise_rest_seconds,
            nextLabel: main[i + 1].name, precedingCount: gi, totalExercise,
          })
        }
      }
    }
  }

  for (let i = 0; i < cooldown.length; i++) {
    gi++
    steps.push({
      type: 'exercise', block: 'cooldown', exercise: cooldown[i], round: 1,
      blockIndex: i, blockTotal: cooldown.length, globalIndex: gi, totalExercise,
    })
  }

  return steps
}

function phaseLabel(step: FlowStep, rounds: number): string {
  if (step.type === 'exercise') {
    if (step.block === 'warmup') return 'วอร์มอัพ'
    if (step.block === 'cooldown') return 'คูลดาวน์'
    return `Circuit • รอบ ${step.round}/${rounds}`
  }
  return step.restKind === 'round' ? 'พักรอบ' : 'พัก'
}

function initialSecondsFor(step: FlowStep | undefined): number {
  if (!step) return 0
  if (step.type === 'rest') return step.seconds
  if (step.exercise.duration_seconds != null) return step.exercise.duration_seconds
  return 0
}

// หา step แรกที่ยังไม่ถูกบันทึกว่าทำ/ข้าม (เทียบ exercise_id+round) — ใช้ตอน resume เซสชันค้างไว้
// เดินข้าม step ที่ทำไปแล้วให้อัตโนมัติ ไม่ต้องกลับไปเล่นซ้ำ
function findResumeIndex(
  steps: FlowStep[], done: WorkoutExerciseRef[], skipped: WorkoutExerciseRef[]
): number {
  const recorded = new Set([...done, ...skipped].map(r => `${r.exercise_id}:${r.round}`))
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (s.type === 'exercise' && !recorded.has(`${s.exercise.id}:${s.round}`)) return i
  }
  return steps.length // ทำ/ข้ามครบทุกท่าไปแล้ว (เคสหายาก) — ให้ตรงไปหน้าสรุปเลย
}

function vibrate(ms: number) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms)
  } catch {
    // เบราว์เซอร์ไม่รองรับ/ไม่อนุญาต — เฉยไว้ ไม่ใช่ฟีเจอร์หลัก
  }
}

export default function WorkoutPlayer({
  day, sessionId, startedAtMs, today, onFinish, initialDone = [], initialSkipped = [],
}: Props) {
  const supabase = createClient()
  const steps = useMemo(() => buildSteps(day), [day])
  // คำนวณครั้งเดียวตอน mount — component นี้ mount ใหม่ทุกครั้งที่เริ่ม/resume เซสชัน (ไม่มี session
  // ไหนเปลี่ยนกลางคันโดยไม่ mount ใหม่) จึงไม่ต้อง sync ซ้ำทีหลัง
  const [initialStepIndex] = useState(() => findResumeIndex(steps, initialDone, initialSkipped))

  const [stepIndex, setStepIndex] = useState(initialStepIndex)
  const [sideStep, setSideStep] = useState<1 | 2>(1)
  const [secondsLeft, setSecondsLeft] = useState(() => initialSecondsFor(steps[initialStepIndex]))
  const [paused, setPaused] = useState(false)
  const [doneList, setDoneList] = useState<WorkoutExerciseRef[]>(initialDone)
  const [skippedList, setSkippedList] = useState<WorkoutExerciseRef[]>(initialSkipped)
  const [phase, setPhase] = useState<'active' | 'summary'>(steps.length === 0 ? 'summary' : 'active')
  const [finalMinutes, setFinalMinutes] = useState(0)
  const finishedRef = useRef(false)

  const step = steps[stepIndex]

  // เคสหายาก: resume มาแล้วปรากฏว่าทำ/ข้ามครบทุกท่าไปแล้วจริงๆ (แค่ไม่เคยกด "จบ") — ปิดเซสชันให้เลย
  useEffect(() => {
    if (initialStepIndex >= steps.length && steps.length > 0) finishWorkout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function persistDone(next: WorkoutExerciseRef[]) {
    await supabase.from('workout_sessions').update({ exercises_done: next }).eq('id', sessionId)
  }
  async function persistSkipped(next: WorkoutExerciseRef[]) {
    await supabase.from('workout_sessions').update({ exercises_skipped: next }).eq('id', sessionId)
  }

  async function finishWorkout() {
    if (finishedRef.current) return
    finishedRef.current = true
    const completedAt = new Date()
    const minutes = Math.max(0, Math.round((completedAt.getTime() - startedAtMs) / 60000))
    await supabase.from('workout_sessions').update({
      completed_at: completedAt.toISOString(), active_minutes: minutes,
    }).eq('id', sessionId)
    fetch('/api/workout/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: today, activeMinutes: minutes }),
    }).catch(() => {})
    setFinalMinutes(minutes)
    setPhase('summary')
  }

  function handleExitClick() {
    if (confirm('จบเซสชันตอนนี้เลยไหม? ท่าที่ยังไม่ถึงจะไม่ถูกนับว่าทำ')) finishWorkout()
  }

  function goToStep(nextIndex: number) {
    if (nextIndex >= steps.length) {
      finishWorkout()
      return
    }
    setStepIndex(nextIndex)
    setSideStep(1)
    setPaused(false)
    setSecondsLeft(initialSecondsFor(steps[nextIndex]))
  }

  function completeExercise(s: ExerciseStep, outcome: 'done' | 'skip') {
    const ref: WorkoutExerciseRef = { exercise_id: s.exercise.id, round: s.round }
    if (outcome === 'done') {
      setDoneList(prev => {
        const next = [...prev, ref]
        persistDone(next)
        return next
      })
    } else {
      setSkippedList(prev => {
        const next = [...prev, ref]
        persistSkipped(next)
        return next
      })
    }
    goToStep(stepIndex + 1)
  }

  function finishTimedEarly(s: ExerciseStep) {
    if (s.exercise.per_side && sideStep === 1) {
      setSideStep(2)
      setSecondsLeft(s.exercise.duration_seconds!)
    } else {
      completeExercise(s, 'done')
    }
  }

  // นาฬิกานับถอยหลัง — ใช้กับทั้งท่าจับเวลาและหน้าจอพัก เคลียร์/ตั้งใหม่ทุกครั้งที่ step/side/paused เปลี่ยน
  useEffect(() => {
    if (phase !== 'active' || paused || !step) return
    const isTimedExercise = step.type === 'exercise' && step.exercise.duration_seconds != null
    const isRest = step.type === 'rest'
    if (!isTimedExercise && !isRest) return

    const interval = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          queueMicrotask(() => {
            vibrate(200)
            if (step.type === 'rest') {
              goToStep(stepIndex + 1)
            } else if (step.type === 'exercise') {
              if (step.exercise.per_side && sideStep === 1) {
                setSideStep(2)
                setSecondsLeft(step.exercise.duration_seconds!)
              } else {
                completeExercise(step, 'done')
              }
            }
          })
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stepIndex, paused, sideStep])

  // ---------- summary ----------

  if (phase === 'summary') {
    const exerciseById = new Map(day.workout_exercises.map(e => [e.id, e]))
    return (
      <div className="min-h-screen bg-[#14171F] text-[#EDEAE0] flex flex-col">
        <div className="max-w-lg mx-auto w-full px-4 pt-10 pb-16 flex-1">
          <p className="text-xs text-[#7C8394] mb-1">จบเวิร์กเอาต์แล้ว</p>
          <h1 className="text-2xl font-semibold mb-6">{day.label}</h1>

          <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-5 mb-4 text-center">
            <p className="text-4xl font-bold tabular-nums text-[#4FC1E0]">{finalMinutes}</p>
            <p className="text-xs text-[#7C8394] mt-1">นาทีที่ออกกำลังกาย</p>
          </div>

          <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
            <p className="text-sm">
              <span className="text-2xl font-semibold">{doneList.length}</span>
              <span className="text-[#7C8394]">/{steps.filter(s => s.type === 'exercise').length ||
                (day.workout_exercises.length || 0)} ท่าที่ทำ</span>
            </p>
          </div>

          {skippedList.length > 0 && (
            <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
              <p className="text-xs text-[#7C8394] mb-2">ท่าที่ข้าม</p>
              <div className="space-y-1">
                {skippedList.map((s, i) => {
                  const ex = exerciseById.get(s.exercise_id)
                  return (
                    <p key={i} className="text-sm text-[#7C8394]">
                      {ex?.name ?? '?'} {day.rounds > 1 && ex?.block === 'main' && `(รอบ ${s.round})`}
                    </p>
                  )
                })}
              </div>
            </div>
          )}

          <button onClick={onFinish}
            className="w-full min-h-[48px] rounded-xl bg-[#EDEAE0] text-[#14171F] text-sm font-semibold mt-4">
            เสร็จสิ้น
          </button>
        </div>
      </div>
    )
  }

  if (!step) return null

  // ---------- active: rest screen ----------

  if (step.type === 'rest') {
    const progress = (step.precedingCount / step.totalExercise) * 100
    return (
      <div className="min-h-screen bg-[#14171F] text-[#EDEAE0] flex flex-col">
        <Header progress={progress} onExit={handleExitClick} />
        <div className="max-w-lg mx-auto w-full px-4 flex-1 flex flex-col items-center justify-center text-center">
          <p className="text-sm text-[#7C8394] mb-4">{phaseLabel(step, day.rounds)}</p>
          <CountdownRing totalSeconds={step.seconds} secondsLeft={secondsLeft} color="#F0A345" />
          {step.nextLabel && (
            <p className="text-sm text-[#7C8394] mt-6">ท่าถัดไป: <span className="text-[#EDEAE0]">{step.nextLabel}</span></p>
          )}
          <button onClick={() => goToStep(stepIndex + 1)}
            className="mt-8 min-h-[48px] px-6 text-sm text-[#7C8394]">
            ข้ามการพัก
          </button>
        </div>
      </div>
    )
  }

  // ---------- active: exercise screen ----------

  const ex = step.exercise
  const isTimed = ex.duration_seconds != null
  const progress = (step.globalIndex / step.totalExercise) * 100

  return (
    <div className="min-h-screen bg-[#14171F] text-[#EDEAE0] flex flex-col">
      <Header progress={progress} onExit={handleExitClick} />

      <div className="max-w-lg mx-auto w-full px-4 flex-1 flex flex-col pb-10">
        <div className="flex items-center justify-between mt-2 mb-4">
          <p className="text-sm text-[#7C8394]">{phaseLabel(step, day.rounds)}</p>
          <p className="text-xs text-[#7C8394]">ท่า {step.blockIndex + 1}/{step.blockTotal}</p>
        </div>

        {ex.category && (
          <span className="self-start text-[10px] px-2 py-0.5 rounded-full border border-[#2A2F3D]
            text-[#7C8394] mb-2">
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
              <div className="flex items-center gap-3 mt-6">
                <button onClick={() => setPaused(p => !p)}
                  className="flex items-center gap-1.5 min-h-[48px] px-4 rounded-xl
                    border border-[#2A2F3D] text-sm text-[#EDEAE0]">
                  {paused ? <Play size={16} /> : <Pause size={16} />} {paused ? 'เล่นต่อ' : 'หยุดชั่วคราว'}
                </button>
                <button onClick={() => finishTimedEarly(step)}
                  className="flex items-center gap-1.5 min-h-[48px] px-4 rounded-xl
                    bg-[#4FC1E0] text-[#14171F] text-sm font-semibold">
                  <Check size={16} /> เสร็จแล้ว
                </button>
              </div>
            </>
          ) : (
            <>
              {ex.reps_label && (
                <p className="text-3xl font-bold text-[#4FC1E0] mb-8">{ex.reps_label}</p>
              )}
              <button onClick={() => completeExercise(step, 'done')}
                className="w-full min-h-[56px] rounded-xl bg-[#4FC1E0] text-[#14171F]
                  text-base font-semibold flex items-center justify-center gap-2">
                <Check size={18} /> ทำเสร็จแล้ว ถัดไป
              </button>
            </>
          )}
        </div>

        <button onClick={() => completeExercise(step, 'skip')}
          className="flex items-center justify-center gap-1.5 min-h-[48px] mt-4 text-sm text-[#7C8394]">
          <SkipForward size={14} /> ข้ามท่านี้
        </button>
      </div>
    </div>
  )
}

function Header({ progress, onExit }: { progress: number; onExit: () => void }) {
  return (
    <div className="sticky top-0 bg-[#14171F] z-10">
      <div className="max-w-lg mx-auto w-full px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="h-1.5 flex-1 bg-[#2A2F3D] rounded-full overflow-hidden mr-3">
          <div className="h-full bg-[#4FC1E0] rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <button onClick={onExit} className="flex items-center gap-1 text-xs text-[#7C8394] flex-shrink-0">
          <X size={14} /> จบตอนนี้
        </button>
      </div>
    </div>
  )
}
