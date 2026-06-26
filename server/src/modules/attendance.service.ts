import { ApiError } from '../util/errors.js';
import { getConfig } from '../config.js';
import { findById } from './members.repo.js';
import { getMemberDate, saveAttendance } from './attendance.repo.js';
import { approvedOnlineScope } from './requests.repo.js';
import {
  shiftConfigFrom,
  classifyShift,
  haversineMeters,
  withinRadius,
  isLate,
  dayFractionFromShifts,
  type Shift,
} from '../lib/attendance.js';
import { nowTz, todayIso, minuteOfDayTz } from '../lib/datetime.js';
import type { AttendanceRow, AttendanceMode, Member } from '../types.js';

function baseRow(member: Member, date: string, mode: AttendanceMode): AttendanceRow {
  return {
    date,
    memberId: member.id,
    name: member.fullName,
    morningInAt: '',
    morningOutAt: '',
    afternoonInAt: '',
    afternoonOutAt: '',
    dayFraction: 0,
    mode,
    status: 'absent',
  };
}

function computeStatus(fraction: number, late: boolean): string {
  if (fraction >= 1) return late ? 'late' : 'present';
  if (fraction > 0) return late ? 'late-half' : 'half';
  return 'absent';
}

export interface CheckResult {
  shift: Shift;
  time: string;
  late: boolean;
  distanceM: number | null;
  dayFraction: number;
  mode: AttendanceMode;
}

export async function checkIn(memberId: string, lat: number, lng: number): Promise<CheckResult> {
  const member = await findById(memberId);
  if (!member) throw new ApiError(404, 'Không tìm thấy thành viên');

  const cfg = await getConfig();
  const shifts = shiftConfigFrom(cfg);
  const date = todayIso();
  const minute = minuteOfDayTz();
  const shift = classifyShift(minute, shifts);
  const dist = haversineMeters(lat, lng, cfg.companyLat, cfg.companyLng);

  const online = await approvedOnlineScope(memberId, date);
  const mode: AttendanceMode = online ? 'online' : 'office';

  if (!online && !withinRadius(dist, cfg.checkinRadiusM)) {
    throw new ApiError(
      400,
      `Bạn đang cách công ty khoảng ${Math.round(dist)}m (cho phép tối đa ${cfg.checkinRadiusM}m). Chưa thể chấm công.`,
    );
  }

  const row = (await getMemberDate(memberId, date)) ?? baseRow(member, date, mode);
  const iso = nowTz().toISOString();
  if (shift === 'morning' && !row.morningInAt) row.morningInAt = iso;
  if (shift === 'afternoon' && !row.afternoonInAt) row.afternoonInAt = iso;
  row.lat = lat;
  row.lng = lng;
  row.distM = Math.round(dist);
  row.mode = mode;
  row.dayFraction = dayFractionFromShifts({ morningIn: row.morningInAt, afternoonIn: row.afternoonInAt, afternoonOut: row.afternoonOutAt });
  const late = isLate(minute, shift, shifts);
  row.status = computeStatus(row.dayFraction, late);
  await saveAttendance(row);

  return { shift, time: iso, late, distanceM: Math.round(dist), dayFraction: row.dayFraction, mode };
}

export async function checkOut(memberId: string, lat: number, lng: number): Promise<CheckResult> {
  const member = await findById(memberId);
  if (!member) throw new ApiError(404, 'Không tìm thấy thành viên');

  const cfg = await getConfig();
  const shifts = shiftConfigFrom(cfg);
  const date = todayIso();
  const minute = minuteOfDayTz();
  const shift = classifyShift(minute, shifts);
  const dist = haversineMeters(lat, lng, cfg.companyLat, cfg.companyLng);

  const online = await approvedOnlineScope(memberId, date);
  if (!online && !withinRadius(dist, cfg.checkinRadiusM)) {
    throw new ApiError(
      400,
      `Bạn đang cách công ty khoảng ${Math.round(dist)}m (cho phép tối đa ${cfg.checkinRadiusM}m). Chưa thể chấm giờ ra.`,
    );
  }

  const existing = await getMemberDate(memberId, date);
  const row = existing ?? baseRow(member, date, online ? 'online' : 'office');
  const iso = nowTz().toISOString();
  if (shift === 'morning') row.morningOutAt = iso;
  if (shift === 'afternoon') row.afternoonOutAt = iso;
  if (lat) row.lat = lat;
  if (lng) row.lng = lng;
  row.distM = Math.round(dist);
  row.dayFraction = dayFractionFromShifts({ morningIn: row.morningInAt, afternoonIn: row.afternoonInAt, afternoonOut: row.afternoonOutAt });
  row.status = computeStatus(row.dayFraction, /^late/.test(row.status));
  await saveAttendance(row);

  return { shift, time: iso, late: false, distanceM: Math.round(dist), dayFraction: row.dayFraction, mode: row.mode };
}
