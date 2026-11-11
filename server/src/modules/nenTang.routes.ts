// /api/nen-tang — trang "Kết nối MCP" (anh Tâm 11/11/2026). Xem chỉ số: mọi người (lọc theo phòng). Quản lý tài sản,
// đồng bộ: chỉ giám đốc. Kết nối / app / MCP khác vẫn ở /api/ket-noi (chỉ giám đốc).
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { findById } from './members.repo.js';
import { getTeams } from './teams.repo.js';
import { chiSo, dsTaiSan, lamMoiTaiSan, suaTaiSan, dongBoNgay } from './nenTang.service.js';
import type { LoaiTaiSan } from '../lib/nenTang.js';

export const nenTangRouter = Router();
nenTangRouter.use(requireAuth);

const LOAI = z.enum(['meta', 'gads', 'ga4', 'gsc']);

nenTangRouter.get(
  '/chi-so',
  asyncHandler(async (req, res) => {
    const loai = LOAI.parse(req.query.loai) as LoaiTaiSan;
    const me = await findById(req.user!.sub);
    const nguoi = { role: req.user!.role, teamId: String(me?.teamId || '') };
    const locTeam = nguoi.role === 'director' ? String(req.query.team || '') || undefined : undefined;
    try {
      // Khoảng như Facebook: ?mau=7|hom_qua|tuan_truoc|thang_nay|tuy_chon&tu=&den= (mặc định 7 ngày qua).
      const { khoangNgay } = await import('../lib/khoangNgay.js');
      const { todayIso } = await import('../lib/datetime.js');
      const kh = req.query.mau ? khoangNgay(String(req.query.mau), todayIso(), String(req.query.tu || ''), String(req.query.den || '')) : undefined;
      const [kq, teams] = await Promise.all([chiSo(nguoi, loai, locTeam, kh), getTeams().catch(() => [])]);
      res.json({ ...kq, teams: teams.map((t) => ({ id: t.id, name: t.name })), laGd: nguoi.role === 'director', canCapNhatDb: false });
    } catch {
      res.json({ taiSan: [], tong: null, teams: [], laGd: nguoi.role === 'director', canCapNhatDb: true });
    }
  }),
);

nenTangRouter.get(
  '/tai-san',
  requireRole('director'),
  asyncHandler(async (_req, res) => {
    const [ds, teams] = await Promise.all([dsTaiSan().catch(() => null), getTeams().catch(() => [])]);
    res.json({ ds: ds || [], canCapNhatDb: ds === null, teams: teams.map((t) => ({ id: t.id, name: t.name })) });
  }),
);

nenTangRouter.post(
  '/tai-san/lam-moi',
  requireRole('director'),
  asyncHandler(async (_req, res) => {
    res.json(await lamMoiTaiSan());
  }),
);

nenTangRouter.patch(
  '/tai-san/:id',
  requireRole('director'),
  asyncHandler(async (req, res) => {
    const b = z.object({ teamId: z.string().max(40).optional(), khach: z.string().max(120).optional(), theoDoi: z.boolean().optional() }).parse(req.body);
    await suaTaiSan(String(req.params.id), b);
    res.json({ ok: true });
  }),
);

nenTangRouter.post(
  '/dong-bo',
  requireRole('director'),
  asyncHandler(async (req, res) => {
    const loai = req.body?.loai ? (LOAI.parse(req.body.loai) as LoaiTaiSan) : undefined;
    res.json(await dongBoNgay(loai));
  }),
);
