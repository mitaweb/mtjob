import { Router } from 'express';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { memberScore, ranking } from './scores.service.js';
import { findById } from './members.repo.js';

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
