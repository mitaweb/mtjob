// /api/fanpage — Fanpage có duyệt (học Javis, anh Tâm 11/11/2026). CHỈ giám đốc. Không có đường nào tự đăng.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { dsTrang, dsDeXuat, luuTrang, quetBinhLuan, taoBai, vietBaiAi, duyet, tuChoi } from './fanpage.service.js';

export const fanpageRouter = Router();
fanpageRouter.use(requireAuth, requireRole('director'));

fanpageRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    try {
      const [trang, dx] = await Promise.all([dsTrang(), dsDeXuat()]);
      res.json({ trang, ...dx, canCapNhatDb: false });
    } catch {
      res.json({ trang: [], cho: [], lichSu: [], canCapNhatDb: true });
    }
  }),
);

fanpageRouter.post(
  '/lay-trang',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, so: await luuTrang() });
  }),
);

fanpageRouter.post(
  '/quet',
  asyncHandler(async (_req, res) => {
    res.json(await quetBinhLuan({ ep: true }));
  }),
);

fanpageRouter.post(
  '/viet-ai',
  asyncHandler(async (req, res) => {
    const b = z.object({ pageId: z.string().min(1), yeuCau: z.string().min(5).max(1500) }).parse(req.body);
    res.json({ noiDung: await vietBaiAi(b.pageId, b.yeuCau) });
  }),
);

/** Lưu bài thành nháp chờ duyệt (anh viết hoặc AI viết giúp). */
fanpageRouter.post(
  '/bai',
  asyncHandler(async (req, res) => {
    const b = z.object({ pageId: z.string().min(1), noiDung: z.string().max(5000) }).parse(req.body);
    res.json({ ok: true, deXuat: await taoBai(b.pageId, b.noiDung, 'anh') });
  }),
);

/** ANH DUYỆT → đăng thật (có thể sửa nội dung trước). */
fanpageRouter.post(
  '/de-xuat/:id/duyet',
  asyncHandler(async (req, res) => {
    const b = z.object({ noiDung: z.string().max(5000).optional() }).parse(req.body || {});
    res.json({ ok: true, deXuat: await duyet(String(req.params.id), b.noiDung) });
  }),
);

fanpageRouter.post(
  '/de-xuat/:id/bo',
  asyncHandler(async (req, res) => {
    await tuChoi(String(req.params.id));
    res.json({ ok: true });
  }),
);
