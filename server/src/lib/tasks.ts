// Tên hiển thị của 1 task = loại việc (catalog) + mô tả cụ thể (note) nếu có.
// Ví dụ: taskName "Đăng post" + note "X Salon" → "Đăng post — X Salon".
import { removeAccents } from './people.js';

const SYSTEM_NOTE = /^(Giao bởi|Backfill|Sửa bởi)/i;

// Cụm mở đầu chỉ nói HÀNH ĐỘNG, không phải mô tả việc — "bắt đầu lên ads" thì "bắt đầu" là thừa.
// Cho phép dấu ":" ngay sau (vd "Bắt đầu:") vì nhân viên hay dán lại bong bóng chat của app.
// Cụm dài phải đứng TRƯỚC cụm ngắn trùng đầu ("ghi nhận task" trước "ghi nhận"),
// nếu không regex khớp cụm ngắn rồi bỏ sót phần còn lại.
const ACTION_PREFIX =
  /^(đã|da|đang|dang|vừa|vua|bắt đầu|bat dau|bắt tay|bat tay|ghi nhận task|ghi nhan task|ghi nhận|ghi nhan|chuẩn bị|chuan bi|sẽ|se|giờ|gio|xong|hoàn thành|hoan thanh|làm|lam)[\s:]+/i;
const CONNECTOR = /^(cho|của|cua|với|voi|-|–|—|:)\s*/i;
// Emoji/ký hiệu đầu câu do dán lại tin nhắn app ("▶️ Bắt đầu:", "✅ Đã hoàn thành").
const LEAD_SYMBOL = /^[\p{Extended_Pictographic}️\s]+/u;

/**
 * Viết tắt trong DANH MỤC NHIỆM VỤ ↔ cách viết đầy đủ nhân sự hay gõ.
 * Danh mục có "Xây dựng chân dung KH" (ADS04) nhưng nhân sự gõ "…chân dung khách hàng",
 * nên phải khớp được cả hai chiều mới bóc đúng phần tên việc.
 */
const CATALOG_ALIAS: Record<string, string> = {
  kh: 'khach hang',
  qc: 'quang cao',
  tkqc: 'tai khoan quang cao',
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regex khớp phần MỞ ĐẦU đúng bằng tên loại việc, chấp nhận cả dạng viết tắt lẫn đầy đủ.
 * So theo TỪ (`\s+` giữa các từ) nên "Tối ưu  Quảng Cáo" thừa khoảng trắng vẫn khớp.
 */
function taskNamePattern(taskName: string): RegExp | null {
  const toks = removeAccents(taskName).toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (toks.length === 0) return null;
  const body = toks
    .map((t) => {
      const full = CATALOG_ALIAS[t];
      return full ? `(?:${escapeRe(full).replace(/ /g, '\\s+')}|${escapeRe(t)})` : escapeRe(t);
    })
    .join('\\s+');
  return new RegExp(`^${body}`, 'i');
}

/**
 * Làm sạch ghi chú do người dùng gõ trong chat: bỏ cụm hành động mở đầu và phần lặp lại
 * tên loại việc, chỉ giữ mô tả thật (thường là tên khách).
 * "bắt đầu tối ưu quảng cáo" + loại "Tối ưu Quảng Cáo" → "" (không có mô tả riêng)
 * "đã đăng bài page cho X Salon" + loại "Đăng bài page" → "X Salon"
 * "Xây dựng chân dung khách hàng : add page" + loại "Xây dựng chân dung KH" → "add page"
 */
export function cleanNote(note: string, taskName = ''): string {
  let s = String(note || '').trim();
  if (!s) return '';

  const pattern = taskNamePattern(taskName);
  // removeAccents giữ nguyên số ký tự nên độ dài khớp trên chuỗi không dấu cắt được
  // đúng vị trí trên chuỗi gốc.
  const nameLen = (str: string) => pattern?.exec(removeAccents(str).toLowerCase())?.[0].length ?? -1;

  // Bóc dần vì người dùng hay ghép nhiều cụm: "▶️ Bắt đầu: ...", "ghi nhận task : ...",
  // "vừa xong ...". Mỗi vòng gỡ emoji/ký hiệu đầu câu rồi gỡ một cụm hành động.
  for (let i = 0; i < 5; i++) {
    // DỪNG khi phần còn lại đã bắt đầu bằng tên loại việc — nếu không sẽ bóc quá tay:
    // "Chuẩn bị nội dung quảng cáo" là TÊN VIỆC, chữ "chuẩn bị" trong đó không phải
    // cụm hành động, bóc tiếp sẽ ra "nội dung quảng cáo" cụt lủn.
    if (nameLen(s) >= 0) break;
    const next = s.replace(LEAD_SYMBOL, '').replace(ACTION_PREFIX, '').trim();
    if (next === s) break;
    s = next;
  }

  const len = nameLen(s);
  if (len >= 0) {
    const rest = s.slice(len);
    // CHỈ cắt khi dừng đúng ranh giới từ — tên việc có thể là tiền tố của một từ dài hơn
    // trong ghi chú, cắt bừa sẽ xén mất chữ.
    if (rest === '' || /^[\s:,.\-–—]/.test(rest)) s = rest.trim();
  }

  s = s.replace(CONNECTOR, '').trim();
  return !s || nameLen(s) === s.length ? '' : s;
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

/**
 * Nhân viên có được tự xoá dòng việc này không? Trả câu lý do, hoặc '' nếu được.
 *
 * Anh Tâm 29/7/2026: "chat với AI đôi khi bị sai công việc, thêm nút X để xoá task nếu
 * chọn sai." Trợ lý gán nhầm LOẠI việc là gán nhầm điểm, nên phải có đường tự sửa.
 *
 * @param doneDate ngày hoàn thành theo giờ VN (YYYY-MM-DD), '' nếu chưa xong
 * @param today    hôm nay theo giờ VN
 */
export function taskDeleteBlock(status: string, doneDate: string, today: string): string {
  // Chưa xong = chưa có điểm, xoá thoải mái. Đây là ca thường gặp: vừa chat xong thấy
  // trợ lý chọn sai loại việc, xoá rồi nhắn lại.
  if (status === 'doing') return '';

  // Việc cấp trên giao: xoá là mất luôn đầu việc bên giao đang chờ, không phải chuyện
  // của người nhận. Muốn bỏ thì báo người giao.
  if (status === 'todo') return 'Việc này do cấp trên giao nên bạn không tự xoá được. Báo người giao việc giúp nhé.';

  if (status === 'done') {
    // Qua ngày là điểm đã vào bảng xếp hạng và thưởng của tháng — để nhân viên tự rút
    // lại lúc đó thì số liệu đổi sau lưng giám đốc.
    return doneDate && doneDate === today
      ? ''
      : 'Việc đã xong từ hôm trước nên không tự xoá được nữa. Nhờ giám đốc trừ bù giúp nhé.';
  }

  return 'Dòng việc này không xoá được.';
}
