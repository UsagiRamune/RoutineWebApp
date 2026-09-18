import Link from 'next/link'
import { ReactNode } from 'react'

// สีหมวดหมู่จาก design.md — ห้ามเปลี่ยน hex
const CATEGORY_COLORS: Record<string, string> = {
  routine:   '#F0A345', // ร่างกาย/สุขภาพ (ส้ม)
  health:    '#F0A345',
  workout:   '#F0A345',
  nutrition: '#F0A345',
  calendar:  '#4FC1E0', // ปฏิทิน/งาน (ฟ้า)
  history:   '#4FC1E0',
  projects:  '#9B7EDE', // โปรเจกต์/สกิล (ม่วง)
}

interface Props {
  href: string
  title: string
  moduleKey: string
  children: ReactNode
  className?: string
}

// list row แบบไม่มีกรอบเต็ม — ใช้เส้นสีบางด้านซ้ายบอกหมวดหมู่แทน (design.md: List row pattern)
// prefetch={false} — กัน prefetch ทุก module card พร้อมกันตั้งแต่เปิด dashboard
export default function ModuleListRow({ href, title, moduleKey, children, className = '' }: Props) {
  const accentColor = CATEGORY_COLORS[moduleKey] ?? '#7C8394'
  return (
    <Link
      href={href}
      prefetch={false}
      className={`flex items-center gap-4 py-3.5 pl-0 pr-2
        hover:bg-[#1B1F2A] rounded-r-lg transition-colors group ${className}`}
    >
      {/* accent bar ซ้าย */}
      <div className="w-[3px] self-stretch rounded-r-full flex-shrink-0"
        style={{ background: accentColor }} />

      {/* content */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[#7C8394] tracking-[0.05em] uppercase mb-0.5">{title}</p>
        {children}
      </div>

      {/* chevron */}
      <svg className="w-4 h-4 text-[#2A2F3D] group-hover:text-[#7C8394] transition-colors flex-shrink-0"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}
