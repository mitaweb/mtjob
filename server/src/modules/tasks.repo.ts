import { q } from '../db/client.js';
import type { TaskRow, Team } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTask(r: any): TaskRow {
  return {
    id: r.task_id || '',
    createdAt: r.created_at || '',
    memberId: r.member_id || '',
    memberName: r.member_name || '',
    teamId: (r.team_id || '') as Team,
    taskCode: r.task_code || '',
    taskName: r.task_name || '',
    points: Number(r.points || 0) || 0,
    completedAt: r.completed_at || '',
    source: r.source || '',
    note: r.note || '',
  };
}

export async function getAllTasks(): Promise<TaskRow[]> {
  const rows = await q('SELECT * FROM tasks ORDER BY completed_at DESC');
  return rows.map(rowToTask);
}

export async function addTask(t: TaskRow): Promise<void> {
  await q(
    `INSERT INTO tasks (task_id, created_at, member_id, member_name, team_id, task_code, task_name, points, completed_at, source, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [t.id, t.createdAt, t.memberId, t.memberName, t.teamId, t.taskCode, t.taskName, t.points, t.completedAt, t.source, t.note || ''],
  );
}
