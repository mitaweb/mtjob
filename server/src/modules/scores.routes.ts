import { Router } from 'express';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { memberScore, ranking } from './scores.service.js';
import { findById, membersInTeam } from './members.repo.js';
import { getDoneTasksForMemberRange } from './tasks.repo.js';
import { taskTitle } from '../lib/tasks.js';
import { unionMinutes, taskIntervalsForDay, overlappingIds } from '../lib/worktime.js';
import { nowTz, monthRange, dayBoundsMs, fmtHm } from '../lib/datetime.js';

export const scoresRouter = Router();
scoresRouter.use(requireAuth);

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

    const now = nowTz();
    const year = Number(req.query.year) || now.year();
    const month = Number(req.query.month) || now.month() + 1;
    const { start, end } = monthRange(year, month);

    const [tasks, score, rank] = await Promise.all([
      getDoneTasksForMemberRange(targetId, start, end),
      memberScore(targetId, year, month),
      ranking(year, month).then((r) => r.find((x) => x.memberId === targetId)?.rank ?? 0),
    ]);

    // Gom theo ngày hoàn thành; giờ làm tính lại từ khoảng thời gian thực của từng ngày.
    const byDay = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const day = (t.completedAt || t.createdAt || '').slice(0, 10);
      if (!day) continue;
      byDay.set(day, [...(byDay.get(day) || []), t]);
    }

    const nowMs = Date.now();
    const days = [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // mới nhất trước
      .map(([date, list]) => {
        const { startMs, endMs } = dayBoundsMs(date);
        // Đánh dấu việc chồng giờ để giám đốc đối chiếu điểm với giờ làm thật.
        const overlaps = new Set(overlappingIds(list));
        return {
          date,
          points: list.reduce((s, t) => s + (Number(t.points) || 0), 0),
          // Giờ làm ĐÃ GỘP khoảng chồng lấn — tổng thời lượng từng việc có thể lớn hơn.
          minutes: unionMinutes(taskIntervalsForDay(list, startMs, endMs, nowMs)),
          noTimeCount: list.filter((t) => !t.startedAt).length,
          tasks: list.map((t) => {
            const span =
              t.startedAt && t.completedAt
                ? Math.max(0, Math.round((Date.parse(t.completedAt) - Date.parse(t.startedAt)) / 60000))
                : null;
            return {
              id: t.id,
              title: taskTitle(t), // kèm ghi chú / tên khách
              points: t.points,
              completedAt: t.completedAt,
              // Định dạng giờ ở MÁY CHỦ theo giờ VN — máy người xem có thể ở múi giờ khác.
              startHm: t.startedAt ? fmtHm(t.startedAt) : '',
              endHm: t.completedAt ? fmtHm(t.completedAt) : '',
              minutes: span,
              overlap: overlaps.has(t.id),
              crossDay: !!t.startedAt && t.startedAt.slice(0, 10) !== date,
            };
          }),
        };
      });

    res.json({
      member: { id: target.id, fullName: target.fullName, teamId: target.teamId },
      year,
      month,
      score: { monthPoints: score.monthPoints, bonus: score.bonus, rank },
      days,
    });
  }),
);
