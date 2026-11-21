// Chạy MTJOB trên máy chủ riêng (Coolify của MT DIGITAL — anh Tâm 21/11/2026: "deploy toàn bộ app lên nền tảng mới").
// Một tiến trình làm đủ việc Vercel đang làm:
//  - API Express (giống api/index.ts) + giao diện web đã build (web/dist) + chuyển mọi đường dẫn khác về index.html;
//  - cron giống HỆT vercel.json (giờ UTC), gọi chính các đường /api/jobs/* bằng CRON_SECRET như Vercel Cron gọi.
// Cron CHỈ chạy khi CRON_ENABLED=1 — lúc chạy thử song song với Vercel phải tắt, không thì nhắc hẹn / Zalo / AI chạy hai lần.
// Vercel vẫn dùng api/index.ts; file này không ảnh hưởng gì tới Vercel.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cron from 'node-cron';
import { createApp } from './http/app.js';

const port = Number(process.env.PORT || 3000);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

const app = createApp();

app.use(
  express.static(dist, {
    index: false,
    setHeaders: (res, file) => {
      // sw.js không được cache (như headers trong vercel.json); tệp trong assets/ có mã băm → cache lâu.
      if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
      else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }),
);
// Ứng dụng một trang: mọi đường không phải /api → index.html (như rewrites trong vercel.json).
app.get(/^(?!\/api(\/|$)).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(dist, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`[MTJOB] chạy tại cổng ${port} — cron ${process.env.CRON_ENABLED === '1' ? 'BẬT' : 'TẮT (CRON_ENABLED khác 1)'}`);
  if (process.env.CRON_ENABLED === '1') batCron();
});

/** Lịch như vercel.json (UTC): nhắc hẹn mỗi phút, báo cáo ngày 10:15, tổng kết tháng 01:30 ngày 1. */
function batCron(): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] thiếu CRON_SECRET — không bật cron');
    return;
  }
  const goi = (duong: string) =>
    fetch(`http://127.0.0.1:${port}/api/jobs/${duong}`, { headers: { Authorization: `Bearer ${secret}` } })
      .then((r) => {
        if (!r.ok) console.warn(`[cron] ${duong} → ${r.status}`);
      })
      .catch((e) => console.warn(`[cron] ${duong}:`, (e as Error).message));
  const lich: Array<[string, string]> = [
    ['* * * * *', 'reminders'],
    ['15 10 * * *', 'daily'],
    ['30 1 1 * *', 'monthly'],
  ];
  for (const [bieuThuc, duong] of lich) cron.schedule(bieuThuc, () => void goi(duong), { timezone: 'Etc/UTC' });
  console.log('[cron] đã bật: reminders mỗi phút, daily 10:15 UTC, monthly 01:30 UTC ngày 1');
}
