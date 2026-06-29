import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { getActiveCatalog, sortCatalogForTeam } from './catalog.repo.js';
import { findById, getActiveMembers, membersInTeam } from './members.repo.js';
import { getAllTasks, getDoingTasks, getTodoTasks } from './tasks.repo.js';
import { logTask, startTask, completeTask, startAssignedTask, canAssign } from './tasks.service.js';
import { inRange } from '../lib/scores.js';
import { nowTz, monthRange, todayIso } from '../lib/datetime.js';
import { getConfig } from '../config.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

tasksRouter.get(
  '/catalog',
  asyncHandler(async (req, res) => {
    const cfg = await getConfig();
    const me = await findById(req.user!.sub);
    const catalog = sortCatalogForTeam(await getActiveCatalog(), me?.teamId || '');
    res.json({ catalog, sheetUrl: cfg.taskSheetUrl });
  }),
);

tasksRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const range = String(req.query.range || 'month');
    const now = nowTz();
    const { start, end } =
      range === 'today'
        ? { start: todayIso(), end: todayIso() }
        : monthRange(now.year(), now.month() + 1);
    const tasks = (await getAllTasks())
      .filter(
        (t) =>
          t.memberId === req.user!.sub &&
          t.status === 'done' &&
          inRange(t.completedAt || t.createdAt, start, end),
      )
      .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
    res.json({ range, start, end, tasks });
  }),
);

/** Danh sách task đang làm (cho hộp thoại dưới ô chat). */
tasksRouter.get(
  '/doing',
  asyncHandler(async (req, res) => {
    const doing = await getDoingTasks(req.user!.sub);
    const now = Date.now();
    res.json({
      tasks: doing.map((t) => ({
        id: t.id,
        taskCode: t.taskCode,
        taskName: t.taskName,
        points: t.points,
        startedAt: t.startedAt,
        elapsedMinutes: Math.max(0, Math.round((now - Date.parse(t.startedAt)) / 60000)) || 0,
      })),
    });
  }),
);

/** Việc được giao chưa bắt đầu (cần làm) — hiện dưới ô chat. */
tasksRouter.get(
  '/todo',
  asyncHandler(async (req, res) => {
    const todo = await getTodoTasks(req.user!.sub);
    res.json({
      tasks: todo.map((t) => ({
        id: t.id,
        taskCode: t.taskCode,
        taskName: t.taskName,
        points: t.points,
        createdAt: t.createdAt,
        assignedBy: t.note || '',
      })),
    });
  }),
);

/** Danh sách người mà mình được phép giao việc (leader: trong team; giám đốc/admin: tất cả). */
tasksRouter.get(
  '/assignees',
  asyncHandler(async (req, res) => {
    const me = await findById(req.user!.sub);
    if (!me) {
      res.json({ assignees: [] });
      return;
    }
    let people = me.role === 'leader' ? await membersInTeam(me.teamId) : await getActiveMembers();
    if (me.role !== 'director' && me.role !== 'admin' && me.role !== 'leader') people = [];
    res.json({
      assignees: people
        .filter((p) => p.id !== me.id && canAssign(me, p))
        .map((p) => ({ id: p.id, fullName: p.fullName, username: p.username, teamId: p.teamId })),
    });
  }),
);

/** Bắt đầu một việc ĐƯỢC GIAO (todo → doing); người nhận tự chọn loại task. */
const startAssignedSchema = z.object({ taskCode: z.string().min(1) });
tasksRouter.post(
  '/:id/start',
  asyncHandler(async (req, res) => {
    const { taskCode } = startAssignedSchema.parse(req.body);
    const { task } = await startAssignedTask(req.user!.sub, String(req.params.id), taskCode);
    res.json({ ok: true, task });
  }),
);

const logSchema = z.object({
  taskCode: z.string().min(1),
  completedAt: z.string().optional(),
  note: z.string().optional(),
});

tasksRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = logSchema.parse(req.body);
    const { task, points } = await logTask({ ...body, memberId: req.user!.sub, source: 'app' });
    res.json({ ok: true, task, points });
  }),
);

const startSchema = z.object({ taskCode: z.string().min(1), note: z.string().optional() });

tasksRouter.post(
  '/start',
  asyncHandler(async (req, res) => {
    const body = startSchema.parse(req.body);
    const { task } = await startTask({ ...body, memberId: req.user!.sub, source: 'app' });
    res.json({ ok: true, task });
  }),
);

tasksRouter.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const { task, points } = await completeTask(req.user!.sub, String(req.params.id));
    res.json({ ok: true, task, points });
  }),
);
