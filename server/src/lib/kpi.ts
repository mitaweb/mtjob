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
 * Độ dài một kỳ khi đếm từ ngày bắt đầu dự án.
 *
 * Anh Tâm chốt 4/8/2026: tuần và tháng của dự án đếm từ NGÀY BẮT ĐẦU, không theo lịch —
 * "dự án bắt đầu từ 31/7 thì tuần là từ 31/7 + 7 ngày". Tháng là khối 30 ngày, không phải
 * tháng lịch, nên tháng 2 hay tháng 31 ngày cũng dài như nhau.
 */
const DO_DAI_KY = { week: 7, month: 30 } as const;

/**
 * Kỳ thứ mấy kể từ mốc. Kỳ 1 là `[mốc, mốc + độ dài - 1]`.
 * Trả 0 hoặc số âm cho ngày trước khi dự án bắt đầu; null khi mốc hoặc ngày không hợp lệ.
 */
function chiSoKy(date: string, moc: string, doDai: number): number | null {
  const d = dayjs(date);
  const m = dayjs(moc);
  if (!d.isValid() || !m.isValid()) return null;
  return Math.floor(d.startOf('day').diff(m.startOf('day'), 'day') / doDai) + 1;
}

/**
 * Khoá kỳ chứa ngày `date`.
 *
 * Có `moc` (ngày bắt đầu dự án) thì tuần/tháng đếm từ đó:
 *   week  → 'W1', 'W2'…  (mốc 31/7 ⇒ W1 = 31/7–6/8)
 *   month → 'M1', 'M2'…  (khối 30 ngày)
 * Không có mốc thì quay về kỳ theo lịch — dự án chưa khai ngày bắt đầu vẫn phải đo được:
 *   week  → '2026-W31'  (tuần ISO)
 *   month → '2026-07'
 * Hai dạng khoá không đụng nhau nên đổi mốc cũng không lẫn số của kỳ cũ.
 *
 *   day   → '2026-07-28' (mốc không đổi gì)
 *   total → 'total'      (cả dự án, không chia kỳ)
 */
export function periodKey(date: string, period: KpiPeriod, moc?: string): string {
  if (period === 'total') return 'total';
  const d = dayjs(date);
  if (!d.isValid()) return '';
  if (period === 'day') return d.format('YYYY-MM-DD');

  const n = moc ? chiSoKy(date, moc, DO_DAI_KY[period]) : null;
  if (n !== null) return `${period === 'week' ? 'W' : 'M'}${n}`;

  if (period === 'month') return d.format('YYYY-MM');
  // Năm ISO khác năm lịch ở tuần giao thừa: 31/12/2026 thuộc tuần 1 của 2027.
  return `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2, '0')}`;
}

/**
 * Nhãn tiếng Việt cho một khoá kỳ. Luôn kèm khoảng ngày để khỏi phải nhẩm —
 * "Tuần 2" của dự án không trùng tuần 2 trên lịch nên nói trống không là dễ hiểu nhầm.
 */
