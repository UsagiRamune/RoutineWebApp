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
ตอบกระชับ ใช้ตัวเลขจากข้อมูลจริงเท่านั้น ห้ามแต่งตัวเลขเอง ถ้าข้อมูลน้อยเกินวิเคราะห์ให้บอกตรงๆ`

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