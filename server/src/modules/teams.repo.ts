import { q } from '../db/client.js';

export interface TeamRow {
  id: string;
  name: string;
  leaderMemberId: string;
  /** Thưởng KPI tháng của leader team này (VND). 0 = chưa đặt. Chỉ ĐỌC ở đây — ghi qua `setLeaderKpiBonus`. */
  leaderKpiBonus?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTeam(r: any): TeamRow {
  return {
    id: (r.team_id || '').trim(),
    name: r.team_name || r.team_id || '',
    leaderMemberId: r.leader_member_id || '',
    leaderKpiBonus: Number(r.leader_kpi_bonus || 0) || 0,
  };
}

export async function getTeams(): Promise<TeamRow[]> {
  const rows = await q('SELECT * FROM teams ORDER BY team_id');
  return rows.map(rowToTeam);
}

export async function findTeam(id: string): Promise<TeamRow | undefined> {
  const rows = await q('SELECT * FROM teams WHERE team_id = $1 LIMIT 1', [id]);
  return rows.length ? rowToTeam(rows[0]) : undefined;
}

export async function teamLeaderId(teamId: string): Promise<string> {
  return (await findTeam(teamId))?.leaderMemberId || '';
}

/**
 * KHÔNG đụng cột `leader_kpi_bonus`: hàm này được gọi mỗi lần đồng bộ nhân sự / đổi leader,
 * ghi cả mức thưởng ở đây là mỗi lần đồng bộ lại xoá số giám đốc đã đặt.
 */
export async function upsertTeam(t: TeamRow): Promise<void> {
  await q(
    `INSERT INTO teams (team_id, team_name, leader_member_id) VALUES ($1,$2,$3)
     ON CONFLICT (team_id) DO UPDATE SET
       team_name = EXCLUDED.team_name, leader_member_id = EXCLUDED.leader_member_id`,
    [t.id, t.name || t.id, t.leaderMemberId || ''],
  );
}

export const SQL_DAT_THUONG_LEADER = 'UPDATE teams SET leader_kpi_bonus = $2 WHERE team_id = $1 RETURNING team_id';

/** Đặt mức thưởng KPI tháng cho leader của một team. Trả false nếu không có team đó. */
export async function setLeaderKpiBonus(teamId: string, amount: number): Promise<boolean> {
  const rows = await q(SQL_DAT_THUONG_LEADER, [teamId, Math.max(0, Math.round(amount) || 0)]);
  return rows.length > 0;
}
