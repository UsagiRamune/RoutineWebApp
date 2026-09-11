// Google เด้งกลับมาที่นี่พร้อม code → แลกเป็น token แล้วเก็บ + sync cache ครั้งแรก + ลงทะเบียน push channel
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { oauthClient } from '@/lib/google/calendar'
import { syncCalendarToCache } from '@/lib/google/calendar-sync'
import { registerPrimaryCalendarChannel } from '@/lib/google/calendar-channel'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/', request.url))

  const supabase = await createClient()
  const { data: { user } } = await getCachedUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))

  const client = oauthClient(request.nextUrl.origin)
  const { tokens } = await client.getToken(code)

  if (tokens.refresh_token) {
    await supabase.from('google_connections').upsert({
      user_id: user.id,
      refresh_token: tokens.refresh_token,
    })

    const origin = request.nextUrl.origin
    // เชื่อมสำเร็จ → sync cache ครั้งแรกทันที (ไม่งั้นผู้ใช้จะเห็นปฏิทินว่างจนกว่า GET จะ bootstrap เอง
    // หรือ cron รายชั่วโมงมาถึง) แล้วค่อยลงทะเบียน push channel — ทำสองอย่างแยก try กันอันหนึ่งพังไม่ลาม
    // ไปบล็อกอีกอันหรือบล็อกการ redirect กลับหน้าแรก
    await syncCalendarToCache(supabase, origin, tokens.refresh_token).catch(err =>
      console.error('[calendar callback] initial sync error:', err))
    await registerPrimaryCalendarChannel(supabase, origin, tokens.refresh_token).catch(err =>
      console.error('[calendar callback] channel register error:', err))
  }

  return NextResponse.redirect(new URL('/', request.url))
}