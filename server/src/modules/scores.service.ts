import { getAllTasks } from './tasks.repo.js';
import { getActiveMembers, findById } from './members.repo.js';
import { sumPointsForMember, aggregateByMember, rankMembers } from '../lib/scores.js';
import { computeBonus, type BonusConfig } from '../lib/money.js';
import { unionMinutes, taskIntervalsForDay } from '../lib/worktime.js';
import { getConfig } from '../config.js';
import { nowTz, monthRange, todayIso, dayBoundsMs } from '../lib/datetime.js';
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
  bonus: number;
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
  const tasks = await getAllTasks();
  // Điểm chỉ tính task đã hoàn thành; giờ làm tính cả task đang chạy.
  const doneTasks = tasks.filter((t) => t.status !== 'doing');
  const member = await findById(memberId);
  const monthPoints = sumPointsForMember(doneTasks, memberId, start, end);
  const todayPoints = sumPointsForMember(doneTasks, memberId, today, today);
  const bonus = computeBonus(monthPoints, await bonusCfg());
  return {
    memberId,
    fullName: member?.fullName || '',
    teamId: member?.teamId || '',
    year: y,
    month: m,
    todayPoints,
    monthPoints,
    bonus,
    workMinutesToday: workMinutesForDay(tasks, memberId, today),
  };
}

/** Ranked month scores — CHỈ nhân viên (admin/leader/giám đốc không vào bảng xếp hạng). */
export async function ranking(year?: number, month?: number, teamId?: string): Promise<RankedMemberScore[]> {
  const now = nowTz();
  const y = year ?? now.year();
  const m = month ?? now.month() + 1;
  const { start, end } = monthRange(y, m);
  const today = todayIso();
  const tasks = await getAllTasks();
  const doneTasks = tasks.filter((t) => t.status !== 'doing');
  let members = (await getActiveMembers()).filter((x) => x.role === 'member');
  if (teamId) members = members.filter((x) => x.teamId === teamId);

  const cfg = await bonusCfg();
  const agg = aggregateByMember(doneTasks, start, end);
  const ranked = rankMembers(new Map(members.map((mem) => [mem.id, agg.get(mem.id) || 0])));
  const rankByMember = new Map(ranked.map((r) => [r.memberId, r.rank]));

  return members
    .map((mem) => {
      const monthPoints = agg.get(mem.id) || 0;
      return {
        memberId: mem.id,
        fullName: mem.fullName,
        teamId: mem.teamId,
        year: y,
        month: m,
        todayPoints: sumPointsForMember(doneTasks, mem.id, today, today),
        monthPoints,
        bonus: computeBonus(monthPoints, cfg),
        workMinutesToday: workMinutesForDay(tasks, mem.id, today),
        rank: rankByMember.get(mem.id) || 0,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}
