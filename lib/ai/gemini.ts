// AI provider: Gemini (ฟรี tier — 15 RPM / 500 RPD เหลือเฟือ)
//
// Health memory: จำไว้ว่าโมเดลตัวไหน "กำลัง cooldown" อยู่ใน ai_model_status (ตาราง, ไม่ migrate — ของเดิม
// มีอยู่แล้ว) กันปัญหาเดิมที่ทุก request ไล่ chain จากบนสุดใหม่ทุกครั้งแม้โมเดลแรกๆ พังซ้ำๆ ชัดเจนแล้ว
// (แต่ละ attempt ที่ fail กินเวลา ~12s เอง ไล่ 3-4 ตัวก็หลักสิบวิ ทำซ้ำได้ทุก AI call) ใช้ service-role
// client (createCronClient) ทุก context ทั้ง user route และ cron เอง กัน RLS/session เป็นตัวแปร
import { GoogleGenerativeAI, GoogleGenerativeAIAbortError, GoogleGenerativeAIFetchError, Part } from '@google/generative-ai'
import { createCronClient } from '@/lib/supabase/cron'
import { AiErrorKind, AiModelStatus } from '@/lib/supabase/types'
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
// (ไม่ใช่หลักนาทีเหมือนที่เจอจริง) — ครอบด้วย deadline รวมทั้ง call อีกชั้น (ดู OVERALL_DEADLINE_MS)
const ATTEMPT_TIMEOUT_MS = 12000
const OVERALL_DEADLINE_MS = 30000
const PROBE_TIMEOUT_MS = 8000

// cooldown ตาม consecutive_failures (ไม่มี retry hint จาก Google ให้ใช้) — ยิ่ง fail ติดกันหลายรอบ
// ยิ่งเว้นนานขึ้น กันโมเดลที่ล่มจริงจัง (เช่นโดน outage เป็นชั่วโมง) ถูกไล่ถามซ้ำถี่เกินจำเป็น
const COOLDOWN_STEPS_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 3600_000]
function cooldownForFailures(consecutiveFailures: number): number {
  const idx = Math.min(consecutiveFailures, COOLDOWN_STEPS_MS.length) - 1
  return COOLDOWN_STEPS_MS[Math.max(0, idx)]
}

// ยังไม่เคยเจอ 429 จริงตอนเขียนโค้ดนี้ (ไม่มี API key ที่ quota เต็มให้ลองสด) เลย parse แบบ defensive
// เสมอ ไม่สมมติ shape แน่นอน — Google (Vertex/Gemini API) ปกติแนบ google.rpc.RetryInfo มาใน error.details
// เป็น protobuf Duration string เช่น "30s" ถ้า shape จริงไม่ตรงนี้ก็แค่ fallback ไป cooldownForFailures()
// เฉยๆ ไม่ throw — log errorDetails ดิบไว้ด้วยทุกครั้งที่เจอ 429 เพื่อยืนยัน/แก้ parse ได้จริงจาก log บน prod
function extractRetryHintMs(err: GoogleGenerativeAIFetchError): number | null {
  const details = err.errorDetails
  if (!Array.isArray(details)) return null
  for (const d of details) {
    const type = typeof d?.['@type'] === 'string' ? (d['@type'] as string) : ''
    if (!type.toLowerCase().includes('retryinfo')) continue
    const raw = (d as Record<string, unknown>).retryDelay
    if (typeof raw === 'string') {
      const match = raw.match(/^([\d.]+)s$/)
      if (match) return Math.round(parseFloat(match[1]) * 1000)
    }
    if (typeof raw === 'number') return Math.round(raw * 1000)
  }
  return null
}

function resolveCooldownMs(retryHintMs: number | null, consecutiveFailuresAfter: number): number {
  if (retryHintMs != null) return Math.max(retryHintMs, 30_000)
  return cooldownForFailures(consecutiveFailuresAfter)
}

interface ClassifiedError {
  retryable: boolean
  kind: AiErrorKind | null
  retryHintMs: number | null
}

