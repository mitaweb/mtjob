import { getScoringTasks, getDoneTasksForMemberRange } from './tasks.repo.js';
import { getActiveMembers, findById } from './members.repo.js';
import { sumPointsForMember, aggregateByMember, rankMembers } from '../lib/scores.js';
import { computeBonus, type BonusConfig } from '../lib/money.js';
import { heSoThuongDiem } from './projectBonus.service.js';
import { unionMinutes, taskIntervalsForDay, overlappingIds } from '../lib/worktime.js';
import { taskTitle } from '../lib/tasks.js';
import { ADJUST_SOURCE } from '../lib/adjust.js';
import { getConfig } from '../config.js';
import { nowTz, monthRange, todayIso, dayBoundsMs, fmtHm } from '../lib/datetime.js';
import type { TaskRow } from '../types.js';

async function bonusCfg(): Promise<BonusConfig> {
  const c = await getConfig();
  return { threshold: c.bonusThreshold, step: c.bonusStep, amount: c.bonusAmount };
}

/** Tổng giờ làm trong ngày của 1 thành viên (hợp nhất khoảng chồng lấn — task song song tính 1 lần). */
function workMinutesForDay(tasks: TaskRow[], memberId: string, dayIso: string): number {
  const { startMs, endMs } = dayBoundsMs(dayIso);
  const mine = tasks.filter((t) => t.memberId === memberId);
  return unionMinutes(taskIntervalsForDay(mine, startMs, endMs, Date.now()));
}

export interface MemberScore {
  memberId: string;
  fullName: string;
  teamId: string;
  year: number;
  month: number;
  todayPoints: number;
  monthPoints: number;
  /** Thưởng điểm ĐÃ nhân hệ số KPI — đây là số người ta thực nhận. */
  bonus: number;
  /** Thưởng điểm trước khi soi kết quả dự án. Để màn hình giải thích được vì sao bị cắt. */
  bonusGoc: number;
  /** 1 hoặc 0,5. Bằng 0,5 khi có dự án đạt dưới 50%. */
  heSoKpi: number;
  workMinutesToday: number;
}

export interface RankedMemberScore extends MemberScore {
  rank: number;
}

export async function memberScore(memberId: string, year?: number, month?: number): Promise<MemberScore> {
  const now = nowTz();
  const y = year ?? now.year();
  const m = month ?? now.month() + 1;
  const { start, end } = monthRange(y, m);
  const today = todayIso();
  const tasks = await getScoringTasks(start, end, today);
  // Điểm chỉ tính task đã hoàn thành; giờ làm tính cả task đang chạy.
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const member = await findById(memberId);
  const monthPoints = sumPointsForMember(doneTasks, memberId, start, end);
  const todayPoints = sumPointsForMember(doneTasks, memberId, today, today);
  const bonusGoc = computeBonus(monthPoints, await bonusCfg());
  // Kết quả dự án cắt vào thưởng điểm — trả số THỰC NHẬN, không trả số gốc rồi để người
  // ta trông chờ vào con số không có thật.
  const heSoKpi = (await heSoThuongDiem(y, m)).get(memberId) ?? 1;
  return {
    memberId,
    fullName: member?.fullName || '',
    teamId: member?.teamId || '',
    year: y,
    month: m,
    todayPoints,
    monthPoints,
    bonus: Math.round(bonusGoc * heSoKpi),
    bonusGoc,
    heSoKpi,
    workMinutesToday: workMinutesForDay(tasks, memberId, today),
  };
}

/**
 * Điểm của NHIỀU thành viên trong MỘT lượt truy vấn.
 * Gọi memberScore trong vòng lặp sẽ quét lại bảng task cho từng người — với 15 người
 * là 15 lần quét cả tháng, đủ làm job báo cáo hết giờ trước khi chạy xong.
 */
export async function scoresFor(
  members: Array<{ id: string; fullName: string; teamId: string }>,
  year?: number,
  month?: number,
): Promise<MemberScore[]> {
  const now = nowTz();
  const y = year ?? now.year();
  const m = month ?? now.month() + 1;
  const { start, end } = monthRange(y, m);
  const today = todayIso();
  // MỘT lượt cho cả danh sách — gọi heSoThuongDiem trong .map là lặp lại đúng lỗi đã
  // làm job báo cáo hết giờ.
  const [tasks, cfg, heSo] = await Promise.all([
    getScoringTasks(start, end, today),
    bonusCfg(),
    heSoThuongDiem(y, m),
  ]);
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const agg = aggregateByMember(doneTasks, start, end);

  return members.map((mem) => {
    const monthPoints = agg.get(mem.id) || 0;
    const bonusGoc = computeBonus(monthPoints, cfg);
    const heSoKpi = heSo.get(mem.id) ?? 1;
    return {
      memberId: mem.id,
      fullName: mem.fullName,
      teamId: mem.teamId,
      year: y,
      month: m,
      todayPoints: sumPointsForMember(doneTasks, mem.id, today, today),
      monthPoints,
      bonus: Math.round(bonusGoc * heSoKpi),
      bonusGoc,
      heSoKpi,
      workMinutesToday: workMinutesForDay(tasks, mem.id, today),
    };
  });
}

