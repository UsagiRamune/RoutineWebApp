// Google เด้งกลับมาที่นี่พร้อม code → แลกเป็น token แล้วเก็บ
import { createClient } from '@/lib/supabase/server'
import { oauthClient } from '@/lib/google/calendar'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/', request.url))

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))

  const client = oauthClient(request.nextUrl.origin)
  const { tokens } = await client.getToken(code)

  if (tokens.refresh_token) {
    await supabase.from('google_connections').upsert({
      user_id: user.id,
      refresh_token: tokens.refresh_token,
    })
  }

  return NextResponse.redirect(new URL('/', request.url))
}