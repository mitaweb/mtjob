import { q } from '../db/client.js';
import type { AttendanceRow, AttendanceMode } from '../types.js';

/** Một lần chấm công hỏng (máy chủ từ chối, hoặc điện thoại không lấy được vị trí). */
export interface LanChamHong {
  ngay: string;
  luc: string;
  loai: string;
  lyDo: string;
  saiSo: number | null;
  may: string;
}

export async function ghiLanChamHong(memberId: string, x: Omit<LanChamHong, 'ngay'> & { ngay: string; id: string }): Promise<void> {
  await q(
    'INSERT INTO attendance_thu (id, member_id, ngay, luc, loai, ly_do, sai_so, may) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
    [x.id, memberId, x.ngay, x.luc, x.loai, x.lyDo.slice(0, 400), x.saiSo, x.may.slice(0, 80)],
  );
}

export async function demLanChamHong(memberId: string, ngay: string): Promise<number> {
  const r = await q('SELECT COUNT(*)::int AS n FROM attendance_thu WHERE member_id = $1 AND ngay = $2', [memberId, ngay]);
  return Number(r[0]?.n) || 0;
}

export async function lanChamHongTrongKhoang(memberId: string, tu: string, den: string): Promise<LanChamHong[]> {
  const rows = await q('SELECT * FROM attendance_thu WHERE member_id = $1 AND ngay >= $2 AND ngay <= $3 ORDER BY luc', [memberId, tu, den]);
  return rows.map((r) => ({
    ngay: String(r.ngay),
    luc: String(r.luc),
    loai: String(r.loai || ''),
    lyDo: String(r.ly_do || ''),
    saiSo: r.sai_so === null || r.sai_so === undefined ? null : Number(r.sai_so),
    may: String(r.may || ''),
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAttendance(r: any): AttendanceRow {
  return {
    date: r.date || '',
    memberId: r.member_id || '',
    name: r.name || '',
    morningInAt: r.morning_in_at || '',
    morningOutAt: r.morning_out_at || '',
    afternoonInAt: r.afternoon_in_at || '',
    afternoonOutAt: r.afternoon_out_at || '',
    lat: r.lat == null ? undefined : Number(r.lat),
    lng: r.lng == null ? undefined : Number(r.lng),
    distM: r.dist_m == null ? undefined : Number(r.dist_m),
    dayFraction: Number(r.day_fraction || 0) || 0,
    mode: (r.mode || 'office') as AttendanceMode,
    status: r.status || '',
    note: r.note || '',
  };
}

/**
 * Toàn bộ bảng chấm công.
 *
 * CHỈ dùng cho script bảo trì chạy tay (`scripts/audit-attendance`, `backfill-*`,
 * `fix-backfill-joindate`) — chúng cần soi cả lịch sử. TUYỆT ĐỐI không gọi trong đường
 * request: bảng này lớn dần theo từng ngày công của từng người. Trong app hãy dùng
 * `getAttendanceBetween` hoặc `getForMemberRange`.
 */
export async function getAllAttendance(): Promise<AttendanceRow[]> {
  const rows = await q('SELECT * FROM attendance');
  return rows.map(rowToAttendance);
}

/** Chấm công của MỌI thành viên trong [start, end] (YYYY-MM-DD, inclusive). */
export async function getAttendanceBetween(start: string, end: string): Promise<AttendanceRow[]> {
  const rows = await q('SELECT * FROM attendance WHERE date BETWEEN $1 AND $2', [start, end]);
  return rows.map(rowToAttendance);
}

export async function getMemberDate(memberId: string, date: string): Promise<AttendanceRow | undefined> {
  const rows = await q('SELECT * FROM attendance WHERE member_id = $1 AND date = $2 LIMIT 1', [memberId, date]);
  return rows.length ? rowToAttendance(rows[0]) : undefined;
}

export async function getForMemberRange(memberId: string, start: string, end: string): Promise<AttendanceRow[]> {
  const rows = await q(
    'SELECT * FROM attendance WHERE member_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date DESC',
    [memberId, start, end],
  );
  return rows.map(rowToAttendance);
}

export async function getForDate(date: string): Promise<AttendanceRow[]> {
  const rows = await q('SELECT * FROM attendance WHERE date = $1 ORDER BY name', [date]);
  return rows.map(rowToAttendance);
}

/** Xoá 1 dòng chấm công (dùng khi huỷ duyệt đơn online/nghỉ phép đã ghi công). */
export async function deleteAttendance(date: string, memberId: string): Promise<void> {
  await q('DELETE FROM attendance WHERE date = $1 AND member_id = $2', [date, memberId]);
}

export async function saveAttendance(a: AttendanceRow): Promise<void> {
  await q(
    `INSERT INTO attendance (date, member_id, name, morning_in_at, morning_out_at, afternoon_in_at, afternoon_out_at,
                             lat, lng, dist_m, day_fraction, mode, status, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (date, member_id) DO UPDATE SET
       name = EXCLUDED.name,
       morning_in_at = EXCLUDED.morning_in_at,
       morning_out_at = EXCLUDED.morning_out_at,
       afternoon_in_at = EXCLUDED.afternoon_in_at,
       afternoon_out_at = EXCLUDED.afternoon_out_at,
       lat = EXCLUDED.lat,
       lng = EXCLUDED.lng,
       dist_m = EXCLUDED.dist_m,
       day_fraction = EXCLUDED.day_fraction,
       mode = EXCLUDED.mode,
       status = EXCLUDED.status,
       note = EXCLUDED.note`,
    [
      a.date, a.memberId, a.name,
      a.morningInAt || '', a.morningOutAt || '', a.afternoonInAt || '', a.afternoonOutAt || '',
      a.lat ?? null, a.lng ?? null, a.distM ?? null,
      a.dayFraction, a.mode, a.status, a.note || '',
    ],
  );
}
