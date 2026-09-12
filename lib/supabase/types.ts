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
    project_id: string | null
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

// ---------- projects ----------

export type ProjectStatus = 'active' | 'paused' | 'done' | 'archived'

export interface Project {
  id: string
  name: string
  description: string | null
  status: ProjectStatus
  is_solo: boolean
  target_date: string | null
  sort_order: number
  created_at: string
  google_event_id: string | null
}

export interface ProjectField {
  id: string
  project_id: string
  name: string
  color: string
  sort_order: number
  due_date: string | null
  google_event_id: string | null
}

export type ProjectTaskStatus = 'todo' | 'doing' | 'done'

export interface ProjectTask {
  id: string
  field_id: string
  title: string
  detail: string | null
  status: ProjectTaskStatus
  sort_order: number
  created_at: string
  completed_at: string | null
  due_date: string | null
  google_event_id: string | null
}

export interface ProjectSubtask {
  id: string
  task_id: string
  title: string
  done: boolean
  sort_order: number
  created_at: string
  completed_at: string | null
}

export interface ProjectWorkLog {
  id: string
  task_id: string
  date: string
  minutes: number | null
  note: string | null
  created_at: string
  clock_in: string | null
  clock_out: string | null
}

export type ProjectDocSourceType = 'manual' | 'upload'

export interface ProjectDoc {
  id: string
  project_id: string
  title: string
  content: string
  source_type: ProjectDocSourceType
  original_filename: string | null
  updated_at: string
}

export interface TaskWithExtras extends ProjectTask {
  project_subtasks: ProjectSubtask[]
  project_work_logs: ProjectWorkLog[]
}

export interface FieldWithTasks extends ProjectField {
  project_tasks: TaskWithExtras[]
}

export interface ProjectWithFields extends Project {
  project_fields: FieldWithTasks[]
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

// ---------- calendar cache (source of truth ฝั่งแอป — ไม่เรียก Google สดตอน read แล้ว) ----------

export type CalendarCacheKind = 'event' | 'task'

export interface CalendarEventCache {
  id: string
  google_event_id: string
  title: string | null
  start_at: string | null
  end_at: string | null
  raw: Record<string, unknown> | null
  synced_at: string
  calendar_id: string | null
  calendar_name: string | null
  all_day: boolean
  is_birthday: boolean
  kind: CalendarCacheKind
  list_id: string | null
  description: string | null
}

export interface GoogleCalendarChannel {
  id: string
  calendar_id: string
  channel_id: string
  resource_id: string
  expiration: string
  created_at: string
}

// ---------- workout player ----------

export type WorkoutDayKind = 'heavy' | 'light' | 'rest'

export interface WorkoutDay {
  id: string
  day_of_week: number
  label: string
  kind: WorkoutDayKind
  rounds: number
  exercise_rest_seconds: number
  round_rest_seconds: number
}

export type WorkoutBlock = 'warmup' | 'main' | 'cooldown'
export type WorkoutCategory = 'strength' | 'cardio' | 'core' | 'stretch'

export interface WorkoutExercise {
  id: string
  day_id: string
  block: WorkoutBlock
  sort_order: number
  name: string
  category: WorkoutCategory | null
  instructions: string
  reps_label: string | null
  duration_seconds: number | null
  per_side: boolean
}

export interface WorkoutDayWithExercises extends WorkoutDay {
  workout_exercises: WorkoutExercise[]
}

// อ้างอิงท่า+รอบที่ทำ/ข้าม เก็บใน workout_sessions.exercises_done/exercises_skipped (jsonb array)
export interface WorkoutExerciseRef {
  exercise_id: string
  round: number
}

export interface WorkoutSession {
  id: string
  date: string
  day_id: string | null
  started_at: string
  completed_at: string | null
  exercises_done: WorkoutExerciseRef[]
  exercises_skipped: WorkoutExerciseRef[]
  active_minutes: number | null
}

export interface WorkoutSessionWithDay extends WorkoutSession {
  workout_days: { label: string; kind: WorkoutDayKind } | null
}
