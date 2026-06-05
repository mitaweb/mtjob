// Data access for Members (read side). Writes happen via admin sync / scripts.
import { readObjects } from '../sheets/repo.js';
import type { Member, Role, Team } from '../types.js';

export function rowToMember(r: Record<string, string>): Member {
  return {
    id: r['MemberID'] || '',
    fullName: r['FullName'] || '',
    dob: r['DOB'] || null,
    position: r['Position'] || '',
    teamId: (r['TeamID'] || '') as Team,
    role: ((r['Role'] || 'member') as Role),
    salary: Number(r['Salary'] || 0) || 0,
    bhxh: Number(r['BHXH'] || 0) || 0,
    joinDate: r['JoinDate'] || null,
    email: r['Email'] || '',
    passwordHash: r['PasswordHash'] || '',
    active: /^(true|1|x|yes|co|có)$/i.test((r['Active'] || '').trim()),
  };
}

export type PublicMember = Omit<Member, 'passwordHash'>;

export function publicMember(m: Member): PublicMember {
  const { passwordHash: _omit, ...rest } = m;
  return rest;
}

export async function getAllMembers(opts?: { fresh?: boolean }): Promise<Member[]> {
  const rows = await readObjects('Members', opts);
  return rows.filter((r) => (r['MemberID'] || '').trim()).map(rowToMember);
}

export async function getActiveMembers(): Promise<Member[]> {
  return (await getAllMembers()).filter((m) => m.active);
}

export async function findByEmail(email: string): Promise<Member | undefined> {
  const e = email.trim().toLowerCase();
  return (await getAllMembers()).find((m) => m.email.trim().toLowerCase() === e);
}

export async function findById(id: string): Promise<Member | undefined> {
  return (await getAllMembers()).find((m) => m.id === id);
}

export async function membersInTeam(teamId: string): Promise<Member[]> {
  return (await getActiveMembers()).filter((m) => m.teamId === teamId);
}

export async function getDirectors(): Promise<Member[]> {
  return (await getActiveMembers()).filter((m) => m.role === 'director');
}
