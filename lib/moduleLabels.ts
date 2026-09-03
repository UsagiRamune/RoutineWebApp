// ชื่อโมดูลที่โชว์ผู้ใช้ — key 'health' ใน DB ความหมายเปลี่ยนจาก "sync สุขภาพ" เป็น "ภาพรวมร่างกาย" แล้ว
// แต่ DB key เดิมต้องคงไว้ (กระทบ requireModuleEnabled/route mapping อื่นๆ) จึง override เฉพาะ label
// ที่แสดงผลแทน ไม่แตะ key จริงใน Supabase
export function moduleLabel(m: { key: string; name: string }): string {
  if (m.key === 'health') return 'ร่างกาย'
  return m.name
}
