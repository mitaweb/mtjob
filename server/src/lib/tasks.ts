// Tên hiển thị của 1 task = loại việc (catalog) + mô tả cụ thể (note) nếu có.
// Ví dụ: taskName "Đăng post" + note "X Salon" → "Đăng post — X Salon".
import { removeAccents } from './people.js';

const SYSTEM_NOTE = /^(Giao bởi|Backfill|Sửa bởi)/i;

// Cụm mở đầu chỉ nói HÀNH ĐỘNG, không phải mô tả việc — "bắt đầu lên ads" thì "bắt đầu" là thừa.
// Cho phép dấu ":" ngay sau (vd "Bắt đầu:") vì nhân viên hay dán lại bong bóng chat của app.
const ACTION_PREFIX =
  /^(đã|da|đang|dang|vừa|vua|bắt đầu|bat dau|bắt tay|bat tay|chuẩn bị|chuan bi|sẽ|se|giờ|gio|xong|hoàn thành|hoan thanh|làm|lam)[\s:]+/i;
const CONNECTOR = /^(cho|của|cua|với|voi|-|–|—|:)\s*/i;
// Emoji/ký hiệu đầu câu do dán lại tin nhắn app ("▶️ Bắt đầu:", "✅ Đã hoàn thành").
const LEAD_SYMBOL = /^[\p{Extended_Pictographic}️\s]+/u;

/**
 * Làm sạch ghi chú do người dùng gõ trong chat: bỏ cụm hành động mở đầu và phần lặp lại
 * tên loại việc, chỉ giữ mô tả thật (thường là tên khách).
 * "bắt đầu tối ưu quảng cáo" + loại "Tối ưu Quảng Cáo" → "" (không có mô tả riêng)
 * "đã đăng bài page cho X Salon" + loại "Đăng bài page" → "X Salon"
 */
export function cleanNote(note: string, taskName = ''): string {
  let s = String(note || '').trim();
  if (!s) return '';

  // Bóc dần vì người dùng hay ghép nhiều cụm: "▶️ Bắt đầu: ...", "vừa xong ...", "đã làm ...".
  // Mỗi vòng: gỡ emoji/ký hiệu đầu câu rồi gỡ một cụm hành động — chịu được cả khi
  // nhân viên dán nguyên bong bóng chat "▶️ Bắt đầu: Tối ưu Quảng Cáo — Quốc Phong".
  for (let i = 0; i < 5; i++) {
    const next = s.replace(LEAD_SYMBOL, '').replace(ACTION_PREFIX, '').trim();
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
// CỐ Ý không có "chuẩn bị": có loại việc tên là "Chuẩn bị nội dung quảng cáo",
// "Chuẩn bị chứng từ" — câu "chuẩn bị nội dung quảng cáo cho X" là báo XONG việc đó,
// không phải báo bắt đầu. Chỉ giữ những cụm không trùng tên loại việc nào.
const START_REPORT = /^(bat dau|bat tay|dang lam|vao viec)\b/;

/**
 * Câu này là báo BẮT ĐẦU việc chứ không phải báo đã xong?
 * Dùng để chặn cộng điểm cho câu báo bắt đầu — theo quy tắc: một việc chỉ tính
 * điểm ĐÚNG MỘT LẦN, lúc hoàn thành.
 */
export function isStartReport(note: string): boolean {
  return START_REPORT.test(removeAccents(String(note || '')).toLowerCase().trim());
}

/**
 * Khoá nhận diện KHÁCH HÀNG của một việc, để biết hai dòng có phải cùng một việc không.
 * Anh Tâm chốt 25/7/2026: "x salon" hay "X-Salon" đều là một, không quan tâm cách viết.
 *
 * CỐ Ý KHÔNG đặt tên `customerKey`: `brain.service.ts` đã có hàm tên đó và giá trị của nó
 * là KHOÁ CHÍNH bảng `brain_profiles` — trùng tên rồi sửa nhầm là mồ côi toàn bộ hồ sơ khách.
 */
export function taskCustomerKey(note: string): string {
  const s = String(note || '').trim();
  // Ghi chú hệ thống ("Giao bởi Tâm") không phải tên khách — coi như chưa khai, để lúc
  // báo xong nhân viên khai bổ sung được, không thì việc leader giao sẽ treo mãi.
  if (SYSTEM_NOTE.test(s)) return '';
  return removeAccents(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ') // "-", ":", "_", emoji, dấu câu → khoảng trắng
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dòng việc đang làm dở, rút gọn còn những gì cần để so khớp. */
export interface DoingLike {
  id: string;
  taskCode: string;
  note?: string;
  startedAt?: string;
}

/** Các dòng doing cùng loại việc, cũ nhất trước (getDoingTasks đã sắp theo started_at). */
function sameCode<T extends DoingLike>(doing: T[], taskCode: string): T[] {
  return doing.filter((t) => t.taskCode === taskCode);
}

/**
 * Câu báo XONG này nên đóng việc đang làm dở nào? `null` = không có, tạo dòng mới.
 *
 * Khoá rỗng là KÝ TỰ ĐẠI DIỆN ở chiều đóng việc: dữ liệu cũ có dòng doing chưa ghi khách,
 * khớp cứng sẽ treo chúng vĩnh viễn. Ngược lại, câu có tên khách khớp được dòng chưa có tên
 * (khai bổ sung lúc kết thúc). Nhưng KHÁC khách thì trả `null` — tuyệt đối không đụng,
 * vì đó chính là lỗi từng làm mất một việc thật và gán nhầm khách cho việc khác.
 */
export function pickDoingToComplete<T extends DoingLike>(
  doing: T[],
  taskCode: string,
  note: string,
): T | null {
  const cands = sameCode(doing, taskCode);
  if (cands.length === 0) return null;

  const key = taskCustomerKey(note);
  const blanks = cands.filter((t) => taskCustomerKey(t.note || '') === '');

  if (key) {
    const exact = cands.find((t) => taskCustomerKey(t.note || '') === key);
    if (exact) return exact;
    return blanks[0] || null; // khai bổ sung tên khách cho dòng chưa ghi
  }
  // Không nhắc khách nào: ưu tiên dòng cũng chưa ghi khách, không có thì lấy dòng cũ nhất
  // — đã có việc dở cùng loại thì đừng sinh thêm dòng mồ côi.
  return blanks[0] || cands[0];
}

/**
 * Đã có việc cùng (loại việc + khách) đang mở chưa? Khớp CỨNG, rỗng khớp rỗng.
 *
 * Bấm "bắt đầu Tối ưu QC" hai lần mà không khai khách gần như chắc chắn là bấm nhầm —
 * đây đúng là nguồn của các cụm mở hàng loạt rồi đóng hàng loạt trong dữ liệu tháng 7.
 * Nhưng khác khách thì KHÔNG chặn: "Tối ưu QC — X Salon" và "— Quốc Phong" là hai việc thật.
 */
export function findOpenDuplicate<T extends DoingLike>(
  doing: T[],
  taskCode: string,
  note: string,
): T | null {
  const key = taskCustomerKey(note);
  return sameCode(doing, taskCode).find((t) => taskCustomerKey(t.note || '') === key) || null;
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
