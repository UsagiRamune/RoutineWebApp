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

// log ให้รู้ step ที่ error เกิดจริง + path (text/multipart) — เดิม log แค่ `console.error('...', err)`
// เฉยๆ ซึ่งถ้า throw เกิดนอก try/catch (เช่นตอน validate multipart ก่อนถึง Gemini call) จะหลุดไปเป็น
// 500 เปล่าๆ ของ Next เอง ไม่มี log อะไรเลย — เลยห่อทั้งฟังก์ชันด้วย try/catch ชั้นนอกอีกชั้น กันหลุด
// ทุกกรณี ไม่ใช่แค่รอบ Gemini call เหมือนโค้ดเดิม
function logError(step: string, err: unknown) {
  const e = err instanceof Error ? err : new Error(String(err))
  console.error(`[nutrition/estimate] error at step "${step}":`, {
    message: e.message,
    stack: e.stack,
  })
}

export async function POST(request: Request) {
  let step = 'auth'
  try {
    const { data: { user } } = await getCachedUser()
    if (!user) {
      return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })
    }

    const contentType = request.headers.get('content-type') ?? ''

    // มีรูปแนบมา — parse multipart/form-data (มี text hint ประกอบได้ แต่ไม่บังคับ)
    if (contentType.includes('multipart/form-data')) {
      step = 'multipart:parse-form'
      const form = await request.formData().catch(() => null)
      if (!form) {
        return NextResponse.json({ error: 'อ่านฟอร์มไม่สำเร็จ' }, { status: 400 })
      }

      step = 'multipart:validate-fields'
      const image = form.get('image')
      const description = typeof form.get('description') === 'string' ? (form.get('description') as string) : ''
      const meal = typeof form.get('meal') === 'string' ? (form.get('meal') as string) : 'ไม่ระบุ'

      if (!(image instanceof File) || image.size === 0) {
        return NextResponse.json({ error: 'ไม่พบไฟล์รูป' }, { status: 400 })
      }
      if (image.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: 'ไฟล์รูปใหญ่เกินไป (สูงสุด 8MB)' }, { status: 400 })
      }
      if (!image.type.startsWith('image/')) {
        return NextResponse.json({ error: 'ไฟล์ที่แนบไม่ใช่รูปภาพ' }, { status: 400 })
      }

      step = 'multipart:read-image-bytes'
      const buffer = Buffer.from(await image.arrayBuffer())
      const base64 = buffer.toString('base64')

      step = 'multipart:gemini-call'
      const result = await generateJsonWithImage<EstimateResult>(
        `${BASE_SYSTEM_PROMPT}\n${PHOTO_ADDENDUM}`,
        `มื้อ: ${meal}${description.trim() ? `\nข้อความเสริมจากผู้ใช้: ${description.trim()}` : ''}`,
        { mimeType: image.type, base64 }
      )
      return NextResponse.json({ result })
    }

    // ไม่มีรูป — flow เดิมเป๊ะๆ (text description อย่างเดียว) ไม่มี regression
    step = 'text:parse-json'
    const { description, meal } = await request.json().catch(() => ({}))
    if (!description || typeof description !== 'string' || !description.trim()) {
      return NextResponse.json({ error: 'กรอกคำอธิบายอาหารก่อน' }, { status: 400 })
    }

    step = 'text:gemini-call'
    const result = await generateJson<EstimateResult>(
      BASE_SYSTEM_PROMPT,
      `มื้อ: ${meal ?? 'ไม่ระบุ'}\nคำอธิบาย: ${description.trim()}`
    )
    return NextResponse.json({ result })
  } catch (err) {
    logError(step, err)
    return NextResponse.json(
      { error: 'ประเมินไม่สำเร็จ ลองใหม่อีกทีหรือกรอกเองแบบละเอียด' },
      { status: 500 })
  }
}
