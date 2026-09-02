// API ปฏิทิน+tasks: GET = ดึงทุกอย่าง, POST = สร้างอีเวนต์, PATCH = ติ๊ก task, DELETE = ลบอีเวนต์
import { createClient } from '@/lib/supabase/server'
import { calendarFor, tasksFor } from '@/lib/google/calendar'
import { NextResponse, type NextRequest } from 'next/server'

async function getConnection() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'ยังไม่ login' }, { status: 401 }) }
  const { data } = await supabase.from('google_connections')
    .select('refresh_token').eq('user_id', user.id).single()
  if (!data) return { notConnected: true }
  return { refreshToken: data.refresh_token }
}

export async function GET(request: NextRequest) {
  const conn = await getConnection()
  if ('error' in conn) return conn.error
  if ('notConnected' in conn) return NextResponse.json({ connected: false })

    const origin = request.nextUrl.origin
    const cal = calendarFor(origin, conn.refreshToken!)
    const tsk = tasksFor(origin, conn.refreshToken!)

    const days = Math.min(31, Math.max(1,
    parseInt(request.nextUrl.searchParams.get('days') ?? '7')))
    const dayStart = new Date(new Date().setHours(0, 0, 0, 0))
    const horizon = new Date(dayStart.getTime() + days * 86400000)

  try {
    // ปฏิทินทั้งหมด + task lists ทั้งหมด — ยิงพร้อมกัน
    const [calList, taskLists] = await Promise.all([
      cal.calendarList.list(),
      tsk.tasklists.list().catch((err) => {
        console.error('tasks list error:', err?.message ?? err)
        return { data: { items: [] } }
      }),
    ])
    const calendars = calList.data.items ?? []

    const [eventResults, taskResults] = await Promise.all([
      Promise.all(calendars.map(c =>
        cal.events.list({
          calendarId: c.id!,
          timeMin: dayStart.toISOString(),
          timeMax: horizon.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 20,
        })
        .then(r => (r.data.items ?? []).map(e => ({
          id: e.id,
          calendarId: c.id,
          calendarName: c.summary ?? '',
          title: e.summary ?? '(ไม่มีชื่อ)',
          description: e.description ?? '',
          start: e.start?.dateTime ?? e.start?.date ?? '',
          end: e.end?.dateTime ?? '',
          allDay: !e.start?.dateTime,
          isBirthday: e.eventType === 'birthday' ||
            (c.id ?? '').includes('#contacts'),
        })))
        .catch(() => [])
      )),
      Promise.all((taskLists.data.items ?? []).map(l =>
        tsk.tasks.list({
          tasklist: l.id!,
          showCompleted: false,
          maxResults: 100,
        })
        .then(r => (r.data.items ?? [])
          .filter(t => t.due && new Date(t.due) < horizon)
          .map(t => ({
            id: t.id,
            listId: l.id,
            listName: l.title ?? '',
            title: t.title ?? '(ไม่มีชื่อ)',
            notes: t.notes ?? '',
            due: t.due!,
          })))
        .catch(() => [])
      )),
    ])

    // ปฏิทินที่เขียนได้ — ไว้ให้ฟอร์มเลือกปลายทาง
    const writable = calendars
      .filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
      .map(c => ({ id: c.id, name: c.summary ?? '', primary: !!c.primary }))

    // task lists — ไว้ให้ฟอร์มเลือกปลายทางตอนสร้าง task (reuse ผลจาก tsk.tasklists.list() ด้านบน)
    const taskListOptions = (taskLists.data.items ?? [])
      .map(l => ({ id: l.id!, name: l.title ?? '' }))

    const events = eventResults.flat()
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 30)
    const tasks = taskResults.flat()
      .sort((a, b) => a.due.localeCompare(b.due))

    return NextResponse.json({
      connected: true, events, tasks, writable, taskLists: taskListOptions,
    })
  } catch (err) {
    console.error('calendar list error:', err)
    return NextResponse.json({ error: 'ดึงข้อมูลไม่สำเร็จ ลองเชื่อมใหม่' }, { status: 500 })
  }
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

  if (kind === 'task') {
    const tsk = tasksFor(request.nextUrl.origin, conn.refreshToken!)
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
    return NextResponse.json({ ok: true })
  }

  const cal = calendarFor(request.nextUrl.origin, conn.refreshToken!)

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
  return NextResponse.json({ ok: true })
}

// ติ๊ก task เสร็จ
export async function PATCH(request: NextRequest) {
  const conn = await getConnection()
  if ('error' in conn) return conn.error
  if ('notConnected' in conn)
    return NextResponse.json({ error: 'ยังไม่ได้เชื่อมปฏิทิน' }, { status: 400 })

  const { taskId, listId } = await request.json()
  const tsk = tasksFor(request.nextUrl.origin, conn.refreshToken!)
  await tsk.tasks.patch({
    tasklist: listId, task: taskId,
    requestBody: { status: 'completed' },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const conn = await getConnection()
  if ('error' in conn) return conn.error
  if ('notConnected' in conn)
    return NextResponse.json({ error: 'ยังไม่ได้เชื่อมปฏิทิน' }, { status: 400 })

  const { eventId, calendarId } = await request.json()
  const cal = calendarFor(request.nextUrl.origin, conn.refreshToken!)
  await cal.events.delete({ calendarId: calendarId ?? 'primary', eventId })
  return NextResponse.json({ ok: true })
}