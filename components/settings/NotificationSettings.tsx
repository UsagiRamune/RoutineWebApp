'use client'

// ส่วน "การแจ้งเตือน" ในหน้าตั้งค่า: อีเมลปลายทาง, quiet hours, และตั้งค่าต่อประเภทแจ้งเตือน
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AppSettings, NotificationSetting } from '@/lib/supabase/types'
import Toggle from '@/components/ui/Toggle'

interface Props {
  appSettings: AppSettings | null
  notificationSettings: NotificationSetting[]
}

export default function NotificationSettings({ appSettings, notificationSettings }: Props) {
  const supabase = createClient()
  const [quietHours, setQuietHours] = useState(appSettings?.quiet_hours_enabled ?? false)
  const [kinds, setKinds] = useState(notificationSettings)
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [testMsg, setTestMsg] = useState('')

  async function saveNotifyEmail(value: string) {
    await supabase.from('app_settings').update({ notify_email: value.trim() || null }).eq('id', 1)
  }

  async function toggleQuietHours() {
    const next = !quietHours
    setQuietHours(next)
    await supabase.from('app_settings').update({ quiet_hours_enabled: next }).eq('id', 1)
  }

  async function toggleKind(kind: string) {
    setKinds(prev => prev.map(k => k.kind === kind ? { ...k, enabled: !k.enabled } : k))
    const current = kinds.find(k => k.kind === kind)
    await supabase.from('notification_settings').update({ enabled: !current?.enabled }).eq('kind', kind)
  }

  async function updateField(kind: string, field: 'max_per_day' | 'min_gap_minutes' | 'lead_minutes', raw: string) {
    const v = raw.trim() === '' ? null : Math.max(0, parseInt(raw) || 0)
    setKinds(prev => prev.map(k => k.kind === kind ? { ...k, [field]: v } : k))
    await supabase.from('notification_settings').update({ [field]: v }).eq('kind', kind)
  }

  async function sendTest() {
    setTestState('sending')
    setTestMsg('')
    try {
      const res = await fetch('/api/notify/test', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'ส่งไม่สำเร็จ')
      setTestState('sent')
    } catch (err) {
      setTestState('error')
      setTestMsg(err instanceof Error ? err.message : 'ส่งไม่สำเร็จ')
    }
  }

  return (
    <div className="bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4 space-y-4">
      <div>
        <label className="text-xs text-[#7C8394] block mb-1">อีเมลรับแจ้งเตือน</label>
        <input type="email" defaultValue={appSettings?.notify_email ?? ''} placeholder="you@example.com"
          onBlur={e => saveNotifyEmail(e.target.value)}
          className="w-full bg-[#14171F] border border-[#2A2F3D] rounded-lg
            px-3 py-2 text-sm outline-none focus:border-[#7C8394]" />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm">Quiet hours</p>
          <p className="text-[10px] text-[#7C8394]">ปิดแจ้งเตือนตอนหลับ (ยกเว้นสรุปเช้า/สัปดาห์)</p>
        </div>
        <Toggle checked={quietHours} onChange={toggleQuietHours} />
      </div>

      <div className="space-y-2 pt-2 border-t border-[#2A2F3D]">
        {kinds.map(ns => (
          <div key={ns.kind} className="border border-[#2A2F3D] rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm">{ns.label}</span>
              <Toggle checked={ns.enabled} onChange={() => toggleKind(ns.kind)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-[#7C8394] block mb-0.5">ครั้ง/วัน</label>
                <input type="number" min="0" defaultValue={ns.max_per_day ?? ''}
                  onBlur={e => updateField(ns.kind, 'max_per_day', e.target.value)}
                  className="w-full bg-[#14171F] border border-[#2A2F3D] rounded px-2 py-1.5 text-xs outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-[#7C8394] block mb-0.5">ห่างขั้นต่ำ (นาที)</label>
                <input type="number" min="0" defaultValue={ns.min_gap_minutes ?? ''}
                  onBlur={e => updateField(ns.kind, 'min_gap_minutes', e.target.value)}
                  className="w-full bg-[#14171F] border border-[#2A2F3D] rounded px-2 py-1.5 text-xs outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-[#7C8394] block mb-0.5">ล่วงหน้า (นาที)</label>
                <input type="number" min="0" defaultValue={ns.lead_minutes ?? ''}
                  onBlur={e => updateField(ns.kind, 'lead_minutes', e.target.value)}
                  className="w-full bg-[#14171F] border border-[#2A2F3D] rounded px-2 py-1.5 text-xs outline-none" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button onClick={sendTest} disabled={testState === 'sending'}
        className="w-full py-2.5 rounded-lg bg-[#EDEAE0] text-[#14171F] text-sm font-semibold disabled:opacity-50">
        {testState === 'sending' ? 'กำลังส่ง...' : testState === 'sent' ? 'ส่งแล้ว ✓' : 'ส่งเมลทดสอบ'}
      </button>
      {testState === 'error' && <p className="text-xs text-[#E4574A]">{testMsg}</p>}
    </div>
  )
}
