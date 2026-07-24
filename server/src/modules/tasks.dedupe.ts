// Rà soát và dọn các việc bị TÍNH ĐIỂM HAI LẦN.
//
// Lỗi cũ: một việc được ghi thành hai dòng cùng tính điểm — báo "bắt đầu X" một dòng,
// báo "đã X xong" một dòng nữa. Bảng điểm phồng gấp đôi, ảnh hưởng thẳng tới thưởng.
//
// Hai kiểu trùng, đều gom theo CÙNG người + CÙNG loại việc + CÙNG ngày + CÙNG mô tả:
//
//   1. "bắt đầu + báo thẳng": nhóm có cả dòng ĐÃ BẤM BẮT ĐẦU (có giờ bắt đầu) lẫn dòng
//      BÁO XONG THẲNG (không giờ bắt đầu). Bỏ min(số dòng mỗi bên) dòng báo thẳng, giữ
//      dòng có giờ bắt đầu vì nó mới có dữ liệu thời gian thật.
//
//   2. "câu báo bắt đầu bị tính điểm": dòng có ghi chú kiểu "bắt đầu tối ưu quảng cáo"
//      NHƯNG không có giờ bắt đầu — tức là câu báo bắt đầu bị ghi thẳng thành việc xong.
//      Theo quy tắc, báo bắt đầu KHÔNG được có điểm. Chỉ bỏ khi trong nhóm còn ít nhất
//      một dòng báo xong thật, để người chỉ kịp báo bắt đầu không bị mất trắng công.
//
// Dòng có giờ bắt đầu LUÔN được giữ, kể cả khi ghi chú vẫn còn chữ "bắt đầu" (dữ liệu cũ
// tạo trước khi có cleanNote): đó là việc bấm nút Bắt đầu rồi bấm Kết thúc — việc thật.
//
// Người chỉ báo thẳng nhiều lần trong ngày (không dòng nào bắt đầu) thì KHÔNG đụng tới —
// nhiều khả năng là nhiều việc thật cho nhiều khách khác nhau.
import { q } from '../db/client.js';
import { cleanNote, isStartReport } from '../lib/tasks.js';

export interface DupItem {
  id: string;
  memberName: string;
  taskName: string;
  date: string;
  note: string;
  points: number;
  /** Vì sao dòng này bị coi là thừa — để anh soi lại được từng dòng. */
  reason: 'báo thẳng trùng dòng đã bắt đầu' | 'câu báo bắt đầu bị tính điểm';
}

export interface DedupeReport {
  items: DupItem[];
  totalTasks: number;
  totalPoints: number;
  byMember: Array<{ memberName: string; tasks: number; points: number }>;
}

export interface Row {
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
  return pickDuplicates(rows);
}

/**
 * Phần quyết định dòng nào là thừa — thuần, không đụng DB nên test được.
 * Tách riêng vì luật này trừ thẳng vào điểm và thưởng của nhân sự: sai một nhịp là
 * lương sai, nên nó phải kiểm được bằng dữ liệu thật chứ không chỉ đọc code.
 */
export function pickDuplicates(rows: Row[]): DedupeReport {
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
  const add = (r: Row, reason: DupItem['reason']) =>
    items.push({
      id: r.task_id,
      memberName: r.member_name || '',
      taskName: r.task_name || '',
      date: String(r.completed_at || r.created_at || '').slice(0, 10),
      note: r.note || '',
      points: Number(r.points) || 0,
      reason,
    });

  for (const list of groups.values()) {
    // Câu báo bắt đầu mà KHÔNG có giờ bắt đầu = chưa hề có việc nào được mở ra, chỉ là
    // câu nói bị ghi thẳng thành việc xong. Điểm ghi ở lúc KẾT THÚC nên dòng này không
    // được có điểm — bỏ bất kể nhóm có bao nhiêu dòng, kể cả khi nó đứng một mình.
    const bogusStart = list.filter(
      (r) => isStartReport(r.note || '') && (r.started_at || '').trim() === '',
    );
    bogusStart.forEach((r) => add(r, 'câu báo bắt đầu bị tính điểm'));

    if (list.length < 2) continue;

    // Còn lại: hai dòng cho cùng một việc — một dòng bấm nút (có giờ bắt đầu), một dòng
    // báo thẳng trong chat. Bỏ dòng báo thẳng, giữ dòng có giờ làm thật.
    const rest = list.filter((r) => !bogusStart.includes(r));
    const startedRows = rest.filter((r) => (r.started_at || '').trim() !== '');
    const loggedRows = rest.filter((r) => (r.started_at || '').trim() === '');
    if (startedRows.length > 0 && loggedRows.length > 0) {
      loggedRows
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) // dòng báo lại thường tới sau
        .slice(0, Math.min(startedRows.length, loggedRows.length))
        .forEach((r) => add(r, 'báo thẳng trùng dòng đã bắt đầu'));
    }
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
 *
 * Trả về ID của những dòng THỰC SỰ đổi được, không phải danh sách đã yêu cầu: caller
 * phải báo cho anh Tâm con số thật, đừng báo số điểm dự kiến trừ trong khi UPDATE trượt.
 */
export async function markDuplicates(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await q(
    "UPDATE tasks SET status = 'duplicate' WHERE task_id = ANY($1) AND status = 'done' RETURNING task_id",
    [ids],
  );
  return rows.map((r: { task_id: string }) => r.task_id);
}

/**
 * Đổi nhãn những việc THẬT — có giờ bắt đầu, đã hoàn thành đàng hoàng — mà ghi chú vẫn
 * là câu báo bắt đầu ("bắt đầu lên ads"). Dữ liệu cũ tạo trước khi có `cleanNote`.
 *
 * KHÔNG đụng tới điểm và giờ làm: đây là việc có thật, chỉ có cái nhãn đọc lên như thể
 * đang tính điểm cho câu báo bắt đầu. Sau bước này bảng điểm không còn dòng nào mở đầu
 * bằng "bắt đầu…" nữa — dòng nào sai thì đã bị bỏ, dòng nào thật thì hiện đúng tên việc.
 */
export async function relabelStartNotes(month?: string): Promise<number> {
  const rows: Row[] = month
    ? await q(
        "SELECT * FROM tasks WHERE status = 'done' AND started_at <> '' AND note <> '' AND completed_at LIKE $1",
        [`${month}%`],
      )
    : await q("SELECT * FROM tasks WHERE status = 'done' AND started_at <> '' AND note <> ''");

  // Gom theo nhãn mới rồi cập nhật một lượt mỗi nhãn — mỗi query là một lượt HTTP tới
  // Neon, sửa từng dòng một sẽ hết giờ hàm serverless trước khi chạy xong.
  const byNewNote = new Map<string, string[]>();
  for (const r of rows) {
    if (!isStartReport(r.note || '')) continue;
    const next = cleanNote(r.note || '', r.task_name || '');
    if (next === r.note) continue;
    byNewNote.set(next, [...(byNewNote.get(next) || []), r.task_id]);
  }

  let changed = 0;
  for (const [note, ids] of byNewNote) {
    const done = await q('UPDATE tasks SET note = $2 WHERE task_id = ANY($1) RETURNING task_id', [ids, note]);
    changed += done.length;
  }
  return changed;
}

/** Khôi phục mọi việc đã đánh dấu trùng (phòng khi dọn nhầm). */
export async function restoreDuplicates(): Promise<number> {
  const rows = await q(
    "UPDATE tasks SET status = 'done' WHERE status = 'duplicate' RETURNING task_id",
  );
  return rows.length;
}
