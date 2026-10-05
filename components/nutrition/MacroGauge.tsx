// Hero ของหน้าโภชนาการ — ครึ่งวงกลมซ้อนกัน 4 ชั้น (kcal นอกสุด → โปรตีน → คาร์บ → ไขมัน) แทนตัวเลข kcal
// ใหญ่ๆ + chip แมโคร + progress bar เส้นตรงแบบเดิมทั้งหมด
//
// gradient exception เดียวที่อนุญาตในแอปทั้งหมด (ตามคำสั่งเจาะจงของผู้ใช้ — ดู design.md) ไล่จาง (35%)
// ที่ปลายซ้าย → เข้มเต็ม (100%) ที่ปลาย progress จริง ใช้ gradientUnits="userSpaceOnUse" ผูกกับจุดเริ่ม/
// จบของอาร์คแต่ละวง (ไม่ใช่ bounding box) ให้ไล่สีตามแนวเส้นจริง
//
// เกินเป้า (value > goal): อาร์คค้างที่เต็ม 180° เสมอ (ไม่ล้น) มีแค่ % ใน legend ที่เปลี่ยนเป็นสีแดง
// เป้าเป็น null: วาดแค่ track (วงจาง) ไม่มี fill arc เลย legend โชว่แค่ค่าจริงอย่างเดียว ไม่มี /เป้า, ไม่มี %
import { NutritionProfile } from '@/lib/supabase/types'

interface Totals {
  calories: number
  protein: number
  carbs: number
  fat: number
}

interface Props {
  totals: Totals
  profile: NutritionProfile | null
}

interface RingDef {
  key: string
  label: string
  color: string
  value: number
  goal: number | null
  unit: string
  radius: number
  decimals: number
}

const STROKE = 9
const CX = 140
const CY = 128
const VIEW_W = 280
const VIEW_H = 140

function polarPoint(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) }
}

function fmtNum(n: number, decimals = 0) {
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}

export default function MacroGauge({ totals, profile }: Props) {
  const rings: RingDef[] = [
    { key: 'kcal', label: 'แคล', color: '#F0A345', value: totals.calories,
      goal: profile?.daily_calories ?? null, unit: 'kcal', radius: 116, decimals: 0 },
    // โปรตีน ใช้ #6FCF7A — token "บวก/แนวโน้มดี" ที่มีอยู่แล้วในแอป (design.md) ไม่ได้คิดสีใหม่
    { key: 'protein', label: 'โปรตีน', color: '#6FCF7A', value: totals.protein,
      goal: profile?.daily_protein_g ?? null, unit: 'ก.', radius: 102, decimals: 0 },
    { key: 'carbs', label: 'คาร์บ', color: '#4FC1E0', value: totals.carbs,
      goal: profile?.daily_carbs_g ?? null, unit: 'ก.', radius: 88, decimals: 0 },
    { key: 'fat', label: 'ไขมัน', color: '#9B7EDE', value: totals.fat,
      goal: profile?.daily_fat_g ?? null, unit: 'ก.', radius: 74, decimals: 0 },
  ]

  const left = (r: number) => polarPoint(180, r)   // จุดเริ่มอาร์ค (ซ้ายสุด) ของทุกวงเหมือนกันเสมอ
  const right = (r: number) => polarPoint(0, r)     // จุดจบอาร์คตอนเต็ม 100% (ขวาสุด)

  return (
    <div className="w-full max-w-[320px] mx-auto">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          {rings.map(ring => {
            if (ring.goal == null || ring.goal <= 0) return null
            const p = Math.min(1, ring.value / ring.goal)
            if (p <= 0) return null
            const end = polarPoint(180 - 180 * p, ring.radius)
            const start = left(ring.radius)
            return (
              <linearGradient key={ring.key} id={`macro-gradient-${ring.key}`}
                gradientUnits="userSpaceOnUse" x1={start.x} y1={start.y} x2={end.x} y2={end.y}>
                <stop offset="0%" stopColor={ring.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={ring.color} stopOpacity={1} />
              </linearGradient>
            )
          })}
        </defs>

        {rings.map(ring => {
          const l = left(ring.radius)
          const r = right(ring.radius)
          const trackPath = `M ${l.x},${l.y} A ${ring.radius},${ring.radius} 0 0 1 ${r.x},${r.y}`
          const p = ring.goal != null && ring.goal > 0 ? Math.min(1, ring.value / ring.goal) : 0
          const fillEnd = polarPoint(180 - 180 * p, ring.radius)
          const fillPath = `M ${l.x},${l.y} A ${ring.radius},${ring.radius} 0 0 1 ${fillEnd.x},${fillEnd.y}`

          return (
            <g key={ring.key}>
              <path d={trackPath} fill="none" stroke="#332D28" strokeWidth={STROKE} strokeLinecap="round" />
              {p > 0 && (
                <path d={fillPath} fill="none" stroke={`url(#macro-gradient-${ring.key})`}
                  strokeWidth={STROKE} strokeLinecap="round" />
              )}
            </g>
          )
        })}
      </svg>

      {/* ข้อความอยู่ใต้ส่วนโค้งเสมอ (นอก <svg> ไปเลย) — ไม่มีทางซ้อนกับอาร์คได้โดยโครงสร้าง */}
      <div className="text-center mt-1">
        <p className="font-mono text-4xl font-semibold leading-none">{fmtNum(totals.calories)}</p>
        <p className="text-xs text-[#8A8178] mt-1">
          {profile?.daily_calories != null ? `เป้า ${fmtNum(profile.daily_calories)} kcal` : 'ยังไม่ตั้งเป้า kcal'}
        </p>
      </div>

      {/* legend 2×2 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4">
        {rings.map(ring => {
          const pct = ring.goal != null && ring.goal > 0 ? Math.round((ring.value / ring.goal) * 100) : null
          const over = pct != null && pct > 100
          return (
            <div key={ring.key} className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ring.color }} />
              <div className="min-w-0">
                <p className="text-[10px] text-[#8A8178] leading-tight">{ring.label}</p>
                <p className="text-xs leading-tight truncate">
                  <span className="font-mono">
                    {fmtNum(ring.value, ring.decimals)}
                    {ring.goal != null && `/${fmtNum(ring.goal, ring.decimals)}`}
                  </span>
                  <span className="text-[#8A8178]"> {ring.unit}</span>
                  {pct != null && (
                    <span className="ml-1 font-mono" style={{ color: over ? '#E4574A' : '#8A8178' }}>
                      {pct}%
                    </span>
                  )}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
