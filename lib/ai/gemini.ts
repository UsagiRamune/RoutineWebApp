// AI provider: Gemini (ฟรี tier — 15 RPM / 500 RPD เหลือเฟือ)
import { GoogleGenerativeAI, GoogleGenerativeAIAbortError, GoogleGenerativeAIFetchError, Part } from '@google/generative-ai'
import { AiProvider, AnalyzeInput } from './provider'

const SYSTEM_PROMPT = `คุณคือโค้ชวิเคราะห์ routine ส่วนตัว วิเคราะห์ข้อมูลที่ได้รับแล้วตอบเป็นภาษาไทย
โครงสร้างคำตอบ:
1. ภาพรวม (2-3 ประโยค ตรงไปตรงมา ไม่ต้องอวย)
2. สิ่งที่ทำได้ดี (ถ้ามี)
3. จุดที่หลุด/ต่ำกว่าเป้า พร้อมตัวเลขอ้างอิง
4. pattern ที่น่าสนใจ (ความสัมพันธ์ระหว่างหมวด, วันที่มักหลุด, ช่วงเวลาที่ productive)
5. ข้อเสนอ 2-3 อย่างที่ทำได้จริงสัปดาห์หน้า (เจาะจง ไม่ใช่คำแนะนำลอยๆ)
ตอบกระชับ ใช้ตัวเลขจากข้อมูลจริงเท่านั้น ห้ามแต่งตัวเลขเอง ถ้าข้อมูลน้อยเกินวิเคราะห์ให้บอกตรงๆ
ถ้ามีข้อมูลกิจกรรม (ก้าว/แคลจากกิจกรรม) ให้เทียบกับปริมาณอาหารที่กินและการทำ routine เพื่อหา pattern
(เช่น วันที่เดินเยอะกินเยอะ หรือวันที่ไม่ได้ทำ routine เดินน้อยกว่าปกติ) และประเมินแบบระวังสุดเสมอ —
ตัวเลข kcal เป็นค่าที่ผู้ใช้กรอกเองจากแอปนาฬิกา ("active calories") เท่านั้น ไม่รวมการเผาผลาญพื้นฐาน (BMR)
ห้ามตีความว่าเป็นพลังงานที่ใช้ทั้งวัน ถ้าตัวเลขนี้ไม่ชัวร์ ให้ใช้ขอบล่างสุดที่เป็นไปได้เวลาคิดเรื่อง deficit/surplus
ถ้ามีตัวเลข "TDEE ประมาณ" (BMR + แคลจากกิจกรรม) ต่อวัน ให้ถือเป็นข้อมูลอ้างอิงบริบทพลังงานเสริมเท่านั้น
ห้ามเอาไปรวม/หักลบกับเป้าคุมอาหาร (diet target) เพื่อสร้างเลข "เหลืออีกกี่ kcal" ตัวเดียวเด็ดขาด — รายงานกิน
เทียบเป้าคุมอาหาร และกินเทียบ TDEE ประมาณ เป็นสองข้อสังเกตแยกกันเสมอ ไม่ผสมกัน
ถ้ามีข้อมูลโปรเจกต์ (คืบหน้า %, จำนวน task ที่เสร็จ, ชั่วโมงที่ track จาก routine ที่ผูกไว้) ให้เทียบชั่วโมงที่ลงกับ
task ที่เสร็จจริง ถ้าชั่วโมงเยอะแต่ task เสร็จน้อย (หรือกลับกัน) ให้ตั้งข้อสังเกตไว้ตรงๆ ว่าตัวเลขไม่ match กัน
โดยรายงานแค่ข้อเท็จจริงจากตัวเลข ห้ามตัดสินหรือสรุปสาเหตุเอง (อาจเป็นเพราะ task ใหญ่ใช้เวลานาน ไม่ใช่ทำงานไม่มีประสิทธิภาพ)`

// เรียงจากรุ่นใหม่/ฉลาดสุดไปเก่าสุด — ยืนยัน id ตรงกับ https://ai.google.dev/gemini-api/docs/models
// แล้ว (เช็คสด ก.ย. 2026) ไม่ได้เดา ถ้าโดน quota/rate-limit (429) ไล่ตัวถัดไปในลิสต์ ถ้า error อื่น
// (เช่น prompt ผิด, JSON parse พัง) ถือเป็นบั๊กจริง ไม่ fallback ปล่อยขึ้นไปให้ route จัดการเอง
const DEFAULT_CHAIN = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
] as const

