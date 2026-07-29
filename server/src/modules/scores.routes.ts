import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { memberScore, ranking, memberWorkDetail } from './scores.service.js';
import { findById, membersInTeam } from './members.repo.js';
import { addAdjustment, listAdjustments, deleteAdjustment } from './scores.adjust.js';
import { nowTz } from '../lib/datetime.js';

export const scoresRouter = Router();
scoresRouter.use(requireAuth);

/** Tháng đang xem, mặc định tháng hiện tại. */
function ymOf(req: { query: Record<string, unknown> }): { year: number; month: number } {
  const now = nowTz();
  return {
    year: Number(req.query.year) || now.year(),
    month: Number(req.query.month) || now.month() + 1,
  };
}

scoresRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json(await memberScore(req.user!.sub));
  }),
);

scoresRouter.get(
  '/team',
  requireRole('leader', 'director', 'admin'),
  asyncHandler(async (req, res) => {
    let teamId = String(req.query.teamId || '');
    if (!teamId) {
      const me = await findById(req.user!.sub);
      teamId = me?.teamId || '';
    }
    if (!teamId) throw new ApiError(400, 'Không xác định được team');
    res.json({ teamId, members: await ranking(undefined, undefined, teamId) });
  }),
);

scoresRouter.get(
  '/all',
  requireRole('director', 'admin'),
  asyncHandler(async (_req, res) => {
    res.json({ members: await ranking() });
  }),
);

/**
 * Chi tiết công việc THEO NGÀY của một thành viên trong tháng — để giám đốc/leader
 * bấm vào một người trong bảng xếp hạng là thấy họ làm gì mỗi ngày.
 * Quyền: giám đốc/admin xem mọi người; leader chỉ xem người trong team mình.
 */
scoresRouter.get(
  '/member/:id/detail',
  requireRole('leader', 'director', 'admin'),
  asyncHandler(async (req, res) => {
    const targetId = String(req.params.id);
    const target = await findById(targetId);
    if (!target) throw new ApiError(404, 'Không tìm thấy thành viên');

    if (req.user!.role === 'leader') {
      const me = await findById(req.user!.sub);
      const inTeam = me?.teamId ? (await membersInTeam(me.teamId)).some((x) => x.id === targetId) : false;
      if (!inTeam) throw new ApiError(403, 'Bạn chỉ xem được thành viên trong team mình');
    }

    const { year, month } = ymOf(req);
    res.json({
      member: { id: target.id, fullName: target.fullName, teamId: target.teamId },
      ...(await memberWorkDetail(targetId, year, month)),
    });
  }),
);

/**
 * Chi tiết công việc theo ngày của CHÍNH MÌNH — ai cũng xem được, nhưng chỉ của mình.
 * Cố ý là route riêng thay vì nới quyền cho `/member/:id/detail`: nhân viên không
 * truyền được id người khác vào đây.
 */
scoresRouter.get(
  '/me/detail',
  asyncHandler(async (req, res) => {
    const me = await findById(req.user!.sub);
    if (!me) throw new ApiError(404, 'Không tìm thấy thành viên');
    const { year, month } = ymOf(req);
    res.json({
      member: { id: me.id, fullName: me.fullName, teamId: me.teamId },
      ...(await memberWorkDetail(me.id, year, month)),
    });
  }),
);

// ── Bù điểm cho ngày đã qua ──
//
// Chỉ giám đốc/admin. Leader KHÔNG có quyền này: bù điểm là đụng thẳng vào thưởng và
// xếp hạng, không nên để người cùng cạnh tranh trong bảng tự cộng cho nhau.

const adjustSchema = z.object({
  memberId: z.string().min(1),
  date: z.string().min(1),
  points: z.number(),
  reason: z.string().min(1),
});

scoresRouter.post(
  '/adjust',
  requireRole('director', 'admin'),
  asyncHandler(async (req, res) => {
    const b = adjustSchema.parse(req.body);
    const row = await addAdjustment({ ...b, byName: req.user!.name });
    res.json({ ok: true, adjustment: row });
  }),
);

scoresRouter.get(
  '/adjustments',
  requireRole('director', 'admin'),
  asyncHandler(async (req, res) => {
    const month = String(req.query.month || '');
    res.json({
      adjustments: await listAdjustments({
        memberId: String(req.query.memberId || '') || undefined,
        month: /^\d{4}-\d{2}$/.test(month) ? month : undefined,
      }),
    });
  }),
);

scoresRouter.delete(
  '/adjust/:id',
  requireRole('director', 'admin'),
  asyncHandler(async (req, res) => {
    res.json({ ok: true, adjustment: await deleteAdjustment(String(req.params.id)) });
  }),
);
