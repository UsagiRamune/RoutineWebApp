import { createClient } from '@/lib/supabase/server'
import { CategoryWithRoutines } from '@/lib/supabase/types'
import TodayView from '@/components/TodayView'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import AppNav from '@/components/AppNav'
import { todayKey, getRolloverHour } from '@/lib/dates'
import { requireModuleEnabled } from '@/lib/modules'

export default async function RoutinePage() {
  await requireModuleEnabled('routine')

  const supabase = await createClient()
  const rollover = await getRolloverHour(supabase)
  const today = todayKey(rollover) // ได้ "2026-09-01" ตาม Asia/Bangkok + day_rollover_hour เสมอ

  const { data: categories, error } = await supabase
    .from('routine_categories')
    .select(`
      *,
      routines (
        *,
        routine_items (*, item_completions (*)),
        time_entries (*),
        daily_targets (*)
      )
    `)
    .order('sort_order')

  if (error) {
    return (
      <main className="min-h-screen bg-[#14171F] flex items-center justify-center">
        <p className="text-[#E4574A] text-sm">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>
      </main>
    )
  }

  return (
    <>
      <AppNav />
      <RealtimeRefresher />
      <TodayView
        categories={(categories ?? []) as CategoryWithRoutines[]}
        today={today}
      />
    </>
  )
}
