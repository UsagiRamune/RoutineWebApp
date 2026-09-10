// sync กำหนดส่งของ project/field/task เข้า Google Calendar (all-day event, ปฏิทินหลัก)
// reuse calendarFor() ที่มีอยู่แล้ว — ไม่สร้าง OAuth client ซ้ำ
// เรียกจาก context ที่มี user session อยู่แล้วเท่านั้น (route handler ที่ auth ผ่าน cookie) เพราะต้องอ่าน
// google_connections ซึ่ง RLS ผูกกับ auth.uid() — ไม่ใช้กับ cron (ไม่มี session)
import { calendarFor } from '@/lib/google/calendar'

export type DeadlineKind = 'project' | 'field' | 'task'

const TABLE_BY_KIND: Record<DeadlineKind, string> = {
  project: 'projects', field: 'project_fields', task: 'project_tasks',
}

export interface SyncDeadlineInput {
  kind: DeadlineKind
  id: string
  title: string
  due_date: string | null
  existingEventId: string | null
}

async function getRefreshToken(supabase: any): Promise<string | null> {
  const { data } = await supabase.from('google_connections').select('refresh_token').limit(1).maybeSingle()
  return data?.refresh_token ?? null
}

// สร้าง/อัปเดต/ลบ event ตาม due_date แล้วเขียน google_event_id กลับที่แถวเอง (projects/project_fields/project_tasks)
// ถ้ายังไม่เชื่อม Google Calendar (ไม่มี google_connections) จะข้ามเงียบๆ คืน null โดยไม่แตะ DB เพิ่ม —
// กำหนดส่งเองต้องถูก caller เซฟลง DB ไว้ก่อนหน้านี้แล้ว (ฟังก์ชันนี้จัดการแค่ฝั่งปฏิทิน + google_event_id)
export async function syncDeadlineEvent(
  supabase: any, origin: string, input: SyncDeadlineInput
): Promise<string | null> {
  const refreshToken = await getRefreshToken(supabase)
  if (!refreshToken) return null

  const cal = calendarFor(origin, refreshToken)
  const table = TABLE_BY_KIND[input.kind]
  let eventId: string | null = null

  if (!input.due_date) {
    if (input.existingEventId) {
      try {
        await cal.events.delete({ calendarId: 'primary', eventId: input.existingEventId })
      } catch {
        // ถูกลบไปจากปฏิทินแล้ว (มือลบเอง) — เฉยไว้ ไม่ throw
      }
    }
  } else {
    const requestBody = {
      summary: `📌 ${input.title}`,
      start: { date: input.due_date },
      end: { date: input.due_date },
    }
    try {
      if (input.existingEventId) {
        const res = await cal.events.update({
          calendarId: 'primary', eventId: input.existingEventId, requestBody,
        })
        eventId = res.data.id ?? input.existingEventId
      } else {
        const res = await cal.events.insert({ calendarId: 'primary', requestBody })
        eventId = res.data.id ?? null
      }
    } catch {
      // event เดิมอาจถูกลบไปจากปฏิทินแล้ว — ลองสร้างใหม่แทนการ update ที่พัง
      const res = await cal.events.insert({ calendarId: 'primary', requestBody })
      eventId = res.data.id ?? null
    }
  }

  await supabase.from(table).update({ google_event_id: eventId }).eq('id', input.id)
  return eventId
}

// ลบ event เดียวโดยไม่แตะ DB (ใช้ตอน cleanup ก่อนลบแถวจริง) — เงียบถ้าไม่เจอ event หรือยังไม่เชื่อมปฏิทิน
export async function deleteDeadlineEventIfAny(
  supabase: any, origin: string, existingEventId: string | null
): Promise<void> {
  if (!existingEventId) return
  const refreshToken = await getRefreshToken(supabase)
  if (!refreshToken) return
  const cal = calendarFor(origin, refreshToken)
  try {
    await cal.events.delete({ calendarId: 'primary', eventId: existingEventId })
  } catch {
    // ถูกลบไปแล้วหรือหาไม่เจอ — เฉยไว้
  }
}

// ลบ event ของ project เอง + ทุก field + ทุก task ในนั้น (เรียกก่อนลบ project จริง)
export async function cleanupProjectCalendarEvents(
  supabase: any, origin: string, projectId: string
): Promise<void> {
  const refreshToken = await getRefreshToken(supabase)
  if (!refreshToken) return

  const [{ data: project }, { data: fields }] = await Promise.all([
    supabase.from('projects').select('google_event_id').eq('id', projectId).maybeSingle(),
    supabase.from('project_fields').select('id, google_event_id').eq('project_id', projectId),
  ])
  const fieldIds = (fields ?? []).map((f: any) => f.id)
  let taskEventIds: string[] = []
  if (fieldIds.length > 0) {
    const { data: tasks } = await supabase.from('project_tasks').select('google_event_id').in('field_id', fieldIds)
    taskEventIds = (tasks ?? []).map((t: any) => t.google_event_id).filter(Boolean)
  }
  const allEventIds = [
    project?.google_event_id, ...(fields ?? []).map((f: any) => f.google_event_id), ...taskEventIds,
  ].filter(Boolean) as string[]
  if (allEventIds.length === 0) return

  const cal = calendarFor(origin, refreshToken)
  await Promise.all(allEventIds.map(eventId =>
    cal.events.delete({ calendarId: 'primary', eventId }).catch(() => {})
  ))
}

// ลบ event ของ field เอง + ทุก task ในนั้น (เรียกก่อนลบ field จริง)
export async function cleanupFieldCalendarEvents(
  supabase: any, origin: string, fieldId: string
): Promise<void> {
  const refreshToken = await getRefreshToken(supabase)
  if (!refreshToken) return

  const [{ data: field }, { data: tasks }] = await Promise.all([
    supabase.from('project_fields').select('google_event_id').eq('id', fieldId).maybeSingle(),
    supabase.from('project_tasks').select('google_event_id').eq('field_id', fieldId),
  ])
  const allEventIds = [
    field?.google_event_id, ...(tasks ?? []).map((t: any) => t.google_event_id),
  ].filter(Boolean) as string[]
  if (allEventIds.length === 0) return

  const cal = calendarFor(origin, refreshToken)
  await Promise.all(allEventIds.map(eventId =>
    cal.events.delete({ calendarId: 'primary', eventId }).catch(() => {})
  ))
}
