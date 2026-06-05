import { addTask } from './tasks.repo.js';
import { findById } from './members.repo.js';
import { findCatalogItem } from './catalog.repo.js';
import { ApiError } from '../util/errors.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';
import type { TaskRow } from '../types.js';

export interface LogTaskInput {
  memberId: string;
  taskCode: string;
  completedAt?: string;
  note?: string;
  source?: string;
}

/** Validate against the catalog and append a task row. Points come from the catalog. */
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
    completedAt: input.completedAt || now,
    source: input.source || 'app',
    note: input.note || '',
  };
  await addTask(task);
  return { task, points: item.points };
}
