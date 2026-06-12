import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { getActiveCatalog } from './catalog.repo.js';
import { getAllTasks, getDoingTasks } from './tasks.repo.js';
import { logTask, startTask, completeTask } from './tasks.service.js';
import { inRange } from '../lib/scores.js';
import { nowTz, monthRange, todayIso } from '../lib/datetime.js';
import { getConfig } from '../config.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

tasksRouter.get(
  '/catalog',
  asyncHandler(async (_req, res) => {
    const cfg = await getConfig();
    res.json({ catalog: await getActiveCatalog(), sheetUrl: cfg.taskSheetUrl });
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
          t.status !== 'doing' &&
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
