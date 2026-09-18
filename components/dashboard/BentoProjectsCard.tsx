// Bento wrapper สำหรับ ProjectsCard — ห่อ card surface โดยไม่แตะ internal content/query
// ProjectsCard เดิมเป็น list-row style สำหรับ full-width list
// wrapper นี้ให้ card surface สำหรับ Bento Grid เท่านั้น (layout pass)
import { Suspense } from 'react'
import ProjectsCard from '@/components/dashboard/ProjectsCard'
import CardSkeleton from '@/components/dashboard/CardSkeleton'

interface Props {
  title: string
  weekStart: string
  className?: string
}

export default function BentoProjectsCard({ title, weekStart, className = '' }: Props) {
  return (
    <div className={`bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl overflow-hidden hover:border-[#7C8394] transition-colors ${className}`}>
      <div className="h-[2px] w-8 rounded-full mx-4 mt-4 mb-0 flex-shrink-0 bg-[#9B7EDE]" />
      <Suspense fallback={<CardSkeleton />}>
        <ProjectsCard title={title} weekStart={weekStart} />
      </Suspense>
    </div>
  )
}
