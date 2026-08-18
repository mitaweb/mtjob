import { Router } from 'express';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { layLich } from './calendar.service.js';
import { todayIso } from '../lib/datetime.js';

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

/** Số ngày tối đa một lần xem — chặn gọi ?days=99999 quét cả bảng. */
const TOI_DA_NGAY = 62;

calendarRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || ''))
      ? String(req.query.from)
      : todayIso();
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), TOI_DA_NGAY);
    const ketQua = await layLich({ memberId: req.user!.sub, role: req.user!.role, from, days });
    res.json({ from, den: ketQua[ketQua.length - 1]?.ngay || from, days: ketQua });
  }),
);
