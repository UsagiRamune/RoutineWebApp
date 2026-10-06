'use client'

// ping Gemini ครั้งเดียวต่อ browser session (sessionStorage guard) ตอนเปิด dashboard — ไม่ block อะไร
// ไม่สนใจผลลัพธ์เลย (แค่ warm โมเดลที่ไม่ชัวร์ว่าพร้อมไหม + รีเฟรช ai_model_status ไว้ก่อนผู้ใช้กดใช้ AI
// จริงที่หน้าอื่น — ดู POST /api/ai/warm)
import { useEffect } from 'react'

const SESSION_KEY = 'ai-warm-fired'

export default function AiWarmProbe() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return
      sessionStorage.setItem(SESSION_KEY, '1')
    } catch {
      // private mode/บล็อก storage — ยิง probe ไปเลยแบบไม่มี guard ดีกว่าไม่ยิงเลย (ผลเสียแค่ยิงซ้ำบ้าง)
    }
    fetch('/api/ai/warm', { method: 'POST' }).catch(() => {})
  }, [])

  return null
}
