import { ReactNode } from 'react'

// แถวสรุปจำนวนท่าต่อ block (วอร์มอัพ/circuit/คูลดาวน์) — list row ตาม design.md: เส้นสีบางด้านซ้ายบอก
// หมวดหมู่ ไม่ใช่กรอบเต็มบล็อกแยกทีละอัน
interface Props {
  label: string
  count: number
  timeLabel?: string
  color: string
  action?: ReactNode // เช่นปุ่ม "จัดการ" ท้ายแถว
}

export default function BlockRow({ label, count, timeLabel, color, action }: Props) {
  return (
    <div className="flex items-center gap-3 py-2 pl-3 border-l-2" style={{ borderColor: color }}>
      <div className="flex-1 min-w-0">
        <p className="text-sm">{label}</p>
        {timeLabel && <p className="text-xs text-[#8A8178]">{timeLabel}</p>}
      </div>
      <span className="font-mono text-sm text-[#8A8178] flex-shrink-0">{count}</span>
      {action}
    </div>
  )
}
