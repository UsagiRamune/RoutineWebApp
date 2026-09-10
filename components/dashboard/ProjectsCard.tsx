// การ์ดโปรเจกต์บน dashboard — แยกออกมาเป็น async server component ของตัวเอง (query project_fields/
// project_tasks ซ้อนกันหลายชั้น ไม่ใช่ query เบาๆ) ให้ stream ผ่าน Suspense ได้อิสระจากส่วนอื่นของหน้า (Part 5)
import { createClient } from '@/lib/supabase/server'
import { projectProgress, progressPct } from '@/lib/projects'
import ModuleCard from '@/components/dashboard/ModuleCard'

interface Props {
  title: string
  weekStart: string
}

export default async function ProjectsCard({ title, weekStart }: Props) {
  const supabase = await createClient()
  const { data: projectsRes } = await supabase.from('projects').select(`
    id, name, sort_order,
    project_fields ( project_tasks ( status, completed_at ) )
  `).eq('status', 'active').order('sort_order')

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

  return (
    <ModuleCard href="/projects" title={title}>
      {topProject ? (
        <>
          <p className="text-sm font-medium truncate">{topProject.name}</p>
          <p className="text-2xl font-semibold">
            {progressPct(topProject.progress)}<span className="text-sm font-normal text-[#7C8394]">%</span>
          </p>
          <p className="text-xs text-[#7C8394] mt-1">{activeProjects.length} โปรเจกต์กำลังทำ</p>
        </>
      ) : (
        <p className="text-sm text-[#7C8394]">ยังไม่มีโปรเจกต์</p>
      )}
    </ModuleCard>
  )
}
