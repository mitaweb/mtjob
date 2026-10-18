// Màu cho biểu đồ.
//
// recharts nhận màu bằng chuỗi hex chứ không đọc được lớp Tailwind, nên màu thương hiệu
// phải viết tay ở đâu đó. Gom về MỘT chỗ: trước đây ba biểu đồ mỗi cái cắm cứng '#7367f0'
// riêng, đổi màu thương hiệu là sót — mà sót thì không ai thấy cho tới lúc mở đúng trang
// có biểu đồ đó.
//
// Giữ khớp với `brand` / `ocean` trong tailwind.config.js.
// Giao diện vàng chủ đạo (18/10/2026): cột chính vàng Amber viền mực, nhấn bằng xanh Ocean.
export const MAU = {
  /** brand-600 — Amber Yellow, màu chính. */
  chinh: '#ffbb03',
  /** brand-200 — cột phụ, đường tham chiếu. */
  nhat: '#ffe285',
  /** ocean-600 — xanh nhấn. */
  nhan: '#0b57c4',
  /** ink-muted — chữ trên trục. */
  chu: '#52546d',
  /** viền mặc định — đường lưới. */
  luoi: '#efe4c6',
} as const;
