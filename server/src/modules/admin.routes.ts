import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { syncMembersFromSource, syncCatalogFromSource } from './admin.sync.js';
import { getAllMembers, findById, publicMember, upsertMember } from './members.repo.js';
import { upsertCatalogItem } from './catalog.repo.js';
import { upsertHoliday } from './holidays.repo.js';
import { upsertTeam } from './teams.repo.js';
import { hashPassword } from '../auth/password.js';
import { setConfigValue } from '../config.js';
import { newId } from '../util/id.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin', 'director'));

adminRouter.post(
  '/sync-members',
  asyncHandler(async (_req, res) => {
    res.json(await syncMembersFromSource());
  }),
);

adminRouter.post(
  '/sync-catalog',
  asyncHandler(async (_req, res) => {
    res.json(await syncCatalogFromSource());
  }),
);

adminRouter.get(
  '/members',
  asyncHandler(async (_req, res) => {
    res.json({ members: (await getAllMembers()).map(publicMember) });
  }),
);

const memberSchema = z.object({
  id: z.string().optional(),
  fullName: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['member', 'leader', 'director', 'admin']),
  teamId: z.string().optional().default(''),
  dob: z.string().optional().default(''),
  position: z.string().optional().default(''),
  salary: z.number().optional().default(0),
  bhxh: z.number().optional().default(0),
  joinDate: z.string().optional().default(''),
  active: z.boolean().optional().default(true),
  password: z.string().min(6).optional(),
});

adminRouter.post(
  '/members',
  asyncHandler(async (req, res) => {
    const b = memberSchema.parse(req.body);
    const existing = b.id ? await findById(b.id) : undefined;
    const id = existing?.id || b.id || newId('M-');
    const passwordHash = b.password ? await hashPassword(b.password) : existing?.passwordHash || '';
    await upsertMember({
      id,
      fullName: b.fullName,
      dob: b.dob || null,
      position: b.position,
      teamId: b.teamId as never,
      role: b.role,
      salary: b.salary,
      bhxh: b.bhxh,
      joinDate: b.joinDate || null,
      email: b.email,
      passwordHash,
      active: b.active,
    });
    res.json({ ok: true, id });
  }),
);

adminRouter.post(
  '/members/:id/password',
  asyncHandler(async (req, res) => {
    const { password } = z.object({ password: z.string().min(6) }).parse(req.body);
    const m = await findById(String(req.params.id));
    if (!m) throw new ApiError(404, 'Không tìm thấy thành viên');
    await upsertMember({ ...m, passwordHash: await hashPassword(password) });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/config',
  asyncHandler(async (req, res) => {
    const { key, value } = z.object({ key: z.string().min(1), value: z.string() }).parse(req.body);
    await setConfigValue(key, value);
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/catalog',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        code: z.string().min(1),
        name: z.string().min(1),
        points: z.number(),
        active: z.boolean().optional().default(true),
        note: z.string().optional().default(''),
      })
      .parse(req.body);
    await upsertCatalogItem({ code: b.code, name: b.name, points: b.points, active: b.active, note: b.note });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/holidays',
  asyncHandler(async (req, res) => {
    const b = z.object({ date: z.string().min(1), name: z.string().min(1) }).parse(req.body);
    await upsertHoliday(b.date, b.name);
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/teams',
  asyncHandler(async (req, res) => {
    const b = z
      .object({ id: z.string().min(1), name: z.string().optional(), leaderMemberId: z.string().optional().default('') })
      .parse(req.body);
    await upsertTeam({ id: b.id, name: b.name || b.id, leaderMemberId: b.leaderMemberId });
    res.json({ ok: true });
  }),
);

// Gemini OAuth: return the Google consent URL (admin pastes the resulting
// refresh token into GEMINI_OAUTH_REFRESH_TOKEN). See gemini/auth.ts.
adminRouter.get(
  '/google/auth-url',
  asyncHandler(async (_req, res) => {
    const { getAuthUrl } = await import('../gemini/auth.js');
    res.json({ url: getAuthUrl() });
  }),
);
