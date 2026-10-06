// จุดเดียวที่คุยกับ Google Calendar/Tasks API เพื่ออ่านข้อมูล — ผลลัพธ์เขียนลง calendar_events_cache
// เสมอ ไม่มีที่ไหนอื่นอ่านสดจาก Google แล้ว (route GET อ่านจาก cache นี้แทน) เรียกจาก:
//   - app/api/calendar/route.ts (POST/PATCH/DELETE หลัง mutate สด → source 'mutation', bootstrap
//     ครั้งแรกใน GET → source 'manual')
//   - app/api/calendar/webhook/route.ts (push notification จาก Google) → source 'webhook'
//   - app/api/cron/hourly/route.ts (full sync กันเหตุการณ์ webhook หลุด) → source 'cron'
import { calendarFor, tasksFor } from '@/lib/google/calendar'
import { CalendarCacheKind, CalendarSyncSource, CalendarSyncDeletedItem } from '@/lib/supabase/types'
import { bangkokNow, rolloverBoundaryIso } from '@/lib/dates'

const SYNC_WINDOW_DAYS_AHEAD = 60 // timeMax = เริ่มวันนี้ (Bangkok) + 60 วัน

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

export type SyncResult = { ok: true; events: number; tasks: number } | { ok: false; error: string }

interface FetchListResult {
  items: any[]
  ok: boolean
  error?: string
}

// ดึง events.list ทั้งหมดของ calendar เดียว พร้อม pagination เต็ม (เดิม capped หน้าเดียว 50 รายการ —
// ปฏิทินที่มี event ในช่วงเยอะกว่านั้นจะหายไปเงียบๆ) ถ้า error กลางทาง items ที่ได้มาอาจไม่ครบ —
// ok:false บอก caller ว่าอย่าเอาไปใช้ตัดสิน cleanup (ยัง upsert ส่วนที่ได้มาแล้วได้ ไม่เสียของ)
async function listAllEvents(
  cal: ReturnType<typeof calendarFor>, calendarId: string, timeMin: string, timeMax: string
): Promise<FetchListResult> {
  const items: any[] = []
  let pageToken: string | undefined
  try {
    do {
      const r = await cal.events.list({
        calendarId, timeMin, timeMax, singleEvents: true, orderBy: 'startTime',
        maxResults: 2500, pageToken,
      })
      items.push(...(r.data.items ?? []))
      pageToken = r.data.nextPageToken ?? undefined
    } while (pageToken)
    return { items, ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[calendar-sync] events.list(${calendarId}) error:`, message)
    return { items, ok: false, error: message }
  }
}

// เหมือน listAllEvents แต่สำหรับ tasks.list ของ task list เดียว — เสี่ยง cleanup-จากข้อมูลไม่ครบ
// แบบเดียวกัน (โจทย์เดิมพูดถึงแค่ events.list แต่ bug class เดียวกันเลยกันไว้ด้วยเหมือนกัน)
async function listAllTasks(
  tsk: ReturnType<typeof tasksFor>, tasklistId: string
): Promise<FetchListResult> {
  const items: any[] = []
  let pageToken: string | undefined
  try {
    do {
      const r = await tsk.tasks.list({
        tasklist: tasklistId, showCompleted: false, maxResults: 100, pageToken,
      })
      items.push(...(r.data.items ?? []))
      pageToken = r.data.nextPageToken ?? undefined
    } while (pageToken)
    return { items, ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[calendar-sync] tasks.list(${tasklistId}) error:`, message)
    return { items, ok: false, error: message }
  }
}

interface SyncLogDraft {
  source: CalendarSyncSource
  window_from: string
  window_to: string
  fetched_events: number
  fetched_tasks: number
  upserted: number
  deleted: number
  deleted_items: CalendarSyncDeletedItem[]
  errors: string[]
}

async function writeSyncLog(supabase: any, log: SyncLogDraft) {
  const { error } = await supabase.from('calendar_sync_log').insert({
    source: log.source,
    window_from: log.window_from,
    window_to: log.window_to,
    fetched_events: log.fetched_events,
    fetched_tasks: log.fetched_tasks,
    upserted: log.upserted,
    deleted: log.deleted,
    deleted_items: log.deleted_items,
    error: log.errors.length > 0 ? log.errors.join(' | ') : null,
  })
  if (error) console.error('[calendar-sync] calendar_sync_log insert error:', error.message)

  // ลบ log เก่ากว่า 14 วันทิ้งท้ายทุกรอบ sync — กันตารางโตไม่มีที่สิ้นสุด
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString()
  const { error: pruneError } = await supabase.from('calendar_sync_log').delete().lt('at', cutoff)
  if (pruneError) console.error('[calendar-sync] calendar_sync_log prune error:', pruneError.message)
}

