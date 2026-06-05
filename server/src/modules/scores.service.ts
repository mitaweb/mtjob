import { getAllTasks } from './tasks.repo.js';
import { getActiveMembers, findById } from './members.repo.js';
import { sumPointsForMember, aggregateByMember, rankMembers } from '../lib/scores.js';
import { computeBonus, type BonusConfig } from '../lib/money.js';
import { getConfig } from '../config.js';
import { nowTz, monthRange, todayIso } from '../lib/datetime.js';

async function bonusCfg(): Promise<BonusConfig> {
  const c = await getConfig();
  return { threshold: c.bonusThreshold, step: c.bonusStep, amount: c.bonusAmount };
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
  const member = await findById(memberId);
  const monthPoints = sumPointsForMember(tasks, memberId, start, end);
  const todayPoints = sumPointsForMember(tasks, memberId, today, today);
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
  };
}

/** Ranked month scores for everyone (or a single team). */
export async function ranking(year?: number, month?: number, teamId?: string): Promise<RankedMemberScore[]> {
  const now = nowTz();
  const y = year ?? now.year();
  const m = month ?? now.month() + 1;
  const { start, end } = monthRange(y, m);
  const today = todayIso();
  const tasks = await getAllTasks();
  let members = await getActiveMembers();
  if (teamId) members = members.filter((x) => x.teamId === teamId);

  const cfg = await bonusCfg();
  const agg = aggregateByMember(tasks, start, end);
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
        todayPoints: sumPointsForMember(tasks, mem.id, today, today),
        monthPoints,
        bonus: computeBonus(monthPoints, cfg),
        rank: rankByMember.get(mem.id) || 0,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}
