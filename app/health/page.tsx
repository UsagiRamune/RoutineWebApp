import { createClient } from '@/lib/supabase/server'
import {
  HealthDaily, BodyMetric, Supplement, SupplementLog, NutritionProfile,
} from '@/lib/supabase/types'
import AppNav from '@/components/AppNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import BodyView from '@/components/health/BodyView'
import { todayKey, dateKeyOffset, getRolloverHour } from '@/lib/dates'
import { requireModuleEnabled } from '@/lib/modules'

export default async function HealthPage() {
  await requireModuleEnabled('health')

  const supabase = await createClient()
  const rollover = await getRolloverHour(supabase)
  const today = todayKey(rollover)
  const from40 = dateKeyOffset(-39, rollover) // ครอบ 30 วันสำหรับกราฟ + เผื่อหา "30 วันก่อน" ย้อนไปอีกหน่อย
  const from14 = dateKeyOffset(-13, rollover)

  const [metricsRes, healthRes, latestHeightRes, supplementsRes, supplementLogsRes, profileRes] =
    await Promise.all([
      supabase.from('body_metrics').select('*').gte('date', from40).order('date'),
      supabase.from('health_daily').select('*').gte('date', from14).order('date'),
      supabase.from('body_metrics').select('height_cm')
        .not('height_cm', 'is', null).order('date', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('supplements').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('supplement_logs').select('*').eq('date', today),
      supabase.from('nutrition_profile').select('*').eq('id', 1).maybeSingle(),
    ])

  return (
    <>
      <AppNav />
      <RealtimeRefresher />
      <BodyView
        today={today}
        metrics={(metricsRes.data ?? []) as BodyMetric[]}
        health={(healthRes.data ?? []) as HealthDaily[]}
        latestHeight={latestHeightRes.data?.height_cm ?? null}
        supplements={(supplementsRes.data ?? []) as Supplement[]}
        supplementLogs={(supplementLogsRes.data ?? []) as SupplementLog[]}
        plan={(profileRes.data as NutritionProfile | null)?.plan ?? 'normal'}
      />
    </>
  )
}
