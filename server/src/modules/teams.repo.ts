import { q } from '../db/client.js';

export interface TeamRow {
  id: string;
  name: string;
  leaderMemberId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTeam(r: any): TeamRow {
  return {
    id: (r.team_id || '').trim(),
    name: r.team_name || r.team_id || '',
    leaderMemberId: r.leader_member_id || '',
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

export async function upsertTeam(t: TeamRow): Promise<void> {
  await q(
    `INSERT INTO teams (team_id, team_name, leader_member_id) VALUES ($1,$2,$3)
     ON CONFLICT (team_id) DO UPDATE SET
       team_name = EXCLUDED.team_name, leader_member_id = EXCLUDED.leader_member_id`,
    [t.id, t.name || t.id, t.leaderMemberId || ''],
  );
}
