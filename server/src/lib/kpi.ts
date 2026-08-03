// Tính kỳ và tiến độ KPI. Thuần, không đụng DB — đây là chỗ dễ sai nhất của tính năng
// Dự án (tuần vắt qua tháng, cửa sổ khoá số vắt qua cuối năm) nên phải test được.
import { dayjs, TZ } from './datetime.js';
import { isWorkday } from './workdays.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';

dayjs.extend(isoWeek);

export type KpiPeriod = 'day' | 'week' | 'month' | 'total';

/** Một số đã nhập cho một ngày. */
export interface KpiEntryLike {
  date: string; // YYYY-MM-DD
  value: number;
}

/**
 * Khoá kỳ chứa ngày `date`.
 *   day   → '2026-07-28'
 *   week  → '2026-W31'  (tuần ISO — thứ 2 đầu tuần, một ngày chỉ thuộc đúng một tuần)
 *   month → '2026-07'
 *   total → 'total'     (cả dự án, không chia kỳ)
 */
export function periodKey(date: string, period: KpiPeriod): string {
  if (period === 'total') return 'total';
  const d = dayjs(date);
  if (!d.isValid()) return '';
  if (period === 'day') return d.format('YYYY-MM-DD');
  if (period === 'month') return d.format('YYYY-MM');
  // Năm ISO khác năm lịch ở tuần giao thừa: 31/12/2026 thuộc tuần 1 của 2027.
  return `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2, '0')}`;
}

