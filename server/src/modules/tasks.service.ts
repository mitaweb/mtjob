import { addTask, completeTaskRow, startTodoTask, getDoingTasks } from './tasks.repo.js';
import { findById } from './members.repo.js';
import { findCatalogItem } from './catalog.repo.js';
import { teamLeaderId } from './teams.repo.js';
import { notify } from './notifications.service.js';
import { ApiError } from '../util/errors.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';
import { taskTitle } from '../lib/tasks.js';
import { markCustomerDirty } from './brain.service.js';
import type { Member, TaskRow } from '../types.js';

/**
 * Ghi chú việc KHÔNG vào kho tri thức (là dữ liệu vận hành, không phải tri thức —
 * trợ lý tra thẳng bảng tasks qua get_member_tasks/get_my_tasks).
 * Nhưng nếu ghi chú nhắc tên khách thì hẹn dựng lại hồ sơ 360° của khách đó,
 * vì mục "công việc đã làm" trong hồ sơ đọc từ bảng tasks.
 */
function touchCustomerFromTask(task: TaskRow): void {
  const note = task.note?.trim();
  if (note) markCustomerDirty(note);
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
      // taskTitle ghép cả ghi chú (thường là tên khách) — leader cần biết việc CHO AI,
      // không chỉ loại việc.
      body: `${task.memberName} đã hoàn thành "${taskTitle(task)}" (+${task.points}đ).`,
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

/**
 * Ghi nhận task ĐÃ hoàn thành. Điểm lấy từ danh mục.
 *
 * Nếu người này đang có task CÙNG LOẠI dở dang (status 'doing') thì HOÀN THÀNH task đó
 * thay vì tạo dòng mới — một việc chỉ được tính điểm MỘT lần, dù họ báo "bắt đầu" rồi
 * lại báo "đã xong". Trước đây mỗi lần báo tạo một dòng nên điểm bị nhân đôi.
 */
export async function logTask(input: LogTaskInput): Promise<{ task: TaskRow; points: number }> {
  const member = await findById(input.memberId);
  if (!member) throw new ApiError(404, 'Không tìm thấy thành viên');

  const item = await findCatalogItem(input.taskCode);
  if (!item || !item.active) {
    throw new ApiError(400, `Loại task "${input.taskCode}" không có trong danh mục`);
  }

  const now = nowTz().toISOString();

  // Việc cùng loại đang làm dở → chốt luôn việc đó, khỏi sinh việc trùng.
  const doing = (await getDoingTasks(member.id)).find((t) => t.taskCode === item.code);
  if (doing) {
    const finished = await completeTaskRow(doing.id, member.id, now, input.note?.trim() || undefined);
    if (finished) {
      touchCustomerFromTask(finished);
      await notifyLeaderOnComplete(finished);
      return { task: finished, points: finished.points };
    }
  }
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
  touchCustomerFromTask(task);
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
  touchCustomerFromTask(task);
  await notifyLeaderOnComplete(task);
  return { task, points: task.points };
}
