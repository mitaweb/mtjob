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

/**
 * Điền nguồn cho khoản thu chưa có nguồn riêng: lấy theo nguồn HIỆN TẠI của bên công nợ,
 * không có thì của khách CRM gắn với khoản đó.
 *
 * Anh Tâm 16/9/2026: chọn nguồn cho các bên xong mà bảng doanh thu theo nguồn vẫn 90%
 * "chưa rõ nguồn" — vì nguồn được CHÉP vào từng khoản lúc tạo, khoản tạo trước khi chọn
 * nguồn mang chuỗi rỗng mãi. Đọc theo bên là cách duy nhất không bắt ai sửa lại dữ liệu cũ.
 * Khoản có nguồn riêng thì giữ nguyên: đó là người nhập cố ý chọn khác.
 */
export function boSungNguon<T extends { source?: string; partyId?: string; customerId?: string }>(
  entries: T[],
  nguonBen: Map<string, string>,
  nguonKhach: Map<string, string>,
): T[] {
  return entries.map((e) => {
    if ((e.source || '').trim()) return e;
    const tuBen = e.partyId ? nguonBen.get(e.partyId) || '' : '';
    const tuKhach = e.customerId ? nguonKhach.get(e.customerId) || '' : '';
    const source = tuBen || tuKhach;
    return source ? { ...e, source } : e;
  });
}

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

/** Một lần đổi mức phải thu: từ tháng `fromMonth` trở đi thu `receivable`. */
export interface PartyRate {
  /** YYYY-MM, hoặc '0000-00' = áp cho mọi tháng trước lần đổi đầu tiên. */
  fromMonth: string;
  receivable: number;
}

/**
 * Mức phải thu của tháng `month`: dòng lịch sử có `fromMonth` lớn nhất mà ≤ month; không
 * có dòng nào thì dùng `fallback` (mức hiện tại trên bên).
 *
 * Anh Tâm 16/9/2026: "đang 3 triệu, kể từ tháng này tăng thành 6 triệu... chỉ 6 từ tháng
 * cập nhật thôi". Mức là hàm theo tháng, không phải một con số.
 */
export function mucTheoThang(rates: PartyRate[], fallback: number, month: string): number {
  let muc: number | null = null;
  let mocMax = '';
  for (const r of rates) {
    if (r.fromMonth <= month && r.fromMonth >= mocMax) {
      mocMax = r.fromMonth;
      muc = r.receivable;
    }
  }
  return Math.max(0, Math.round(muc ?? fallback) || 0);
}

/** Loại bên: thu hàng tháng (mặc định) hay khoản một lần trả nhiều đợt. */
export type PartyKind = 'monthly' | 'once';

export interface OnceDebtInput {
  /** Tổng giá trị hợp đồng / khoản phải thu một lần. */
  total: number;
  /** Tháng bắt đầu (YYYY-MM), '' = không giới hạn. Xem tháng trước đó thì chưa tính. */
  startMonth: string;
  /** Tháng đang xem. */
  month: string;
  /** Đã thu theo từng tháng — cộng dồn MỌI tháng ≤ tháng đang xem. */
  paid: Record<string, number>;
}

export interface OnceDebtResult {
  total: number;
  /** Đã thu luỹ kế tới hết tháng đang xem. */
  paidTotal: number;
  /** Còn phải đòi. */
  remaining: number;
  /** Khách trả dư. */
  credit: number;
  /** Tháng đang xem có nằm trong thời gian hợp đồng không. */
  active: boolean;
}

/**
 * Công nợ của khoản thu MỘT LẦN trả nhiều đợt (anh Tâm 25/9/2026: "làm phần mềm, khách
 * chuyển khoản từng lần chứ không chuyển hết, cần ghi nhận công nợ để đòi đủ").
 *
 * Không có kỳ tháng: còn nợ = tổng − mọi đợt đã trả (tính tới tháng đang xem, để xem lại
 * tháng cũ không bị đợt trả sau làm sạch nợ sớm hơn thực tế).
 */
export function computeOnceDebt(input: OnceDebtInput): OnceDebtResult {
  const total = Math.max(0, Math.round(input.total) || 0);
  if (input.startMonth && input.month < input.startMonth) {
    return { total, paidTotal: 0, remaining: 0, credit: 0, active: false };
  }
  let paidTotal = 0;
  for (const [m, v] of Object.entries(input.paid)) {
    if (m <= input.month) paidTotal += Number(v) || 0;
  }
  return {
    total,
    paidTotal,
    remaining: Math.max(0, total - paidTotal),
    credit: Math.max(0, paidTotal - total),
    active: true,
  };
}

