// BentoCalendarCard — pure grid-placement + Suspense wrapper เท่านั้น
// CalendarCard (Pass 2) เป็นเจ้าของ surface ทั้งหมดแล้ว (bg, border, rounded, padding)
// wrapper นี้ไม่มี visual styling ของตัวเอง — ป้องกัน card-in-card / nested border / double accent
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
    // ไม่มี bg/border/rounded/padding ที่นี่ — CalendarCard ถือ surface เองทั้งหมด
    <div className={className}>
      <Suspense fallback={<CardSkeleton />}>
        <CalendarCard title={title} />
      </Suspense>
    </div>
  )
}
