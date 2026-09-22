'use client'

// การ์ด "เช้า" — component เดียวที่ใช้ร่วมกันทั้งฝังในหน้า /workout (คู่กับการ์ด "เย็น") และหน้า /morning-walk
// เดี่ยวๆ (ตามที่ตกลงไว้ว่าไม่ให้ logic ซ้ำกันสองที่) ตัว component นี้ห่อกรอบการ์ดของตัวเองไว้แล้ว —
// หน้าที่เรียกใช้แค่จัดวาง layout รอบๆ (grid คู่กับการ์ดเย็นใน WorkoutLanding, หรือ container เดี่ยวใน
// /morning-walk) สถานะยืนยันผ่าน Strava/เอง + รายการนับท่าต่อ block (list row ตาม design.md ไม่ใช่กรอบซ้อน) +
// ปุ่มเริ่มวอร์ม/คูล แบบ outline (การ์ดนี้มี accent ของตัวเองแล้ว ปุ่มทึบจะแย่งซีนเกิน)
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MorningWalkCheck, MorningWalkExercise, WorkoutExerciseRef } from '@/lib/supabase/types'
import MorningWalkPlayer from '@/components/morningwalk/MorningWalkPlayer'
import ManageMorningWalkExercises from '@/components/morningwalk/ManageMorningWalkExercises'
import BlockRow from '@/components/workout/BlockRow'
import { CheckCircle2, Circle, Settings2 } from 'lucide-react'

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

const ACCENT = '#4FC1E0' // เช้า = ฟ้า ตาม spec

const ERROR_LABEL: Record<string, string> = {
  config: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า STRAVA_CLIENT_ID/SECRET',
  oauth: 'เชื่อมต่อ Strava ไม่สำเร็จ ลองใหม่อีกครั้ง',
}

function estimateSeconds(exercises: { duration_seconds: number | null }[]): number {
  return exercises.reduce((s, e) => s + (e.duration_seconds ?? 20), 0)
}

function fmtMinutes(seconds: number): string {
  return `~${Math.max(1, Math.round(seconds / 60))} นาที`
}

export default function MorningWalkSection({
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
    <div className="bg-[#201C19] border border-[#332D28] rounded-xl p-5">
      <p className="text-[11px] tracking-[0.05em] uppercase mb-1.5" style={{ color: ACCENT }}>เช้า</p>
      <h2 className="text-lg font-semibold mb-3">เดินเช้า</h2>

      {oauthError && (
        <p className="text-xs text-[#E4574A] mb-3">{ERROR_LABEL[oauthError] ?? 'เกิดข้อผิดพลาด'}</p>
      )}

      {/* แถวสถานะ */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {confirmed
            ? <CheckCircle2 size={16} style={{ color: ACCENT }} />
            : <Circle size={16} className="text-[#8A8178]" />}
          <span className="text-sm">
            {confirmed ? 'เดินแล้ววันนี้' : 'ยังไม่เช็ควันนี้'}
            {confirmed && localCheck?.manual_override && !localCheck?.strava_confirmed && (
              <span className="text-[10px] text-[#8A8178] ml-1">(ยืนยันเอง)</span>
            )}
          </span>
        </div>
        {!confirmed && (
          connected ? (
            <button onClick={checkFromStrava} disabled={checking}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
              style={{ background: ACCENT, color: '#171412' }}>
              {checking ? 'กำลังเช็ค...' : 'เช็คจาก Strava'}
            </button>
          ) : (
            <a href="/api/strava/auth"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#332D28]">
              เชื่อม Strava
            </a>
          )
        )}
      </div>
      {checkError && <p className="text-xs text-[#E4574A] mb-2">{checkError}</p>}

      <label className="flex items-center gap-2 mb-4 text-xs text-[#8A8178]">
        <input type="checkbox" checked={!!localCheck?.manual_override} onChange={toggleManualOverride} />
        ยืนยันเอง (ไม่ผ่าน Strava)
      </label>

      {/* block breakdown — list row ตาม design.md ไม่ใช่กรอบซ้อนกรอบ */}
      <div className="divide-y divide-[#332D28] mb-4">
        {(['warmup', 'cooldown'] as const).map(block => {
          const exercises = block === 'warmup' ? warmupExercises : cooldownExercises
          const label = block === 'warmup' ? 'วอร์มอัพ' : 'คูลดาวน์'
          const open = manageOpen[block]
          return (
            <div key={block}>
              <BlockRow label={label} count={exercises.length} color={ACCENT}
                timeLabel={exercises.length > 0 ? fmtMinutes(estimateSeconds(exercises)) : undefined}
                action={
                  <button onClick={() => setManageOpen(p => ({ ...p, [block]: !p[block] }))}
                    className="flex items-center gap-1 text-[10px] text-[#8A8178] flex-shrink-0">
                    <Settings2 size={11} /> {open ? 'ปิด' : 'จัดการ'}
                  </button>
                } />
              {open && (
                <div className="pb-3 pl-3">
                  <ManageMorningWalkExercises block={block} exercises={exercises} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ปุ่ม outline — การ์ดนี้มี accent ของตัวเองแล้ว ปุ่มทึบจะแย่งซีนเกิน */}
      <div className="flex gap-2">
        <button onClick={() => startBlock('warmup')} disabled={warmupExercises.length === 0}
          className="flex-1 min-h-[44px] rounded-lg border text-sm font-semibold disabled:opacity-40"
          style={{ borderColor: ACCENT, color: ACCENT }}>
          ▶ วอร์ม
        </button>
        <button onClick={() => startBlock('cooldown')} disabled={cooldownExercises.length === 0}
          className="flex-1 min-h-[44px] rounded-lg border text-sm font-semibold disabled:opacity-40"
          style={{ borderColor: ACCENT, color: ACCENT }}>
          ▶ คูล
        </button>
      </div>
    </div>
  )
}
