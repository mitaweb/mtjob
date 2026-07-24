// Tên hiển thị của 1 task = loại việc (catalog) + mô tả cụ thể (note) nếu có.
// Ví dụ: taskName "Đăng post" + note "X Salon" → "Đăng post — X Salon".
import { removeAccents } from './people.js';

const SYSTEM_NOTE = /^(Giao bởi|Backfill|Sửa bởi)/i;

// Cụm mở đầu chỉ nói HÀNH ĐỘNG, không phải mô tả việc — "bắt đầu lên ads" thì "bắt đầu" là thừa.
const ACTION_PREFIX =
  /^(đã|da|đang|dang|vừa|vua|bắt đầu|bat dau|bắt tay|bat tay|chuẩn bị|chuan bi|sẽ|se|giờ|gio|xong|hoàn thành|hoan thanh|làm|lam)\s+/i;
const CONNECTOR = /^(cho|của|cua|với|voi|-|–|—|:)\s*/i;

/**
 * Làm sạch ghi chú do người dùng gõ trong chat: bỏ cụm hành động mở đầu và phần lặp lại
 * tên loại việc, chỉ giữ mô tả thật (thường là tên khách).
 * "bắt đầu tối ưu quảng cáo" + loại "Tối ưu Quảng Cáo" → "" (không có mô tả riêng)
 * "đã đăng bài page cho X Salon" + loại "Đăng bài page" → "X Salon"
 */
export function cleanNote(note: string, taskName = ''): string {
  let s = String(note || '').trim();
  if (!s) return '';

  // Bóc dần vì người dùng hay ghép nhiều cụm: "vừa xong ...", "đã làm ...".
  for (let i = 0; i < 4; i++) {
    const next = s.replace(ACTION_PREFIX, '').trim();
    if (next === s) break;
    s = next;
  }

  // removeAccents giữ nguyên số ký tự nên cắt theo độ dài tên việc là an toàn.
  const name = removeAccents(taskName).toLowerCase().trim();
  if (name) {
    const flat = removeAccents(s).toLowerCase();
    if (flat === name) return '';
    if (flat.startsWith(name)) s = s.slice(taskName.trim().length).trim();
  }

  s = s.replace(CONNECTOR, '').trim();
  return removeAccents(s).toLowerCase() === name ? '' : s;
}

// Cụm mở đầu cho biết câu đó là BÁO BẮT ĐẦU, không phải báo xong.
const START_REPORT = /^(bat dau|bat tay|dang lam|chuan bi|sap lam|se lam|gio lam|vao viec)\b/;

/**
 * Câu này là báo BẮT ĐẦU việc chứ không phải báo đã xong?
 * Dùng để chặn cộng điểm cho câu báo bắt đầu — theo quy tắc: một việc chỉ tính
 * điểm ĐÚNG MỘT LẦN, lúc hoàn thành.
 */
export function isStartReport(note: string): boolean {
  return START_REPORT.test(removeAccents(String(note || '')).toLowerCase().trim());
}

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
