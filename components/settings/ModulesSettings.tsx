'use client'

// สลับเปิด/ปิดโมดูล — RealtimeRefresher จะ refresh หน้าให้เองหลังเขียน DB
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Module } from '@/lib/supabase/types'
import Toggle from '@/components/ui/Toggle'
import { moduleLabel } from '@/lib/moduleLabels'

export default function ModulesSettings({ modules }: { modules: Module[] }) {
  const supabase = createClient()
  const [pending, setPending] = useState<Record<string, boolean>>({})

  async function toggle(m: Module) {
    setPending(p => ({ ...p, [m.key]: true }))
    await supabase.from('modules').update({ enabled: !m.enabled }).eq('key', m.key)
    setPending(p => ({ ...p, [m.key]: false }))
  }

  return (
    <div className="space-y-2">
      {modules.map(m => (
        <div key={m.key}
          className="flex items-center justify-between bg-[#1B1F2A]
            border border-[#2A2F3D] rounded-xl p-4">
          <span className="text-sm">{moduleLabel(m)}</span>
          <Toggle checked={m.enabled} onChange={() => toggle(m)} disabled={pending[m.key]} />
        </div>
      ))}
    </div>
  )
}
