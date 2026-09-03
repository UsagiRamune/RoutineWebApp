// สร้าง body HTML ของสรุปเช้า: เมื่อวานในสายตาเดียว + แผนวันนี้
import { dateKeyOffset, TZ } from '@/lib/dates'
import { calendarFor } from '@/lib/google/calendar'
import { escapeHtml } from './template'

export async function buildMorningDigestBody(
  supabase: any, rollover: number, today: string, origin: string
): Promise<string> {
  const yesterday = dateKeyOffset(-1, rollover)

  const [
    categoriesRes, foodYRes, waterYRes, weightRes, profileRes, ifRes, connRes,
  ] = await Promise.all([
    supabase.from('routine_categories').select(`
      kind,
      routines ( id, name, is_active, remind_at,
        routine_items ( is_active, item_completions ( date ) ),
        time_entries ( date, clock_in, clock_out ) )
    `),
    supabase.from('food_entries').select('calories').eq('date', yesterday),
    supabase.from('water_entries').select('ml').eq('date', yesterday),
    supabase.from('body_metrics').select('date, weight_kg').not('weight_kg', 'is', null)
      .order('date', { ascending: false }).limit(2),
    supabase.from('nutrition_profile').select('*').eq('id', 1).maybeSingle(),
    supabase.from('if_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('google_connections').select('refresh_token').limit(1).maybeSingle(),
  ])

  const categories = categoriesRes.data ?? []

  // ---- เมื่อวาน ----
  let doneY = 0, totalY = 0, trackedMinsY = 0
  for (const cat of categories) {
    for (const r of (cat.routines ?? []).filter((r: any) => r.is_active)) {
      if (cat.kind === 'checklist') {
        for (const item of (r.routine_items ?? []).filter((i: any) => i.is_active)) {
          totalY++
          if ((item.item_completions ?? []).some((c: any) => c.date === yesterday)) doneY++
        }
      } else {
        for (const e of (r.time_entries ?? []).filter((e: any) => e.date === yesterday)) {
          const start = new Date(e.clock_in).getTime()
          const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now()
          trackedMinsY += Math.max(0, Math.floor((end - start) / 60000))
        }
      }
    }
  }
  const caloriesY = (foodYRes.data ?? []).reduce((s: number, f: any) => s + (f.calories ?? 0), 0)
  const waterMlY = (waterYRes.data ?? []).reduce((s: number, w: any) => s + (w.ml ?? 0), 0)
  const weights = weightRes.data ?? []
  const latestW = weights[0]?.weight_kg ?? null
  const prevW = weights[1]?.weight_kg ?? null
  const weightDelta = (latestW != null && prevW != null) ? latestW - prevW : null
  const profile = profileRes.data

  // ---- วันนี้ ----
  const remindersToday: { name: string; time: string }[] = []
  for (const cat of categories) {
    for (const r of (cat.routines ?? []).filter((r: any) => r.is_active && r.remind_at)) {
      remindersToday.push({ name: r.name, time: String(r.remind_at).slice(0, 5) })
    }
  }
  remindersToday.sort((a, b) => a.time.localeCompare(b.time))

  let calendarLines: string[] = []
  const conn = connRes.data
  if (conn?.refresh_token) {
    try {
      const cal = calendarFor(origin, conn.refresh_token)
      const calList = await cal.calendarList.list()
      const dayStart = new Date(`${today}T00:00:00+07:00`)
      const dayEnd = new Date(dayStart.getTime() + 86400000)
      const evLists = await Promise.all((calList.data.items ?? []).map((c: any) =>
        cal.events.list({
          calendarId: c.id!, timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString(),
          singleEvents: true, orderBy: 'startTime', maxResults: 15,
        }).then((r: any) => r.data.items ?? []).catch(() => [])
      ))
      calendarLines = evLists.flat()
        .filter((e: any) => e.eventType !== 'birthday')
        .map((e: any) => {
          const t = e.start?.dateTime
            ? new Date(e.start.dateTime).toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
            : 'ทั้งวัน'
          return `${t} — ${e.summary ?? '(ไม่มีชื่อ)'}`
        })
    } catch {
      // ปฏิทินพังไม่ควรทำให้สรุปเช้าพังไปด้วย
    }
  }

  const ifSettings = ifRes.data

  return `
    <h2 style="margin:0 0 8px;font-size:16px;color:#EDEAE0;">เมื่อวานนี้</h2>
    <p style="margin:0 0 4px;">เช็คลิสต์: ${doneY}/${totalY} · จับเวลารวม ${(trackedMinsY / 60).toFixed(1)} ชม.</p>
    <p style="margin:0 0 4px;">แคลอรี่: ${Math.round(caloriesY)}${profile?.daily_calories != null ? ` / ${profile.daily_calories}` : ''} kcal</p>
    <p style="margin:0 0 4px;">น้ำ: ${(waterMlY / 1000).toFixed(2)}${profile?.daily_water_ml != null ? ` / ${(profile.daily_water_ml / 1000).toFixed(2)}` : ''} ล.</p>
    <p style="margin:0 0 16px;">น้ำหนัก: ${latestW != null ? `${Number(latestW).toFixed(1)} กก.` : 'ไม่มีบันทึก'}${weightDelta != null ? ` (${weightDelta > 0 ? '+' : ''}${weightDelta.toFixed(1)})` : ''}</p>

    <h2 style="margin:16px 0 8px;font-size:16px;color:#EDEAE0;">แผนวันนี้</h2>
    ${remindersToday.length > 0
      ? `<p style="margin:0 0 4px;">${remindersToday.map(r => escapeHtml(`${r.time} — ${r.name}`)).join('<br>')}</p>`
      : '<p style="margin:0 0 4px;color:#7C8394;">ไม่มี routine ตั้งเวลาเตือนวันนี้</p>'}
    ${calendarLines.length > 0
      ? `<p style="margin:8px 0 4px;">${calendarLines.map(escapeHtml).join('<br>')}</p>` : ''}
    ${ifSettings?.enabled
      ? `<p style="margin:8px 0 4px;">กินได้ ${ifSettings.eat_start.slice(0, 5)}–${ifSettings.eat_end.slice(0, 5)}</p>` : ''}
    ${profile
      ? `<p style="margin:8px 0 4px;">เป้าวันนี้: ${profile.daily_calories ?? '—'} kcal · โปรตีน ${profile.daily_protein_g ?? '—'} ก. · น้ำ ${(profile.daily_water_ml / 1000).toFixed(1)} ล.</p>`
      : ''}
  `
}
