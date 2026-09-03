// AI ประเมินแคลอรี/แมโครจากคำอธิบายคร่าวๆ — ไม่บันทึกอัตโนมัติ แค่ส่งกลับให้ผู้ใช้ยืนยัน/แก้ก่อน
import { createClient } from '@/lib/supabase/server'
import { generateJson } from '@/lib/ai/gemini'
import { NextResponse } from 'next/server'

const SYSTEM_PROMPT = `ประเมินอาหารไทย/ทั่วไปจากคำอธิบายคร่าวๆ ตอบ JSON เท่านั้น:
{name, calories, protein_g, carbs_g, fat_g, confidence: 'low'|'medium'|'high', assumptions: string}
กติกาสำคัญ: ห้ามเอาใจผู้ใช้ ประเมินแบบ conservative เสมอ — แคลอรี่และไขมันให้ตีไปทางขอบบนของช่วงที่เป็นไปได้
(ถ้าลังเลระหว่าง 600-800 ให้ตอบ ~780) ปริมาณน้ำมัน/น้ำตาลแฝงในอาหารตามสั่งให้สมมติว่ามีมากไว้ก่อน
โปรตีนตีตามจริงไม่เผื่อขึ้น ระบุ assumptions ที่ใช้สั้นๆ`

interface EstimateResult {
  name: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  confidence: 'low' | 'medium' | 'high'
  assumptions: string
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })
  }

  const { description, meal } = await request.json().catch(() => ({}))
  if (!description || typeof description !== 'string' || !description.trim()) {
    return NextResponse.json({ error: 'กรอกคำอธิบายอาหารก่อน' }, { status: 400 })
  }

  try {
    const result = await generateJson<EstimateResult>(
      SYSTEM_PROMPT,
      `มื้อ: ${meal ?? 'ไม่ระบุ'}\nคำอธิบาย: ${description.trim()}`
    )
    return NextResponse.json({ result })
  } catch (err) {
    console.error('nutrition estimate error:', err)
    return NextResponse.json(
      { error: 'ประเมินไม่สำเร็จ ลองใหม่อีกทีหรือกรอกเองแบบละเอียด' },
      { status: 500 })
  }
}
