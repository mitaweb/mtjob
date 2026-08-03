// Attendance geometry & shift logic. Pure functions — fully unit-tested.
import { hmToMinutes } from './datetime.js';

export interface ShiftConfig {
  morningStart: number; // minutes from midnight
  morningEnd: number;
  afternoonStart: number;
  afternoonEnd: number;
}

export const DEFAULT_SHIFTS: ShiftConfig = {
  morningStart: 8 * 60 + 30,
  morningEnd: 12 * 60,
  afternoonStart: 13 * 60 + 30,
  afternoonEnd: 17 * 60,
};

export function shiftConfigFrom(c: {
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
}): ShiftConfig {
  return {
    morningStart: hmToMinutes(c.morningStart),
    morningEnd: hmToMinutes(c.morningEnd),
    afternoonStart: hmToMinutes(c.afternoonStart),
    afternoonEnd: hmToMinutes(c.afternoonEnd),
  };
}

export type Shift = 'morning' | 'afternoon';

/** Great-circle distance in metres between two lat/lng points (haversine). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function withinRadius(distM: number, radiusM: number): boolean {
  return distM <= radiusM;
}

/** Which shift a given minute-of-day belongs to (boundary at afternoonStart). */
export function classifyShift(minuteOfDay: number, cfg: ShiftConfig = DEFAULT_SHIFTS): Shift {
  return minuteOfDay < cfg.afternoonStart ? 'morning' : 'afternoon';
}

/** Whether a check-in at minuteOfDay is late for its shift start (+grace). */
export function isLate(
  minuteOfDay: number,
  shift: Shift,
  cfg: ShiftConfig = DEFAULT_SHIFTS,
  graceMin = 0,
): boolean {
  const start = shift === 'morning' ? cfg.morningStart : cfg.afternoonStart;
  return minuteOfDay > start + graceMin;
}

/**
 * Day credit from a day's check-ins/outs: each attended half = 0.5, capped at 1.0.
 * Morning is attended when there's a morning check-in. Afternoon is attended when
 * there's ANY afternoon timestamp — a check-in OR a check-out — so the common flow
 * of "chấm giờ vào buổi sáng, chấm giờ ra buổi chiều" (no separate afternoon
 * check-in) still credits a full day.
 *   morning in + afternoon out (whole day) -> 1.0
 *   morning only (checkout at noon) -> 0.5
 *   afternoon only -> 0.5
 */
export function dayFractionFromShifts(m: {
  morningIn?: unknown;
  afternoonIn?: unknown;
  afternoonOut?: unknown;
}): number {
  let f = 0;
  if (m.morningIn) f += 0.5;
  if (m.afternoonIn || m.afternoonOut) f += 0.5;
  return Math.min(1, f);
}

/** Day credit for an approved online/leave request scope. */
export function fractionForScope(scope: 'half_am' | 'half_pm' | 'full'): number {
  return scope === 'full' ? 1 : 0.5;
}

/**
 * Sai số định vị TỐI ĐA còn tin được (mét).
 *
 * Anh Tâm 3/8/2026: máy tính nối WiFi báo cách công ty 6121m trong khi đang ngồi ở văn
 * phòng. Máy tính không có chip GPS nên trình duyệt định vị bằng WiFi/IP — ra vị trí trạm
 * của nhà mạng, lệch hàng km. Sai số lớn hơn ngưỡng này thì con số khoảng cách vô nghĩa,
 * không được dùng để kết luận gì.
 */
export const MAX_ACCURACY_M = 200;

export type LocationVerdict = 'ok' | 'too_far' | 'inaccurate';

/**
 * Kết luận về vị trí chấm công.
 *
 * Trừ sai số trước khi so bán kính: đo được 350m với sai số 100m nghĩa là vị trí thật
 * nằm đâu đó trong khoảng 250–450m, nên vẫn có thể đang ở trong vùng cho phép. Bắt bẻ
 * đúng con số đo được là phạt oan người đứng ngay cửa văn phòng.
 */
export function locationVerdict(distM: number, accuracyM: number, radiusM: number): LocationVerdict {
  const acc = Number.isFinite(accuracyM) && accuracyM > 0 ? accuracyM : 0;
  // Không có số sai số (máy cũ) thì xử như trước: so thẳng khoảng cách.
  if (acc > MAX_ACCURACY_M) return 'inaccurate';
  return distM - acc <= radiusM ? 'ok' : 'too_far';
}
