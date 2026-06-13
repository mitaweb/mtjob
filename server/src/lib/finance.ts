// Billing-cycle date helpers for receivables. Pure & unit-tested.
import { dayjs } from './datetime.js';

/** Ngày thu kế tiếp (>= fromIso) cho 1 ngày-trong-tháng dueDay (clamp về cuối tháng nếu vượt). */
export function nextDueDateIso(dueDay: number, fromIso: string): string {
  let d = dayjs(fromIso).startOf('day');
  for (let i = 0; i < 2; i++) {
    const day = Math.min(Math.max(1, dueDay), d.daysInMonth());
    const cand = d.date(day);
    if (!cand.isBefore(d)) return cand.format('YYYY-MM-DD');
    d = d.add(1, 'month').startOf('month');
  }
  return d.format('YYYY-MM-DD');
}

/** Số ngày từ fromIso đến targetIso (âm nếu đã qua). */
export function daysUntil(targetIso: string, fromIso: string): number {
  return dayjs(targetIso).startOf('day').diff(dayjs(fromIso).startOf('day'), 'day');
}
