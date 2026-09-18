// Bento wrapper สำหรับ CalendarCard — ห่อ card surface รอบ CalendarCard โดยไม่แตะ internal content
// CalendarCard เดิมเป็น list-row style (accent bar ซ้าย) ที่ออกแบบมาสำหรับ full-width list
// wrapper นี้ให้ card surface + padding สำหรับ Bento Grid เท่านั้น (layout pass — ดู design.md)
import { Suspense } from 'react'
import CalendarCard from '@/components/dashboard/CalendarCard'
import CardSkeleton from '@/components/dashboard/CardSkeleton'

interface Props {
  title: string
  /** Tailwind grid span classes จาก parent (เช่น "col-span-2 row-span-2") */
  className?: string
}

export default function BentoCalendarCard({ title, className = '' }: Props) {
  return (
    <div className={`bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl overflow-hidden hover:border-[#7C8394] transition-colors ${className}`}>
      {/* accent bar ด้านบน — calendar/งาน = #4FC1E0 (design.md) */}
      <div className="h-[2px] w-8 rounded-full mx-4 mt-4 mb-0 flex-shrink-0 bg-[#4FC1E0]" />
      {/* CalendarCard เดิม — ไม่แก้ internal เลย (layout pass เท่านั้น) */}
      <Suspense fallback={<CardSkeleton />}>
        <CalendarCard title={title} />
      </Suspense>
    </div>
  )
}
