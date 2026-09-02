'use client'

// แผงแก้ไข routine: เปลี่ยนชื่อ, ตั้งเป้า, จัดการ checklist items, ลบ
import { createClient } from '@/lib/supabase/client'
import { RoutineWithDetails, CategoryKind } from '@/lib/supabase/types'
import { Plus, X, Trash2 } from 'lucide-react'

interface Props {
  routine: RoutineWithDetails
  kind: CategoryKind
  today: string
  onClose: () => void
}

export default function EditRoutinePanel({ routine, kind, today, onClose }: Props) {
  const supabase = createClient()

  async function rename(name: string) {
    if (name.trim() && name !== routine.name)
      await supabase.from('routines').update({ name: name.trim() }).eq('id', routine.id)
  }

  async function setDefaultTarget(minutes: string) {
    const v = minutes === '' ? null : Math.max(0, parseInt(minutes) || 0)
    await supabase.from('routines')
      .update({ default_target_minutes: v }).eq('id', routine.id)
  }

  async function setTodayOverride(minutes: string) {
    if (minutes === '') {
      // ลบ override → กลับไปใช้เป้าประจำ
      await supabase.from('daily_targets')
        .delete().eq('routine_id', routine.id).eq('date', today)
    } else {
      const v = Math.max(0, parseInt(minutes) || 0)
      // upsert: มีแถวของวันนี้แล้วแก้ ไม่มีก็สร้าง (ใช้ unique(routine_id,date) ที่วางไว้)
      await supabase.from('daily_targets')
        .upsert({ routine_id: routine.id, date: today, target_minutes: v },
                { onConflict: 'routine_id,date' })
    }
  }

  async function addItem() {
    await supabase.from('routine_items').insert({
      routine_id: routine.id,
      name: '',
      sort_order: routine.routine_items.length + 1,
    })
  }

  async function editItem(id: string, field: 'name' | 'detail', value: string) {
    await supabase.from('routine_items').update({ [field]: value }).eq('id', id)
  }

  async function removeItem(id: string) {
    await supabase.from('routine_items').update({ is_active: false }).eq('id', id)
  }

  async function removeRoutine() {
    if (!confirm(`ลบ "${routine.name}" ? (ข้อมูลย้อนหลังยังอยู่ใน history)`)) return
    await supabase.from('routines').update({ is_active: false }).eq('id', routine.id)
    onClose()
  }

  const todayOverride = routine.daily_targets.find(t => t.date === today)

  return (
    <div className="mt-3 border-t border-[#2A2F3D] pt-3 space-y-3">

      <div>
        <label className="text-xs text-[#7C8394] block mb-1">ชื่อ routine</label>
        <input defaultValue={routine.name}
          onBlur={(e) => rename(e.target.value)}
          className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg
            px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]" />
      </div>

      {kind === 'timed' && (
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-[#7C8394] block mb-1">
              เป้าประจำ (นาที/วัน)
            </label>
            <input type="number" min="0"
              defaultValue={routine.default_target_minutes ?? ''}
              placeholder="ไม่ตั้ง"
              onBlur={(e) => setDefaultTarget(e.target.value)}
              className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg
                px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]" />
          </div>
          <div className="flex-1">
            <label className="text-xs text-[#7C8394] block mb-1">
              เฉพาะวันนี้ (override)
            </label>
            <input type="number" min="0"
              defaultValue={todayOverride?.target_minutes ?? ''}
              placeholder="ใช้เป้าประจำ"
              onBlur={(e) => setTodayOverride(e.target.value)}
              className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg
                px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]" />
          </div>
        </div>
      )}

      {kind === 'checklist' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-[#7C8394]">รายการย่อย</label>
            <button onClick={addItem}
              className="flex items-center gap-1 text-xs text-[#7C8394]">
              <Plus size={12} /> เพิ่ม
            </button>
          </div>
          {routine.routine_items.filter(i => i.is_active).map((item) => (
            <div key={item.id} className="flex items-center gap-2 mb-1.5">
              <input defaultValue={item.name} placeholder="ชื่อท่า/รายการ..."
                onBlur={(e) => e.target.value !== item.name &&
                  editItem(item.id, 'name', e.target.value)}
                className="flex-1 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                  px-3 py-1.5 text-sm outline-none focus:border-[#7C8394]" />
              <input defaultValue={item.detail ?? ''} placeholder="เช่น 3x15"
                onBlur={(e) => e.target.value !== (item.detail ?? '') &&
                  editItem(item.id, 'detail', e.target.value)}
                className="w-24 bg-[#14171F] border border-[#2A2F3D] rounded-lg
                  px-3 py-1.5 text-xs outline-none focus:border-[#7C8394]" />
              <button onClick={() => removeItem(item.id)}
                className="text-[#7C8394] p-1"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between pt-1">
        <button onClick={removeRoutine}
          className="flex items-center gap-1.5 text-xs text-[#E4574A]">
          <Trash2 size={13} /> ลบ routine นี้
        </button>
        <button onClick={onClose} className="text-xs text-[#7C8394]">ปิด</button>
      </div>
    </div>
  )
}