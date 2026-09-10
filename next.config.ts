import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    experimental: {
    serverActions: { bodySizeLimit: '25mb' },
    // middleware.ts รันก่อนทุก request รวมถึง route handler — ต้อง clone request body ผ่าน
    // middleware ไปด้วย ค่า default 10MB ของ Next.js เลยกันไฟล์อัปโหลดใหญ่ (เช่น GDD .pdf/.docx)
    // ไม่ให้ไปถึง route handler เลย ต้องยกขีดจำกัดนี้แยกจาก serverActions.bodySizeLimit ด้านบน
    proxyClientMaxBodySize: '25mb',
  },
    // pdf-parse (pdfjs-dist) ตั้ง worker ของตัวเองด้วย relative dynamic import ("./pdf.worker.mjs")
    // ที่ resolve เทียบกับตำแหน่งไฟล์ตอนรัน — ถ้า Turbopack เอาไป bundle จะย้ายไฟล์จริงไปอยู่ที่อื่น
    // (.next/dev/server/chunks/...) ทำให้ relative import หาไฟล์ worker ไม่เจอ ("Setting up fake worker
    // failed") ต้องกันไม่ให้ Turbopack แตะแพ็กเกจนี้เลย ให้ require() ตรงจาก node_modules ตอนรันแทน
    serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
};

export default nextConfig;
