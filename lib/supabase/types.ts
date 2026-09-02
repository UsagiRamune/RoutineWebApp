export type CategoryKind = 'checklist' | 'timed'

export interface RoutineCategory {
    id: string
    name: string
    color: string
    kind: CategoryKind
    sort_order: number
    created_at: string
}

export interface Routine {
    id: string
    category_id: string
    name: string
    description: string | null
    is_active: boolean
    sort_order: number
    default_target_minutes: number | null
    created_at: string
}

export interface RoutineItem {
    id: string
    routine_id: string
    name: string
    detail: string | null
    is_active: boolean
    sort_order: number
    created_at: string
    item_completions?: ItemCompletion[]
}

export interface DailyTarget {
    id: string
    routine_id: string
    date: string
    target_minutes: number | null
    note: string | null
    created_at: string
}

export interface TimeEntry {
    id: string
    routine_id: string
    date: string
    clock_in: string
    clock_out: string | null
    note: string | null
    details: DetailTopic[]
    created_at: string
}

export interface ItemCompletion {
    id: string
    routine_item_id: string
    date: string
    completed_at: string
}

export interface DetailSub {
  id: string
  text: string
}

export interface DetailTopic {
  id: string
  title: string
  subs: DetailSub[]
}

export interface BodyMetric {
  id: string
  date: string
  weight_kg: number | null
  height_cm: number | null
  note: string | null
  created_at: string
}

export interface RoutineWithDetails extends Routine {
    routine_items: RoutineItem[]
    time_entries: TimeEntry[]
    daily_targets: DailyTarget[]
}

export interface CategoryWithRoutines extends RoutineCategory {
    routines: RoutineWithDetails[]
}

export interface TimeEntryWithRoutine extends TimeEntry {
  routines: {
    name: string
    category_id: string
    default_target_minutes: number | null
  } | null
}

export interface ItemCompletionWithItem extends ItemCompletion {
  routine_items: {
    name: string
    routine_id: string
  } | null
}
