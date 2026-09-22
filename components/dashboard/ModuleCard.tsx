import Link from 'next/link'
import { ReactNode } from 'react'

// สีหมวดหมู่จาก design.md — ตรงกับ ModuleListRow.tsx ห้ามเปลี่ยน hex
const ACCENT: Record<string, string> = {
  routine:   '#F0A345',
  health:    '#F0A345',
  workout:   '#F0A345',
  nutrition: '#F0A345',
  calendar:  '#4FC1E0',
  history:   '#4FC1E0',
  projects:  '#9B7EDE',
}

interface Props {
  href: string
  title: string
  moduleKey: string
  children: ReactNode
  /** ส่ง Tailwind grid-column/row span classes จาก parent (เช่น "col-span-2") */
  className?: string
}

export default function ModuleCard({ href, title, moduleKey, children, className = '' }: Props) {
  const accent = ACCENT[moduleKey] ?? '#8A8178'
  return (
    // การ์ดทั้งใบยังคลิกได้ทั้งใบเหมือนเดิม แต่เปลี่ยนจาก <Link> ห่อทั้งก้อนเป็น <Link> ซ้อนทับแบบ
    // "stretched link" แทน (absolute inset-0 อยู่ล่างสุด) เพราะ children บางการ์ด (เช่น workout) มี
    // ลิงก์ย่อยของตัวเองอยู่ข้างใน — ซ้อน <Link> ใน <Link> ตรงๆ ไม่ได้ (HTML ผิดกติกา, hydration พัง)
    // content ทั้งก้อนเลยตั้ง pointer-events-none ให้คลิกทะลุไปโดน Link เบื้องหลังแทน ยกเว้นลิงก์ย่อยที่
    // ต้องการให้คลิกแยกได้เอง ให้ใส่ pointer-events-auto กำกับตัวเองใน children โดยเฉพาะ
    <div className={`relative flex flex-col bg-[#201C19] border border-[#332D28] rounded-xl p-4
        hover:border-[#8A8178] transition-colors overflow-hidden ${className}`}>
      {/* prefetch={false} — การ์ดพวกนี้อยู่ในจอแรกของ dashboard พร้อมกันหมด ถ้าปล่อย default prefetch
          (ทำงานตอน viewport visibility) จะยิง Server Component data ของทุกหน้าพร้อมกันตั้งแต่เปิด dashboard
          เห็นจริงเป็น serverless invocation ~10 อันพร้อมกัน ทั้งที่ผู้ใช้อาจไม่ได้กดเข้าไปเลยสักหน้า */}
      <Link href={href} prefetch={false} aria-label={title} className="absolute inset-0" />
      <div className="pointer-events-none flex flex-col flex-1 min-h-0">
        {/* accent bar ด้านบน — บอกหมวดหมู่ (design.md) */}
        <div className="h-[2px] w-8 rounded-full mb-3 flex-shrink-0" style={{ background: accent }} />
        <p className="text-[11px] text-[#8A8178] tracking-[0.05em] uppercase mb-2">{title}</p>
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </div>
  )
}
