// AI ประเมินแคลอรี/แมโครจากคำอธิบายคร่าวๆ และ/หรือรูปอาหาร — ไม่บันทึกอัตโนมัติ แค่ส่งกลับให้ผู้ใช้ยืนยัน/แก้ก่อน
import { getCachedUser } from '@/lib/supabase/server'
import { generateJson, generateJsonWithImage } from '@/lib/ai/gemini'
import { NextResponse } from 'next/server'

const BASE_SYSTEM_PROMPT = `ประเมินอาหารไทย/ทั่วไปจากคำอธิบายคร่าวๆ ตอบ JSON เท่านั้น:
{name, calories, protein_g, carbs_g, fat_g, confidence: 'low'|'medium'|'high', assumptions: string}
กติกาสำคัญ: ห้ามเอาใจผู้ใช้ ประเมินแบบ conservative เสมอ — แคลอรี่และไขมันให้ตีไปทางขอบบนของช่วงที่เป็นไปได้
(ถ้าลังเลระหว่าง 600-800 ให้ตอบ ~780) ปริมาณน้ำมัน/น้ำตาลแฝงในอาหารตามสั่งให้สมมติว่ามีมากไว้ก่อน
โปรตีนตีตามจริงไม่เผื่อขึ้น ระบุ assumptions ที่ใช้สั้นๆ`

const PHOTO_ADDENDUM = `วิเคราะห์จากรูปอาหาร ประมาณสัดส่วน/ปริมาณจากภาพ (ขนาดจาน ปริมาณข้าว ฯลฯ)
ถ้ามีข้อความเสริมจากผู้ใช้ ให้ใช้ประกอบการประเมินด้วย`

interface EstimateResult {
  name: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  confidence: 'low' | 'medium' | 'high'
  assumptions: string
}

// ขนาดรูปสูงสุดที่รับ — กันอัปโหลดไฟล์ใหญ่เกินจำเป็นและกันโดน Gemini inline data limit
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export async function POST(request: Request) {
  const { data: { user } } = await getCachedUser()
  if (!user) {
    return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type') ?? ''

  // มีรูปแนบมา — parse multipart/form-data (มี text hint ประกอบได้ แต่ไม่บังคับ)
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null)
    if (!form) {
      return NextResponse.json({ error: 'อ่านฟอร์มไม่สำเร็จ' }, { status: 400 })
    }

    const image = form.get('image')
    const description = (form.get('description') as string | null) ?? ''
    const meal = (form.get('meal') as string | null) ?? 'ไม่ระบุ'

    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json({ error: 'ไม่พบไฟล์รูป' }, { status: 400 })
    }
    if (image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'ไฟล์รูปใหญ่เกินไป (สูงสุด 8MB)' }, { status: 400 })
    }
    if (!image.type.startsWith('image/')) {
      return NextResponse.json({ error: 'ไฟล์ที่แนบไม่ใช่รูปภาพ' }, { status: 400 })
    }

    try {
      const buffer = Buffer.from(await image.arrayBuffer())
      const base64 = buffer.toString('base64')
      const result = await generateJsonWithImage<EstimateResult>(
        `${BASE_SYSTEM_PROMPT}\n${PHOTO_ADDENDUM}`,
        `มื้อ: ${meal}${description.trim() ? `\nข้อความเสริมจากผู้ใช้: ${description.trim()}` : ''}`,
        { mimeType: image.type, base64 }
      )
      return NextResponse.json({ result })
    } catch (err) {
      console.error('nutrition estimate (photo) error:', err)
      return NextResponse.json(
        { error: 'ประเมินจากรูปไม่สำเร็จ ลองใหม่อีกทีหรือกรอกเองแบบละเอียด' },
        { status: 500 })
    }
  }

  // ไม่มีรูป — flow เดิมเป๊ะๆ (text description อย่างเดียว) ไม่มี regression
  const { description, meal } = await request.json().catch(() => ({}))
  if (!description || typeof description !== 'string' || !description.trim()) {
    return NextResponse.json({ error: 'กรอกคำอธิบายอาหารก่อน' }, { status: 400 })
  }

  try {
    const result = await generateJson<EstimateResult>(
      BASE_SYSTEM_PROMPT,
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
