'use client'

// หน้ารายการโปรเจกต์: การ์ดต่อโปรเจกต์ (active/paused โชว์เสมอ, done/archived ยุบไว้) + ฟอร์มเพิ่มโปรเจกต์
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ProjectWithFields } from '@/lib/supabase/types'
import { projectProgress, progressPct, STATUS_LABEL, STATUS_COLOR } from '@/lib/projects'
import Toggle from '@/components/ui/Toggle'
import { Plus, ChevronDown, ChevronUp } from 'lucide-react'

interface Props {
  projects: ProjectWithFields[]
  today: string
}

function daysUntil(targetDate: string, today: string): number {
  const target = new Date(`${targetDate}T00:00:00+07:00`)
  const now = new Date(`${today}T00:00:00+07:00`)
  return Math.round((target.getTime() - now.getTime()) / 86400000)
}

function ProjectCard({ project, today }: { project: ProjectWithFields; today: string }) {
  const progress = projectProgress(project.project_fields)
  const pct = progressPct(progress)
  const days = project.target_date ? daysUntil(project.target_date, today) : null

  return (
    <Link href={`/projects/${project.id}`}
      className="block bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 mb-3
        hover:border-[#7C8394] transition-colors">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="font-medium text-sm truncate">{project.name}</p>
        <span className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ background: `${STATUS_COLOR[project.status]}22`, color: STATUS_COLOR[project.status] }}>
          {STATUS_LABEL[project.status]}
        </span>
      </div>

      {progress.total > 0 ? (
        <>
          <div className="h-1.5 bg-[#14171F] rounded-full overflow-hidden mb-1">
            <div className="h-full rounded-full bg-[#4FC1E0]" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-[#7C8394]">{progress.done}/{progress.total} task ({pct}%)</p>
        </>
      ) : (
        <p className="text-xs text-[#7C8394]">ยังไม่มี task</p>
      )}

      {days !== null && (
        <p className={`text-xs mt-1 ${days < 0 ? 'text-[#E4574A]' : 'text-[#7C8394]'}`}>
          {days < 0 ? `เกินกำหนด ${-days} วัน` : days === 0 ? 'ครบกำหนดวันนี้' : `เหลือ ${days} วัน`}
        </p>
      )}
    </Link>
  )
}

export default function ProjectsList({ projects, today }: Props) {
  const supabase = createClient()
  const [showAdd, setShowAdd] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [form, setForm] = useState({ name: '', isSolo: true, targetDate: '' })

  const visible = projects
    .filter(p => p.status === 'active' || p.status === 'paused')
    .sort((a, b) => (a.status !== b.status ? (a.status === 'active' ? -1 : 1) : a.sort_order - b.sort_order))
  const archived = projects
    .filter(p => p.status === 'done' || p.status === 'archived')
    .sort((a, b) => a.sort_order - b.sort_order)

  async function addProject() {
    const name = form.name.trim()
    if (!name) return
    await supabase.from('projects').insert({
      name, is_solo: form.isSolo, target_date: form.targetDate || null,
    })
    setForm({ name: '', isSolo: true, targetDate: '' })
    setShowAdd(false)
  }

  return (
    <div>
      {visible.length === 0 && archived.length === 0 && (
        <p className="text-sm text-[#7C8394] mb-4">ยังไม่มีโปรเจกต์ เริ่มสร้างโปรเจกต์แรกได้เลย</p>
      )}

      {visible.map(p => <ProjectCard key={p.id} project={p} today={today} />)}

      {archived.length > 0 && (
        <div className="mb-3">
          <button onClick={() => setShowArchived(v => !v)}
            className="flex items-center gap-1 text-xs text-[#7C8394] mb-2">
            {showArchived ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showArchived ? 'ซ่อน' : 'แสดง'}เสร็จแล้ว/เก็บถาวร ({archived.length})
          </button>
          {showArchived && archived.map(p => <ProjectCard key={p.id} project={p} today={today} />)}
        </div>
      )}

      {showAdd ? (
        <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 space-y-3">
          <input value={form.name} placeholder="ชื่อโปรเจกต์..."
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg
              px-3 py-2 text-sm outline-none focus:border-[#7C8394]" />
          <div className="flex items-center justify-between">
            <label className="text-xs text-[#7C8394]">ทำเดี่ยว (solo)</label>
            <Toggle checked={form.isSolo} onChange={() => setForm(p => ({ ...p, isSolo: !p.isSolo }))} />
          </div>
          <div>
            <label className="text-xs text-[#7C8394] block mb-1">กำหนดเสร็จ (ไม่บังคับ)</label>
            <input type="date" value={form.targetDate}
              onChange={e => setForm(p => ({ ...p, targetDate: e.target.value }))}
              className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg
                px-3 py-2 text-sm outline-none focus:border-[#7C8394]" />
          </div>
          <div className="flex gap-2">
            <button onClick={addProject}
              className="flex-1 py-2 rounded-lg bg-[#EDEAE0] text-[#14171F] text-sm font-semibold">
              บันทึก
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-4 py-2 rounded-lg border border-[#2A2F3D] text-sm text-[#7C8394]">
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)}
          className="w-full flex items-center justify-center gap-1.5 border border-dashed
            border-[#2A2F3D] rounded-xl px-4 py-3 text-sm text-[#7C8394]">
          <Plus size={14} /> เพิ่มโปรเจกต์
        </button>
      )}
    </div>
  )
}