// cleanup ปลอดภัย: ลบได้แค่แถว cache ที่ (1) start_at อยู่ใน window ที่ fetch รอบนี้จริง [timeMin, timeMax)
// และ (2) calendar/list ต้นทางของแถวนั้น fetch สำเร็จครบทุกหน้าจริง (อยู่ใน okScopeIds) — scope ที่ error/
// ไม่ครบไม่ถูกแตะเลย กันบั๊กเดิม: calendar ล่มแล้ว freshIds ว่างเปล่า เข้าใจผิดว่า event หายจริงแล้วลบทิ้งหมด
async function cleanupStaleRows(
  supabase: any, kind: CalendarCacheKind, scopeColumn: 'calendar_id' | 'list_id',
  okScopeIds: string[], freshIds: string[], timeMin: string, timeMax: string,
): Promise<{ deletedCount: number; deletedItems: CalendarSyncDeletedItem[]; error?: string }> {
  if (okScopeIds.length === 0) return { deletedCount: 0, deletedItems: [] }

  const { data: candidates, error: selError } = await supabase.from('calendar_events_cache')
    .select('google_event_id, title, start_at')
    .eq('kind', kind).in(scopeColumn, okScopeIds)
    .gte('start_at', timeMin).lt('start_at', timeMax)
  if (selError) return { deletedCount: 0, deletedItems: [], error: selError.message }

  const staleRows = (candidates ?? []).filter((r: any) => !freshIds.includes(r.google_event_id))
  if (staleRows.length === 0) return { deletedCount: 0, deletedItems: [] }

  const staleIds = staleRows.map((r: any) => r.google_event_id)
  const { error: delError } = await supabase.from('calendar_events_cache')
    .delete().eq('kind', kind).in('google_event_id', staleIds)
  if (delError) return { deletedCount: 0, deletedItems: [], error: delError.message }

  return {
    deletedCount: staleRows.length,
    deletedItems: staleRows.map((r: any) => (
      { google_event_id: r.google_event_id, title: r.title ?? '(ไม่มีชื่อ)', start_at: r.start_at }
    )),
  }
}

