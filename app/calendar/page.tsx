import AppNav from '@/components/AppNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import CalendarPanel from '@/components/CalendarPanel'
import { requireModuleEnabled } from '@/lib/modules'

export default async function CalendarPage() {
  await requireModuleEnabled('calendar')

  return (
    <>
      <AppNav />
      <RealtimeRefresher />
      <main className="min-h-screen bg-[#14171F] text-[#EDEAE0] pb-16">
        <div className="max-w-lg mx-auto px-4 pt-8">
          <h1 className="text-xl font-semibold mb-6">ปฏิทิน</h1>
          <CalendarPanel />
        </div>
      </main>
    </>
  )
}
