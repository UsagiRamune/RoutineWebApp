// การ์ดปฏิทินบน dashboard — server component อ่านตรงจาก calendar_events_cache (Part 3) ไม่มี client
// fetch แล้ว: เร็วกว่าเดิม (ไม่ต้องรอ round-trip ฝั่ง browser) และ stream ได้ผ่าน Suspense (Part 5)
// ปรับ styling เป็น list-row style (design.md) — ไม่มีกรอบ card เต็ม ใช้ accent bar ซ้ายแทน
import { createClient, getCachedUser } from '@/lib/supabase/server'
import Link from 'next/link'
import { TZ } from '@/lib/dates'

interface Props {
  title: string
}

interface UpcomingEvent {
  id: string
  title: string
  start_at: string | null
  all_day: boolean
}

function fmt(e: UpcomingEvent) {
  const d = new Date(e.start_at!)
  const day = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: TZ })
  if (e.all_day) return day
  return `${day} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: TZ })}`
}

export default async function CalendarCard({ title }: Props) {
  // instrumentation ชั่วคราว — หา bottleneck จริงของการ์ดนี้บน dashboard (รายงานว่าช้า 2-3 วิ)
  // ดู breakdown ได้จาก Vercel function logs หลัง deploy จริง 1 ครั้ง
  const tStart = Date.now()
  console.log(`[CalendarCard] start at ${tStart}`)
  const supabase = await createClient()
  const { data: { user } } = await getCachedUser()
  console.log(`[CalendarCard] auth.getUser() (cached): ${Date.now() - tStart}ms`)

  let connected = false
  let upcoming: UpcomingEvent[] = []
  let errored = false

  if (user) {
    const tConn = Date.now()
    const { data: conn } = await supabase.from('google_connections')
      .select('refresh_token').eq('user_id', user.id).maybeSingle()
    console.log(`[CalendarCard] google_connections query: ${Date.now() - tConn}ms`)
    connected = !!conn

    if (connected) {
      const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      const horizon = new Date(Date.now() + 14 * 86400000).toISOString()
      const tCache = Date.now()
      const { data, error } = await supabase.from('calendar_events_cache')
        .select('google_event_id, title, start_at, all_day')
        .eq('kind', 'event').gte('start_at', dayStart).lte('start_at', horizon)
        .order('start_at').limit(10)
      console.log(`[CalendarCard] calendar_events_cache query: ${Date.now() - tCache}ms (rows=${data?.length ?? 0})`)

      if (error) {
        errored = true
      } else {
        const now = Date.now()
        upcoming = (data ?? [])
          .filter(e => e.all_day || (e.start_at != null && new Date(e.start_at).getTime() >= now))
          .slice(0, 2)
          .map(e => ({ id: e.google_event_id, title: e.title ?? '(ไม่มีชื่อ)', start_at: e.start_at, all_day: e.all_day }))
      }
    }
  }
  console.log(`[CalendarCard] TOTAL: ${Date.now() - tStart}ms`)

  // list-row style: accent bar ซ้าย (#4FC1E0 = ปฏิทิน/งาน), ไม่มีกรอบ card เต็ม
  // prefetch={false} — กันการ์ดนี้ (โผล่ในจอแรกของ dashboard) ยิง prefetch /calendar อัตโนมัติตอน
  // viewport visibility ทบกับการ์ดอื่นๆ ที่ prefetch พร้อมกันหมด
  return (
    <Link href="/calendar" prefetch={false}
      className="flex items-center gap-4 py-3.5 pl-0 pr-2
        hover:bg-[#1B1F2A] rounded-r-lg transition-colors group border-y border-[#2A2F3D]">
      {/* accent bar — ปฏิทิน/งาน = #4FC1E0 (design.md) */}
      <div className="w-[3px] self-stretch rounded-r-full flex-shrink-0 bg-[#4FC1E0]" />

      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[#7C8394] tracking-[0.05em] uppercase mb-0.5">{title}</p>
        {!connected && <p className="text-sm text-[#7C8394]">เชื่อม Google Calendar</p>}
        {connected && errored && <p className="text-sm text-[#E4574A]">ดึงข้อมูลไม่สำเร็จ</p>}
        {connected && !errored && (
          upcoming.length === 0
            ? <p className="text-sm text-[#7C8394]">ไม่มีนัดหมายเร็วๆ นี้</p>
            : <div className="space-y-0.5">
                {upcoming.map(e => (
                  <p key={e.id} className="text-sm text-[#EDEAE0] truncate">
                    <span className="font-mono text-xs text-[#7C8394]">{fmt(e)}</span>
                    {' · '}{e.title}
                  </p>
                ))}
              </div>
        )}
      </div>

      <svg className="w-4 h-4 text-[#2A2F3D] group-hover:text-[#7C8394] transition-colors flex-shrink-0"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}
