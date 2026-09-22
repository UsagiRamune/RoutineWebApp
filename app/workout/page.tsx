import { createClient } from '@/lib/supabase/server'
import { requireModuleEnabled } from '@/lib/modules'
import { bangkokNow, getRolloverHour, todayKey } from '@/lib/dates'
import {
  WorkoutDayWithExercises, WorkoutSessionWithDay,
  MorningWalkCheck, MorningWalkExercise, StravaConnection,
} from '@/lib/supabase/types'
import AppNav from '@/components/AppNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import WorkoutLanding from '@/components/workout/WorkoutLanding'

export default async function WorkoutPage() {
  await requireModuleEnabled('workout')

  const supabase = await createClient()
  const rollover = await getRolloverHour(supabase)
  const today = todayKey(rollover)
  const { weekday: todayWeekday } = bangkokNow() // 0=อาทิตย์ ตรงกับ workout_days.day_of_week

  // ดึงทั้ง 7 วัน (ข้อมูลเล็ก ไม่ต้อง paginate) ให้ผู้ใช้เลือกดู/เล่นวันอื่นได้ ไม่ผูกกับ weekday จริงวันนี้
  // อย่างเดียว — มีประโยชน์ตอนทดสอบ หรือย้อนเล่นโปรแกรมที่พลาดไป
  const [
    daysRes, historyRes, incompleteRes, connRes, morningCheckRes, morningExercisesRes,
  ] = await Promise.all([
    supabase.from('workout_days').select(`
      *, workout_exercises ( * )
    `).order('day_of_week')
      .order('sort_order', { referencedTable: 'workout_exercises' }),
    supabase.from('workout_sessions').select('*, workout_days ( label, kind )')
      .order('date', { ascending: false }).limit(8),
    // เซสชันของ "วันนี้" (date จริง) ที่ยังไม่จบ — จงใจดูแค่วันนี้เท่านั้น ไม่ย้อนหาของหลายวันก่อน
    // (เหตุผลเต็มอยู่ใน WorkoutLanding.tsx) เอาแถวล่าสุดถ้ามีมากกว่า 1 แถว
    supabase.from('workout_sessions')
      .select('id, day_id, started_at, exercises_done, exercises_skipped')
      .eq('date', today).is('completed_at', null)
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    // การ์ด "เช้า" ฝังอยู่ในหน้านี้แล้ว (MorningWalkSection.tsx ตัวเดียวกับ /morning-walk) ต้องดึงข้อมูล
    // ชุดเดียวกับที่หน้านั้นดึงมาด้วย
    supabase.from('strava_connections').select('*').eq('id', 1).maybeSingle(),
    supabase.from('morning_walk_checks').select('*').eq('date', today).maybeSingle(),
    supabase.from('morning_walk_exercises').select('*').order('block').order('sort_order'),
  ])

  const conn = connRes.data as StravaConnection | null
  const allMorningExercises = (morningExercisesRes.data ?? []) as MorningWalkExercise[]

  return (
    <>
      <AppNav />
      <RealtimeRefresher />
      <WorkoutLanding
        days={(daysRes.data ?? []) as WorkoutDayWithExercises[]}
        history={(historyRes.data ?? []) as WorkoutSessionWithDay[]}
        today={today}
        todayWeekday={todayWeekday}
        incompleteSession={incompleteRes.data}
        morningConnected={!!conn?.access_token}
        morningCheck={morningCheckRes.data as MorningWalkCheck | null}
        warmupExercises={allMorningExercises.filter(e => e.block === 'warmup')}
        cooldownExercises={allMorningExercises.filter(e => e.block === 'cooldown')}
      />
    </>
  )
}
