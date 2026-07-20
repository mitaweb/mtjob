import { addTask, completeTaskRow, startTodoTask } from './tasks.repo.js';
import { findById } from './members.repo.js';
import { findCatalogItem } from './catalog.repo.js';
import { teamLeaderId } from './teams.repo.js';
import { notify } from './notifications.service.js';
import { ApiError } from '../util/errors.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';
import { ingestInBackground } from './brain.service.js';
import type { Member, TaskRow } from '../types.js';

/** Ghi chú việc (vd tên khách/dự án) là tri thức hữu ích — nạp vào kho khi việc hoàn thành. */
function ingestTaskNote(task: TaskRow): void {
  if (!task.note?.trim()) return;
  ingestInBackground({
    sourceType: 'task',
    sourceId: task.id,
    title: `Việc: ${task.taskName}`,
    text: `${(task.completedAt || task.createdAt).slice(0, 10)} ${task.memberName} hoàn thành "${task.taskName}": ${task.note}`,
    visibility: 'all',
  });
}

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
    }, { background: true });
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
  ingestTaskNote(task);
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

/** Ai được phép giao việc, và giao cho ai (leader: trong team mình; giám đốc/admin: bất kỳ ai). */
export function canAssign(assigner: Member, assignee: Member): boolean {
  if (assigner.role === 'director' || assigner.role === 'admin') return true;
  if (assigner.role === 'leader') return !!assignee.teamId && assignee.teamId === assigner.teamId;
  return false;
}

export interface AssignInput {
  assignerId: string;
  assigneeId: string;
  taskName: string; // mô tả việc do leader/giám đốc gõ tự do
}

/**
 * Leader/giám đốc giao 1 việc (mô tả tự do) cho thành viên → tạo task 'todo'.
 * CHƯA gán điểm/loại — người nhận sẽ tự chọn loại task (Ads/Content/SEO) khi bấm Bắt đầu.
 */
export async function assignTask(input: AssignInput): Promise<{ task: TaskRow }> {
  const assigner = await findById(input.assignerId);
  if (!assigner) throw new ApiError(401, 'Không hợp lệ');
  const assignee = await findById(input.assigneeId);
  if (!assignee || !assignee.active) throw new ApiError(404, 'Không tìm thấy người nhận việc');
  if (!canAssign(assigner, assignee)) {
    throw new ApiError(403, 'Bạn không có quyền giao việc cho người này');
  }
  const name = input.taskName.trim();
  if (!name) throw new ApiError(400, 'Chưa có nội dung việc cần giao');

  const now = nowTz().toISOString();
  const task: TaskRow = {
    id: newId('T-'),
    createdAt: now,
    memberId: assignee.id,
    memberName: assignee.fullName,
    teamId: assignee.teamId,
    taskCode: '',
    taskName: name,
    points: 0,
    startedAt: '',
    completedAt: '',
    status: 'todo',
    source: 'assign',
    note: `Giao bởi ${assigner.fullName}`,
  };
  await addTask(task);
  await notify(assignee.id, {
    type: 'task_assigned',
    title: 'Bạn được giao việc 📌',
    body: `${assigner.fullName} giao: "${name}". Mở Chat → "Cần làm", chọn loại việc rồi bấm Bắt đầu.`,
    url: '/chat',
  }, { background: true });
  return { task };
}

/**
 * Người nhận bấm "Bắt đầu" trên việc được giao: todo → doing.
 * Người nhận TỰ CHỌN loại task (catalog Ads/Content/SEO) → quyết định điểm khi hoàn thành.
 */
export async function startAssignedTask(
  memberId: string,
  taskId: string,
  taskCode: string,
): Promise<{ task: TaskRow }> {
  const item = await findCatalogItem(taskCode);
  if (!item || !item.active) {
    throw new ApiError(400, `Loại task "${taskCode}" không có trong danh mục`);
  }
  const now = nowTz().toISOString();
  const task = await startTodoTask(taskId, memberId, now, item.code, item.points);
  if (!task) throw new ApiError(404, 'Không tìm thấy việc cần làm (có thể đã bắt đầu rồi)');
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
  ingestTaskNote(task);
  await notifyLeaderOnComplete(task);
  return { task, points: task.points };
}