// error ที่ "ลองโมเดลถัดไปแล้วน่าจะรอด" — โควตา/rate-limit (429) หรือโมเดลนั้นล่ม/overload ชั่วคราว (503)
// ของเดิม (429) ไม่แตะ logic เลย ยังเช็ค err.message ประกอบด้วยเหมือนเดิม (Google เคยใส่คำว่า
// RESOURCE_EXHAUSTED ปนมาใน message ของ 429 บางเคส)
//
// ส่วน 503 — เช็คจาก @google/generative-ai's handleResponseNotOk (dist/index.js) แล้ว: SDK เก็บแค่
// response.status (ตัวเลข HTTP จริง) กับ response.statusText (reason phrase มาตรฐานของ HTTP เช่น
// "Service Unavailable") ไว้ใน err.status/err.statusText ตรงๆ ข้อความบรรยาย (เช่น "high demand") อยู่ใน
// err.message ซึ่งเป็น prose เปลี่ยนได้เรื่อยๆ เลยเช็ค err.status (ตัวเลข 503) เป็นหลักเสมอสำหรับเคสนี้
// ไม่ parse ข้อความ prose นั้น — statusText เป็น backup ได้เพราะเป็น reason phrase มาตรฐานของ HTTP
//
// 429 เองแยกเป็น 'quota' (โควตาหมดจริง — RESOURCE_EXHAUSTED/QUOTA ใน message) กับ 'rate_limit' (ยิงถี่
// เกินไปชั่วครู่ — 429 เฉยๆ ไม่มีคำนั้น) เพื่อให้ log/สถานะอ่านง่ายขึ้นว่าเจอแบบไหนบ่อย
function classifyError(err: unknown): ClassifiedError {
  if (err instanceof GoogleGenerativeAIFetchError) {
    const messageHaystack = `${err.message} ${err.statusText ?? ''}`.toUpperCase()
    const isQuotaMessage = messageHaystack.includes('RESOURCE_EXHAUSTED') || messageHaystack.includes('QUOTA')

    if (err.status === 429) {
      if (err.errorDetails) {
        console.log(`[gemini] 429 errorDetails ดิบ (debug shape จริงของ RetryInfo):`, JSON.stringify(err.errorDetails))
      }
      return { retryable: true, kind: isQuotaMessage ? 'quota' : 'rate_limit', retryHintMs: extractRetryHintMs(err) }
    }
    if (err.status === 503) return { retryable: true, kind: 'overload', retryHintMs: null }
    if (isQuotaMessage) return { retryable: true, kind: 'quota', retryHintMs: extractRetryHintMs(err) }
    if (`${err.statusText ?? ''}`.toUpperCase().includes('UNAVAILABLE')) {
      return { retryable: true, kind: 'overload', retryHintMs: null }
    }
  }
  return { retryable: false, kind: null, retryHintMs: null }
}

type CronSupabaseClient = ReturnType<typeof createCronClient>

async function loadModelStatus(supabase: CronSupabaseClient): Promise<Map<string, AiModelStatus>> {
  const map = new Map<string, AiModelStatus>()
  const { data, error } = await supabase.from('ai_model_status').select('*')
  if (error) {
    console.error('[gemini] โหลด ai_model_status ไม่สำเร็จ — เดินหน้าทั้ง chain ต่อแบบไม่มี memory:', error.message)
    return map
  }
  for (const row of (data ?? []) as AiModelStatus[]) map.set(row.model, row)
  return map
}

async function markModelSuccess(supabase: CronSupabaseClient, model: string) {
  const now = new Date().toISOString()
  const { error } = await supabase.from('ai_model_status')
    .upsert({ model, last_ok_at: now, consecutive_failures: 0, unavailable_until: null, updated_at: now },
      { onConflict: 'model' })
  if (error) console.error(`[gemini] บันทึก ai_model_status (${model}, success) ไม่สำเร็จ:`, error.message)
}

async function markModelFailure(
  supabase: CronSupabaseClient, model: string, consecutiveFailures: number, kind: AiErrorKind, cooldownMs: number
) {
  const now = new Date()
  const { error } = await supabase.from('ai_model_status').upsert({
    model,
    unavailable_until: new Date(now.getTime() + cooldownMs).toISOString(),
    last_error_kind: kind,
    last_error_at: now.toISOString(),
    consecutive_failures: consecutiveFailures,
    updated_at: now.toISOString(),
  }, { onConflict: 'model' })
  if (error) console.error(`[gemini] บันทึก ai_model_status (${model}, failure) ไม่สำเร็จ:`, error.message)
}

