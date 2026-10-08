// Zalo cá nhân → kho tri thức (anh Tâm 5/10/2026), chạy thẳng trên Vercel (8/10/2026).
// CHỈ GIÁM ĐỐC — kể cả admin cũng không (anh Tâm 8/10/2026: "chỉ giám đốc thấy được tab zalo này
// thôi"): đây là tin nhắn riêng của anh với khách. Đồng bộ ban đêm ăn theo cron nhắc hẹn.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { runInBackground } from '../util/background.js';
import { docTrangThai, dsCuoc, suaCuoc, timCuoc } from './zalo.repo.js';
import { rutTriThucZalo, khopKhachCuoc } from './zalo.service.js';
import { dangNhapQR, dangXuat, dongBoZalo, khoaPhien } from './zalo.client.js';
import { isMissingTable } from './brain.repo.js';

export const zaloRouter = Router();
zaloRouter.use(requireAuth, requireRole('director'));

const daCauHinh = (): boolean => {
  try {
    khoaPhien();
    return true;
  } catch {
    return false;
  }
};

zaloRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    try {
      const [st, cuoc] = await Promise.all([docTrangThai(), dsCuoc(300)]);
      res.json({ configured: daCauHinh(), ...st, threads: cuoc });
    } catch (e) {
      if (isMissingTable(e) || /zalo_|session_enc|last_sync/.test((e as Error).message)) {
        res.json({ configured: daCauHinh(), status: 'offline', qr: '', account: '', note: '', coPhien: false, threads: [], needsMigrate: true });
        return;
      }
      throw e;
    }
  }),
);

/** Bắt đầu đăng nhập QR — trả lời ngay, chạy nền; trang hỏi /status 2 giây/lần để hiện QR. */
zaloRouter.post(
  '/login',
  asyncHandler(async (_req, res) => {
    if (!daCauHinh()) throw new ApiError(400, 'Chưa cấu hình ZALO_SESSION_KEY trên Vercel (chuỗi ngẫu nhiên ≥ 32 ký tự) rồi Redeploy.');
    runInBackground(dangNhapQR());
    res.json({ ok: true });
  }),
);

zaloRouter.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    await dangXuat();
    res.json({ ok: true });
  }),
);

/** Đồng bộ ngay (chỉ lấy tin; rút tri thức để ban đêm hoặc bấm "Rút tri thức ngay"). */
zaloRouter.post(
  '/sync',
  asyncHandler(async (_req, res) => {
    res.json(await dongBoZalo());
  }),
);

const suaSchema = z.object({ enabled: z.boolean().optional(), customer: z.string().max(200).optional() });

zaloRouter.post(
  '/threads/:id',
  asyncHandler(async (req, res) => {
    const b = suaSchema.parse(req.body);
    const id = String(req.params.id);
    if (!(await timCuoc(id))) throw new ApiError(404, 'Không tìm thấy cuộc trò chuyện');
    const kh = b.customer !== undefined ? await khopKhachCuoc(b.customer) : undefined;
    await suaCuoc(id, { enabled: b.enabled, ...(kh || {}) });
    res.json({ ok: true, thread: await timCuoc(id) });
  }),
);

zaloRouter.post(
  '/digest',
  asyncHandler(async (req, res) => {
    const threadId = typeof req.body?.threadId === 'string' ? req.body.threadId : undefined;
    res.json(await rutTriThucZalo({ epNgay: true, threadId, limit: threadId ? 1 : 3 }));
  }),
);
