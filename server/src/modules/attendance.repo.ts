import { q } from '../db/client.js';
import type { AttendanceRow, AttendanceMode } from '../types.js';

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
