// หน้าประวัติ — ดึงข้อมูลตามช่วงเวลาที่เลือก แล้วส่งให้ HistoryView
import { createClient } from '@/lib/supabase/server'
import HistoryView from '@/components/HistoryView'

// searchParams ใน Next.js 15 เป็น Promise ต้อง await
interface Props {
  searchParams: Promise<{ view?: string }>
}

export default async function History({ searchParams }: Props) {
  const { view: viewParam } = await searchParams
  const view = (['week', 'month', 'year'].includes(viewParam ?? '')
    ? viewParam : 'week') as 'week' | 'month' | 'year'

  // ช่วงวันที่ตามมุมมอง (+1 กันเหลื่อม timezone)
  const days = view === 'week' ? 7 : view === 'month' ? 30 : 365
  const from = new Date()
  from.setDate(from.getDate() - days)
  const fromStr = from.toLocaleDateString('sv-SE')

  const supabase = await createClient()

  // ยิง 5 query พร้อมกัน — ไม่ต้องรอทีละอัน
  const [entries, completions, targets, metrics, categories] = await Promise.all([
    supabase.from('time_entries')
      .select('*, routines(name, category_id, default_target_minutes)')
      .gte('date', fromStr).order('clock_in'),
    supabase.from('item_completions')
      .select('*, routine_items(name, routine_id)')
      .gte('date', fromStr),
    supabase.from('daily_targets').select('*').gte('date', fromStr),
    supabase.from('body_metrics').select('*').gte('date', fromStr).order('date'),
    supabase.from('routine_categories').select('*, routines(*)').order('sort_order'),
  ])

  const today = new Date().toLocaleDateString('sv-SE')

  return (
    <HistoryView
      view={view}
      today={today}
      entries={(entries.data ?? []) as any}
      completions={(completions.data ?? []) as any}
      targets={targets.data ?? []}
      metrics={metrics.data ?? []}
      categories={(categories.data ?? []) as any}
    />
  )
}