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
    remind_at: string | null
    remind_enabled: boolean
    remind_days: number[]
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
  ml: number
  container: string | null
  created_at: string
}

export interface WaterContainer {
  id: string
  name: string
  ml: number
  sort_order: number
  is_active: boolean
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
  daily_water_ml: number
  ml_per_sip: number
  ai_rationale: string | null
  updated_at: string
}

// ---------- sleep/wake ----------

export type SleepEventSource = 'manual' | 'inferred'

export interface SleepSession {
  id: string
  sleep_at: string
  wake_at: string | null
  sleep_source: SleepEventSource
  wake_source: SleepEventSource | null
  note: string | null
  created_at: string
}

// ---------- app settings ----------

export interface AppSettings {
  id: number
  day_rollover_hour: number
  water_window_hours: number
  water_frontload_ratio: number
  assumed_sleep_hours: number
  notify_email: string | null
  quiet_hours_enabled: boolean
}

// ---------- notifications ----------

export type NotificationKind =
  | 'water' | 'if_window' | 'morning_digest' | 'routine_due' | 'calendar_event' | 'weekly_summary'

export interface NotificationSetting {
  kind: NotificationKind
  label: string
  enabled: boolean
  max_per_day: number | null
  min_gap_minutes: number | null
  lead_minutes: number | null
}

export interface EmailLog {
  id: string
  kind: string
  ref: string
  subject: string
  sent_at: string
  ok: boolean
  error: string | null
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
