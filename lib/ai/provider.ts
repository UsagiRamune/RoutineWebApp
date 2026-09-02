// interface กลางสำหรับ AI provider ที่ใช้วิเคราะห์กิจวัตร
export interface AnalyzeInput {
  periodLabel: string      // เช่น "7 วันล่าสุด"
  summary: string          // ข้อมูลที่ย่อยแล้วเป็น text พร้อมส่งให้โมเดล
}

export interface AiProvider {
  analyzeRoutine(input: AnalyzeInput): Promise<string>
}