// งาน background/cron (วิเคราะห์ routine) เดิม hardcode ไว้ที่ตัวเบาสุด (flash-lite) โดยตั้งใจ — เริ่ม
// ที่ตัวเดิมนั้นก่อนเสมอ (ประหยัด/พอสำหรับงานนี้) แล้วค่อยไล่ที่เหลือของ DEFAULT_CHAIN ต่อถ้าโควตาเต็ม
const BACKGROUND_CHAIN = [
  'gemini-3.5-flash-lite',
  ...DEFAULT_CHAIN.filter(m => m !== 'gemini-3.5-flash-lite'),
] as const

// เจอเคสจริง: 3.8-flash → 503 → 3.7-flash → 503 → 3.6-flash → สำเร็จ รวม 2.8 นาที เพราะแต่ละ attempt
// ไม่มี timeout ของตัวเอง ปล่อยรอ Google ตอบ 503 นานแค่ไหนก็ได้ก่อนจะ fallback — ตั้ง cap ต่อโมเดลไว้
// ~12 วิ: หลวมพอสำหรับ response ปกติตอนโหลดไม่หนัก แต่สั้นพอให้ 3-5 ครั้งติดกันยังรวมกันไม่เกิน ~30-45 วิ
// (ไม่ใช่หลักนาทีเหมือนที่เจอจริง)
const ATTEMPT_TIMEOUT_MS = 12000

// error ที่ "ลองโมเดลถัดไปแล้วน่าจะรอด" — โควตา/rate-limit (429) หรือโมเดลนั้นล่ม/overload ชั่วคราว (503)
// ของเดิม (429) ไม่แตะ logic เลย ยังเช็ค err.message ประกอบด้วยเหมือนเดิม (Google เคยใส่คำว่า
// RESOURCE_EXHAUSTED ปนมาใน message ของ 429 บางเคส)
//
// ส่วน 503 ที่เพิ่มใหม่ — เช็คจาก @google/generative-ai's handleResponseNotOk (dist/index.js) แล้ว:
// SDK เก็บแค่ response.status (ตัวเลข HTTP จริง) กับ response.statusText (reason phrase มาตรฐานของ
// HTTP เช่น "Service Unavailable") ไว้ใน err.status/err.statusText ตรงๆ — ไม่ได้แกะ json.error.status
// (enum แบบ "UNAVAILABLE" ของ Google) ออกมาเป็น field แยกเลย ข้อความบรรยาย (เช่น "high demand") อยู่ใน
// err.message ซึ่งเป็น prose เปลี่ยนได้เรื่อยๆ เลยเช็ค err.status (ตัวเลข 503) เป็นหลักเสมอสำหรับเคสนี้
// ไม่ parse ข้อความ prose นั้น — statusText เป็น backup ได้เพราะเป็น reason phrase มาตรฐานของ HTTP
// ไม่ใช่ prose เฉพาะของ Google ที่จะเปลี่ยนบ่อย
function isRetryableError(err: unknown): boolean {
  if (err instanceof GoogleGenerativeAIFetchError) {
    if (err.status === 429 || err.status === 503) return true

    const messageHaystack = `${err.message} ${err.statusText ?? ''}`.toUpperCase()
    if (messageHaystack.includes('RESOURCE_EXHAUSTED') || messageHaystack.includes('QUOTA')) return true

    const statusTextOnly = `${err.statusText ?? ''}`.toUpperCase()
    if (statusTextOnly.includes('UNAVAILABLE')) return true
  }
  return false
}

