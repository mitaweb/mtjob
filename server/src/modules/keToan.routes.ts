// /api/ke-toan — Kế toán thuế (anh Tâm 18/10/2026). CHỈ giám đốc (chi phí / thuế / công nợ là việc của giám đốc).
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { nhapBang, nhapXml, tongQuan, caiDat, luuCaiDat } from './keToan.service.js';
import { trangHoaDon, lichSuTaiLen } from './keToan.repo.js';
import { nowTz } from '../lib/datetime.js';

export const keToanRouter = Router();
keToanRouter.use(requireAuth, requireRole('director'));

const MAX_DONG = 6000;
const MAX_COT = 40;

const bangSchema = z.object({
  ten: z.string().max(300),
  sheets: z
    .array(z.object({ ten: z.string().max(100), rows: z.array(z.array(z.string().max(2000)).max(MAX_COT)).max(MAX_DONG) }))
    .min(1)
    .max(20),
});

const xmlSchema = z.object({
  files: z.array(z.object({ ten: z.string().max(300), noiDung: z.string().max(400_000) })).min(1).max(40),
});

/** Một file Excel/CSV — trình duyệt đã đọc thành các dòng chữ. */
keToanRouter.post(
  '/tai-len/bang',
  asyncHandler(async (req, res) => {
    const b = bangSchema.parse(req.body);
    res.json(await nhapBang(b.ten, b.sheets, req.user!.name));
  }),
);

/** Nhiều file XML một lượt (hoá đơn, tờ khai GTGT). */
keToanRouter.post(
  '/tai-len/xml',
  asyncHandler(async (req, res) => {
    const b = xmlSchema.parse(req.body);
    res.json({ ketQua: await nhapXml(b.files, req.user!.name) });
  }),
);

keToanRouter.get(
  '/tong-quan',
  asyncHandler(async (req, res) => {
    const nam = Number(req.query.nam) || Number(nowTz().format('YYYY'));
    res.json(await tongQuan(nam));
  }),
);

keToanRouter.get(
  '/hoa-don',
  asyncHandler(async (req, res) => {
    const huong = req.query.huong === 'ra' || req.query.huong === 'vao' ? req.query.huong : undefined;
    const ky = /^\d{4}-Q\d$/.test(String(req.query.ky || '')) ? String(req.query.ky) : undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(100, Math.max(5, Number(req.query.size) || 20));
    res.json(await trangHoaDon({ huong, ky, tim: String(req.query.q || ''), page, size }));
  }),
);

keToanRouter.get(
  '/tai-len',
  asyncHandler(async (_req, res) => {
    res.json({ ds: await lichSuTaiLen(30) });
  }),
);

keToanRouter.get(
  '/cai-dat',
  asyncHandler(async (_req, res) => {
    res.json(await caiDat());
  }),
);

keToanRouter.post(
  '/cai-dat',
  asyncHandler(async (req, res) => {
    const b = z.object({ mst: z.string().max(20).optional(), mienTndn: z.string().max(100).optional() }).parse(req.body);
    res.json(await luuCaiDat(b));
  }),
);
