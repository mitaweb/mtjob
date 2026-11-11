// Việc tự động (học Javis — anh Tâm 11/11/2026 chọn mục 5): việc lặp theo lịch (vd "mỗi sáng 8h kéo số Ads so tuần
// trước") do trợ lý CHỈ ĐỌC chạy; kết quả qua bước kiểm lại; sai 3 lần liền thì tự dừng và báo anh.

export const SAI_TOI_DA = 3;
/** Sai thì thử lại sau ngần này (trong cửa sổ bù 3 tiếng của lịch) — 3 lần sai trong ~20 phút là dừng. */
export const THU_LAI_SAU_MS = 10 * 60_000;

export type TrangThaiViec = 'chay' | 'dung' | 'tu_dung';

/** Kết quả hỏng thấy ngay (trống, câu lỗi, bị chặn) → lý do; còn lại null (để AI kiểm). */
export function loiRoRang(ketQua: string): string | null {
  const s = String(ketQua || '').trim();
  if (s.length < 20) return 'kết quả trống / quá ngắn';
  if (/trợ lý đang bận|AI trả lời quá lâu|Chưa cấu hình trợ lý|cần bật Trợ lý AI|\(Nguyên nhân:/i.test(s)) return 'AI lỗi / quá tải';
  if (/^Lỗi[:\s]/im.test(s)) return 'công cụ báo lỗi';
  if (/CHƯA ghi được gì/.test(s)) return 'trợ lý trả lời bịa';
  return null;
}

/** Cập nhật sau một lượt: đạt → xoá đếm; sai → +1, chạm SAI_TOI_DA → tự dừng. */
export function sauLuot(soLanLoi: number, dat: boolean): { soLanLoi: number; trangThai: TrangThaiViec } {
  if (dat) return { soLanLoi: 0, trangThai: 'chay' };
  const n = (Number(soLanLoi) || 0) + 1;
  return { soLanLoi: n, trangThai: n >= SAI_TOI_DA ? 'tu_dung' : 'chay' };
}
