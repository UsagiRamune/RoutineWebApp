// สถานะ Gemini model chain ปัจจุบัน — อ่านจาก ai_model_status อย่างเดียว ไม่เรียก Gemini เลย ใช้ปิดปุ่ม AI
// ในหน้าที่มีปุ่มเรียก AI (ประเมินอาหาร/วิเคราะห์ history) ตอนทุกโมเดลกำลัง cooldown พร้อมกัน
import { getCachedUser } from '@/lib/supabase/server'
import { getAiStatus } from '@/lib/ai/gemini'
import { NextResponse } from 'next/server'

export async function GET() {
  const { data: { user } } = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })

  const status = await getAiStatus()
  return NextResponse.json(status)
}
