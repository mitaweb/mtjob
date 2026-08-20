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

// ── Đồng bộ điểm việc cũ theo bảng điểm mới ──

/** Một dòng việc sắp đổi điểm: `cu` là điểm đang lưu, `moi` là điểm trong danh mục. */
export interface PointChange {
  memberName: string;
  taskName: string;
  cu: number;
  moi: number;
}

export interface PointChangeSummary {
  updated: number;
  /** Ai bị ảnh hưởng nặng nhất lên đầu — `delta` âm là bị trừ điểm. */
  byMember: Array<{ memberName: string; tasks: number; delta: number }>;
  byTask: Array<{ taskName: string; cu: number; moi: number; tasks: number }>;
}

/**
 * Một TÊN việc đã ghi mà bảng điểm hiện không còn dòng nào tên đó.
 *
 * Anh Tâm 20/8/2026: "k quan tâm mã cv, chỉ quan tâm tên cv". Đồng bộ khớp theo TÊN, nên
 * đổi tên một đầu việc trong Sheet là việc cũ mang tên cũ hết chỗ bám — điểm giữ nguyên.
 * Không phải lỗi, nhưng phải nói ra: im lặng thì mấy trăm việc đứng yên mãi mà không ai biết.
 */
export interface TenNgoaiBang {
  ten: string;
  soViec: number;
  diem: number;
}

/** Câu tóm tắt cho giám đốc đọc, hoặc '' nếu mọi tên việc đều còn trong bảng điểm. */
export function moTaNgoaiBang(list: TenNgoaiBang[]): string {
  if (list.length === 0) return '';
  const viec = list.reduce((s, x) => s + x.soViec, 0);
  return (
    `${list.length} tên việc đã ghi không còn trong bảng điểm (${viec} việc) — giữ nguyên điểm cũ. ` +
    'Thường là do đổi tên đầu việc trong Sheet.'
  );
}

/**
 * Một tên việc mà bảng điểm ghi NHIỀU mức điểm khác nhau.
 *
 * Khớp theo tên thì tên phải trỏ về đúng một mức điểm. Hai dòng cùng tên khác điểm là
 * không quyết được lấy mức nào — bỏ qua và báo, chứ đoán bừa thì sai mà không ai hay.
 */
export interface TenTrungDiem {
  ten: string;
  diems: string;
}

/**
 * Gom danh sách việc đổi điểm thành báo cáo cho giám đốc xem.
 * Thuần, không đụng DB — vì con số này ăn thẳng vào thưởng nên phải kiểm được bằng test.
 */
export function summarizePointChanges(rows: PointChange[]): PointChangeSummary {
  const byMember = new Map<string, { tasks: number; delta: number }>();
  const byTask = new Map<string, { taskName: string; cu: number; moi: number; tasks: number }>();

  for (const r of rows) {
    const cu = Number(r.cu) || 0;
    const moi = Number(r.moi) || 0;
    const m = byMember.get(r.memberName) || { tasks: 0, delta: 0 };
    byMember.set(r.memberName, { tasks: m.tasks + 1, delta: m.delta + (moi - cu) });
    // Cùng loại việc có thể đổi từ nhiều mức cũ khác nhau → tách theo cặp (cũ → mới).
    const key = `${r.taskName}|${cu}|${moi}`;
    const t = byTask.get(key) || { taskName: r.taskName, cu, moi, tasks: 0 };
    byTask.set(key, { ...t, tasks: t.tasks + 1 });
  }

  return {
    updated: rows.length,
    byMember: [...byMember.entries()]
      .map(([memberName, v]) => ({ memberName, ...v }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    byTask: [...byTask.values()].sort((a, b) => b.tasks - a.tasks),
  };
}
