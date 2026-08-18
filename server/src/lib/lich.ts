// Lịch của tôi: trải các thứ có ngày (nhắc hẹn, lịch hẹn khách, sinh nhật, ngày lễ, đơn
// nghỉ) lên một dãy ngày liên tiếp.
//
// Tách khỏi lib/reminder.ts vì hai câu hỏi khác nhau: reminder.ts hỏi "tới giờ bắn chưa"
// (cần cả giờ, cần lastFired), còn ở đây hỏi "ngày này có gì" — thuần ngày, không giờ,
// không trạng thái đã bắn. Trộn hai câu đó vào một hàm là chỗ dễ sinh lỗi lặng.
import dayjs from 'dayjs';
import type { ReminderRule } from './reminder.js';

/** Dãy `so` ngày liên tiếp kể từ `tu` (gồm cả `tu`). */
export function dayNgay(tu: string, so: number): string[] {
  const d0 = dayjs(tu);
  if (!d0.isValid() || so <= 0) return [];
  return Array.from({ length: so }, (_, i) => d0.add(i, 'day').format('YYYY-MM-DD'));
}

/**
 * Nhắc hẹn này có rơi vào ngày `ngay` không?
 *
 * Cố ý KHÔNG xét `lastFired`: lịch là để nhìn kế hoạch, đã bắn hay chưa không đổi việc
 * ngày đó có hẹn. Cũng không xét giờ — giờ chỉ dùng để sắp xếp lúc hiển thị.
 */
export function roiVaoNgay(rule: ReminderRule, ngay: string): boolean {
  const d = dayjs(ngay);
  if (!d.isValid()) return false;
  switch (rule.repeatKind) {
    case 'daily':
      return true;
    case 'weekly':
      return d.day() === (rule.weekday ?? 1);
    case 'monthly': {
      const want = rule.dayOfMonth ?? 1;
      // Hẹn ngày 31 mà tháng chỉ có 30 → rơi vào ngày cuối tháng. Giống isDue trong
      // reminder.ts, nếu không thì lịch vẽ một đằng mà thông báo bắn một nẻo.
      return d.date() === Math.min(want, d.daysInMonth());
    }
    case 'once':
      return (rule.onDate || '') === ngay;
    default:
      return false;
  }
}

/** Nhìn trước bao nhiêu ngày là đủ thấy MỘT lần lặp của mỗi kiểu. */
const NHIN_TRUOC: Record<string, number> = { once: 1, daily: 1, weekly: 7, monthly: 31 };

/**
 * Lần nhắc sắp tới gần nhất của một quy tắc, dạng { ngay, gio } — dùng để bắt trùng giờ.
 *
 * Chỉ lấy MỘT lần: hẹn hằng ngày mà quét cả tháng thì báo "trùng 30 lịch", đọc xong
 * không rõ trùng cái gì. Một lần đại diện là đủ để người ta quyết định.
 */
export function dipSapToi(rule: ReminderRule, tuNgay: string): Array<{ ngay: string; gio: string }> {
  if (rule.repeatKind === 'once') {
    return rule.onDate ? [{ ngay: rule.onDate, gio: rule.atTime }] : [];
  }
  const ngay = dayNgay(tuNgay, NHIN_TRUOC[rule.repeatKind] ?? 1).find((n) => roiVaoNgay(rule, n));
  return ngay ? [{ ngay, gio: rule.atTime }] : [];
}

/**
 * Sinh nhật rơi vào ngày này không? So NGÀY-THÁNG, bỏ qua năm sinh.
 * Nhận cả 'YYYY-MM-DD' lẫn 'MM-DD' vì dữ liệu khách cũ nhập không đều tay.
 */
export function laSinhNhat(dob: string, ngay: string): boolean {
  const md = String(dob || '').trim().slice(-5);
  if (!/^\d{2}-\d{2}$/.test(md)) return false;
  return md === ngay.slice(5);
}

/**
 * Hai lịch cách nhau bao nhiêu phút mới coi là KHÔNG đụng nhau.
 *
 * Không so bằng nhau tuyệt đối: hẹn 14:00 và nhắc 14:15 thực tế vẫn giẫm lên nhau, mà
 * báo trùng chỉ khi trùng khít từng phút thì gần như không bao giờ báo.
 */
export const CACH_NHAU_PHUT = 30;

/** 'HH:mm' → phút từ nửa đêm; chuỗi hỏng trả NaN. */
function phut(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return Number.NaN;
  const h = Number(m[1]);
  const p = Number(m[2]);
  return h > 23 || p > 59 ? Number.NaN : h * 60 + p;
}

/** Hai mốc giờ trong CÙNG một ngày có đụng nhau không? Giờ hỏng thì coi như không đụng. */
export function trungGio(a: string, b: string): boolean {
  const x = phut(a);
  const y = phut(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x - y) < CACH_NHAU_PHUT;
}

const THU_VN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** 'CN' | 'T2' … — nhãn ngắn để vẽ đầu cột lịch. */
export function thuVn(ngay: string): string {
  const d = dayjs(ngay);
  return d.isValid() ? THU_VN[d.day()] : '';
}
