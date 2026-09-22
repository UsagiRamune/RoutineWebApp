// วงกลมเลขวัน + badge นัดหมายแบบ 5-state เดียวกัน — ใช้ร่วมกันทั้ง CalendarPanel.tsx (ตารางเดือนเต็ม
// หน้า /calendar เซลล์ใหญ่ คลิกเลือกวันได้) และ CalendarCard.tsx (มินิปฏิทินบน dashboard เซลล์เล็ก
// ไม่มี selection) — ก่อนหน้านี้สอง component implement branching state + สี badge แยกกันเอง
// คนละที่ จนเพี้ยนกัน (dashboard เคยลืมโชว์ badge "วันนี้+มีนัดหมาย" เพราะข้อมูล hasEvent ที่ส่งเข้ามา
// ผิด และสไตล์ badge ก็ยังกลับด้านกันอยู่ด้วย — อันนี้แก้ทั้งสองจุดให้ตรงกันแล้ว)
//
// 5 states:
// 1. ปกติ ไม่มีนัดหมาย — เลขจาง (mutedColor)
// 2. ปกติ มีนัดหมาย — เลข + จุดสีเล็กมุมขวาบนของวงกลม
// 3. selected (ไม่ใช่วันนี้) — วงแหวนรอบเลข (accentColor)
// 4. วันนี้ ไม่มีนัดหมาย — วงกลมทึบ accent, เลขสีเข้ม
// 5. วันนี้ + มีนัดหมาย — วงกลมทึบ accent + badge เล็กขอบสีพื้นรอบๆ (cutout) ซ้อนขอบวงกลม
interface Props {
  label: number | string
  today: boolean
  selected?: boolean
  hasEvent: boolean
  inCurrentPeriod?: boolean // อยู่ในเดือน/ช่วงที่กำลังโฟกัสไหม (adjacent month = false, จางลง) — default true
  accentColor?: string
  mutedColor?: string
  dimmedColor?: string
  panelBg?: string // สีพื้นหลังรอบๆ ที่ badge state 5 ต้อง "ตัด" กับมันให้ดูเหมือนลอยอยู่บนวงกลม
  size?: number
}

export default function CalendarDayCircle({
  label, today, selected = false, hasEvent, inCurrentPeriod = true,
  accentColor = '#4FC1E0', mutedColor = '#8A8178', dimmedColor = '#332D28',
  panelBg = '#201C19', size = 28,
}: Props) {
  // today ชนะเสมอถ้าชนกับ selected (เช่น ค่าเริ่มต้นตอนโหลดหน้า selected = วันนี้พอดี) — ring ของ
  // selected ใช้เฉพาะตอนวันที่เลือกไม่ใช่วันนี้เท่านั้น
  const showRing = selected && !today
  const badgeSize = Math.max(6, Math.round(size * 0.32))
  const dotSize = Math.max(4, Math.round(size * 0.22))
  // ผูก font-size กับ size เอง แทนที่จะพึ่ง text-* class จาก parent (ที่เผลอลืมใส่ได้ง่าย — เคย
  // เป็นสาเหตุนึงที่ CalendarCard.tsx ตัวเก่าดูไม่เท่ากับ CalendarPanel.tsx ทั้งที่ตั้งใจให้เหมือนกัน)
  const fontSize = Math.max(10, Math.round(size * 0.43))

  return (
    <span className="relative inline-flex items-center justify-center rounded-full font-mono
      leading-none transition-colors flex-shrink-0"
      style={{
        width: size, height: size, fontSize,
        background: today ? accentColor : 'transparent',
        color: !inCurrentPeriod ? dimmedColor
          : today ? '#171412'
          : showRing ? accentColor
          : mutedColor,
        fontWeight: today || showRing ? 500 : 400,
        boxShadow: showRing ? `inset 0 0 0 1.5px ${accentColor}` : undefined,
      }}>
      {label}

      {/* state 5: วันนี้ + มีนัดหมาย — badge ทึบ accent ขอบสีพื้นรอบๆ (cutout) ซ้อนขอบวงกลม */}
      {today && hasEvent && (
        <span className="absolute rounded-full"
          style={{
            width: badgeSize, height: badgeSize,
            top: -badgeSize * 0.15, right: -badgeSize * 0.15,
            background: accentColor, boxShadow: `0 0 0 2px ${panelBg}`,
          }} />
      )}

      {/* state 2: ไม่ใช่วันนี้ แต่มีนัดหมาย — จุดเล็กมุมขวาบนของวงกลม */}
      {!today && hasEvent && (
        <span className="absolute rounded-full"
          style={{
            width: dotSize, height: dotSize,
            top: -dotSize * 0.3, right: -dotSize * 0.3,
            background: accentColor, opacity: inCurrentPeriod ? 1 : 0.35,
          }} />
      )}
    </span>
  )
}
