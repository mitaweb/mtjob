// Sắp xếp bảng lương theo cột. Thuần, không dính React — để test được.

/** Cột đang xếp; '' = giữ nguyên thứ tự máy chủ trả về (đang là theo tên). */
export type XepTheo = '' | 'fullName' | 'teamId' | 'salary' | 'actualDays' | 'bhxhDeduction' | 'netSalary';

/** Những cột `sapXep` cần đọc. Dòng thật còn nhiều trường khác, không quan tâm. */
export interface DongXep {
  fullName: string;
  teamId: string;
  salary: number;
  actualDays: number;
  bhxhDeduction: number;
  netSalary: number;
}

/** Cột chữ mặc định xếp A→Z; cột số mặc định cao→thấp — chiều người ta hay muốn xem trước. */
const COT_CHU: XepTheo[] = ['fullName', 'teamId'];

export const TEN_COT: Record<Exclude<XepTheo, ''>, string> = {
  fullName: 'Họ tên',
  teamId: 'Team',
  salary: 'Mức lương',
  actualDays: 'Công',
  bhxhDeduction: 'Trừ BHXH',
  netSalary: 'Lương thực lãnh',
};

/**
 * Trả về MẢNG MỚI đã xếp; không đụng vào mảng gốc — `rows` còn dùng nguyên cho hộp xác
 * nhận lúc chốt lương.
 *
 * Hai chỗ dễ sai đã xử lý:
 * - Tên và team so bằng `localeCompare(…, 'vi')`. So bằng mã ký tự thì "Đặng" rớt xuống
 *   sau "Vũ" vì chữ Đ nằm ngoài bảng chữ ASCII.
 * - Bằng điểm thì so tiếp bằng tên. Không có bước này, hai người cùng mức lương sẽ đảo
 *   chỗ nhau mỗi lần tải lại bảng, nhìn như dữ liệu đang nhảy.
 */
export function sapXep<T extends DongXep>(rows: T[], theo: XepTheo, nguoc: boolean): T[] {
  if (!theo) return rows;
  const chu = COT_CHU.includes(theo);
  const huong = nguoc ? -1 : 1;
  const theoTen = (a: T, b: T) => a.fullName.localeCompare(b.fullName, 'vi');

  return [...rows].sort((a, b) => {
    const d = chu
      ? String(a[theo] ?? '').localeCompare(String(b[theo] ?? ''), 'vi')
      : Number(b[theo]) - Number(a[theo]);
    return (d || theoTen(a, b)) * huong;
  });
}
