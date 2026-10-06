// ping โมเดลเดียวที่ "เก่า/ไม่ชัวร์ว่าพร้อมไหม" ครั้งเดียวต่อ browser session (ยิงจาก dashboard) — bounded
// probe ไม่ loop หลายโมเดล ไม่ block อะไร แค่ warm + รีเฟรช ai_model_status ไว้ก่อนผู้ใช้กดใช้ AI จริง
import { getCachedUser } from '@/lib/supabase/server'
import { warmProbe } from '@/lib/ai/gemini'
import { NextResponse } from 'next/server'

export async function POST() {
  const { data: { user } } = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })

  const status = await warmProbe()
  return NextResponse.json(status)
}
