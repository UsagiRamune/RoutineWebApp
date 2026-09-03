import { createClient } from '@/lib/supabase/server'
import { Module, WaterContainer } from '@/lib/supabase/types'
import { todayKey, dateKeyOffset, getRolloverHour, TZ } from '@/lib/dates'
import { weightAsOf } from '@/lib/nutrition'
import { moduleLabel } from '@/lib/moduleLabels'
import AppNav from '@/components/AppNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import ModuleCard from '@/components/dashboard/ModuleCard'
import CalendarCard from '@/components/dashboard/CalendarCard'
import Hero from '@/components/dashboard/Hero'
import Link from 'next/link'

export default async function Dashboard() {
  const supabase = await createClient()
  const rollover = await getRolloverHour(supabase)
  const today = todayKey(rollover)
  const weekStart = dateKeyOffset(-6, rollover)
  const yesterday = dateKeyOffset(-1, rollover)

  const [
    modulesRes, categoriesRes, weekEntriesRes, foodRes, waterRes, ifRes, profileRes, healthRes,
    latestWeightRes, weightWindowRes, containersRes, appSettingsRes,
  ] = await Promise.all([
    supabase.from('modules').select('*').eq('enabled', true).order('sort_order'),
    supabase.from('routine_categories').select(`
      kind,
      routines (
        is_active,
        routine_items ( is_active, item_completions ( date ) ),
        time_entries ( date, clock_in, clock_out )
      )
    `),
    supabase.from('time_entries').select('date, clock_in, clock_out').gte('date', weekStart),
    supabase.from('food_entries').select('calories, protein_g').eq('date', today),
    supabase.from('water_entries').select('ml, created_at').eq('date', today).order('created_at'),
    supabase.from('if_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('nutrition_profile').select('*').eq('id', 1).maybeSingle(),
    supabase.from('health_daily').select('date, steps, calories_burned').in('date', [today, yesterday]),
    supabase.from('body_metrics').select('date, weight_kg')
      .not('weight_kg', 'is', null).order('date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('body_metrics').select('date, weight_kg').gte('date', dateKeyOffset(-10, rollover)).order('date'),
    supabase.from('water_containers').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
  ])

  const modules = (modulesRes.data ?? []) as Module[]

  // ---- routine: checklist วันนี้ + นาทีที่จับเวลารวม ----
  let checklistDone = 0, checklistTotal = 0, trackedMins = 0
  for (const cat of categoriesRes.data ?? []) {
    for (const r of ((cat.routines ?? []) as any[]).filter(r => r.is_active)) {
      if (cat.kind === 'checklist') {
        for (const item of (r.routine_items ?? []).filter((i: any) => i.is_active)) {
          checklistTotal++
          if ((item.item_completions ?? []).some((c: any) => c.date === today)) checklistDone++
        }
      } else {
        for (const e of (r.time_entries ?? []).filter((e: any) => e.date === today)) {
          const start = new Date(e.clock_in).getTime()
          const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now()
          trackedMins += Math.max(0, Math.floor((end - start) / 60000))
        }
      }
    }
  }

  // ---- history: ชั่วโมงรวมสัปดาห์นี้ ----
  let weekMins = 0
  for (const e of weekEntriesRes.data ?? []) {
    if (!e.clock_out) continue
    weekMins += Math.max(0, Math.floor(
      (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 60000))
  }

  // ---- nutrition ----
  const caloriesEaten = (foodRes.data ?? []).reduce((s, f) => s + (f.calories ?? 0), 0)
  const proteinEaten = (foodRes.data ?? []).reduce((s, f) => s + (f.protein_g ?? 0), 0)
  const waterEntries = waterRes.data ?? []
  const waterMlToday = waterEntries.reduce((s, w) => s + (w.ml ?? 0), 0)
  const ifSettings = ifRes.data
  const profile = profileRes.data
  const plan = profile?.plan ?? 'normal'
  const caloriesTarget = profile?.daily_calories ?? null
  const proteinTarget = profile?.daily_protein_g ?? null
  const waterTargetMl = profile?.daily_water_ml ?? 4000
  const mlPerSip = profile?.ml_per_sip ?? 37
  const proteinGapVal = proteinTarget !== null ? proteinTarget - proteinEaten : null

  const appSettings = appSettingsRes.data
  const windowHours = appSettings?.water_window_hours ?? 13
  const frontloadRatio = appSettings?.water_frontload_ratio ?? 0.30
  const assumedSleepHours = appSettings?.assumed_sleep_hours ?? 8

  // ---- ร่างกาย: น้ำหนักล่าสุด + เทียบ 7 วันก่อน, ก้าววันนี้ ----
  const latestWeight = latestWeightRes.data?.weight_kg ?? null
  const weight7 = weightAsOf(dateKeyOffset(-7, rollover), weightWindowRes.data ?? [])
  const weightDelta7 = (latestWeight != null && weight7 != null) ? latestWeight - weight7 : null
  const healthRows = healthRes.data ?? []
  const todayHealthRow = healthRows.find(r => r.date === today)
  const stepsToday = todayHealthRow?.steps ?? null

  const todayLabel = new Date().toLocaleDateString('th-TH', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ,
  })

  return (
    <>
      <AppNav />
      <RealtimeRefresher />
      <main className="min-h-screen bg-[#14171F] text-[#EDEAE0] pb-16">
        <Hero
          today={today}
          todayLabel={todayLabel}
          caloriesEaten={caloriesEaten}
          caloriesTarget={caloriesTarget}
          proteinEaten={proteinEaten}
          proteinTarget={proteinTarget}
          waterMlToday={waterMlToday}
          waterTargetMl={waterTargetMl}
          mlPerSip={mlPerSip}
          windowHours={windowHours}
          frontloadRatio={frontloadRatio}
          assumedSleepHours={assumedSleepHours}
          containers={(containersRes.data ?? []) as WaterContainer[]}
          ifSettings={ifSettings}
          latestWeight={latestWeight}
          weightDelta7={weightDelta7}
          stepsToday={stepsToday}
          plan={plan}
        />

        <div className="max-w-5xl mx-auto px-4">
          <h1 className="text-xl font-semibold mb-6">แดชบอร์ด</h1>

          {modules.length === 0 && (
            <p className="text-sm text-[#7C8394]">
              ยังไม่มีโมดูลเปิดใช้งาน — ไปเปิดที่ <Link href="/settings" className="underline">ตั้งค่า</Link>
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {modules.map(m => {
              if (m.key === 'routine') {
                return (
                  <ModuleCard key={m.key} href="/routine" title={moduleLabel(m)}>
                    <p className="text-2xl font-semibold">{checklistDone}/{checklistTotal}</p>
                    <p className="text-xs text-[#7C8394] mt-1">
                      เช็คลิสต์วันนี้ · จับเวลารวม {(trackedMins / 60).toFixed(1)} ชม.
                    </p>
                  </ModuleCard>
                )
              }
              if (m.key === 'calendar') {
                return <CalendarCard key={m.key} title={moduleLabel(m)} />
              }
              if (m.key === 'nutrition') {
                const gapText = proteinGapVal !== null && proteinGapVal > 0
                  ? `โปรตีนขาด ${Math.round(proteinGapVal)} ก.`
                  : `น้ำ ${(waterMlToday / 1000).toFixed(1)}/${(waterTargetMl / 1000).toFixed(1)} ล.`
                return (
                  <ModuleCard key={m.key} href="/nutrition" title={moduleLabel(m)}>
                    <p className="text-2xl font-semibold">
                      {Math.round(caloriesEaten)} <span className="text-sm font-normal text-[#7C8394]">kcal</span>
                    </p>
                    <p className="text-xs text-[#7C8394] mt-1">{gapText}</p>
                  </ModuleCard>
                )
              }
              if (m.key === 'history') {
                return (
                  <ModuleCard key={m.key} href="/history" title={moduleLabel(m)}>
                    <p className="text-2xl font-semibold">
                      {(weekMins / 60).toFixed(1)} <span className="text-sm font-normal text-[#7C8394]">ชม.</span>
                    </p>
                    <p className="text-xs text-[#7C8394] mt-1">รวมชั่วโมงจับเวลาสัปดาห์นี้</p>
                  </ModuleCard>
                )
              }
              if (m.key === 'health') {
                // เช็คว่าชั่งวันนี้จริงไหม (ไม่ใช่แค่มีน้ำหนักล่าสุดจากวันก่อนๆ)
                const weighedToday = (weightWindowRes.data ?? []).some(w => w.date === today && w.weight_kg != null)
                return (
                  <ModuleCard key={m.key} href="/health" title={moduleLabel(m)}>
                    <p className="text-lg font-semibold">
                      {weighedToday && latestWeight != null
                        ? `ชั่งแล้ว ${latestWeight.toFixed(1)} กก.`
                        : 'ยังไม่ชั่งวันนี้'}
                    </p>
                    {stepsToday != null && (
                      <p className="text-xs text-[#7C8394] mt-1">{stepsToday} ก้าว</p>
                    )}
                  </ModuleCard>
                )
              }
              return (
                <div key={m.key}
                  className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 opacity-50">
                  <p className="text-sm font-medium mb-2">{moduleLabel(m)}</p>
                  <p className="text-xs text-[#7C8394]">เร็วๆ นี้</p>
                </div>
              )
            })}
          </div>
        </div>
      </main>
    </>
  )
}
