// CalendarCard — Bento-native server component (Pass 2: mini-calendar redesign)
// เป็นเจ้าของ surface ทั้งหมด (bg, border, rounded, padding) — BentoCalendarCard ทำหน้าที่แค่
// grid-placement wrapper บาง ไม่มี surface ซ้อนกันอีกต่อไป
//
// Query: ขยาย horizon จาก 14 → 42 วัน เพื่อให้ event-dot indicators ครอบคลุม full-month grid
// โดยไม่แตะ calendar sync/webhook architecture เลย
//
// Layout:
//   md+  : full-month 7-col grid (Mon–Sun), upcoming events ด้านล่าง
//   <md  : 2-week compact grid รอบวันนี้ (สัปดาห์ปัจจุบัน + สัปดาห์หน้า), upcoming events ด้านล่าง
//
// data access: calendar_events_cache (read-only) เหมือนเดิม
// errors/empty states: ยังคงทุก state เดิม (disconnected, error, no events)
import { createClient, getCachedUser } from '@/lib/supabase/server'
import Link from 'next/link'
import { TZ } from '@/lib/dates'

interface Props {
  title: string
}

interface CachedEvent {
  id: string
  title: string
  start_at: string | null
  all_day: boolean
}

// ---- date helpers (pure, server-side, timezone-aware) ----

/** วันที่ปัจจุบันใน Asia/Bangkok แบบ YYYY-MM-DD */
function bangkokDateParts(d: Date = new Date()) {
  const iso = d.toLocaleDateString('sv-SE', { timeZone: TZ }) // "2025-09-18"
  const [y, m, day] = iso.split('-').map(Number)
  return { year: y, month: m, day }
}

/** วัน 0=อาทิตย์ ของ Date ใน Bangkok tz */
function bangkokWeekday(y: number, m: number, d: number): number {
  // Date constructor ใช้ local time ของ server ซึ่งคือ UTC — ต้อง force เป็น UTC noon แล้วดึง weekday ใน BKK
  return new Date(
    new Date(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T12:00:00Z`)
      .toLocaleString('en-US', { timeZone: TZ, weekday: 'short' })
      .replace('Sun','0').replace('Mon','1').replace('Tue','2').replace('Wed','3')
      .replace('Thu','4').replace('Fri','5').replace('Sat','6')
  ) as unknown as number
}
function isoWeekday(y: number, m: number, d: number): number {
  const wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(
    new Date(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T12:00:00Z`)
      .toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' })
  )
  return wd
}

/** จำนวนวันในเดือน */
function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate() // Date(y, m, 0) = วันสุดท้ายของเดือน m-1
}

/** สร้าง date string YYYY-MM-DD */
function ds(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}

/** เพิ่ม/ลดวันจาก date string */
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toLocaleDateString('sv-SE', { timeZone: 'UTC' }) // YYYY-MM-DD
}

interface CalCell {
  dateStr: string    // YYYY-MM-DD
  day: number        // day number แสดงผล
  isCurrentMonth: boolean
  isToday: boolean
  hasEvent: boolean
}

