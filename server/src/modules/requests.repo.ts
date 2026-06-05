import { readObjects, appendObject, updateWhere } from '../sheets/repo.js';
import type { RequestScope, RequestStatus } from '../types.js';

export type RequestKind = 'online' | 'leave';
const TAB: Record<RequestKind, 'OnlineRequests' | 'LeaveRequests'> = {
  online: 'OnlineRequests',
  leave: 'LeaveRequests',
};

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

function rowToReq(kind: RequestKind, r: Record<string, string>): RequestRow {
  return {
    kind,
    id: r['ReqID'] || '',
    memberId: r['MemberID'] || '',
    name: r['Name'] || '',
    dates: (r['Dates'] || '').split(',').map((s) => s.trim()).filter(Boolean),
    scope: (r['Scope'] || undefined) as RequestScope | undefined,
    type: r['Type'] || undefined,
    reason: r['Reason'] || '',
    leaderStatus: (r['LeaderStatus'] || 'pending') as RequestStatus,
    leaderBy: r['LeaderBy'] || '',
    leaderAt: r['LeaderAt'] || '',
    directorStatus: (r['DirectorStatus'] || 'pending') as RequestStatus,
    directorBy: r['DirectorBy'] || '',
    directorAt: r['DirectorAt'] || '',
    finalStatus: (r['FinalStatus'] || 'pending') as RequestStatus,
    createdAt: r['CreatedAt'] || '',
  };
}

export async function getRequests(kind: RequestKind): Promise<RequestRow[]> {
  const rows = await readObjects(TAB[kind]);
  return rows.filter((r) => (r['ReqID'] || '').trim()).map((r) => rowToReq(kind, r));
}

export async function getAllRequests(): Promise<RequestRow[]> {
  const [online, leave] = await Promise.all([getRequests('online'), getRequests('leave')]);
  return [...online, ...leave].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function findRequest(kind: RequestKind, id: string): Promise<RequestRow | undefined> {
  return (await getRequests(kind)).find((r) => r.id === id);
}

export async function addRequest(row: RequestRow): Promise<void> {
  await appendObject(TAB[row.kind], {
    ReqID: row.id,
    MemberID: row.memberId,
    Name: row.name,
    Dates: row.dates.join(','),
    Scope: row.scope || '',
    Type: row.type || '',
    Reason: row.reason,
    LeaderStatus: row.leaderStatus,
    LeaderBy: row.leaderBy,
    LeaderAt: row.leaderAt,
    DirectorStatus: row.directorStatus,
    DirectorBy: row.directorBy,
    DirectorAt: row.directorAt,
    FinalStatus: row.finalStatus,
    CreatedAt: row.createdAt,
  });
}

export async function updateRequest(
  kind: RequestKind,
  id: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  return updateWhere(TAB[kind], 'ReqID', id, patch);
}

/** Returns the approved-online scope covering `date` for a member, else null. */
export async function approvedOnlineScope(memberId: string, date: string): Promise<RequestScope | null> {
  const reqs = await getRequests('online');
  const hit = reqs.find(
    (r) => r.memberId === memberId && r.finalStatus === 'approved' && r.dates.includes(date),
  );
  return hit?.scope ?? null;
}

/** Returns true if an approved leave covers `date`. */
export async function hasApprovedLeave(memberId: string, date: string): Promise<boolean> {
  const reqs = await getRequests('leave');
  return reqs.some((r) => r.memberId === memberId && r.finalStatus === 'approved' && r.dates.includes(date));
}
