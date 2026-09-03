// จัดการ session หลับ-ตื่น (sleep_sessions) — ปุ่มเดียวสลับ + infer ตื่นถ้าห่างหายนาน
// เขียนจาก client component เท่านั้น (ใช้ browser supabase client)
import { createClient } from '@/lib/supabase/client'
import { SleepSession } from '@/lib/supabase/types'
import { todayKey, dateKeyForTimestamp } from '@/lib/dates'

export interface SleepState {
  state: 'awake' | 'asleep'
  since: Date
  sessionId: string | null
}

function startOfTodayBangkok(): Date {
  return new Date(`${todayKey()}T00:00:00+07:00`)
}

// asleep = แถวล่าสุดมี sleep_at และยังไม่มี wake_at
// awake = แถวล่าสุดมี wake_at (since = wake_at) หรือไม่มีแถวเลย (since = ต้นวันตาม rollover)
export async function getCurrentState(): Promise<SleepState> {
  const supabase = createClient()
  const { data } = await supabase.from('sleep_sessions')
    .select('*').order('sleep_at', { ascending: false }).limit(1).maybeSingle()
  const latest = data as SleepSession | null

  if (!latest) {
    return { state: 'awake', since: startOfTodayBangkok(), sessionId: null }
  }
  if (latest.wake_at == null) {
    return { state: 'asleep', since: new Date(latest.sleep_at), sessionId: latest.id }
  }
  return { state: 'awake', since: new Date(latest.wake_at), sessionId: latest.id }
}

// จุดเริ่มนับ hoursAwake สำหรับตารางน้ำ — งีบสั้น (<3 ชม.) ไม่นับเป็นจุดรีเซ็ตตาราง
// ต้องย้อนหา wake ที่ตามหลังการนอนจริงจัง (>=3 ชม.) ล่าสุด ไม่ใช่แค่แถวล่าสุดเฉยๆ
export async function getWaterScheduleAnchor(): Promise<Date> {
  const supabase = createClient()
  const { data } = await supabase.from('sleep_sessions')
    .select('*').order('sleep_at', { ascending: false }).limit(20)
  const sessions = (data ?? []) as SleepSession[]

  for (const s of sessions) {
    if (s.wake_at == null) continue // ยังไม่ตื่น (ไม่ใช่ completed session) ข้าม
    const hours = (new Date(s.wake_at).getTime() - new Date(s.sleep_at).getTime()) / 3600000
    if (hours >= 3) return new Date(s.wake_at)
  }
  return startOfTodayBangkok()
}

// เขียนความยาวที่นอนลง health_daily.sleep_minutes ของ "วันที่เริ่มหลับ" ตาม rollover
// (ไม่ใช่วันที่ตื่น — คนละวันได้ถ้านอนข้ามคืน) ไม่แตะ field อื่นที่มีอยู่แล้ว
async function recordSleepMinutes(session: { sleep_at: string; wake_at: string }) {
  const supabase = createClient()
  const minutes = Math.max(0, Math.round(
    (new Date(session.wake_at).getTime() - new Date(session.sleep_at).getTime()) / 60000))
  const date = dateKeyForTimestamp(session.sleep_at)

  const { data: existing } = await supabase.from('health_daily')
    .select('steps, calories_burned, resting_hr').eq('date', date).maybeSingle()

  await supabase.from('health_daily').upsert({
    date,
    steps: existing?.steps ?? null,
    calories_burned: existing?.calories_burned ?? null,
    resting_hr: existing?.resting_hr ?? null,
    sleep_minutes: minutes,
    source: 'manual',
  }, { onConflict: 'date' })
}

async function getOpenSession(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase.from('sleep_sessions')
    .select('*').is('wake_at', null).order('sleep_at', { ascending: false }).limit(1).maybeSingle()
  return data as SleepSession | null
}

export async function pressSleep(): Promise<void> {
  const supabase = createClient()
  const now = new Date().toISOString()

  // ปิด session ที่ค้างเปิดไว้ก่อนแบบ defensive (กันเคสกดเข้านอนซ้อนโดยไม่ได้กดตื่นก่อน)
  const open = await getOpenSession(supabase)
  if (open) {
    await supabase.from('sleep_sessions')
      .update({ wake_at: now, wake_source: 'manual' }).eq('id', open.id)
    await recordSleepMinutes({ sleep_at: open.sleep_at, wake_at: now })
  }

  await supabase.from('sleep_sessions').insert({ sleep_at: now, sleep_source: 'manual' })
}

export async function pressWake(): Promise<void> {
  const supabase = createClient()
  const now = new Date().toISOString()

  const open = await getOpenSession(supabase)
  if (open) {
    await supabase.from('sleep_sessions')
      .update({ wake_at: now, wake_source: 'manual' }).eq('id', open.id)
    await recordSleepMinutes({ sleep_at: open.sleep_at, wake_at: now })
  } else {
    // ไม่มี session เปิดอยู่ — ใส่แถวใหม่มีแค่ wake_at ตามสเปก
    await supabase.from('sleep_sessions').insert({ sleep_at: now, wake_at: now, wake_source: 'manual' })
  }
}

// เรียกตอน app load — คืนว่าควรโชว์ prompt "ตื่นแล้วใช่ไหม?" ไหม (ไม่เขียนอะไรเอง)
// เงื่อนไข: กำลังหลับอยู่ (state='asleep') และหลับมาแล้ว >= 3 ชม. — ถ้าน้อยกว่านั้นถือว่าแค่มาเปิดมือถือดู
export async function shouldPromptWake(): Promise<{ show: boolean; sessionId: string | null }> {
  const state = await getCurrentState()
  if (state.state !== 'asleep') return { show: false, sessionId: null }
  const hoursAsleep = (Date.now() - state.since.getTime()) / 3600000
  return { show: hoursAsleep >= 3, sessionId: state.sessionId }
}

// เลือก "ตื่นแล้ว" จาก prompt — wake_source='inferred'
export async function confirmInferredWake(sessionId: string): Promise<void> {
  const supabase = createClient()
  const now = new Date().toISOString()
  const { data: session } = await supabase.from('sleep_sessions')
    .select('sleep_at').eq('id', sessionId).single()
  await supabase.from('sleep_sessions')
    .update({ wake_at: now, wake_source: 'inferred' }).eq('id', sessionId)
  if (session) await recordSleepMinutes({ sleep_at: session.sleep_at, wake_at: now })
}

// แก้เวลาของ event ล่าสุด (sleep_at ถ้ากำลังหลับ, wake_at ถ้าตื่นแล้ว) ผ่าน "แก้เวลา" ใน UI
export async function editEventTime(
  sessionId: string, field: 'sleep_at' | 'wake_at', iso: string
): Promise<void> {
  const supabase = createClient()
  await supabase.from('sleep_sessions').update({ [field]: iso }).eq('id', sessionId)
  if (field === 'wake_at') {
    const { data: session } = await supabase.from('sleep_sessions')
      .select('sleep_at, wake_at').eq('id', sessionId).single()
    if (session?.wake_at) await recordSleepMinutes({ sleep_at: session.sleep_at, wake_at: session.wake_at })
  }
}
