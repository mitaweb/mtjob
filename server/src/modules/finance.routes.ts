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
  paidByPartyMonth,
  getPartyRates,
  upsertPartyRate,
  deletePartyRates,
  type Party,
} from './finance.repo.js';
import { addPayment } from './finance.service.js';
import { payrollForMonth } from './payroll.service.js';
import { getActiveMembers } from './members.repo.js';
import { findCustomer, getCustomers } from './crm.repo.js';
import {
  nextDueDateIso,
  computeDebt,
  computeOnceDebt,
  doanhThuTheoNguon,
  boSungNguon,
  mucTheoThang,
  DEBT_TRACK_FROM,
} from '../lib/finance.js';
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
  asyncHandler(async (req, res) => {
    const today = todayIso();
    const month = ym(req);
    const [parties, paid, rates] = await Promise.all([
      getParties(),
      paidByPartyMonth(DEBT_TRACK_FROM),
      getPartyRates(),
    ]);

    res.json({
      debtFrom: DEBT_TRACK_FROM,
      parties: parties.map((p) => {
        // Khoản MỘT LẦN: không có kỳ tháng, còn nợ = tổng − mọi đợt đã trả.
        if (p.kind === 'once') {
          const d = computeOnceDebt({
            total: p.receivable,
            startMonth: (p.startDate || '').slice(0, 7),
            month,
            paid: paid[p.id] || {},
          });
          return {
            ...p,
            receivableThisMonth: d.total,
            rates: [],
            nextDue: nextDueDateIso(p.dueDay, today),
            carryOver: 0,
            thisMonthRemaining: d.remaining,
            paidToOld: 0,
            paidTotal: d.paidTotal,
            totalDue: d.remaining,
            credit: d.credit,
            unpaidMonths: [],
          };
        }
        const lichSu = rates.get(p.id) || [];
        const debt = computeDebt({
          receivable: p.receivable,
          rates: lichSu,
          // Bên vào sau mốc chung thì tính từ tháng của bên đó, khỏi đội nợ những kỳ
          // chưa hợp tác.
          startMonth: (p.startDate || '').slice(0, 7),
          month,
          paid: paid[p.id] || {},
        });
        return {
          ...p,
          /** Mức của riêng tháng đang xem — bảng và hộp thu dùng số này, không dùng `receivable`. */
          receivableThisMonth: mucTheoThang(lichSu, p.receivable, month),
          rates: lichSu,
          nextDue: nextDueDateIso(p.dueDay, today),
          carryOver: debt.carryOver,
          thisMonthRemaining: debt.thisMonthRemaining,
          paidToOld: debt.paidToOld,
          totalDue: debt.total,
          credit: debt.credit,
          unpaidMonths: debt.unpaidMonths,
        };
      }),
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
  /** Nguồn khách — mọi khoản thu của bên này thừa hưởng, khỏi chọn lại mỗi tháng. */
  source: z.string().max(60).optional().default(''),
  /** 'once' = khoản một lần trả nhiều đợt (receivable là tổng hợp đồng). */
  kind: z.enum(['monthly', 'once']).optional().default('monthly'),
  /**
   * Mức phải thu mới áp dụng từ tháng nào (YYYY-MM). Bỏ trống = tháng hiện tại.
   * Chuỗi rỗng '' = "sửa cả các tháng trước": xoá lịch sử, mức mới áp cho mọi tháng.
   */
  applyFrom: z.string().regex(/^(\d{4}-\d{2})?$/).optional(),
});

financeRouter.post(
  '/parties',
  canEdit,
  asyncHandler(async (req, res) => {
    const b = partySchema.parse(req.body);

    // Đổi MỨC của bên đang có → ghi lịch sử, không để các tháng trước nhảy theo.
    // Anh Tâm 16/9/2026: "đang 3 triệu, kể từ tháng này tăng 6 triệu... chỉ 6 từ tháng cập nhật".
    // Khoản một lần không có lịch sử mức: đổi tổng là đổi tổng, còn nợ tính lại ngay.
    if (b.id && b.kind === 'once') await deletePartyRates(b.id);
    if (b.id && b.kind !== 'once') {
      const cu = (await getParties()).find((p) => p.id === b.id);
      if (cu && cu.receivable !== b.receivable) {
        if (b.applyFrom === '') {
          await deletePartyRates(cu.id); // người sửa nói rõ: áp cho cả quá khứ
        } else {
          const tu = b.applyFrom || nowTz().format('YYYY-MM');
          const daCo = (await getPartyRates()).get(cu.id) || [];
          // Lần đổi đầu tiên: chốt mức cũ cho mọi tháng trước đó, kẻo mất số.
          if (daCo.length === 0) await upsertPartyRate(cu.id, '0000-00', cu.receivable);
          await upsertPartyRate(cu.id, tu, b.receivable);
        }
      }
    }

    const party: Party = {
      id: b.id || newId('B-'),
      name: b.name,
      startDate: b.startDate,
      dueDay: b.dueDay,
      receivable: b.receivable,
      notifyMemberIds: b.notifyMemberIds,
      note: b.note,
      active: b.active,
      source: b.source,
      kind: b.kind,
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

// Ghi nhận MỘT lần khách trả → thêm 1 khoản Thu. Khách trả nhiều lần thì gọi nhiều lần,
// mỗi lần một dòng riêng; gỡ nhầm thì xoá dòng đó qua DELETE /finance/entries/:id.
const collectSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** Số tiền của RIÊNG lần trả này — không phải tổng luỹ kế. */
  amount: z.number().min(1),
  note: z.string().max(200).optional().default(''),
});
financeRouter.post(
  '/parties/:id/collect',
  canEdit,
  asyncHandler(async (req, res) => {
    const b = collectSchema.parse(req.body);
    const r = await addPayment({ partyId: String(req.params.id), ...b });
    if (!r.ok) throw new ApiError(400, r.message || 'Không ghi nhận được');
    res.json({ ok: true, collected: r.collected, amount: r.amount });
  }),
);

// ---- Thu / Chi theo tháng + lãi lỗ ----
financeRouter.get(
  '/summary',
  canView,
  asyncHandler(async (req, res) => {
    const month = ym(req);
    const [entriesGoc, allParties, customers, rates] = await Promise.all([
      getEntries(month),
      getParties(),
      getCustomers(),
      getPartyRates(),
    ]);
    // Khoản thu tạo trước khi bên được chọn nguồn thì đọc theo nguồn hiện tại của bên.
    const entries = boSungNguon(
      entriesGoc,
      new Map(allParties.map((p) => [p.id, p.source || ''])),
      new Map(customers.map((c) => [c.id, c.source || ''])),
    );
    const income = entries.filter((e) => e.kind === 'thu').reduce((s, e) => s + e.amount, 0);
    const expense = entries.filter((e) => e.kind === 'chi').reduce((s, e) => s + e.amount, 0);
    const parties = allParties.filter((p) => p.active);
    const paid = await paidByPartyMonth(DEBT_TRACK_FROM);
    const dinhKy = parties.filter((p) => p.kind !== 'once');
    // Mức của riêng tháng đang xem — bên đổi mức giữa chừng thì tháng cũ vẫn theo mức cũ.
    // Khoản một lần góp phần CÒN PHẢI ĐÒI (tổng − đã trả), không phải cả hợp đồng mỗi tháng.
    const receivableTotal =
      dinhKy.reduce((s, p) => s + mucTheoThang(rates.get(p.id) || [], p.receivable, month), 0) +
      parties
        .filter((p) => p.kind === 'once')
        .reduce(
          (s, p) =>
            s +
            computeOnceDebt({
              total: p.receivable,
              startMonth: (p.startDate || '').slice(0, 7),
              month,
              paid: paid[p.id] || {},
            }).remaining,
          0,
        );

    // Nợ tồn từ các kỳ trước — tách khỏi `receivableTotal` (vốn là tiền của riêng kỳ này)
    // để màn hình nói rõ đâu là tiền tháng này, đâu là tiền còn treo lại.
    const carryOverTotal = dinhKy.reduce(
      (s, p) =>
        s +
        computeDebt({
          receivable: p.receivable,
          rates: rates.get(p.id) || [],
          startMonth: (p.startDate || '').slice(0, 7),
          month,
          paid: paid[p.id] || {},
        }).carryOver,
      0,
    );

    res.json({
      month,
      income,
      expense,
      profit: income - expense,
      receivableTotal,
      carryOverTotal,
      theoNguon: doanhThuTheoNguon(entries),
      entries,
    });
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
  source: z.string().max(60).optional().default(''),
  customerId: z.string().optional().default(''),
});

financeRouter.post(
  '/entries',
  canEdit,
  asyncHandler(async (req, res) => {
    const b = entrySchema.parse(req.body);
    // Chọn khách mà chưa chọn nguồn → lấy nguồn của khách đó. Bắt gõ lại nguồn khi hệ
    // thống đã biết là cách nhanh nhất để hai nơi ghi hai nguồn khác nhau.
    let source = b.source;
    if (!source && b.customerId) {
      source = (await findCustomer(b.customerId))?.source || '';
    }
    const id = newId('F-');
    await addEntry({ ...b, id, source });
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

/**
 * Khách hàng để gắn vào khoản thu — CHỈ tên + nguồn.
 *
 * Không dùng /crm/customers: đường đó chỉ mở cho sale/giám đốc/admin nên kế toán gọi sẽ
 * 403 và vỡ cả trang Tài chính. Ở đây cũng KHÔNG trả số điện thoại — kế toán không cần,
 * và số điện thoại khách chỉ giám đốc mới được xem.
 */
financeRouter.get(
  '/customers',
  canView,
  asyncHandler(async (_req, res) => {
    const list = await getCustomers();
    res.json({ customers: list.map((c) => ({ id: c.id, name: c.name, source: c.source || '' })) });
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
