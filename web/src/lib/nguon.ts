/**
 * Nguồn khách — danh sách CỐ ĐỊNH, không cho gõ tự do.
 *
 * Anh Tâm 4/8/2026 muốn thống kê theo nguồn. Gõ tự do thì mỗi người viết một kiểu
 * (FB / Facebook / face / fb ads) và bảng thống kê vỡ thành hàng chục dòng trùng ý nhau —
 * đúng thứ làm cho con số không dùng được.
 *
 * Để ở đây chứ không nằm trong từng trang: trang Khách hàng và trang Tài chính cùng dùng.
 * Hai bản danh sách riêng thì thêm nguồn ở một bên là bên kia lệch ngay, mà lệch kiểu này
 * không có gì báo — chỉ thấy bảng doanh thu tự dưng có nhóm lạ.
 */
export const NGUON = [
  'Facebook Ads',
  'Google Ads',
  'Zalo',
  'Website',
  'Giới thiệu',
  'BNI',
  'Sự kiện',
  'Khác',
];

/** Nhóm cho khoản thu chưa gắn nguồn. Phải khớp CHUA_RO_NGUON bên server/src/lib/finance.ts. */
export const CHUA_RO_NGUON = 'Chưa rõ nguồn';
