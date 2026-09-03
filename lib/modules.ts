// เช็คว่าโมดูลเปิดอยู่ไหมก่อนเข้าหน้านั้น — ปิดแล้วเด้งกลับ dashboard
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function requireModuleEnabled(key: string) {
  const supabase = await createClient()
  const { data } = await supabase.from('modules').select('enabled').eq('key', key).maybeSingle()
  if (data && !data.enabled) redirect('/')
}
