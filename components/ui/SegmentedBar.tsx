// SegmentedBar — แทนที่ ProgressBar แบบเรียบยาวทุกจุดในแอป (design.md: layout patterns)
// แบ่งเป็นช่องสั้นๆ เรียงกัน — ช่องที่ผ่านแล้วติดสี ช่องที่เหลือจาง

interface Props {
  value: number
  target: number
  segments?: number      // default 10
  color?: string         // filled segment color
  overColor?: string     // color when value > target (default #E4574A)
  className?: string
}

export default function SegmentedBar({
  value,
  target,
  segments = 10,
  color = '#4FC1E0',
  overColor = '#E4574A',
  className = '',
}: Props) {
  const pct = target > 0 ? Math.min(1, value / target) : 0
  const isOver = target > 0 && value > target
  const filledCount = Math.round(pct * segments)
  const activeColor = isOver ? overColor : color

  return (
    <div className={`flex gap-[2px] ${className}`} role="progressbar"
      aria-valuenow={value} aria-valuemax={target}>
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className="h-1 flex-1 rounded-sm transition-colors"
          style={{ background: i < filledCount ? activeColor : '#2A2F3D' }}
        />
      ))}
    </div>
  )
}
