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
    <div className="bg-[#14171F] border-b border-[#2A2F3D]">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        {isHome ? (
          <Link href="/" className="text-sm font-semibold text-[#EDEAE0]">All-Rounder</Link>
        ) : (
          <Link href="/" className="flex items-center gap-1.5 text-sm font-semibold text-[#EDEAE0]">
            <ArrowLeft size={16} /> หน้าแรก
          </Link>
        )}
        <div className="flex gap-2">
          <Link href="/settings"
            className="p-2 rounded-lg border border-[#2A2F3D] text-[#7C8394]">
            <Settings size={16} />
          </Link>
          <button onClick={logout}
            className="p-2 rounded-lg border border-[#2A2F3D] text-[#7C8394]">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
