'use client'

// แถบบนสุดของทุกหน้า: ชื่อแอป (หรือปุ่มกลับหน้าแรกถ้าไม่ใช่หน้าแรก) + ปุ่มตั้งค่า + ปุ่ม logout
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Settings, LogOut, ArrowLeft } from 'lucide-react'

export default function AppNav() {
  const router = useRouter()
  const pathname = usePathname()
  const isHome = pathname === '/'

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut({ scope: 'local' })
    router.push('/login')
  }

  return (
    // nav เข้มกว่าพื้นหลังหน้า (#171412) อีกชั้นโดยตั้งใจ — กันไม่ให้ค่าสีชนกันจนดูเป็นผืนเดียวกับเนื้อหา
    <div className="bg-[#0E0C0B] border-b border-[#332D28]">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        {isHome ? (
          <Link href="/" className="text-sm font-semibold text-[#EDEAE0]">All-Rounder</Link>
        ) : (
          <Link href="/" className="flex items-center gap-1.5 text-sm font-semibold text-[#EDEAE0]">
            <ArrowLeft size={16} /> หน้าแรก
          </Link>
        )}
        <div className="flex gap-2">
          {/* prefetch={false} — settings เป็นหน้า data-heavy ที่ไม่ค่อยถูกกด ไม่ต้อง prefetch ทุกครั้งที่
              โผล่ในจอ (ต่างจากลิงก์ "/" หน้าแรกด้านบนที่ปล่อย default prefetch ไว้ เพราะเป็นหน้าที่กลับไปบ่อยสุด) */}
          <Link href="/settings" prefetch={false}
            className="p-2 rounded-lg border border-[#332D28] text-[#8A8178]">
            <Settings size={16} />
          </Link>
          <button onClick={logout}
            className="p-2 rounded-lg border border-[#332D28] text-[#8A8178]">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
