import { createClient } from '@/lib/supabase/server'
import { requireModuleEnabled } from '@/lib/modules'
import { getRolloverHour, todayKey } from '@/lib/dates'
import { MorningWalkCheck, MorningWalkExercise, StravaConnection } from '@/lib/supabase/types'
import AppNav from '@/components/AppNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import MorningWalkView from '@/components/morningwalk/MorningWalkView'

// searchParams ใน Next.js 15+ เป็น Promise ต้อง await
interface Props {
  searchParams: Promise<{ error?: string }>
}

export default async function MorningWalkPage({ searchParams }: Props) {
  // ผูกกับ toggle โมดูล "workout" — เดินเช้าเป็นฟีเจอร์ในร่มเดียวกับออกกำลังกาย ไม่แยกโมดูลใหม่
  await requireModuleEnabled('workout')
  const { error } = await searchParams

  const supabase = await createClient()
  const rollover = await getRolloverHour(supabase)
  const today = todayKey(rollover)

  const [connRes, checkRes, exercisesRes] = await Promise.all([
    supabase.from('strava_connections').select('*').eq('id', 1).maybeSingle(),
    supabase.from('morning_walk_checks').select('*').eq('date', today).maybeSingle(),
    supabase.from('morning_walk_exercises').select('*').order('block').order('sort_order'),
  ])

  const conn = connRes.data as StravaConnection | null
  const allExercises = (exercisesRes.data ?? []) as MorningWalkExercise[]

  return (
    <>
      <AppNav />
      <RealtimeRefresher />
      <MorningWalkView
        today={today}
        connected={!!conn?.access_token}
        check={checkRes.data as MorningWalkCheck | null}
        warmupExercises={allExercises.filter(e => e.block === 'warmup')}
        cooldownExercises={allExercises.filter(e => e.block === 'cooldown')}
        oauthError={error ?? null}
      />
    </>
  )
}
