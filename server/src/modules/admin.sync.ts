// Member sync: parse HR people (from the public CSV of the source sheet, or a
// seed snapshot) and upsert members + teams/leaders. No Google credentials needed —
// the source sheet just has to be shared "anyone with the link – viewer".
import { getAllMembers, upsertMember } from './members.repo.js';
import { upsertTeam } from './teams.repo.js';
import { parseHrRow, removeAccents, type HrPerson } from '../lib/people.js';
import { newId } from '../util/id.js';
import { ApiError } from '../util/errors.js';

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

/** Upsert parsed HR people into members + teams. Keeps existing email/password (matched by full name). */
export async function upsertHrPeople(people: HrPerson[]): Promise<SyncResult> {
  const existing = await getAllMembers();
  const byName = new Map(existing.map((m) => [m.fullName.trim().toLowerCase(), m]));

  const teamLeaders = new Map<string, string>();
  const teamSeen = new Set<string>();
  const out: SyncResult['people'] = [];

  for (const p of people) {
    const prior = byName.get(p.fullName.trim().toLowerCase());
    const id = prior?.id || newId('M-');
    const email = prior?.email || slugEmail(p.fullName);

    await upsertMember({
      id,
      fullName: p.fullName,
      dob: p.dob,
      position: p.position,
      teamId: p.team,
      role: p.role,
      salary: p.salary,
      bhxh: p.bhxh,
      joinDate: p.joinDate,
      email,
      passwordHash: prior?.passwordHash || '',
      active: true,
    });

    if (p.team) {
      teamSeen.add(p.team);
      if (p.isLeader) teamLeaders.set(p.team, id);
    }
    out.push({ fullName: p.fullName, team: p.team, role: p.role, email });
  }

  for (const team of teamSeen) {
    await upsertTeam({ id: team, name: team, leaderMemberId: teamLeaders.get(team) || '' });
  }

  return { imported: people.length, teams: [...teamSeen], people: out };
}

/** Tiny CSV parser (handles quoted fields). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      cur.push(field);
      field = '';
    } else if (c === '\n') {
      cur.push(field.replace(/\r$/, ''));
      rows.push(cur);
      cur = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || cur.length) {
    cur.push(field.replace(/\r$/, ''));
    rows.push(cur);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function looksLikeHeader(row: string[]): boolean {
  const j = row.join('|').toLowerCase();
  return j.includes('họ tên') || j.includes('ho ten') || j.includes('chức vụ') || j.includes('bhxh');
}

/** Read the HR source sheet via its public CSV export and upsert members. */
export async function syncMembersFromSource(): Promise<SyncResult> {
  const id = process.env.SHEET_HR_SOURCE_ID;
  const gid = process.env.SHEET_HR_SOURCE_GID || '0';
  if (!id) throw new ApiError(400, 'SHEET_HR_SOURCE_ID chưa được cấu hình');

  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new ApiError(
      502,
      `Không đọc được sheet nhân sự (HTTP ${res.status}). Hãy mở share sheet ở chế độ "Anyone with the link – Viewer", hoặc quản lý thành viên trong màn Quản trị.`,
    );
  }
  const text = await res.text();
  if (/<html/i.test(text.slice(0, 300))) {
    throw new ApiError(502, 'Sheet nhân sự chưa share công khai — không tải được CSV.');
  }

  const rows = parseCsv(text);
  if (rows.length === 0) throw new ApiError(400, 'Sheet nhân sự trống');
  const start = looksLikeHeader(rows[0] ?? []) ? 1 : 0;
  const people: HrPerson[] = [];
  for (let i = start; i < rows.length; i++) {
    const p = parseHrRow(rows[i] ?? []);
    if (p) people.push(p);
  }
  return upsertHrPeople(people);
}
