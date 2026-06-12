// Scheduled-job endpoints for serverless hosting (Vercel Cron).
// Vercel calls these with header: Authorization: Bearer <CRON_SECRET>.
import { Router } from 'express';
import { asyncHandler, ApiError } from '../util/errors.js';
import { runDailyReports } from '../jobs/dailyReport.js';
import { runMonthlyReport } from '../jobs/monthlyReport.js';

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