/** สร้าง 6×7 grid สำหรับ full-month — week starts Monday */
function buildMonthGrid(year: number, month: number, todayStr: string, eventDates: Set<string>): CalCell[][] {
  const dim = daysInMonth(year, month)
  // หา weekday ของวันที่ 1 ของเดือน (0=Sun 1=Mon … 6=Sat)
  const firstWd = isoWeekday(year, month, 1)
  // Mon-first: offset = (firstWd + 6) % 7 (Mon=0, Tue=1, … Sun=6)
  const offset = (firstWd + 6) % 7

  const rows: CalCell[][] = []
  let row: CalCell[] = []
  // วันจาก prev month เพื่อเติม offset
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear  = month === 1 ? year - 1 : year
  const prevDim   = daysInMonth(prevYear, prevMonth)
  for (let i = offset - 1; i >= 0; i--) {
    const d = prevDim - i
    const dateStr = ds(prevYear, prevMonth, d)
    row.push({ dateStr, day: d, isCurrentMonth: false, isToday: dateStr === todayStr, hasEvent: eventDates.has(dateStr) })
  }
  // วันของเดือนนี้
  for (let d = 1; d <= dim; d++) {
    const dateStr = ds(year, month, d)
    row.push({ dateStr, day: d, isCurrentMonth: true, isToday: dateStr === todayStr, hasEvent: eventDates.has(dateStr) })
    if (row.length === 7) { rows.push(row); row = [] }
  }
  // เติม next month
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear  = month === 12 ? year + 1 : year
  let nd = 1
  while (row.length > 0 && row.length < 7) {
    const dateStr = ds(nextYear, nextMonth, nd)
    row.push({ dateStr, day: nd, isCurrentMonth: false, isToday: dateStr === todayStr, hasEvent: eventDates.has(dateStr) })
    nd++
  }
  if (row.length > 0) rows.push(row)
  // รับประกัน 6 rows (กัน layout กระโดดระหว่างเดือน)
  while (rows.length < 6) {
    const lastRow: CalCell[] = []
    for (let i = 0; i < 7; i++) {
      const dateStr = ds(nextYear, nextMonth, nd)
      lastRow.push({ dateStr, day: nd, isCurrentMonth: false, isToday: dateStr === todayStr, hasEvent: eventDates.has(dateStr) })
      nd++
    }
    rows.push(lastRow)
  }
  return rows
}

/** สร้าง 2-week window (14 วัน) เริ่มจาก Monday ก่อนหรือบน todayStr */
function buildTwoWeekGrid(todayStr: string, eventDates: Set<string>): CalCell[][] {
  const wd = isoWeekday(
    Number(todayStr.slice(0,4)),
    Number(todayStr.slice(5,7)),
    Number(todayStr.slice(8,10)),
  )
  // Mon offset: (wd + 6) % 7 days back
  const monOffset = (wd + 6) % 7
  const startStr = addDays(todayStr, -monOffset)
  const rows: CalCell[][] = []
  for (let w = 0; w < 2; w++) {
    const row: CalCell[] = []
    for (let d = 0; d < 7; d++) {
      const dateStr = addDays(startStr, w * 7 + d)
      const day = Number(dateStr.slice(8,10))
      const m   = Number(dateStr.slice(5,7))
      const tm  = Number(todayStr.slice(5,7))
      row.push({ dateStr, day, isCurrentMonth: m === tm, isToday: dateStr === todayStr, hasEvent: eventDates.has(dateStr) })
    }
    rows.push(row)
  }
  return rows
}

// ---- format helpers ----

function fmtUpcoming(e: CachedEvent) {
  const d = new Date(e.start_at!)
  const day = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: TZ })
  if (e.all_day) return day
  return `${day} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: TZ })}`
}

const DAY_HEADERS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']

// ---- component ----

