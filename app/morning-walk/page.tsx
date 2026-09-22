import { createClient } from '@/lib/supabase/server'
import { requireModuleEnabled } from '@/lib/modules'
import { getRolloverHour, todayKey } from '@/lib/dates'
import { MorningWalkCheck, MorningWalkExercise, StravaConnection } from '@/lib/supabase/types'
import AppNav from '@/components/AppNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import MorningWalkSection from '@/components/morningwalk/MorningWalkSection'

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
      {/* MorningWalkSection ห่อกรอบการ์ดของตัวเองไว้แล้ว (ใช้ร่วมกับที่ฝังใน WorkoutLanding.tsx) —
          หน้านี้แค่ให้ page shell + จำกัดความกว้างอ่านสบายตอนมาเป็นการ์ดเดี่ยวเต็มหน้า */}
      <main className="min-h-screen bg-[#171412] text-[#EDEAE0] pb-16">
        <div className="max-w-2xl mx-auto px-4 pt-8">
          <h1 className="text-xl font-semibold mb-4">🚶 เดินเช้า</h1>
          <MorningWalkSection
            today={today}
            connected={!!conn?.access_token}
            check={checkRes.data as MorningWalkCheck | null}
            warmupExercises={allExercises.filter(e => e.block === 'warmup')}
            cooldownExercises={allExercises.filter(e => e.block === 'cooldown')}
            oauthError={error ?? null}
          />
        </div>
      </main>
    </>
  )
}
