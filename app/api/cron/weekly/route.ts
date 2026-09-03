// cron รายสัปดาห์ (Vercel Cron, ทุกวันอาทิตย์ 19:00 Asia/Bangkok = 12:00 UTC)
// สรุป AI จาก 7 วันล่าสุด (ใช้ตรรกะเดียวกับ /api/analyze) แปลง markdown → HTML แล้วส่ง
import { createCronClient, checkCronAuth } from '@/lib/supabase/cron'
import { sendEmail } from '@/lib/notify/mailer'
import { emailTemplate } from '@/lib/notify/template'
import { simpleMarkdownToHtml } from '@/lib/notify/markdown'
import { buildAnalysisSummary } from '@/lib/analyze/buildSummary'
import { todayKey, getRolloverHour } from '@/lib/dates'
import { NextResponse } from 'next/server'

async function handle(request: Request) {
  if (!checkCronAuth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createCronClient()
  const rollover = await getRolloverHour(supabase)

  const { data: appSettings } = await supabase.from('app_settings').select('notify_email').eq('id', 1).maybeSingle()
  const notifyEmail: string | null = appSettings?.notify_email ?? null
  if (!notifyEmail) {
    return NextResponse.json({ sent: false, reason: 'ยังไม่ได้ตั้ง notify_email' })
  }

  let analysis: string
  try {
    analysis = await buildAnalysisSummary(supabase, 7, rollover)
  } catch (err) {
    return NextResponse.json({
      sent: false, reason: `analyze failed: ${err instanceof Error ? err.message : 'unknown'}`,
    })
  }

  const weekKey = todayKey(rollover) // วันที่รัน cron นี้ — กันส่งซ้ำถ้า scheduler ยิงซ้ำวันเดียวกัน
  const bodyHtml = simpleMarkdownToHtml(analysis)
  const html = emailTemplate({ heading: 'สรุปประจำสัปดาห์', bodyHtml })
  const result = await sendEmail(supabase, {
    kind: 'weekly_summary', ref: weekKey, subject: 'สรุปประจำสัปดาห์', html,
  }, notifyEmail)

  return NextResponse.json(result)
}

export async function POST(request: Request) { return handle(request) }
export async function GET(request: Request) { return handle(request) }
