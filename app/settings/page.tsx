import { createClient } from '@/lib/supabase/server'
import { Module } from '@/lib/supabase/types'
import AppNav from '@/components/AppNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import ModulesSettings from '@/components/settings/ModulesSettings'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: modules } = await supabase.from('modules').select('*').order('sort_order')

  return (
    <>
      <AppNav />
      <RealtimeRefresher />
      <main className="min-h-screen bg-[#14171F] text-[#EDEAE0] pb-16">
        <div className="max-w-lg mx-auto px-4 pt-8">
          <h1 className="text-xl font-semibold mb-1">ตั้งค่า</h1>
          <p className="text-sm text-[#7C8394] mb-6">เปิด/ปิดโมดูลที่อยากใช้</p>
          <ModulesSettings modules={(modules ?? []) as Module[]} />
        </div>
      </main>
    </>
  )
}
