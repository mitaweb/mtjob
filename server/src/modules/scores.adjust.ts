import { q } from '../db/client.js';
import { addTask } from './tasks.repo.js';
import { findById } from './members.repo.js';
import { isMonthLocked } from './payroll.service.js';
import { ApiError } from '../util/errors.js';
import { newId } from '../util/id.js';
import { nowTz, todayIso, fmtDate } from '../lib/datetime.js';
import {
  ADJUST_CODE,
  ADJUST_SOURCE,
  validateAdjust,
  adjustIsoAt,
  adjustTaskName,
  adjustNote,
} from '../lib/adjust.js';
import type { TaskRow } from '../types.js';

// Bù điểm cho một ngày đã qua. Dòng bù là một dòng tasks bình thường nên nó tự chảy
// vào mọi thứ đang có sẵn: bảng xếp hạng, thưởng, màn hình chi tiết theo ngày — không
// phải thêm nhánh tính toán nào.

export interface AdjustRequest {
  memberId: string;
  date: string;
  points: number;
  reason: string;
  byName: string;
}

export interface AdjustRow {
  id: string;
  date: string;
  memberId: string;
  memberName: string;
  points: number;
  note: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAdjust(r: any): AdjustRow {
  return {
    id: r.task_id || '',
    date: String(r.completed_at || r.created_at || '').slice(0, 10),
    memberId: r.member_id || '',
    memberName: r.member_name || '',
    points: Number(r.points || 0) || 0,
    note: r.note || '',
  };
}

/**
 * Ghi một dòng bù điểm. Ném ApiError kèm câu tiếng Việt để hiện thẳng cho người dùng,
 * dù gọi từ giao diện hay từ trợ lý.
 */
export async function addAdjustment(req: AdjustRequest): Promise<AdjustRow> {
  const member = await findById(req.memberId);
  if (!member) throw new ApiError(404, 'Không tìm thấy nhân sự');

  const bad = validateAdjust(req, todayIso());
  if (bad) throw new ApiError(400, bad);

  // Tháng đã chốt lương thì thưởng đã trả rồi — cộng thêm điểm vào đó chỉ làm bảng điểm
  // lệch khỏi phiếu lương đã phát. Muốn sửa thật thì mở khoá tháng trước.
  const [y, m] = req.date.split('-').map(Number);
  if (await isMonthLocked(y!, m!)) {
    throw new ApiError(409, `Tháng ${m}/${y} đã chốt lương nên không bù điểm được. Mở khoá tháng đó ở trang Bảng lương rồi làm lại.`);
  }

  const at = adjustIsoAt(req.date);
  const task: TaskRow = {
    id: newId('T-'),
    createdAt: nowTz().toISOString(),
    memberId: member.id,
    memberName: member.fullName,
    teamId: member.teamId,
    taskCode: ADJUST_CODE,
    taskName: adjustTaskName(req.points),
    points: Math.trunc(req.points),
    // Không có giờ bắt đầu: đây không phải việc làm thật nên đừng bịa ra giờ công.
    startedAt: '',
    completedAt: at,
    status: 'done',
    source: ADJUST_SOURCE,
    note: adjustNote(req.reason, req.byName),
  };
  await addTask(task);

  return {
    id: task.id,
    date: req.date,
    memberId: member.id,
    memberName: member.fullName,
    points: task.points,
    note: task.note || '',
  };
}

/** Các dòng bù đã ghi — lọc theo nhân sự và/hoặc tháng YYYY-MM. */
export async function listAdjustments(opts: { memberId?: string; month?: string } = {}): Promise<AdjustRow[]> {
  const where = [`source = $1`];
  const params: unknown[] = [ADJUST_SOURCE];
  if (opts.memberId) {
    params.push(opts.memberId);
    where.push(`member_id = $${params.length}`);
  }
  if (opts.month) {
    params.push(`${opts.month}-`);
    where.push(`completed_at LIKE $${params.length} || '%'`);
  }
  const rows = await q(
    `SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY completed_at DESC LIMIT 200`,
    params,
  );
  return rows.map(rowToAdjust);
}

/**
 * Gỡ một dòng bù. Điều kiện `source` trong câu lệnh là chốt chặn thật sự: truyền nhầm
 * mã một việc do nhân viên làm vào đây cũng không xoá được gì.
 */
export async function deleteAdjustment(id: string): Promise<AdjustRow> {
  const rows = await q('SELECT * FROM tasks WHERE task_id = $1 AND source = $2 LIMIT 1', [id, ADJUST_SOURCE]);
  if (rows.length === 0) throw new ApiError(404, 'Không tìm thấy dòng bù điểm này (chỉ gỡ được dòng do người nhập tay).');
  const row = rowToAdjust(rows[0]);

  const [y, m] = row.date.split('-').map(Number);
  if (y && m && (await isMonthLocked(y, m))) {
    throw new ApiError(409, `Tháng ${m}/${y} đã chốt lương nên không gỡ được. Mở khoá tháng đó rồi làm lại.`);
  }

  await q('DELETE FROM tasks WHERE task_id = $1 AND source = $2', [id, ADJUST_SOURCE]);
  return row;
}

/** Câu mô tả một dòng bù, dùng chung cho trợ lý và thông báo. */
export function describeAdjust(r: AdjustRow): string {
  const sign = r.points >= 0 ? '+' : '';
  return `${fmtDate(r.date)} · ${r.memberName} · ${sign}${r.points}đ · ${r.note}`;
}
