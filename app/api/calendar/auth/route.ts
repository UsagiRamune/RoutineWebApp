// เด้งไปหน้า Google ขอสิทธิ์เข้าถึงปฏิทิน
import { oauthClient } from '@/lib/google/calendar'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const client = oauthClient(request.nextUrl.origin)
  const url = client.generateAuthUrl({
    access_type: 'offline',   // ขอ refresh token (ไม่ใช่แค่ access ชั่วคราว)
    prompt: 'consent',        // บังคับหน้า consent ทุกครั้ง — การันตีได้ refresh token ใหม่เสมอ
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/tasks',
    ],
  })
  return NextResponse.redirect(url)
}