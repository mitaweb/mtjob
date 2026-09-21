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

// ── Thưởng KPI (anh Tâm 21/9/2026 — thay luật 21/8) ──
//
// Luật cũ đặt mức thưởng cho TỪNG cặp (dự án × phòng): quá nhiều ô phải nhập, không ai dùng.
// Luật mới đếm số chỉ số ĐẠT:
//   · Leader: ≥ 80% chỉ số của phòng mình (trên mọi dự án) đạt 100% → trọn mức thưởng của
//     team tháng đó (Ads 3tr, SEO/Content 2tr — chỉnh trong Quản trị). Không đạt thì 0, không trừ.
//   · Thành viên: không còn tiền KPI riêng. ≥ 80% số dự án mình tham gia "đạt" → đủ thưởng
//     điểm; dưới đó → còn 50%.
// Để cạnh computeBonus để mọi luật tiền nằm một chỗ, soi một lượt là thấy hết.

/** Một chỉ số "đạt" khi chạm 100% mục tiêu tháng. 99,9% là chưa đạt — không làm tròn giúp. */
export const MOC_DAT = 100;
/** Ngưỡng mặc định: bao nhiêu % chỉ số (hoặc dự án) phải đạt. Giám đốc chỉnh ở `kpiPassRate`. */
export const NGUONG_DAT = 80;

export interface TyLeDat {
  dat: number;
  tong: number;
  /** % số chỉ số đạt; null = không chỉ số nào đo được. */
  tyLe: number | null;
}

/**
 * Đếm chỉ số đạt. `null` (tháng đó không đo được) bị loại khỏi CẢ tử lẫn mẫu — dự án tạm
 * dừng hay chỉ số đang trong giai đoạn xây nền không được kéo tỉ lệ của ai xuống.
 */
export function tyLeDat(percents: Array<number | null>): TyLeDat {
  const doDuoc = percents.filter((r): r is number => r !== null && Number.isFinite(r));
  const dat = doDuoc.filter((r) => r >= MOC_DAT).length;
  return { dat, tong: doDuoc.length, tyLe: doDuoc.length ? (dat / doDuoc.length) * 100 : null };
}

const chuanNguong = (n: number) => (Number.isFinite(n) && n > 0 ? n : NGUONG_DAT);

/** Thưởng leader một tháng: trọn `muc` hoặc 0. Không đo được chỉ số nào thì 0. */
export function thuongLeaderThang(percents: Array<number | null>, muc: number, nguong = NGUONG_DAT): number {
  const tien = Math.max(0, Math.round(muc) || 0);
  const { tyLe } = tyLeDat(percents);
  if (tyLe === null) return 0;
  return tyLe >= chuanNguong(nguong) ? tien : 0;
}

/**
 * MỘT dự án có "đạt" với thành viên không: ≥ ngưỡng số chỉ số của PHÒNG MÌNH trong dự án đó
 * đạt 100% — cùng thước với leader. `null` = dự án không đo được trong tháng.
 */
export function duAnDat(percentsCuaPhong: Array<number | null>, nguong = NGUONG_DAT): boolean | null {
  const { tyLe } = tyLeDat(percentsCuaPhong);
  if (tyLe === null) return null;
  return tyLe >= chuanNguong(nguong);
}

/**
 * Hệ số nhân vào thưởng ĐIỂM của thành viên: 1 hoặc 0,5.
 *
 * Anh Tâm: "số lượng >80% so với tổng số lượng dự án". Dự án không đo được bị bỏ qua; không
 * có dự án nào tính được thì giữ 1 — hàm này không phải chỗ phạt người chưa được phân công.
 */
export function heSoDiemThanhVien(cacDuAn: Array<boolean | null>, nguong = NGUONG_DAT): 1 | 0.5 {
  const tinhDuoc = cacDuAn.filter((d): d is boolean => d !== null);
  if (tinhDuoc.length === 0) return 1;
  const dat = tinhDuoc.filter(Boolean).length;
  return (dat / tinhDuoc.length) * 100 >= chuanNguong(nguong) ? 1 : 0.5;
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