export function periodLabel(key: string, moc?: string): string {
  if (key === 'total') return 'Cả dự án';

  const neo = key.match(/^([WM])(-?\d+)$/);
  if (neo) {
    const n = Number(neo[2]);
    const laTuan = neo[1] === 'W';
    const ten = laTuan ? 'Tuần' : 'Tháng';
    // Chỉ xảy ra khi nhập bù cho ngày trước lúc dự án khởi động.
    if (n < 1) return 'Trước khi bắt đầu';
    const m = dayjs(moc);
    if (!moc || !m.isValid()) return `${ten} ${n}`;
    const doDai = laTuan ? DO_DAI_KY.week : DO_DAI_KY.month;
    const dau = m.add((n - 1) * doDai, 'day');
    return `${ten} ${n} (${dau.format('D/M')}–${dau.add(doDai - 1, 'day').format('D/M')})`;
  }

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
export function currentPeriodKey(period: KpiPeriod, today?: string, moc?: string): string {
  return periodKey(today || dayjs().tz(TZ).format('YYYY-MM-DD'), period, moc);
}

export interface KpiLike {
  period: KpiPeriod;
  target: number;
}

export interface KpiProgress {
  periodKey: string;
  /** Kỳ đang đo, viết cho người đọc: 'Tuần 1 (31/7–6/8)'. Màn hình hiện cái này. */
  periodLabel: string;
  current: number;
  target: number;
  /** Có thể vượt 100 — cố ý không cắt, để thấy ai làm dư. 0 khi chưa đặt mục tiêu. */
  percent: number;
}

/**
 * Tiến độ của KPI trong kỳ đang chạy (hoặc kỳ chứa `today` nếu truyền vào).
 * `moc` là ngày bắt đầu dự án — xem `periodKey`.
 */
export function progressOf(
  entries: KpiEntryLike[],
  kpi: KpiLike,
  today?: string,
  moc?: string,
): KpiProgress {
  const key = currentPeriodKey(kpi.period, today, moc);
  const current = entries
    .filter((e) => periodKey(e.date, kpi.period, moc) === key)
    .reduce((s, e) => s + (Number(e.value) || 0), 0);
  const target = Number(kpi.target) || 0;
  return {
    periodKey: key,
    periodLabel: periodLabel(key, moc),
    current,
    target,
    percent: target > 0 ? Math.round((current / target) * 100) : 0,
  };
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
  moc?: string,
): KpiPoint[] {
  const homNay = today || dayjs().tz(TZ).format('YYYY-MM-DD');
  if (period === 'total') {
    const value = entries.reduce((s, e) => s + (Number(e.value) || 0), 0);
    return [{ key: 'total', label: 'Cả dự án', value }];
  }

  const sum = new Map<string, number>();
  for (const e of entries) {
    const k = periodKey(e.date, period, moc);
    if (k) sum.set(k, (sum.get(k) || 0) + (Number(e.value) || 0));
  }
  const out: KpiPoint[] = [];

  const doDai = period === 'week' ? DO_DAI_KY.week : period === 'month' ? DO_DAI_KY.month : 0;
  const kyHienTai = doDai > 0 && moc ? chiSoKy(homNay, moc, doDai) : null;
  if (kyHienTai !== null) {
    // KHÔNG vẽ lùi quá kỳ 1: trước ngày bắt đầu thì dự án chưa tồn tại, kéo dài đường
    // biểu đồ về đó chỉ tạo ra một dãy số 0 trông như bị bỏ bê.
    const dau = Math.max(1, kyHienTai - n + 1);
    for (let i = dau; i <= Math.max(dau, kyHienTai); i++) {
      const k = `${period === 'week' ? 'W' : 'M'}${i}`;
      out.push({ key: k, label: periodLabel(k, moc), value: sum.get(k) || 0 });
    }
    return out;
  }

  const base = dayjs(homNay);
  const unit = period === 'day' ? 'day' : period === 'week' ? 'week' : 'month';
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

/** Mức cảnh báo của một dự án. */
export type AlertLevel = 'none' | 'warn' | 'danger';

export interface ProjectAlert {
  level: AlertLevel;
  /** % thời gian đã trôi; null khi dự án không khai đủ ngày bắt đầu/kết thúc. */
  timePercent: number | null;
  /** Câu ngắn giải thích vì sao bị tô màu — hiện khi rê chuột. */
  reason: string;
}

/**
 * Phần trăm thời gian đã trôi của dự án.
 *
 * Trả null khi thiếu ngày bắt đầu hoặc kết thúc: không có mốc thì mọi kết luận "chậm" đều
 * là bịa. Thà không cảnh báo còn hơn cảnh báo sai rồi mất tin.
 */
export function timeProgress(startDate: string, endDate: string, today: string): number | null {
  const s = dayjs(startDate);
  const e = dayjs(endDate);
  const t = dayjs(today);
  if (!startDate || !endDate || !s.isValid() || !e.isValid() || !t.isValid()) return null;

  const tong = e.startOf('day').diff(s.startOf('day'), 'day');
  if (tong <= 0) return null; // ngày kết thúc không sau ngày bắt đầu → dữ liệu hỏng
  const daTroi = t.startOf('day').diff(s.startOf('day'), 'day');
  if (daTroi <= 0) return 0; // chưa tới ngày bắt đầu
  return Math.round((daTroi / tong) * 100);
}

/**
 * Dự án có đang đáng lo không?
 *
 * Anh Tâm 3/8/2026: "dự án nào quá 50% thời gian mà chưa đạt 50% KPI thì tô đỏ hoặc vàng,
 * nếu thời gian vượt thì tô đỏ".
 *
 * Ba mức:
 *  - ĐỎ  : hết hạn mà chưa đạt mục tiêu, HOẶC đã tiêu quá 75% thời gian mà KPI chưa nổi 50%
 *  - VÀNG: đã qua nửa thời gian mà KPI chưa nổi 50%
 *  - none: còn lại, hoặc chưa đủ dữ liệu để kết luận
 *
 * `measured = 0` (chưa chỉ số nào đặt mục tiêu) thì KHÔNG cảnh báo — 0% lúc đó là do
 * chưa đặt mục tiêu chứ không phải làm kém.
 */
export function projectAlert(
  timePercent: number | null,
  kpiPercent: number,
  measured: number,
): ProjectAlert {
  if (timePercent === null || measured === 0) {
    return { level: 'none', timePercent, reason: '' };
  }

  if (timePercent > 100) {
    return kpiPercent >= 100
      ? { level: 'none', timePercent, reason: 'Đã hết hạn và đạt mục tiêu' }
      : { level: 'danger', timePercent, reason: `Đã quá hạn mà mới đạt ${kpiPercent}%` };
  }

  if (kpiPercent < 50 && timePercent >= 75) {
    return { level: 'danger', timePercent, reason: `Đã qua ${timePercent}% thời gian mà mới đạt ${kpiPercent}%` };
  }
  if (kpiPercent < 50 && timePercent >= 50) {
    return { level: 'warn', timePercent, reason: `Đã qua ${timePercent}% thời gian mà mới đạt ${kpiPercent}%` };
  }
  return { level: 'none', timePercent, reason: '' };
}
