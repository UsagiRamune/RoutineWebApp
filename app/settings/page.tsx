import { createClient } from '@/lib/supabase/server'
import { Module, AppSettings, NotificationSetting } from '@/lib/supabase/types'
import AppNav from '@/components/AppNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import ModulesSettings from '@/components/settings/ModulesSettings'
import NotificationSettings from '@/components/settings/NotificationSettings'

export default async function SettingsPage() {
  const supabase = await createClient()
  const [{ data: modules }, { data: appSettings }, { data: notificationSettings }] = await Promise.all([
    supabase.from('modules').select('*').order('sort_order'),
    supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('notification_settings').select('*').order('kind'),
  ])

  return (
    <>
      <AppNav />
      <RealtimeRefresher />
      <main className="min-h-screen bg-[#14171F] text-[#EDEAE0] pb-16">
        <div className="max-w-lg mx-auto px-4 pt-8">
          <h1 className="text-xl font-semibold mb-1">ตั้งค่า</h1>
          <p className="text-sm text-[#7C8394] mb-6">เปิด/ปิดโมดูลที่อยากใช้</p>
          <ModulesSettings modules={(modules ?? []) as Module[]} />

          <h2 className="text-sm font-semibold mt-8 mb-3">การแจ้งเตือน</h2>
          <NotificationSettings
            appSettings={appSettings as AppSettings | null}
            notificationSettings={(notificationSettings ?? []) as NotificationSetting[]}
          />
        </div>
      </main>
    </>
  )
}