// core เดียวที่ทุก helper ด้านล่างเรียกผ่าน — ไล่ model ทีละตัวในลิสต์ที่ส่งมาจนกว่าจะสำเร็จ หรือหมดลิสต์
async function callGemini(
  systemPrompt: string, parts: (string | Part)[], chain: readonly string[] = DEFAULT_CHAIN
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('ยังไม่ได้ตั้ง GEMINI_API_KEY ใน .env.local')

  const genAI = new GoogleGenerativeAI(apiKey)
  const overallStart = Date.now()
  let attempts = 0
  let timeoutCount = 0

  for (const modelId of chain) {
    attempts++
    // AbortController ต่อ attempt — ยิง .abort() เองถ้าเกิน ATTEMPT_TIMEOUT_MS ไม่รอ Google ตอบเท่าไหร่
    // ก็ได้แบบเดิม (SDK จับ AbortError แล้วห่อเป็น GoogleGenerativeAIAbortError ให้เองอยู่แล้ว)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS)

    try {
      const model = genAI.getGenerativeModel({ model: modelId, systemInstruction: systemPrompt })
      const result = await model.generateContent(parts, { signal: controller.signal })
      console.log(`[gemini] served by ${modelId}`) // log ไว้ดูเองว่ารุ่นไหนรับงานจริง ไม่โชว์ผู้ใช้
      console.log(`[gemini] total time: ${Date.now() - overallStart}ms across ${attempts} attempt(s)`)
      return result.response.text()
    } catch (err) {
      const timedOut = err instanceof GoogleGenerativeAIAbortError
      if (timedOut) timeoutCount++

      // timeout ถือเป็น retryable เหมือน 429/503 เสมอ — ไม่ใช่ bug จริง แค่โมเดลนั้นช้า/ล่มตอนนี้
      if (timedOut || isRetryableError(err)) {
        console.log(`[gemini] ${modelId} ${timedOut
          ? `หมดเวลารอ (เกิน ${ATTEMPT_TIMEOUT_MS}ms)`
          : 'โควตาเต็ม/rate-limit/overload ชั่วคราว'} — ลองรุ่นถัดไป`)
        continue
      }
      console.log(`[gemini] total time: ${Date.now() - overallStart}ms across ${attempts} attempt(s) (failed)`)
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  console.log(`[gemini] total time: ${Date.now() - overallStart}ms across ${attempts} attempt(s) (all failed)`)
  // แยกข้อความให้รู้ว่า "หมดเวลารอ" ล้วนๆ หรือปนกับสาเหตุอื่น (โควตา/overload) — แค่เผื่อ debug ง่ายขึ้น
  const reason = timeoutCount === chain.length
    ? `หมดเวลารอ (เกิน ${ATTEMPT_TIMEOUT_MS}ms ต่อครั้ง)`
    : 'โควตาเต็ม/ล่มชั่วคราว/หมดเวลารอ'
  throw new Error(`โมเดล Gemini ทุกตัว${reason}พร้อมกัน (${chain.join(', ')}) ลองใหม่อีกครั้งภายหลัง`)
}

export const geminiProvider: AiProvider = {
  async analyzeRoutine({ periodLabel, summary }: AnalyzeInput): Promise<string> {
    // cron/background — ใช้ BACKGROUND_CHAIN (เริ่มจาก flash-lite) ไม่ใช่ DEFAULT_CHAIN ของ path อื่น
    return callGemini(SYSTEM_PROMPT, [`ข้อมูล routine ช่วง${periodLabel}:\n\n${summary}`], BACKGROUND_CHAIN)
  },
}

// helper ทั่วไป: ส่ง system prompt + ข้อความ แล้วพอร์สคำตอบเป็น JSON (ลอกรั้ว ```json ... ``` ออกก่อน)
export async function generateJson<T = unknown>(systemPrompt: string, userText: string): Promise<T> {
  const raw = (await callGemini(systemPrompt, [userText])).trim()
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(cleaned) as T
}

// เหมือน generateJson แต่แนบรูปเป็น inline data คู่กับ prompt ข้อความ (ใช้กับ photo food estimate)
export async function generateJsonWithImage<T = unknown>(
  systemPrompt: string, userText: string, image: { mimeType: string; base64: string }
): Promise<T> {
  const raw = (await callGemini(systemPrompt, [
    userText,
    { inlineData: { mimeType: image.mimeType, data: image.base64 } },
  ])).trim()
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(cleaned) as T
}

// helper ทั่วไป: ส่ง system prompt + ข้อความ แล้วคืนข้อความ markdown ดิบๆ (ไม่พาร์ส JSON)
export async function generateMarkdown(systemPrompt: string, userText: string): Promise<string> {
  const raw = await callGemini(systemPrompt, [userText])
  return raw.trim().replace(/^```(?:markdown)?\s*/i, '').replace(/```\s*$/, '').trim()
}
