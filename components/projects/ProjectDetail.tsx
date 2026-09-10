'use client'

// หน้ารายละเอียดโปรเจกต์: แก้ header, progress, field/task (+subtask/work log/กำหนดส่ง), GDD, และสรุป routine ที่ผูกไว้
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import {
  DndContext, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { createClient } from '@/lib/supabase/client'
import {
  ProjectWithFields, ProjectDoc, ProjectStatus, ProjectTaskStatus,
} from '@/lib/supabase/types'
import {
  projectProgress, progressPct, FIELD_COLORS, STATUS_LABEL,
  daysUntil, daysUntilLabel, fmtDuration, taskWorkMinutes, fieldWorkMinutes, projectWorkMinutes,
} from '@/lib/projects'
import TaskWorkLog from '@/components/projects/TaskWorkLog'
import SortableField from '@/components/projects/SortableField'
import {
  ArrowLeft, Plus, X, Trash2, ChevronDown, ChevronUp, Upload, ListChecks, Loader2, GripVertical,
} from 'lucide-react'

interface LinkedRoutine {
  id: string
  name: string
  time_entries: { date: string; clock_in: string; clock_out: string | null }[]
}

interface Props {
  project: ProjectWithFields
  docs: ProjectDoc[]
  linkedRoutines: LinkedRoutine[]
  weekStart: string
  today: string
  hasGoogleCalendar: boolean
}

const STATUS_OPTIONS: ProjectStatus[] = ['active', 'paused', 'done', 'archived']

const NO_CALENDAR_HINT = 'ยังไม่ได้เชื่อม Google Calendar — ตั้งกำหนดส่งได้ แต่ไม่ขึ้นปฏิทิน'

function routineWeekHours(routine: LinkedRoutine, weekStart: string): number {
  let mins = 0
  for (const e of routine.time_entries) {
    if (e.date < weekStart || !e.clock_out) continue
    mins += Math.max(0, Math.floor((new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 60000))
  }
  return mins / 60
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'เมื่อสักครู่'
  if (mins < 60) return `${mins} นาทีที่แล้ว`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ชม.ที่แล้ว`
  return `${Math.floor(hours / 24)} วันที่แล้ว`
}

function DueRemaining({ dueDate, today }: { dueDate: string; today: string }) {
  const days = daysUntil(dueDate, today)
  return (
    <span className={`text-[10px] ${days < 0 ? 'text-[#E4574A]' : 'text-[#7C8394]'}`}>
      {daysUntilLabel(days)}
    </span>
  )
}

async function saveDueDate(kind: 'project' | 'field' | 'task', id: string, due_date: string | null) {
  await fetch('/api/projects/deadline', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, id, due_date }),
  })
}

async function cleanupDeadline(kind: 'project' | 'field' | 'task', id: string) {
  await fetch('/api/projects/deadline', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, id }),
  })
}

export default function ProjectDetail({ project, docs, linkedRoutines, weekStart, today, hasGoogleCalendar }: Props) {
  const supabase = createClient()
  const router = useRouter()

  // ---------- header ----------

  async function updateProject(patch: Record<string, unknown>) {
    await supabase.from('projects').update(patch).eq('id', project.id)
  }

  async function deleteProject() {
    if (!confirm(`ลบโปรเจกต์ "${project.name}" ถาวร? (field/task/เอกสารทั้งหมดจะหายไปด้วย)`)) return
    await cleanupDeadline('project', project.id)
    await supabase.from('projects').delete().eq('id', project.id)
    router.push('/projects')
  }

  // ---------- fields ----------

  const [newFieldName, setNewFieldName] = useState('')
  const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({})

  async function addField() {
    const name = newFieldName.trim()
    if (!name) return
    await supabase.from('project_fields').insert({
      project_id: project.id, name, sort_order: project.project_fields.length + 1,
    })
    setNewFieldName('')
  }

  async function renameField(fieldId: string, name: string) {
    if (name.trim()) await supabase.from('project_fields').update({ name: name.trim() }).eq('id', fieldId)
  }

  async function setFieldColor(fieldId: string, color: string) {
    await supabase.from('project_fields').update({ color }).eq('id', fieldId)
  }

  async function deleteField(fieldId: string, name: string) {
    if (!confirm(`ลบ field "${name}" ถาวร? (task ทั้งหมดในนี้จะหายไปด้วย)`)) return
    await cleanupDeadline('field', fieldId)
    await supabase.from('project_fields').delete().eq('id', fieldId)
  }

  function toggleCollapse(fieldId: string) {
    setCollapsedFields(p => ({ ...p, [fieldId]: !p[fieldId] }))
  }

  // ---------- ลาก field จัดลำดับ (dnd-kit) ----------

  // ลำดับที่โชว์จริงบนจอ — แยกจาก project.project_fields (ที่มาจาก server/sort_order) เพื่อให้ลากแล้ว
  // เห็นผลทันที ไม่ต้องรอ round-trip DB ก่อน sync กลับเมื่อ "ชุด" field เปลี่ยน (เพิ่ม/ลบ) เท่านั้น —
  // ไม่ sync ทับตอนแค่ลำดับต่างกัน ไม่งั้นจะแย่งกับ optimistic reorder ของผู้ใช้เอง
  const [orderedFieldIds, setOrderedFieldIds] = useState<string[]>(
    () => project.project_fields.map(f => f.id))

  useEffect(() => {
    const serverIds = project.project_fields.map(f => f.id)
    setOrderedFieldIds(prev => {
      const prevSet = new Set(prev)
      const sameSet = prev.length === serverIds.length && serverIds.every(id => prevSet.has(id))
      return sameSet ? prev : serverIds
    })
  }, [project.project_fields])

  const fieldsById = new Map(project.project_fields.map(f => [f.id, f]))

  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  async function handleFieldDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedFieldIds.indexOf(String(active.id))
    const newIndex = orderedFieldIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = arrayMove(orderedFieldIds, oldIndex, newIndex)
    setOrderedFieldIds(newOrder) // จอเปลี่ยนทันที เขียน DB เบื้องหลัง

    // อัปเดตเฉพาะแถวที่ rank เปลี่ยนจริงเทียบกับ sort_order เดิมจาก server ไม่ใช่ทุกแถว
    const updates = newOrder
      .map((id, idx) => ({ id, sort_order: idx + 1 }))
      .filter(u => fieldsById.get(u.id)?.sort_order !== u.sort_order)
    await Promise.all(updates.map(u =>
      supabase.from('project_fields').update({ sort_order: u.sort_order }).eq('id', u.id)
    ))
  }

  // ---------- tasks ----------

  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, ProjectTaskStatus>>({})
  const [openDetail, setOpenDetail] = useState<Record<string, boolean>>({})
  const [newTaskTitle, setNewTaskTitle] = useState<Record<string, string>>({})
  const [openSubtasks, setOpenSubtasks] = useState<Record<string, boolean>>({})
  const [newSubtaskTitle, setNewSubtaskTitle] = useState<Record<string, string>>({})
  const [optimisticSubtaskDone, setOptimisticSubtaskDone] = useState<Record<string, boolean>>({})

  function statusOf(taskId: string, serverStatus: ProjectTaskStatus): ProjectTaskStatus {
    return optimisticStatus[taskId] ?? serverStatus
  }

  async function cycleStatus(taskId: string, current: ProjectTaskStatus) {
    const next: ProjectTaskStatus = current === 'todo' ? 'doing' : current === 'doing' ? 'done' : 'todo'
    setOptimisticStatus(p => ({ ...p, [taskId]: next })) // จอเปลี่ยนทันที เขียน DB เบื้องหลัง
    await supabase.from('project_tasks').update({
      status: next, completed_at: next === 'done' ? new Date().toISOString() : null,
    }).eq('id', taskId)
  }

  async function updateTask(taskId: string, field: 'title' | 'detail', value: string) {
    await supabase.from('project_tasks').update({ [field]: value || null }).eq('id', taskId)
  }

  async function addTask(fieldId: string, currentCount: number) {
    const title = (newTaskTitle[fieldId] ?? '').trim()
    if (!title) return
    await supabase.from('project_tasks').insert({ field_id: fieldId, title, sort_order: currentCount + 1 })
    setNewTaskTitle(p => ({ ...p, [fieldId]: '' }))
  }

  async function deleteTask(taskId: string) {
    await cleanupDeadline('task', taskId)
    await supabase.from('project_tasks').delete().eq('id', taskId)
  }

  function subtaskDoneOf(subtaskId: string, serverDone: boolean): boolean {
    return optimisticSubtaskDone[subtaskId] ?? serverDone
  }

  async function toggleSubtask(subtaskId: string, current: boolean) {
    setOptimisticSubtaskDone(p => ({ ...p, [subtaskId]: !current }))
    await supabase.from('project_subtasks').update({
      done: !current, completed_at: !current ? new Date().toISOString() : null,
    }).eq('id', subtaskId)
  }

  async function addSubtask(taskId: string, currentCount: number) {
    const title = (newSubtaskTitle[taskId] ?? '').trim()
    if (!title) return
    await supabase.from('project_subtasks').insert({ task_id: taskId, title, sort_order: currentCount + 1 })
    setNewSubtaskTitle(p => ({ ...p, [taskId]: '' }))
  }

  async function deleteSubtask(subtaskId: string) {
    await supabase.from('project_subtasks').delete().eq('id', subtaskId)
  }

  // ---------- GDD ----------

  const [gddOpen, setGddOpen] = useState(false)
  const [openDocs, setOpenDocs] = useState<Record<string, boolean>>({})
  const [uploading, setUploading] = useState(false)
  const [uploadElapsed, setUploadElapsed] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // นับวินาทีที่ผ่านไประหว่างอัปโหลด — ใช้แค่หมุน label ข้อความสถานะ (ไม่ใช่ progress จริงจากฝั่ง server
  // เพราะ route เดียวทำทั้งอ่านไฟล์+เรียก Gemini ในคำขอเดียว ไม่มี progress event ให้ subscribe) กันจอดูเหมือนค้าง
  useEffect(() => {
    if (!uploading) { setUploadElapsed(0); return }
    const t = setInterval(() => setUploadElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [uploading])

  function uploadStatusText(): string {
    if (uploadElapsed < 3) return 'กำลังอัปโหลดไฟล์...'
    if (uploadElapsed < 8) return 'กำลังแกะข้อความจากไฟล์...'
    return 'กำลังให้ AI จัดรูปแบบ (ไฟล์ยาวอาจใช้เวลาถึง 30 วิ)...'
  }

  async function addBlankDoc() {
    const now = new Date().toISOString()
    const { data } = await supabase.from('project_docs').insert({
      project_id: project.id, title: 'เอกสารใหม่', content: '', source_type: 'manual', updated_at: now,
    }).select().single()
    if (data) setOpenDocs(p => ({ ...p, [data.id]: true }))
  }

  async function deleteDoc(docId: string, title: string) {
    if (!confirm(`ลบเอกสาร "${title}" ถาวร?`)) return
    await supabase.from('project_docs').delete().eq('id', docId)
  }

  async function handleFileChosen(file: File) {
    const name = file.name.toLowerCase()
    if (!name.endsWith('.pdf') && !name.endsWith('.docx')) {
      alert('รองรับเฉพาะไฟล์ .pdf หรือ .docx เท่านั้น')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      alert('ไฟล์ใหญ่เกิน 20MB ลองบีบอัดหรือแบ่งเป็นหลายไฟล์')
      return
    }
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    form.append('project_id', project.id)
    try {
      const res = await fetch('/api/projects/docs/import', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error ?? 'อัปโหลดไม่สำเร็จ')
      } else if (data.doc) {
        setOpenDocs(p => ({ ...p, [data.doc.id]: true }))
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ---------- render ----------

  const overall = projectProgress(project.project_fields)
  const overallPct = progressPct(overall)
  const totalWorkMinutes = projectWorkMinutes(project.project_fields)

  return (
    <main className="min-h-screen bg-[#14171F] text-[#EDEAE0] pb-16">
      <div className="max-w-3xl mx-auto px-4 pt-8">

        <Link href="/projects" className="flex items-center gap-1.5 text-sm text-[#7C8394] mb-4">
          <ArrowLeft size={16} /> โปรเจกต์
        </Link>

        {/* header */}
        <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4 space-y-3">
          <input defaultValue={project.name}
            onBlur={e => {
              const v = e.target.value.trim()
              if (v && v !== project.name) updateProject({ name: v })
            }}
            className="w-full text-lg font-semibold bg-transparent outline-none
              border-b border-transparent focus:border-[#2A2F3D] pb-1" />

          <div className="flex items-center gap-3 flex-wrap">
            <select defaultValue={project.status}
              onChange={e => updateProject({ status: e.target.value })}
              className="bg-[#14171F] border border-[#2A2F3D] rounded-lg px-2 py-1.5 text-xs outline-none">
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[#7C8394]">กำหนดเสร็จ</label>
              <input type="date" defaultValue={project.target_date ?? ''}
                onBlur={e => saveDueDate('project', project.id, e.target.value || null)}
                className="bg-[#14171F] border border-[#2A2F3D] rounded-lg px-2 py-1.5 text-xs outline-none" />
              {project.target_date && <DueRemaining dueDate={project.target_date} today={today} />}
            </div>
            <button onClick={deleteProject}
              className="flex items-center gap-1 text-xs text-[#E4574A] ml-auto">
              <Trash2 size={12} /> ลบโปรเจกต์
            </button>
          </div>
          {!hasGoogleCalendar && <p className="text-[10px] text-[#7C8394]">{NO_CALENDAR_HINT}</p>}

          <textarea defaultValue={project.description ?? ''} placeholder="รายละเอียดโปรเจกต์..." rows={2}
            onBlur={e => updateProject({ description: e.target.value || null })}
            className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg
              px-3 py-2 text-sm outline-none focus:border-[#7C8394] resize-none" />
        </div>

        {/* progress */}
        <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between text-xs text-[#7C8394] mb-1.5">
            <span>ความคืบหน้ารวม</span>
            <span>{overall.total > 0 ? `${overall.done}/${overall.total} (${overallPct}%)` : 'ยังไม่มี task'}</span>
          </div>
          <div className="h-2 bg-[#14171F] rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-[#4FC1E0] transition-all" style={{ width: `${overallPct}%` }} />
          </div>
          {totalWorkMinutes > 0 && (
            <p className="text-[10px] text-[#7C8394] mt-1.5">
              เวลาทำงานที่บันทึกรวม: {fmtDuration(totalWorkMinutes)}
            </p>
          )}

          {project.project_fields.length > 1 && (
            <div className="space-y-1.5 mt-3 pt-3 border-t border-[#2A2F3D]">
              {project.project_fields.map(f => {
                const fp = progressPct(projectProgress([f]))
                const fMins = fieldWorkMinutes(f)
                return (
                  <div key={f.id} className="flex items-center gap-2">
                    <span className="text-xs text-[#7C8394] w-20 truncate flex-shrink-0">{f.name}</span>
                    <div className="flex-1 h-1.5 bg-[#14171F] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${fp}%`, background: f.color }} />
                    </div>
                    <span className="text-[10px] text-[#7C8394] w-8 text-right flex-shrink-0">{fp}%</span>
                    {fMins > 0 && (
                      <span className="text-[10px] text-[#7C8394] flex-shrink-0">{fmtDuration(fMins)}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* fields + tasks */}
        <div className="space-y-3 mb-4">
          <DndContext sensors={dndSensors} onDragEnd={handleFieldDragEnd}>
            <SortableContext items={orderedFieldIds} strategy={verticalListSortingStrategy}>
              {orderedFieldIds.map(fieldId => {
                const field = fieldsById.get(fieldId)
                if (!field) return null
                const collapsed = !!collapsedFields[field.id]
                return (
                  <SortableField key={field.id} id={field.id}>
                    {({ attributes, listeners, setActivatorNodeRef, isDragging }) => (
                      <div className={`bg-[#1B1F2A] border rounded-xl p-4 transition-shadow
                        ${isDragging ? 'border-[#7C8394] shadow-xl' : 'border-[#2A2F3D]'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <button ref={setActivatorNodeRef} {...attributes} {...listeners}
                            className="w-10 h-10 -m-2.5 flex items-center justify-center flex-shrink-0
                              text-[#7C8394] cursor-grab active:cursor-grabbing touch-none"
                            aria-label="ลากจัดลำดับ field">
                            <GripVertical size={16} />
                          </button>
                          <button onClick={() => toggleCollapse(field.id)} className="text-[#7C8394] p-1 flex-shrink-0">
                            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                          </button>
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: field.color }} />
                          <input defaultValue={field.name}
                            onBlur={e => renameField(field.id, e.target.value)}
                            className="flex-1 min-w-0 bg-transparent text-sm font-medium outline-none
                              border-b border-transparent focus:border-[#2A2F3D]" />
                          <button onClick={() => deleteField(field.id, field.name)}
                            className="text-[#7C8394] p-1 w-7 flex justify-center flex-shrink-0">
                            <Trash2 size={13} />
                          </button>
                        </div>

                        {!collapsed && (
                          <>
                            <div className="flex items-center gap-3 mb-3 ml-7 flex-wrap">
                              <div className="flex gap-1.5">
                                {FIELD_COLORS.map(c => (
                                  <button key={c} onClick={() => setFieldColor(field.id, c)}
                                    className="w-5 h-5 rounded-full flex-shrink-0"
                                    style={{
                                      background: c,
                                      boxShadow: field.color === c ? '0 0 0 2px #14171F, 0 0 0 3.5px #EDEAE0' : 'none',
                                    }} />
                                ))}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <label className="text-[10px] text-[#7C8394]">กำหนดส่ง</label>
                                <input type="date" defaultValue={field.due_date ?? ''}
                                  onBlur={e => saveDueDate('field', field.id, e.target.value || null)}
                                  className="bg-[#14171F] border border-[#2A2F3D] rounded-lg px-2 py-1 text-[11px] outline-none" />
                                {field.due_date && <DueRemaining dueDate={field.due_date} today={today} />}
                              </div>
                            </div>

                            {field.project_tasks.map(task => {
                              const status = statusOf(task.id, task.status)
                              const detailOpen = (task.detail != null && task.detail !== '') || openDetail[task.id]
                              const subtasksOpen = !!openSubtasks[task.id]
                              const subtaskDone = task.project_subtasks.filter(s => subtaskDoneOf(s.id, s.done)).length
                              const subtaskTotal = task.project_subtasks.length
                              const workMins = taskWorkMinutes(task)
                              return (
                                <div key={task.id} className="ml-1 mb-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <button onClick={() => cycleStatus(task.id, status)}
                                      className={`w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center
                                        text-[10px] font-bold transition-colors
                                        ${status === 'done' ? 'bg-[#4FC1E0] text-[#14171F]'
                                          : status === 'doing' ? 'bg-[#F0A345] text-[#14171F]'
                                          : 'border-2 border-[#7C8394]'}`}>
                                      {status === 'done' ? '✓' : status === 'doing' ? '●' : ''}
                                    </button>
                                    <input defaultValue={task.title}
                                      onBlur={e => e.target.value.trim() && e.target.value !== task.title &&
                                        updateTask(task.id, 'title', e.target.value.trim())}
                                      className={`flex-1 min-w-0 bg-transparent text-sm outline-none
                                        border-b border-transparent focus:border-[#2A2F3D]
                                        ${status === 'done' ? 'text-[#7C8394] line-through' : ''}`} />
                                    <button onClick={() => setOpenDetail(p => ({ ...p, [task.id]: !p[task.id] }))}
                                      className="text-[10px] text-[#7C8394] p-1 flex-shrink-0">
                                      {detailOpen ? 'ซ่อน' : '+ รายละเอียด'}
                                    </button>
                                    <button onClick={() => deleteTask(task.id)}
                                      className="text-[#7C8394] p-1 w-7 flex justify-center flex-shrink-0">
                                      <X size={13} />
                                    </button>
                                  </div>

                                  {/* แถวเมตา: กำหนดส่ง + เวลารวม + sub-task + จับเวลา — โชว์ตลอด ไม่ซ่อนใน toggle
                                      (เดิม due_date อยู่ในนี้ ทำให้มองไม่เห็นถ้ายังไม่เคยตั้ง — ย้ายออกมาให้เห็นเสมอ) */}
                                  <div className="flex items-center gap-2 flex-wrap mt-1 ml-7">
                                    <label className="text-[10px] text-[#7C8394]">กำหนดส่ง</label>
                                    <input type="date" defaultValue={task.due_date ?? ''}
                                      onBlur={e => saveDueDate('task', task.id, e.target.value || null)}
                                      className="bg-[#14171F] border border-[#2A2F3D] rounded-lg
                                        px-2 py-1 text-[11px] outline-none" />
                                    {task.due_date && <DueRemaining dueDate={task.due_date} today={today} />}
                                    {workMins > 0 && (
                                      <span className="text-[10px] text-[#7C8394] flex-shrink-0">{fmtDuration(workMins)}</span>
                                    )}
                                    <button onClick={() => setOpenSubtasks(p => ({ ...p, [task.id]: !p[task.id] }))}
                                      className="flex items-center text-[10px] text-[#7C8394] px-1.5 py-0.5 rounded-full
                                        border border-[#2A2F3D] flex-shrink-0">
                                      {subtaskTotal > 0 ? `${subtaskDone}/${subtaskTotal}` : <ListChecks size={11} />}
                                    </button>
                                    <TaskWorkLog taskId={task.id} workLogs={task.project_work_logs} />
                                  </div>
                                  {task.due_date && !hasGoogleCalendar && (
                                    <p className="text-[10px] text-[#7C8394] mt-0.5 ml-7">{NO_CALENDAR_HINT}</p>
                                  )}

                                  {detailOpen && (
                                    <div className="mt-1 ml-7">
                                      <textarea defaultValue={task.detail ?? ''} placeholder="รายละเอียด..." rows={2}
                                        onBlur={e => updateTask(task.id, 'detail', e.target.value)}
                                        className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg
                                          px-2 py-1.5 text-xs outline-none resize-none" />
                                    </div>
                                  )}

                                  {/* subtasks */}
                                  {subtasksOpen && (
                                    <div className="mt-1 ml-7 space-y-1">
                                      {task.project_subtasks
                                        .slice().sort((a, b) => a.sort_order - b.sort_order)
                                        .map(sub => {
                                          const done = subtaskDoneOf(sub.id, sub.done)
                                          return (
                                            <div key={sub.id} className="flex items-center gap-2">
                                              <button onClick={() => toggleSubtask(sub.id, done)}
                                                className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center
                                                  text-[9px] font-bold
                                                  ${done ? 'bg-[#4FC1E0] text-[#14171F]' : 'border-2 border-[#7C8394]'}`}>
                                                {done ? '✓' : ''}
                                              </button>
                                              <span className={`flex-1 min-w-0 text-xs truncate
                                                ${done ? 'text-[#7C8394] line-through' : ''}`}>
                                                {sub.title}
                                              </span>
                                              <button onClick={() => deleteSubtask(sub.id)}
                                                className="text-[#7C8394] p-0.5 flex-shrink-0">
                                                <X size={11} />
                                              </button>
                                            </div>
                                          )
                                        })}
                                      <input value={newSubtaskTitle[task.id] ?? ''} placeholder="+ เพิ่ม sub-task"
                                        onChange={e => setNewSubtaskTitle(p => ({ ...p, [task.id]: e.target.value }))}
                                        onKeyDown={e => e.key === 'Enter' && addSubtask(task.id, task.project_subtasks.length)}
                                        className="w-full bg-transparent border border-dashed border-[#2A2F3D]
                                          rounded-lg px-2 py-1 text-xs outline-none focus:border-[#7C8394]" />
                                    </div>
                                  )}
                                </div>
                              )
                            })}

                            <div className="flex gap-2 mt-2 ml-1">
                              <input value={newTaskTitle[field.id] ?? ''} placeholder="+ เพิ่ม task..."
                                onChange={e => setNewTaskTitle(p => ({ ...p, [field.id]: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && addTask(field.id, field.project_tasks.length)}
                                className="flex-1 bg-[#14171F] border border-dashed border-[#2A2F3D] rounded-lg
                                  px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]" />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </SortableField>
                )
              })}
            </SortableContext>
          </DndContext>

          <div className="flex gap-2">
            <input value={newFieldName} placeholder="+ เพิ่ม field..."
              onChange={e => setNewFieldName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addField()}
              className="flex-1 bg-transparent border border-dashed border-[#2A2F3D]
                rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7C8394]" />
          </div>
        </div>

        {/* GDD */}
        <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-4">
          <button onClick={() => setGddOpen(v => !v)}
            className="w-full flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-1.5">
              {gddOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />} GDD / เอกสาร
              {docs.length > 0 && <span className="text-[10px] text-[#7C8394]">({docs.length})</span>}
            </span>
          </button>

          {gddOpen && (
            <div className="mt-3 space-y-3">
              {docs.map(doc => {
                const open = !!openDocs[doc.id]
                return (
                  <div key={doc.id} className="border border-[#2A2F3D] rounded-lg p-3">
                    <button onClick={() => setOpenDocs(p => ({ ...p, [doc.id]: !p[doc.id] }))}
                      className="w-full flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0 flex-1">
                        {open ? <ChevronUp size={12} className="flex-shrink-0" />
                          : <ChevronDown size={12} className="flex-shrink-0" />}
                        <span className="text-sm truncate">{doc.title}</span>
                        {doc.source_type === 'upload' && doc.original_filename && (
                          <span className="text-[10px] text-[#7C8394] flex-shrink-0 truncate max-w-[8rem]">
                            📄 {doc.original_filename}
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-[#7C8394] flex-shrink-0">{relativeTime(doc.updated_at)}</span>
                    </button>

                    {open && (
                      <div className="mt-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <input defaultValue={doc.title}
                            onBlur={e => {
                              const v = e.target.value.trim()
                              if (v && v !== doc.title) {
                                supabase.from('project_docs')
                                  .update({ title: v, updated_at: new Date().toISOString() }).eq('id', doc.id)
                              }
                            }}
                            className="flex-1 min-w-0 bg-transparent text-sm font-medium outline-none
                              border-b border-transparent focus:border-[#2A2F3D]" />
                          <button onClick={() => deleteDoc(doc.id, doc.title)}
                            className="text-[#7C8394] p-1 flex-shrink-0">
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <textarea defaultValue={doc.content} rows={10}
                          placeholder="เขียนเอกสารที่นี่ (รองรับ markdown)..."
                          onBlur={e => supabase.from('project_docs')
                            .update({ content: e.target.value, updated_at: new Date().toISOString() }).eq('id', doc.id)}
                          className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg
                            px-3 py-2 text-sm outline-none focus:border-[#7C8394] resize-none font-mono" />
                        <div className="text-sm leading-relaxed pt-3 border-t border-[#2A2F3D]
                          [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1
                          [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-0.5
                          [&_p]:mb-2 [&_strong]:font-semibold">
                          <ReactMarkdown>{doc.content || '*ยังไม่มีเนื้อหา*'}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="flex gap-2">
                <button onClick={addBlankDoc} disabled={uploading}
                  className="flex-1 flex items-center justify-center gap-1.5 border border-dashed
                    border-[#2A2F3D] rounded-lg px-3 py-2 text-xs text-[#7C8394] disabled:opacity-50">
                  <Plus size={13} /> เอกสารใหม่
                </button>
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="flex-1 flex items-center justify-center gap-1.5 border border-dashed
                    border-[#2A2F3D] rounded-lg px-3 py-2 text-xs text-[#7C8394] disabled:opacity-50">
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {uploading ? 'กำลังประมวลผล...' : 'อัปโหลดไฟล์'}
                </button>
                <input ref={fileInputRef} type="file" accept=".pdf,.docx" className="hidden"
                  onChange={e => e.target.files?.[0] && handleFileChosen(e.target.files[0])} />
              </div>
              {uploading && (
                <p className="text-[10px] text-[#7C8394] flex items-center gap-1">
                  <Loader2 size={10} className="animate-spin flex-shrink-0" />
                  {uploadStatusText()} ({uploadElapsed} วิ)
                </p>
              )}
            </div>
          )}
        </div>

        {/* linked routine */}
        <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4">
          <p className="text-xs text-[#7C8394] mb-2">การ track เวลา</p>
          {linkedRoutines.length > 0 ? (
            <div className="space-y-1">
              {linkedRoutines.map(r => (
                <p key={r.id} className="text-sm">
                  เวลาที่ track จาก Routine: <span className="font-medium">{r.name}</span>
                  {' — '}{routineWeekHours(r, weekStart).toFixed(1)} ชม. (สัปดาห์นี้)
                </p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#7C8394]">
              ผูก routine งานหลักเข้าโปรเจกต์นี้ได้ที่หน้า Routine (แก้ routine → เลือกโปรเจกต์)
            </p>
          )}
        </div>

      </div>
    </main>
  )
}
