import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import {
  getParties,
  upsertParty,
  deleteParty,
  setPartyEndMonth,
  partyHasEntries,
  getEntries,
  addEntry,
  deleteEntry,
  paidByPartyMonth,
  tongTheoThang,
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
  congNoBen,
  luyKeLaiLo,
  doanhThuTheoNguon,
  boSungNguon,
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
      parties: parties.flatMap((p) => {
        const lichSu = p.kind === 'once' ? [] : rates.get(p.id) || [];
        const c = congNoBen(p, lichSu, paid[p.id] || {}, month);
        // Đã ngưng và đã thu đủ → tháng sau không hiện nữa (anh Tâm 30/9/2026).
        if (!c.hien) return [];
        return [
          {
            ...p,
            /** Mức của riêng tháng đang xem — bảng và hộp thu dùng số này, không dùng `receivable`. */
            receivableThisMonth: c.mucThang,
            rates: lichSu,
            nextDue: nextDueDateIso(p.dueDay, today),
            carryOver: c.carryOver,
            thisMonthRemaining: c.thisMonthRemaining,
            paidToOld: c.paidToOld,
            paidTotal: c.paidTotal,
            totalDue: c.totalDue,
            credit: c.credit,
            unpaidMonths: c.unpaidMonths,
            /** Đã qua tháng cuối, còn hiện chỉ vì chưa thu đủ. */
            daNgung: c.daNgung,
          },
        ];
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
      endMonth: '', // upsertParty không ghi cột này — ngưng/khôi phục đi đường riêng
    };
    await upsertParty(party);
    res.json({ ok: true, id: party.id });
  }),
);

/**
 * "Xoá" một bên = NGƯNG dịch vụ: tháng đang xem là tháng cuối, tháng sau không hiện nữa.
 *
 * Anh Tâm 30/9/2026: "nhận tiền xong xoá đơn vị đó khỏi hàng tháng có nghĩa là anh đã ngưng
 * dịch vụ, đó là tháng cuối, [khoản đã thu] em vẫn ghi nhận". Không xoá dòng: các tháng trước
 * vẫn xem lại được, khoản thu vẫn biết của ai và thuộc nguồn nào.
 *
 * Bên CHƯA có khoản thu nào (tạo nhầm) thì xoá hẳn — không có gì để giữ.
 */
financeRouter.delete(
  '/parties/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const month = ym(req);
    if (!(await partyHasEntries(id))) {
      await deleteParty(id);
      res.json({ ok: true, removed: true });
      return;
    }
    if (!(await setPartyEndMonth(id, month))) throw new ApiError(404, 'Không tìm thấy bên');
    res.json({ ok: true, removed: false, endMonth: month });
  }),
);

/** Khôi phục bên đã ngưng — khách quay lại dùng dịch vụ. */
financeRouter.post(
  '/parties/:id/restore',
  canEdit,
  asyncHandler(async (req, res) => {
    if (!(await setPartyEndMonth(String(req.params.id), ''))) throw new ApiError(404, 'Không tìm thấy bên');
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
    res.json({ ok: true, collected: r.collected, amount: r.amount, phanBo: r.phanBo });
  }),
);

// ---- Thu / Chi theo tháng + lãi lỗ ----
financeRouter.get(
  '/summary',
  canView,
  asyncHandler(async (req, res) => {
    const month = ym(req);
    const [entriesGoc, allParties, customers, rates, theoThang] = await Promise.all([
      getEntries(month),
      getParties(),
      getCustomers(),
      getPartyRates(),
      tongTheoThang(month),
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
    // Cùng một hàm với bảng các bên — thẻ tổng và bảng không thể lệch nhau. Bên đã ngưng không
    // phát sinh kỳ mới; còn nợ thì vẫn nằm trong nợ cũ.
    let receivableTotal = 0;
    let carryOverTotal = 0;
    for (const p of parties) {
      const c = congNoBen(p, p.kind === 'once' ? [] : rates.get(p.id) || [], paid[p.id] || {}, month);
      if (!c.hien) continue;
      // Khoản một lần góp phần CÒN PHẢI ĐÒI, không phải cả hợp đồng mỗi tháng.
      receivableTotal += p.kind === 'once' ? c.totalDue : c.mucThang;
      carryOverTotal += c.carryOver;
    }

    res.json({
      month,
      income,
      expense,
      profit: income - expense,
      receivableTotal,
      carryOverTotal,
      theoNguon: doanhThuTheoNguon(entries),
      /** Lãi/lỗ từng tháng + cộng dồn, từ tháng đầu tiên có số tới tháng đang xem. */
      luyKe: luyKeLaiLo(theoThang, month),
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
