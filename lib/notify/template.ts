// เทมเพลต HTML อีเมลกลาง — ธีมเดียวกับแอป, inline CSS ทั้งหมด (ไม่พึ่ง external stylesheet/รูป)
export function emailTemplate({ heading, bodyHtml }: { heading: string; bodyHtml: string }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#14171F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:24px 16px;">
      <div style="background:#1B1F2A;border:1px solid #2A2F3D;border-radius:16px;padding:24px;">
        <h1 style="margin:0 0 16px;font-size:20px;color:#EDEAE0;">${heading}</h1>
        <div style="font-size:14px;line-height:1.6;color:#EDEAE0;">
          ${bodyHtml}
        </div>
      </div>
      <p style="text-align:center;margin:16px 0 0;font-size:12px;color:#7C8394;">
        <a href="https://atikun-allrounder.vercel.app" style="color:#4FC1E0;text-decoration:none;">All-Rounder</a>
      </p>
    </div>
  </body>
</html>`
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
