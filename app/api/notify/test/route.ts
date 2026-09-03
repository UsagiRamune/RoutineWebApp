// ส่งเมลทดสอบ — บายพาส gate ปกติของ sendEmail (max_per_day/min_gap/dedupe) แต่ยังต้อง login
import { createClient } from '@/lib/supabase/server'
import { emailTemplate } from '@/lib/notify/template'
import { Resend } from 'resend'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })

  const { data: appSettings } = await supabase.from('app_settings').select('notify_email').eq('id', 1).maybeSingle()
  const notifyEmail = appSettings?.notify_email
  if (!notifyEmail) return NextResponse.json({ error: 'ยังไม่ได้ตั้งอีเมลรับแจ้งเตือน' }, { status: 400 })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ยังไม่ได้ตั้ง RESEND_API_KEY' }, { status: 400 })

  const html = emailTemplate({
    heading: 'เมลทดสอบ',
    bodyHtml: '<p style="margin:0;">ถ้าเห็นข้อความนี้ แปลว่าระบบแจ้งเตือนของ All-Rounder ทำงานถูกต้องแล้ว</p>',
  })

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: 'All-Rounder <onboarding@resend.dev>', to: notifyEmail, subject: 'เมลทดสอบจาก All-Rounder', html,
  })

  // บันทึก log ไว้ตรวจสอบย้อนหลัง — ใช้ kind ที่มีอยู่แล้ว (morning_digest) + ref เฉพาะกันชนกับสรุปเช้าจริง
  await supabase.from('email_log').insert({
    kind: 'morning_digest', ref: `test-${Date.now()}`, subject: 'เมลทดสอบจาก All-Rounder',
    ok: !error, error: error?.message ?? null,
  })

  if (error) return NextResponse.json({ error: error.message ?? 'ส่งไม่สำเร็จ' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
