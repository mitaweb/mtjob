import { readObjects, appendObject } from '../sheets/repo.js';
import type { TaskRow, Team } from '../types.js';

export function rowToTask(r: Record<string, string>): TaskRow {
  return {
    id: r['TaskID'] || '',
    createdAt: r['CreatedAt'] || '',
    memberId: r['MemberID'] || '',
    memberName: r['MemberName'] || '',
    teamId: (r['TeamID'] || '') as Team,
    taskCode: r['TaskCode'] || '',
    taskName: r['TaskName'] || '',
    points: Number(r['Points'] || 0) || 0,
    completedAt: r['CompletedAt'] || '',
    source: r['Source'] || '',
    note: r['Note'] || '',
  };
}

export async function getAllTasks(opts?: { fresh?: boolean }): Promise<TaskRow[]> {
  const rows = await readObjects('Tasks', opts);
  return rows.filter((r) => (r['TaskID'] || '').trim()).map(rowToTask);
}

export async function addTask(t: TaskRow): Promise<void> {
  await appendObject('Tasks', {
    TaskID: t.id,
    CreatedAt: t.createdAt,
    MemberID: t.memberId,
    MemberName: t.memberName,
    TeamID: t.teamId,
    TaskCode: t.taskCode,
    TaskName: t.taskName,
    Points: t.points,
    CompletedAt: t.completedAt,
    Source: t.source,
    Note: t.note || '',
  });
}
