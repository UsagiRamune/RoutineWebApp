// client สำหรับ context ที่ไม่มี user session (cron routes) — auth ผ่าน Bearer CRON_SECRET แทน cookie
// ใช้ service role key ถ้ามี (bypass RLS ได้ตรงไปตรงมา) ไม่งั้น fallback เป็น anon key
// (ตารางส่วนใหญ่ในแอปนี้เป็น singleton ที่ไม่ได้ scope ด้วย user_id อยู่แล้ว จึงมักอ่าน/เขียนได้แม้ไม่มี session)
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export function createCronClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
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
