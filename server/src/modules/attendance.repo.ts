import { readObjects, upsertByKeys } from '../sheets/repo.js';
import { inRange } from '../lib/scores.js';
import type { AttendanceRow, AttendanceMode } from '../types.js';

export function rowToAttendance(r: Record<string, string>): AttendanceRow {
  return {
    date: r['Date'] || '',
    memberId: r['MemberID'] || '',
    name: r['Name'] || '',
    morningInAt: r['MorningInAt'] || '',
    morningOutAt: r['MorningOutAt'] || '',
    afternoonInAt: r['AfternoonInAt'] || '',
    afternoonOutAt: r['AfternoonOutAt'] || '',
    lat: r['Lat'] ? Number(r['Lat']) : undefined,
    lng: r['Lng'] ? Number(r['Lng']) : undefined,
    distM: r['DistM'] ? Number(r['DistM']) : undefined,
    dayFraction: Number(r['DayFraction'] || 0) || 0,
    mode: (r['Mode'] || 'office') as AttendanceMode,
    status: r['Status'] || '',
    note: r['Note'] || '',
  };
}

export async function getAllAttendance(opts?: { fresh?: boolean }): Promise<AttendanceRow[]> {
  const rows = await readObjects('Attendance', opts);
  return rows.filter((r) => (r['Date'] || '').trim() && (r['MemberID'] || '').trim()).map(rowToAttendance);
}

export async function getMemberDate(memberId: string, date: string): Promise<AttendanceRow | undefined> {
  return (await getAllAttendance()).find((a) => a.memberId === memberId && a.date === date);
}

export async function getForMemberRange(memberId: string, start: string, end: string): Promise<AttendanceRow[]> {
  return (await getAllAttendance())
    .filter((a) => a.memberId === memberId && inRange(a.date, start, end))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getForDate(date: string): Promise<AttendanceRow[]> {
  return (await getAllAttendance()).filter((a) => a.date === date);
}

export async function saveAttendance(a: AttendanceRow): Promise<void> {
  await upsertByKeys(
    'Attendance',
    { Date: a.date, MemberID: a.memberId },
    {
      Date: a.date,
      MemberID: a.memberId,
      Name: a.name,
      MorningInAt: a.morningInAt || '',
      MorningOutAt: a.morningOutAt || '',
      AfternoonInAt: a.afternoonInAt || '',
      AfternoonOutAt: a.afternoonOutAt || '',
      Lat: a.lat ?? '',
      Lng: a.lng ?? '',
      DistM: a.distM ?? '',
      DayFraction: a.dayFraction,
      Mode: a.mode,
      Status: a.status,
      Note: a.note || '',
    },
  );
}
