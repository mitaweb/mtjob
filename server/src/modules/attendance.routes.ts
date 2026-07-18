import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { checkIn, checkOut } from './attendance.service.js';
import { getForMemberRange, getForDate } from './attendance.repo.js';
import { notify } from './notifications.service.js';
import { findById, membersInTeam } from './members.repo.js';
import { nowTz, monthRange, fmtHm, todayIso } from '../lib/datetime.js';
import type { Shift } from '../lib/attendance.js';

export const attendanceRouter = Router();
attendanceRouter.use(requireAuth);

const geoSchema = z.object({ lat: z.number(), lng: z.number() });

const shiftVi = (s: Shift) => (s === 'morning' ? 'sáng' : 'chiều');

attendanceRouter.post(
  '/checkin',
  asyncHandler(async (req, res) => {
    const { lat, lng } = geoSchema.parse(req.body);
    const r = await checkIn(req.user!.sub, lat, lng);
    await notify(req.user!.sub, {
      type: 'attendance',
      title: 'Chấm công thành công ✅',
      body: `Ca ${shiftVi(r.shift)} — giờ vào ${fmtHm(r.time)}${r.late ? ' (đi trễ)' : ''}. Ngày công hôm nay: ${r.dayFraction}.`,
      url: '/attendance',
    }, { background: true });
    res.json({ ok: true, ...r });
  }),
);

attendanceRouter.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const { lat, lng } = geoSchema.parse(req.body);
    const r = await checkOut(req.user!.sub, lat, lng);
    await notify(req.user!.sub, {
      type: 'attendance',
      title: 'Chấm công thành công ✅',
      body: `Ca ${shiftVi(r.shift)} — giờ ra ${fmtHm(r.time)}. Ngày công hôm nay: ${r.dayFraction}.`,
      url: '/attendance',
    }, { background: true });
    res.json({ ok: true, ...r });
  }),
);

attendanceRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const now = nowTz();
    const ym = String(req.query.month || '');
    const [y, m] = ym.match(/^\d{4}-\d{2}$/) ? ym.split('-').map(Number) : [now.year(), now.month() + 1];
    const { start, end } = monthRange(y!, m!);
    const records = await getForMemberRange(req.user!.sub, start, end);
    const totalDays = records.reduce((s, r) => s + (Number(r.dayFraction) || 0), 0);
    res.json({ year: y, month: m, totalDays, records });
  }),
);

attendanceRouter.get(
  '/overview',
  requireRole('leader', 'director', 'admin'),
  asyncHandler(async (req, res) => {
    const date = String(req.query.date || todayIso());
    let records = await getForDate(date);
    if (req.user!.role === 'leader') {
      const me = await findById(req.user!.sub);
      const ids = new Set(me?.teamId ? (await membersInTeam(me.teamId)).map((x) => x.id) : []);
      records = records.filter((r) => ids.has(r.memberId));
    }
    res.json({ date, records });
  }),
);
