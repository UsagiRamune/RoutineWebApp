// merge active_minutes ของ session ออกกำลังกายที่เพิ่งจบเข้า health_daily ของวันนั้น (บวกเพิ่ม ไม่ทับ
// เผื่อมีการกรอกมือไว้แล้ว) แยกเป็น route ต่างหาก (ไม่ทำตรงจาก client) กันแข่งกันเขียนแถวเดียวกันกับ
// ที่มาอื่น (เช่น health page กรอกมือพร้อมกัน) ให้อ่าน-แล้ว-รวมค่าเกิดที่เดียวบน server
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { data: { user } } = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })

  const { date, activeMinutes } = await request.json().catch(() => ({}))
  if (typeof date !== 'string' || typeof activeMinutes !== 'number') {
    return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: existing } = await supabase.from('health_daily')
    .select('steps, calories_burned, resting_hr, sleep_minutes, active_minutes')
    .eq('date', date).maybeSingle()

  const nextActiveMinutes = (existing?.active_minutes ?? 0) + Math.max(0, activeMinutes)

  const { error } = await supabase.from('health_daily').upsert({
    date,
    steps: existing?.steps ?? null,
    calories_burned: existing?.calories_burned ?? null,
    resting_hr: existing?.resting_hr ?? null,
    sleep_minutes: existing?.sleep_minutes ?? null,
    active_minutes: nextActiveMinutes,
    source: 'manual',
  }, { onConflict: 'date' })

  if (error) {
    console.error('workout complete health_daily merge error:', error)
    return NextResponse.json({ error: 'บันทึกไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, active_minutes: nextActiveMinutes })
}
