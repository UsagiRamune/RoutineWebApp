// เช็คว่าเดินเช้าวันนี้หรือยัง จาก Strava — มี activity type/sport_type เป็น Walk หรือ Hike ตั้งแต่ต้นวัน
// (เที่ยงคืน Bangkok จริง ไม่ใช่ rollover hour ของแอป — เดินเช้าไม่มีทางเกิดก่อนตี 4 อยู่แล้วในทางปฏิบัติ)
// นับว่ายืนยันแล้ว แล้ว upsert morning_walk_checks ของวันนี้ (key ตาม todayKey/rollover ให้ตรงกับที่อื่น)
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { getRolloverHour, todayKey } from '@/lib/dates'
import { NextResponse } from 'next/server'

// TODO: Strava ประกาศว่า REST API base จะย้ายจาก https://www.strava.com/api/v3 ไปเป็น
// https://api-v3.strava.com ตั้งแต่ ม.ค. 2027 — ยังไม่ต้องรีบแก้ตอนนี้ แค่รู้ไว้ล่วงหน้า
const STRAVA_API_BASE = 'https://www.strava.com/api/v3'

interface StravaTokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
}

async function refreshAccessToken(refreshToken: string): Promise<StravaTokenResponse> {
  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('ยังไม่ได้ตั้ง STRAVA_CLIENT_ID/SECRET')

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`ต่ออายุ token ไม่สำเร็จ (${res.status})`)
  return res.json()
}

export async function POST() {
  const { data: { user } } = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })

  const supabase = await createClient()
  const { data: conn } = await supabase.from('strava_connections')
    .select('*').eq('id', 1).maybeSingle()

  if (!conn?.access_token || !conn.refresh_token) {
    return NextResponse.json({ connected: false })
  }

  let accessToken: string = conn.access_token
  const expiresAtMs = conn.expires_at ? new Date(conn.expires_at).getTime() : 0
  // เผื่อ buffer 5 นาทีก่อนหมดอายุจริง กัน request หลุดจังหวะคาบเกี่ยวพอดี
  if (expiresAtMs - 5 * 60000 < Date.now()) {
    try {
      const refreshed = await refreshAccessToken(conn.refresh_token)
      accessToken = refreshed.access_token
      await supabase.from('strava_connections').update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      }).eq('id', 1)
    } catch (err) {
      console.error('[strava check-walk] refresh error:', err)
      return NextResponse.json(
        { error: 'ต่ออายุ Strava token ไม่สำเร็จ ลองเชื่อมต่อใหม่อีกครั้ง' }, { status: 500 })
    }
  }

  const rollover = await getRolloverHour(supabase)
  const today = todayKey(rollover)
  const startOfTodayMs = new Date(`${today}T00:00:00+07:00`).getTime()
  const afterUnix = Math.floor(startOfTodayMs / 1000)

  try {
    const actRes = await fetch(
      `${STRAVA_API_BASE}/athlete/activities?after=${afterUnix}&per_page=30`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!actRes.ok) throw new Error(`Strava activities API ${actRes.status}`)
    const activities = await actRes.json() as { type?: string; sport_type?: string }[]
    const confirmed = activities.some(a =>
      a.type === 'Walk' || a.type === 'Hike' || a.sport_type === 'Walk' || a.sport_type === 'Hike')

    // เก็บ manual_override เดิมไว้ (ไม่ให้ผลเช็ค Strava ไปทับค่าที่ผู้ใช้ยืนยันเองไว้ก่อนหน้า)
    const { data: existing } = await supabase.from('morning_walk_checks')
      .select('manual_override').eq('date', today).maybeSingle()
    await supabase.from('morning_walk_checks').upsert({
      date: today,
      strava_confirmed: confirmed,
      manual_override: existing?.manual_override ?? false,
      checked_at: new Date().toISOString(),
    }, { onConflict: 'date' })

    return NextResponse.json({ connected: true, confirmed })
  } catch (err) {
    console.error('[strava check-walk] activities fetch error:', err)
    return NextResponse.json({ error: 'ดึงข้อมูล Strava ไม่สำเร็จ ลองใหม่อีกที' }, { status: 500 })
  }
}
