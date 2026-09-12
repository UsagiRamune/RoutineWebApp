'use client'

// วงแหวนนับถอยหลัง SVG — ใช้ทั้งตอนจับเวลาท่า (duration_seconds) และหน้าจอพัก (rest)
interface Props {
  totalSeconds: number
  secondsLeft: number
  size?: number
  color?: string
  label?: string
}

export default function CountdownRing({ totalSeconds, secondsLeft, size = 176, color = '#4FC1E0', label }: Props) {
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const pct = totalSeconds > 0 ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : 0
  const offset = circumference * (1 - pct)
  const urgent = secondsLeft <= 3 && secondsLeft > 0

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#2A2F3D" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s linear' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-4xl font-bold tabular-nums ${urgent ? 'animate-pulse' : ''}`}
          style={{ color: urgent ? '#F0A345' : undefined }}>
          {Math.max(0, secondsLeft)}
        </span>
        {label && <span className="text-[10px] text-[#7C8394] mt-0.5">{label}</span>}
      </div>
    </div>
  )
}
