import { createClient } from '@/lib/supabase/server'
import {
  FoodEntry, WaterEntry, IfSettings, NutritionProfile,
} from '@/lib/supabase/types'
import AppNav from '@/components/AppNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import NutritionView from '@/components/nutrition/NutritionView'
import { todayKey } from '@/lib/dates'
import { requireModuleEnabled } from '@/lib/modules'

export default async function NutritionPage() {
  await requireModuleEnabled('nutrition')

  const supabase = await createClient()
  const today = todayKey()

  const [foodRes, waterRes, ifRes, profileRes] = await Promise.all([
    supabase.from('food_entries').select('*').eq('date', today).order('created_at'),
    supabase.from('water_entries').select('*').eq('date', today).order('created_at'),
    supabase.from('if_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('nutrition_profile').select('*').eq('id', 1).maybeSingle(),
  ])

  return (
    <>
      <AppNav />
      <RealtimeRefresher />
      <NutritionView
        today={today}
        entries={(foodRes.data ?? []) as FoodEntry[]}
        waterEntries={(waterRes.data ?? []) as WaterEntry[]}
        ifSettings={ifRes.data as IfSettings | null}
        profile={profileRes.data as NutritionProfile | null}
      />
    </>
  )
}
