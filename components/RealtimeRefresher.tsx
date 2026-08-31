'use client'

// subscribe การเปลี่ยนแปลงจาก Supabase Realtime
// มีใครเขียนข้อมูลจากเครื่องไหนก็ตาม → refresh หน้านี้อัตโนมัติ
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function RealtimeRefresher() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        router.refresh()
      })
      .subscribe()

    // เผื่อ Realtime หลุด: กลับมาโฟกัสแท็บเมื่อไหร่ refresh หนึ่งที
    const onFocus = () => router.refresh()
    window.addEventListener('focus', onFocus)

    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
    }
  }, [router])

  return null // ไม่มี UI — เป็น component ทำงานเบื้องหลังล้วนๆ
}