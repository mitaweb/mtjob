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
