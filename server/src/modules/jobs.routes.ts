// Scheduled-job endpoints for serverless hosting (Vercel Cron).
// Vercel calls these with header: Authorization: Bearer <CRON_SECRET>.
import { Router } from 'express';
import { asyncHandler, ApiError } from '../util/errors.js';
import { runDailyReports } from '../jobs/dailyReport.js';
import { runMonthlyReport } from '../jobs/monthlyReport.js';
import { runDueReminders } from './reminders.service.js';

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
    const sent = await runDueReminders();
    res.json({ ok: true, job: 'reminders', sent });
  }),
);
