import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

// Business timezone. Deliberately NOT process.env.TZ: serverless hosts set
// system values like ':UTC' (AWS Lambda) which are not valid IANA zones.
export const TZ = process.env.APP_TZ || 'Asia/Ho_Chi_Minh';
export { dayjs };

/** Current moment in the app timezone. */
export function nowTz() {
  return dayjs().tz(TZ);
}

/** Today's date (YYYY-MM-DD) in the app timezone. */
export function todayIso(): string {
  return nowTz().format('YYYY-MM-DD');
}

/**
 * Parse a Vietnamese-style date string (dd/mm/yyyy and a few variants)
 * into an ISO date string `YYYY-MM-DD`. Returns null when unparseable.
 */
export function parseVnDate(s: string | number | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (!t) return null;
  const fmts = ['DD/MM/YYYY', 'D/M/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'D-M-YYYY'];
  for (const f of fmts) {
    const d = dayjs(t, f, true);
    if (d.isValid()) return d.format('YYYY-MM-DD');
  }
  return null;
}

/** Month (1-12) of an ISO date string. */
export function monthOf(isoDate: string): number {
  return Number(isoDate.slice(5, 7));
}

/** Convert "HH:mm" to minutes from midnight. */
export function hmToMinutes(hhmm: string): number {
  const [h, m] = String(hhmm).split(':').map((x) => Number(x));
  return (h || 0) * 60 + (m || 0);
}

/** Minute-of-day (in app TZ) for an ISO datetime or Date. */
export function minuteOfDayTz(when: string | number | Date = new Date()): number {
  const d = dayjs(when).tz(TZ);
  return d.hour() * 60 + d.minute();
}

/** First and last ISO date of a given year/month. */
export function monthRange(year: number, month: number): { start: string; end: string } {
  const start = dayjs(`${year}-${String(month).padStart(2, '0')}-01`);
  return { start: start.format('YYYY-MM-DD'), end: start.endOf('month').format('YYYY-MM-DD') };
}

/** Format an ISO datetime as HH:mm in app TZ. */
export function fmtHm(iso: string): string {
  return dayjs(iso).tz(TZ).format('HH:mm');
}

/** Format an ISO date/datetime as DD/MM/YYYY in app TZ. */
export function fmtDate(iso: string): string {
  return dayjs(iso).tz(TZ).format('DD/MM/YYYY');
}

/** Epoch-ms bounds [00:00, 24:00) of a YYYY-MM-DD day in app TZ. */
export function dayBoundsMs(dayIso: string): { startMs: number; endMs: number } {
  const start = dayjs.tz(dayIso, TZ).startOf('day');
  return { startMs: start.valueOf(), endMs: start.add(1, 'day').valueOf() };
}
