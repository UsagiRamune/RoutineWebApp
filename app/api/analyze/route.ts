// API วิเคราะห์ routine ด้วย AI
import { createClient } from '@/lib/supabase/server'
import { geminiProvider } from '@/lib/ai/gemini'
import { AiProvider } from '@/lib/ai/provider'
import { dateKeyOffset } from '@/lib/dates'
import { NextResponse } from 'next/server'

// จุดสลับ provider — อนาคตเพิ่ม anthropic.ts แล้วเปลี่ยนตรงนี้จุดเดียว
const providers: Record<string, AiProvider> = {
  gemini: geminiProvider,
}
const provider = providers[process.env.AI_PROVIDER ?? 'gemini']

export async function POST(request: Request) {
  const supabase = await createClient()

  // กันคนนอกยิง API ตรงๆ โดยไม่ login
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })
  }

  const { days = 7 } = await request.json().catch(() => ({}))
  const fromStr = dateKeyOffset(-Math.min(days, 90)) // จำกัด 90 วัน กัน prompt บวม

  const [entries, completions, metrics, categories,
    foodEntries, waterEntries, supplementLogs, supplements, ifSettingsRes, nutritionProfileRes,
    healthDaily] = await Promise.all([
    supabase.from('time_entries')
      .select('date, clock_in, clock_out, details, routines(name, category_id, default_target_minutes)')
      .gte('date', fromStr).not('clock_out', 'is', null),
    supabase.from('item_completions')
      .select('date, routine_items(name, routine_id)')
      .gte('date', fromStr),
    supabase.from('body_metrics').select('*').gte('date', fromStr).order('date'),
    supabase.from('routine_categories').select('id, name, kind'),
    supabase.from('food_entries').select('date, calories, protein_g').gte('date', fromStr),
    supabase.from('water_entries').select('date').gte('date', fromStr),
    supabase.from('supplement_logs').select('date, supplement_id').gte('date', fromStr),
    supabase.from('supplements').select('id, name').eq('is_active', true),
    supabase.from('if_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('nutrition_profile').select('*').eq('id', 1).maybeSingle(),
    supabase.from('health_daily').select('date, steps, calories_burned, source').gte('date', fromStr),
  ])

  // ---- ย่อยข้อมูลฝั่ง server ให้เหลือแต่แก่น (ประหยัด token + โมเดลอ่านง่าย) ----

  const catName = new Map((categories.data ?? []).map(c => [c.id, c.name]))
  // เป้าหมายโภชนาการปัจจุบัน (ถ้าตั้งไว้) — ใช้เทียบ gap ต่อวัน + ทิศทางน้ำหนัก
  const profile = nutritionProfileRes.data

  // รวมนาทีต่อวันต่อ routine
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

  // checklist ต่อวัน
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

  // body metrics + แนวโน้มน้ำหนักเทียบแผน — ให้โมเดลตัดสินได้ว่าอาหาร/กิจกรรมกำลังพาไปทางเป้าหมายไหม
  if ((metrics.data ?? []).length > 0) {
    lines.push('## บันทึกร่างกาย')
    for (const m of metrics.data!) {
      lines.push(`${m.date}: ${m.weight_kg ?? '?'} กก.${m.note ? ` (${m.note})` : ''}`)
    }

    const weightEntries = (metrics.data ?? []).filter(m => m.weight_kg != null)
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

  // หัวข้องานที่ทำ (จาก details)
  const topics = (entries.data ?? [])
    .flatMap(e => (e.details as any[] ?? []).map(t => `${e.date}: ${t.title}`))
    .filter(t => !t.endsWith(': '))
  if (topics.length > 0) {
    lines.push('## หัวข้อที่ทำในแต่ละ session')
    lines.push(...topics.slice(0, 60)) // จำกัดกัน prompt บวม
  }

  // โภชนาการ: แคลอรี/โปรตีนต่อวัน เทียบเป้า
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

  // น้ำดื่ม: จำนวนแก้วต่อวัน เทียบเป้า
  const waterByDay = new Map<string, number>()
  for (const w of waterEntries.data ?? []) {
    waterByDay.set(w.date, (waterByDay.get(w.date) ?? 0) + 1)
  }
  if (waterByDay.size > 0) {
    lines.push('## น้ำดื่ม (แก้ว/เป้า)')
    for (const [d, glasses] of [...waterByDay.entries()].sort()) {
      const goal = profile?.daily_water_glasses
      lines.push(`${d}: ${glasses}${goal != null ? `/${goal}` : ''} แก้ว`)
    }
  }

  // อาหารเสริม: กิน/ทั้งหมดต่อวัน
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

  // ช่วง intermittent fasting
  if (ifSettingsRes.data?.enabled) {
    lines.push('## Intermittent Fasting')
    lines.push(`ช่วงกินได้: ${ifSettingsRes.data.eat_start}–${ifSettingsRes.data.eat_end}`)
  }

  // กิจกรรม: ก้าว/แคลจากกิจกรรมต่อวัน (ผู้ใช้กรอกเอง)
  if ((healthDaily.data ?? []).length > 0) {
    lines.push('## กิจกรรม (ก้าว/แคลจากกิจกรรม)')
    lines.push('หมายเหตุสำคัญ: ตัวเลข kcal ด้านล่างเป็นค่าที่ผู้ใช้กรอกเองจากแอปนาฬิกา ("active calories") ' +
      'ไม่รวมการเผาผลาญพื้นฐาน (BMR) ห้ามตีความว่าเป็นพลังงานที่ใช้ทั้งวัน (total daily expenditure) ' +
      'และให้ประเมินแบบระวังสุด (ขอบล่างสุดที่เป็นไปได้) เวลาคิดเรื่อง energy balance')
    for (const h of [...(healthDaily.data ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
      const parts = []
      if (h.steps != null) parts.push(`${h.steps} ก้าว`)
      if (h.calories_burned != null) parts.push(`แคลจากกิจกรรม ${h.calories_burned} kcal (ไม่รวม BMR)`)
      if (parts.length === 0) continue
      lines.push(`${h.date}: ${parts.join(', ')}`)
    }
  }

  if (lines.length === 0) {
    return NextResponse.json({
      analysis: 'ยังไม่มีข้อมูลพอให้วิเคราะห์เลย ลองใช้แอปเก็บข้อมูลสักอาทิตย์ก่อนนะ',
    })
  }

  try {
    const analysis = await provider.analyzeRoutine({
      periodLabel: `${days} วันล่าสุด`,
      summary: lines.join('\n'),
    })
    return NextResponse.json({ analysis })
  } catch (err) {
    console.error('analyze error:', err)
    return NextResponse.json(
      { error: 'วิเคราะห์ไม่สำเร็จ ลองใหม่อีกทีหรือเช็ค API key' },
      { status: 500 })
  }
}