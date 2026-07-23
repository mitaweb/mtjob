import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import {
  getParties,
  upsertParty,
  deleteParty,
  getEntries,
  addEntry,
  deleteEntry,
  type Party,
} from './finance.repo.js';
import { collectReceivable } from './finance.service.js';
import { payrollForMonth } from './payroll.service.js';
import { getActiveMembers } from './members.repo.js';
import { nextDueDateIso } from '../lib/finance.js';
import { todayIso, nowTz } from '../lib/datetime.js';
import { newId } from '../util/id.js';

export const financeRouter = Router();
financeRouter.use(requireAuth);

const canView = requireRole('director', 'admin', 'accountant');
const canEdit = requireRole('director', 'admin'); // chỉ admin/giám đốc nhập liệu

function ym(req: { query: Record<string, unknown> }): string {
  const m = String(req.query.month || '');
  if (/^\d{4}-\d{2}$/.test(m)) return m;
  return nowTz().format('YYYY-MM');
}

// ---- Bên (công nợ phải thu) ----
financeRouter.get(
  '/parties',
  canView,
  asyncHandler(async (_req, res) => {
    const today = todayIso();
    const parties = await getParties();
    res.json({
      parties: parties.map((p) => ({ ...p, nextDue: nextDueDateIso(p.dueDay, today) })),
    });
  }),
);

const partySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  startDate: z.string().optional().default(''),
  dueDay: z.number().int().min(1).max(31),
  receivable: z.number().min(0),
  notifyMemberIds: z.array(z.string()).optional().default([]),
  note: z.string().optional().default(''),
  active: z.boolean().optional().default(true),
});

financeRouter.post(
  '/parties',
  canEdit,
  asyncHandler(async (req, res) => {
    const b = partySchema.parse(req.body);
    const party: Party = {
      id: b.id || newId('B-'),
      name: b.name,
      startDate: b.startDate,
      dueDay: b.dueDay,
      receivable: b.receivable,
      notifyMemberIds: b.notifyMemberIds,
      note: b.note,
      active: b.active,
    };
    await upsertParty(party);
    res.json({ ok: true, id: party.id });
  }),
);

financeRouter.delete(
  '/parties/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    await deleteParty(String(req.params.id));
    res.json({ ok: true });
  }),
);

// Đánh dấu ĐÃ THU công nợ của 1 bên trong tháng → tự tạo/gỡ 1 khoản Thu (income).
// Mã cố định RECV-<bên>-<tháng> để tick/bỏ tick không nhân bản.
const collectSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  collected: z.boolean(),
  /** Số thực thu. Bỏ trống khi collected=true = thu toàn bộ số phải thu. */
  amount: z.number().min(0).optional(),
});
financeRouter.post(
  '/parties/:id/collect',
  canEdit,
  asyncHandler(async (req, res) => {
    const b = collectSchema.parse(req.body);
    const r = await collectReceivable({ partyId: String(req.params.id), ...b });
    if (!r.ok) throw new ApiError(404, r.message || 'Không thu được');
    res.json({ ok: true, collected: r.collected, amount: r.amount });
  }),
);

// ---- Thu / Chi theo tháng + lãi lỗ ----
financeRouter.get(
  '/summary',
  canView,
  asyncHandler(async (req, res) => {
    const month = ym(req);
    const entries = await getEntries(month);
    const income = entries.filter((e) => e.kind === 'thu').reduce((s, e) => s + e.amount, 0);
    const expense = entries.filter((e) => e.kind === 'chi').reduce((s, e) => s + e.amount, 0);
    const receivableTotal = (await getParties()).filter((p) => p.active).reduce((s, p) => s + p.receivable, 0);
    res.json({ month, income, expense, profit: income - expense, receivableTotal, entries });
  }),
);

const entrySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  kind: z.enum(['thu', 'chi']),
  name: z.string().min(1),
  amount: z.number().min(0),
  date: z.string().optional().default(''),
  recurring: z.boolean().optional().default(false),
  partyId: z.string().optional().default(''),
});

financeRouter.post(
  '/entries',
  canEdit,
  asyncHandler(async (req, res) => {
    const b = entrySchema.parse(req.body);
    const id = newId('F-');
    await addEntry({ id, ...b });
    res.json({ ok: true, id });
  }),
);

financeRouter.delete(
  '/entries/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    await deleteEntry(String(req.params.id));
    res.json({ ok: true });
  }),
);

// ---- Lương nhân sự (chỉ xem) — cho kế toán ----
financeRouter.get(
  '/payroll',
  canView,
  asyncHandler(async (req, res) => {
    const now = nowTz();
    const year = Number(req.query.year) || now.year();
    const month = Number(req.query.month) || now.month() + 1;
    const lines = await payrollForMonth(year, month);
    const byId = new Map((await getActiveMembers()).map((m) => [m.id, m]));
    res.json({
      year,
      month,
      rows: lines.map((l) => ({
        memberId: l.memberId,
        fullName: l.fullName,
        teamId: l.teamId,
        salary: byId.get(l.memberId)?.salary ?? l.grossSalary,
        actualDays: l.actualDays,
        standardDays: l.standardDays,
        netSalary: l.netSalary,
      })),
    });
  }),
);

// Danh sách thành viên (để chọn người nhận nhắc thu).
financeRouter.get(
  '/members',
  canView,
  asyncHandler(async (_req, res) => {
    const members = await getActiveMembers();
    res.json({ members: members.map((m) => ({ id: m.id, fullName: m.fullName, role: m.role })) });
  }),
);
