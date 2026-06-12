import { q } from '../db/client.js';
import type { RequestScope, RequestStatus } from '../types.js';

export type RequestKind = 'online' | 'leave';

export interface RequestRow {
  kind: RequestKind;
  id: string;
  memberId: string;
  name: string;
  dates: string[]; // YYYY-MM-DD list
  scope?: RequestScope; // online
  type?: string; // leave type
  reason: string;
  leaderStatus: RequestStatus;
  leaderBy: string;
  leaderAt: string;
  directorStatus: RequestStatus;
  directorBy: string;
  directorAt: string;
  finalStatus: RequestStatus;
  createdAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToReq(r: any): RequestRow {
  return {
    kind: (r.kind || 'online') as RequestKind,
    id: r.req_id || '',
    memberId: r.member_id || '',
    name: r.name || '',
    dates: String(r.dates || '').split(',').map((s: string) => s.trim()).filter(Boolean),
    scope: (r.scope || undefined) as RequestScope | undefined,
    type: r.type || undefined,
    reason: r.reason || '',
    leaderStatus: (r.leader_status || 'pending') as RequestStatus,
    leaderBy: r.leader_by || '',
    leaderAt: r.leader_at || '',
    directorStatus: (r.director_status || 'pending') as RequestStatus,
    directorBy: r.director_by || '',
    directorAt: r.director_at || '',
    finalStatus: (r.final_status || 'pending') as RequestStatus,
    createdAt: r.created_at || '',
  };
}

export async function getRequests(kind: RequestKind): Promise<RequestRow[]> {
  const rows = await q('SELECT * FROM requests WHERE kind = $1 ORDER BY created_at DESC', [kind]);
  return rows.map(rowToReq);
}

export async function getAllRequests(): Promise<RequestRow[]> {
  const rows = await q('SELECT * FROM requests ORDER BY created_at DESC');
  return rows.map(rowToReq);
}

export async function findRequest(kind: RequestKind, id: string): Promise<RequestRow | undefined> {
  const rows = await q('SELECT * FROM requests WHERE kind = $1 AND req_id = $2 LIMIT 1', [kind, id]);
  return rows.length ? rowToReq(rows[0]) : undefined;
}

export async function addRequest(row: RequestRow): Promise<void> {
  await q(
    `INSERT INTO requests (req_id, kind, member_id, name, dates, scope, type, reason,
                           leader_status, leader_by, leader_at,
                           director_status, director_by, director_at, final_status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      row.id, row.kind, row.memberId, row.name, row.dates.join(','),
      row.scope || '', row.type || '', row.reason,
      row.leaderStatus, row.leaderBy, row.leaderAt,
      row.directorStatus, row.directorBy, row.directorAt, row.finalStatus, row.createdAt,
    ],
  );
}

// Patch keys keep the legacy sheet-style names used by requests.service.
const PATCH_COLS: Record<string, string> = {
  LeaderStatus: 'leader_status',
  LeaderBy: 'leader_by',
  LeaderAt: 'leader_at',
  DirectorStatus: 'director_status',
  DirectorBy: 'director_by',
  DirectorAt: 'director_at',
  FinalStatus: 'final_status',
};

export async function updateRequest(
  kind: RequestKind,
  id: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = PATCH_COLS[k];
    if (!col) continue;
    params.push(v == null ? '' : String(v));
    sets.push(`${col} = $${params.length}`);
  }
  if (sets.length === 0) return false;
  params.push(kind, id);
  const rows = await q(
    `UPDATE requests SET ${sets.join(', ')} WHERE kind = $${params.length - 1} AND req_id = $${params.length} RETURNING req_id`,
    params,
  );
  return rows.length > 0;
}

/** Returns the approved-online scope covering `date` for a member, else null. */
export async function approvedOnlineScope(memberId: string, date: string): Promise<RequestScope | null> {
  const rows = await q(
    "SELECT * FROM requests WHERE kind = 'online' AND member_id = $1 AND final_status = 'approved'",
    [memberId],
  );
  const hit = rows.map(rowToReq).find((r) => r.dates.includes(date));
  return hit?.scope ?? null;
}

/** Returns true if an approved leave covers `date`. */
export async function hasApprovedLeave(memberId: string, date: string): Promise<boolean> {
  const rows = await q(
    "SELECT * FROM requests WHERE kind = 'leave' AND member_id = $1 AND final_status = 'approved'",
    [memberId],
  );
  return rows.map(rowToReq).some((r) => r.dates.includes(date));
}
