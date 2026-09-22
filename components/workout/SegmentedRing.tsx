'use client'

// วงแหวนนับถอยหลังแบบ segmented (ขีดรอบวงกลม ติดไล่ตามเวลาที่เหลือ) แทนเส้นโค้งเรียบของ CountdownRing —
// ใช้เฉพาะตอนจับเวลาท่าออกกำลังกายจริง (ไม่ใช่ prep buffer/หน้าจอพัก ที่ยังใช้ CountdownRing เดิม)
// ขีดที่ "เหลือเวลา" ยังติดสี ไล่ดับทีละขีดตามลำดับรอบวงเมื่อเวลาหมดลง — ความหมายเดียวกับเส้นโค้งเดิม
// (แสดงเวลาที่เหลือ ไม่ใช่เวลาที่ผ่านไป) แค่เปลี่ยนรูปแบบการวาดเป็นขีดแยกช่องแทน
interface Props {
  totalSeconds: number
  secondsLeft: number
  segments?: number
  size?: number
  color?: string
  label?: string
}

export default function SegmentedRing({
  totalSeconds, secondsLeft, segments = 24, size = 176, color = '#4FC1E0', label,
}: Props) {
  const pct = totalSeconds > 0 ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : 0
  const litCount = Math.round(pct * segments)
  const urgent = secondsLeft <= 3 && secondsLeft > 0

  const center = size / 2
  const outerRadius = center - 4
  const tickLength = size * 0.09
  const innerRadius = outerRadius - tickLength

  const ticks = Array.from({ length: segments }, (_, i) => {
    // เริ่มที่ 12 นาฬิกา (-90deg) วนตามเข็มนาฬิกา เหมือนทิศทางของ CountdownRing เดิม
    const angle = (i / segments) * 2 * Math.PI - Math.PI / 2
    const x1 = center + outerRadius * Math.cos(angle)
    const y1 = center + outerRadius * Math.sin(angle)
    const x2 = center + innerRadius * Math.cos(angle)
    const y2 = center + innerRadius * Math.sin(angle)
    return (
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={i < litCount ? color : '#332D28'} strokeWidth={size * 0.017} strokeLinecap="round"
        style={{ transition: 'stroke 0.3s' }} />
    )
  })

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size}>{ticks}</svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-4xl font-bold font-mono tabular-nums ${urgent ? 'animate-pulse' : ''}`}
          style={{ color: urgent ? '#F0A345' : undefined }}>
          {Math.max(0, secondsLeft)}
        </span>
        {label && <span className="text-[10px] text-[#8A8178] mt-0.5">{label}</span>}
      </div>
    </div>
  )
}
