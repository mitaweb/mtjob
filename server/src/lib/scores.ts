// Task-point aggregation & ranking. Pure & unit-tested.

export interface ScoreTask {
  memberId: string;
  points: number;
  completedAt?: string;
  createdAt?: string;
  teamId?: string;
}

/** Inclusive date-range test on the date part of an ISO string. */
export function inRange(iso: string | undefined, startIso: string, endIso: string): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= startIso && d <= endIso;
}

export function sumPointsForMember(
  tasks: ScoreTask[],
  memberId: string,
  startIso: string,
  endIso: string,
): number {
  return tasks.reduce(
    (s, t) =>
      t.memberId === memberId && inRange(t.completedAt ?? t.createdAt, startIso, endIso)
        ? s + (Number(t.points) || 0)
        : s,
    0,
  );
}

/** memberId -> total points within [startIso, endIso]. */
export function aggregateByMember(
  tasks: ScoreTask[],
  startIso: string,
  endIso: string,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tasks) {
    if (!inRange(t.completedAt ?? t.createdAt, startIso, endIso)) continue;
    m.set(t.memberId, (m.get(t.memberId) || 0) + (Number(t.points) || 0));
  }
  return m;
}

export interface Ranked {
  memberId: string;
  points: number;
  rank: number;
}

/** Rank members by points desc. Ties share the same (lower) rank. */
export function rankMembers(scores: Map<string, number> | Array<[string, number]>): Ranked[] {
  const arr = Array.isArray(scores) ? scores.slice() : Array.from(scores.entries());
  arr.sort((a, b) => b[1] - a[1]);
  const out: Ranked[] = [];
  let lastPoints = Number.NaN;
  let lastRank = 0;
  arr.forEach(([memberId, points], i) => {
    const rank = points === lastPoints ? lastRank : i + 1;
    out.push({ memberId, points, rank });
    lastPoints = points;
    lastRank = rank;
  });
  return out;
}
