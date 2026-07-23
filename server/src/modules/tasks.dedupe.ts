// Rà soát và dọn các việc bị TÍNH ĐIỂM HAI LẦN.
//
// Lỗi cũ: báo "bắt đầu X" tạo một dòng (chốt qua nút Đang làm → tính điểm), rồi báo
// "đã X xong" lại tạo dòng thứ hai cũng tính điểm. Một việc thành hai lần điểm.
//
// Quy tắc dọn (cố tình THẬN TRỌNG, thà bỏ sót còn hơn xoá nhầm):
// Chỉ coi là trùng khi trong CÙNG người + CÙNG loại việc + CÙNG ngày + CÙNG mô tả
// có cả dòng ĐÃ BẤM BẮT ĐẦU (có giờ bắt đầu) lẫn dòng BÁO XONG THẲNG (không có giờ bắt đầu).
// Số dòng thừa = min(số dòng bắt đầu, số dòng báo thẳng) — và luôn giữ lại dòng có giờ
// bắt đầu vì nó mới có dữ liệu thời gian thật.
//
// Nếu một người chỉ báo thẳng nhiều lần trong ngày (không bấm bắt đầu) thì KHÔNG đụng tới —
// đó nhiều khả năng là nhiều việc thật cho nhiều khách khác nhau.
import { q } from '../db/client.js';
import { cleanNote } from '../lib/tasks.js';

export interface DupItem {
  id: string;
  memberName: string;
  taskName: string;
  date: string;
  note: string;
  points: number;
}

export interface DedupeReport {
  items: DupItem[];
  totalTasks: number;
  totalPoints: number;
  byMember: Array<{ memberName: string; tasks: number; points: number }>;
}

interface Row {
  task_id: string;
  member_id: string;
  member_name: string;
  task_code: string;
  task_name: string;
  note: string;
  points: number;
  started_at: string;
  completed_at: string;
  created_at: string;
}

/** Tìm các việc thừa. KHÔNG thay đổi gì — chỉ liệt kê để xem trước. */
export async function findDuplicateTasks(month?: string): Promise<DedupeReport> {
  const rows: Row[] = month
    ? await q("SELECT * FROM tasks WHERE status = 'done' AND completed_at LIKE $1", [`${month}%`])
    : await q("SELECT * FROM tasks WHERE status = 'done'");

  // Gom theo: người + loại việc + ngày + mô tả đã làm sạch.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const day = String(r.completed_at || r.created_at || '').slice(0, 10);
    if (!day) continue;
    const note = cleanNote(r.note || '', r.task_name || '').toLowerCase();
    const key = `${r.member_id}|${r.task_code}|${day}|${note}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }

  const items: DupItem[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const started = list.filter((r) => (r.started_at || '').trim() !== '');
    const logged = list.filter((r) => (r.started_at || '').trim() === '');
    if (started.length === 0 || logged.length === 0) continue; // không có dấu hiệu báo hai lần

    // Bỏ các dòng báo thẳng mới nhất trước (dòng báo lại thường tới sau).
    const extra = Math.min(started.length, logged.length);
    logged
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, extra)
      .forEach((r) => {
        items.push({
          id: r.task_id,
          memberName: r.member_name || '',
          taskName: r.task_name || '',
          date: String(r.completed_at || r.created_at || '').slice(0, 10),
          note: r.note || '',
          points: Number(r.points) || 0,
        });
      });
  }

  items.sort((a, b) => (a.date < b.date ? 1 : -1));
  const byMemberMap = new Map<string, { tasks: number; points: number }>();
  for (const it of items) {
    const cur = byMemberMap.get(it.memberName) || { tasks: 0, points: 0 };
    byMemberMap.set(it.memberName, { tasks: cur.tasks + 1, points: cur.points + it.points });
  }

  return {
    items,
    totalTasks: items.length,
    totalPoints: items.reduce((s, i) => s + i.points, 0),
    byMember: [...byMemberMap.entries()]
      .map(([memberName, v]) => ({ memberName, ...v }))
      .sort((a, b) => b.points - a.points),
  };
}

/**
 * Đánh dấu các việc thừa là 'duplicate'.
 * KHÔNG xoá dòng — chỉ đổi trạng thái nên hết được tính điểm mà vẫn khôi phục lại được.
 */
export async function markDuplicates(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await q(
    "UPDATE tasks SET status = 'duplicate' WHERE task_id = ANY($1) AND status = 'done' RETURNING task_id",
    [ids],
  );
  return rows.length;
}

/** Khôi phục mọi việc đã đánh dấu trùng (phòng khi dọn nhầm). */
export async function restoreDuplicates(): Promise<number> {
  const rows = await q(
    "UPDATE tasks SET status = 'done' WHERE status = 'duplicate' RETURNING task_id",
  );
  return rows.length;
}
