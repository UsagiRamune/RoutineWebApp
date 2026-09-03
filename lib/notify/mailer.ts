// sendEmail: จุดเดียวที่ยิง Resend จริง — เช็ค gate (enabled/max_per_day/min_gap_minutes/dedupe)
// จาก notification_settings + email_log ก่อนเสมอ แล้วบันทึก log ทุกครั้งที่ลองส่ง
// ต้องไม่ throw เด็ดขาด — พังตรงไหนก็คืน {sent:false, reason} ไม่ให้ rule อื่นใน cron ล้มตาม
import { Resend } from 'resend'
import { getRolloverHour, todayKey, rolloverBoundaryIso } from '@/lib/dates'

export interface SendEmailInput {
  kind: string
  ref: string
  subject: string
  html: string
}

export interface SendEmailResult {
  sent: boolean
  reason?: string
}

// ผู้ส่ง sandbox ของ Resend — ใช้งานได้ทันทีไม่ต้อง verify domain แต่บางแผนจะส่งได้เฉพาะ
// อีเมลของเจ้าของบัญชี Resend เท่านั้น ถ้าอยากส่งไปอีเมลอื่นต้อง verify domain ของตัวเองใน Resend ก่อน
const FROM = 'All-Rounder <onboarding@resend.dev>'

export async function sendEmail(
  supabase: any, input: SendEmailInput, toEmail: string | null
): Promise<SendEmailResult> {
  try {
    if (!toEmail) return { sent: false, reason: 'ยังไม่ได้ตั้ง notify_email' }

    const { data: setting } = await supabase.from('notification_settings')
      .select('*').eq('kind', input.kind).maybeSingle()
    if (!setting || !setting.enabled) return { sent: false, reason: 'ปิดแจ้งเตือนประเภทนี้อยู่' }

    const rollover = await getRolloverHour(supabase)
    const today = todayKey(rollover)
    const dayStartIso = rolloverBoundaryIso(today, rollover)

    // dedupe: kind+ref เดียวกัน วันนี้เคยลองส่งไปแล้ว (ไม่ว่าสำเร็จหรือไม่) → ข้าม
    const { data: dup } = await supabase.from('email_log')
      .select('id').eq('kind', input.kind).eq('ref', input.ref)
      .gte('sent_at', dayStartIso).limit(1)
    if (dup && dup.length > 0) return { sent: false, reason: 'ส่งไปแล้ววันนี้ (dedupe)' }

    // max_per_day: นับเฉพาะที่ส่งสำเร็จตั้งแต่ต้นวัน (ตาม rollover)
    if (setting.max_per_day != null) {
      const { count } = await supabase.from('email_log')
        .select('id', { count: 'exact', head: true })
        .eq('kind', input.kind).eq('ok', true).gte('sent_at', dayStartIso)
      if ((count ?? 0) >= setting.max_per_day) return { sent: false, reason: 'ถึง max_per_day แล้ว' }
    }

    // min_gap_minutes: เทียบกับครั้งล่าสุดที่ส่งสำเร็จของ kind นี้ (ไม่จำกัดแค่วันนี้ เผื่อคาบเกี่ยวข้ามวัน)
    if (setting.min_gap_minutes != null) {
      const { data: last } = await supabase.from('email_log')
        .select('sent_at').eq('kind', input.kind).eq('ok', true)
        .order('sent_at', { ascending: false }).limit(1).maybeSingle()
      if (last?.sent_at) {
        const gapMin = (Date.now() - new Date(last.sent_at).getTime()) / 60000
        if (gapMin < setting.min_gap_minutes) return { sent: false, reason: 'ยังไม่ครบ min_gap_minutes' }
      }
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      await supabase.from('email_log').insert({
        kind: input.kind, ref: input.ref, subject: input.subject, ok: false, error: 'ยังไม่ได้ตั้ง RESEND_API_KEY',
      })
      return { sent: false, reason: 'ยังไม่ได้ตั้ง RESEND_API_KEY' }
    }

    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: FROM, to: toEmail, subject: input.subject, html: input.html,
    })

    if (error) {
      const msg = error.message ?? String(error)
      await supabase.from('email_log').insert({
        kind: input.kind, ref: input.ref, subject: input.subject, ok: false, error: msg,
      })
      return { sent: false, reason: `resend error: ${msg}` }
    }

    await supabase.from('email_log').insert({
      kind: input.kind, ref: input.ref, subject: input.subject, ok: true, error: null,
    })
    return { sent: true }
  } catch (err) {
    return { sent: false, reason: `unexpected: ${err instanceof Error ? err.message : 'unknown'}` }
  }
}
