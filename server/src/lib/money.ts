// Bonus & payroll math. Pure functions — fully unit-tested.

export interface BonusConfig {
  threshold: number;
  step: number;
  amount: number;
}

export const DEFAULT_BONUS: BonusConfig = { threshold: 6000, step: 1000, amount: 800000 };

/**
 * Thưởng tháng. Chỉ điểm VƯỢT `threshold` mới được tính, ăn theo TỶ LỆ:
 * mỗi `step` điểm dư tương ứng `amount` đồng, dư bao nhiêu ăn bấy nhiêu.
 *
 * Anh Tâm chốt 25/7/2026: "tính tiền ngay khi vượt mốc 6k điểm" — trước đây phải đủ
 * trọn 1.000 điểm dư mới có đồng nào, nên 6.999đ vẫn trắng tay, quá thiệt cho người
 * chỉ thiếu một chút.
 *   6000 -> 0 · 6320 -> 256k · 6500 -> 400k · 7000 -> 800k · 8000 -> 1.6M
 */
export function computeBonus(points: number, cfg: BonusConfig = DEFAULT_BONUS): number {
  if (!Number.isFinite(points) || points <= cfg.threshold) return 0;
  if (!(cfg.step > 0)) return 0; // cấu hình hỏng thì trả 0, đừng chia cho 0
  const extra = points - cfg.threshold;
  return Math.round((extra / cfg.step) * cfg.amount);
}

// ── Thưởng KPI dự án (anh Tâm 21/8/2026) ──
//
// Mỗi cặp (dự án × phòng) có một MỨC THƯỞNG: số tiền leader nhận khi đạt 100% KPI tháng.
// Để cạnh computeBonus để mọi luật tiền nằm một chỗ, soi một lượt là thấy hết.

/**
 * Trần 100%: vượt KPI không được thưởng thêm.
 * Anh Tâm: "khách hàng không trả thêm khi mình vượt KPI".
 */
export const TRAN_KPI = 100;
/** Dưới ngưỡng này thành viên không có thưởng thêm. */
export const NGUONG_THANH_VIEN = 80;
/** Có dự án dưới ngưỡng này thì thưởng điểm còn một nửa. */
export const NGUONG_NUA_DIEM = 50;

/** `r` là % đạt KPI; `null` = tháng đó không đo được → không thưởng, cũng không phạt. */
export function thuongLeader(mucThuong: number, r: number | null): number {
  const muc = Math.max(0, Math.round(mucThuong) || 0);
  if (r === null || !Number.isFinite(r) || r <= 0) return 0;
  return Math.round((muc * Math.min(r, TRAN_KPI)) / 100);
}

/**
 * Thưởng thêm của MỘT thành viên cho MỘT dự án. Nhiều dự án thì gọi nhiều lần rồi cộng —
 * đúng luật "tính riêng từng dự án rồi cộng lại", và giữ hàm này đủ đơn giản để test.
 *
 *   r < 80%        → 0
 *   80% ≤ r < 100% → một nửa mức
 *   r ≥ 100%       → trọn mức (trần 100%, vượt không thêm)
 */
export function thuongThanhVien(mucThuong: number, r: number | null): number {
  const muc = Math.max(0, Math.round(mucThuong) || 0);
  if (r === null || !Number.isFinite(r) || r < NGUONG_THANH_VIEN) return 0;
  if (r < TRAN_KPI) return Math.round(muc / 2);
  return muc;
}

/**
 * Thưởng điểm sau khi soi kết quả dự án.
 *
 * BẤT KỲ dự án nào dưới 50% là còn một nửa — anh Tâm chốt "tất cả dự án đạt trên 50%"
 * mới giữ nguyên. Dự án không đo được (`null`) bị bỏ qua: người được phân vào một dự án
 * đang tạm dừng không đáng bị cắt thưởng vì chuyện đó.
 *
 * Không có dự án nào đo được thì giữ nguyên — hàm này không phải chỗ phạt người chưa
 * được phân công, việc đó nằm ở tầng service.
 */
export function nhanThuongDiem(thuongDiem: number, rCacDuAn: Array<number | null>): number {
  const tien = Math.max(0, Math.round(thuongDiem) || 0);
  const doDuoc = rCacDuAn.filter((r): r is number => r !== null && Number.isFinite(r));
  if (doDuoc.length === 0) return tien;
  return doDuoc.some((r) => r < NGUONG_NUA_DIEM) ? Math.round(tien / 2) : tien;
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
 *   net       = max(0, prorated - deduction)   // không hiển thị lương âm khi công quá ít
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
    netSalary: Math.max(0, prorated - bhxhDeduction),
  };
}

/** Format a number as Vietnamese currency, e.g. 1600000 -> "1.600.000đ". */
export function formatVnd(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0)) + 'đ';
}

/** Hậu tố đơn vị (đã bỏ dấu tiếng Việt) → hệ số nhân. */
const UNITS: Record<string, number> = {
  d: 1, // "500.000đ" — ký hiệu tiền, không phải đơn vị nhân
  k: 1_000,
  nghin: 1_000,
  ngan: 1_000,
  tr: 1_000_000,
  trieu: 1_000_000,
  m: 1_000_000,
  ty: 1_000_000_000,
  ti: 1_000_000_000,
  b: 1_000_000_000,
};

/**
 * Đọc số tiền người dùng (hoặc AI) viết tự do thành số đồng.
 *
 * Điểm mấu chốt là dấu chấm/phẩy đổi nghĩa theo việc CÓ hậu tố hay không:
 * có hậu tố ("1,5 triệu") thì là dấu thập phân; không hậu tố ("20.000.000")
 * thì là dấu ngăn nghìn. Đoán sai chỗ này là lệch 1000 lần trên sổ thu chi.
 *
 * "20tr" → 20.000.000 · "1,5 triệu" → 1.500.000 · "500k" → 500.000
 * "1 tỷ" → 1.000.000.000 · "20.000.000" → 20.000.000 · rác → NaN
 */
export function parseVndAmount(input: string | number | null | undefined): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  const raw = String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // b\u1ecf d\u1ea5u thanh: "tri\u1ec7u" th\u00e0nh "trieu", "t\u1ef7" th\u00e0nh "ty"
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/vnd|dong/g, ' ') // "20 triệu đồng", "500.000 VNĐ"
    .trim();

  const m = raw.match(/(\d[\d.,]*)\s*([a-z]*)/);
  if (!m) return NaN;
  const [, digits, suffix] = m;
  const multiplier = suffix ? UNITS[suffix] : 1;
  if (!multiplier) return NaN; // hậu tố lạ → không đoán bừa

  const num =
    multiplier === 1
      ? Number(digits.replace(/[.,]/g, '')) // không hậu tố → dấu ngăn nghìn
      : Number(digits.replace(/,/g, '.')); // có hậu tố → dấu thập phân
  if (!Number.isFinite(num)) return NaN;
  return Math.round(num * multiplier);
}
