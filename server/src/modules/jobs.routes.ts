// Scheduled-job endpoints for serverless hosting (Vercel Cron).
// Vercel calls these with header: Authorization: Bearer <CRON_SECRET>.
import { Router } from 'express';
import { asyncHandler, ApiError } from '../util/errors.js';
import { runDailyReports } from '../jobs/dailyReport.js';
import { runMonthlyReport } from '../jobs/monthlyReport.js';
import { runDueReminders } from './reminders.service.js';
import { runInBackground } from '../util/background.js';

export const jobsRouter = Router();

function checkCron(authHeader: string | undefined): void {
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    throw new ApiError(401, 'Sai hoặc thiếu CRON_SECRET');
  }
}

jobsRouter.get(
  '/daily',
  asyncHandler(async (req, res) => {
    checkCron(req.headers.authorization);
    await runDailyReports();
    res.json({ ok: true, job: 'daily' });
  }),
);

jobsRouter.get(
  '/monthly',
  asyncHandler(async (req, res) => {
    checkCron(req.headers.authorization);
    await runMonthlyReport();
    res.json({ ok: true, job: 'monthly' });
  }),
);

/**
 * Quét nhắc hẹn tới hạn. Gọi vài phút một lần từ dịch vụ cron ngoài
 * (Vercel gói hiện tại chỉ chạy lịch 1 lần/ngày, không đủ cho nhắc hẹn theo giờ).
 * Idempotent nhờ cột last_fired nên gọi dày cũng không gửi trùng.
 */
jobsRouter.get(
  '/reminders',
  asyncHandler(async (req, res) => {
    checkCron(req.headers.authorization);
    const batDau = Date.now();
    // Trả lời cron NGAY rồi mới làm (18/10/2026): dịch vụ cron ngoài (cron-job.org — dùng lại nếu không còn gói Vercel
    // Pro) chỉ chờ ~30 giây, trả chậm bị tính lỗi, lỗi nhiều lần nó tự tắt job — nghi là lý do nó ngừng gọi từ 15/10.
    res.json({ ok: true, job: 'reminders' });
    // Nhắc hẹn rồi Zalo → kho tri thức, chạy nền nối tiếp nhau.
    runInBackground(
      // Nhắc chấm giờ ra sau giờ tan ca (anh Tâm 22/10/2026) — mỗi người mỗi ngày một lần.
      import('./attendance.nhac.js')
        .then((m) => m.nhacChamGioRa())
        .catch((e) => console.warn('[cham-cong] nhắc giờ ra:', (e as Error).message))
        .then(() => runDueReminders())
        .catch((e) => console.warn('[reminders] quét:', (e as Error).message))
        .then(() => import('./zalo.client.js'))
        .then((z) => z.chayBanDem(batDau))
        .catch((e) => console.warn('[zalo] lượt nền:', (e as Error).message)),
    );
  }),
);
