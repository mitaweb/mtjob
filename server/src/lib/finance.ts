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

/** Nhóm cho khoản thu chưa gắn nguồn — luôn hiện, để không ai tưởng đã phân loại xong. */
export const CHUA_RO_NGUON = 'Chưa rõ nguồn';

export interface DoanhThuNguon {
  nguon: string;
  tien: number;
  soKhoan: number;
  /** Tỉ trọng trên tổng doanh thu, làm tròn tới %. */
  tyLe: number;
}

/**
 * Doanh thu tháng gom theo NGUỒN KHÁCH (anh Tâm 21/8/2026).
 *
 * Chỉ tính khoản THU. Khoản chi không có nguồn khách — gộp vào là ra con số vô nghĩa.
 *
 * Nguồn để trống thì gom vào "Chưa rõ nguồn" chứ KHÔNG bỏ đi: bỏ đi thì tổng các dòng
 * nhỏ hơn doanh thu thật mà nhìn bảng không biết thiếu ở đâu.
 */
export function doanhThuTheoNguon(
  entries: Array<{ kind: string; amount: number; source?: string }>,
): DoanhThuNguon[] {
  const thu = entries.filter((e) => e.kind === 'thu');
  const tong = thu.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const m = new Map<string, { tien: number; soKhoan: number }>();
  for (const e of thu) {
    const nguon = (e.source || '').trim() || CHUA_RO_NGUON;
    const o = m.get(nguon) || { tien: 0, soKhoan: 0 };
    o.tien += Number(e.amount) || 0;
    o.soKhoan += 1;
    m.set(nguon, o);
  }

  return [...m.entries()]
    .map(([nguon, o]) => ({
      nguon,
      ...o,
      tyLe: tong > 0 ? Math.round((o.tien / tong) * 100) : 0,
    }))
    .sort((a, b) => b.tien - a.tien || a.nguon.localeCompare(b.nguon));
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
  /** Tổng phải đòi = nợ cũ + kỳ này − đã thu kỳ này − tiền trả trước còn lại. */
  total: number;
  /** Tiền khách đã trả trước, còn dư sau khi trừ hết nợ và kỳ đang xem. */
  credit: number;
  /** Các kỳ cũ còn thiếu, để hiện khi rê chuột. */
  unpaidMonths: string[];
}

/**
 * Nợ luỹ kế của một bên.
 *
 * Tính theo SỐ TIỀN còn thiếu chứ không đếm kỳ chưa tick: thu một phần (ví dụ đóng 10tr
 * trên 21tr) vẫn phải giữ lại 11tr trong nợ cũ.
 *
 * Tiền thu dư CHẢY SANG KỲ SAU. Anh Tâm 21/8/2026 hỏi "khách trả trước 2-3 lần thì sao":
 * trước đây mỗi kỳ bị kẹp riêng bằng `max(0, per - paid[m])`, nên khách đóng 3 tháng một
 * lần thì phần dư bốc hơi và tháng sau app vẫn đòi tiền người đã trả rồi.
 *
 * Tiền vào trả cho KỲ CỦA CHÍNH NÓ trước, dư mới quay lại bù kỳ cũ nhất, còn dư nữa thì
 * để dành cho kỳ sau. Thứ tự này quan trọng: bù nợ cũ trước sẽ làm kỳ thiếu bị gán nhầm
 * sang tháng gần nhất, trong khi tháng thiếu thật là tháng cũ.
 */
export function computeDebt(input: DebtInput): DebtResult {
  const per = Math.max(0, Math.round(input.receivable) || 0);
  const months = debtMonths(input.startMonth, input.month);

  /** Kỳ cũ còn thiếu, cũ nhất đứng đầu. */
  const con: Array<{ month: string; amount: number }> = [];
  /** Tiền khách đã trả nhưng chưa dùng tới. */
  let du = 0;

  const traNoCu = (): void => {
    while (du > 0 && con.length > 0) {
      const dau = con[0]!;
      const tra = Math.min(du, dau.amount);
      dau.amount -= tra;
      du -= tra;
      if (dau.amount === 0) con.shift();
    }
  };

  for (const m of months) {
    if (m >= input.month) continue; // kỳ đang xem tính riêng bên dưới
    du += input.paid[m] || 0;
    const tra = Math.min(du, per);
    du -= tra;
    if (per - tra > 0) con.push({ month: m, amount: per - tra });
    traNoCu();
  }

  const carryOver = con.reduce((s, x) => s + x.amount, 0);
  // Kỳ đang xem chỉ tính khi đã tới mốc theo dõi.
  const thisMonth = months.includes(input.month) ? per : 0;
  const paidThis = (input.paid[input.month] || 0) + du;
  return {
    thisMonth,
    carryOver,
    total: Math.max(0, carryOver + thisMonth - paidThis),
    credit: Math.max(0, paidThis - thisMonth - carryOver),
    unpaidMonths: con.map((x) => x.month),
  };
}
