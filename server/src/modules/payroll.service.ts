import { getActiveMembers, findById } from './members.repo.js';
import { getAllAttendance } from './attendance.repo.js';
import { getHolidaySet } from './holidays.repo.js';
import { getConfig } from '../config.js';
import { q } from '../db/client.js';
import { standardWorkingDays } from '../lib/workdays.js';
import { computeNetSalary } from '../lib/money.js';
import { inRange } from '../lib/scores.js';
import { monthRange } from '../lib/datetime.js';
import type { AttendanceRow } from '../types.js';

export interface PayrollLine {
  memberId: string;
  fullName: string;
  teamId: string;
  year: number;
  month: number;
  standardDays: number;
  actualDays: number;
  grossSalary: number;
  proratedSalary: number; // lương theo công = gross/std*actual (trước khi trừ BHXH)
  bhxh: number;
  netSalary: number;
}

function sumActualDays(att: AttendanceRow[], memberId: string, start: string, end: string): number {
  return att
    .filter((a) => a.memberId === memberId && inRange(a.date, start, end))
    .reduce((s, a) => s + (Number(a.dayFraction) || 0), 0);
}

/** Payroll lines for everyone except the director (who is excluded from payroll). */
export async function payrollForMonth(year: number, month: number): Promise<PayrollLine[]> {
  const { start, end } = monthRange(year, month);
  const [holidays, cfg, members, att] = await Promise.all([
    getHolidaySet(),
    getConfig(),
    getActiveMembers(),
    getAllAttendance(),
  ]);
  const std = standardWorkingDays(year, month, holidays);

  return members
    .filter((m) => m.role !== 'director')
    .map((m) => {
      const actualDays = sumActualDays(att, m.id, start, end);
      const r = computeNetSalary({
        grossSalary: m.salary,
        standardDays: std,
        actualDays,
        bhxh: m.bhxh,
        bhxhMode: cfg.bhxhMode,
      });
      return {
        memberId: m.id,
        fullName: m.fullName,
        teamId: m.teamId,
        year,
        month,
        standardDays: std,
        actualDays,
        grossSalary: m.salary,
        proratedSalary: r.proratedSalary,
        bhxh: r.bhxhDeduction,
        netSalary: r.netSalary,
      };
    });
}

export async function payrollForMember(
  memberId: string,
  year: number,
  month: number,
): Promise<PayrollLine | null> {
  const m = await findById(memberId);
  if (!m || m.role === 'director') return null;
  const lines = await payrollForMonth(year, month);
  return lines.find((l) => l.memberId === memberId) ?? null;
}

/** Compute + persist a monthly snapshot into the payroll table (used by the monthly job + khi chốt). */
export async function savePayrollSnapshot(year: number, month: number): Promise<PayrollLine[]> {
  const lines = await payrollForMonth(year, month);
  for (const l of lines) {
    await q(
      `INSERT INTO payroll (year, month, member_id, full_name, team_id, standard_days, actual_days, gross_salary, prorated_salary, bhxh, net_salary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (year, month, member_id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         team_id = EXCLUDED.team_id,
         standard_days = EXCLUDED.standard_days,
         actual_days = EXCLUDED.actual_days,
         gross_salary = EXCLUDED.gross_salary,
         prorated_salary = EXCLUDED.prorated_salary,
         bhxh = EXCLUDED.bhxh,
         net_salary = EXCLUDED.net_salary`,
      [l.year, l.month, l.memberId, l.fullName, l.teamId, l.standardDays, l.actualDays, l.grossSalary, l.proratedSalary, l.bhxh, l.netSalary],
    );
  }
  return lines;
}

/** Tháng đã chốt lương chưa? */
export async function isMonthLocked(year: number, month: number): Promise<boolean> {
  const r = await q('SELECT 1 FROM payroll_locks WHERE year = $1 AND month = $2 LIMIT 1', [year, month]);
  return r.length > 0;
}

/** Đọc snapshot lương đã chốt (đóng băng — gồm cả nhân sự đã nghỉ). */
export async function getPayrollSnapshot(year: number, month: number): Promise<PayrollLine[]> {
  const rows = await q(
    'SELECT * FROM payroll WHERE year = $1 AND month = $2 ORDER BY full_name',
    [year, month],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => ({
    memberId: r.member_id || '',
    fullName: r.full_name || '',
    teamId: r.team_id || '',
    year,
    month,
    standardDays: Number(r.standard_days) || 0,
    actualDays: Number(r.actual_days) || 0,
    grossSalary: Number(r.gross_salary) || 0,
    proratedSalary: Number(r.prorated_salary) || 0,
    bhxh: Number(r.bhxh) || 0,
    netSalary: Number(r.net_salary) || 0,
  }));
}

/** Chốt lương tháng: chụp snapshot + ghi khoá. */
export async function lockPayrollMonth(year: number, month: number, byName: string, atIso: string): Promise<void> {
  await savePayrollSnapshot(year, month);
  await q(
    `INSERT INTO payroll_locks (year, month, locked_at, locked_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (year, month) DO UPDATE SET locked_at = EXCLUDED.locked_at, locked_by = EXCLUDED.locked_by`,
    [year, month, atIso, byName],
  );
}

/** Mở lại tháng đã chốt (cho phép sửa + tính lại). */
export async function unlockPayrollMonth(year: number, month: number): Promise<void> {
  await q('DELETE FROM payroll_locks WHERE year = $1 AND month = $2', [year, month]);
}
