// คลาส Tailwind เล็กๆ ที่ใช้ซ้ำหลายไฟล์ — เก็บไว้ที่เดียวกันดริฟต์ (เรียนจากบั๊ก calendar day-cell ที่
// สอง component เคย implement badge logic เดียวกันแยกกันเองจนเพี้ยน — เรื่องสไตล์ก็เกิดซ้ำได้เหมือนกัน)

// ปุ่มลบ: จอสัมผัสไม่มี hover state เลยต้องโชว์ตลอด ส่วนจอ desktop (มี mouse จริง) ค่อยซ่อนแล้วโชว์ตอน
// hover/focus แถว — เช็คด้วย media feature (hover: hover) ตรงๆ ไม่ใช้ Tailwind hover: เฉยๆ เพราะอันนั้น
// เป็น :hover ธรรมดา ทำงานทั้งจอสัมผัสด้วย (กดค้างแล้วปุ่มเด้งโผล่ผิดจังหวะ) — ใส่ className="group" ที่แถว
// แม่เสมอให้ group-hover ทำงาน
export const DELETE_HOVER_REVEAL = 'transition-opacity opacity-100 [@media(hover:hover)]:opacity-0 ' +
  '[@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100'
