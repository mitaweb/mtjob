// Zalo cá nhân → kho tri thức (anh Tâm 5/10/2026), chạy thẳng trên Vercel (8/10/2026).
// CHỈ GIÁM ĐỐC — kể cả admin cũng không (anh Tâm 8/10/2026: "chỉ giám đốc thấy được tab zalo này
// thôi"): đây là tin nhắn riêng của anh với khách. Đồng bộ ban đêm ăn theo cron nhắc hẹn.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { runInBackground } from '../util/background.js';
import { docTrangThai, suaCuoc, timCuoc, trangCuoc, tinGanDay, type LocCuoc } from './zalo.repo.js';
import { rutTriThucZalo, khopKhachCuoc } from './zalo.service.js';
import { dangNhapQR, dangXuat, dongBoZalo, quetNhomKhach, xuLyNgay, khoaPhien } from './zalo.client.js';
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
  asyncHandler(async (req, res) => {
    try {
      const LOC = ['hoi', 'hoc', 'bo', 'nhom', 'rieng', 'tat_ca'] as const;
      const locHoi = LOC.find((x) => x === req.query.loc);
      const tim = String(req.query.q || '').slice(0, 100);
      const trang = Math.max(1, Math.floor(Number(req.query.page)) || 1);
      const co = Math.min(100, Math.max(5, Math.floor(Number(req.query.size)) || 30));
      const st = await docTrangThai();
      let loc: LocCuoc = locHoi || 'hoi';
      let ds = await trangCuoc({ loc, tim, trang, co });
      // Chưa chọn lọc: có cuộc AI đang hỏi anh thì hiện trước; không thì cuộc đang học; không nữa thì tất cả.
      if (!locHoi && ds.dem.hoi === 0) {
        loc = ds.dem.hoc > 0 ? 'hoc' : 'tat_ca';
        ds = await trangCuoc({ loc, tim, trang, co });
      }
      res.json({ configured: daCauHinh(), ...st, threads: ds.threads, dem: ds.dem, loc, page: trang, size: co });
    } catch (e) {
      if (isMissingTable(e) || /zalo_|session_enc|last_sync|ai_checked|ai_note|history_done|ai_hoi|anh_quyet|tom_tat/.test((e as Error).message)) {
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

/**
 * Quét nhóm khách (anh Tâm 8/10/2026): AI xét nhóm nào là nhóm khách, khớp/tạo khách ở CRM, bật học,
 * kéo lịch sử cũ. Mỗi lần ~45 giây; `conLai` > 0 thì trang tự gọi tiếp.
 */
zaloRouter.post(
  '/groups',
  asyncHandler(async (_req, res) => {
    res.json(await quetNhomKhach());
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

/**
 * "⚡ Đọc & phân loại ngay" (anh Tâm 10/10/2026: "không cần chờ đến tối") — một bước ~40 giây; trang
 * gọi lặp tới khi `buoc = 'xong'`.
 */
zaloRouter.post(
  '/process',
  asyncHandler(async (_req, res) => {
    res.json(await xuLyNgay());
  }),
);

/** Vài tin gần đây của một cuộc — để anh xem nội dung rồi quyết Học / Bỏ qua. */
zaloRouter.get(
  '/threads/:id/messages',
  asyncHandler(async (req, res) => {
    const tin = await tinGanDay(String(req.params.id), 20);
    res.json({ messages: tin.reverse() });
  }),
);
