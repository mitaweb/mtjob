import { readObjects } from '../sheets/repo.js';

export interface TeamRow {
  id: string;
  name: string;
  leaderMemberId: string;
}

export async function getTeams(): Promise<TeamRow[]> {
  const rows = await readObjects('Teams');
  return rows
    .filter((r) => (r['TeamID'] || '').trim())
    .map((r) => ({
      id: (r['TeamID'] || '').trim(),
      name: r['TeamName'] || r['TeamID'] || '',
      leaderMemberId: r['LeaderMemberID'] || '',
    }));
}

export async function findTeam(id: string): Promise<TeamRow | undefined> {
  return (await getTeams()).find((t) => t.id === id);
}

export async function teamLeaderId(teamId: string): Promise<string> {
  return (await findTeam(teamId))?.leaderMemberId || '';
}
