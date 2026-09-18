import React from 'react'
import { createClient } from '@/lib/supabase/server'
import { Module, WaterContainer } from '@/lib/supabase/types'
import { todayKey, dateKeyOffset, getRolloverHour, bangkokNow, TZ } from '@/lib/dates'
import { weightAsOf } from '@/lib/nutrition'
import { moduleLabel } from '@/lib/moduleLabels'
import AppNav from '@/components/AppNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import ModuleCard from '@/components/dashboard/ModuleCard'
import BentoCalendarCard from '@/components/dashboard/BentoCalendarCard'
import BentoProjectsCard from '@/components/dashboard/BentoProjectsCard'
import Hero from '@/components/dashboard/Hero'

import Link from 'next/link'

export default async function Dashboard() {
  const supabase = await createClient()
  const rollover = await getRolloverHour(supabase)
  const today = todayKey(rollover)
  const weekStart = dateKeyOffset(-6, rollover)
  const yesterday = dateKeyOffset(-1, rollover)
  const { weekday } = bangkokNow()

  const [
    modulesRes, categoriesRes, weekEntriesRes, foodRes, waterRes, ifRes, profileRes, healthRes,
    latestWeightRes, weightWindowRes, containersRes, appSettingsRes, workoutDayRes, workoutSessionRes,
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
    supabase.from('workout_days').select('label, kind').eq('day_of_week', weekday).maybeSingle(),
    // ใช้ order+limit(1) แทน .eq('date',today).maybeSingle() เฉยๆ — กันพังถ้าวันเดียวกันมีมากกว่า 1 แถว
    // (เช่นเริ่มใหม่หลังกด "จบตอนนี้" ไปแล้ว) เอาแถวล่าสุดพอ
    supabase.from('workout_sessions').select('completed_at, active_minutes')
      .eq('date', today).order('started_at', { ascending: false }).limit(1).maybeSingle(),
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
  const stepsGoal = profile?.daily_steps_goal ?? 6000
  const caloriesBurnedGoal = profile?.daily_active_calories_goal ?? 700

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
  const caloriesBurnedToday = todayHealthRow?.calories_burned ?? null
  const bmrKcal = profile?.bmr_kcal ?? null

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
          stepsGoal={stepsGoal}
          caloriesBurnedGoal={caloriesBurnedGoal}
          plan={plan}
          bmrKcal={bmrKcal}
          caloriesBurnedToday={caloriesBurnedToday}
        />

        {/* ───── Bento Grid — module section ───── */}
        {/* layout pass: สร้าง Bento composition ตาม design.md hierarchy (calendar ใหญ่สุด, routine เล็กสุด) */}
        {/* desktop: 4-col grid / tablet: 2-col / mobile: 1-col — ดูรายละเอียดแต่ละ breakpoint ด้านล่าง */}
        <div className="max-w-5xl mx-auto px-4">
          <p className="text-[11px] text-[#7C8394] tracking-[0.05em] uppercase mb-3">โมดูล</p>

          {modules.length === 0 && (
            <p className="text-sm text-[#7C8394] py-4">
              ยังไม่มีโมดูลเปิดใช้งาน — ไปเปิดที่ <Link href="/settings" className="underline">ตั้งค่า</Link>
            </p>
          )}

          {modules.length > 0 && (() => {
            // ดึง module แต่ละตัวออกมาก่อน (preserve ordering semantics จาก DB)
            // ถ้าโมดูลไม่ได้เปิดใน settings จะไม่ปรากฏใน modules array เลย (filtered ก่อนมาถึงนี้)
            const getModule = (key: string) => modules.find(m => m.key === key)

            const calMod    = getModule('calendar')
            const nutritMod = getModule('nutrition')
            const healthMod = getModule('health')
            const projMod   = getModule('projects')
            const workMod   = getModule('workout')
            const histMod   = getModule('history')
            const routMod   = getModule('routine')

            const wDay = workoutDayRes.data
            const wSession = workoutSessionRes.data
            const isRest = !wDay || wDay.kind === 'rest'
            const weighedToday = (weightWindowRes.data ?? []).some(w => w.date === today && w.weight_kg != null)
            const showWater = !(proteinGapVal !== null && proteinGapVal > 0)
            const nutritSecondary = showWater
              ? `น้ำ ${(waterMlToday / 1000).toFixed(1)}/${(waterTargetMl / 1000).toFixed(1)} ล.`
              : `โปรตีนขาด ${Math.round(proteinGapVal ?? 0)} ก.`

            // โมดูลที่ไม่มีใน KNOWN_KEYS → fallback tile (opacity ลด บอกว่ายังไม่รองรับ)
            const KNOWN_KEYS = new Set(['calendar','nutrition','health','projects','workout','history','routine'])
            const unknownModules = modules.filter(m => !KNOWN_KEYS.has(m.key))

            return (
              <>
                {/*
                  ┌─────────────────────────────────┬──────────────────────┐  desktop 4-col
                  │                                 │    NUTRITION (1×1)   │
                  │       CALENDAR (2×2)            ├──────────────────────┤
                  │                                 │    HEALTH (1×1)      │
                  ├──────────────────┬──────────────┴──────────────────────┤
                  │   PROJECTS (2×1) │         WORKOUT (2×1)               │
                  ├──────────────────┼─────────────────────────────────────┤
                  │   HISTORY (2×1)  │         ROUTINE (2×1)               │
                  └──────────────────┴─────────────────────────────────────┘

                  tablet 2-col: Calendar top full-width, ที่เหลือ 2-col ตาม priority
                  mobile: 1-col stack ทั้งหมด calendar อยู่บนสุด
                */}

                {/* Row 1+2: Calendar (anchor) + Nutrition + Health */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">

                  {/* CALENDAR — largest tile: col-span-2 row-span-2 on lg, full-width on sm, normal on mobile */}
                  {calMod && (
                    <BentoCalendarCard
                      title={moduleLabel(calMod)}
                      className="sm:col-span-2 lg:col-span-2 lg:row-span-2 min-h-[180px]"
                    />
                  )}

                  {/* NUTRITION — medium tile: right column top on lg */}
                  {nutritMod && (
                    <ModuleCard
                      href="/nutrition"
                      title={moduleLabel(nutritMod)}
                      moduleKey="nutrition"
                      className="lg:col-span-2"
                    >
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="font-mono text-2xl font-semibold">
                          {Math.round(caloriesEaten)}
                        </span>
                        <span className="text-xs text-[#7C8394]">kcal</span>
                      </div>
                      <p className="text-xs text-[#7C8394] mt-1">{nutritSecondary}</p>
                    </ModuleCard>
                  )}

                  {/* HEALTH — medium tile: right column bottom on lg */}
                  {healthMod && (
                    <ModuleCard
                      href="/health"
                      title={moduleLabel(healthMod)}
                      moduleKey="health"
                      className="lg:col-span-2"
                    >
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <div>
                          <span className="font-mono text-2xl font-semibold">
                            {weighedToday && latestWeight != null ? latestWeight.toFixed(1) : '—'}
                          </span>
                          <span className="text-xs text-[#7C8394] ml-1">กก.</span>
                        </div>
                        {stepsToday != null && (
                          <div className="border-l border-[#2A2F3D] pl-3">
                            <span className="font-mono text-lg font-semibold">
                              {stepsToday.toLocaleString()}
                            </span>
                            <span className="text-xs text-[#7C8394] ml-1">ก้าว</span>
                          </div>
                        )}
                      </div>
                      {!weighedToday && (
                        <p className="text-xs text-[#7C8394] mt-1">ยังไม่ชั่งวันนี้</p>
                      )}
                    </ModuleCard>
                  )}
                </div>

                {/* Row 3: Projects (wide) + Workout */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  {projMod && (
                    <BentoProjectsCard
                      title={moduleLabel(projMod)}
                      weekStart={weekStart}
                    />
                  )}

                  {workMod && (
                    <ModuleCard
                      href="/workout"
                      title={moduleLabel(workMod)}
                      moduleKey="workout"
                    >
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-sm font-medium">{wDay?.label ?? '—'}</span>
                        {isRest ? (
                          <span className="text-xs text-[#7C8394]">วันพัก</span>
                        ) : wSession?.completed_at ? (
                          <span className="text-xs text-[#4FC1E0]">
                            เล่นแล้ว <span className="font-mono">{wSession.active_minutes ?? '?'}</span> นาที ✓
                          </span>
                        ) : wSession ? (
                          <span className="text-xs text-[#F0A345]">เล่นค้างไว้</span>
                        ) : (
                          <span className="text-xs text-[#7C8394]">ยังไม่ได้เล่น</span>
                        )}
                      </div>
                    </ModuleCard>
                  )}
                </div>

                {/* Row 4: History + Routine (lower priority — smaller visual weight) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  {histMod && (
                    <ModuleCard
                      href="/history"
                      title={moduleLabel(histMod)}
                      moduleKey="history"
                    >
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="font-mono text-xl font-semibold">
                          {(weekMins / 60).toFixed(1)}
                        </span>
                        <span className="text-xs text-[#7C8394]">ชม. สัปดาห์นี้</span>
                      </div>
                    </ModuleCard>
                  )}

                  {/* ROUTINE — intentionally lower priority: same tile size as History, no SegmentedBar here */}
                  {routMod && (
                    <ModuleCard
                      href="/routine"
                      title={moduleLabel(routMod)}
                      moduleKey="routine"
                    >
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="font-mono text-xl font-semibold">
                          {checklistDone}/{checklistTotal}
                        </span>
                        <span className="text-xs text-[#7C8394]">เช็คลิสต์</span>
                        {trackedMins > 0 && (
                          <span className="text-xs text-[#7C8394]">
                            · <span className="font-mono">{(trackedMins / 60).toFixed(1)}</span> ชม.
                          </span>
                        )}
                      </div>
                    </ModuleCard>
                  )}
                </div>

                {/* Fallback: โมดูลที่ไม่รู้จัก — แสดงแบบ dimmed ไม่โยน error */}
                {unknownModules.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {unknownModules.map(m => (
                      <div key={m.key}
                        className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 opacity-40">
                        <p className="text-[11px] text-[#7C8394] tracking-[0.05em] uppercase">{moduleLabel(m)}</p>
                        <p className="text-xs text-[#7C8394] mt-1">เร็วๆ นี้</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      </main>
    </>
  )
}
