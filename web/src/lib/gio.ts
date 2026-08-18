// Giờ trong app: LUÔN 24h. Anh Tâm 18/8/2026: "thời gian trong app anh muốn dùng 24h hết".
//
// Ô <input type="time"> của trình duyệt hiện theo ngôn ngữ của MÁY người dùng, không theo
// trang — máy nào để tiếng Việt 12h thì thấy "03:00 CH". Trang web KHÔNG có cách nào ép
// định dạng đó. Nên phải tự dựng ô nhập giờ (components/TimeInput.tsx), và mọi chỗ hiện
// giờ đều truyền hour12: false chứ không tin mặc định của vùng miền.

const hai = (n: number) => String(n).padStart(2, '0');

/**
 * Chuỗi người dùng gõ → 'HH:mm' 24h, hoặc '' nếu không đọc được.
 *
 * Gõ kiểu nào cũng hiểu: "8" → 08:00 · "830" → 08:30 · "1430" → 14:30 · "14:30" → 14:30.
 * Số quá tay thì kẹp về biên chứ không vứt (gõ "2570" ra 23:59) — sửa lại một chữ số
 * dễ hơn là gõ lại từ đầu.
 */
export function chotGio(raw: string): string {
  const so = String(raw || '').replace(/\D/g, '');
  if (!so) return '';
  if (so.length <= 2) return `${hai(Math.min(23, Number(so)))}:00`;
  const bon = so.slice(0, 4).padStart(4, '0');
  return `${hai(Math.min(23, Number(bon.slice(0, 2))))}:${hai(Math.min(59, Number(bon.slice(2))))}`;
}

/** Định dạng lúc đang gõ: chèn dấu ':' sau 2 số, chưa kẹp biên để không cắt ngang tay người ta. */
export function dangGo(raw: string): string {
  const so = String(raw || '').replace(/\D/g, '').slice(0, 4);
  return so.length <= 2 ? so : `${so.slice(0, 2)}:${so.slice(2)}`;
}

/** Tuỳ chọn dùng chung cho mọi toLocale*String hiển thị giờ — ép 24h, ép giờ VN. */
export const GIO_VN: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Ho_Chi_Minh',
};

/** Ngày + giờ 24h theo giờ VN. */
export const NGAY_GIO_VN: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  ...GIO_VN,
};
