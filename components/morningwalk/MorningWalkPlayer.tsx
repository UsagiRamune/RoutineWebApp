'use client'

// เครื่องเล่นวอร์มอัพ/คูลดาวน์ก่อน-หลังเดินเช้า — ง่ายกว่า WorkoutPlayer มาก: ไล่ท่าเดียวรอบเดียว
// ไม่มีรอบ/พักคั่นระหว่างท่า (สองบล็อกนี้เป็นเซสชันแยกอิสระจากกัน ไม่ใช่เซสชันต่อเนื่องเดียว)
// รีใช้ pattern จับเวลา+prep buffer 3 วิ จาก WorkoutPlayer.tsx ตรงๆ
//
// root wrapper ใช้ fixed inset-0 (ไม่ใช่ min-h-screen เฉยๆ แบบ WorkoutPlayer.tsx) เพราะ component นี้
// ถูกฝัง (embed) อยู่ใน grid cell ของ WorkoutLanding.tsx ด้วย (ผ่าน MorningWalkSection.tsx ที่ใช้ร่วมกัน
// ทั้ง /workout และ /morning-walk) — WorkoutPlayer.tsx เองไม่ต้องทำแบบนี้เพราะมัน early-return แทนที่
// ทั้งหน้า WorkoutLanding ไปเลยตอนเริ่มเล่น แต่ MorningWalkSection ไม่ได้ทำแบบนั้น (เก็บ session state
// ไว้ในตัวเอง encapsulate ไว้) ถ้าใช้ min-h-screen เฉยๆ ตอนฝังอยู่ใน grid cell จะไม่ได้เต็มจอจริง แค่
// เต็มแค่ cell นั้น — fixed ทำให้ทับเต็มจอเสมอไม่ว่าจะซ้อนอยู่ลึกแค่ไหนใน DOM

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MorningWalkExercise, WorkoutCategory, WorkoutExerciseRef } from '@/lib/supabase/types'
import CountdownRing from '@/components/workout/CountdownRing'
import ExercisePositionBar from '@/components/workout/ExercisePositionBar'
import SegmentedBar from '@/components/ui/SegmentedBar'
import { Check, SkipForward, X } from 'lucide-react'

interface Props {
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

export default function MorningWalkPlayer({
  label, exercises, sessionId, startedAtMs, today, onFinish,
}: Props) {
  const supabase = createClient()
  const [index, setIndex] = useState(0)
  const [sideStep, setSideStep] = useState<1 | 2>(1)
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

  // จับเวลาเป็นแค่ข้อความบอกว่าควรค้างนานแค่ไหน ไม่นับถอยหลัง/เด้งไปท่าถัดไปเองแล้ว — กดเองเสมอ
  // (ต่างจาก WorkoutPlayer.tsx ตอนเย็นที่ยังนับถอยหลังอัตโนมัติตามเดิม ไม่ได้แตะไฟล์นั้น)
  function completeTimedStep() {
    if (ex.per_side && sideStep === 1) setSideStep(2)
    else complete('done')
  }

  // prep buffer 3 วิ ก่อนท่าที่ต้องจับเวลาทุกครั้ง — อันนี้ยังนับอัตโนมัติเหมือนเดิมตามที่สั่ง
  useEffect(() => {
    if (phase !== 'active' || !prepping) return
    if (prepSecondsLeft <= 0) { setPrepping(false); return }
    const t = setTimeout(() => setPrepSecondsLeft(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, prepping, prepSecondsLeft])

  if (phase === 'summary') {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-[#171412] text-[#EDEAE0] flex flex-col">
        <div className="max-w-lg mx-auto w-full px-4 pt-10 pb-16 flex-1">
          <p className="text-xs text-[#8A8178] mb-1">จบแล้ว</p>
          <h1 className="text-2xl font-semibold mb-6">{label}</h1>

          <div className="bg-[#201C19] border border-[#332D28] rounded-xl p-5 mb-4 text-center">
            <p className="text-4xl font-bold font-mono tabular-nums text-[#4FC1E0]">{finalMinutes}</p>
            <p className="text-xs text-[#8A8178] mt-1">นาที</p>
          </div>

          {exercises.length > 0 && (
            <div className="bg-[#201C19] border border-[#332D28] rounded-xl p-4 mb-4">
              <p className="text-sm">
                <span className="font-mono">
                  <span className="text-2xl font-semibold">{doneList.length}</span>
                  <span className="text-[#8A8178]">/{exercises.length}</span>
                </span>
                <span className="text-[#8A8178]"> ท่าที่ทำ</span>
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
      <div className="fixed inset-0 z-50 overflow-y-auto bg-[#171412] text-[#EDEAE0] flex flex-col">
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#171412] text-[#EDEAE0] flex flex-col">
      <Header progress={progress} onExit={handleExitClick} />

      <div className="max-w-lg mx-auto w-full px-4 flex-1 flex flex-col pb-10">
        <div className="flex items-center justify-between mt-2 mb-2">
          <p className="text-sm text-[#8A8178]">{label}</p>
          <p className="text-xs text-[#8A8178] font-mono">{index + 1}/{exercises.length}</p>
        </div>
        <ExercisePositionBar total={exercises.length} currentIndex={index} color="#4FC1E0" className="mb-4" />

        {ex.category && (
          <span className="self-start text-[10px] px-2 py-0.5 rounded-full border border-[#332D28]
            text-[#8A8178] mb-2">
            {CATEGORY_LABEL[ex.category]}
          </span>
        )}

        {/* hero — ชื่อท่า ไม่มีกรอบ ตัวใหญ่สุดในจอ */}
        <h1 className="text-3xl font-semibold mb-3">{ex.name}</h1>
        <p className="text-base leading-relaxed text-[#EDEAE0]/90 mb-6">{ex.instructions}</p>

        <div className="flex-1 flex flex-col items-center justify-center">
          {isTimed ? (
            <>
              {/* ค้างเองตามเวลาที่บอก ไม่นับถอยหลังอัตโนมัติ — กด "ทำเสร็จแล้ว" เองตอนพร้อม */}
              <p className="text-3xl font-bold font-mono text-[#4FC1E0] mb-1">
                ค้าง {ex.duration_seconds} วิ{ex.per_side ? '/ข้าง' : ''}
              </p>
              {ex.per_side && (
                <p className="text-sm text-[#8A8178] mb-8">ข้างที่ {sideStep}/2</p>
              )}
              <button onClick={completeTimedStep}
                className="w-full min-h-[56px] rounded-xl bg-[#4FC1E0] text-[#171412]
                  text-base font-semibold flex items-center justify-center gap-2">
                <Check size={18} /> ทำเสร็จแล้ว ถัดไป
              </button>
            </>
          ) : (
            <>
              {ex.reps_label && (
                <p className="text-3xl font-bold font-mono text-[#4FC1E0] mb-8">{ex.reps_label}</p>
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
      <div className="max-w-lg mx-auto w-full px-4 pt-4 pb-2 flex items-center gap-3">
        <SegmentedBar value={progress} target={100} segments={10} color="#4FC1E0" className="flex-1" />
        <button onClick={onExit} className="flex items-center gap-1 text-xs text-[#8A8178] flex-shrink-0">
          <X size={14} /> จบตอนนี้
        </button>
      </div>
    </div>
  )
}
