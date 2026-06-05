import { getActiveMembers, findById } from './members.repo.js';
import { getAllAttendance } from './attendance.repo.js';
import { getHolidaySet } from './holidays.repo.js';
import { getConfig } from '../config.js';
import { appendObjects } from '../sheets/repo.js';
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

/** Compute + persist a monthly snapshot into the Payroll tab (used by the monthly job). */
export async function savePayrollSnapshot(year: number, month: number): Promise<PayrollLine[]> {
  const lines = await payrollForMonth(year, month);
  await appendObjects(
    'Payroll',
    lines.map((l) => ({
      Year: l.year,
      Month: l.month,
      MemberID: l.memberId,
      StandardDays: l.standardDays,
      ActualDays: l.actualDays,
      GrossSalary: l.grossSalary,
      BHXH: l.bhxh,
      NetSalary: l.netSalary,
    })),
  );
  return lines;
}
