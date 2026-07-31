// Nhắc hẹn cá nhân: chỉ người tạo nhận được thông báo.
//
// Vercel gói hiện tại chỉ chạy lịch tự động 1 lần/ngày, trong khi nhắc hẹn cần độ phân giải
// theo giờ. Nên bắn theo HAI đường bổ trợ nhau:
//   1. GET /api/jobs/reminders — gọi từ dịch vụ cron ngoài (vài phút/lần) → đúng giờ.
//   2. sweepRemindersOpportunistic() — móc ở middleware /api trong http/app.ts nên MỌI
//      request đều thử quét (throttle 5 phút/instance).
// Đường 2 chỉ vớt được trong cửa sổ bù 3 tiếng của isDue: hẹn 20h mà tối đó không ai mở
// app thì sáng mai đã quá hạn, không bắn nữa. Muốn đúng giờ thì PHẢI có đường 1.
// Cả hai đều idempotent nhờ cột last_fired, nên chạy chồng nhau cũng không gửi trùng.
import {
  getActiveReminders,
  markFired,
  setReminderActive,
  type Reminder,
} from './reminders.repo.js';
import { notify } from './notifications.service.js';
import { runInBackground } from '../util/background.js';
import { isDue, isExpiredOnce, describeRule } from '../lib/reminder.js';
import { nowTz, todayIso } from '../lib/datetime.js';

function toRule(r: Reminder) {
  return {
    atTime: r.atTime,
    repeatKind: r.repeatKind,
    onDate: r.onDate,
    weekday: r.weekday,
    dayOfMonth: r.dayOfMonth,
    lastFired: r.lastFired,
  };
}

/** Quét và gửi các nhắc hẹn tới hạn. Trả về số lượng đã gửi. */
export async function runDueReminders(): Promise<number> {
  const today = todayIso();
  // Dùng giờ VN để so với at_time người dùng nhập (máy chủ chạy UTC).
  const now = new Date(nowTz().format('YYYY-MM-DDTHH:mm:ss'));
  let sent = 0;

  for (const r of await getActiveReminders()) {
    const rule = toRule(r);
    // Nhắc 1 lần đã qua ngày → tắt cho gọn danh sách.
    if (isExpiredOnce(rule, today)) {
      await setReminderActive(r.id, r.memberId, false).catch(() => undefined);
      continue;
    }
    if (!isDue(rule, now, today)) continue;
    // Giành quyền gửi trước, gửi sau — hai tiến trình song song chỉ một cái ăn.
    if (!(await markFired(r.id, today))) continue;

    await notify(r.memberId, {
      type: 'reminder',
      title: `⏰ ${r.title}`,
      body: `Nhắc hẹn ${describeRule(rule)}.`,
      url: '/chat',
    });
    sent++;
    // Nhắc 1 lần đã gửi xong thì tắt luôn.
    if (r.repeatKind === 'once') {
      await setReminderActive(r.id, r.memberId, false).catch(() => undefined);
    }
  }
  return sent;
}

// Kích hoạt cơ hội khi có người dùng app — lối lui khi chưa gắn cron ngoài.
let lastSweep = 0;
const SWEEP_EVERY_MS = 5 * 60_000;

export function sweepRemindersOpportunistic(): void {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  runInBackground(
    runDueReminders()
      .then((n) => {
        if (n > 0) console.log(`[reminders] đã gửi ${n} nhắc hẹn`);
      })
      .catch((e) => console.warn('[reminders] quét lỗi:', e)),
  );
}
