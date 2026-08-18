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

/**
 * Sinh nhật rơi vào ngày này không? So NGÀY-THÁNG, bỏ qua năm sinh.
 * Nhận cả 'YYYY-MM-DD' lẫn 'MM-DD' vì dữ liệu khách cũ nhập không đều tay.
 */
export function laSinhNhat(dob: string, ngay: string): boolean {
  const md = String(dob || '').trim().slice(-5);
  if (!/^\d{2}-\d{2}$/.test(md)) return false;
  return md === ngay.slice(5);
}

const THU_VN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** 'CN' | 'T2' … — nhãn ngắn để vẽ đầu cột lịch. */
export function thuVn(ngay: string): string {
  const d = dayjs(ngay);
  return d.isValid() ? THU_VN[d.day()] : '';
}
