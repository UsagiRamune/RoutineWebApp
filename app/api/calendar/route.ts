// API ปฏิทิน+tasks: GET = อ่านจาก cache (ไม่เรียก Google สด), POST/PATCH/DELETE = mutate สดแล้ว sync cache ตาม
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { calendarFor, tasksFor } from '@/lib/google/calendar'
import { syncCalendarToCache } from '@/lib/google/calendar-sync'
import { CalendarEventCache } from '@/lib/supabase/types'
import { NextResponse, type NextRequest } from 'next/server'

async function getConnection() {
  const supabase = await createClient()
  const { data: { user } } = await getCachedUser()
  if (!user) return { error: NextResponse.json({ error: 'ยังไม่ login' }, { status: 401 }) }
  const { data } = await supabase.from('google_connections')
    .select('refresh_token').eq('user_id', user.id).single()
  if (!data) return { notConnected: true }
  return { refreshToken: data.refresh_token }
}

function cacheRowToEvent(r: CalendarEventCache) {
  return {
    id: r.google_event_id,
    calendarId: r.calendar_id ?? undefined,
    calendarName: r.calendar_name ?? '',
    title: r.title ?? '(ไม่มีชื่อ)',
    description: r.description ?? '',
    start: r.start_at ?? '',
    end: r.end_at ?? '',
    allDay: r.all_day,
    isBirthday: r.is_birthday,
  }
}

function cacheRowToTask(r: CalendarEventCache) {
  return {
    id: r.google_event_id,
    listId: r.list_id ?? '',
    listName: r.calendar_name ?? '',
    title: r.title ?? '(ไม่มีชื่อ)',
    notes: r.description ?? '',
    due: r.start_at ?? '',
  }
}

export async function GET(request: NextRequest) {
  // instrumentation ชั่วคราว — หา bottleneck จริงของหน้า /calendar (รายงานว่าช้า 1-2 วิ)
  // โฟกัสเช็คว่า path "bootstrap ถ้า cache ว่าง" ด้านล่างดันทำงานทุก request หรือเปล่า
  // (ถ้าใช่ = ยิง Google สดทุกครั้ง อธิบายความช้าได้ตรงๆ) ดู breakdown จาก Vercel logs หลัง deploy จริง
  const tStart = Date.now()
  const conn = await getConnection()
  console.log(`[calendar][GET] connection check: ${Date.now() - tStart}ms`)
  if ('error' in conn) return conn.error
  if ('notConnected' in conn) return NextResponse.json({ connected: false })

  const supabase = await createClient()
  const origin = request.nextUrl.origin
  const days = Math.min(31, Math.max(1,
    parseInt(request.nextUrl.searchParams.get('days') ?? '7')))
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0))
  const horizon = new Date(dayStart.getTime() + days * 86400000)

  // เช็คว่าเคย sync มาก่อนหรือยัง (ไม่ใช่แค่ "ช่วงวันที่ที่ขอมันว่างพอดี") — ถ้าไม่เคย sync เลยสักแถว
  // (บัญชีเพิ่งเชื่อม แล้วยังไม่ทันมี full sync ครั้งแรกวิ่ง) ต้อง bootstrap ครั้งเดียวตรงนี้ ไม่งั้นผู้ใช้
  // จะเห็นปฏิทินว่างเปล่าไปจนกว่า cron รายชั่วโมงจะมาถึง — เป็นข้อยกเว้นเดียวที่ GET นี้แตะ Google สด
  const tBootstrapCheck = Date.now()
  const { count: totalCached, error: countError } = await supabase.from('calendar_events_cache')
    .select('id', { count: 'exact', head: true })
  console.log(`[calendar][GET] bootstrap count check: ${Date.now() - tBootstrapCheck}ms ` +
    `(totalCached=${totalCached}, error=${countError?.message ?? 'none'})`)
  if (!totalCached || totalCached === 0) {
    // *** ถ้า log นี้ขึ้นทุก request ที่ /calendar ถูกเรียก แปลว่า bootstrap ไม่ได้เกิดครั้งเดียวจริง
    // ไปยิง Google Calendar/Tasks API สดทุกครั้ง — นี่คือผู้ต้องสงสัยอันดับ 1 ของความช้า ***
    console.warn('[calendar][GET] *** BOOTSTRAP SYNC TRIGGERED — calling live Google APIs from this GET request ***')
    const tBootstrap = Date.now()
    const result = await syncCalendarToCache(supabase, origin, conn.refreshToken!)
    console.warn(`[calendar][GET] bootstrap syncCalendarToCache(): ${Date.now() - tBootstrap}ms`, result)
    if (!('ok' in result) || !result.ok) {
      console.error('calendar bootstrap sync error:', 'error' in result ? result.error : result)
      return NextResponse.json({ error: 'sync ปฏิทินครั้งแรกไม่สำเร็จ ลองใหม่อีกที' }, { status: 500 })
    }
  }

  const tCacheQuery = Date.now()
  const { data: cacheRows, error } = await supabase.from('calendar_events_cache')
    .select('*')
    .gte('start_at', dayStart.toISOString())
    .lte('start_at', horizon.toISOString())
    .order('start_at')
  console.log(`[calendar][GET] main cache query: ${Date.now() - tCacheQuery}ms (rows=${cacheRows?.length ?? 0})`)

  if (error) {
    console.error('calendar cache read error:', error)
    return NextResponse.json({ error: 'ดึงข้อมูลไม่สำเร็จ' }, { status: 500 })
  }

  const rows = (cacheRows ?? []) as CalendarEventCache[]
  const events = rows.filter(r => r.kind === 'event').map(cacheRowToEvent).slice(0, 30)
  const tasks = rows.filter(r => r.kind === 'task').map(cacheRowToTask)

  // ปฏิทิน/task list ที่เลือกเป็นปลายทางตอนสร้างใหม่ได้ — สร้างจากรายชื่อที่เห็นใน cache (ของที่มี
  // event/task อย่างน้อย 1 รายการในช่วงที่ sync ไว้) เผื่อ 'primary' ไม่มีอะไรอยู่ในช่วงนี้เลยก็ยังเลือกได้เสมอ
  const writableMap = new Map<string, { id: string; name: string; primary: boolean }>()
  for (const r of rows) {
    if (r.kind === 'event' && r.calendar_id && !writableMap.has(r.calendar_id)) {
      writableMap.set(r.calendar_id, { id: r.calendar_id, name: r.calendar_name ?? '', primary: false })
    }
  }
  if (!writableMap.has('primary')) writableMap.set('primary', { id: 'primary', name: 'ปฏิทินหลัก', primary: true })
  const writable = Array.from(writableMap.values())

  const taskListMap = new Map<string, { id: string; name: string }>()
  for (const r of rows) {
    if (r.kind === 'task' && r.list_id && !taskListMap.has(r.list_id)) {
      taskListMap.set(r.list_id, { id: r.list_id, name: r.calendar_name ?? '' })
    }
  }

  console.log(`[calendar][GET] TOTAL: ${Date.now() - tStart}ms`)

  return NextResponse.json({
    connected: true, events, tasks, writable, taskLists: Array.from(taskListMap.values()),
  })
}

