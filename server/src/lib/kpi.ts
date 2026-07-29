// Tính kỳ và tiến độ KPI. Thuần, không đụng DB — đây là chỗ dễ sai nhất của tính năng
// Dự án (tuần vắt qua tháng, cửa sổ khoá số vắt qua cuối năm) nên phải test được.
import { dayjs, TZ } from './datetime.js';
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

/**
 * Ngày `date` còn nhập/sửa số được không?
 *
 * Anh Tâm chốt 28/7/2026: số của ngày D sửa được trong ngày D và cả ngày D+1 — vì có
 * chỉ số hôm nay tới mai mới ra kết quả. Hết ngày D+1 là khoá vĩnh viễn.
 * Ngày tương lai cũng đóng: không ai biết trước số của ngày mai.
 */
export function entryWindowOpen(date: string, today: string): boolean {
  const d = dayjs(date);
  const t = dayjs(today);
  if (!d.isValid() || !t.isValid()) return false;
  const diff = t.startOf('day').diff(d.startOf('day'), 'day');
  return diff === 0 || diff === 1;
}

/** Giám đốc/admin nhập bù được mọi ngày; còn lại phải trong cửa sổ. */
export function canWriteEntry(date: string, today: string, role: string): boolean {
  if (role === 'director' || role === 'admin') return true;
  return entryWindowOpen(date, today);
}
