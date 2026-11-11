// Báo cáo quảng cáo gửi khách (anh Tâm 11/11/2026: "agent để báo cáo hàng tuần cho khách hàng… chi phí sẽ tổng cả thuế
// vào… báo cáo hàng tuần, tháng cho các bên chạy ads, GG và FB"). Hàm thuần: kỳ báo cáo, chuyển đổi theo loại, tổng có thuế.
import { congNgay, dauTuan } from './khoangNgay.js';

export type LoaiKy = 'tuan' | 'thang';
export interface Ky {
  tu: string;
  den: string;
}

/** Thuế mặc định cộng vào chi phí (anh chọn: Google +10%, Facebook +10%; sửa riêng từng tài khoản được). */
export const THUE_MAC_DINH = 10;

/**
 * Kỳ vừa kết thúc tính tới hôm nay. Tuần: thứ Hai → Chủ nhật tuần trước. Tháng: theo chu kỳ từng khách (ngày D tháng trước →
 * D − 1 tháng này; mẫu anh gửi 11/10 → 09/11); chưa đặt chu kỳ (0) = tháng dương lịch trước.
 */
export function kyBaoCao(loai: LoaiKy, homNay: string, ngayChuKy: number): Ky {
  if (loai === 'tuan') {
    const tu = congNgay(dauTuan(homNay), -7);
    return { tu, den: congNgay(tu, 6) };
  }
  const d = Math.min(28, Math.max(1, Math.round(ngayChuKy) || 1));
  const [n, t, ng] = homNay.split('-').map(Number) as [number, number, number];
  // Mốc kết thúc kỳ = ngày D của tháng này (nếu đã tới) hoặc tháng trước.
  let nam = n;
  let thang = ng >= d ? t : t - 1;
  if (thang < 1) {
    thang = 12;
    nam--;
  }
  const moc = `${nam}-${String(thang).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  let namTruoc = nam;
  let thangTruoc = thang - 1;
  if (thangTruoc < 1) {
    thangTruoc = 12;
    namTruoc--;
  }
  return { tu: `${namTruoc}-${String(thangTruoc).padStart(2, '0')}-${String(d).padStart(2, '0')}`, den: congNgay(moc, -1) };
}

/** Chỉ tạo báo cáo cho kỳ VỪA kết thúc (≤ 3 ngày) — cấu hình mới bật giữa kỳ không sinh báo cáo kỳ cũ. */
export function nenTao(ky: Ky, homNay: string): boolean {
  return ky.den < homNay && congNgay(ky.den, 3) >= homNay;
}

// ── Chuyển đổi theo loại ──

const LOAI_GADS: Record<string, string> = {
  GET_DIRECTIONS: 'Chỉ đường',
  PHONE_CALL_LEAD: 'Cuộc gọi',
  CONTACT: 'Liên hệ',
  SUBMIT_LEAD_FORM: 'Gửi biểu mẫu',
  LEAD: 'Khách tiềm năng',
  QUALIFIED_LEAD: 'Khách tiềm năng',
  CONVERTED_LEAD: 'Khách tiềm năng',
  IMPORTED_LEAD: 'Khách tiềm năng',
  REQUEST_QUOTE: 'Yêu cầu báo giá',
  BOOK_APPOINTMENT: 'Đặt lịch',
  PURCHASE: 'Mua hàng',
  ADD_TO_CART: 'Thêm giỏ hàng',
  BEGIN_CHECKOUT: 'Bắt đầu thanh toán',
  SIGNUP: 'Đăng ký',
  SUBSCRIBE_PAID: 'Đăng ký',
  PAGE_VIEW: 'Xem trang',
  OUTBOUND_CLICK: 'Nhấp liên kết',
  ENGAGEMENT: 'Tương tác',
  STORE_VISIT: 'Ghé cửa hàng',
  STORE_SALE: 'Mua tại cửa hàng',
  DOWNLOAD: 'Tải về',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const so = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const cong = (m: Record<string, number>, k: string, v: number) => {
  if (v > 0) m[k] = (m[k] || 0) + v;
};

/** Google Ads searchStream `SELECT segments.conversion_action_category, metrics.conversions FROM customer …` */
export function coCauGads(j: Json): Record<string, number> {
  const ra: Record<string, number> = {};
  for (const r of (Array.isArray(j) ? j : []).flatMap((x: Json) => (Array.isArray(x?.results) ? x.results : []))) {
    cong(ra, LOAI_GADS[String(r?.segments?.conversionActionCategory || '')] || 'Khác', so(r?.metrics?.conversions));
  }
  return ra;
}

const NHOM_META: Array<[string, string[]]> = [
  ['Tin nhắn', ['onsite_conversion.messaging_conversation_started_7d']],
  ['Khách để lại thông tin', ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']],
  ['Mua hàng', ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase']],
];

/** Meta insights `actions` → kết quả theo loại. Mỗi nhóm Meta báo dưới nhiều tên trùng nhau → lấy tên có số lớn nhất. */
export function coCauMeta(actions: Array<{ action_type?: string; value?: unknown }> | undefined): Record<string, number> {
  const theoTen = new Map((Array.isArray(actions) ? actions : []).map((a) => [String(a?.action_type || ''), so(a?.value)]));
  const ra: Record<string, number> = {};
  for (const [nhan, ten] of NHOM_META) cong(ra, nhan, Math.max(0, ...ten.map((t) => theoTen.get(t) || 0)));
  return ra;
}

// ── Tổng hợp có thuế ──

export interface SoTaiKhoan {
  ten: string;
  /** % thuế cộng vào chi phí */
  thue: number;
  hienThi: number;
  click: number;
  chuyenDoi: number;
  /** Chi phí CHƯA thuế (theo nền tảng) */
  chi: number;
  coCau: Record<string, number>;
}

export interface TongHop {
  tk: Array<SoTaiKhoan & { chiSauThue: number; cpa: number }>;
  tong: { hienThi: number; click: number; chuyenDoi: number; chiSauThue: number; cpa: number; ctr: number };
  coCau: Array<{ nhan: string; so: number; tyLe: number }>;
}

/** Chi phí sau thuế làm tròn từng tài khoản; tổng = cộng các dòng (bảng khách xem phải cộng khớp). */
export function tongHop(ds: SoTaiKhoan[]): TongHop {
  const tk = ds.map((t) => {
    const chiSauThue = Math.round(t.chi * (1 + (t.thue || 0) / 100));
    return { ...t, chiSauThue, cpa: t.chuyenDoi ? Math.round(chiSauThue / t.chuyenDoi) : 0 };
  });
  const tong = { hienThi: 0, click: 0, chuyenDoi: 0, chiSauThue: 0, cpa: 0, ctr: 0 };
  const coCau: Record<string, number> = {};
  for (const t of tk) {
    tong.hienThi += t.hienThi;
    tong.click += t.click;
    tong.chuyenDoi += t.chuyenDoi;
    tong.chiSauThue += t.chiSauThue;
    for (const [k, v] of Object.entries(t.coCau)) cong(coCau, k, v);
  }
  tong.cpa = tong.chuyenDoi ? Math.round(tong.chiSauThue / tong.chuyenDoi) : 0;
  tong.ctr = tong.hienThi ? tong.click / tong.hienThi : 0;
  const tongCc = Object.values(coCau).reduce((s, v) => s + v, 0);
  return {
    tk,
    tong,
    coCau: Object.entries(coCau)
      .sort((a, b) => b[1] - a[1])
      .map(([nhan, v]) => ({ nhan, so: v, tyLe: tongCc ? v / tongCc : 0 })),
  };
}
