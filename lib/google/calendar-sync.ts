// จุดเดียวที่คุยกับ Google Calendar/Tasks API เพื่ออ่านข้อมูล — ผลลัพธ์เขียนลง calendar_events_cache
// เสมอ ไม่มีที่ไหนอื่นอ่านสดจาก Google แล้ว (route GET อ่านจาก cache นี้แทน) เรียกจาก:
//   - app/api/calendar/route.ts (POST/DELETE/PATCH) หลัง mutate สด เพื่อให้ cache อัปเดตทันที
//   - app/api/calendar/webhook/route.ts (push notification จาก Google)
//   - app/api/cron/hourly/route.ts (full sync กันเหตุการณ์ webhook หลุด)
import { calendarFor, tasksFor } from '@/lib/google/calendar'
import { CalendarCacheKind } from '@/lib/supabase/types'

const SYNC_WINDOW_DAYS = 31 // เท่ากับ "days" สูงสุดที่ UI เคยขอตอน query สด — ครอบมุมมอง 30 วันของ CalendarPanel พอดี

interface CacheRow {
  google_event_id: string
  kind: CalendarCacheKind
  title: string
  description: string | null
  start_at: string | null
  end_at: string | null
  all_day: boolean
  is_birthday: boolean
  calendar_id: string | null
  calendar_name: string | null
  list_id: string | null
  raw: Record<string, unknown>
}

// PostgREST ต้องการ syntax ดิบสำหรับ .not(col, 'in', ...) — ห่อค่าแต่ละตัวด้วย "" กัน id มีอักขระแปลกๆ
function pgInList(ids: string[]): string {
  return `(${ids.map(id => `"${id.replace(/"/g, '\\"')}"`).join(',')})`
}

export type SyncResult = { ok: true; events: number; tasks: number } | { ok: false; error: string }

