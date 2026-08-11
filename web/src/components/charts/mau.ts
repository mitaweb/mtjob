// Màu cho biểu đồ.
//
// recharts nhận màu bằng chuỗi hex chứ không đọc được lớp Tailwind, nên màu thương hiệu
// phải viết tay ở đâu đó. Gom về MỘT chỗ: trước đây ba biểu đồ mỗi cái cắm cứng '#7367f0'
// riêng, đổi màu thương hiệu là sót — mà sót thì không ai thấy cho tới lúc mở đúng trang
// có biểu đồ đó.
//
// Giữ khớp với `brand` trong tailwind.config.js.
export const MAU = {
  /** brand-600 — Ocean Blue, màu chính. */
  chinh: '#0b57c4',
  /** brand-300 — cột phụ, đường tham chiếu. */
  nhat: '#99b8e6',
  /** accent-500 — vàng nhấn. */
  nhan: '#ffbb03',
  /** ink-muted — chữ trên trục. */
  chu: '#52546d',
  /** brand-100 — đường lưới. */
  luoi: '#e2ebf8',
} as const;
