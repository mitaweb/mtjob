import { addTask, completeTaskRow, startTodoTask, getDoingTasks } from './tasks.repo.js';
import { findById } from './members.repo.js';
import { findCatalogItem } from './catalog.repo.js';
import { teamLeaderId } from './teams.repo.js';
import { notify } from './notifications.service.js';
import { ApiError } from '../util/errors.js';
import { newId } from '../util/id.js';
import { nowTz, fmtHm } from '../lib/datetime.js';
import {
  taskTitle,
  isStartReport,
  cleanNote,
  taskCustomerKey,
  pickDoingToComplete,
  findOpenDuplicate,
} from '../lib/tasks.js';
import type { Member, TaskRow } from '../types.js';

/**
 * Mọi việc phải ghi rõ LÀM CHO KHÁCH NÀO. Anh Tâm chốt 25/7/2026 — không có tên khách
 * thì không phân biệt được hai việc thật với một việc bấm hai lần, và cũng không soi
 * được giờ làm của từng đầu việc.
 *
 * Chặn ở tầng service chứ không ở màn hình chat, vì hai endpoint REST
 * (POST /api/tasks, /api/tasks/start) đi thẳng vào đây, không qua bước hỏi khách.
 */
function requireCustomer(note: string): void {
  if (!taskCustomerKey(note)) {
    throw new ApiError(400, 'Hãy nhập việc + tên khách hàng mới được.');
  }
}

/**
 * Thời gian làm TỐI THIỂU để một việc được tính hoàn thành. Anh Tâm chốt 25/7/2026:
 * bấm Bắt đầu rồi bấm Kết thúc trong vòng 1 phút là bấm khống — không có việc gì
 * xong nổi trong vài giây, và dữ liệu thật cho thấy toàn các ca 4-6 giây.
 */
const MIN_WORK_MS = 60_000;

function tooFast(startedAt: string): boolean {
  const ms = Date.now() - new Date(startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 && ms < MIN_WORK_MS;
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
 * ĐIỂM CHỈ ĐƯỢC TÍNH Ở ĐÂY — lúc KẾT THÚC. `startTask` không cộng điểm.
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

  // Chốt chặn cuối: câu báo BẮT ĐẦU không bao giờ được đi vào đường ghi việc xong.
  // Mọi đường vào (chat, API, import) đều qua đây, nên chặn ở đây là chặn được hết —
  // đúng lỗi đã làm bảng điểm tháng 7 phồng gấp đôi.
  if (isStartReport(input.note || '')) {
    return startTask(input).then((r) => ({ task: r.task, points: 0 }));
  }

  // Làm sạch ở TẦNG SERVICE: hai endpoint REST đẩy ghi chú thô vào, khoá tính từ
  // "đã đăng bài page cho X Salon" sẽ không bao giờ khớp khoá từ "X Salon".
  // cleanNote idempotent nên đường chat (đã làm sạch) gọi lại vẫn an toàn.
  const note = cleanNote(input.note || '', item.name);
  const now = nowTz().toISOString();

  // Việc cùng loại VÀ cùng khách đang làm dở → chốt luôn việc đó, khỏi sinh việc trùng.
  const doing = pickDoingToComplete(await getDoingTasks(member.id), item.code, note);
  if (doing) {
    if (tooFast(doing.startedAt)) {
      throw new ApiError(
        400,
        `"${item.name}" mới bắt đầu chưa đầy 1 phút — làm xong thật rồi hãy báo hoàn thành nhé.`,
      );
    }
    // Chỉ điền tên khách khi dòng đang trống — KHÔNG bao giờ ghi đè tên đã khai.
    // Đây là chốt chặn cuối cho lỗi từng làm một việc thật biến mất.
    const fill = (doing.note || '').trim() ? undefined : note || undefined;
    const finished = await completeTaskRow(doing.id, member.id, now, fill);
    if (finished) {
      await notifyLeaderOnComplete(finished);
      return { task: finished, points: finished.points };
    }
  }

  // Không có việc dở nào khớp → ghi thẳng một việc đã xong. Dòng này KHÔNG có giờ bắt đầu
  // nên màn hình chi tiết sẽ đánh dấu "không có giờ làm" cho giám đốc soi.
  requireCustomer(note);
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
    note,
  };
  await addTask(task);
  await notifyLeaderOnComplete(task);
  return { task, points: item.points };
}

/**
 * Bắt đầu một task: ghi giờ bắt đầu, CHƯA cộng điểm (điểm cộng khi hoàn thành).
 *
 * Chặn mở trùng theo (loại việc + khách): mở hàng loạt rồi đóng hàng loạt là cách một
 * khoảng thời gian bị tính điểm nhiều lần. Nhưng cùng loại KHÁC khách thì cho phép —
 * tối ưu quảng cáo cho hai khách là hai việc thật.
 *
 * Lưu ý: việc do leader giao đi qua `startAssignedTask` (todo → doing), KHÔNG qua đây,
 * nên leader vẫn giao được hai việc giống nhau — có chủ đích.
 */
export async function startTask(input: LogTaskInput): Promise<{ task: TaskRow }> {
  const member = await findById(input.memberId);
  if (!member) throw new ApiError(404, 'Không tìm thấy thành viên');

  const item = await findCatalogItem(input.taskCode);
  if (!item || !item.active) {
    throw new ApiError(400, `Loại task "${input.taskCode}" không có trong danh mục`);
  }

  const note = cleanNote(input.note || '', item.name);
  requireCustomer(note);

  const dup = findOpenDuplicate(await getDoingTasks(member.id), item.code, note);
  if (dup) {
    throw new ApiError(
      400,
      `Bạn đang làm dở "${taskTitle(dup)}" từ ${fmtHm(dup.startedAt)} rồi. ` +
        'Xong việc đó thì bấm "⏳ Đang làm" bên dưới để hoàn thành, ' +
        'còn nếu là việc cho khách khác thì ghi rõ tên khách nhé.',
    );
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
    note,
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
  // Chặn bấm khống: Bắt đầu xong bấm Kết thúc luôn thì KHÔNG được tính điểm.
  const doing = (await getDoingTasks(memberId)).find((t) => t.id === taskId);
  if (doing && tooFast(doing.startedAt)) {
    throw new ApiError(400, 'Vừa bấm bắt đầu chưa đầy 1 phút — làm xong thật rồi hãy bấm hoàn thành nhé.');
  }
  const now = nowTz().toISOString();
  const task = await completeTaskRow(taskId, memberId, now);
  if (!task) throw new ApiError(404, 'Không tìm thấy task đang làm (có thể đã hoàn thành rồi)');
  await notifyLeaderOnComplete(task);
  return { task, points: task.points };
}
