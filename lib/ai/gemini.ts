// AI provider: Gemini (ฟรี tier — 15 RPM / 500 RPD เหลือเฟือ)
import { GoogleGenerativeAI } from '@google/generative-ai'
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
ห้ามตีความว่าเป็นพลังงานที่ใช้ทั้งวัน ถ้าตัวเลขนี้ไม่ชัวร์ ให้ใช้ขอบล่างสุดที่เป็นไปได้เวลาคิดเรื่อง deficit/surplus`

export const geminiProvider: AiProvider = {
  async analyzeRoutine({ periodLabel, summary }: AnalyzeInput): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('ยังไม่ได้ตั้ง GEMINI_API_KEY ใน .env.local')

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.5-flash-lite',
      systemInstruction: SYSTEM_PROMPT,
    })

    const result = await model.generateContent(
      `ข้อมูล routine ช่วง${periodLabel}:\n\n${summary}`
    )
    return result.response.text()
  },
}

// helper ทั่วไป: ส่ง system prompt + ข้อความ แล้วพอร์สคำตอบเป็น JSON (ลอกรั้ว ```json ... ``` ออกก่อน)
export async function generateJson<T = unknown>(systemPrompt: string, userText: string): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('ยังไม่ได้ตั้ง GEMINI_API_KEY ใน .env.local')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash-lite',
    systemInstruction: systemPrompt,
  })

  const result = await model.generateContent(userText)
  const raw = result.response.text().trim()
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(cleaned) as T
}