import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { syncMembersFromSource, syncCatalogFromSource } from './admin.sync.js';
import { getAllMembers, getActiveMembers, findById, publicMember, upsertMember } from './members.repo.js';
import { upsertCatalogItem } from './catalog.repo.js';
import { upsertHoliday } from './holidays.repo.js';
import { upsertTeam } from './teams.repo.js';
import { getForMemberRange, saveAttendance } from './attendance.repo.js';
import { payrollForMonth } from './payroll.service.js';
import { hashPassword } from '../auth/password.js';
import { setConfigValue } from '../config.js';
import { newId } from '../util/id.js';
import { nowTz, monthRange, fmtHm, dayjs, TZ } from '../lib/datetime.js';
import { dayFractionFromShifts } from '../lib/attendance.js';

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
  username: z.string().optional().default(''),
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
    const { vnUsername } = await import('../lib/people.js');
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
      username: b.username || existing?.username || vnUsername(b.fullName),
      email: existing?.email || '',
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

function ymOf(req: { query: Record<string, unknown> }): { year: number; month: number } {
  const now = nowTz();
  return { year: Number(req.query.year) || now.year(), month: Number(req.query.month) || now.month() + 1 };
}

// Bảng lương & công: từng nhân viên (trừ giám đốc) + base salary/bhxh để sửa thủ công.
adminRouter.get(
  '/payroll',
  asyncHandler(async (req, res) => {
    const { year, month } = ymOf(req);
    const lines = await payrollForMonth(year, month);
    const byId = new Map((await getActiveMembers()).map((m) => [m.id, m]));
    const rows = lines.map((l) => {
      const m = byId.get(l.memberId);
      return {
        memberId: l.memberId,
        fullName: l.fullName,
        teamId: l.teamId,
        salary: m?.salary ?? l.grossSalary, // Mức lương (base)
        bhxh: m?.bhxh ?? 0, // mức đóng BHXH (base)
        standardDays: l.standardDays,
        actualDays: l.actualDays,
        netSalary: l.netSalary,
      };
    });
    res.json({ year, month, rows });
  }),
);

// Chấm công của 1 thành viên trong tháng (để sửa giờ vào/ra cho đúng công).
adminRouter.get(
  '/attendance',
  asyncHandler(async (req, res) => {
    const memberId = String(req.query.memberId || '');
    if (!memberId) throw new ApiError(400, 'Thiếu memberId');
    const { year, month } = ymOf(req);
    const { start, end } = monthRange(year, month);
    const records = (await getForMemberRange(memberId, start, end)).map((r) => ({
      date: r.date,
      morningIn: r.morningInAt ? fmtHm(r.morningInAt) : '',
      morningOut: r.morningOutAt ? fmtHm(r.morningOutAt) : '',
      afternoonIn: r.afternoonInAt ? fmtHm(r.afternoonInAt) : '',
      afternoonOut: r.afternoonOutAt ? fmtHm(r.afternoonOutAt) : '',
      dayFraction: r.dayFraction,
      mode: r.mode,
    }));
    res.json({ year, month, records });
  }),
);

const attnSchema = z.object({
  memberId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ'),
  morningIn: z.string().optional().default(''),
  morningOut: z.string().optional().default(''),
  afternoonIn: z.string().optional().default(''),
  afternoonOut: z.string().optional().default(''),
  dayFraction: z.number().min(0).max(1).optional(),
  mode: z.enum(['office', 'online', 'leave', 'holiday']).optional().default('office'),
});

// Sửa/ghi đè 1 ngày chấm công (giờ HH:mm); công tự tính lại từ ca có giờ vào, hoặc nhập tay.
adminRouter.post(
  '/attendance',
  asyncHandler(async (req, res) => {
    const b = attnSchema.parse(req.body);
    const member = await findById(b.memberId);
    if (!member) throw new ApiError(404, 'Không tìm thấy thành viên');
    const toIso = (t: string) => (t ? dayjs.tz(`${b.date} ${t}`, 'YYYY-MM-DD HH:mm', TZ).toISOString() : '');
    const morningInAt = toIso(b.morningIn);
    const afternoonInAt = toIso(b.afternoonIn);
    const fraction =
      b.dayFraction != null ? b.dayFraction : dayFractionFromShifts({ morningIn: morningInAt, afternoonIn: afternoonInAt });
    const status = b.mode === 'leave' ? 'leave' : fraction >= 1 ? 'present' : fraction > 0 ? 'half' : 'absent';
    await saveAttendance({
      date: b.date,
      memberId: b.memberId,
      name: member.fullName,
      morningInAt,
      morningOutAt: toIso(b.morningOut),
      afternoonInAt,
      afternoonOutAt: toIso(b.afternoonOut),
      dayFraction: fraction,
      mode: b.mode,
      status,
      note: 'Sửa bởi quản trị',
    });
    res.json({ ok: true, dayFraction: fraction });
  }),
);

// Gemini OAuth: return the Google consent URL (admin pastes the resulting
// refresh token into GEMINI_OAUTH_REFRESH_TOKEN). See gemini/auth.ts.
adminRouter.get(
  '/google/auth-url',
  asyncHandler(async (_req, res) => {
    if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
      throw new ApiError(
        400,
        'Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET. Cách nhanh hơn: lấy API key tại aistudio.google.com/apikey rồi thêm biến GEMINI_API_KEY.',
      );
    }
    const { getAuthUrl } = await import('../gemini/auth.js');
    res.json({ url: getAuthUrl() });
  }),
);
