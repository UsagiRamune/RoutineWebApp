import { createClient } from '@/lib/supabase/server'
import { ProjectWithFields } from '@/lib/supabase/types'
import { requireModuleEnabled } from '@/lib/modules'
import { todayKey, getRolloverHour } from '@/lib/dates'
import AppNav from '@/components/AppNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import ProjectsList from '@/components/projects/ProjectsList'

export default async function ProjectsPage() {
  await requireModuleEnabled('projects')

  const supabase = await createClient()
  const rollover = await getRolloverHour(supabase)
  const today = todayKey(rollover)

  const { data: projects } = await supabase.from('projects').select(`
    *,
    project_fields ( *, project_tasks ( * ) )
  `).order('sort_order')
    .order('sort_order', { referencedTable: 'project_fields' })
    .order('sort_order', { referencedTable: 'project_fields.project_tasks' })

  return (
    <>
      <AppNav />
      <RealtimeRefresher />
      <main className="min-h-screen bg-[#14171F] text-[#EDEAE0] pb-16">
        <div className="max-w-3xl mx-auto px-4 pt-8">
          <h1 className="text-xl font-semibold mb-6">โปรเจกต์</h1>
          <ProjectsList projects={(projects ?? []) as ProjectWithFields[]} today={today} />
        </div>
      </main>
    </>
  )
}
