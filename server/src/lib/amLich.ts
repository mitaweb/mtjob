// Đổi ngày ÂM LỊCH → DƯƠNG LỊCH (múi giờ Việt Nam, UTC+7). Hàm thuần, có test.
//
// Dùng để tự tính Tết Nguyên Đán và Giỗ Tổ Hùng Vương mỗi năm — hai ngày lễ theo âm lịch nên
// năm nào cũng rơi vào ngày dương khác. Thuật toán thiên văn của Hồ Ngọc Đức (công bố công khai,
// dùng rộng rãi cho lịch Việt Nam): tìm điểm sóc (trăng mới) và trung khí để xác định tháng âm,
// kể cả tháng nhuận.

const PI = Math.PI;
const INT = Math.floor;
const MUI_GIO = 7;

function jdTuNgay(dd: number, mm: number, yy: number): number {
  const a = INT((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
  if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
  return jd;
}

function ngayTuJd(jd: number): [number, number, number] {
  let b: number;
  let c: number;
  if (jd > 2299160) {
    const a = jd + 32044;
    b = INT((4 * a + 3) / 146097);
    c = a - INT((b * 146097) / 4);
  } else {
    b = 0;
    c = jd + 32082;
  }
  const d = INT((4 * c + 3) / 1461);
  const e = c - INT((1461 * d) / 4);
  const m = INT((5 * e + 2) / 153);
  const day = e - INT((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * INT(m / 10);
  const year = b * 100 + d - 4800 + INT(m / 10);
  return [day, month, year];
}

/** Thời điểm sóc thứ k (tính từ sóc 1/1/1900), theo ngày Julius. */
function soc(k: number): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = PI / 180;
  let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const deltat =
    T < -11
      ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
      : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return jd1 + C1 - deltat;
}

/** Kinh độ mặt trời (radian) tại ngày Julius jdn. */
function kinhDoMatTroi(jdn: number): number {
  const T = (jdn - 2451545.0) / 36525;
  const T2 = T * T;
  const dr = PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L = L - PI * 2 * INT(L / (PI * 2));
  return L;
}

const cungMatTroi = (ngay: number) => INT((kinhDoMatTroi(ngay - 0.5 - MUI_GIO / 24) / PI) * 6);
const ngaySoc = (k: number) => INT(soc(k) + 0.5 + MUI_GIO / 24);

/** Ngày bắt đầu tháng 11 âm lịch của năm yy. */
function thang11(yy: number): number {
  const off = jdTuNgay(31, 12, yy) - 2415021;
  const k = INT(off / 29.530588853);
  let nm = ngaySoc(k);
  if (cungMatTroi(nm) >= 9) nm = ngaySoc(k - 1);
  return nm;
}

/** Vị trí tháng nhuận tính từ tháng 11 âm năm trước. */
function viTriNhuan(a11: number): number {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = cungMatTroi(ngaySoc(k + i));
  do {
    last = arc;
    i++;
    arc = cungMatTroi(ngaySoc(k + i));
  } while (arc !== last && i < 14);
  return i - 1;
}

/**
 * Ngày dương (YYYY-MM-DD) của ngày âm `ngay/thang/nam`. `nhuan` = tháng nhuận.
 * Trả '' nếu không có ngày đó (vd hỏi tháng nhuận mà năm ấy không nhuận tháng đó).
 */
export function amSangDuong(ngay: number, thang: number, nam: number, nhuan = false): string {
  let a11: number;
  let b11: number;
  if (thang < 11) {
    a11 = thang11(nam - 1);
    b11 = thang11(nam);
  } else {
    a11 = thang11(nam);
    b11 = thang11(nam + 1);
  }
  const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853);
  let off = thang - 11;
  if (off < 0) off += 12;
  if (b11 - a11 > 365) {
    const leapOff = viTriNhuan(a11);
    let leapMonth = leapOff - 2;
    if (leapMonth < 0) leapMonth += 12;
    if (nhuan && thang !== leapMonth) return '';
    if (nhuan || off >= leapOff) off += 1;
  } else if (nhuan) {
    return '';
  }
  const [d, m, y] = ngayTuJd(ngaySoc(k + off) + ngay - 1);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Cộng n ngày vào YYYY-MM-DD. */
export function congNgay(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface NgayLe {
  date: string;
  name: string;
}

/**
 * Các ngày nghỉ lễ, Tết hưởng nguyên lương theo Điều 112 Bộ luật Lao động 2019, cho năm `nam`:
 *   Tết Dương lịch 1/1 · Tết Âm lịch 5 ngày · Giỗ Tổ 10/3 âm · 30/4 · 1/5 · Quốc khánh 1/9 + 2/9.
 *
 * Tết Âm lịch: luật cho 5 ngày, còn NGÀY CỤ THỂ do Chính phủ công bố mỗi năm (hay hoán đổi để
 * nghỉ liền). Ở đây đề xuất ngày cuối năm âm (29 hoặc 30 Tết) + mùng 1 đến mùng 4 — anh sửa
 * lại theo thông báo chính thức. Lễ rơi vào thứ 7/CN thì luật cho nghỉ bù: app KHÔNG tự thêm,
 * vì ngày bù cũng do thông báo từng năm.
 */
export function leLonVietNam(nam: number): NgayLe[] {
  const mung1 = amSangDuong(1, 1, nam);
  const out: NgayLe[] = [{ date: `${nam}-01-01`, name: 'Tết Dương lịch' }];
  if (mung1) {
    out.push({ date: congNgay(mung1, -1), name: 'Tết Nguyên Đán (cuối năm âm)' });
    for (let i = 0; i < 4; i++) out.push({ date: congNgay(mung1, i), name: `Tết Nguyên Đán (mùng ${i + 1})` });
  }
  const gioTo = amSangDuong(10, 3, nam);
  if (gioTo) out.push({ date: gioTo, name: 'Giỗ Tổ Hùng Vương (10/3 âm lịch)' });
  out.push(
    { date: `${nam}-04-30`, name: 'Ngày Giải phóng miền Nam' },
    { date: `${nam}-05-01`, name: 'Quốc tế Lao động' },
    { date: `${nam}-09-01`, name: 'Quốc khánh' },
    { date: `${nam}-09-02`, name: 'Quốc khánh' },
  );
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
