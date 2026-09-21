// AI provider: Gemini (ฟรี tier — 15 RPM / 500 RPD เหลือเฟือ)
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError, Part } from '@google/generative-ai'
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

function isQuotaError(err: unknown): boolean {
  if (err instanceof GoogleGenerativeAIFetchError) {
    if (err.status === 429) return true
    const haystack = `${err.message} ${err.statusText ?? ''}`.toUpperCase()
    if (haystack.includes('RESOURCE_EXHAUSTED') || haystack.includes('QUOTA')) return true
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

  for (const modelId of chain) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId, systemInstruction: systemPrompt })
      const result = await model.generateContent(parts)
      // log ไว้ดูเองว่ารุ่นไหนรับงานจริง ไม่โชว์ผู้ใช้
      console.log(`[gemini] served by ${modelId}`)
      return result.response.text()
    } catch (err) {
      if (isQuotaError(err)) {
        console.log(`[gemini] ${modelId} โควตาเต็ม/rate-limit — ลองรุ่นถัดไป`)
        continue
      }
      throw err
    }
  }

  throw new Error(`โมเดล Gemini ทุกตัวโควตาเต็มพร้อมกัน (${chain.join(', ')}) ลองใหม่อีกครั้งภายหลัง`)
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
