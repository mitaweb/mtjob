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
    // Việc tự động (học Javis, 11/11/2026): chạy SONG SONG chuỗi dưới — một việc có thể mất vài phút (AI tra nhiều hàm).
    runInBackground(
      import('./viecTuDong.service.js')
        .then((m) => m.chayViecTuDong())
        .catch((e) => console.warn('[viec-tu-dong] lượt:', (e as Error).message))
        // Kết nối MCP (11/11/2026): số Meta / Google Ads / GA4 / Search Console của tài sản đang theo dõi, 6 tiếng / lần.
        .then(() => import('./nenTang.service.js'))
        .then((n) => n.dongBoNenTang(batDau + 240_000))
        .catch((e) => console.warn('[nen-tang] đồng bộ:', (e as Error).message)),
    );
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
        .catch((e) => console.warn('[zalo] lượt nền:', (e as Error).message))
        // Bộ não hiểu anh Tâm (9/11/2026): học từ tin anh gửi + câu anh nói với trợ lý — tự giãn ≥ 30 phút / lượt.
        .then(() => import('./hieuAnh.service.js'))
        .then((h) => h.hocVeAnh(batDau + 200_000))
        .catch((e) => console.warn('[hieu-anh] lượt học:', (e as Error).message))
        // Mục kho chưa có đoạn tìm kiếm (Gemini hết lượt lúc lưu — anh Tâm 11/11/2026) → mã hoá bù dần.
        .then(() => import('./brainItems.service.js'))
        .then((b) => b.boSungDoanThieu())
        .catch((e) => console.warn('[brain] bổ sung đoạn:', (e as Error).message))
        // Fanpage (11/11/2026): bình luận mới → AI soạn trả lời chờ anh duyệt (tự giãn 15 phút / lượt).
        .then(() => import('./fanpage.service.js'))
        .then((f) => f.quetBinhLuan())
        .catch((e) => console.warn('[fanpage] quét bình luận:', (e as Error).message)),
    );
  }),
);
