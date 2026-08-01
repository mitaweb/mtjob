// Luật giữ cho bảng nhân sự không tự bắn vào chân mình.
//
// Anh Tâm 29/7/2026 chuyển toàn bộ quản lý nhân sự và lương từ Google Sheet vào app, và
// chọn cho XOÁ HẲN người đã nghỉ. Xoá hẳn thì không có đường lui, nên mọi chốt chặn phải
// nằm ở đây — thuần, test được — chứ không rải trong route.

export interface MemberLike {
  id: string;
  fullName: string;
  username: string;
  role: string;
  active: boolean;
}

/** Vai nào vào được phần Quản trị. Mất hết những vai này là không ai sửa được gì nữa. */
const ADMIN_ROLES = new Set(['director', 'admin']);

/**
 * Có được xoá người này không? Trả câu lý do, hoặc '' nếu được.
 *
 * @param all    toàn bộ nhân sự đang có (kể cả đã nghỉ)
 * @param id     người sắp bị xoá
 * @param selfId người đang bấm nút
 */
export function deleteMemberBlock(all: MemberLike[], id: string, selfId: string): string {
  const target = all.find((m) => m.id === id);
  if (!target) return 'Không tìm thấy nhân sự này.';

  // Tự xoá mình = khoá cửa rồi nhốt mình bên ngoài.
  if (id === selfId) return 'Không tự xoá tài khoản của chính mình được.';

  // Người quản trị CUỐI CÙNG: xoá xong là cả công ty không ai vào được phần Quản trị,
  // kể cả để tạo lại người khác. Đếm cả người đã nghỉ vì họ bật lại được.
  if (ADMIN_ROLES.has(target.role)) {
    const others = all.filter((m) => m.id !== id && ADMIN_ROLES.has(m.role));
    if (others.length === 0) {
      return `${target.fullName} là người duy nhất còn quyền quản trị. Lập người thay trước rồi hãy xoá.`;
    }
  }

  return '';
}

/**
 * Tên đăng nhập này đã có người khác dùng chưa? Trả câu lý do, hoặc '' nếu dùng được.
 *
 * Bản đồng bộ Sheet cũ tự thêm số vào đuôi khi trùng (`upsertHrPeople`). Nhập tay thì
 * KHÔNG được tự đổi — anh gõ `hotam` mà máy lưu thành `hotam2` rồi không báo gì thì
 * đăng nhập không được mà chẳng hiểu vì sao.
 */
export function usernameTaken(all: MemberLike[], username: string, selfId: string): string {
  const want = username.trim().toLowerCase();
  if (!want) return '';
  const clash = all.find((m) => m.id !== selfId && m.username.trim().toLowerCase() === want);
  return clash ? `Tên đăng nhập "${username}" đã là của ${clash.fullName}. Chọn tên khác nhé.` : '';
}
