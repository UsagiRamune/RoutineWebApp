'use client'

// จัดการท่าวอร์มอัพ/คูลดาวน์เดินเช้า — ตารางว่างตอนนี้ (ยังไม่มี seed จริง) เลยต้องมี UI เพิ่ม/แก้ในตัว
// ไม่ต้องรอ SQL seed รอบใหม่ทุกครั้งที่มีท่าจริงมาเติม รีใช้ pattern inline-edit จาก EditRoutinePanel.tsx
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MorningWalkBlock, MorningWalkExercise, WorkoutCategory } from '@/lib/supabase/types'
import { Plus, Trash2 } from 'lucide-react'

interface Props {
  block: MorningWalkBlock
  exercises: MorningWalkExercise[] // เฉพาะ block นี้ เรียง sort_order มาแล้ว
}

const CATEGORY_OPTIONS: { value: WorkoutCategory | ''; label: string }[] = [
  { value: '', label: 'ไม่ระบุ' },
  { value: 'strength', label: 'Strength' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'core', label: 'Core' },
  { value: 'stretch', label: 'Stretch' },
]

const inputCls = 'bg-[#171412] border border-[#332D28] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#8A8178]'

export default function ManageMorningWalkExercises({ block, exercises }: Props) {
  const supabase = createClient()
  const router = useRouter()

  async function addExercise() {
    await supabase.from('morning_walk_exercises').insert({
      block, name: '', instructions: '', sort_order: exercises.length + 1,
    })
    router.refresh()
  }

  async function updateField(id: string, field: keyof MorningWalkExercise, value: unknown) {
    await supabase.from('morning_walk_exercises').update({ [field]: value }).eq('id', id)
    router.refresh()
  }

  // reps_label กับ duration_seconds กันเอง — สลับโหมดแล้วเคลียร์อีกฝั่งทิ้ง (ท่าหนึ่งเป็นได้แค่แบบเดียว)
  async function setMode(ex: MorningWalkExercise, mode: 'timed' | 'reps') {
    if (mode === 'timed') {
      await supabase.from('morning_walk_exercises')
        .update({ duration_seconds: ex.duration_seconds ?? 30, reps_label: null }).eq('id', ex.id)
    } else {
      await supabase.from('morning_walk_exercises')
        .update({ reps_label: ex.reps_label ?? '3x10', duration_seconds: null }).eq('id', ex.id)
    }
    router.refresh()
  }

  async function removeExercise(id: string) {
    if (!confirm('ลบท่านี้เลย? ลบแล้วกู้คืนไม่ได้')) return
    await supabase.from('morning_walk_exercises').delete().eq('id', id)
    router.refresh()
  }

  return (
    <div className="space-y-2">
      {exercises.map(ex => {
        const isTimed = ex.duration_seconds != null
        return (
          <div key={ex.id} className="bg-[#171412] border border-[#332D28] rounded-lg p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <input defaultValue={ex.name} placeholder="ชื่อท่า..."
                onBlur={e => e.target.value !== ex.name && updateField(ex.id, 'name', e.target.value)}
                className={`flex-1 min-w-0 ${inputCls}`} />
              <select defaultValue={ex.category ?? ''}
                onChange={e => updateField(ex.id, 'category', e.target.value || null)}
                className={inputCls}>
                {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button onClick={() => removeExercise(ex.id)} className="text-[#8A8178] p-1 flex-shrink-0">
                <Trash2 size={13} />
              </button>
            </div>

            <textarea defaultValue={ex.instructions} rows={2} placeholder="คำแนะนำท่า..."
              onBlur={e => e.target.value !== ex.instructions &&
                updateField(ex.id, 'instructions', e.target.value)}
              className={`w-full resize-none ${inputCls}`} />

            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-[#332D28] overflow-hidden text-[10px] flex-shrink-0">
                <button onClick={() => setMode(ex, 'reps')}
                  className={`px-2 py-1.5 ${!isTimed ? 'bg-[#EDEAE0] text-[#171412] font-semibold' : 'text-[#8A8178]'}`}>
                  นับครั้ง
                </button>
                <button onClick={() => setMode(ex, 'timed')}
                  className={`px-2 py-1.5 ${isTimed ? 'bg-[#EDEAE0] text-[#171412] font-semibold' : 'text-[#8A8178]'}`}>
                  จับเวลา
                </button>
              </div>
              {isTimed ? (
                <input type="number" min="1" defaultValue={ex.duration_seconds ?? 30}
                  onBlur={e => updateField(ex.id, 'duration_seconds', Math.max(1, parseInt(e.target.value) || 30))}
                  className={`w-20 ${inputCls}`} placeholder="วินาที" />
              ) : (
                <input defaultValue={ex.reps_label ?? ''} placeholder="เช่น 3x10"
                  onBlur={e => updateField(ex.id, 'reps_label', e.target.value || '3x10')}
                  className={`w-24 ${inputCls}`} />
              )}
              <label className="flex items-center gap-1.5 text-xs text-[#8A8178] ml-auto">
                <input type="checkbox" defaultChecked={ex.per_side}
                  onChange={e => updateField(ex.id, 'per_side', e.target.checked)} />
                ทำทีละข้าง
              </label>
            </div>
          </div>
        )
      })}

      <button onClick={addExercise}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg
          border border-dashed border-[#332D28] text-xs text-[#8A8178]">
        <Plus size={13} /> เพิ่มท่า
      </button>
    </div>
  )
}
