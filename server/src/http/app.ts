import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { ApiError } from '../util/errors.js';
import { authRouter } from '../modules/auth.routes.js';
import { tasksRouter } from '../modules/tasks.routes.js';
import { scoresRouter } from '../modules/scores.routes.js';
import { attendanceRouter } from '../modules/attendance.routes.js';
import { requestsRouter } from '../modules/requests.routes.js';
import { payrollRouter } from '../modules/payroll.routes.js';
import { notificationsRouter } from '../modules/notifications.routes.js';
import { adminRouter } from '../modules/admin.routes.js';
import { chatRouter } from '../modules/chat.routes.js';
import { oauthRouter } from '../modules/oauth.routes.js';
import { jobsRouter } from '../modules/jobs.routes.js';
import { financeRouter } from '../modules/finance.routes.js';
import { crmRouter } from '../modules/crm.routes.js';
import { customerNotesRouter } from '../modules/customerNotes.routes.js';
import { brainRouter } from '../modules/brain.routes.js';
import { remindersRouter } from '../modules/reminders.routes.js';
import { calendarRouter } from '../modules/calendar.routes.js';
import { projectsRouter } from '../modules/projects.routes.js';
import { teamMembersRouter } from '../modules/team.members.routes.js';
import { sweepRemindersOpportunistic } from '../modules/reminders.service.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  // Health + config diagnostics (booleans only — never leak secret values).
  app.get('/api/health', async (_req, res) => {
    const { aiAvailable } = await import('../ai/index.js');
    // Giữ tên trường `gemini` cho tương thích ngược với UI cũ; nghĩa là "trợ lý AI đang bật".
    const gemini = await aiAvailable().catch(() => false);
    res.json({
      ok: true,
      ts: Date.now(),
      env: {
        databaseUrl: !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
        jwtSecret: !!process.env.JWT_SECRET,
        vapid: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
        cronSecret: !!process.env.CRON_SECRET,
        gemini,
      },
    });
  });

  // Nhắc hẹn cần độ phân giải theo GIỜ, nhưng Vercel Cron gói hiện tại chỉ chạy 1 lần/ngày.
  // Nên bám vào chính lưu lượng người dùng: mọi request đều thử quét một lượt.
  //
  // Trước đây chỉ móc ở /api/chat — hẹn buổi tối, lúc không ai chat, thì hết cửa sổ bù
  // 3 tiếng là mất luôn. Giờ mở app, bấm chuông, đổi trang… đều kích hoạt.
  // Rẻ và an toàn: throttle 5 phút mỗi instance, chạy nền không giữ response, và
  // idempotent nhờ cột last_fired nên gọi chồng nhau cũng không gửi trùng.
  app.use('/api', (_req, _res, next) => {
    sweepRemindersOpportunistic();
    next();
  });

  app.use('/api/auth', authRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/scores', scoresRouter);
  app.use('/api/attendance', attendanceRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api/payroll', payrollRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/finance', financeRouter);
  app.use('/api/crm', crmRouter);
  app.use('/api/customer-notes', customerNotesRouter);
  app.use('/api/brain', brainRouter);
  app.use('/api/reminders', remindersRouter);
  app.use('/api/calendar', calendarRouter);
  app.use('/api/projects', projectsRouter);
  // Leader lập tài khoản cho phòng mình. Tách hẳn khỏi /api/admin — xem ghi chú trong file.
  app.use('/api/team', teamMembersRouter);
  app.use('/api/oauth2', oauthRouter);
  app.use('/api/jobs', jobsRouter);

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'Dữ liệu không hợp lệ', details: err.issues });
      return;
    }
    const status = err instanceof ApiError ? err.status : 500;
    if (status >= 500) console.error('[API error]', err);
    res.status(status).json({ error: (err as Error)?.message || 'Lỗi máy chủ' });
  };
  app.use(errorHandler);

  return app;
}
