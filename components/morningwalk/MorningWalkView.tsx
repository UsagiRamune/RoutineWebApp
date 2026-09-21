'use client'

// หน้าเดินเช้า: การ์ดสถานะวันนี้ (เช็คจาก Strava หรือยืนยันเอง) + วอร์มอัพ/คูลดาวน์แยกอิสระ 2 ส่วน
// (ไม่ใช่เซสชันต่อเนื่องเดียว) + จัดการท่า — ตารางท่ายังว่างตอนนี้ รอกรอกจริงทีหลังผ่าน UI ในหน้านี้เอง
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MorningWalkCheck, MorningWalkExercise, WorkoutExerciseRef } from '@/lib/supabase/types'
import MorningWalkPlayer from '@/components/morningwalk/MorningWalkPlayer'
import ManageMorningWalkExercises from '@/components/morningwalk/ManageMorningWalkExercises'
import { CheckCircle2, Footprints, Settings2 } from 'lucide-react'

interface Props {
  today: string
  connected: boolean
  check: MorningWalkCheck | null
  warmupExercises: MorningWalkExercise[]
  cooldownExercises: MorningWalkExercise[]
  oauthError: string | null
}

interface ActiveSession {
  block: 'warmup' | 'cooldown'
  sessionId: string
  startedAtMs: number
}

const ERROR_LABEL: Record<string, string> = {
  config: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า STRAVA_CLIENT_ID/SECRET',
  oauth: 'เชื่อมต่อ Strava ไม่สำเร็จ ลองใหม่อีกครั้ง',
}

function estimateSeconds(exercises: { duration_seconds: number | null }[]): number {
  return exercises.reduce((s, e) => s + (e.duration_seconds ?? 20), 0)
}

function fmtMinutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} นาที`
}

export default function MorningWalkView({
  today, connected, check, warmupExercises, cooldownExercises, oauthError,
}: Props) {
  const supabase = createClient()
  const router = useRouter()
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')
  const [localCheck, setLocalCheck] = useState(check)
  const [manageOpen, setManageOpen] = useState<{ warmup: boolean; cooldown: boolean }>({
    warmup: false, cooldown: false,
  })
  const [session, setSession] = useState<ActiveSession | null>(null)

  const confirmed = !!(localCheck?.strava_confirmed || localCheck?.manual_override)

  async function checkFromStrava() {
    setChecking(true)
    setCheckError('')
    try {
      const res = await fetch('/api/strava/check-walk', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'เช็คไม่สำเร็จ')
      if (data.connected === false) {
        setCheckError('ยังไม่ได้เชื่อม Strava')
        return
      }
      setLocalCheck(p => ({
        date: today, strava_confirmed: !!data.confirmed,
        manual_override: p?.manual_override ?? false,
        checked_at: new Date().toISOString(),
      }))
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    } finally {
      setChecking(false)
    }
  }

  async function toggleManualOverride() {
    const next = !localCheck?.manual_override
    setLocalCheck(p => ({
      date: today, strava_confirmed: p?.strava_confirmed ?? false,
      manual_override: next, checked_at: new Date().toISOString(),
    }))
    await supabase.from('morning_walk_checks').upsert({
      date: today,
      strava_confirmed: localCheck?.strava_confirmed ?? false,
      manual_override: next,
      checked_at: new Date().toISOString(),
    }, { onConflict: 'date' })
  }

  async function startBlock(block: 'warmup' | 'cooldown') {
    const sessionType = block === 'warmup' ? 'morning_warmup' : 'morning_cooldown'
    const { data } = await supabase.from('workout_sessions').insert({
      date: today, day_id: null, session_type: sessionType, started_at: new Date().toISOString(),
      exercises_done: [] as WorkoutExerciseRef[], exercises_skipped: [] as WorkoutExerciseRef[],
    }).select().single()
    if (data) {
      setSession({ block, sessionId: data.id, startedAtMs: new Date(data.started_at).getTime() })
    }
  }

  if (session) {
    const exercises = session.block === 'warmup' ? warmupExercises : cooldownExercises
    return (
      <MorningWalkPlayer
        block={session.block}
        label={session.block === 'warmup' ? 'วอร์มอัพก่อนเดิน' : 'คูลดาวน์หลังเดิน'}
        exercises={exercises}
        sessionId={session.sessionId}
        startedAtMs={session.startedAtMs}
        today={today}
        onFinish={() => { setSession(null); router.refresh() }}
      />
    )
  }

  return (
    <main className="min-h-screen bg-[#171412] text-[#EDEAE0] pb-16">
      <div className="max-w-lg mx-auto px-4 pt-8">
        <h1 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Footprints size={20} /> เดินเช้า
        </h1>

        {oauthError && (
          <p className="text-xs text-[#E4574A] mb-3">
            {ERROR_LABEL[oauthError] ?? 'เกิดข้อผิดพลาด'}
          </p>
        )}

        {/* สถานะวันนี้ */}
        <div className="bg-[#201C19] border border-[#332D28] rounded-xl p-4 mb-4">
          {confirmed ? (
            <div className="flex items-center gap-2 text-[#4FC1E0]">
              <CheckCircle2 size={20} />
              <p className="text-sm font-semibold">เดินแล้ววันนี้</p>
              {localCheck?.manual_override && !localCheck?.strava_confirmed && (
                <span className="text-[10px] text-[#8A8178]">(ยืนยันเอง)</span>
              )}
            </div>
          ) : connected ? (
            <>
              <p className="text-sm text-[#8A8178] mb-3">ยังไม่เจอกิจกรรมเดิน/ไฮค์วันนี้จาก Strava</p>
              <button onClick={checkFromStrava} disabled={checking}
                className="w-full min-h-[44px] rounded-lg bg-[#4FC1E0] text-[#171412]
                  text-sm font-semibold disabled:opacity-50">
                {checking ? 'กำลังเช็ค...' : 'เช็คจาก Strava'}
              </button>
              {checkError && <p className="text-xs text-[#E4574A] mt-2">{checkError}</p>}
            </>
          ) : (
            <>
              <p className="text-sm text-[#8A8178] mb-3">ยังไม่ได้เชื่อม Strava</p>
              <a href="/api/strava/auth"
                className="block text-center w-full min-h-[44px] leading-[44px] rounded-lg
                  border border-[#332D28] text-sm font-semibold">
                เชื่อม Strava
              </a>
            </>
          )}

          <label className="flex items-center gap-2 mt-3 pt-3 border-t border-[#332D28] text-xs text-[#8A8178]">
            <input type="checkbox" checked={!!localCheck?.manual_override} onChange={toggleManualOverride} />
            ยืนยันเอง (ไม่ผ่าน Strava) — เผื่อ sync ช้าหรือไม่ได้เทรกผ่าน Strava วันนี้
          </label>
        </div>

        {/* วอร์มอัพ + คูลดาวน์ — สองส่วนอิสระจากกัน ไม่ใช่เซสชันเดียวต่อเนื่อง */}
        {(['warmup', 'cooldown'] as const).map(block => {
          const exercises = block === 'warmup' ? warmupExercises : cooldownExercises
          const label = block === 'warmup' ? 'วอร์มอัพก่อนเดิน' : 'คูลดาวน์หลังเดิน'
          const open = manageOpen[block]
          return (
            <div key={block} className="bg-[#201C19] border border-[#332D28] rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">{label}</p>
                <button onClick={() => setManageOpen(p => ({ ...p, [block]: !p[block] }))}
                  className="flex items-center gap-1 text-xs text-[#8A8178]">
                  <Settings2 size={12} /> {open ? 'ปิด' : 'จัดการท่า'}
                </button>
              </div>

              {!open && (
                exercises.length === 0 ? (
                  <p className="text-xs text-[#8A8178]">ยังไม่มีท่า — กด "จัดการท่า" เพื่อเพิ่ม</p>
                ) : (
                  <>
                    <p className="text-xs text-[#8A8178] mb-3">
                      {exercises.length} ท่า · ประมาณ {fmtMinutes(estimateSeconds(exercises))}
                    </p>
                    <button onClick={() => startBlock(block)}
                      className="w-full min-h-[44px] rounded-lg bg-[#4FC1E0] text-[#171412] text-sm font-semibold">
                      เริ่ม{label}
                    </button>
                  </>
                )
              )}

              {open && <ManageMorningWalkExercises block={block} exercises={exercises} />}
            </div>
          )
        })}
      </div>
    </main>
  )
}
