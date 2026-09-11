import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'

export async function createClient() {
    const cookieStore = await cookies()

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => 
                            cookieStore.set(name, value, options)
                        )
                    } catch (error) {
                        console.error('Error setting cookies:', error)
                    }
                }
            }
        }
    )
}

// getUser() คือ network round-trip จริงไปที่ Supabase Auth ทุกครั้ง (จำเป็น — ต่าง getSession() ที่แค่
// อ่าน cookie โดยไม่ verify กับ server เชื่อ cookie ปลอมได้) วัดจริงแล้วตกครั้งละ ~170-270ms ถ้า Server
// Component หลายตัวในหน้าเดียวกัน (เช่น dashboard ที่มีหลาย card เรนเดอร์พร้อมกันใต้ Suspense) ต่างคนต่าง
// เรียกเอง จะยิงซ้ำหลายรอบทบกันในคำขอเดียว — ห่อด้วย React cache() ให้ dedupe เหลือแค่ 1 ครั้งจริงต่อ
// request render pass เดียวกัน (ไม่ใช่ cache ข้าม request/ข้ามผู้ใช้ ไม่ได้ลดความเข้มงวดของการเช็ค auth
// เลย — Supabase เองแนะนำ pattern นี้ตรงๆ) ใช้แทน `const { data: { user } } = await supabase.auth.getUser()`
// ทุกที่ที่ทำแบบนั้นอยู่ (ยกเว้น proxy.ts/middleware ซึ่งรันคนละ execution context แชร์ cache นี้ไม่ได้)
export const getCachedUser = cache(async () => {
    // log นี้ยิงจริงแค่ครั้งเดียวต่อ request render pass เดียวกัน ไม่ว่า getCachedUser() จะถูกเรียกจาก
    // กี่ Server Component ก็ตาม (นั่นคือทั้งหมดของ dedupe — ถ้าเห็น log นี้มากกว่า 1 ครั้งต่อการโหลดหน้าเดียว
    // แปลว่า cache() ใช้ไม่ได้ผลจริง หรือมีการ render มากกว่า 1 request pass)
    console.log('[getCachedUser] *** actual Supabase Auth network call ***')
    const tStart = Date.now()
    const supabase = await createClient()
    const result = await supabase.auth.getUser()
    console.log(`[getCachedUser] auth.getUser() network time: ${Date.now() - tStart}ms`)
    return result
})