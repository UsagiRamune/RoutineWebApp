// ลบ workout session ที่ยัง "ค้างอยู่" (ยังไม่จบ) เท่านั้น — ใช้ตอนกดลบจากลิสต์ประวัติ
// เช็คซ้ำฝั่ง server ว่า completed_at IS NULL จริง ก่อนลบเสมอ (ฝั่ง UI ซ่อนปุ่มลบไว้ให้แถวที่จบแล้วอยู่แล้ว
// แต่ไม่พึ่งฝั่ง UI อย่างเดียว เผื่อมีคนยิง request ตรงๆ ข้าม UI)
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function DELETE(request: Request) {
  const { data: { user } } = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })

  const { id } = await request.json().catch(() => ({}))
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'ไม่พบ session ที่จะลบ' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: existing } = await supabase.from('workout_sessions')
    .select('id, completed_at').eq('id', id).maybeSingle()

  if (!existing) {
    return NextResponse.json({ error: 'ไม่พบ session นี้' }, { status: 404 })
  }
  if (existing.completed_at !== null) {
    return NextResponse.json({ error: 'ลบไม่ได้ — session นี้จบไปแล้ว' }, { status: 400 })
  }

  const { error } = await supabase.from('workout_sessions').delete().eq('id', id)
  if (error) {
    console.error('[workout/session DELETE] error:', error)
    return NextResponse.json({ error: 'ลบไม่สำเร็จ ลองใหม่อีกที' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
