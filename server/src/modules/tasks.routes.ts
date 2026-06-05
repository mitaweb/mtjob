import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { getActiveCatalog } from './catalog.repo.js';
import { getAllTasks } from './tasks.repo.js';
import { logTask } from './tasks.service.js';
import { inRange } from '../lib/scores.js';
import { nowTz, monthRange, todayIso } from '../lib/datetime.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

tasksRouter.get(
  '/catalog',
  asyncHandler(async (_req, res) => {
    res.json({ catalog: await getActiveCatalog() });
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
      .filter((t) => t.memberId === req.user!.sub && inRange(t.completedAt || t.createdAt, start, end))
      .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
    res.json({ range, start, end, tasks });
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
