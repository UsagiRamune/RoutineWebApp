// แปลง markdown ธรรมดา (heading, bold, bullet list, paragraph) เป็น HTML สำหรับอีเมล
// รองรับแค่ syntax ที่ SYSTEM_PROMPT ของ analyzeRoutine ผลิตออกมาจริง ไม่ใช่ markdown parser เต็มรูปแบบ
import { escapeHtml } from './template'

export function simpleMarkdownToHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inList = false

  const closeList = () => { if (inList) { out.push('</ul>'); inList = false } }
  const inlineMd = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') { closeList(); continue }

    const heading = line.match(/^#{1,3}\s+(.*)/)
    const item = line.match(/^[-*]\s+(.*)/)

    if (heading) {
      closeList()
      out.push(`<h3 style="margin:16px 0 6px;font-size:15px;color:#EDEAE0;">${inlineMd(heading[1])}</h3>`)
    } else if (item) {
      if (!inList) { out.push('<ul style="margin:4px 0;padding-left:20px;">'); inList = true }
      out.push(`<li style="margin:2px 0;">${inlineMd(item[1])}</li>`)
    } else {
      closeList()
      out.push(`<p style="margin:0 0 8px;">${inlineMd(line)}</p>`)
    }
  }
  closeList()
  return out.join('\n')
}
