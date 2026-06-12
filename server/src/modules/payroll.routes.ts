import { Router } from 'express';
import { asyncHandler } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { payrollForMember, payrollForMonth } from './payroll.service.js';
import { findById, membersInTeam } from './members.repo.js';
import { nowTz } from '../lib/datetime.js';

export const payrollRouter = Router();
payrollRouter.use(requireAuth);

function ym(req: { query: Record<string, unknown> }): { year: number; month: number } {
  const now = nowTz();
  const year = Number(req.query.year) || now.year();
  const month = Number(req.query.month) || now.month() + 1;
  return { year, month };
}

payrollRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const { year, month } = ym(req);
    res.json({ year, month, line: await payrollForMember(req.user!.sub, year, month) });
  }),
);

// Lương là dữ liệu nhạy cảm: chỉ giám đốc/admin xem được bảng lương người khác.
payrollRouter.get(
  '/team',
  requireRole('director', 'admin'),
  asyncHandler(async (req, res) => {
    const { year, month } = ym(req);
    const me = await findById(req.user!.sub);
    const ids = new Set(me?.teamId ? (await membersInTeam(me.teamId)).map((x) => x.id) : []);
    const lines = (await payrollForMonth(year, month)).filter((l) => ids.has(l.memberId));
    res.json({ year, month, lines });
  }),
);

payrollRouter.get(
  '/all',
  requireRole('director', 'admin'),
  asyncHandler(async (req, res) => {
    const { year, month } = ym(req);
    res.json({ year, month, lines: await payrollForMonth(year, month) });
  }),
);