export default async function CalendarCard({ title }: Props) {
  const tStart = Date.now()
  console.log(`[CalendarCard v2] start at ${tStart}`)
  const supabase = await createClient()
  const { data: { user } } = await getCachedUser()

  let connected = false
  let allEvents: CachedEvent[] = []
  let errored = false

  if (user) {
    const { data: conn } = await supabase.from('google_connections')
      .select('refresh_token').eq('user_id', user.id).maybeSingle()
    connected = !!conn

    if (connected) {
      // ขยาย horizon 14→42 วัน เพื่อให้ event dots ครอบคลุม full-month grid
      // (วันที่ 1 ของเดือนถัดไปอาจห่างได้ถึง ~31 วัน + offset สูงสุด 6 วัน = ~37 วัน)
      // ใช้ 42 วัน (= 6 สัปดาห์) ให้เผื่อ — ไม่แตะ sync/webhook architecture
      const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      const horizon  = new Date(Date.now() + 42 * 86400000).toISOString()
      const { data, error } = await supabase.from('calendar_events_cache')
        .select('google_event_id, title, start_at, all_day')
        .eq('kind', 'event').gte('start_at', dayStart).lte('start_at', horizon)
        .order('start_at').limit(60) // ขึ้นสูงสุด 60 events สำหรับ dot markers
      console.log(`[CalendarCard v2] cache query: ${Date.now() - tStart}ms (rows=${data?.length ?? 0})`)

      if (error) {
        errored = true
      } else {
        const now = Date.now()
        allEvents = (data ?? [])
          .filter(e => e.all_day || (e.start_at != null && new Date(e.start_at).getTime() >= now))
          .map(e => ({ id: e.google_event_id, title: e.title ?? '(ไม่มีชื่อ)', start_at: e.start_at, all_day: e.all_day }))
      }
    }
  }
  console.log(`[CalendarCard v2] TOTAL: ${Date.now() - tStart}ms`)

  // ---- date calculations ----
  const { year, month, day: todayDay } = bangkokDateParts()
  const todayStr = ds(year, month, todayDay)

  const eventDates = new Set(
    allEvents
      .filter(e => e.start_at != null)
      .map(e => new Date(e.start_at!).toLocaleDateString('sv-SE', { timeZone: TZ }))
  )

  const monthGrid    = buildMonthGrid(year, month, todayStr, eventDates)
  const twoWeekGrid  = buildTwoWeekGrid(todayStr, eventDates)

  // upcoming: แสดงสูงสุด 3 events
  const upcoming = allEvents.slice(0, 3)

  // ชื่อวัน/เดือนในภาษาไทย
  const todayWeekdayTh = new Date(todayStr + 'T12:00:00Z').toLocaleDateString('th-TH', {
    timeZone: TZ, weekday: 'long',
  })
  const monthNameTh = new Date(todayStr + 'T12:00:00Z').toLocaleDateString('th-TH', {
    timeZone: TZ, month: 'long',
  })

  // ---- cell renderer ----
  function CalCell({ cell, compact = false }: { cell: CalCell; compact?: boolean }) {
    const base = compact ? 'w-7 h-7 text-xs' : 'w-8 h-8 text-[13px]'
    if (cell.isToday) {
      return (
        <div className={`${base} flex flex-col items-center justify-center rounded-full
          bg-[#4FC1E0] text-[#14171F] font-semibold font-mono leading-none relative`}>
          {cell.day}
          {cell.hasEvent && (
            <span className="absolute -bottom-0.5 w-1 h-1 rounded-full bg-[#14171F] opacity-70" />
          )}
        </div>
      )
    }
    const textColor = !cell.isCurrentMonth
      ? 'text-[#3A3F50]'
      : 'text-[#EDEAE0]'
    return (
      <div className={`${base} flex flex-col items-center justify-center rounded-full
        font-mono leading-none relative ${textColor}`}>
        {cell.day}
        {cell.hasEvent && cell.isCurrentMonth && (
          <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-[#4FC1E0] opacity-60" />
        )}
      </div>
    )
  }

  function GridRows({ rows, compact = false }: { rows: CalCell[][]; compact?: boolean }) {
    return (
      <>
        {rows.map((row, ri) => (
          <div key={ri} className="grid grid-cols-7 gap-0">
            {row.map((cell) => (
              <div key={cell.dateStr} className="flex items-center justify-center py-[1px]">
                <CalCell cell={cell} compact={compact} />
              </div>
            ))}
          </div>
        ))}
      </>
    )
  }

  // ---- surface ----
  // CalendarCard ตอนนี้เป็นเจ้าของ surface ทั้งหมด (bg/border/rounded/padding)
  // BentoCalendarCard เหลือแค่ wrapper สำหรับ grid-span + Suspense ไม่มี visual styling
  return (
    <Link href="/calendar" prefetch={false}
      className="flex flex-col bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl
        hover:border-[#4FC1E0]/40 transition-colors group h-full min-h-[200px]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4FC1E0]/50">

      {/* ── Header ──────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between">
        <div className="flex items-end gap-3">
          {/* วันที่ตัวใหญ่ — hero element ของ calendar tile */}
          <span className="font-mono text-5xl font-semibold leading-none text-[#EDEAE0]">
            {todayDay}
          </span>
          <div className="flex flex-col pb-0.5">
            {/* วันในสัปดาห์ */}
            <span className="text-sm font-medium text-[#EDEAE0] leading-tight">
              {todayWeekdayTh}
            </span>
            {/* ชื่อเดือน */}
            <span className="text-xs text-[#7C8394] leading-tight mt-0.5">
              {monthNameTh}
            </span>
          </div>
        </div>
        {/* ลูกศรไปหน้าปฏิทิน */}
        <svg className="w-4 h-4 text-[#3A3F50] group-hover:text-[#7C8394] transition-colors flex-shrink-0 mt-1"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M17 7H7M17 7v10" />
        </svg>
      </div>

      {/* accent bar บาง — calendar accent #4FC1E0 */}
      <div className="mx-4 h-[1px] bg-[#2A2F3D] mb-3" />

      {/* ── Calendar content (ซ่อน/แสดงตาม breakpoint) ──── */}

      {/* ── desktop/tablet: full-month grid (md+) ──────── */}
      {connected && !errored ? (
        <>
          <div className="hidden md:block px-3 pb-1">
            {/* day-of-week headers */}
            <div className="grid grid-cols-7 gap-0 mb-1">
              {DAY_HEADERS.map(h => (
                <div key={h} className="text-center text-[10px] text-[#3A3F50] tracking-[0.04em] py-1">
                  {h}
                </div>
              ))}
            </div>
            <GridRows rows={monthGrid} />
          </div>

          {/* ── mobile: 2-week compact grid (<md) ───────── */}
          <div className="block md:hidden px-3 pb-1">
            <div className="grid grid-cols-7 gap-0 mb-1">
              {DAY_HEADERS.map(h => (
                <div key={h} className="text-center text-[10px] text-[#3A3F50] tracking-[0.04em] py-1">
                  {h}
                </div>
              ))}
            </div>
            <GridRows rows={twoWeekGrid} compact />
          </div>
        </>
      ) : (
        /* not connected / error state — ยังแสดง state เดิม แต่ใต้ header ใหม่ */
        <div className="px-4 pb-4 flex-1 flex items-center">
          {!connected && (
            <p className="text-sm text-[#7C8394]">เชื่อม Google Calendar</p>
          )}
          {connected && errored && (
            <p className="text-sm text-[#E4574A]">ดึงข้อมูลไม่สำเร็จ</p>
          )}
        </div>
      )}

      {/* ── Upcoming events ─────────────────────────── */}
      {connected && !errored && (
        <>
          <div className="mx-4 h-[1px] bg-[#2A2F3D] mt-1 mb-2" />
          <div className="px-4 pb-4 space-y-1.5 flex-shrink-0">
            {upcoming.length === 0 ? (
              <p className="text-xs text-[#3A3F50]">ไม่มีนัดหมายเร็วๆ นี้</p>
            ) : (
              upcoming.map(e => (
                <div key={e.id} className="flex items-baseline gap-1.5 min-w-0">
                  {/* dot indicator */}
                  <span className="w-1 h-1 rounded-full bg-[#4FC1E0] opacity-70 flex-shrink-0 mt-[5px]" />
                  {/* datetime */}
                  <span className="font-mono text-[11px] text-[#7C8394] flex-shrink-0">
                    {fmtUpcoming(e)}
                  </span>
                  {/* title */}
                  <span className="text-[12px] text-[#EDEAE0] truncate">· {e.title}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </Link>
  )
}
