// Nhận diện câu HỎI (khác với câu báo việc). Thuần tuý & có test.
// Cần thiết vì bộ nhận diện tin nhắn thấy tên việc trong câu hỏi có thể nhầm thành báo đã làm
// — vd "đã đăng bài page chưa?" phải là câu hỏi, không phải báo đã đăng bài.
import { removeAccents } from './people.js';

const QUESTION_WORDS =
  /(^|\s)(ai|gi|sao|the nao|nhu the nao|bao nhieu|bao gio|khi nao|o dau|tai sao|vi sao|co phai|la gi|nao)(\s|$|\?)/;
const QUESTION_TAIL = /(chua|khong|ko|hay khong|duoc khong|nhi|vay|the)\s*\??$/;

export function looksLikeQuestion(message: string): boolean {
  const raw = String(message || '').trim();
  if (!raw) return false;
  if (raw.includes('?')) return true;
  const m = removeAccents(raw).toLowerCase();
  return QUESTION_WORDS.test(m) || QUESTION_TAIL.test(m);
}
