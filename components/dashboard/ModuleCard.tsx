import Link from 'next/link'
import { ReactNode } from 'react'

interface Props {
  href: string
  title: string
  children: ReactNode
}

export default function ModuleCard({ href, title, children }: Props) {
  return (
    // prefetch={false} — การ์ดพวกนี้อยู่ในจอแรกของ dashboard พร้อมกันหมด ถ้าปล่อย default prefetch
    // (ทำงานตอน viewport visibility) จะยิง Server Component data ของทุกหน้าพร้อมกันตั้งแต่เปิด dashboard
    // เห็นจริงเป็น serverless invocation ~10 อันพร้อมกัน ทั้งที่ผู้ใช้อาจไม่ได้กดเข้าไปเลยสักหน้า
    <Link href={href} prefetch={false}
      className="block bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4
        hover:border-[#7C8394] transition-colors">
      <p className="text-sm font-medium mb-2">{title}</p>
      {children}
    </Link>
  )
}
