// cron รายวัน (Vercel Cron, 08:00 Asia/Bangkok = 01:00 UTC) — safety net เผื่อ hourly cron
// พลาด wake event แล้ว morning_digest ไม่เคยถูกยิงในวันนั้น ส่งซ้ำไม่ได้เพราะ sendEmail dedupe เอง
import { createCronClient, checkCronAuth } from '@/lib/supabase/cron'
import { sendEmail } from '@/lib/notify/mailer'
import { emailTemplate } from '@/lib/notify/template'
import { buildMorningDigestBody } from '@/lib/notify/digest'
import { todayKey, getRolloverHour } from '@/lib/dates'
import { NextResponse } from 'next/server'

async function handle(request: Request) {
  if (!checkCronAuth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createCronClient()
  const rollover = await getRolloverHour(supabase)
  const today = todayKey(rollover)

  const { data: appSettings } = await supabase.from('app_settings').select('notify_email').eq('id', 1).maybeSingle()
  const notifyEmail: string | null = appSettings?.notify_email ?? null
  if (!notifyEmail) {
    return NextResponse.json({ sent: false, reason: 'ยังไม่ได้ตั้ง notify_email' })
  }

  const { data: existing } = await supabase.from('email_log')
    .select('id').eq('kind', 'morning_digest').eq('ref', today).eq('ok', true).limit(1)
  if (existing && existing.length > 0) {
    return NextResponse.json({ sent: false, reason: 'already sent today' })
  }

  const origin = new URL(request.url).origin
  const bodyHtml = await buildMorningDigestBody(supabase, rollover, today, origin)
  const html = emailTemplate({ heading: 'สรุปเช้านี้', bodyHtml })
  const result = await sendEmail(supabase, {
    kind: 'morning_digest', ref: today, subject: 'สรุปเช้านี้', html,
  }, notifyEmail)

  return NextResponse.json(result)
}

export async function POST(request: Request) { return handle(request) }
export async function GET(request: Request) { return handle(request) }
