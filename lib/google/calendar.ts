// helper สำหรับคุยกับ Google Calendar API
import { google } from 'googleapis'

export function oauthClient(origin: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${origin}/api/calendar/callback`
  )
}

// สร้าง calendar client จาก refresh token ที่เก็บไว้
export function calendarFor(origin: string, refreshToken: string) {
  const auth = oauthClient(origin)
  auth.setCredentials({ refresh_token: refreshToken })
  // googleapis จะเอา refresh token ไปขอ access token ใหม่ให้เองทุกครั้งที่หมดอายุ
  return google.calendar({ version: 'v3', auth })
}

export function tasksFor(origin: string, refreshToken: string) {
  const auth = oauthClient(origin)
  auth.setCredentials({ refresh_token: refreshToken })
  return google.tasks({ version: 'v1', auth })
}