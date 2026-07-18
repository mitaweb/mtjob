import { q } from '../db/client.js';
import { dayjs } from '../lib/datetime.js';
import type { TaskRow, TaskStatus, Team } from '../types.js';

/** Ngày kế tiếp (YYYY-MM-DD) — làm cận trên exclusive khi so chuỗi ISO datetime. */
function nextDayIso(iso: string): string {
  return dayjs(iso).add(1, 'day').format('YYYY-MM-DD');
}

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

/**
 * Tasks phục vụ tính điểm/giờ làm trong [start, end] (YYYY-MM-DD, inclusive):
 * task hoàn thành trong khoảng, task hoàn thành trong ngày `today` (điểm/giờ hôm nay
 * kể cả khi xem tháng khác), và mọi task đang làm (giờ chạy tới hiện tại).
 * So sánh chuỗi trên ISO text — cùng ngữ nghĩa với inRange (slice(0,10)).
 */
export async function getScoringTasks(start: string, end: string, today: string): Promise<TaskRow[]> {
  const rows = await q(
    `SELECT * FROM tasks
     WHERE (completed_at >= $1 AND completed_at < $2)
        OR (completed_at >= $3 AND completed_at < $4)
        OR status = 'doing'`,
    [start, nextDayIso(end), today, nextDayIso(today)],
  );
  return rows.map(rowToTask);
}

/** Task ĐÃ hoàn thành của 1 thành viên trong [start, end] — mới nhất trước. */
export async function getDoneTasksForMemberRange(
  memberId: string,
  start: string,
  end: string,
): Promise<TaskRow[]> {
  const rows = await q(
    `SELECT * FROM tasks
     WHERE member_id = $1 AND status = 'done'
       AND ((completed_at <> '' AND completed_at >= $2 AND completed_at < $3)
         OR (completed_at = '' AND created_at >= $2 AND created_at < $3))
     ORDER BY completed_at DESC`,
    [memberId, start, nextDayIso(end)],
  );
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

/** Các task ĐƯỢC GIAO chưa bắt đầu (cần làm) của một thành viên. */
export async function getTodoTasks(memberId: string): Promise<TaskRow[]> {
  const rows = await q(
    "SELECT * FROM tasks WHERE member_id = $1 AND status = 'todo' ORDER BY created_at",
    [memberId],
  );
  return rows.map(rowToTask);
}

/**
 * Bắt đầu 1 task được giao (todo → doing): chốt giờ bắt đầu và gán loại task
 * (catalog) do NGƯỜI NHẬN tự chọn theo hệ thống Ads/Content/SEO → quyết định điểm.
 */
export async function startTodoTask(
  taskId: string,
  memberId: string,
  startedAt: string,
  taskCode: string,
  points: number,
): Promise<TaskRow | null> {
  const rows = await q(
    `UPDATE tasks SET started_at = $1, status = 'doing', task_code = $2, points = $3
     WHERE task_id = $4 AND member_id = $5 AND status = 'todo'
     RETURNING *`,
    [startedAt, taskCode, points, taskId, memberId],
  );
  return rows.length ? rowToTask(rows[0]) : null;
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
