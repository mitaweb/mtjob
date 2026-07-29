import { dayjs, TZ } from './datetime.js';

// Cộng/trừ điểm bù cho một ngày đã qua — khi nhân sự quên ghi việc, hoặc ghi sai.
//
// Anh Tâm 29/7/2026: "anh muốn bổ sung điểm cho bạn nhập thiếu". Trước đó app không có
// đường nào làm việc này: điểm chỉ sinh ra lúc bấm hoàn thành một việc trong ngày.

/**
 * Mã việc của dòng bù. CỐ Ý không nằm trong bảng danh mục nhiệm vụ: `applyCatalogPoints`
 * join tasks với task_catalog theo task_code, nên dòng bù không bao giờ bị đồng bộ bảng
 * điểm ghi đè mất số anh nhập tay.
 */
export const ADJUST_CODE = 'BOSUNG';

/** Nguồn ghi, để lọc ra đúng dòng bù khi liệt kê hay gỡ. */
export const ADJUST_SOURCE = 'adjust';

/** Trần mỗi lần bù. Gõ nhầm 3000 thành 30000 là lệch cả bảng xếp hạng lẫn thưởng. */
export const MAX_ADJUST_POINTS = 5000;

export interface AdjustInput {
  date: string;
  points: number;
  reason: string;
}

/**
 * Kiểm dữ liệu bù điểm. Trả câu lỗi tiếng Việt, hoặc '' nếu hợp lệ.
 * Tách thuần khỏi DB để test được mọi ngưỡng mà không cần bảng nào.
 */
export function validateAdjust(input: AdjustInput, today: string): string {
  const date = String(input.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Chọn ngày cần bù điểm.';
  if (!dayjs(date, 'YYYY-MM-DD', true).isValid()) return `Ngày ${date} không có thật.`;
  if (date > today) return 'Không bù điểm cho ngày chưa tới.';

  const points = Number(input.points);
  if (!Number.isInteger(points) || points === 0) return 'Số điểm phải là số nguyên khác 0.';
  if (Math.abs(points) > MAX_ADJUST_POINTS) {
    return `Mỗi lần bù tối đa ${MAX_ADJUST_POINTS} điểm. Cần nhiều hơn thì chia ra vài lần cho dễ soát.`;
  }

  // Bắt buộc có lý do: sáu tháng sau nhìn lại, một dòng +300đ không kèm chữ nào thì
  // không ai biết vì sao nó ở đó.
  if (String(input.reason || '').trim().length < 3) return 'Ghi rõ lý do bù điểm (ít nhất 3 ký tự).';

  return '';
}

/**
 * Mốc thời gian gán cho dòng bù: 12h trưa giờ VN của ngày đó.
 *
 * Bảng tasks lưu completed_at dạng ISO UTC còn màn hình gom ngày bằng `slice(0, 10)`.
 * Lấy giữa trưa nên dù lệch 7 tiếng về UTC vẫn rơi đúng ngày anh chọn — mốc 0h hay 23h
 * sẽ nhảy sang ngày bên cạnh.
 */
export function adjustIsoAt(date: string): string {
  return dayjs.tz(`${date} 12:00`, 'YYYY-MM-DD HH:mm', TZ).toISOString();
}

/** Tên hiện trên bảng điểm — nhìn là biết dòng này do người nhập tay. */
export function adjustTaskName(points: number): string {
  return points >= 0 ? 'Bổ sung điểm' : 'Trừ điểm';
}

/** Ghi chú lưu kèm, có tên người bù để sau này truy được ai làm. */
export function adjustNote(reason: string, byName: string): string {
  const who = String(byName || '').trim();
  return `${reason.trim()} — ${who ? `${who} nhập bù` : 'nhập bù'}`;
}
