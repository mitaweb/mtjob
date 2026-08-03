import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { getActiveMembers, findById } from './members.repo.js';
import { getForMemberRange, saveAttendance } from './attendance.repo.js';
import {
  payrollForMonth,
  isMonthLocked,
  getPayrollSnapshot,
  lockPayrollMonth,
  unlockPayrollMonth,
} from './payroll.service.js';
import { dayFractionFromShifts } from '../lib/attendance.js';
import { nowTz, monthRange, fmtHm, dayjs, TZ } from '../lib/datetime.js';

// Bảng lương và chấm công của quản trị: xem lương tháng, chốt/mở khoá, sửa giờ vào ra.
//
// Tách khỏi admin.routes.ts. Cả hai đi chung một file vì chúng dính nhau chặt: sửa chấm
// công là đổi số công, đổi số công là đổi lương — và cùng bị khoá bởi `isMonthLocked`.
//
// Router này gắn vào adminRouter nên đã thừa hưởng requireAuth + requireRole.

export const adminPayrollRouter = Router();

function ymOf(req: { query: Record<string, unknown> }): { year: number; month: number } {
  const now = nowTz();
  return { year: Number(req.query.year) || now.year(), month: Number(req.query.month) || now.month() + 1 };
}

// Bảng lương & công: từng nhân viên (trừ giám đốc) + base salary/bhxh để sửa thủ công.
adminPayrollRouter.get(
  '/payroll',
  asyncHandler(async (req, res) => {
    const { year, month } = ymOf(req);
    const locked = await isMonthLocked(year, month);
    // Đã chốt → đọc snapshot đóng băng (gồm cả nhân sự đã nghỉ); chưa chốt → tính live.
    const lines = locked ? await getPayrollSnapshot(year, month) : await payrollForMonth(year, month);
    const byId = new Map((await getActiveMembers()).map((m) => [m.id, m]));
    const rows = lines.map((l) => {
      const m = byId.get(l.memberId);
      return {
        memberId: l.memberId,
        fullName: l.fullName,
        teamId: l.teamId,
        salary: l.grossSalary, // Mức lương (base) — snapshot đóng băng khi đã chốt
        bhxh: m?.bhxh ?? 0, // mức đóng BHXH (base, không hiển thị)
        standardDays: l.standardDays,
        actualDays: l.actualDays,
        proratedSalary: l.proratedSalary, // lương theo công (trước trừ BHXH)
        bhxhDeduction: l.bhxh, // khoản trừ BHXH thực tế
        netSalary: l.netSalary,
      };
    });
    res.json({ year, month, locked, rows });
  }),
);

const lockSchema = z.object({ year: z.number().int(), month: z.number().int().min(1).max(12) });

// Chốt lương tháng (đóng băng snapshot).
adminPayrollRouter.post(
  '/payroll/lock',
  asyncHandler(async (req, res) => {
    const { year, month } = lockSchema.parse(req.body);
    await lockPayrollMonth(year, month, req.user!.name, nowTz().toISOString());
    res.json({ ok: true, locked: true });
  }),
);

// Mở lại tháng đã chốt để sửa.
adminPayrollRouter.post(
  '/payroll/unlock',
  asyncHandler(async (req, res) => {
    const { year, month } = lockSchema.parse(req.body);
    await unlockPayrollMonth(year, month);
    res.json({ ok: true, locked: false });
  }),
);

// Chấm công của 1 thành viên trong tháng (để sửa giờ vào/ra cho đúng công).
adminPayrollRouter.get(
  '/attendance',
  asyncHandler(async (req, res) => {
    const memberId = String(req.query.memberId || '');
    if (!memberId) throw new ApiError(400, 'Thiếu memberId');
    const { year, month } = ymOf(req);
    const { start, end } = monthRange(year, month);
    // fmtHm trả rỗng khi giá trị không phải mốc giờ thật (chấm công duyệt online ghi cờ
    // 'online' vào ô giờ vào) — nếu không, bảng hiện "Invalid Date".
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
adminPayrollRouter.post(
  '/attendance',
  asyncHandler(async (req, res) => {
    const b = attnSchema.parse(req.body);
    const member = await findById(b.memberId);
    if (!member) throw new ApiError(404, 'Không tìm thấy thành viên');
    const [yy, mm] = [Number(b.date.slice(0, 4)), Number(b.date.slice(5, 7))];
    if (await isMonthLocked(yy, mm)) {
      throw new ApiError(400, `Lương tháng ${mm}/${yy} đã chốt. Bấm "Mở lại" ở Bảng lương nếu cần sửa.`);
    }
    const toIso = (t: string) => (t ? dayjs.tz(`${b.date} ${t}`, 'YYYY-MM-DD HH:mm', TZ).toISOString() : '');
    const morningInAt = toIso(b.morningIn);
    const afternoonInAt = toIso(b.afternoonIn);
    const afternoonOutAt = toIso(b.afternoonOut);
    const fraction =
      b.dayFraction != null
        ? b.dayFraction
        : dayFractionFromShifts({ morningIn: morningInAt, afternoonIn: afternoonInAt, afternoonOut: afternoonOutAt });
    const status = b.mode === 'leave' ? 'leave' : fraction >= 1 ? 'present' : fraction > 0 ? 'half' : 'absent';
    await saveAttendance({
      date: b.date,
      memberId: b.memberId,
      name: member.fullName,
      morningInAt,
      morningOutAt: toIso(b.morningOut),
      afternoonInAt,
      afternoonOutAt,
      dayFraction: fraction,
      mode: b.mode,
      status,
      note: 'Sửa bởi quản trị',
    });
    res.json({ ok: true, dayFraction: fraction });
  }),
);
