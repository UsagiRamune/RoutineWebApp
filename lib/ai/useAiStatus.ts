'use client'

// สถานะ Gemini model chain ปัจจุบัน ใช้ปิดปุ่ม AI ในหน้าที่มีปุ่มเรียก AI (ประเมินอาหาร/วิเคราะห์ history)
// ตอนทุกโมเดลกำลัง cooldown พร้อมกัน — poll เฉพาะตอนแท็บ visible กันยิง request เปล่าๆ ตอนสลับแท็บทิ้งไว้
import { useEffect, useState } from 'react'

interface AiStatus {
  anyAvailable: boolean
  nextRetrySec: number | null
}

const POLL_MS = 60_000

export function useAiStatus() {
  const [status, setStatus] = useState<AiStatus | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/ai/status')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setStatus({ anyAvailable: data.anyAvailable, nextRetrySec: data.nextRetrySec })
      } catch {
        // เงียบๆ พอ — ปุ่ม AI แค่ไม่โชว์คำเตือน ไม่ใช่ critical path
      }
    }

    load()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, POLL_MS)

    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  return status
}

export function fmtRetryMinutes(sec: number | null) {
  if (sec == null) return ''
  const minutes = Math.max(1, Math.ceil(sec / 60))
  return `ลองใหม่อีก ~${minutes} นาที`
}
