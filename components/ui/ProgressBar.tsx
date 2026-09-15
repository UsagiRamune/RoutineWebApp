interface Props {
  value: number
  target: number
  color?: string
  overColor?: string
  className?: string
}

// แถบ progress บาง — pattern เดียวกับแคลอรีใน Hero.tsx ใช้ทุกที่ที่เทียบค่ากับเป้า
export default function ProgressBar({ value, target, color = '#4FC1E0', overColor, className = '' }: Props) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0
  const isOver = target > 0 && value > target
  return (
    <div className={`h-2 bg-[#14171F] rounded-full overflow-hidden ${className}`}>
      <div className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: isOver && overColor ? overColor : color }} />
    </div>
  )
}
