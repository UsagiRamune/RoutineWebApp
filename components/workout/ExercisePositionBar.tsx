// แถบ segmented บอกตำแหน่งท่าปัจจุบันภายในรอบ/บล็อกนี้ (ไม่ใช่ progress รวมทั้งเวิร์กเอาต์) — ช่องที่ทำ
// แล้วติดสีเต็ม, ช่องปัจจุบันติดสีครึ่งความทึบ, ช่องที่ยังไม่ถึงเป็นสีเทาจาง (design.md: segmented ไม่ใช่แท่งเรียบ)
interface Props {
  total: number
  currentIndex: number // 0-based
  color: string
  className?: string
}

export default function ExercisePositionBar({ total, currentIndex, color, className = '' }: Props) {
  if (total <= 0) return null
  return (
    <div className={`flex gap-1 ${className}`}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="h-1 flex-1 rounded-sm transition-all"
          style={{
            background: i <= currentIndex ? color : '#332D28',
            opacity: i === currentIndex ? 0.5 : 1,
          }} />
      ))}
    </div>
  )
}
