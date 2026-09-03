'use client'

// การ์ดปฏิทินบน dashboard — ดึง /api/calendar เองฝั่ง client แล้วโชว์ 2 นัดหมายถัดไป
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TZ } from '@/lib/dates'

interface CalEvent {
  id: string
  title: string
  start: string
  allDay: boolean
}

export default function CalendarCard({ title }: { title: string }) {
  const [state, setState] =
    useState<'loading' | 'notConnected' | 'ready' | 'error'>('loading')
  const [events, setEvents] = useState<CalEvent[]>([])

  useEffect(() => {
    fetch('/api/calendar?days=14')
      .then(r => r.json())
      .then(data => {
        if (!data.connected) { setState('notConnected'); return }
        setEvents(data.events ?? [])
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [])

  function fmt(e: CalEvent) {
    const d = new Date(e.start)
    const day = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: TZ })
    if (e.allDay) return day
    return `${day} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: TZ })}`
  }

  const upcoming = events
    .filter(e => e.allDay || new Date(e.start).getTime() >= Date.now())
    .slice(0, 2)

  return (
    <Link href="/calendar"
      className="block bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4
        hover:border-[#7C8394] transition-colors">
      <p className="text-sm font-medium mb-2">{title}</p>
      {state === 'loading' && <p className="text-xs text-[#7C8394]">กำลังโหลด...</p>}
      {state === 'notConnected' && <p className="text-xs text-[#7C8394]">เชื่อม Google Calendar</p>}
      {state === 'error' && <p className="text-xs text-[#E4574A]">ดึงข้อมูลไม่สำเร็จ</p>}
      {state === 'ready' && (
        upcoming.length === 0
          ? <p className="text-xs text-[#7C8394]">ไม่มีนัดหมายเร็วๆ นี้</p>
          : <div className="space-y-1">
              {upcoming.map(e => (
                <p key={e.id} className="text-xs text-[#7C8394] truncate">
                  <span className="tabular-nums">{fmt(e)}</span> · {e.title}
                </p>
              ))}
            </div>
      )}
    </Link>
  )
}
