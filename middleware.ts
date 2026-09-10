import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                    request.cookies.set(name, value)
                    )
                    supabaseResponse = NextResponse.next({ request })
                    cookiesToSet.forEach(({ name, value, options}) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // สำคัญ: ห้ามลบบรรทัดนี้ — เป็นตัว refresh session ให้ไม่หมดอายุ
    const { data: { user } } = await supabase.auth.getUser()

    // ยังไม่ login และไม่ได้อยู่หน้า login, กำลังยืนยัน magic link/OAuth, หรือเป็น cron route
    // (cron ไม่มี user session เลย — auth เองผ่าน Authorization: Bearer CRON_SECRET ในตัว route handler) → เด้งไป /login
    // /api/calendar/webhook ก็เหมือนกัน — Google ยิงเข้ามาตรงๆ ไม่มี session, auth เองผ่าน X-Goog-Channel-Token
    if (
        !user &&
        !request.nextUrl.pathname.startsWith('/login') &&
        !request.nextUrl.pathname.startsWith('/auth') &&
        !request.nextUrl.pathname.startsWith('/api/cron') &&
        !request.nextUrl.pathname.startsWith('/api/calendar/webhook')
    ) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    return supabaseResponse
}

export const config = {
    matcher: [
        // รันทุก path ยกเว้นไฟล์ static พวกรูป, _next ฯลฯ
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}