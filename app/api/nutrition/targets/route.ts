// AI คำนวณเป้าแคลอรี/โปรตีน/น้ำจากน้ำหนักส่วนสูงล่าสุด + แผนที่เลือก แล้ว upsert nutrition_profile
import { createClient } from '@/lib/supabase/server'
import { generateJson } from '@/lib/ai/gemini'
import { NutritionPlan } from '@/lib/supabase/types'
import { NextResponse } from 'next/server'

const SYSTEM_PROMPT = `คำนวณเป้าจากน้ำหนัก ส่วนสูง และแผน (cut=ลดน้ำหนัก, normal=ใช้ชีวิตปกติ, bulk=สร้างกล้าม) แบบเข้มงวด:
เป้าโปรตีนและน้ำให้เอาขอบบนของช่วงแนะนำ (โปรตีน 1.6-2.2 g/kg → ใช้ ~2.0-2.2 สำหรับ bulk/cut)
เป้าแคลอรี่สำหรับ cut ให้ deficit จริงจังแต่ปลอดภัย ห้ามใจดีเกิน
rationale อธิบายสั้นๆ ภาษาไทย
ตอบ JSON เท่านั้น: {daily_calories, daily_protein_g, daily_water_glasses, rationale}`

interface TargetsResult {
  daily_calories: number
  daily_protein_g: number
  daily_water_glasses: number
  rationale: string
}

const PLANS: NutritionPlan[] = ['cut', 'normal', 'bulk']

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })
  }

  const { plan } = await request.json().catch(() => ({}))
  if (!PLANS.includes(plan)) {
    return NextResponse.json({ error: 'แผนไม่ถูกต้อง' }, { status: 400 })
  }

  const { data: metric } = await supabase
    .from('body_metrics')
    .select('weight_kg, height_cm, date')
    .not('weight_kg', 'is', null)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!metric?.weight_kg) {
    return NextResponse.json({ error: 'ยังไม่มีข้อมูลน้ำหนัก บันทึกในหน้าประวัติก่อน' }, { status: 400 })
  }

  const planLabel = { cut: 'ลดน้ำหนัก', normal: 'ใช้ชีวิตปกติ', bulk: 'สร้างกล้าม' }[plan as NutritionPlan]

  try {
    const result = await generateJson<TargetsResult>(
      SYSTEM_PROMPT,
      `น้ำหนัก: ${metric.weight_kg} กก.\nส่วนสูง: ${metric.height_cm ?? 'ไม่ทราบ'} ซม.\nแผน: ${plan} (${planLabel})`
    )

    const { data: profile, error } = await supabase.from('nutrition_profile').upsert({
      id: 1,
      plan,
      daily_calories: Math.round(result.daily_calories),
      daily_protein_g: Math.round(result.daily_protein_g),
      daily_water_glasses: Math.round(result.daily_water_glasses),
      ai_rationale: result.rationale,
      updated_at: new Date().toISOString(),
    }).select().single()

    if (error) throw error

    return NextResponse.json({ profile })
  } catch (err) {
    console.error('nutrition targets error:', err)
    return NextResponse.json(
      { error: 'คำนวณไม่สำเร็จ ลองใหม่อีกที' },
      { status: 500 })
  }
}
