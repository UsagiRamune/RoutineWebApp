// จัดการกำหนดส่งของ project/field/task: POST = บันทึก due_date + sync ปฏิทิน, DELETE = cleanup event ก่อนลบแถวจริง
import { createClient } from '@/lib/supabase/server'
import {
  syncDeadlineEvent, cleanupProjectCalendarEvents, cleanupFieldCalendarEvents, deleteDeadlineEventIfAny,
  type DeadlineKind,
} from '@/lib/projects/calendar-sync'
import { NextResponse, type NextRequest } from 'next/server'

const TABLE_BY_KIND: Record<DeadlineKind, string> = {
  project: 'projects', field: 'project_fields', task: 'project_tasks',
}
const TITLE_FIELD: Record<DeadlineKind, string> = {
  project: 'name', field: 'name', task: 'title',
}

function isValidKind(kind: unknown): kind is DeadlineKind {
  return kind === 'project' || kind === 'field' || kind === 'task'
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })

  const { kind, id, due_date } = await request.json().catch(() => ({}))
  if (!isValidKind(kind) || !id) {
    return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }

  const table = TABLE_BY_KIND[kind]
  const titleField = TITLE_FIELD[kind]

  const { data: row } = await supabase.from(table)
    .select(`${titleField}, google_event_id`).eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'ไม่พบข้อมูล' }, { status: 404 })

  // เซฟ due_date ลง DB ก่อนเสมอ — ต่อให้ sync ปฏิทินพัง กำหนดส่งก็ต้องถูกบันทึกไว้
  await supabase.from(table).update({ due_date: due_date || null }).eq('id', id)

  try {
    const eventId = await syncDeadlineEvent(supabase, request.nextUrl.origin, {
      kind, id, title: String((row as any)[titleField] ?? ''),
      due_date: due_date || null, existingEventId: (row as any).google_event_id ?? null,
    })
    return NextResponse.json({ ok: true, google_event_id: eventId })
  } catch (err) {
    console.error('calendar deadline sync error:', err)
    return NextResponse.json({ ok: true, google_event_id: null, calendarSyncFailed: true })
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })

  const { kind, id } = await request.json().catch(() => ({}))
  if (!isValidKind(kind) || !id) {
    return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }

  const origin = request.nextUrl.origin
  try {
    if (kind === 'project') {
      await cleanupProjectCalendarEvents(supabase, origin, id)
    } else if (kind === 'field') {
      await cleanupFieldCalendarEvents(supabase, origin, id)
    } else {
      const { data: task } = await supabase.from('project_tasks').select('google_event_id').eq('id', id).maybeSingle()
      await deleteDeadlineEventIfAny(supabase, origin, task?.google_event_id ?? null)
    }
  } catch (err) {
    console.error('calendar cleanup error:', err)
    // cleanup ปฏิทินพังไม่ควรบล็อกการลบข้อมูลจริงที่ caller จะทำต่อ
  }
  return NextResponse.json({ ok: true })
}
