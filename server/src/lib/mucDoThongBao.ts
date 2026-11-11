// Mức độ thông báo (học Javis — anh Tâm 11/11/2026 chọn mục 4): chỉ việc KHẨN mới đổ chuông / rung; việc thường hiện
// trên máy nhưng im lặng; việc ít gấp chỉ nằm trong chuông của app (không đẩy ra máy). Giám đốc chỉnh từng loại ở Quản
// trị; mặc định dưới đây.

export type MucDo = 'khan' | 'thuong' | 'im';
export const MUC_DO: Record<MucDo, string> = {
  khan: 'Khẩn — đổ chuông, rung',
  thuong: 'Thường — hiện trên máy, im lặng',
  im: 'Chỉ trong chuông app',
};
const LA_MUC = (x: unknown): x is MucDo => x === 'khan' || x === 'thuong' || x === 'im';

/** Mọi loại thông báo app đang gửi: tên cho Quản trị + mức mặc định. */
export const LOAI_THONG_BAO: Record<string, { ten: string; macDinh: MucDo }> = {
  reminder: { ten: 'Nhắc hẹn tới giờ', macDinh: 'khan' },
  appointment: { ten: 'Lịch hẹn khách', macDinh: 'khan' },
  request: { ten: 'Đơn nghỉ / làm online (chờ duyệt, kết quả duyệt)', macDinh: 'khan' },
  task_assigned: { ten: 'Được giao việc', macDinh: 'khan' },
  viec_tu_dong_dung: { ten: 'Việc tự động bị dừng vì lỗi', macDinh: 'khan' },
  attendance: { ten: 'Chấm công (xác nhận, nhắc chấm giờ ra)', macDinh: 'thuong' },
  finance_due: { ten: 'Tới hạn thu tiền', macDinh: 'thuong' },
  customer_birthday: { ten: 'Sinh nhật khách', macDinh: 'thuong' },
  task_done: { ten: 'Nhân sự hoàn thành việc', macDinh: 'thuong' },
  kyluat: { ten: 'Kỷ luật / trừ điểm', macDinh: 'thuong' },
  brain_question: { ten: 'Câu hỏi gửi giám đốc (kho tri thức)', macDinh: 'thuong' },
  brain_answer: { ten: 'Giám đốc đã trả lời câu hỏi', macDinh: 'thuong' },
  zalo_hoi: { ten: 'Zalo cần anh xem', macDinh: 'thuong' },
  fanpage: { ten: 'Fanpage: bài / trả lời bình luận chờ duyệt', macDinh: 'thuong' },
  viec_tu_dong: { ten: 'Kết quả việc tự động', macDinh: 'thuong' },
  ads_thao_tac: { ten: 'Nhân sự chỉnh quảng cáo / AI đề xuất (gửi trưởng phòng)', macDinh: 'thuong' },
  daily: { ten: 'Báo cáo ngày (cá nhân)', macDinh: 'thuong' },
  daily_team: { ten: 'Báo cáo ngày (team)', macDinh: 'thuong' },
  daily_all: { ten: 'Báo cáo ngày (toàn công ty)', macDinh: 'thuong' },
  monthly: { ten: 'Báo cáo tháng', macDinh: 'thuong' },
  monthly_payroll: { ten: 'Bảng lương tháng', macDinh: 'thuong' },
  ranking: { ten: 'Xếp hạng tháng', macDinh: 'thuong' },
  brain_pending: { ten: 'Mục kho tri thức chờ duyệt', macDinh: 'im' },
};

/** Cài đặt của giám đốc: chỉ giữ loại có thật + mức hợp lệ. */
export function chuanCaiDat(x: unknown): Record<string, MucDo> {
  const ra: Record<string, MucDo> = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return ra;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) if (LOAI_THONG_BAO[k] && LA_MUC(v)) ra[k] = v;
  return ra;
}

/** Mức của một thông báo: ép tại chỗ gửi > cài đặt giám đốc > mặc định > 'thuong'. Gửi thử luôn khẩn. */
export function mucDoCua(type: string, caiDat: Record<string, string>, ep?: MucDo): MucDo {
  if (type === 'test') return 'khan';
  if (ep && LA_MUC(ep)) return ep;
  const c = caiDat[type];
  if (LA_MUC(c)) return c;
  return LOAI_THONG_BAO[type]?.macDinh ?? 'thuong';
}
