// Daily work-time from task intervals. Pure & unit-tested.
// Rule: parallel/overlapping tasks count once — merge overlapping intervals
// (earliest start → latest end per group) then sum the merged durations.

export interface MsInterval {
  start: number; // epoch ms
  end: number; // epoch ms
}

/** Merge overlapping intervals and return total minutes (rounded). */
export function unionMinutes(intervals: MsInterval[]): number {
  const valid = intervals
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .sort((a, b) => a.start - b.start);
  let totalMs = 0;
  let curStart = Number.NaN;
  let curEnd = Number.NaN;
  for (const i of valid) {
    if (Number.isNaN(curStart)) {
      curStart = i.start;
      curEnd = i.end;
    } else if (i.start <= curEnd) {
      curEnd = Math.max(curEnd, i.end); // chồng lấn → gộp
    } else {
      totalMs += curEnd - curStart;
      curStart = i.start;
      curEnd = i.end;
    }
  }
  if (!Number.isNaN(curStart)) totalMs += curEnd - curStart;
  return Math.round(totalMs / 60000);
}

export interface TimedTask {
  startedAt?: string;
  completedAt?: string;
  status?: string;
}

/**
 * Intervals of one member's tasks clipped to a day window.
 * - Tasks still "doing" run until `nowMs`.
 * - Tasks without startedAt (logged directly as done) contribute no time.
 */
export function taskIntervalsForDay(
  tasks: TimedTask[],
  dayStartMs: number,
  dayEndMs: number,
  nowMs: number,
): MsInterval[] {
  const out: MsInterval[] = [];
  for (const t of tasks) {
    if (!t.startedAt) continue;
    const start = Date.parse(t.startedAt);
    const rawEnd = t.status === 'doing' ? nowMs : t.completedAt ? Date.parse(t.completedAt) : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) continue;
    const s = Math.max(start, dayStartMs);
    const e = Math.min(rawEnd, dayEndMs, nowMs);
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

/** Format minutes as Vietnamese short duration: 195 → "3g15p", 45 → "45p". */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}p`;
  return r === 0 ? `${h}g` : `${h}g${String(r).padStart(2, '0')}p`;
}
