// Strava เด้งกลับมาที่นี่พร้อม code → แลกเป็น token แล้วเก็บ strava_connections (แถวเดียว id=1)
// mirror ของ app/api/calendar/callback (Google) แต่ Strava ไม่มี client library ให้ใช้ — เรียก
// oauth/token เองตรงๆ ด้วย form-urlencoded (ตาม docs ของ Strava ไม่รับ JSON body)
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/morning-walk', request.url))

  const { data: { user } } = await getCachedUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))

  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/morning-walk?error=config', request.url))
  }

  const tokenRes = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code',
    }),
  })
  const tokenData = await tokenRes.json().catch(() => null)
  if (!tokenRes.ok || !tokenData?.access_token) {
    console.error('[strava callback] token exchange failed:', tokenData)
    return NextResponse.redirect(new URL('/morning-walk?error=oauth', request.url))
  }

  const supabase = await createClient()
  await supabase.from('strava_connections').upsert({
    id: 1,
    athlete_id: tokenData.athlete?.id ?? null,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: new Date(tokenData.expires_at * 1000).toISOString(),
  })

  return NextResponse.redirect(new URL('/morning-walk', request.url))
}
