// placeholder ระหว่างรอ section ที่ query หนักกว่าปกติสตรีมเข้ามา (ใช้คู่กับ Suspense) — ขนาด/สัดส่วน
// ต้องใกล้เคียงการ์ดจริง (ModuleCard) กัน layout กระโดดตอนข้อมูลจริงโหลดเสร็จแล้วสลับเข้ามาแทน
export default function CardSkeleton() {
  return (
    <div className="bg-[#201C19] border border-[#332D28] rounded-xl p-4 animate-pulse">
      <div className="h-3.5 w-20 bg-[#332D28] rounded mb-3" />
      <div className="h-6 w-14 bg-[#332D28] rounded mb-2" />
      <div className="h-3 w-28 bg-[#332D28] rounded" />
    </div>
  )
}
