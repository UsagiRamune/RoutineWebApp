// เด้งไปหน้า Strava ขอสิทธิ์อ่านกิจกรรม — mirror ของ app/api/calendar/auth (Google)
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const clientId = process.env.STRAVA_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: 'ยังไม่ได้ตั้ง STRAVA_CLIENT_ID' }, { status: 500 })
  }

  const url = new URL('https://www.strava.com/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', `${request.nextUrl.origin}/api/strava/callback`)
  url.searchParams.set('response_type', 'code')
  // บังคับหน้า consent ทุกครั้ง (เทียบเท่า prompt=consent ของ Google) — การันตี refresh token ใหม่เสมอ
  url.searchParams.set('approval_prompt', 'force')
  url.searchParams.set('scope', 'activity:read_all')
  return NextResponse.redirect(url)
}