// sync ปฏิทิน+task ทั้งหมดของบัญชีที่เชื่อมไว้ลง cache — ต้องมี refreshToken อยู่แล้ว (caller เป็นคนดึงจาก
// google_connections เอง เพราะแต่ละ context ดึงมาคนละวิธี: route มี user session, cron/webhook ไม่มี)
export async function syncCalendarToCache(
  supabase: any, origin: string, refreshToken: string, source: CalendarSyncSource = 'manual'
): Promise<SyncResult> {
  // instrumentation ชั่วคราว — นี่คือฟังก์ชันเดียวที่ยิง Google Calendar/Tasks API สด ถ้าที่ไหนช้า
  // เพราะโดน sync นี้เรียกโดยไม่ควร (เช่น bootstrap ใน GET ทำงานทุก request) log พวกนี้จะฟ้องเวลาจริงให้เห็น
  const tStart = Date.now()
  const cal = calendarFor(origin, refreshToken)
  const tsk = tasksFor(origin, refreshToken)

  // หน้าต่าง sync: เริ่มเที่ยงคืนเมื่อวาน (Bangkok จริง ไม่ใช่ rollover ส่วนตัว 4 โมงเช้าของแอปที่ใช้กับ
  // routine/health — ปฏิทิน Google ยึดวันจริงตามปฏิทินเสมอ) ถึงเที่ยงคืนวันนี้+60 วัน — ต้องเริ่มที่
  // "เมื่อวาน" ไม่ใช่ "วันนี้" เพื่อให้ all-day event ความยาว 0 ที่เคยสร้างไว้ก่อนแก้บั๊ก (end.date ==
  // start.date) ยังถูก events.list คืนกลับมา (ดูคำอธิบาย overlap rule เต็มๆ ในรายงาน) — ห้ามใช้
  // Date.now()/setHours ของเครื่อง server ตรงๆ เด็ดขาด (Vercel รันโซน UTC ไม่ใช่ Bangkok)
  const { dateKey: todayKey } = bangkokNow()
  const { dateKey: yesterdayKey } = bangkokNow(new Date(Date.now() - 86400000))
  const timeMin = rolloverBoundaryIso(yesterdayKey, 0)
  const timeMax = new Date(
    new Date(rolloverBoundaryIso(todayKey, 0)).getTime() + SYNC_WINDOW_DAYS_AHEAD * 86400000
  ).toISOString()

  const log: SyncLogDraft = {
    source, window_from: timeMin, window_to: timeMax,
    fetched_events: 0, fetched_tasks: 0, upserted: 0, deleted: 0,
    deleted_items: [], errors: [],
  }

  try {
    const tLists = Date.now()
    const [calList, taskLists] = await Promise.all([
      cal.calendarList.list(),
      tsk.tasklists.list().catch((err: any) => {
        const message = err?.message ?? String(err)
        console.error('[calendar-sync] tasklists.list error:', message)
        log.errors.push(`tasklists.list: ${message}`)
        return { data: { items: [] } }
      }),
    ])
    const calendars = calList.data.items ?? []
    console.log(`[calendar-sync] calendarList.list + tasklists.list: ${Date.now() - tLists}ms ` +
      `(${calendars.length} calendars, ${(taskLists.data.items ?? []).length} task lists)`)

    const tEvents = Date.now()
    const perCalendar = await Promise.all(calendars.map(async c => {
      const { items, ok, error } = await listAllEvents(cal, c.id!, timeMin, timeMax)
      if (!ok && error) log.errors.push(`calendar ${c.id}: ${error}`)
      const rows = items.filter(e => !!e.id).map((e): CacheRow => ({
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
      return { calendarId: c.id ?? null, rows, ok }
    }))
    console.log(`[calendar-sync] events.list (all calendars): ${Date.now() - tEvents}ms`)

    const tTasks = Date.now()
    const timeMaxMs = new Date(timeMax).getTime()
    const perTaskList = await Promise.all((taskLists.data.items ?? []).map(async l => {
      const { items, ok, error } = await listAllTasks(tsk, l.id!)
      if (!ok && error) log.errors.push(`task list ${l.id}: ${error}`)
      const rows = items
        .filter(t => !!t.id && !!t.due && new Date(t.due).getTime() < timeMaxMs)
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
      return { listId: l.id ?? null, rows, ok }
    }))
    console.log(`[calendar-sync] tasks.list (all lists): ${Date.now() - tTasks}ms`)

    const allEventRows = perCalendar.flatMap(c => c.rows)
    const allTaskRows = perTaskList.flatMap(l => l.rows)
    const allRows = [...allEventRows, ...allTaskRows]
    log.fetched_events = allEventRows.length
    log.fetched_tasks = allTaskRows.length

    const tUpsert = Date.now()
    if (allRows.length > 0) {
      const syncedAt = new Date().toISOString()
      const { error: upsertError } = await supabase.from('calendar_events_cache')
        .upsert(
          allRows.map(r => ({ ...r, synced_at: syncedAt })),
          { onConflict: 'google_event_id,kind' },
        )
      if (upsertError) {
        log.errors.push(`upsert: ${upsertError.message}`)
        await writeSyncLog(supabase, log)
        return { ok: false, error: upsertError.message }
      }
      log.upserted = allRows.length
    }
    console.log(`[calendar-sync] upsert (${allRows.length} rows): ${Date.now() - tUpsert}ms`)

    // cleanup — เฉพาะ calendar/list ที่ fetch สำเร็จครบทุกหน้าเท่านั้น (ดูคอมเมนต์ยาวบน cleanupStaleRows)
    const tCleanup = Date.now()
    const okCalendarIds = perCalendar.filter(c => c.ok && c.calendarId).map(c => c.calendarId!)
    const okListIds = perTaskList.filter(l => l.ok && l.listId).map(l => l.listId!)
    const freshEventIds = allEventRows.map(r => r.google_event_id)
    const freshTaskIds = allTaskRows.map(r => r.google_event_id)

    const [eventCleanup, taskCleanup] = await Promise.all([
      cleanupStaleRows(supabase, 'event', 'calendar_id', okCalendarIds, freshEventIds, timeMin, timeMax),
      cleanupStaleRows(supabase, 'task', 'list_id', okListIds, freshTaskIds, timeMin, timeMax),
    ])
    if (eventCleanup.error) {
      console.error('[calendar-sync] cleanup delete (event) error:', eventCleanup.error)
      log.errors.push(`cleanup event: ${eventCleanup.error}`)
    }
    if (taskCleanup.error) {
      console.error('[calendar-sync] cleanup delete (task) error:', taskCleanup.error)
      log.errors.push(`cleanup task: ${taskCleanup.error}`)
    }
    log.deleted = eventCleanup.deletedCount + taskCleanup.deletedCount
    log.deleted_items = [...eventCleanup.deletedItems, ...taskCleanup.deletedItems]
    console.log(`[calendar-sync] cleanup delete: ${Date.now() - tCleanup}ms (deleted ${log.deleted})`)
    console.log(`[calendar-sync] TOTAL: ${Date.now() - tStart}ms`)

    await writeSyncLog(supabase, log)

    return { ok: true, events: allEventRows.length, tasks: allTaskRows.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error(`[calendar-sync] sync error after ${Date.now() - tStart}ms:`, err)
    log.errors.push(message)
    await writeSyncLog(supabase, log).catch(() => {})
    return { ok: false, error: message }
  }
}
