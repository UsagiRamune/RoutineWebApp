import { createClient } from '@/lib/supabase/server'
import { ProjectWithFields, ProjectDoc } from '@/lib/supabase/types'
import { requireModuleEnabled } from '@/lib/modules'
import { dateKeyOffset, todayKey, getRolloverHour } from '@/lib/dates'
import AppNav from '@/components/AppNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import ProjectDetail from '@/components/projects/ProjectDetail'
import { notFound } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: Props) {
  await requireModuleEnabled('projects')
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const rollover = await getRolloverHour(supabase)
  const weekStart = dateKeyOffset(-6, rollover)
  const today = todayKey(rollover)

  const [projectRes, docsRes, routinesRes, connRes] = await Promise.all([
    supabase.from('projects').select(`
      *,
      project_fields ( *, project_tasks ( *, project_subtasks ( * ), project_work_logs ( * ) ) )
    `).eq('id', id)
      .order('sort_order', { referencedTable: 'project_fields' })
      .order('sort_order', { referencedTable: 'project_fields.project_tasks' })
      .maybeSingle(),
    supabase.from('project_docs').select('*').eq('project_id', id).order('updated_at', { ascending: false }),
    supabase.from('routines')
      .select('id, name, time_entries ( date, clock_in, clock_out )')
      .eq('project_id', id).eq('is_active', true),
    user
      ? supabase.from('google_connections').select('refresh_token').eq('user_id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  if (!projectRes.data) notFound()

  return (
    <>
      <AppNav />
      <RealtimeRefresher />
      <ProjectDetail
        project={projectRes.data as ProjectWithFields}
        docs={(docsRes.data ?? []) as ProjectDoc[]}
        linkedRoutines={(routinesRes.data ?? []) as {
          id: string; name: string
          time_entries: { date: string; clock_in: string; clock_out: string | null }[]
        }[]}
        weekStart={weekStart}
        today={today}
        hasGoogleCalendar={!!connRes.data}
      />
    </>
  )
}
