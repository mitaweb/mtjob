// Working-day calendar (Mon-Fri minus configured holidays). Pure & unit-tested.
import { dayjs } from './datetime.js';

export type HolidaySet = Set<string>; // entries are 'YYYY-MM-DD'

export function isWeekend(isoDate: string): boolean {
  const dow = dayjs(isoDate).day(); // 0 = Sunday, 6 = Saturday
  return dow === 0 || dow === 6;
}

export function isHoliday(isoDate: string, holidays: HolidaySet): boolean {
  return holidays.has(isoDate);
}

export function isWorkday(isoDate: string, holidays: HolidaySet = new Set()): boolean {
  return !isWeekend(isoDate) && !isHoliday(isoDate, holidays);
}

/** Count standard working days (Mon-Fri minus holidays) in a given year/month. */
export function standardWorkingDays(
  year: number,
  month: number,
  holidays: HolidaySet = new Set(),
): number {
  const first = dayjs(`${year}-${String(month).padStart(2, '0')}-01`);
  const days = first.daysInMonth();
  let count = 0;
  for (let d = 1; d <= days; d++) {
    const iso = first.date(d).format('YYYY-MM-DD');
    if (isWorkday(iso, holidays)) count++;
  }
  return count;
}

/** Mọi ngày làm việc (T2–T6, trừ ngày lễ) trong tháng, theo thứ tự. */
export function workdaysInMonth(year: number, month: number, holidays: HolidaySet = new Set()): string[] {
  const first = dayjs(`${year}-${String(month).padStart(2, '0')}-01`);
  const out: string[] = [];
  for (let d = 1; d <= first.daysInMonth(); d++) {
    const iso = first.date(d).format('YYYY-MM-DD');
    if (isWorkday(iso, holidays)) out.push(iso);
  }
  return out;
}

export interface MissingOpts {
  /** Hôm nay (YYYY-MM-DD) — ngày chưa tới thì chưa tính là thiếu. */
  today: string;
  /** Ngày vào làm; trước đó chưa đi làm nên không tính. '' = bỏ qua. */
  joinDate?: string;
}

/**
 * Những ngày làm việc KHÔNG có công — tức quên chấm hoặc quên làm đơn.
 *
 * Anh Tâm 2/8/2026: nhân sự cần tự soi được để biết ngày nào còn thiếu, thay vì tới
 * cuối tháng mới phát hiện lúc tính lương.
 *
 * @param daysWithCredit ngày đã có công (dayFraction > 0)
 */
export function missingWorkdays(
  workdays: string[],
  daysWithCredit: Set<string>,
  opts: MissingOpts,
): string[] {
  const join = (opts.joinDate || '').slice(0, 10);
  return workdays.filter((d) => {
    if (d > opts.today) return false; // ngày chưa tới
    if (join && d < join) return false; // trước khi vào làm
    return !daysWithCredit.has(d);
  });
}