/** Gắn thứ hạng theo điểm tháng (điểm bằng nhau thì cùng hạng). */
export function withRanks(scores: MemberScore[]): RankedMemberScore[] {
  const ranked = rankMembers(new Map(scores.map((s) => [s.memberId, s.monthPoints])));
  const rankByMember = new Map(ranked.map((r) => [r.memberId, r.rank]));
  return scores
    .map((s) => ({ ...s, rank: rankByMember.get(s.memberId) || 0 }))
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Chi tiết công việc THEO NGÀY của một người trong tháng.
 *
 * Dùng chung cho hai màn hình: giám đốc soi nhân sự, và nhân viên tự xem mình.
 * Giờ làm là dữ liệu gốc để đối chiếu điểm, nên mỗi việc trả kèm khung giờ,
 * thời lượng, và cờ cảnh báo (chồng giờ / không có giờ / vắt qua ngày).
 */
export async function memberWorkDetail(memberId: string, year: number, month: number) {
  const { start, end } = monthRange(year, month);

  // MỘT lần quét bảng task cho cả điểm lẫn thứ hạng. Trước đây gọi memberScore rồi lại
  // gọi ranking — cả hai đều quét lại cả tháng, tốn gấp đôi cho cùng một dữ liệu.
  const [tasks, members] = await Promise.all([
    getDoneTasksForMemberRange(memberId, start, end),
    getActiveMembers(),
  ]);
  const scores = await scoresFor(members, year, month);

  // Bảng xếp hạng CHỈ gồm vai nhân viên, nhưng màn hình này mở được cho cả leader —
  // nên điểm lấy từ `scores` (có mọi người), còn hạng thì tra trong bảng đã lọc.
  const rankableIds = new Set(members.filter((x) => x.role === 'member').map((x) => x.id));
  const rank =
    withRanks(scores.filter((s) => rankableIds.has(s.memberId))).find((r) => r.memberId === memberId)
      ?.rank ?? 0;
  const score = scores.find((s) => s.memberId === memberId) ?? {
    monthPoints: 0,
    bonus: 0,
  };

  const byDay = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const day = (t.completedAt || t.createdAt || '').slice(0, 10);
    if (!day) continue;
    byDay.set(day, [...(byDay.get(day) || []), t]);
  }

  const nowMs = Date.now();
  const days = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // mới nhất trước
    .map(([date, list]) => {
      const { startMs, endMs } = dayBoundsMs(date);
      const overlaps = new Set(overlappingIds(list));
      return {
        date,
        points: list.reduce((s, t) => s + (Number(t.points) || 0), 0),
        // Giờ làm ĐÃ GỘP khoảng chồng lấn — tổng thời lượng từng việc có thể lớn hơn.
        minutes: unionMinutes(taskIntervalsForDay(list, startMs, endMs, nowMs)),
        // Dòng bù điểm không tính vào cảnh báo "việc không có giờ": nó không phải việc
        // ai đó quên bấm giờ, mà là điểm giám đốc nhập tay — có giờ mới là sai.
        noTimeCount: list.filter((t) => !t.startedAt && t.source !== ADJUST_SOURCE).length,
        tasks: list.map((t) => ({
          id: t.id,
          title: taskTitle(t), // kèm ghi chú / tên khách
          points: t.points,
          adjusted: t.source === ADJUST_SOURCE,
          completedAt: t.completedAt,
          // Định dạng giờ ở MÁY CHỦ theo giờ VN — máy người xem có thể ở múi giờ khác.
          startHm: t.startedAt ? fmtHm(t.startedAt) : '',
          endHm: t.completedAt ? fmtHm(t.completedAt) : '',
          minutes:
            t.startedAt && t.completedAt
              ? Math.max(0, Math.round((Date.parse(t.completedAt) - Date.parse(t.startedAt)) / 60000))
              : null,
          overlap: overlaps.has(t.id),
          crossDay: !!t.startedAt && t.startedAt.slice(0, 10) !== date,
        })),
      };
    });

  return { year, month, score: { monthPoints: score.monthPoints, bonus: score.bonus, rank }, days };
}

/** Ranked month scores — CHỈ nhân viên (admin/leader/giám đốc không vào bảng xếp hạng). */
export async function ranking(year?: number, month?: number, teamId?: string): Promise<RankedMemberScore[]> {
  let members = (await getActiveMembers()).filter((x) => x.role === 'member');
  if (teamId) members = members.filter((x) => x.teamId === teamId);
  return withRanks(await scoresFor(members, year, month));
}
