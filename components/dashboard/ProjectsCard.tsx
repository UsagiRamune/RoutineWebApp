// การ์ดโปรเจกต์บน dashboard — แยกออกมาเป็น async server component ของตัวเอง (query project_fields/
// project_tasks ซ้อนกันหลายชั้น ไม่ใช่ query เบาๆ) ให้ stream ผ่าน Suspense ได้อิสระจากส่วนอื่นของหน้า (Part 5)
// ปรับ styling เป็น list-row style (design.md) — accent bar #9B7EDE = โปรเจกต์/สกิล
import { createClient } from '@/lib/supabase/server'
import { projectProgress, progressPct } from '@/lib/projects'
import Link from 'next/link'
import SegmentedBar from '@/components/ui/SegmentedBar'

interface Props {
  title: string
  weekStart: string
}

export default async function ProjectsCard({ title, weekStart }: Props) {
  // instrumentation ชั่วคราว — timestamp เริ่ม/จบ เทียบกับของ CalendarCard ใน Vercel logs หลัง deploy
  // จริง เพื่อยืนยันว่าสอง Suspense boundary นี้รันพร้อมกันจริง (เริ่มเวลาใกล้กัน) ไม่ใช่ทำทีละตัว
  const tStart = Date.now()
  console.log(`[ProjectsCard] start at ${tStart}`)
  const supabase = await createClient()
  const { data: projectsRes } = await supabase.from('projects').select(`
    id, name, sort_order,
    project_fields ( project_tasks ( status, completed_at ) )
  `).eq('status', 'active').order('sort_order')
  console.log(`[ProjectsCard] TOTAL: ${Date.now() - tStart}ms`)

  // โปรเจกต์ที่มี task เสร็จในสัปดาห์นี้มากที่สุด — ตัวแทนที่น่าสนใจที่สุดให้โชว์บนการ์ดเดียว
  const activeProjects = (projectsRes ?? []).map(p => {
    const progress = projectProgress(p.project_fields as any)
    let completedThisWeek = 0
    for (const f of p.project_fields as any[]) {
      for (const t of f.project_tasks) {
        if (t.status === 'done' && t.completed_at && t.completed_at.slice(0, 10) >= weekStart) completedThisWeek++
      }
    }
    return { id: p.id, name: p.name, progress, completedThisWeek }
  })
  const topProject = activeProjects.length > 0
    ? [...activeProjects].sort((a, b) => b.completedThisWeek - a.completedThisWeek)[0]
    : null

  const pct = topProject ? progressPct(topProject.progress) : 0

  // list-row style: accent bar ซ้าย (#9B7EDE = โปรเจกต์/สกิล), ไม่มีกรอบ card เต็ม (design.md)
  // prefetch={false} — กัน prefetch ยิงพร้อมกันหมดตั้งแต่โหลด dashboard
  return (
    <Link href="/projects" prefetch={false}
      className="flex items-center gap-4 py-3.5 pl-0 pr-2
        hover:bg-[#1B1F2A] rounded-r-lg transition-colors group border-y border-[#2A2F3D]">
      {/* accent bar — โปรเจกต์/สกิล = #9B7EDE (design.md) */}
      <div className="w-[3px] self-stretch rounded-r-full flex-shrink-0 bg-[#9B7EDE]" />

      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[#7C8394] tracking-[0.05em] uppercase mb-0.5">{title}</p>
        {topProject ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium truncate">{topProject.name}</span>
              <span className="font-mono text-sm font-semibold">
                {pct}<span className="text-xs font-normal text-[#7C8394]">%</span>
              </span>
            </div>
            <p className="text-xs text-[#7C8394] mt-0.5">{activeProjects.length} โปรเจกต์กำลังทำ</p>
            <SegmentedBar value={pct} target={100} color="#9B7EDE" className="mt-2 max-w-[160px]" />
          </>
        ) : (
          <p className="text-sm text-[#7C8394]">ยังไม่มีโปรเจกต์</p>
        )}
      </div>

      <svg className="w-4 h-4 text-[#2A2F3D] group-hover:text-[#7C8394] transition-colors flex-shrink-0"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}
