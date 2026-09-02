// API วิเคราะห์ routine ด้วย AI
import { createClient } from '@/lib/supabase/server'
import { geminiProvider } from '@/lib/ai/gemini'
import { AiProvider } from '@/lib/ai/provider'
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
  const from = new Date()
  from.setDate(from.getDate() - Math.min(days, 90)) // จำกัด 90 วัน กัน prompt บวม
  const fromStr = from.toLocaleDateString('sv-SE')

  const [entries, completions, metrics, categories] = await Promise.all([
    supabase.from('time_entries')
      .select('date, clock_in, clock_out, details, routines(name, category_id, default_target_minutes)')
      .gte('date', fromStr).not('clock_out', 'is', null),
    supabase.from('item_completions')
      .select('date, routine_items(name, routine_id)')
      .gte('date', fromStr),
    supabase.from('body_metrics').select('*').gte('date', fromStr).order('date'),
    supabase.from('routine_categories').select('id, name, kind'),
  ])

  // ---- ย่อยข้อมูลฝั่ง server ให้เหลือแต่แก่น (ประหยัด token + โมเดลอ่านง่าย) ----

  const catName = new Map((categories.data ?? []).map(c => [c.id, c.name]))

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

  // body metrics
  if ((metrics.data ?? []).length > 0) {
    lines.push('## บันทึกร่างกาย')
    for (const m of metrics.data!) {
      lines.push(`${m.date}: ${m.weight_kg ?? '?'} กก.${m.note ? ` (${m.note})` : ''}`)
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