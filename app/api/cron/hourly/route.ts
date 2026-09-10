// cron รายชั่วโมง (เรียกจาก scheduler ภายนอก) — ประเมิน 6 กติกาแยกอิสระจากกัน (rule ล้มไม่ควรบล็อกตัวอื่น)
// auth: Authorization: Bearer <CRON_SECRET>
import { createCronClient, checkCronAuth, logCronError } from '@/lib/supabase/cron'
import { sendEmail } from '@/lib/notify/mailer'
import { emailTemplate } from '@/lib/notify/template'
import { buildMorningDigestBody } from '@/lib/notify/digest'
import { todayKey, dateKeyForTimestamp, getRolloverHour, bangkokNow } from '@/lib/dates'
import { computeWaterPacing } from '@/lib/water'
import { syncCalendarToCache } from '@/lib/google/calendar-sync'
import { registerPrimaryCalendarChannel } from '@/lib/google/calendar-channel'
import { NextResponse } from 'next/server'

function fmtLeadTime(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} ชม.`
  return `${minutes} นาที`
}

async function handle(request: Request) {
  // cron routes ไม่มี user session ให้ middleware ตรวจ — auth ทั้งหมดอยู่ที่ Bearer CRON_SECRET
  // นี้เท่านั้น ต้องคืน 401 ตรงๆ ห้าม redirect ไป /login เด็ดขาด (ผู้เรียกเป็น scheduler ไม่ใช่ browser)
  if (!checkCronAuth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let supabase: ReturnType<typeof createCronClient>
  try {
    supabase = createCronClient()
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'สร้าง Supabase client ไม่สำเร็จ',
    }, { status: 500 })
  }

  const rollover = await getRolloverHour(supabase)
  const today = todayKey(rollover)
  const { hour: nowHour, weekday: nowWeekday } = bangkokNow()

  const results: Record<string, unknown> = {}

  const { data: appSettings, error: appSettingsError } = await supabase.from('app_settings').select('*').eq('id', 1).maybeSingle()
  logCronError('app_settings', appSettingsError)
  // แถวอ่านไม่ได้ (เช่น RLS block) ต้องไม่ถูกตีความเหมือน "ยังไม่ได้ตั้งค่า" — ทั้งสองเคสหน้าตาเหมือนกัน
  // ถ้าไม่แยก (data เป็น null ทั้งคู่) ดังนั้นเช็ค error ก่อนเสมอ
  if (appSettingsError) {
    return NextResponse.json({
      error: 'อ่าน app_settings ไม่สำเร็จ',
      supabaseError: {
        message: appSettingsError.message, code: appSettingsError.code, details: appSettingsError.details,
      },
    }, { status: 500 })
  }

  // ---------- 0. calendar: renew push channel (กันหมดอายุ) + full sync cache กันเหตุการณ์ webhook หลุด ----------
  // ต้องอยู่ก่อน early-return ของ notify_email ด้านล่าง เพราะ cache/channel ต้องอัปเดตทุกชั่วโมงเสมอ
  // ไม่เกี่ยวกับว่าผู้ใช้ตั้งอีเมลแจ้งเตือนไว้หรือยัง (หน้าปฏิทิน/dashboard อ่าน cache นี้ตรงๆ)
  try {
    const origin = new URL(request.url).origin
    const { data: conn, error: connError } = await supabase.from('google_connections')
      .select('refresh_token').limit(1).maybeSingle()
    logCronError('google_connections (calendar sync)', connError)

    if (!conn?.refresh_token) {
      results.calendar_channel = { renewed: false, reason: 'no google connection' }
      results.calendar_sync = { ok: false, reason: 'no google connection' }
    } else {
      const { data: channel, error: channelError } = await supabase.from('google_calendar_channels')
        .select('expiration').eq('calendar_id', 'primary').maybeSingle()
      logCronError('google_calendar_channels', channelError)

      const expiringSoon = !channel ||
        new Date(channel.expiration).getTime() - Date.now() < 2 * 3600 * 1000
      results.calendar_channel = expiringSoon
        ? await registerPrimaryCalendarChannel(supabase, origin, conn.refresh_token)
        : { ok: true, skipped: 'not expiring within 2h', expiration: channel.expiration }

      results.calendar_sync = await syncCalendarToCache(supabase, origin, conn.refresh_token)
    }
  } catch (err) {
    results.calendar_channel = { ok: false, reason: `error: ${err instanceof Error ? err.message : 'unknown'}` }
  }

  const notifyEmail: string | null = appSettings?.notify_email ?? null
  if (!notifyEmail) {
    return NextResponse.json({ error: 'ยังไม่ได้ตั้ง notify_email', results })
  }

  const { data: latestSleep, error: latestSleepError } = await supabase.from('sleep_sessions')
    .select('*').order('sleep_at', { ascending: false }).limit(1).maybeSingle()
  logCronError('sleep_sessions (latest)', latestSleepError)
  const asleep = !!latestSleep && latestSleep.wake_at == null
  const quietNow = !!appSettings?.quiet_hours_enabled && asleep

  // ---------- 1. water ----------
  try {
    if (asleep) {
      results.water = { sent: false, reason: 'asleep' }
    } else if (quietNow) {
      results.water = { sent: false, reason: 'quiet hours' }
    } else {
      const { data: sessions, error: sessionsError } = await supabase.from('sleep_sessions')
        .select('*').order('sleep_at', { ascending: false }).limit(20)
      logCronError('sleep_sessions (water anchor)', sessionsError)
      let anchor = new Date(`${today}T${String(rollover).padStart(2, '0')}:00:00+07:00`)
      for (const s of sessions ?? []) {
        if (!s.wake_at) continue
        const hrs = (new Date(s.wake_at).getTime() - new Date(s.sleep_at).getTime()) / 3600000
        if (hrs >= 3) { anchor = new Date(s.wake_at); break }
      }
      const hoursAwake = Math.max(0, (Date.now() - anchor.getTime()) / 3600000)
      const windowHours = appSettings?.water_window_hours ?? 13

      if (hoursAwake > windowHours) {
        results.water = { sent: false, reason: 'past water window' }
      } else {
        const [profileRes, waterRes] = await Promise.all([
          supabase.from('nutrition_profile').select('*').eq('id', 1).maybeSingle(),
          supabase.from('water_entries').select('ml').eq('date', today),
        ])
        logCronError('nutrition_profile', profileRes.error)
        logCronError('water_entries', waterRes.error)
        const profile = profileRes.data
        const actualMl = (waterRes.data ?? []).reduce((s: number, w: any) => s + (w.ml ?? 0), 0)
        const pacing = computeWaterPacing({
          hoursAwake,
          actualTodayMl: actualMl,
          targetMl: profile?.daily_water_ml ?? 4000,
          windowHours,
          frontloadRatio: appSettings?.water_frontload_ratio ?? 0.3,
          mlPerSip: profile?.ml_per_sip ?? 37,
          asleep: false,
        })
        if (pacing.deficitMl >= 300) {
          const targetMl = profile?.daily_water_ml ?? 4000
          const html = emailTemplate({
            heading: `ตามหลังเป้าน้ำอยู่ ${pacing.deficitMl} ml`,
            bodyHtml: `<p style="margin:0 0 8px;">ตอนนี้: ${(actualMl / 1000).toFixed(2)} ล. / เป้า ${(targetMl / 1000).toFixed(2)} ล.</p>
              <p style="margin:0;">จิบสัก ${pacing.sips} อึก</p>`,
          })
          results.water = await sendEmail(supabase, {
            kind: 'water', ref: `${today}-${nowHour}`,
            subject: `ตามหลังเป้าน้ำอยู่ ${pacing.deficitMl} ml`, html,
          }, notifyEmail)
        } else {
          results.water = { sent: false, reason: `deficit ${pacing.deficitMl}ml < 300ml` }
        }
      }
    }
  } catch (err) {
    results.water = { sent: false, reason: `error: ${err instanceof Error ? err.message : 'unknown'}` }
  }

  // ---------- 2. if_window ----------
  try {
    if (quietNow) {
      results.if_window = { sent: false, reason: 'quiet hours' }
    } else {
      const { data: ifSettings, error: ifSettingsError } = await supabase.from('if_settings').select('*').eq('id', 1).maybeSingle()
      logCronError('if_settings', ifSettingsError)
      if (!ifSettings?.enabled) {
        results.if_window = { sent: false, reason: 'IF disabled' }
      } else {
        const { data: nsRow, error: nsError } = await supabase.from('notification_settings')
          .select('lead_minutes').eq('kind', 'if_window').maybeSingle()
        logCronError('notification_settings (if_window)', nsError)
        const leadMin = nsRow?.lead_minutes ?? 60

        const nowSec = nowHour * 3600 + bangkokNow().minute * 60
        const toSec = (t: string) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + (s || 0) }
        const endSec = toSec(ifSettings.eat_end)
        const startSec = toSec(ifSettings.eat_start)

        const closeTriggerSec = endSec - leadMin * 60
        const closeDue = nowSec <= closeTriggerSec && closeTriggerSec < nowSec + 3600
        const openDue = nowSec <= startSec && startSec < nowSec + 3600

        if (closeDue) {
          const html = emailTemplate({
            heading: 'ใกล้ปิดหน้าต่างกินแล้ว',
            bodyHtml: `<p style="margin:0;">เหลืออีก ${fmtLeadTime(leadMin)} จะปิดหน้าต่างกิน (${ifSettings.eat_end.slice(0, 5)})</p>`,
          })
          results.if_close = await sendEmail(supabase, {
            kind: 'if_window', ref: `${today}-close`,
            subject: `เหลืออีก ${fmtLeadTime(leadMin)} จะปิดหน้าต่างกิน`, html,
          }, notifyEmail)
        }
        if (openDue) {
          const html = emailTemplate({
            heading: 'เริ่มกินได้แล้ว',
            bodyHtml: `<p style="margin:0;">หน้าต่างกินเปิดแล้วตั้งแต่ ${ifSettings.eat_start.slice(0, 5)}</p>`,
          })
          results.if_open = await sendEmail(supabase, {
            kind: 'if_window', ref: `${today}-open`, subject: 'เริ่มกินได้แล้ว', html,
          }, notifyEmail)
        }
        if (!closeDue && !openDue) results.if_window = { sent: false, reason: 'not near an edge this hour' }
      }
    }
  } catch (err) {
    results.if_window = { sent: false, reason: `error: ${err instanceof Error ? err.message : 'unknown'}` }
  }

  // ---------- 3. morning_digest ----------
  try {
    const { data: nsRow, error: nsError } = await supabase.from('notification_settings')
      .select('lead_minutes').eq('kind', 'morning_digest').maybeSingle()
    logCronError('notification_settings (morning_digest)', nsError)
    const leadMin = nsRow?.lead_minutes ?? 30

    const { data: lastWakeRow, error: lastWakeError } = await supabase.from('sleep_sessions')
      .select('wake_at').not('wake_at', 'is', null)
      .order('wake_at', { ascending: false }).limit(1).maybeSingle()
    logCronError('sleep_sessions (last wake)', lastWakeError)
    const wakeAt = lastWakeRow?.wake_at ? new Date(lastWakeRow.wake_at) : null
    const wokeToday = !!wakeAt && dateKeyForTimestamp(wakeAt, rollover) === today
    const minsSinceWake = wakeAt ? (Date.now() - wakeAt.getTime()) / 60000 : Infinity

    if (!wokeToday) {
      results.morning_digest = { sent: false, reason: 'no wake event today' }
    } else if (minsSinceWake < leadMin) {
      results.morning_digest = { sent: false, reason: 'too soon after wake' }
    } else {
      const origin = new URL(request.url).origin
      const bodyHtml = await buildMorningDigestBody(supabase, rollover, today, origin)
      const html = emailTemplate({ heading: 'สรุปเช้านี้', bodyHtml })
      results.morning_digest = await sendEmail(supabase, {
        kind: 'morning_digest', ref: today, subject: 'สรุปเช้านี้', html,
      }, notifyEmail)
    }
  } catch (err) {
    results.morning_digest = { sent: false, reason: `error: ${err instanceof Error ? err.message : 'unknown'}` }
  }

  // ---------- 4. routine_due ----------
  try {
    if (quietNow) {
      results.routine_due = { sent: false, reason: 'quiet hours' }
    } else {
      const { data: categories, error: categoriesError } = await supabase.from('routine_categories').select(`
        kind,
        routines ( id, name, is_active, remind_enabled, remind_at, remind_days,
          routine_items ( is_active, item_completions ( date ) ),
          time_entries ( date ) )
      `)
      logCronError('routine_categories/routines', categoriesError)

      const sent: unknown[] = []
      for (const cat of categories ?? []) {
        for (const r of (cat.routines ?? [])) {
          if (!r.is_active || !r.remind_enabled || !r.remind_at) continue
          const remindHour = Number(String(r.remind_at).split(':')[0])
          if (remindHour !== nowHour) continue
          if (!(r.remind_days ?? []).includes(nowWeekday)) continue

          const hasActivity = cat.kind === 'checklist'
            ? (r.routine_items ?? []).some((i: any) => i.is_active &&
                (i.item_completions ?? []).some((c: any) => c.date === today))
            : (r.time_entries ?? []).some((e: any) => e.date === today)
          if (hasActivity) continue

          const html = emailTemplate({
            heading: `ถึงเวลา ${r.name}`,
            bodyHtml: `<p style="margin:0;">ยังไม่มีการทำ "${r.name}" วันนี้เลย</p>`,
          })
          const res = await sendEmail(supabase, {
            kind: 'routine_due', ref: `${r.id}-${today}`, subject: `ถึงเวลา ${r.name}`, html,
          }, notifyEmail)
          sent.push({ routine: r.name, ...res })
        }
      }
      results.routine_due = sent.length > 0 ? sent : { sent: false, reason: 'no routine due this hour' }
    }
  } catch (err) {
    results.routine_due = { sent: false, reason: `error: ${err instanceof Error ? err.message : 'unknown'}` }
  }

  // ---------- 5. calendar_event ----------
  // อ่านจาก calendar_events_cache (sync แล้วในบล็อก 0 ของ cron รอบนี้) แทนการยิง Google สดเหมือนเดิม —
  // ตามหลักการใหม่ว่า syncCalendarToCache() คือจุดเดียวที่คุยกับ Google สำหรับอ่านข้อมูลปฏิทิน
  try {
    if (quietNow) {
      results.calendar_event = { sent: false, reason: 'quiet hours' }
    } else {
      const { data: conn, error: connError } = await supabase.from('google_connections').select('refresh_token').limit(1).maybeSingle()
      logCronError('google_connections', connError)
      if (!conn?.refresh_token) {
        results.calendar_event = { sent: false, reason: 'no google connection' }
      } else {
        const { data: nsRow, error: nsError } = await supabase.from('notification_settings')
          .select('lead_minutes').eq('kind', 'calendar_event').maybeSingle()
        logCronError('notification_settings (calendar_event)', nsError)
        const leadMin = nsRow?.lead_minutes ?? 15

        const now = Date.now()
        const horizon = now + leadMin * 60000

        const { data: upcoming, error: upcomingError } = await supabase.from('calendar_events_cache')
          .select('google_event_id, title, start_at')
          .eq('kind', 'event').eq('all_day', false).eq('is_birthday', false)
          .gte('start_at', new Date(now).toISOString()).lte('start_at', new Date(horizon).toISOString())
        logCronError('calendar_events_cache (calendar_event)', upcomingError)

        const sent: unknown[] = []
        for (const e of upcoming ?? []) {
          const startMs = new Date(e.start_at!).getTime()
          const minsAway = Math.max(0, Math.round((startMs - now) / 60000))
          const title = e.title ?? '(ไม่มีชื่อ)'
          const html = emailTemplate({
            heading: `อีก ${minsAway} นาที: ${title}`,
            bodyHtml: `<p style="margin:0;">เริ่ม ${new Date(e.start_at!).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })}</p>`,
          })
          const res = await sendEmail(supabase, {
            kind: 'calendar_event', ref: e.google_event_id, subject: `อีก ${minsAway} นาที: ${title}`, html,
          }, notifyEmail)
          sent.push({ event: title, ...res })
        }
        results.calendar_event = sent.length > 0 ? sent : { sent: false, reason: 'no upcoming event' }
      }
    }
  } catch (err) {
    results.calendar_event = { sent: false, reason: `error: ${err instanceof Error ? err.message : 'unknown'}` }
  }

  return NextResponse.json({ ok: true, today, hour: nowHour, quietNow, results })
}

export async function POST(request: Request) { return handle(request) }
export async function GET(request: Request) { return handle(request) }
