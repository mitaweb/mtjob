import { addTask, completeTaskRow } from './tasks.repo.js';
import { findById } from './members.repo.js';
import { findCatalogItem } from './catalog.repo.js';
import { teamLeaderId } from './teams.repo.js';
import { notify } from './notifications.service.js';
import { ApiError } from '../util/errors.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';
import type { TaskRow } from '../types.js';

/** Báo cho leader của team khi một thành viên hoàn thành task. Không làm hỏng luồng chính nếu lỗi. */
async function notifyLeaderOnComplete(task: TaskRow): Promise<void> {
  try {
    if (!task.teamId) return;
    const leaderId = await teamLeaderId(task.teamId);
    if (!leaderId || leaderId === task.memberId) return; // leader tự làm thì không tự báo
    await notify(leaderId, {
      type: 'task_done',
      title: 'Thành viên hoàn thành task ✅',
      body: `${task.memberName} đã hoàn thành "${task.taskName}" (+${task.points}đ).`,
      url: '/dashboard',
    });
  } catch (e) {
    console.warn('[task] không gửi được thông báo cho leader:', (e as Error).message);
  }
}

export interface LogTaskInput {
  memberId: string;
  taskCode: string;
  completedAt?: string;
  note?: string;
  source?: string;
}

/** Ghi nhận task ĐÃ hoàn thành ngay (không qua bước bắt đầu). Điểm lấy từ danh mục. */
export async function logTask(input: LogTaskInput): Promise<{ task: TaskRow; points: number }> {
  const member = await findById(input.memberId);
  if (!member) throw new ApiError(404, 'Không tìm thấy thành viên');

  const item = await findCatalogItem(input.taskCode);
  if (!item || !item.active) {
    throw new ApiError(400, `Loại task "${input.taskCode}" không có trong danh mục`);
  }

  const now = nowTz().toISOString();
  const task: TaskRow = {
    id: newId('T-'),
    createdAt: now,
    memberId: member.id,
    memberName: member.fullName,
    teamId: member.teamId,
    taskCode: item.code,
    taskName: item.name,
    points: item.points,
    startedAt: '',
    completedAt: input.completedAt || now,
    status: 'done',
    source: input.source || 'app',
    note: input.note || '',
  };
  await addTask(task);
  await notifyLeaderOnComplete(task);
  return { task, points: item.points };
}

/** Bắt đầu một task: ghi giờ bắt đầu, CHƯA cộng điểm (điểm cộng khi hoàn thành). */
export async function startTask(input: LogTaskInput): Promise<{ task: TaskRow }> {
  const member = await findById(input.memberId);
  if (!member) throw new ApiError(404, 'Không tìm thấy thành viên');

  const item = await findCatalogItem(input.taskCode);
  if (!item || !item.active) {
    throw new ApiError(400, `Loại task "${input.taskCode}" không có trong danh mục`);
  }

  const now = nowTz().toISOString();
  const task: TaskRow = {
    id: newId('T-'),
    createdAt: now,
    memberId: member.id,
    memberName: member.fullName,
    teamId: member.teamId,
    taskCode: item.code,
    taskName: item.name,
    points: item.points,
    startedAt: now,
    completedAt: '',
    status: 'doing',
    source: input.source || 'app',
    note: input.note || '',
  };
  await addTask(task);
  return { task };
}

/** Hoàn thành task đang làm → chốt giờ kết thúc + tính điểm. */
export async function completeTask(
  memberId: string,
  taskId: string,
): Promise<{ task: TaskRow; points: number }> {
  const now = nowTz().toISOString();
  const task = await completeTaskRow(taskId, memberId, now);
  if (!task) throw new ApiError(404, 'Không tìm thấy task đang làm (có thể đã hoàn thành rồi)');
  await notifyLeaderOnComplete(task);
  return { task, points: task.points };
}
