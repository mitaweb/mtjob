// Bonus & payroll math. Pure functions — fully unit-tested.

export interface BonusConfig {
  threshold: number;
  step: number;
  amount: number;
}

export const DEFAULT_BONUS: BonusConfig = { threshold: 6000, step: 1000, amount: 800000 };

/**
 * Monthly bonus. Only the points ABOVE `threshold` count; every full `step`
 * grants `amount` VND.
 *   6000 -> 0, 6999 -> 0, 7000 -> 800k, 8000 -> 1.6M, 12000 -> 4.8M
 */
export function computeBonus(points: number, cfg: BonusConfig = DEFAULT_BONUS): number {
  if (!Number.isFinite(points) || points <= cfg.threshold) return 0;
  const units = Math.floor((points - cfg.threshold) / cfg.step);
  return Math.max(0, units) * cfg.amount;
}

export type BhxhMode = 'direct' | 'percent';
/** Employee-side compulsory insurance rate in Vietnam (BHXH 8% + BHYT 1.5% + BHTN 1%). */
export const BHXH_EMPLOYEE_RATE = 0.105;

export interface NetSalaryInput {
  grossSalary: number;
  standardDays: number;
  actualDays: number;
  bhxh: number;
  bhxhMode?: BhxhMode;
}

export interface NetSalaryResult {
  grossSalary: number;
  standardDays: number;
  actualDays: number;
  proratedSalary: number;
  bhxhDeduction: number;
  netSalary: number;
}

/**
 * Net take-home salary:
 *   prorated  = round(grossSalary / standardDays * actualDays)
 *   deduction = bhxhMode==='percent' ? round(bhxh * 10.5%) : round(bhxh)
 *   net       = prorated - deduction
 */
export function computeNetSalary(i: NetSalaryInput): NetSalaryResult {
  const gross = Number(i.grossSalary) || 0;
  const std = Number(i.standardDays) || 0;
  const actual = Number(i.actualDays) || 0;
  const prorated = std > 0 ? Math.round((gross / std) * actual) : 0;
  const bhxhDeduction =
    i.bhxhMode === 'percent'
      ? Math.round((Number(i.bhxh) || 0) * BHXH_EMPLOYEE_RATE)
      : Math.round(Number(i.bhxh) || 0);
  return {
    grossSalary: gross,
    standardDays: std,
    actualDays: actual,
    proratedSalary: prorated,
    bhxhDeduction,
    netSalary: prorated - bhxhDeduction,
  };
}

/** Format a number as Vietnamese currency, e.g. 1600000 -> "1.600.000đ". */
export function formatVnd(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0)) + 'đ';
}
