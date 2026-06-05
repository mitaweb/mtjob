import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { submitRequest, decideRequest } from './requests.service.js';
import { getAllRequests, type RequestRow, type RequestKind } from './requests.repo.js';
import { findById, membersInTeam } from './members.repo.js';

export const requestsRouter = Router();
requestsRouter.use(requireAuth);

const onlineSchema = z.object({
  dates: z.array(z.string()).min(1),
  scope: z.enum(['half_am', 'half_pm', 'full']),
  reason: z.string().optional().default(''),
});

const leaveSchema = z.object({
  dates: z.array(z.string()).min(1),
  type: z.string().optional().default('Nghỉ phép'),
  reason: z.string().optional().default(''),
});

requestsRouter.post(
  '/online',
  asyncHandler(async (req, res) => {
    const b = onlineSchema.parse(req.body);
    const r = await submitRequest({
      memberId: req.user!.sub,
      kind: 'online',
      dates: b.dates,
      scope: b.scope,
      reason: b.reason,
    });
    res.json({ ok: true, request: r });
  }),
);

requestsRouter.post(
  '/leave',
  asyncHandler(async (req, res) => {
    const b = leaveSchema.parse(req.body);
    const r = await submitRequest({
      memberId: req.user!.sub,
      kind: 'leave',
      dates: b.dates,
      type: b.type,
      reason: b.reason,
    });
    res.json({ ok: true, request: r });
  }),
);

requestsRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const all = await getAllRequests();
    res.json({ requests: all.filter((r) => r.memberId === req.user!.sub) });
  }),
);

requestsRouter.get(
  '/pending',
  requireRole('leader', 'director', 'admin'),
  asyncHandler(async (req, res) => {
    const all = await getAllRequests();
    let pending: RequestRow[];
    if (req.user!.role === 'leader') {
      const me = await findById(req.user!.sub);
      const ids = new Set(me?.teamId ? (await membersInTeam(me.teamId)).map((x) => x.id) : []);
      pending = all.filter(
        (r) => r.finalStatus === 'pending' && r.leaderStatus === 'pending' && ids.has(r.memberId),
      );
    } else {
      pending = all.filter(
        (r) =>
          r.finalStatus === 'pending' &&
          r.leaderStatus === 'approved' &&
          r.directorStatus === 'pending',
      );
    }
    res.json({ requests: pending });
  }),
);

const decideSchema = z.object({ decision: z.enum(['approve', 'reject']) });

requestsRouter.post(
  '/:kind/:id/decide',
  requireRole('leader', 'director', 'admin'),
  asyncHandler(async (req, res) => {
    const kind = req.params.kind as RequestKind;
    if (kind !== 'online' && kind !== 'leave') throw new ApiError(400, 'Loại đơn không hợp lệ');
    const { decision } = decideSchema.parse(req.body);
    const r = await decideRequest(kind, String(req.params.id), req.user!.sub, decision);
    res.json({ ok: true, request: r });
  }),
);
