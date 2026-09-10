// อัปโหลดไฟล์ GDD (.pdf/.docx) → ดึงข้อความดิบ → ให้ AI จัดรูปแบบเป็น markdown → เซฟเป็น project_docs แถวใหม่
import { createClient } from '@/lib/supabase/server'
import { generateMarkdown } from '@/lib/ai/gemini'
import { NextResponse } from 'next/server'

const MAX_CHARS = 40000
const MAX_FILE_BYTES = 20 * 1024 * 1024

export const runtime = 'nodejs' // pdf-parse/mammoth ใช้ Node API (Buffer, fs) — รันบน Edge ไม่ได้
export const maxDuration = 60

const SYSTEM_PROMPT = 'จัดรูปแบบเอกสารนี้ให้เป็น markdown ที่อ่านง่าย คงเนื้อหาเดิมทั้งหมดไว้ครบถ้วน ' +
  'จัดหัวข้อ/bullet ให้เหมาะสม ห้ามสรุปย่อหรือตัดเนื้อหาออก ห้ามเติมเนื้อหาที่ไม่มีในต้นฉบับ ' +
  'ตัวเลข สูตร ลิงก์ และเปอร์เซ็นต์ทุกตัวต้องตรงกับต้นฉบับเป๊ะๆ ห้ามพิมพ์ผิดหรือปัดเศษ\n\n' +
  'ข้อความที่เป็น "ขยะจากการแบ่งหน้า" ของไฟล์ต้นฉบับ (ไม่ใช่เนื้อหาจริง) ให้ตัดทิ้ง ได้แก่:\n' +
  '- ตัวเลขหน้า/บอกหน้าซ้ำๆ แบบ "-- N of M --", "หน้า N", "N/M" ที่ท้ายแต่ละหน้า\n' +
  '- หัวกระดาษ/ชื่อเรื่องที่ขึ้นซ้ำคำต่อคำในทุกหน้า (running header/footer)\n' +
  '- สารบัญที่มีจุดไข่ปลาคั่นระหว่างหัวข้อกับเลขหน้า (เช่น "บทที่ 1 บทนำ .......... 5") ' +
  'ให้เก็บแค่ข้อความหัวข้อไว้ ตัดจุดไข่ปลาและเลขหน้าออก\n\n' +
  'โครงสร้างหัวข้อ: ถ้าต้นฉบับมีระบบเลขหัวข้อของตัวเอง (เช่น "1.", "1.1", "1.1.1") ให้แปลงเป็นลำดับชั้น ' +
  'markdown heading ให้ตรงกับความลึกจริง — เลขชั้นเดียว (1., 2.) → "##", สองชั้น (1.1) → "###", ' +
  'สามชั้น (1.1.1) → "####" อย่าปล่อยเป็นข้อความแบนราบทั้งที่ต้นฉบับมีลำดับชั้นชัดเจน'

async function extractText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const name = file.name.toLowerCase()

  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await parser.getText()
      return result.text
    } finally {
      await parser.destroy()
    }
  }

  if (name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  throw new Error('UNSUPPORTED_TYPE')
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, { status: 401 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const projectId = form?.get('project_id')
  const titleInput = form?.get('title')

  if (!(file instanceof File) || typeof projectId !== 'string' || !projectId) {
    return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'ไฟล์ใหญ่เกิน 20MB ลองบีบอัดหรือแบ่งเป็นหลายไฟล์' }, { status: 400 })
  }

  let rawText: string
  try {
    rawText = await extractText(file)
  } catch (err) {
    if (err instanceof Error && err.message === 'UNSUPPORTED_TYPE') {
      return NextResponse.json({ error: 'รองรับเฉพาะไฟล์ .pdf หรือ .docx เท่านั้น' }, { status: 400 })
    }
    console.error('gdd extract error:', err)
    return NextResponse.json({ error: 'อ่านไฟล์ไม่สำเร็จ ลองใหม่อีกทีหรือลองไฟล์อื่น' }, { status: 500 })
  }

  rawText = rawText.trim()
  if (!rawText) {
    return NextResponse.json({ error: 'ไม่พบข้อความในไฟล์นี้' }, { status: 400 })
  }

  let truncated = false
  if (rawText.length > MAX_CHARS) {
    rawText = rawText.slice(0, MAX_CHARS)
    truncated = true
  }

  let content: string
  try {
    content = await generateMarkdown(SYSTEM_PROMPT, rawText)
  } catch (err) {
    console.error('gdd format error:', err)
    return NextResponse.json({ error: 'จัดรูปแบบเอกสารไม่สำเร็จ ลองใหม่อีกที' }, { status: 500 })
  }
  if (truncated) {
    content += '\n\n---\n*(เอกสารต้นฉบับยาวเกินไป ตัดไว้ที่ ~40,000 ตัวอักษรแรก)*'
  }

  const fallbackTitle = file.name.replace(/\.(pdf|docx)$/i, '')
  const title = (typeof titleInput === 'string' && titleInput.trim()) || fallbackTitle

  const { data, error } = await supabase.from('project_docs').insert({
    project_id: projectId,
    title,
    content,
    source_type: 'upload',
    original_filename: file.name,
    updated_at: new Date().toISOString(),
  }).select().single()

  if (error) {
    console.error('gdd insert error:', error)
    return NextResponse.json({ error: 'บันทึกเอกสารไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({ doc: data })
}
