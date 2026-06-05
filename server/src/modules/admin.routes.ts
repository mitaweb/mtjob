import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { syncMembersFromSource } from './admin.sync.js';
import { getAllMembers, findById, publicMember } from './members.repo.js';
import { hashPassword } from '../auth/password.js';
import { upsertByKey } from '../sheets/repo.js';
import { clearConfigCache } from '../config.js';
import { newId } from '../util/id.js';
import type { Member } from '../types.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin', 'director'));

adminRouter.post(
  '/sync-members',
  asyncHandler(async (_req, res) => {
    res.json(await syncMembersFromSource());
  }),
);

adminRouter.get(
  '/members',
  asyncHandler(async (_req, res) => {
    res.json({ members: (await getAllMembers()).map(publicMember) });
  }),
);

function memberToRow(m: Member): Record<string, unknown> {
  return {
    MemberID: m.id,
    FullName: m.fullName,
    DOB: m.dob || '',
    Position: m.position,
    TeamID: m.teamId,
    Role: m.role,
    Salary: m.salary,
    BHXH: m.bhxh,
    JoinDate: m.joinDate || '',
    Email: m.email,
    PasswordHash: m.passwordHash,
    Active: m.active ? 'TRUE' : 'FALSE',
  };
}

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
    await upsertByKey('Members', 'MemberID', {
      MemberID: id,
      FullName: b.fullName,
      DOB: b.dob,
      Position: b.position,
      TeamID: b.teamId,
      Role: b.role,
      Salary: b.salary,
      BHXH: b.bhxh,
      JoinDate: b.joinDate,
      Email: b.email,
      PasswordHash: passwordHash,
      Active: b.active ? 'TRUE' : 'FALSE',
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
    await upsertByKey('Members', 'MemberID', {
      ...memberToRow(m),
      PasswordHash: await hashPassword(password),
    });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/config',
  asyncHandler(async (req, res) => {
    const { key, value } = z.object({ key: z.string().min(1), value: z.string() }).parse(req.body);
    await upsertByKey('Config', 'Key', { Key: key, Value: value });
    clearConfigCache();
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
    await upsertByKey('TaskCatalog', 'TaskCode', {
      TaskCode: b.code.toUpperCase(),
      TaskName: b.name,
      Points: b.points,
      Active: b.active ? 'TRUE' : 'FALSE',
      Note: b.note,
    });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/holidays',
  asyncHandler(async (req, res) => {
    const b = z.object({ date: z.string().min(1), name: z.string().min(1) }).parse(req.body);
    await upsertByKey('Holidays', 'Date', {
      Date: b.date,
      Name: b.name,
      Year: Number(b.date.slice(0, 4)) || '',
    });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/teams',
  asyncHandler(async (req, res) => {
    const b = z
      .object({ id: z.string().min(1), name: z.string().optional(), leaderMemberId: z.string().optional().default('') })
      .parse(req.body);
    await upsertByKey('Teams', 'TeamID', {
      TeamID: b.id,
      TeamName: b.name || b.id,
      LeaderMemberID: b.leaderMemberId,
    });
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
