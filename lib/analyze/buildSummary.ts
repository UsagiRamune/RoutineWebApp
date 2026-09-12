// รวมข้อมูล routine/nutrition/sleep/body ช่วง N วันล่าสุด แล้วให้ AI วิเคราะห์เป็นข้อความ
// แยกจาก app/api/analyze/route.ts เพื่อให้ weekly cron เรียกใช้ตรรกะเดียวกันได้ (ไม่มี user session)
import { geminiProvider } from '@/lib/ai/gemini'
import { AiProvider } from '@/lib/ai/provider'
import { dateKeyOffset } from '@/lib/dates'

const providers: Record<string, AiProvider> = {
  gemini: geminiProvider,
}
const provider = providers[process.env.AI_PROVIDER ?? 'gemini']

export async function buildAnalysisSummary(supabase: any, days: number, rollover: number): Promise<string> {
  const fromStr = dateKeyOffset(-Math.min(days, 90), rollover) // จำกัด 90 วัน กัน prompt บวม

  const [entries, completions, metrics, categories,
    foodEntries, waterEntries, supplementLogs, supplements, ifSettingsRes, nutritionProfileRes,
    healthDaily, activeProjects, projectRoutines, workoutDaysRes, workoutSessionsRes,
    workoutExercisesRes] = await Promise.all([
    supabase.from('time_entries')
      .select('routine_id, date, clock_in, clock_out, details, routines(name, category_id, default_target_minutes)')
      .gte('date', fromStr).not('clock_out', 'is', null),
    supabase.from('item_completions')
      .select('date, routine_items(name, routine_id)')
      .gte('date', fromStr),
    supabase.from('body_metrics').select('*').gte('date', fromStr).order('date'),
    supabase.from('routine_categories').select('id, name, kind'),
    supabase.from('food_entries').select('date, calories, protein_g').gte('date', fromStr),
    supabase.from('water_entries').select('date, ml').gte('date', fromStr),
    supabase.from('supplement_logs').select('date, supplement_id').gte('date', fromStr),
    supabase.from('supplements').select('id, name').eq('is_active', true),
    supabase.from('if_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('nutrition_profile').select('*').eq('id', 1).maybeSingle(),
    supabase.from('health_daily').select('date, steps, calories_burned, sleep_minutes, source').gte('date', fromStr),
    supabase.from('projects').select(`
      id, name,
      project_fields ( project_tasks ( status, completed_at, project_work_logs ( date, minutes ) ) )
    `).eq('status', 'active'),
    supabase.from('routines').select('id, name, project_id').not('project_id', 'is', null),
    supabase.from('workout_days').select('day_of_week, label, kind'),
    supabase.from('workout_sessions')
      .select('date, completed_at, active_minutes, exercises_skipped').gte('date', fromStr),
    supabase.from('workout_exercises').select('id, name'),
  ])

  // ---- ย่อยข้อมูลฝั่ง server ให้เหลือแต่แก่น (ประหยัด token + โมเดลอ่านง่าย) ----

  const catName = new Map((categories.data ?? []).map((c: any) => [c.id, c.name]))
  const profile = nutritionProfileRes.data

  const lines: string[] = []
  const byRoutineDay = new Map<string, Map<string, number>>()
  for (const e of entries.data ?? []) {
    const r = e.routines as any
    if (!r) continue
    const key = `${r.name} (${catName.get(r.category_id) ?? '?'}, เป้า ${
      r.default_target_minutes ?? 'ไม่ตั้ง'} นาที/วัน)`
    const mins = Math.max(0, Math.floor(
      (new Date(e.clock_out!).getTime() - new Date(e.clock_in).getTime()) / 60000))
    if (!byRoutineDay.has(key)) byRoutineDay.set(key, new Map())
    const m = byRoutineDay.get(key)!
    m.set(e.date, (m.get(e.date) ?? 0) + mins)
  }
  for (const [routine, dayMap] of byRoutineDay) {
    const daysArr = [...dayMap.entries()].sort()
    const total = daysArr.reduce((s, [, m]) => s + m, 0)
    lines.push(`## ${routine}`)
    lines.push(`รวม ${total} นาที ใน ${daysArr.length} วันที่ทำ`)
    lines.push(daysArr.map(([d, m]) => `${d}: ${m} นาที`).join(', '))
  }

  const checkByDay = new Map<string, string[]>()
  for (const c of completions.data ?? []) {
    const name = (c.routine_items as any)?.name
    if (!name) continue
    if (!checkByDay.has(c.date)) checkByDay.set(c.date, [])
    checkByDay.get(c.date)!.push(name)
  }
  if (checkByDay.size > 0) {
    lines.push('## Checklist ที่ติ๊กต่อวัน')
    for (const [d, items] of [...checkByDay.entries()].sort()) {
      lines.push(`${d}: ${items.join(', ')}`)
    }
  }

  if ((metrics.data ?? []).length > 0) {
    lines.push('## บันทึกร่างกาย')
    for (const m of metrics.data!) {
      lines.push(`${m.date}: ${m.weight_kg ?? '?'} กก.${m.note ? ` (${m.note})` : ''}`)
    }

    const weightEntries = (metrics.data ?? []).filter((m: any) => m.weight_kg != null)
    if (weightEntries.length > 0) {
      const current = weightEntries[weightEntries.length - 1]
      const first = weightEntries[0]
      const delta = weightEntries.length > 1 ? current.weight_kg! - first.weight_kg! : null
      const planLabels: Record<string, string> = { cut: 'ลดน้ำหนัก', normal: 'ใช้ชีวิตปกติ', bulk: 'สร้างกล้าม' }
      const planLabel = planLabels[profile?.plan ?? 'normal']
      lines.push('## แนวโน้มน้ำหนัก')
      lines.push(`น้ำหนักล่าสุด: ${current.weight_kg} กก. (${current.date})`)
      if (delta != null) {
        lines.push(`เปลี่ยนแปลงตลอดช่วงที่วิเคราะห์ (${first.date} → ${current.date}): ` +
          `${delta > 0 ? '+' : ''}${delta.toFixed(1)} กก.`)
      }
      lines.push(`แผนปัจจุบัน: ${planLabel} — ใช้เทียบว่าทิศทางน้ำหนักที่เปลี่ยนไปสอดคล้องกับเป้าหมายนี้ไหม ` +
        `(ลดน้ำหนัก = ควรลง, สร้างกล้าม = ควรขึ้นแบบคุมได้, ใช้ชีวิตปกติ = ไม่ตัดสิน)`)
    }
  }

  const topics = (entries.data ?? [])
    .flatMap((e: any) => (e.details as any[] ?? []).map((t: any) => `${e.date}: ${t.title}`))
    .filter((t: string) => !t.endsWith(': '))
  if (topics.length > 0) {
    lines.push('## หัวข้อที่ทำในแต่ละ session')
    lines.push(...topics.slice(0, 60)) // จำกัดกัน prompt บวม
  }

  const nutByDay = new Map<string, { cal: number; protein: number }>()
  for (const f of foodEntries.data ?? []) {
    const cur = nutByDay.get(f.date) ?? { cal: 0, protein: 0 }
    cur.cal += f.calories ?? 0
    cur.protein += f.protein_g ?? 0
    nutByDay.set(f.date, cur)
  }
  if (nutByDay.size > 0) {
    lines.push('## โภชนาการต่อวัน (แคลอรี/โปรตีน)')
    for (const [d, v] of [...nutByDay.entries()].sort()) {
      const calGap = profile?.daily_calories != null ? ` (เป้า ${profile.daily_calories}, ${
        v.cal <= profile.daily_calories ? `ขาด ${Math.round(profile.daily_calories - v.cal)}` : `เกิน ${Math.round(v.cal - profile.daily_calories)}`
      })` : ''
      const proteinGap = profile?.daily_protein_g != null
        ? ` (เป้า ${profile.daily_protein_g} ก.)` : ''
      lines.push(`${d}: ${Math.round(v.cal)} kcal${calGap}, โปรตีน ${v.protein.toFixed(0)} ก.${proteinGap}`)
    }
  }

  const waterMlByDay = new Map<string, number>()
  for (const w of waterEntries.data ?? []) {
    waterMlByDay.set(w.date, (waterMlByDay.get(w.date) ?? 0) + (w.ml ?? 0))
  }
  if (waterMlByDay.size > 0) {
    lines.push('## น้ำดื่ม (ml/เป้า)')
    for (const [d, ml] of [...waterMlByDay.entries()].sort()) {
      const goal = profile?.daily_water_ml
      lines.push(`${d}: ${ml}${goal != null ? `/${goal}` : ''} ml`)
    }
  }

  const sleepDays = (healthDaily.data ?? []).filter((h: any) => h.sleep_minutes != null)
  if (sleepDays.length > 0) {
    lines.push('## การนอน (ชม./วัน)')
    for (const h of [...sleepDays].sort((a: any, b: any) => a.date.localeCompare(b.date))) {
      lines.push(`${h.date}: ${(h.sleep_minutes! / 60).toFixed(1)} ชม.`)
    }
  }

  const totalSupplements = (supplements.data ?? []).length
  if (totalSupplements > 0) {
    const takenByDay = new Map<string, Set<string>>()
    for (const l of supplementLogs.data ?? []) {
      if (!takenByDay.has(l.date)) takenByDay.set(l.date, new Set())
      takenByDay.get(l.date)!.add(l.supplement_id)
    }
    lines.push('## อาหารเสริม (กิน/ทั้งหมดต่อวัน)')
    for (const [d, set] of [...takenByDay.entries()].sort()) {
      lines.push(`${d}: ${set.size}/${totalSupplements}`)
    }
  }

  if (ifSettingsRes.data?.enabled) {
    lines.push('## Intermittent Fasting')
    lines.push(`ช่วงกินได้: ${ifSettingsRes.data.eat_start}–${ifSettingsRes.data.eat_end}`)
  }

  if ((healthDaily.data ?? []).length > 0) {
    lines.push('## กิจกรรม (ก้าว/แคลจากกิจกรรม)')
    lines.push('หมายเหตุสำคัญ: ตัวเลข kcal ด้านล่างเป็นค่าที่ผู้ใช้กรอกเองจากแอปนาฬิกา ("active calories") ' +
      'ไม่รวมการเผาผลาญพื้นฐาน (BMR) ห้ามตีความว่าเป็นพลังงานที่ใช้ทั้งวัน (total daily expenditure) ' +
      'และให้ประเมินแบบระวังสุด (ขอบล่างสุดที่เป็นไปได้) เวลาคิดเรื่อง energy balance')
    for (const h of [...(healthDaily.data ?? [])].sort((a: any, b: any) => a.date.localeCompare(b.date))) {
      const parts = []
      if (h.steps != null) parts.push(`${h.steps} ก้าว`)
      if (h.calories_burned != null) parts.push(`แคลจากกิจกรรม ${h.calories_burned} kcal (ไม่รวม BMR)`)
      if (parts.length === 0) continue
      lines.push(`${h.date}: ${parts.join(', ')}`)
    }
  }

  const projects = activeProjects.data ?? []
  if (projects.length > 0) {
    // routine ที่ผูกโปรเจกต์ไว้ → รวมนาทีที่ track ในช่วงเดียวกับที่วิเคราะห์ ต่อโปรเจกต์
    const routineToProject = new Map<string, { projectId: string; name: string }>()
    for (const r of projectRoutines.data ?? []) {
      if (r.project_id) routineToProject.set(r.id, { projectId: r.project_id, name: r.name })
    }
    const minutesByProject = new Map<string, number>()
    for (const e of entries.data ?? []) {
      const link = e.routine_id ? routineToProject.get(e.routine_id) : null
      if (!link) continue
      const mins = Math.max(0, Math.floor(
        (new Date(e.clock_out!).getTime() - new Date(e.clock_in).getTime()) / 60000))
      minutesByProject.set(link.projectId, (minutesByProject.get(link.projectId) ?? 0) + mins)
    }
    const routineNameByProject = new Map<string, string>()
    for (const link of routineToProject.values()) routineNameByProject.set(link.projectId, link.name)

    lines.push('## โปรเจกต์ที่กำลังทำ')
    lines.push('หมายเหตุ: "ชั่วโมงที่ track จาก routine" กับ "ชั่วโมงจาก work log" เป็นคนละแหล่งข้อมูลกัน ' +
      'ผู้ใช้อาจ track ทั้งคู่พร้อมกันสำหรับงานเดียวกัน ห้ามเอาสองตัวเลขนี้มาบวกกันเป็นชั่วโมงรวม ' +
      'ให้รายงานแยกกันตรงๆ เท่านั้น')
    for (const p of projects) {
      let done = 0, total = 0, doneInRange = 0, workLogMinutes = 0
      for (const f of (p.project_fields as any[] ?? [])) {
        for (const t of f.project_tasks) {
          total++
          if (t.status === 'done') {
            done++
            if (t.completed_at && t.completed_at.slice(0, 10) >= fromStr) doneInRange++
          }
          for (const log of (t.project_work_logs as any[] ?? [])) {
            if (log.date >= fromStr) workLogMinutes += log.minutes ?? 0
          }
        }
      }
      const pct = total > 0 ? Math.round((done / total) * 100) : 0
      const routineName = routineNameByProject.get(p.id)
      const routineHours = (minutesByProject.get(p.id) ?? 0) / 60
      const workLogHours = workLogMinutes / 60
      let line = `${p.name}: คืบหน้า ${pct}% (${done}/${total} task), เสร็จในช่วงนี้ ${doneInRange} task`
      if (routineName) line += `, ชั่วโมงที่ track จาก routine "${routineName}" ในช่วงนี้ ${routineHours.toFixed(1)} ชม.`
      if (workLogMinutes > 0) line += `, ชั่วโมงจาก work log (บันทึกเวลาต่อ task) ในช่วงนี้ ${workLogHours.toFixed(1)} ชม.`
      lines.push(line)
    }
  }

  // ---- ออกกำลังกาย (Workout Player): วันที่วางแผน (หนัก/เบา ไม่นับวันพัก) เทียบวันที่เล่นจริง ----
  const workoutDaysByWeekday = new Map<number, { label: string; kind: string }>(
    (workoutDaysRes.data ?? []).map((d: any) => [d.day_of_week, { label: d.label, kind: d.kind }]))
  const workoutSessionsByDate = new Map<string, any>(
    (workoutSessionsRes.data ?? []).map((s: any) => [s.date, s]))
  const todayStr = dateKeyOffset(0, rollover)
  const totalRangeDays = Math.min(days, 90)
  // เดินวันที่ตั้งแต่ fromStr ถึงวันนี้ตามลำดับเวลา หา weekday ของแต่ละวันแบบ TZ-independent
  // (parse/read เป็น UTC ล้วนๆ ทั้งคู่ — "วันที่ปฏิทิน" ไม่ขึ้นกับ timezone อยู่แล้ว)
  const rangeDates = Array.from({ length: totalRangeDays + 1 }, (_, i) =>
    dateKeyOffset(-(totalRangeDays - i), rollover))

  const plannedRows: string[] = []
  let plannedCount = 0, completedCount = 0, totalActiveMinutes = 0
  for (const date of rangeDates) {
    if (date > todayStr) continue
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    const plan = workoutDaysByWeekday.get(weekday)
    if (!plan || plan.kind === 'rest') continue
    plannedCount++
    const session = workoutSessionsByDate.get(date)
    const done = !!session?.completed_at
    if (done) {
      completedCount++
      totalActiveMinutes += session.active_minutes ?? 0
    }
    plannedRows.push(`${date} (${plan.label}, ${plan.kind === 'heavy' ? 'วันหนัก' : 'วันเบา'}): ` +
      (done ? `เล่นแล้ว ${session.active_minutes ?? '?'} นาที` : 'ยังไม่ได้เล่น'))
  }

  if (plannedCount > 0) {
    const exerciseNameById = new Map<string, string>(
      (workoutExercisesRes.data ?? []).map((e: any) => [e.id, e.name]))
    const skipCounts = new Map<string, number>()
    for (const s of workoutSessionsRes.data ?? []) {
      for (const sk of (s.exercises_skipped as any[] ?? [])) {
        const name = exerciseNameById.get(sk.exercise_id) ?? sk.exercise_id
        skipCounts.set(name, (skipCounts.get(name) ?? 0) + 1)
      }
    }
    const recurringSkips = [...skipCounts.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1])

    lines.push('## ออกกำลังกาย (Workout Player)')
    lines.push(`เล่นจริง ${completedCount}/${plannedCount} วันที่วางแผนไว้ (ไม่นับวันพัก) ` +
      `รวมเวลาที่เล่นจริงในช่วงนี้ ${totalActiveMinutes} นาที`)
    lines.push(...plannedRows)
    if (recurringSkips.length > 0) {
      lines.push('ท่าที่ถูกข้ามซ้ำๆ (3 ครั้งขึ้นไปในช่วงนี้ — แค่รายงานข้อเท็จจริง ไม่ได้แปลว่าต้องแก้อะไร):')
      lines.push(...recurringSkips.map(([name, c]) => `${name}: ข้าม ${c} ครั้ง`))
    }
  }

  if (lines.length === 0) {
    return 'ยังไม่มีข้อมูลพอให้วิเคราะห์เลย ลองใช้แอปเก็บข้อมูลสักอาทิตย์ก่อนนะ'
  }

  return provider.analyzeRoutine({
    periodLabel: `${days} วันล่าสุด`,
    summary: lines.join('\n'),
  })
}
