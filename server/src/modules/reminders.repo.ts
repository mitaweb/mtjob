import { q } from '../db/client.js';
import type { RepeatKind } from '../lib/reminder.js';

export interface Reminder {
  id: string;
  memberId: string;
  title: string;
  atTime: string; // "HH:mm" giờ VN
  repeatKind: RepeatKind;
  onDate: string;
  weekday: number;
  dayOfMonth: number;
  active: boolean;
  lastFired: string;
  createdAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToReminder(r: any): Reminder {
  return {
    id: r.rem_id || '',
    memberId: r.member_id || '',
    title: r.title || '',
    atTime: r.at_time || '08:00',
    repeatKind: (r.repeat_kind || 'once') as RepeatKind,
    onDate: r.on_date || '',
    weekday: Number(r.weekday ?? 1),
    dayOfMonth: Number(r.day_of_month ?? 1),
    active: !!r.active,
    lastFired: r.last_fired || '',
    createdAt: r.created_at || '',
  };
}

export async function addReminder(r: Reminder): Promise<void> {
  await q(
    `INSERT INTO reminders
       (rem_id, member_id, title, at_time, repeat_kind, on_date, weekday, day_of_month, active, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)`,
    [r.id, r.memberId, r.title, r.atTime, r.repeatKind, r.onDate, r.weekday, r.dayOfMonth, r.createdAt],
  );
}

/** Nhắc hẹn của MỘT người — chỉ chính chủ xem/sửa được. */
export async function getReminders(memberId: string): Promise<Reminder[]> {
  const rows = await q('SELECT * FROM reminders WHERE member_id = $1 ORDER BY at_time', [memberId]);
  return rows.map(rowToReminder);
}

/** Mọi nhắc hẹn đang bật — cho lượt quét tới hạn. */
export async function getActiveReminders(): Promise<Reminder[]> {
  const rows = await q('SELECT * FROM reminders WHERE active = true');
  return rows.map(rowToReminder);
}

export async function setReminderActive(id: string, memberId: string, active: boolean): Promise<boolean> {
  const rows = await q(
    'UPDATE reminders SET active = $3 WHERE rem_id = $1 AND member_id = $2 RETURNING rem_id',
    [id, memberId, active],
  );
  return rows.length > 0;
}

export async function deleteReminder(id: string, memberId: string): Promise<void> {
  await q('DELETE FROM reminders WHERE rem_id = $1 AND member_id = $2', [id, memberId]);
}

/**
 * Đánh dấu đã bắn hôm nay. Điều kiện `last_fired <> $2` khiến hai tiến trình chạy
 * song song chỉ một cái ăn — chống gửi trùng thông báo.
 */
export async function markFired(id: string, todayIso: string): Promise<boolean> {
  const rows = await q(
    'UPDATE reminders SET last_fired = $2 WHERE rem_id = $1 AND last_fired <> $2 RETURNING rem_id',
    [id, todayIso],
  );
  return rows.length > 0;
}

export async function findReminder(id: string): Promise<Reminder | undefined> {
  const r = await q('SELECT * FROM reminders WHERE rem_id = $1 LIMIT 1', [id]);
  return r.length ? rowToReminder(r[0]) : undefined;
}

/**
 * Ghi đè (hoặc tạo) một nhắc theo mã cố định — dùng cho nhắc việc gộp mỗi khách MỘT nhắc (anh Tâm
 * 11/10/2026: "1 khách hàng 1 thông báo sau khi tổng hợp thông tin"). Bật lại + xoá mốc đã bắn để nhắc
 * nội dung mới nhất.
 */
export async function luuNhacGop(r: Reminder): Promise<void> {
  await q(
    `INSERT INTO reminders
       (rem_id, member_id, title, at_time, repeat_kind, on_date, weekday, day_of_month, active, last_fired, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,'',$9)
     ON CONFLICT (rem_id) DO UPDATE SET title = EXCLUDED.title, at_time = EXCLUDED.at_time,
       repeat_kind = EXCLUDED.repeat_kind, on_date = EXCLUDED.on_date, active = true, last_fired = ''`,
    [r.id, r.memberId, r.title, r.atTime, r.repeatKind, r.onDate, r.weekday, r.dayOfMonth, r.createdAt],
  );
}

/** Tắt các nhắc có mã bắt đầu bằng `tienTo` (trừ `giu`) — dọn nhắc lẻ kiểu cũ khi đã gộp. */
export async function tatNhacTheoTienTo(tienTo: string, giu = ''): Promise<number> {
  const r = await q(`UPDATE reminders SET active = false WHERE active AND rem_id LIKE $1 AND rem_id <> $2 RETURNING rem_id`, [
    `${tienTo.replace(/[\%_]/g, (c) => `\${c}`)}%`,
    giu,
  ]);
  return r.length;
}

export async function tatNhac(id: string): Promise<void> {
  await q('UPDATE reminders SET active = false WHERE rem_id = $1', [id]);
}

/** Nhắc đang bật có mã bắt đầu bằng `tienTo`. */
export async function nhacDangBatTheoTienTo(tienTo: string): Promise<Reminder[]> {
  const r = await q(`SELECT * FROM reminders WHERE active AND rem_id LIKE $1 ORDER BY created_at`, [
    `${tienTo.replace(/[\%_]/g, (c) => `\${c}`)}%`,
  ]);
  return r.map(rowToReminder);
}
