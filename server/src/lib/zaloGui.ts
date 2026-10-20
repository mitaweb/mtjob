// Gửi tin Zalo hàng loạt (anh Tâm 20/10/2026: "bổ sung trong đó phần gửi tin nhắn hàng loạt qua zalo nữa, lọc các
// yếu tố mà zalo cho phép, tích chọn vào những người để gửi"). Hàm THUẦN: nội dung từng người, giờ được gửi, nhịp gửi.
//
// Zalo cá nhân + thư viện không chính thức (zca-js): gửi dồn dập cùng một nội dung là cách nhanh nhất bị Zalo khoá
// tài khoản. Nên: rải trong ngày, giới hạn mỗi ngày, mỗi tin cách nhau ngẫu nhiên, mỗi người một câu chữ hơi khác
// ({ten}, {Chào|Xin chào}), không gửi một người hai lần trong 24 giờ.

/** Tối đa tin gửi mỗi ngày (mọi chiến dịch cộng lại). */
export const GIOI_HAN_NGAY = 100;
/** Mỗi lượt cron (1 phút) gửi tối đa ngần này tin. */
export const MOI_LUOT = 3;
/** Khoảng cách ngẫu nhiên giữa hai tin trong một lượt (ms). */
export const CACH_TIN_MS: [number, number] = [6_000, 12_000];
/** Chỉ gửi trong giờ này (giờ Việt Nam) — không làm phiền khách ban đêm. */
export const GIO_GUI: [number, number] = [8, 21];
/** Không gửi một người / nhóm hai lần trong khoảng này (mọi chiến dịch). */
export const CACH_NGUOI_MS = 24 * 3600 * 1000;
/** Lỗi liên tiếp thì tạm dừng chiến dịch (có thể Zalo đang chặn). */
export const LOI_LIEN_TIEP_DUNG = 3;
/** Một chiến dịch tối đa ngần này người nhận. */
export const TOI_DA_NGUOI = 500;

export function trongGioGui(gioVN: number): boolean {
  return gioVN >= GIO_GUI[0] && gioVN < GIO_GUI[1];
}

/** Tên để gọi trong tin: bỏ phần trong ngoặc / sau dấu "-" ("Anh Tuấn - Gara 911" → "Anh Tuấn"), gọn khoảng trắng. */
export function tenGoi(ten: string): string {
  return String(ten || '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .split(/\s[-–|]\s/)[0]!
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nội dung gửi MỘT người: {ten} → tên người đó; {a|b|c} → chọn ngẫu nhiên một phương án (để mỗi tin hơi khác nhau).
 * Không có tên thì bỏ {ten} và dọn dấu cách / dấu phẩy thừa.
 */
export function traiNoiDung(mau: string, ten: string, ngauNhien: () => number = Math.random): string {
  let s = String(mau || '').replace(/\{([^{}]*\|[^{}]*)\}/g, (_, nhom: string) => {
    const pa = nhom.split('|');
    return pa[Math.min(pa.length - 1, Math.floor(ngauNhien() * pa.length))] ?? '';
  });
  const goi = tenGoi(ten);
  s = s.replace(/\{\s*ten\s*\}/gi, goi);
  if (!goi) s = s.replace(/[ \t]+([,.!?])/g, '$1').replace(/,(\s*[,.!?])/g, '$1');
  return s
    .split('\n')
    .map((d) => d.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .trim();
}

/** Khoảng chờ ngẫu nhiên trước tin kế tiếp. */
export function choGiuaTin(ngauNhien: () => number = Math.random): number {
  return Math.round(CACH_TIN_MS[0] + ngauNhien() * (CACH_TIN_MS[1] - CACH_TIN_MS[0]));
}

/** Ước tính thời gian gửi xong n tin (giờ) — để anh biết trước khi bấm gửi. */
export function uocTinhNgay(n: number, daGuiHomNay = 0): number {
  const conHomNay = Math.max(0, GIOI_HAN_NGAY - daGuiHomNay);
  if (n <= conHomNay) return 0;
  return Math.ceil((n - conHomNay) / GIOI_HAN_NGAY);
}
