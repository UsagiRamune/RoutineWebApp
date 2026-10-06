// Hero ของหน้าโภชนาการ — ครึ่งวงกลมซ้อนกัน 4 ชั้น (kcal นอกสุด → โปรตีน → คาร์บ → ไขมัน) แทนตัวเลข kcal
// ใหญ่ๆ + chip แมโคร + progress bar เส้นตรงแบบเดิมทั้งหมด
//
// gradient exception เดียวที่อนุญาตในแอปทั้งหมด (ตามคำสั่งเจาะจงของผู้ใช้ — ดู design.md) ไล่จาง (tint) →
// กลาง (สี category เดิม) ตามแนวอาร์คจริง ใช้ gradientUnits="userSpaceOnUse" ผูกกับจุดเริ่ม/จบของอาร์คแต่ละ
// วง (ไม่ใช่ bounding box) — เป็น "จาง→กลาง" เท่านั้น ไม่ไล่ไปโทนเข้ม
//
// เกินเป้า (value > goal, Mi Fitness-style ตามที่ผู้ใช้อนุมัติ): อาร์ค base เต็ม 180° เสมอ (tint→category)
// แล้ววาด overflow arc สีเข้มกว่า (solid ล้วน ไม่มี gradient) ทับด้านบน เริ่มจากจุดซ้ายสุด หมุนตามเข็มยาว
// min((value-goal)/goal, 1) ของ 180° (200% ของเป้า = วนครบอีกรอบเต็ม 180° แล้ว cap ไว้ไม่ให้เกินนั้น)
// เป้าเป็น null: วาดแค่ track ไม่มี fill arc เลย legend โชว่แค่ค่าจริงอย่างเดียว ไม่มี /เป้า, ไม่มี %
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

// มุมต่ำสุดที่ยังเห็นเป็นเส้นสั้นๆ ได้จริง ไม่ใช่จุดกลมจาก round line cap — stroke 9 เทียบ radius วงในสุด
// (74) ต้องการมุมประมาณ 9/74 rad ~7° ขึ้นไปถึงจะไม่ดูเป็นจุด ปัดขึ้นเผื่อไว้ที่ 6° ใช้ร่วมกันทุกวง
const MIN_VISIBLE_DEG = 6

function polarPoint(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) }
}

function fmtNum(n: number, decimals = 0) {
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}

// HSL helpers — ไว้ derive เฉดจาง (tint เริ่ม gradient) และเฉดเข้ม (overflow arc) จากสี category เดิมเอง
// ไม่ต้องคิดสีใหม่เพิ่ม (design.md ห้ามไว้) ค่า offset lightness/saturation ปรับจนใกล้เคียง mockup ที่
// อนุมัติแล้วที่สุด (เทียบตัวเลข HSL จริงของ mockup แต่ละสีแล้ว ไม่ใช่เดาตามคำอธิบาย "+25%" ตรงตัว)
function hexToHsl(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const delta = max - min
  let h = 0
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6)
    else if (max === g) h = 60 * ((b - r) / delta + 2)
    else h = 60 * ((r - g) / delta + 4)
  }
  if (h < 0) h += 360
  return { h, s, l }
}

function hslToHex(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function shiftColor(hex: string, lDeltaPct: number, sDeltaPct: number) {
  const { h, s, l } = hexToHsl(hex)
  const newL = Math.min(1, Math.max(0, l + lDeltaPct / 100))
  const newS = Math.min(1, Math.max(0, s + sDeltaPct / 100))
  return hslToHex(h, newS, newL)
}

const tintOf = (hex: string) => shiftColor(hex, 20, -2)
const darkOf = (hex: string) => shiftColor(hex, -20, -9)

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
  const right = (r: number) => polarPoint(0, r)    // จุดจบอาร์คตอนเต็ม 100% (ขวาสุด)

  // รวมสถานะที่ต้องใช้ทั้งวาด arc และ legend ไว้ที่เดียว เลี่ยงคำนวณซ้ำ 2 ที่
  const states = rings.map(ring => {
    const hasGoal = ring.goal != null && ring.goal > 0
    const rawP = hasGoal ? ring.value / ring.goal! : 0
    const over = hasGoal && ring.value > ring.goal!
    const minP = MIN_VISIBLE_DEG / 180
    const clampedP = Math.min(1, rawP)
    // 0 เป๊ะ: ไม่วาดอะไรเลย (ไม่ clamp ขึ้น) — ค่าน้อยมากแต่ไม่ใช่ 0: clamp ขึ้นให้พอเห็นเป็นเส้น
    const drawP = clampedP <= 0 ? 0 : clampedP < minP ? minP : clampedP
    const overflowFraction = over ? Math.min((ring.value - ring.goal!) / ring.goal!, 1) : 0
    const pct = hasGoal ? Math.round(rawP * 100) : null
    return { ring, over, drawP, overflowFraction, pct }
  })

  return (
    <div className="w-full max-w-[320px] mx-auto">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          {states.map(({ ring, drawP }) => {
            if (drawP <= 0) return null
            const start = left(ring.radius)
            const end = polarPoint(180 - 180 * drawP, ring.radius)
            return (
              <linearGradient key={ring.key} id={`macro-gradient-${ring.key}`}
                gradientUnits="userSpaceOnUse" x1={start.x} y1={start.y} x2={end.x} y2={end.y}>
                <stop offset="0%" stopColor={tintOf(ring.color)} />
                <stop offset="100%" stopColor={ring.color} />
              </linearGradient>
            )
          })}
        </defs>

        {states.map(({ ring, drawP, over, overflowFraction }) => {
          const l = left(ring.radius)
          const r = right(ring.radius)
          const trackPath = `M ${l.x},${l.y} A ${ring.radius},${ring.radius} 0 0 1 ${r.x},${r.y}`
          const fillEnd = polarPoint(180 - 180 * drawP, ring.radius)
          const fillPath = `M ${l.x},${l.y} A ${ring.radius},${ring.radius} 0 0 1 ${fillEnd.x},${fillEnd.y}`
          const overflowEnd = polarPoint(180 - 180 * overflowFraction, ring.radius)
          const overflowPath = `M ${l.x},${l.y} A ${ring.radius},${ring.radius} 0 0 1 ${overflowEnd.x},${overflowEnd.y}`

          return (
            <g key={ring.key}>
              <path d={trackPath} fill="none" stroke="#332D28" strokeWidth={STROKE} strokeLinecap="round" />
              {drawP > 0 && (
                <path d={fillPath} fill="none" stroke={`url(#macro-gradient-${ring.key})`}
                  strokeWidth={STROKE} strokeLinecap="round" />
              )}
              {/* overflow arc ทับบนสุด — ต้องอยู่หลัง fill path ใน DOM order ถึงจะวาดทับได้จริง */}
              {over && overflowFraction > 0 && (
                <path d={overflowPath} fill="none" stroke={darkOf(ring.color)}
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
        {states.map(({ ring, pct, over }) => (
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
        ))}
      </div>
    </div>
  )
}
