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

export interface Module {
  key: string
  name: string
  enabled: boolean
  sort_order: number
  settings: Record<string, unknown> | null
}

// ---------- nutrition ----------

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other'

export interface FoodEntry {
  id: string
  date: string
  meal: MealType
  name: string
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  note: string | null
  created_at: string
}

export interface WaterEntry {
  id: string
  date: string
  created_at: string
}

export type SupplementSlot = 'wake' | 'sleep' | 'workout' | 'anytime'

export interface Supplement {
  id: string
  name: string
  dose: string | null
  slot: SupplementSlot
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface SupplementLog {
  id: string
  supplement_id: string
  date: string
  taken_at: string
}

export interface IfSettings {
  id: number
  enabled: boolean
  eat_start: string
  eat_end: string
}

export type NutritionPlan = 'cut' | 'normal' | 'bulk'

export interface NutritionProfile {
  id: number
  plan: NutritionPlan
  daily_calories: number | null
  daily_protein_g: number | null
  daily_water_glasses: number
  ai_rationale: string | null
  updated_at: string
}

// ---------- health (manual entry only) ----------

// เก็บ union เดิมไว้เผื่อแถวเก่าจากตอนยังมี sync (schema ไม่เปลี่ยน) แต่โค้ดฝั่งแอปเขียนแค่ 'manual' แล้ว
export type HealthSource = 'sync' | 'manual'

export interface HealthDaily {
  id: string
  date: string
  steps: number | null
  calories_burned: number | null
  active_minutes: number | null
  resting_hr: number | null
  sleep_minutes: number | null
  source: HealthSource
  synced_at: string | null
}
