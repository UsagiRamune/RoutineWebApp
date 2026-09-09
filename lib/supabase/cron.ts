// client สำหรับ context ที่ไม่มี user session (cron routes) — auth ผ่าน Bearer CRON_SECRET แทน cookie
// ต้องใช้ service role key เท่านั้น (bypass RLS) — ห้าม fallback เป็น anon key เด็ดขาด เพราะ RLS policy
// ในโปรเจกต์นี้เป็น "to authenticated" ทั้งหมด: ใช้ anon key แล้ว query จะ "สำเร็จ" แต่ได้ null/[] เงียบๆ
// (เจอเคสนี้มาแล้ว debug อยู่หลายชั่วโมงกว่าจะรู้ว่าเป็น RLS ไม่ใช่ "ไม่มีข้อมูลจริง")
// พังดังๆ ตั้งแต่จุดสร้าง client ดีกว่ารันต่อไปแบบเงียบๆ แล้วไม่ทำอะไรเลย
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export function createCronClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    throw new Error('ไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY')
  }
  console.log('[cron] supabase client: service role')
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function checkCronAuth(request: Request): boolean {
  const auth = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  return !!secret && auth === `Bearer ${secret}`
}

// เรียกทันทีหลัง query ทุกครั้ง — error จาก RLS/permission ไม่ throw จึงต้อง log error object ตรงๆ
// (message/code/details) แทนการปล่อยให้แถวเปล่าถูกตีความว่า "ไม่มีข้อมูล"
export interface SupabaseErrorLike {
  message?: string
  code?: string
  details?: string
  hint?: string
}

export function logCronError(label: string, error: SupabaseErrorLike | null | undefined) {
  if (!error) return
  console.error(`[cron] ${label} error:`, {
    message: error.message, code: error.code, details: error.details, hint: error.hint,
  })
}
