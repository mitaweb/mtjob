// Nhắc hẹn: quyết định một nhắc hẹn có tới hạn chưa. Thuần tuý & có test.

export type RepeatKind = 'once' | 'daily' | 'weekly' | 'monthly';

export interface ReminderRule {
  atTime: string; // "HH:mm" giờ VN
  repeatKind: RepeatKind;
  onDate?: string; // once: YYYY-MM-DD
  weekday?: number; // weekly: 0=CN … 6=T7
  dayOfMonth?: number; // monthly: 1-31
  lastFired?: string; // YYYY-MM-DD lần bắn gần nhất
}

/** "HH:mm" → phút từ nửa đêm; chuỗi hỏng trả về NaN. */
export function hhmmToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return Number.NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return Number.NaN;
  return h * 60 + min;
}

/** Số ngày của tháng chứa ngày `date`. */
function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/** Hôm nay có phải ngày nhắc theo quy tắc lặp không? */
function matchesDay(rule: ReminderRule, now: Date, todayIso: string): boolean {
  switch (rule.repeatKind) {
    case 'daily':
      return true;
    case 'weekly':
      return now.getDay() === (rule.weekday ?? 1);
    case 'monthly': {
      const want = rule.dayOfMonth ?? 1;
      const last = daysInMonth(now);
      // Chọn ngày 31 mà tháng chỉ có 30 → nhắc vào ngày cuối tháng.
      return now.getDate() === Math.min(want, last);
    }
    case 'once':
      return (rule.onDate || '') === todayIso;
    default:
      return false;
  }
}

/**
 * Tới giờ nhắc chưa?
 * `graceMinutes`: vẫn bắn nếu lỡ mất giờ hẹn trong khoảng này (lịch chạy nền không
 * chính xác từng phút). Đã bắn hôm nay rồi thì thôi — chặn bằng lastFired.
 */
export function isDue(
  rule: ReminderRule,
  now: Date,
  todayIso: string,
  graceMinutes = 180,
): boolean {
  if (rule.lastFired === todayIso) return false;
  if (!matchesDay(rule, now, todayIso)) return false;
  const target = hhmmToMinutes(rule.atTime);
  if (!Number.isFinite(target)) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= target && cur - target <= graceMinutes;
}

/** Nhắc 1 lần đã qua ngày hẹn → tự tắt cho gọn danh sách. */
export function isExpiredOnce(rule: ReminderRule, todayIso: string): boolean {
  return rule.repeatKind === 'once' && !!rule.onDate && rule.onDate < todayIso;
}

const REPEAT_VI: Record<RepeatKind, string> = {
  once: 'một lần',
  daily: 'hằng ngày',
  weekly: 'hằng tuần',
  monthly: 'hằng tháng',
};
const WEEKDAY_VI = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

/** Mô tả lịch nhắc bằng tiếng Việt cho UI và câu trả lời của trợ lý. */
export function describeRule(rule: ReminderRule): string {
  const at = `lúc ${rule.atTime}`;
  switch (rule.repeatKind) {
    case 'daily':
      return `${REPEAT_VI.daily} ${at}`;
    case 'weekly':
      return `${REPEAT_VI.weekly} vào ${WEEKDAY_VI[rule.weekday ?? 1]} ${at}`;
    case 'monthly':
      return `${REPEAT_VI.monthly} vào ngày ${rule.dayOfMonth ?? 1} ${at}`;
    case 'once':
      return `${REPEAT_VI.once} ngày ${rule.onDate || '—'} ${at}`;
    default:
      return at;
  }
}
