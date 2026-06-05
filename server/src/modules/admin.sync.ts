import { sheetsClient } from '../sheets/client.js';
import { upsertByKey } from '../sheets/repo.js';
import { getAllMembers } from './members.repo.js';
import { parseHrRow, removeAccents, type HrPerson } from '../lib/people.js';
import { newId } from '../util/id.js';
import { ApiError } from '../util/errors.js';

function looksLikeHeader(row: Array<string | number | null | undefined>): boolean {
  const j = (row || []).map((c) => String(c ?? '')).join('|').toLowerCase();
  return (
    j.includes('họ tên') ||
    j.includes('ho ten') ||
    j.includes('mức lương') ||
    j.includes('chức vụ') ||
    j.includes('bhxh')
  );
}

function slugEmail(fullName: string): string {
  const slug = removeAccents(fullName)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
  return `${slug || 'user'}@mtjob.local`;
}

export interface SyncResult {
  imported: number;
  teams: string[];
  people: Array<{ fullName: string; team: string; role: string; email: string }>;
}

/**
 * Read the HR source sheet (6 fixed columns, no header) and upsert into Members.
 * Team/Role/Leader are derived from the Chức vụ column; existing email/password are kept.
 */
export async function syncMembersFromSource(): Promise<SyncResult> {
  const sourceId = process.env.SHEET_HR_SOURCE_ID;
  if (!sourceId) throw new ApiError(400, 'SHEET_HR_SOURCE_ID chưa được cấu hình');

  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: sourceId,
    range: 'A1:F1000',
  });
  const values = (res.data.values as Array<Array<string | number>>) ?? [];
  if (values.length === 0) throw new ApiError(400, 'Sheet nhân sự nguồn trống hoặc không đọc được');

  const startIdx = looksLikeHeader(values[0] ?? []) ? 1 : 0;
  const people: HrPerson[] = [];
  for (let i = startIdx; i < values.length; i++) {
    const p = parseHrRow(values[i] ?? []);
    if (p) people.push(p);
  }

  const existing = await getAllMembers();
  const byName = new Map(existing.map((m) => [m.fullName.trim().toLowerCase(), m]));

  const teamLeaders = new Map<string, string>(); // team -> leader memberId
  const teamSeen = new Set<string>();
  const out: SyncResult['people'] = [];

  for (const p of people) {
    const prior = byName.get(p.fullName.trim().toLowerCase());
    const id = prior?.id || newId('M-');
    const email = prior?.email || slugEmail(p.fullName);

    await upsertByKey('Members', 'MemberID', {
      MemberID: id,
      FullName: p.fullName,
      DOB: p.dob || '',
      Position: p.position,
      TeamID: p.team,
      Role: p.role,
      Salary: p.salary,
      BHXH: p.bhxh,
      JoinDate: p.joinDate || '',
      Email: email,
      PasswordHash: prior?.passwordHash || '',
      Active: 'TRUE',
    });

    if (p.team) {
      teamSeen.add(p.team);
      if (p.isLeader) teamLeaders.set(p.team, id);
    }
    out.push({ fullName: p.fullName, team: p.team, role: p.role, email });
  }

  // Upsert teams (with their leader, if any was found).
  for (const team of teamSeen) {
    await upsertByKey('Teams', 'TeamID', {
      TeamID: team,
      TeamName: team,
      LeaderMemberID: teamLeaders.get(team) || '',
    });
  }

  return { imported: people.length, teams: [...teamSeen], people: out };
}
