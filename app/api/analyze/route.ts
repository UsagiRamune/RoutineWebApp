// API วิเคราะห์ routine ด้วย AI
import { createClient } from '@/lib/supabase/server'
import { getRolloverHour } from '@/lib/dates'
import { buildAnalysisSummary } from '@/lib/analyze/buildSummary'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()

  // กันคนนอกยิง API ตรงๆ โดยไม่ login
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })
  }

  const { days = 7 } = await request.json().catch(() => ({}))
  const rollover = await getRolloverHour(supabase)

  try {
    const analysis = await buildAnalysisSummary(supabase, days, rollover)
    return NextResponse.json({ analysis })
  } catch (err) {
    console.error('analyze error:', err)
    return NextResponse.json(
      { error: 'วิเคราะห์ไม่สำเร็จ ลองใหม่อีกทีหรือเช็ค API key' },
      { status: 500 })
  }
}
