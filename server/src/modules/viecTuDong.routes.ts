// /api/viec-tu-dong — Việc tự động (học Javis, anh Tâm 11/11/2026). CHỈ giám đốc; mỗi người chỉ thấy việc của mình.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { dsViec, timViec, taoViec, loiTaoViec, datTrangThai, xoaViec, chayMot, moTaLich } from './viecTuDong.service.js';
import type { RepeatKind } from '../lib/reminder.js';

export const viecTuDongRouter = Router();
viecTuDongRouter.use(requireAuth, requireRole('director'));

viecTuDongRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    let canCapNhatDb = false;
    const ds = await dsViec(req.user!.sub).catch(() => {
      canCapNhatDb = true;
      return [];
    });
    res.json({ ds: ds.map((v) => ({ ...v, lich: moTaLich(v) })), canCapNhatDb });
  }),
);

viecTuDongRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        ten: z.string().max(120),
        yeuCau: z.string().max(2000),
        atTime: z.string().max(5),
        repeatKind: z.enum(['once', 'daily', 'weekly', 'monthly']),
        onDate: z.string().max(10).optional(),
        weekday: z.number().int().min(0).max(6).optional(),
        dayOfMonth: z.number().int().min(1).max(31).optional(),
      })
      .parse(req.body);
    const x = { ...b, repeatKind: b.repeatKind as RepeatKind };
    const loi = loiTaoViec(x);
    if (loi) throw new ApiError(400, loi.replace(/^CHƯA TẠO: /, ''));
    res.json({ ok: true, viec: await taoViec(req.user!.sub, x) });
  }),
);

/** Chạy thử ngay — không đếm sai, không đổi lịch. Có thể mất 1–3 phút. */
viecTuDongRouter.post(
  '/:id/chay-thu',
  asyncHandler(async (req, res) => {
    const v = await timViec(String(req.params.id), req.user!.sub);
    if (!v) throw new ApiError(404, 'Không thấy việc này');
    res.json(await chayMot(v, { thu: true }));
  }),
);

viecTuDongRouter.post(
  '/:id/trang-thai',
  asyncHandler(async (req, res) => {
    const { tt } = z.object({ tt: z.enum(['chay', 'dung']) }).parse(req.body);
    if (!(await datTrangThai(String(req.params.id), req.user!.sub, tt))) throw new ApiError(404, 'Không thấy việc này');
    res.json({ ok: true });
  }),
);

viecTuDongRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await xoaViec(String(req.params.id), req.user!.sub);
    res.json({ ok: true });
  }),
);
