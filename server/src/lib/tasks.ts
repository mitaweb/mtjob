// Tên hiển thị của 1 task = loại việc (catalog) + mô tả cụ thể (note) nếu có.
// Ví dụ: taskName "Đăng post" + note "X Salon" → "Đăng post — X Salon".

const SYSTEM_NOTE = /^(Giao bởi|Backfill|Sửa bởi)/i;

export function taskTitle(t: { taskName?: string; note?: string; source?: string }): string {
  const name = (t.taskName || '').trim();
  const note = (t.note || '').trim();
  // Việc được giao: taskName đã là mô tả đầy đủ, note chỉ là "Giao bởi X" → chỉ lấy name.
  if (!note || t.source === 'assign' || SYSTEM_NOTE.test(note)) return name;
  if (!name) return note;
  const nl = note.toLowerCase();
  const ml = name.toLowerCase();
  if (nl.includes(ml)) return note; // note đã chứa cả loại việc
  if (ml.includes(nl)) return name;
  return `${name} — ${note}`;
}
