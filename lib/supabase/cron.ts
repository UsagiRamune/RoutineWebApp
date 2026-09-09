// client สำหรับ context ที่ไม่มี user session (cron routes) — auth ผ่าน Bearer CRON_SECRET แทน cookie
// ใช้ service role key ถ้ามี (bypass RLS ได้ตรงไปตรงมา) ไม่งั้น fallback เป็น anon key
// (ตารางส่วนใหญ่ในแอปนี้เป็น singleton ที่ไม่ได้ scope ด้วย user_id อยู่แล้ว จึงมักอ่าน/เขียนได้แม้ไม่มี session
// แต่ถ้า RLS policy เขียนแบบ "to authenticated" ล้วน anon key จะโดนบล็อกเงียบๆ — query สำเร็จแต่ได้ null/[] กลับมา
// ไม่ throw เลย ดูตรง logCronError ทุกจุดที่อ่านตาราง)
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export type CronClientMode = 'service' | 'anon'

export function cronClientMode(): CronClientMode {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service' : 'anon'
}

export function createCronClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const mode = cronClientMode()
  console.log(`[cron] supabase client mode: ${mode}`)
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function checkCronAuth(request: Request): boolean {
  const auth = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  return !!secret && auth === `Bearer ${secret}`
}

// เรียกทันทีหลัง query ทุกครั้ง — RLS block ไม่ throw จึงต้อง log error object ตรงๆ
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