export interface DebtInput {
  /** Phải thu mỗi kỳ — mức HIỆN TẠI; tháng nào có lịch sử riêng thì `rates` thắng. */
  receivable: number;
  /** Lịch sử đổi mức, có thể rỗng. */
  rates?: PartyRate[];
  /** Tháng bắt đầu tính của riêng bên này (thường lấy từ start_date), '' = theo mốc chung. */
  startMonth: string;
  /** Tháng đang xem, YYYY-MM. */
  month: string;
  /** Đã thu thực tế theo từng kỳ: { '2026-08': 21000000 }. */
  paid: Record<string, number>;
}

export interface DebtResult {
  /** Phải thu của riêng kỳ đang xem (số gốc, chưa trừ gì). */
  thisMonth: number;
  /** Kỳ đang xem còn thiếu bao nhiêu sau khi tiền đã vào trừ xong nợ cũ. */
  thisMonthRemaining: number;
  /** Còn nợ của các kỳ TRƯỚC — ĐÃ trừ cả tiền thu trong kỳ đang xem. */
  carryOver: number;
  /** Phần tiền thu trong kỳ đang xem đã đem trừ nợ cũ — để màn hình nói "đã trừ nợ T8". */
  paidToOld: number;
  /** Tổng phải đòi = nợ cũ còn lại + kỳ này còn thiếu. */
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
 * Tiền vào luôn trả KỲ CŨ NHẤT trước, rồi mới tới kỳ của chính nó, dư thì để dành kỳ sau
 * (FIFO — đúng cách kế toán gán tiền vào hoá đơn cũ nhất còn mở).
 *
 * Anh Tâm 16/9/2026: "khi anh thu ở tháng sau thì tự trừ, không phải quay lại tháng cũ để
 * bấm thu nữa". Bản trước cho tiền tháng 9 trả kỳ tháng 9 trước, nên khách trả tiền tháng
 * 8 vào tháng 9 thì tháng 8 vẫn hiện "chưa thu", anh quay về tháng 8 bấm thu lần nữa — và
 * doanh thu bị ghi hai lần. Với FIFO, kỳ thiếu (nếu có) dồn về kỳ MỚI NHẤT — đó chính là
 * cách bảng công nợ đọc: cũ đã trả, mới còn treo.
 */
export function computeDebt(input: DebtInput): DebtResult {
  const rates = input.rates || [];
  const months = debtMonths(input.startMonth, input.month);

  /** Kỳ cũ còn thiếu, cũ nhất đứng đầu. */
  const con: Array<{ month: string; amount: number }> = [];
  /** Tiền khách đã trả nhưng chưa dùng tới. */
  let du = 0;
  let paidToOld = 0;
  let thisMonth = 0;
  let thisMonthRemaining = 0;

  for (const m of months) {
    // Mức của RIÊNG tháng đó — đổi mức từ tháng 9 thì tháng 8 vẫn tính theo mức cũ.
    const per = mucTheoThang(rates, input.receivable, m);
    const laKyDangXem = m === input.month;
    if (laKyDangXem) {
      thisMonth = per;
      thisMonthRemaining = per;
    } else if (per > 0) {
      con.push({ month: m, amount: per });
    }
    du += input.paid[m] || 0;

    // Trả kỳ cũ nhất trước.
    while (du > 0 && con.length > 0) {
      const dau = con[0]!;
      const tra = Math.min(du, dau.amount);
      dau.amount -= tra;
      du -= tra;
      if (laKyDangXem) paidToOld += tra;
      if (dau.amount === 0) con.shift();
    }
    // Rồi mới tới kỳ đang xem.
    if (laKyDangXem && du > 0 && thisMonthRemaining > 0) {
      const tra = Math.min(du, thisMonthRemaining);
      thisMonthRemaining -= tra;
      du -= tra;
    }
  }

  const carryOver = con.reduce((s, x) => s + x.amount, 0);
  return {
    thisMonth,
    thisMonthRemaining,
    carryOver,
    paidToOld,
    total: carryOver + thisMonthRemaining,
    credit: du,
    unpaidMonths: con.map((x) => x.month),
  };
}
