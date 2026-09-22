'use client'

// ชิปวันแบบ 5-state เดียวกับที่ CalendarPanel.tsx ใช้กับเซลล์ปฏิทิน (today ทึบ, selected ที่ไม่ใช่ today
// เป็นวงแหวน, ปกติจางๆ) — แยกเป็น component กลางให้หน้าอื่น (เช่น day-picker ของ workout) ใช้ร่วมได้
// โดยไม่ต้อง refactor CalendarPanel.tsx เดิม (ของเดิมทำงานอยู่แล้ว ไม่แตะ) พฤติกรรม priority logic
// (showRing = selected && !today) เหมือนกันเป๊ะ
interface Props {
  label: string
  today: boolean
  selected: boolean
  onClick: () => void
  disabled?: boolean
  todayColor?: string    // สีพื้นวงกลมตอนเป็น "วันนี้" — default ฟ้าเหมือน CalendarPanel
  ringColor?: string     // สีขอบวงแหวนตอน "selected ที่ไม่ใช่วันนี้"
  regularColor?: string  // สีตัวอักษรวันปกติ (จาง ไม่มีการตกแต่งเพิ่ม)
  size?: number
}

export default function DayChip({
  label, today, selected, onClick, disabled = false,
  todayColor = '#4FC1E0', ringColor = '#4FC1E0', regularColor = '#8A8178', size = 28,
}: Props) {
  // today ชนะเสมอถ้าชนกับ selected (เช่น ค่าเริ่มต้นตอนโหลดหน้า selected = วันนี้พอดี) — ไม่วาดวงแหวนซ้อน
  const showRing = selected && !today
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex items-center justify-center rounded-full font-mono text-xs
        transition-colors ${disabled ? 'cursor-default' : ''}`}
      style={{
        width: size, height: size,
        background: today ? todayColor : 'transparent',
        color: disabled ? '#332D28' : today ? '#171412' : showRing ? ringColor : regularColor,
        // เข้าใจง่าย ไม่หนักเกิน — 500 พอ ไม่ต้อง bold/700 ตามที่ขอ
        fontWeight: today || showRing ? 500 : 400,
        boxShadow: showRing ? `inset 0 0 0 1.5px ${ringColor}` : undefined,
      }}>
      {label}
    </button>
  )
}
