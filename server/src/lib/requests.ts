// Luật cho đơn giải trình chấm công: quên chấm công, đi trễ, về sớm.
//
// Anh Tâm 4/8/2026: "mặc định trong 24h phải làm đơn nếu không thì không làm được".
// Để cứng ở đây — thuần, test được — chứ không rải trong route: đây là luật kỷ luật, hở
// một chỗ là người ta nộp bù cho cả tháng trước.
import { dayjs } from './datetime.js';

/** Ba loại đơn giải trình chấm công. Khác đơn nghỉ/online ở chỗ nói về MỘT ngày đã qua. */
export const GIAI_TRINH = ['forgot', 'late', 'early'] as const;
export type GiaiTrinhKind = (typeof GIAI_TRINH)[number];

export const TEN_DON: Record<GiaiTrinhKind, string> = {
  forgot: 'Quên chấm công',
  late: 'Đi trễ',
  early: 'Về sớm',
};

export function laDonGiaiTrinh(kind: string): kind is GiaiTrinhKind {
  return (GIAI_TRINH as readonly string[]).includes(kind);
}

/**
 * Hạn nộp đơn cho ngày `ngayXayRa`: hết ngày HÔM SAU.
 *
 * Chỉ biết NGÀY chứ không biết giờ xảy ra, nên không tính 24h từ mốc giờ được. Lấy hết
 * ngày hôm sau là cách gần nhất mà vẫn nói ra được thành một câu: "nộp được cho hôm nay
 * và hôm qua". Người ta đoán trước được hạn của mình, không phải nhẩm giờ.
 */
export function hanNopDon(ngayXayRa: string): string {
  return dayjs(ngayXayRa).add(1, 'day').format('YYYY-MM-DD');
}

/** Còn hạn nộp đơn cho ngày đó không? Trả câu lý do, hoặc '' nếu được. */
export function chanNopDon(ngayXayRa: string, homNay: string): string {
  const d = dayjs(ngayXayRa);
  const t = dayjs(homNay);
  if (!d.isValid() || !t.isValid()) return 'Ngày không hợp lệ.';

  const ngay = d.format('YYYY-MM-DD');
  const nay = t.format('YYYY-MM-DD');
  // Ngày mai chưa xảy ra thì chưa có gì để giải trình.
  if (ngay > nay) return 'Chưa tới ngày đó nên chưa nộp đơn giải trình được.';
  if (nay > hanNopDon(ngay)) {
    return `Quá hạn nộp đơn. Đơn giải trình cho ngày ${ngay} chỉ nộp được tới hết ngày ${hanNopDon(ngay)}.`;
  }
  return '';
}
