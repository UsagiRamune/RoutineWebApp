// คำนวณ progress ของโปรเจกต์ (done/total task จากทุก field) — ใช้ร่วมกันทั้งหน้า list, detail,
// dashboard card, และ analyze prompt กันตรรกะเพี้ยนไม่ตรงกันระหว่างจุดที่ต่างกัน
export interface ProgressCount {
  done: number
  total: number
}

export function projectProgress(fields: { project_tasks: { status: string }[] }[]): ProgressCount {
  let done = 0, total = 0
  for (const f of fields) {
    for (const t of f.project_tasks) {
      total++
      if (t.status === 'done') done++
    }
  }
  return { done, total }
}

export function progressPct(p: ProgressCount): number {
  return p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
}

// สีสำหรับ field — ใช้ชุดเดียวกับที่ routine_categories ใช้อยู่แล้ว (#F0A345 #4FC1E0 #9B7EDE) เพิ่มมาอีก 2
export const FIELD_COLORS = ['#4FC1E0', '#F0A345', '#9B7EDE', '#6FCF97', '#E07BA8']

export const STATUS_LABEL: Record<string, string> = {
  active: 'กำลังทำ', paused: 'พักไว้', done: 'เสร็จแล้ว', archived: 'เก็บถาวร',
}

export const STATUS_COLOR: Record<string, string> = {
  active: '#4FC1E0', paused: '#F0A345', done: '#6FCF97', archived: '#7C8394',
}

// นาที → "N ชม. M นาที" — รูปแบบเดียวกับที่ TodayView ใช้กับเวลาจับ routine
export function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`
}

// จำนวนวันจนถึง targetDate เทียบเที่ยงคืน Bangkok ของ today (ทั้งคู่เป็น date string "YYYY-MM-DD")
export function daysUntil(targetDate: string, today: string): number {
  const target = new Date(`${targetDate}T00:00:00+07:00`)
  const now = new Date(`${today}T00:00:00+07:00`)
  return Math.round((target.getTime() - now.getTime()) / 86400000)
}

export function daysUntilLabel(days: number): string {
  if (days < 0) return `เกินกำหนด ${-days} วัน`
  if (days === 0) return 'ครบกำหนดวันนี้'
  return `เหลือ ${days} วัน`
}

// รวมนาทีที่บันทึกใน work log — ต่อ task / field (รวมทุก task) / project (รวมทุก field)
// minutes เป็น null ได้ตอน log กำลังจับเวลาอยู่ (มี clock_in แต่ยังไม่ clock_out) — ไม่นับรวมจนกว่าจะหยุด
export function taskWorkMinutes(task: { project_work_logs: { minutes: number | null }[] }): number {
  return task.project_work_logs.reduce((s, l) => s + (l.minutes ?? 0), 0)
}

export function fieldWorkMinutes(
  field: { project_tasks: { project_work_logs: { minutes: number | null }[] }[] }
): number {
  return field.project_tasks.reduce((s, t) => s + taskWorkMinutes(t), 0)
}

export function projectWorkMinutes(
  fields: { project_tasks: { project_work_logs: { minutes: number | null }[] }[] }[]
): number {
  return fields.reduce((s, f) => s + fieldWorkMinutes(f), 0)
}