export async function POST(request: NextRequest) {
  const conn = await getConnection()
  if ('error' in conn) return conn.error
  if ('notConnected' in conn)
    return NextResponse.json({ error: 'ยังไม่ได้เชื่อมปฏิทิน' }, { status: 400 })

  const {
    title, date, time, durationMins = 60, description,
    calendarId = 'primary', kind = 'event', listId, repeat, repeatUntil,
  } = await request.json()
  if (!title || !date)
    return NextResponse.json({ error: 'ต้องมีชื่อและวันที่' }, { status: 400 })

  const supabase = await createClient()
  const origin = request.nextUrl.origin

  if (kind === 'task') {
    const tsk = tasksFor(origin, conn.refreshToken!)
    let tasklist = listId
    if (!tasklist) {
      const lists = await tsk.tasklists.list()
      tasklist = lists.data.items?.[0]?.id
      if (!tasklist)
        return NextResponse.json({ error: 'ไม่พบ task list' }, { status: 400 })
    }
    // Google Tasks due รับแค่ส่วนวันที่ เวลาไม่มีผล
    await tsk.tasks.insert({
      tasklist,
      requestBody: {
        title,
        notes: description || undefined,
        due: new Date(`${date}T00:00:00`).toISOString(),
      },
    })
    await syncCalendarToCache(supabase, origin, conn.refreshToken!)
    return NextResponse.json({ ok: true })
  }

  const cal = calendarFor(origin, conn.refreshToken!)

  const event = time
    ? {
        summary: title,
        description: description || undefined,
        start: { dateTime: new Date(`${date}T${time}:00`).toISOString() },
        end: { dateTime: new Date(
          new Date(`${date}T${time}:00`).getTime() + durationMins * 60000
        ).toISOString() },
      }
    : {
        summary: title,
        description: description || undefined,
        start: { date },
        end: { date },
      }

  if (repeat && repeat !== 'none') {
    const freq = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }[repeat as string]
    if (freq) {
      let rule = `RRULE:FREQ=${freq}`
      if (repeatUntil) {
        rule += `;UNTIL=${repeatUntil.replaceAll('-', '')}T235959Z`
      }
      ;(event as Record<string, unknown>).recurrence = [rule]
    }
  }

  await cal.events.insert({ calendarId, requestBody: event })
  await syncCalendarToCache(supabase, origin, conn.refreshToken!)
  return NextResponse.json({ ok: true })
}

// ติ๊ก task เสร็จ
export async function PATCH(request: NextRequest) {
  const conn = await getConnection()
  if ('error' in conn) return conn.error
  if ('notConnected' in conn)
    return NextResponse.json({ error: 'ยังไม่ได้เชื่อมปฏิทิน' }, { status: 400 })

  const { taskId, listId } = await request.json()
  const origin = request.nextUrl.origin
  const tsk = tasksFor(origin, conn.refreshToken!)
  await tsk.tasks.patch({
    tasklist: listId, task: taskId,
    requestBody: { status: 'completed' },
  })

  const supabase = await createClient()
  await syncCalendarToCache(supabase, origin, conn.refreshToken!)
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const conn = await getConnection()
  if ('error' in conn) return conn.error
  if ('notConnected' in conn)
    return NextResponse.json({ error: 'ยังไม่ได้เชื่อมปฏิทิน' }, { status: 400 })

  const { eventId, calendarId } = await request.json()
  const origin = request.nextUrl.origin
  const cal = calendarFor(origin, conn.refreshToken!)
  await cal.events.delete({ calendarId: calendarId ?? 'primary', eventId })

  const supabase = await createClient()
  await syncCalendarToCache(supabase, origin, conn.refreshToken!)
  return NextResponse.json({ ok: true })
}