/** Nhãn tiếng Việt cho một khoá kỳ. Tuần hiện kèm khoảng ngày để khỏi phải nhẩm. */
export function periodLabel(key: string): string {
  if (key === 'total') return 'Cả dự án';
  const week = key.match(/^(\d{4})-W(\d{2})$/);
  if (week) {
    // Chuẩn ISO: tuần 1 là tuần CHỨA ngày 4/1. Tính từ đó thay vì dùng setter
    // isoWeekYear() — plugin chỉ cấp getter, gọi kiểu setter sẽ vỡ.
    const week1 = dayjs(`${week[1]}-01-04`).startOf('isoWeek');
    const start = week1.add(Number(week[2]) - 1, 'week');
    const end = start.add(6, 'day');
    return `Tuần ${Number(week[2])} (${start.format('D/M')}–${end.format('D/M')})`;
  }
  if (/^\d{4}-\d{2}$/.test(key)) return `Tháng ${Number(key.slice(5))}/${key.slice(0, 4)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return dayjs(key).format('D/M/YYYY');
  return key;
}

/** Kỳ đang chạy, tính theo giờ VN (máy người xem có thể ở múi khác). */
export function currentPeriodKey(period: KpiPeriod, today?: string): string {
  return periodKey(today || dayjs().tz(TZ).format('YYYY-MM-DD'), period);
}

export interface KpiLike {
  period: KpiPeriod;
  target: number;
}

export interface KpiProgress {
  periodKey: string;
  current: number;
  target: number;
  /** Có thể vượt 100 — cố ý không cắt, để thấy ai làm dư. 0 khi chưa đặt mục tiêu. */
  percent: number;
}

/** Tiến độ của KPI trong kỳ đang chạy (hoặc kỳ chứa `today` nếu truyền vào). */
export function progressOf(entries: KpiEntryLike[], kpi: KpiLike, today?: string): KpiProgress {
  const key = currentPeriodKey(kpi.period, today);
  const current = entries
    .filter((e) => periodKey(e.date, kpi.period) === key)
    .reduce((s, e) => s + (Number(e.value) || 0), 0);
  const target = Number(kpi.target) || 0;
  return { periodKey: key, current, target, percent: target > 0 ? Math.round((current / target) * 100) : 0 };
}

export interface KpiPoint {
  key: string;
  label: string;
  value: number;
}

/**
 * `n` kỳ gần nhất cho biểu đồ, cũ → mới. Kỳ không có số vẫn trả 0 để đường biểu đồ
 * liền mạch, không đứt quãng gây hiểu nhầm là chưa tới kỳ đó.
 */
export function seriesFor(
  entries: KpiEntryLike[],
  period: KpiPeriod,
  n = 8,
  today?: string,
): KpiPoint[] {
  const base = dayjs(today || dayjs().tz(TZ).format('YYYY-MM-DD'));
  if (period === 'total') {
    const value = entries.reduce((s, e) => s + (Number(e.value) || 0), 0);
    return [{ key: 'total', label: 'Cả dự án', value }];
  }

  const unit = period === 'day' ? 'day' : period === 'week' ? 'week' : 'month';
  const sum = new Map<string, number>();
  for (const e of entries) {
    const k = periodKey(e.date, period);
    if (k) sum.set(k, (sum.get(k) || 0) + (Number(e.value) || 0));
  }

  const out: KpiPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = periodKey(base.subtract(i, unit).format('YYYY-MM-DD'), period);
    out.push({ key: k, label: periodLabel(k), value: sum.get(k) || 0 });
  }
  return out;
}

/** Ngày làm việc kế tiếp sau `date` — bỏ qua T7, CN và ngày lễ. */
function ngayLamViecKeTiep(date: string, holidays: Set<string>): string {
  let d = dayjs(date).add(1, 'day');
  // Nghỉ Tết dài nhất cũng không quá hai tuần; chặn vòng lặp phòng dữ liệu lễ sai.
  for (let i = 0; i < 20; i++) {
    const iso = d.format('YYYY-MM-DD');
    if (isWorkday(iso, holidays)) return iso;
    d = d.add(1, 'day');
  }
  return d.format('YYYY-MM-DD');
}

/**
 * Ngày `date` còn nhập/sửa số được không?
 *
 * Mở trong CHÍNH ngày đó, và trong NGÀY LÀM VIỆC KẾ TIẾP.
 *
 * Anh Tâm 3/8/2026: "nếu rơi vào T7 CN thì nhập bù vào thứ 2, số T6 cũng nhập vào ngày
 * T2 là tối đa". Luật cũ cho đúng một ngày lịch nên số thứ Sáu hết hạn vào thứ Bảy —
 * ngày không ai đi làm. Cứ cuối tuần là mất số, mà chẳng ai làm gì sai.
 *
 * Nên thứ Hai mở cho: thứ Hai, Chủ nhật, thứ Bảy và thứ Sáu.
 */
export function entryWindowOpen(date: string, today: string, holidays: Set<string> = new Set()): boolean {
  const d = dayjs(date);
  const t = dayjs(today);
  if (!d.isValid() || !t.isValid()) return false;
  if (d.startOf('day').isAfter(t.startOf('day'))) return false; // ngày chưa tới

  // Mở LIÊN TỤC từ chính ngày đó tới hết ngày làm việc kế tiếp — ai vào app cuối tuần
  // vẫn nhập được, và thứ Hai là hạn chót.
  const dIso = d.format('YYYY-MM-DD');
  const tIso = t.format('YYYY-MM-DD');
  return tIso <= ngayLamViecKeTiep(dIso, holidays);
}

/** Giám đốc/admin nhập bù được mọi ngày; còn lại phải trong cửa sổ. */
export function canWriteEntry(
  date: string,
  today: string,
  role: string,
  holidays: Set<string> = new Set(),
): boolean {
  if (role === 'director' || role === 'admin') return true;
  return entryWindowOpen(date, today, holidays);
}

/**
 * Những ngày mà HÔM NAY còn nhập/sửa được — cũ trước, hôm nay cuối.
 * Màn hình dựng ô nhập theo danh sách này thay vì cứng "hôm nay / hôm qua".
 */
export function openEntryDates(today: string, holidays: Set<string> = new Set()): string[] {
  const t = dayjs(today);
  if (!t.isValid()) return [];
  const out: string[] = [];
  // Nhìn lùi tối đa 20 ngày là quá đủ kể cả sau kỳ nghỉ Tết.
  for (let i = 20; i >= 1; i--) {
    const iso = t.subtract(i, 'day').format('YYYY-MM-DD');
    if (entryWindowOpen(iso, today, holidays)) out.push(iso);
  }
  out.push(t.format('YYYY-MM-DD'));
  return out;
}

export interface ProjectProgress {
  /** Trung bình % các chỉ số CÓ mục tiêu. */
  percent: number;
  /** Số chỉ số đã tính vào trung bình. */
  counted: number;
  /** Số chỉ số chưa đặt mục tiêu — không đo được tiến độ. */
  noTarget: number;
}

/**
 * Tiến độ tổng của một dự án.
 *
 * CHỈ tính trung bình trên những chỉ số CÓ mục tiêu. Anh Tâm 3/8/2026 báo "nhập chỉ số
 * xong thì tiến độ dự án chưa cập nhật" — gốc là chỉ số để trống mục tiêu luôn ra 0%, và
 * bị gộp vào trung bình. Dự án có một chỉ số đạt 100% và một chỉ số chưa đặt mục tiêu thì
 * ra 50%: con số đó không nói lên điều gì, mà nhập thêm bao nhiêu cũng gần như không nhúc
 * nhích — nhìn cứ như hệ thống không ghi nhận.
 */
export function projectProgress(percents: Array<{ percent: number; target: number }>): ProjectProgress {
  const coMucTieu = percents.filter((p) => (Number(p.target) || 0) > 0);
  const noTarget = percents.length - coMucTieu.length;
  if (coMucTieu.length === 0) return { percent: 0, counted: 0, noTarget };
  const tong = coMucTieu.reduce((s, p) => s + (Number(p.percent) || 0), 0);
  return { percent: Math.round(tong / coMucTieu.length), counted: coMucTieu.length, noTarget };
}
