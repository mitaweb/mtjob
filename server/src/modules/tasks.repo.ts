import { q } from '../db/client.js';
import type { TaskRow, TaskStatus, Team } from '../types.js';

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
    startedAt: r.started_at || '',
    completedAt: r.completed_at || '',
    status: ((r.status || 'done') as TaskStatus),
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
    `INSERT INTO tasks (task_id, created_at, member_id, member_name, team_id, task_code, task_name,
                        points, started_at, completed_at, status, source, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      t.id, t.createdAt, t.memberId, t.memberName, t.teamId, t.taskCode, t.taskName,
      t.points, t.startedAt || '', t.completedAt || '', t.status, t.source, t.note || '',
    ],
  );
}

/** Các task đang làm (đã bắt đầu, chưa hoàn thành) của một thành viên. */
export async function getDoingTasks(memberId: string): Promise<TaskRow[]> {
  const rows = await q(
    "SELECT * FROM tasks WHERE member_id = $1 AND status = 'doing' ORDER BY started_at",
    [memberId],
  );
  return rows.map(rowToTask);
}

/** Hoàn thành 1 task đang làm (đúng chủ sở hữu). Trả về task sau cập nhật, hoặc null nếu không có. */
export async function completeTaskRow(
  taskId: string,
  memberId: string,
  completedAt: string,
): Promise<TaskRow | null> {
  const rows = await q(
    `UPDATE tasks SET completed_at = $1, status = 'done'
     WHERE task_id = $2 AND member_id = $3 AND status = 'doing'
     RETURNING *`,
    [completedAt, taskId, memberId],
  );
  return rows.length ? rowToTask(rows[0]) : null;
}