function isAvailable(row: AiModelStatus | undefined, now: number): boolean {
  if (!row?.unavailable_until) return true
  return new Date(row.unavailable_until).getTime() <= now
}

// core เดียวที่ทุก helper ด้านล่างเรียกผ่าน — ไล่ model ทีละตัวในลิสต์ที่ส่งมา (เว้นตัวที่กำลัง cooldown
// อยู่ตาม ai_model_status) จนกว่าจะสำเร็จ หรือหมดลิสต์ หรือเกิน deadline รวมของทั้ง call
async function callGemini(
  systemPrompt: string, parts: (string | Part)[], chain: readonly string[] = DEFAULT_CHAIN
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('ยังไม่ได้ตั้ง GEMINI_API_KEY ใน .env.local')

  const supabase = createCronClient()
  const statusMap = await loadModelStatus(supabase)
  const now = Date.now()

  const candidates = chain.filter(m => isAvailable(statusMap.get(m), now))
  const skipped = chain.filter(m => !candidates.includes(m))

  if (candidates.length === 0) {
    const earliestMs = Math.min(...chain.map(m => {
      const until = statusMap.get(m)?.unavailable_until
      return until ? new Date(until).getTime() : Infinity
    }))
    const minutes = Math.max(1, Math.ceil((earliestMs - now) / 60000))
    throw new Error(`AI โควตาเต็มชั่วคราว ลองใหม่อีก ~${minutes} นาที — กรอกเองได้`)
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const overallStart = Date.now()
  const deadline = overallStart + OVERALL_DEADLINE_MS
  let attempts = 0
  let lastKind: AiErrorKind | null = null

  for (const modelId of candidates) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    attempts++

    const perAttemptTimeout = Math.min(ATTEMPT_TIMEOUT_MS, remaining)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), perAttemptTimeout)

    try {
      const model = genAI.getGenerativeModel({ model: modelId, systemInstruction: systemPrompt })
      const result = await model.generateContent(parts, { signal: controller.signal })
      clearTimeout(timer)
      await markModelSuccess(supabase, modelId)
      console.log(`[gemini] served by ${modelId} — total ${Date.now() - overallStart}ms across ` +
        `${attempts} attempt(s)` + (skipped.length > 0 ? `, skipped (cooling): ${skipped.join(', ')}` : ''))
      return result.response.text()
    } catch (err) {
      clearTimeout(timer)
      const timedOut = err instanceof GoogleGenerativeAIAbortError
      const { retryable, kind, retryHintMs } = classifyError(err)

      // timeout ถือเป็น retryable เหมือน 429/503 เสมอ — ไม่ใช่ bug จริง แค่โมเดลนั้นช้า/ล่มตอนนี้ ส่วน error
      // อื่นที่ไม่ retryable (400/401/403 ฯลฯ) คือบั๊กจริงของเรา — throw ทันที ไม่มี cooldown เขียนลง DB
      if (!timedOut && !retryable) {
        console.log(`[gemini] total time: ${Date.now() - overallStart}ms across ${attempts} attempt(s) (failed, non-retryable)`)
        throw err
      }

      const effectiveKind: AiErrorKind = timedOut ? 'timeout' : (kind ?? 'overload')
      lastKind = effectiveKind
      const consecutiveFailures = (statusMap.get(modelId)?.consecutive_failures ?? 0) + 1
      const cooldownMs = resolveCooldownMs(timedOut ? null : retryHintMs, consecutiveFailures)
      await markModelFailure(supabase, modelId, consecutiveFailures, effectiveKind, cooldownMs)

      console.log(`[gemini] ${modelId} ${timedOut
        ? `หมดเวลารอ (เกิน ${perAttemptTimeout}ms)`
        : `error (${effectiveKind})`} — cooldown ${Math.round(cooldownMs / 1000)}s — ลองรุ่นถัดไป`)
    }
  }

  console.log(`[gemini] total time: ${Date.now() - overallStart}ms across ${attempts} attempt(s) (all failed/cooling)` +
    (skipped.length > 0 ? `, skipped from start: ${skipped.join(', ')}` : ''))
  throw new Error(`โมเดล Gemini ที่ลองได้ทั้งหมด${lastKind ? ` (${lastKind})` : ''}ไม่พร้อมใช้งานตอนนี้ (${chain.join(', ')}) ลองใหม่อีกครั้งภายหลัง`)
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

