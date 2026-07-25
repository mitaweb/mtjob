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

/**
 * ID những việc có khoảng thời gian CHỒNG LẤN với ít nhất một việc khác.
 *
 * Mở nhiều việc cùng lúc rồi đóng cùng lúc khiến một khoảng thời gian được tính điểm
 * nhiều lần — giám đốc cần nhìn thấy để đối chiếu điểm với giờ làm thật.
 * Việc chưa có giờ bắt đầu/kết thúc thì bỏ qua (không đủ dữ liệu để kết luận).
 * Chạm đầu-đuôi đúng bằng nhau KHÔNG tính là chồng: xong việc này rồi mở việc kia.
 */
export function overlappingIds(
  tasks: Array<{ id: string; startedAt?: string; completedAt?: string }>,
): string[] {
  const valid = tasks
    .map((t) => ({ id: t.id, start: Date.parse(t.startedAt || ''), end: Date.parse(t.completedAt || '') }))
    .filter((t) => Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start)
    .sort((a, b) => a.start - b.start);

  const hit = new Set<string>();
  let maxEnd = Number.NEGATIVE_INFINITY;
  let maxEndId = '';
  for (const t of valid) {
    if (t.start < maxEnd) {
      hit.add(t.id);
      if (maxEndId) hit.add(maxEndId); // dòng đang phủ lên nó cũng là một nửa của cặp
    }
    if (t.end > maxEnd) {
      maxEnd = t.end;
      maxEndId = t.id;
    }
  }
  return [...hit];
}

/** Format minutes as Vietnamese short duration: 195 → "3g15p", 45 → "45p". */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}p`;
  return r === 0 ? `${h}g` : `${h}g${String(r).padStart(2, '0')}p`;
}