// sync ปฏิทิน+task ทั้งหมดของบัญชีที่เชื่อมไว้ลง cache — ต้องมี refreshToken อยู่แล้ว (caller เป็นคนดึงจาก
// google_connections เอง เพราะแต่ละ context ดึงมาคนละวิธี: route มี user session, cron/webhook ไม่มี)
export async function syncCalendarToCache(
  supabase: any, origin: string, refreshToken: string
): Promise<SyncResult> {
  // instrumentation ชั่วคราว — นี่คือฟังก์ชันเดียวที่ยิง Google Calendar/Tasks API สด ถ้าที่ไหนช้า
  // เพราะโดน sync นี้เรียกโดยไม่ควร (เช่น bootstrap ใน GET ทำงานทุก request) log พวกนี้จะฟ้องเวลาจริงให้เห็น
  const tStart = Date.now()
  const cal = calendarFor(origin, refreshToken)
  const tsk = tasksFor(origin, refreshToken)

  const dayStart = new Date(new Date().setHours(0, 0, 0, 0))
  const horizon = new Date(dayStart.getTime() + SYNC_WINDOW_DAYS * 86400000)

  try {
    const tLists = Date.now()
    const [calList, taskLists] = await Promise.all([
      cal.calendarList.list(),
      tsk.tasklists.list().catch((err: any) => {
        console.error('[calendar-sync] tasklists.list error:', err?.message ?? err)
        return { data: { items: [] } }
      }),
    ])
    const calendars = calList.data.items ?? []
    console.log(`[calendar-sync] calendarList.list + tasklists.list: ${Date.now() - tLists}ms ` +
      `(${calendars.length} calendars, ${(taskLists.data.items ?? []).length} task lists)`)

    const tEvents = Date.now()
    const eventRowsNested = await Promise.all(calendars.map(async c => {
      const r = await cal.events.list({
        calendarId: c.id!,
        timeMin: dayStart.toISOString(),
        timeMax: horizon.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      }).catch((err: any) => {
        console.error(`[calendar-sync] events.list(${c.id}) error:`, err?.message ?? err)
        return { data: { items: [] } }
      })
      return (r.data.items ?? []).filter(e => !!e.id).map((e): CacheRow => ({
        google_event_id: e.id!,
        kind: 'event',
        title: e.summary ?? '(ไม่มีชื่อ)',
        description: e.description ?? null,
        start_at: e.start?.dateTime ?? (e.start?.date ? new Date(`${e.start.date}T00:00:00`).toISOString() : null),
        end_at: e.end?.dateTime ?? null,
        all_day: !e.start?.dateTime,
        is_birthday: e.eventType === 'birthday' || (c.id ?? '').includes('#contacts'),
        calendar_id: c.id ?? null,
        calendar_name: c.summary ?? '',
        list_id: null,
        raw: e as unknown as Record<string, unknown>,
      }))
    }))
    console.log(`[calendar-sync] events.list (all calendars): ${Date.now() - tEvents}ms`)

    const tTasks = Date.now()
    const taskRowsNested = await Promise.all((taskLists.data.items ?? []).map(async l => {
      const r = await tsk.tasks.list({
        tasklist: l.id!, showCompleted: false, maxResults: 200,
      }).catch((err: any) => {
        console.error(`[calendar-sync] tasks.list(${l.id}) error:`, err?.message ?? err)
        return { data: { items: [] } }
      })
      return (r.data.items ?? [])
        .filter(t => !!t.id && !!t.due && new Date(t.due) < horizon)
        .map((t): CacheRow => ({
          google_event_id: t.id!,
          kind: 'task',
          title: t.title ?? '(ไม่มีชื่อ)',
          description: t.notes ?? null,
          start_at: t.due!,
          end_at: null,
          all_day: true,
          is_birthday: false,
          calendar_id: null,
          calendar_name: l.title ?? '',
          list_id: l.id ?? null,
          raw: t as unknown as Record<string, unknown>,
        }))
    }))
    console.log(`[calendar-sync] tasks.list (all lists): ${Date.now() - tTasks}ms`)

    const allRows = [...eventRowsNested.flat(), ...taskRowsNested.flat()]
    const syncedAt = new Date().toISOString()

    const tUpsert = Date.now()
    if (allRows.length > 0) {
      const { error: upsertError } = await supabase.from('calendar_events_cache')
        .upsert(
          allRows.map(r => ({ ...r, synced_at: syncedAt })),
          { onConflict: 'google_event_id,kind' },
        )
      if (upsertError) return { ok: false, error: upsertError.message }
    }
    console.log(`[calendar-sync] upsert (${allRows.length} rows): ${Date.now() - tUpsert}ms`)

    // ลบแถวที่หายไปจาก Google แล้ว (ไม่งั้น cache จะค้างเรื่อยๆ ไม่มีวันหมด) — แยก diff ต่อ kind
    // เพราะ event/task คนละ namespace id กัน (unique constraint คือ google_event_id+kind)
    const tCleanup = Date.now()
    for (const kind of ['event', 'task'] as const) {
      const freshIds = allRows.filter(r => r.kind === kind).map(r => r.google_event_id)
      let del = supabase.from('calendar_events_cache').delete().eq('kind', kind)
      if (freshIds.length > 0) {
        del = del.not('google_event_id', 'in', pgInList(freshIds))
      }
      const { error: delError } = await del
      if (delError) console.error(`[calendar-sync] cleanup delete (${kind}) error:`, delError.message)
    }
    console.log(`[calendar-sync] cleanup delete: ${Date.now() - tCleanup}ms`)
    console.log(`[calendar-sync] TOTAL: ${Date.now() - tStart}ms`)

    return {
      ok: true,
      events: eventRowsNested.flat().length,
      tasks: taskRowsNested.flat().length,
    }
  } catch (err) {
    console.error(`[calendar-sync] sync error after ${Date.now() - tStart}ms:`, err)
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' }
  }
}