// ---------- status (ให้ route /api/ai/status อ่านไปโชว์ UI) ----------

export interface AiModelStatusView { model: string; available: boolean; until: string | null }
export interface AiStatusSummary { models: AiModelStatusView[]; anyAvailable: boolean; nextRetrySec: number | null }

// อ่าน ai_model_status อย่างเดียว ไม่เรียก Gemini เลย — ใช้โชว์/ซ่อนปุ่ม AI ในหน้า UI เท่านั้น
export async function getAiStatus(chain: readonly string[] = DEFAULT_CHAIN): Promise<AiStatusSummary> {
  const supabase = createCronClient()
  const statusMap = await loadModelStatus(supabase)
  const now = Date.now()

  const models = chain.map(m => {
    const row = statusMap.get(m)
    const available = isAvailable(row, now)
    return { model: m, available, until: available ? null : (row?.unavailable_until ?? null) }
  })

  const anyAvailable = models.some(m => m.available)
  const nextRetrySec = anyAvailable ? null : Math.max(0, Math.ceil(
    (Math.min(...models.map(m => m.until ? new Date(m.until).getTime() : Infinity)) - now) / 1000
  ))
  return { models, anyAvailable, nextRetrySec }
}

// ---------- bounded entry-time probe (ให้ route /api/ai/warm เรียก) ----------

const PROBE_INTERVAL_MS = 15 * 60_000
const PROBE_STALE_MS = 30 * 60_000

// เรียกครั้งละไม่เกิน 1 โมเดลเสมอ ไม่วน loop หลาย chain เด็ดขาด — เป้าหมายแค่ "เช็คไว้ก่อน" ไม่ใช่ sync
// สถานะทั้งหมดให้ครบ (นั่นเป็นหน้าที่ของ callGemini ตอนมีงานจริงอยู่แล้ว)
export async function warmProbe(): Promise<AiStatusSummary> {
  const supabase = createCronClient()

  const { data: settings } = await supabase.from('app_settings')
    .select('ai_last_probe_at').eq('id', 1).maybeSingle()
  const lastProbeMs = settings?.ai_last_probe_at ? new Date(settings.ai_last_probe_at).getTime() : null
  const now = Date.now()

  if (lastProbeMs != null && now - lastProbeMs < PROBE_INTERVAL_MS) {
    return getAiStatus()
  }

  const statusMap = await loadModelStatus(supabase)
  const target = DEFAULT_CHAIN.find(m => {
    const row = statusMap.get(m)
    if (!isAvailable(row, now)) return false
    const lastOkMs = row?.last_ok_at ? new Date(row.last_ok_at).getTime() : null
    return lastOkMs == null || now - lastOkMs > PROBE_STALE_MS
  })

  await supabase.from('app_settings').update({ ai_last_probe_at: new Date(now).toISOString() }).eq('id', 1)

  if (!target) return getAiStatus()

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return getAiStatus()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: target, generationConfig: { maxOutputTokens: 8 } })
    await model.generateContent('ok', { signal: controller.signal })
    await markModelSuccess(supabase, target)
  } catch (err) {
    const timedOut = err instanceof GoogleGenerativeAIAbortError
    const { retryable, kind, retryHintMs } = classifyError(err)
    if (timedOut || retryable) {
      const effectiveKind: AiErrorKind = timedOut ? 'timeout' : (kind ?? 'overload')
      const consecutiveFailures = (statusMap.get(target)?.consecutive_failures ?? 0) + 1
      const cooldownMs = resolveCooldownMs(timedOut ? null : retryHintMs, consecutiveFailures)
      await markModelFailure(supabase, target, consecutiveFailures, effectiveKind, cooldownMs)
    }
    // error ไม่ retryable ตอน probe (เช่น API key ผิด) ไม่ throw ต่อ — endpointนี้แค่รายงานสถานะ ไม่ใช่
    // critical path ของ flow ไหนเลย ปล่อยให้ callGemini ของงานจริงเจอ/throw เองตอนถูกเรียกใช้จริง
  } finally {
    clearTimeout(timer)
  }

  return getAiStatus()
}
