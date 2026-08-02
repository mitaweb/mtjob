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

/**
 * Tháng bắt đầu theo dõi công nợ trong app.
 *
 * Anh Tâm chốt 1/8/2026: lấy tháng 8/2026 làm vạch xuất phát. Mọi kỳ TRƯỚC mốc này coi
 * như đã xử lý xong ngoài app — không tính là nợ. Nếu lùi tới ngày bắt đầu hợp đồng thì
 * những tháng đã thu bằng tiền mặt sẽ bị đếm thành chưa thu, và bảng sẽ hiện nợ ảo
 * hàng trăm triệu.
 */
export const DEBT_TRACK_FROM = '2026-08';

/** Danh sách kỳ (YYYY-MM) đã tới hạn, từ mốc theo dõi tới tháng đang xem — cũ trước. */
export function debtMonths(fromMonth: string, toMonth: string): string[] {
  const start = fromMonth > DEBT_TRACK_FROM ? fromMonth : DEBT_TRACK_FROM;
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(toMonth) || start > toMonth) return [];

  const out: string[] = [];
  let [y, m] = start.split('-').map(Number);
  while (`${y}-${String(m).padStart(2, '0')}` <= toMonth) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export interface DebtInput {
  /** Phải thu mỗi kỳ. */
  receivable: number;
  /** Tháng bắt đầu tính của riêng bên này (thường lấy từ start_date), '' = theo mốc chung. */
  startMonth: string;
  /** Tháng đang xem, YYYY-MM. */
  month: string;
  /** Đã thu thực tế theo từng kỳ: { '2026-08': 21000000 }. */
  paid: Record<string, number>;
}

export interface DebtResult {
  /** Phải thu của riêng kỳ đang xem. */
  thisMonth: number;
  /** Còn nợ của các kỳ TRƯỚC kỳ đang xem. */
  carryOver: number;
  /** Tổng phải đòi = nợ cũ + kỳ này − đã thu kỳ này. */
  total: number;
  /** Các kỳ cũ còn thiếu, để hiện khi rê chuột. */
  unpaidMonths: string[];
}

/**
 * Nợ luỹ kế của một bên.
 *
 * Tính theo SỐ TIỀN còn thiếu chứ không đếm kỳ chưa tick: thu một phần (ví dụ đóng 10tr
 * trên 21tr) vẫn phải giữ lại 11tr trong nợ cũ.
 */
export function computeDebt(input: DebtInput): DebtResult {
  const per = Math.max(0, Math.round(input.receivable) || 0);
  const months = debtMonths(input.startMonth, input.month);

  let carryOver = 0;
  const unpaidMonths: string[] = [];
  for (const m of months) {
    if (m >= input.month) continue; // kỳ đang xem tính riêng bên dưới
    const con = Math.max(0, per - (input.paid[m] || 0));
    if (con > 0) {
      carryOver += con;
      unpaidMonths.push(m);
    }
  }

  // Kỳ đang xem chỉ tính khi đã tới mốc theo dõi.
  const thisMonth = months.includes(input.month) ? per : 0;
  const paidThis = input.paid[input.month] || 0;
  return {
    thisMonth,
    carryOver,
    total: Math.max(0, carryOver + thisMonth - paidThis),
    unpaidMonths,
  };
}
