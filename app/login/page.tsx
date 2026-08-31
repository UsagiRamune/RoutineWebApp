'use client'

// หน้าเข้าสู่ระบบด้วย Google + Magic Link
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function LoginForm() {
  const searchParams = useSearchParams()
  const hasAuthError = searchParams.get('error') === 'auth'

  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function handleSendLink() {
    if (!email.trim()) return
    setStatus('sending')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    })

    setStatus(error ? 'error' : 'sent')
  }

  async function handleGoogleLogin() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/confirm`,
      },
    })
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#14171F] px-4">
      <div className="w-full max-w-sm bg-[#1B1F2A] border border-[#2A2F3D] rounded-2xl p-8">
        <h1 className="text-xl font-semibold text-[#EDEAE0] mb-1">RoutineWebApp</h1>
        <p className="text-sm text-[#7C8394] mb-6">
          ใส่อีเมลแล้วกดส่งลิงก์ ไม่ต้องใช้รหัสผ่าน
        </p>

        {hasAuthError && (
          <p className="text-sm text-[#E4574A] mb-4">
            ลิงก์หมดอายุหรือใช้ไม่ได้ ลองส่งใหม่หรือใช้ Google แทน
          </p>
        )}

        {status === 'sent' ? (
          <p className="text-sm text-[#4FC1E0]">
            ส่งลิงก์ไปที่ {email} แล้ว เปิดอีเมลแล้วกดลิงก์เพื่อเข้าสู่ระบบได้เลย
          </p>
        ) : (
          <>
            <button
              onClick={handleGoogleLogin}
              className="w-full rounded-lg border border-[#2A2F3D] bg-[#14171F] py-2.5
                         text-sm font-semibold text-[#EDEAE0] mb-4"
            >
              เข้าสู่ระบบด้วย Google
            </button>

            <div className="text-center text-xs text-[#7C8394] mb-4">
              หรือใช้ลิงก์ทางอีเมล
            </div>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendLink()}
              placeholder="อีเมลของมึง"
              className="w-full rounded-lg bg-[#14171F] border border-[#2A2F3D] px-4 py-2.5
                         text-[#EDEAE0] text-sm outline-none focus:border-[#7C8394]"
            />
            <button
              onClick={handleSendLink}
              disabled={status === 'sending'}
              className="w-full mt-3 rounded-lg bg-[#EDEAE0] text-[#14171F] py-2.5
                         text-sm font-semibold disabled:opacity-50"
            >
              {status === 'sending' ? 'กำลังส่ง...' : 'ส่งลิงก์เข้าอีเมล'}
            </button>
            {status === 'error' && (
              <p className="text-sm text-[#E4574A] mt-3">
                ส่งไม่สำเร็จ ลองเช็คอีเมลแล้วส่งใหม่อีกที
              </p>
            )}
          </>
        )}
      </div>
    </main>
  )
}

export default function Login() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
