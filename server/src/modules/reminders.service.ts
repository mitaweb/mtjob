// Nhắc hẹn cá nhân: chỉ người tạo nhận được thông báo.
//
// Bắn theo HAI đường bổ trợ nhau:
//   1. GET /api/jobs/reminders — Vercel Cron gọi MỖI PHÚT (vercel.json, gói Pro — từ 17/10/2026; trước đó
//      dùng cron-job.org, dịch vụ này tự ngừng gọi từ 15/10 làm Zalo đứng 3 ngày) → đúng giờ, và chạy Zalo.
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

    // Nhắc gộp từ Zalo (mã ZR-…): AI đọc lại chat gần nhất của khách ngay trước khi bắn — bỏ việc đã xong,
    // cập nhật việc mới, dời nếu khách hẹn ngày khác (anh Tâm 11/10/2026: "đã giải quyết ... mà giờ còn
    // nhắc lại"). AI lỗi thì bắn như cũ.
    let title = r.title;
    if (r.id.startsWith('ZR-')) {
      try {
        const { xetLaiNhacZalo } = await import('./zalo.service.js');
        const x = await xetLaiNhacZalo(r);
        if (x.ket === 'xong') {
          await setReminderActive(r.id, r.memberId, false).catch(() => undefined);
          continue;
        }
        if (x.ket === 'doi') continue; // đã dời sang hẹn sau (ghi lại nhắc, bật lại)
        if (x.ket === 'moi') title = x.title;
      } catch (e) {
        console.warn('[reminders] xét lại nhắc Zalo:', (e as Error).message);
      }
    }

    await notify(r.memberId, {
      type: 'reminder',
      title: `⏰ ${title}`,
      body: `Nhắc hẹn ${describeRule(rule)}.`,
      // Bấm thông báo → mở thẳng tab Nhắc hẹn (trước mở trang Chat).
      url: '/inbox?tab=remind',
      // Mã nhắc — nhắc gộp của khách (ZR-K-<khách>) thì nút "Mở trang liên quan" mở đúng khách trong CRM.
      refId: r.id,
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
// Bắt đầu tính từ lúc instance khởi động: request ĐẦU TIÊN của instance lạnh không phải gánh thêm lượt quét
// (giành kết nối DB với chính request đó). Cron-job.org gọi /api/jobs/reminders 5 phút/lần đã lo việc quét
// (anh Tâm 12/10/2026: tăng tốc app).
let lastSweep = Date.now();
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
