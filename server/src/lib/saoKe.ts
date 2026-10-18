// Sao kê ngân hàng (anh Tâm 18/10/2026: "1 phần tải sao kê ngân hàng lên nữa là đủ"). Hàm THUẦN: đọc file Excel sao kê
// (Shinhan, MB, ACB, VPBank… — mỗi ngân hàng một mẫu, nhận theo tên cột), khớp giao dịch với đối tác, và dùng tiền đã
// thu / đã trả SAU ngày chốt sổ để trừ công nợ.
import { createHash } from 'node:crypto';
import { chuanChu, ngayISO, soTien, timCot, hoaDonHieuLuc, type SheetDuLieu, type HoaDon, type ThanhToanDoiTac } from './keToan.js';

export interface GiaoDich {
  /** Khoá chống trùng (tải lại sao kê không nhân đôi) */
  id: string;
  soTk: string;
  nganHang: string;
  /** YYYY-MM-DD */
  ngay: string;
  /** Tiền ra (ghi nợ) */
  ghiNo: number;
  /** Tiền vào (ghi có) */
  ghiCo: number;
  /** Số dư sau giao dịch (0 nếu sao kê không có) */
  soDu: number;
  noiDung: string;
  soRef: string;
  /** Tên bên chuyển (tiền vào) / bên thụ hưởng (tiền ra) — cột riêng của sao kê, '' nếu không có */
  doiTac: string;
  /** Thứ tự trong sao kê, lớn = muộn hơn (sao kê có thể xếp mới → cũ) */
  thuTu: number;
}

const NGAN_HANG: Array<[RegExp, string]> = [
  [/shinhan/, 'Shinhan'],
  [/\bmb ?bank\b|quan doi|military|\bmbb\b/, 'MB'],
  [/\bacb\b|a chau|asia commercial/, 'ACB'],
  [/vp ?bank|viet nam thinh vuong|vietnam prosperity/, 'VPBank'],
  [/vietcombank|ngoai thuong|\bvcb\b/, 'Vietcombank'],
  [/techcombank|ky thuong|\btcb\b/, 'Techcombank'],
  [/bidv|dau tu va phat trien/, 'BIDV'],
  [/vietinbank|cong thuong/, 'VietinBank'],
  [/agribank|nong nghiep/, 'Agribank'],
  [/sacombank|sai gon thuong tin/, 'Sacombank'],
  [/tpbank|tien phong/, 'TPBank'],
];

const COT_SAO_KE: Record<string, (t: string) => boolean> = {
  ngay: (t) =>
    /^(ngay giao dich|ngay gd|ngay hach toan|ngay hieu luc|ngay thuc hien|ngay ghi so|transaction date|trans(action)? ?date|posting date|value date|effective date)/.test(t) ||
    t === 'ngay' ||
    t === 'date' ||
    t.startsWith('ngay/') ||
    t.startsWith('ngay giao'),
  no: (t) =>
    /^(ghi no|so tien ghi no|phat sinh no|tien ra|so tien ra|rut ra|debit|withdrawal|chi ra|no\/debit|no \/ debit)/.test(t) || t === 'no' || t === 'ps no',
  co: (t) =>
    /^(ghi co|so tien ghi co|phat sinh co|tien vao|so tien vao|gui vao|credit|deposit|thu vao|co\/credit|co \/ credit)/.test(t) || t === 'co' || t === 'ps co',
  soTien: (t) => /^(so tien giao dich|so tien|amount|transaction amount)$/.test(t) || t.startsWith('so tien/'),
  soDu: (t) => /^(so du|balance|so du cuoi|so du sau)/.test(t),
  noiDung: (t) => /^(noi dung|dien giai|mo ta|description|chi tiet|remark|transaction detail|giai thich|noi dung giao dich)/.test(t),
  // MB: "ĐƠN VỊ THỤ HƯỞNG/ĐƠN VỊ CHUYỂN". KHÔNG nhận "số tài khoản đối ứng" (là số, không phải tên).
  doiTac: (t) =>
    /^(don vi thu huong|don vi chuyen|don vi doi ung|ten (tai khoan |tk )?doi ung|ten nguoi (chuyen|huong|nhan|thu huong)|nguoi (chuyen|huong|nhan|thu huong)|ben (chuyen|nhan|thu huong)|ten doi tac|doi tac|counterparty|beneficiary|remitter|payee|payer)/.test(t),
  soRef: (t) => /^(so tham chieu|so but toan|ma giao dich|so giao dich|reference|ref|so ct|so chung tu|transaction no|ma gd|so gd|seq)/.test(t),
};

/** File có phải sao kê ngân hàng không (theo tiêu đề / tên cột). */
export function laSaoKe(sheets: SheetDuLieu[]): boolean {
  for (const sh of sheets) {
    const dau = chuanChu(sh.rows.slice(0, 25).map((r) => r.join(' ')).join(' '));
    if (/sao ke|so phu|account statement|statement of account|lich su giao dich|chi tiet giao dich|transaction history/.test(dau)) {
      if (timCot(sh.rows.slice(0, 40), COT_SAO_KE, ['ngay', 'noiDung'])) return true;
    }
    const td = timCot(sh.rows.slice(0, 40), COT_SAO_KE, ['ngay', 'noiDung']);
    if (td && ((td.cot.no !== undefined && td.cot.co !== undefined) || td.cot.soTien !== undefined) && td.cot.soDu !== undefined) return true;
  }
  return false;
}

/** Khoá KHÔNG gồm `doiTac` (cột thêm sau) — tải lại sao kê cũ ra đúng khoá cũ, chỉ điền thêm tên đối tác. */
function khoaGiaoDich(g: Omit<GiaoDich, 'id' | 'thuTu' | 'doiTac'>, thuTu: number): string {
  const nguon = [g.soTk, g.ngay, g.ghiNo, g.ghiCo, g.soDu, g.soRef, chuanChu(g.noiDung).slice(0, 120), g.soRef || g.soDu ? '' : thuTu].join('|');
  return createHash('sha1').update(nguon).digest('hex').slice(0, 24);
}

/** Đọc sao kê: số tài khoản, ngân hàng (từ phần đầu file / tên file), các giao dịch. */
export function docSaoKe(sheets: SheetDuLieu[], tenFile = ''): { nganHang: string; soTk: string; giaoDich: GiaoDich[]; boQua: number } | null {
  for (const sh of sheets) {
    const rows = sh.rows;
    const td = timCot(rows.slice(0, 40), COT_SAO_KE, ['ngay', 'noiDung']);
    if (!td) continue;
    const { cot, dong } = td;
    const haiCot = cot.no !== undefined && cot.co !== undefined;
    if (!haiCot && cot.soTien === undefined) continue;
    const dauChu = rows.slice(0, dong + 1).map((r) => r.join(' ')).join(' ');
    const dau = chuanChu(`${dauChu} ${tenFile}`);
    const nganHang = NGAN_HANG.find(([re]) => re.test(dau))?.[1] || '';
    const mTk = /(so tai khoan|tai khoan so|account (no|number)|so tk|stk)[^0-9]{0,25}(\d[\d .-]{5,22}\d)/.exec(dau);
    const soTk = mTk ? mTk[3]!.replace(/[^\d]/g, '') : /(\d{8,16})/.exec(tenFile)?.[1] || '';
    const giaoDich: GiaoDich[] = [];
    let boQua = 0;
    rows.slice(dong + 1).forEach((r, i) => {
      const o = (k: string) => (cot[k] === undefined ? '' : String(r[cot[k]!] ?? '').trim());
      const ngay = ngayISO(o('ngay'));
      if (!ngay) {
        if (r.some((x) => String(x).trim()) && !/tong|cong|total|so du dau|so du cuoi|opening|closing/.test(chuanChu(r.join(' ')))) boQua++;
        return;
      }
      let ghiNo = 0;
      let ghiCo = 0;
      if (haiCot) {
        ghiNo = Math.abs(soTien(o('no')));
        ghiCo = Math.abs(soTien(o('co')));
      } else {
        const st = soTien(o('soTien'));
        if (st < 0) ghiNo = -st;
        else ghiCo = st;
      }
      if (!ghiNo && !ghiCo) return; // dòng số dư đầu kỳ / phí 0
      const g = { soTk, nganHang, ngay, ghiNo, ghiCo, soDu: soTien(o('soDu')), noiDung: o('noiDung').replace(/\s+/g, ' ').slice(0, 500), soRef: o('soRef').slice(0, 60) };
      giaoDich.push({ id: khoaGiaoDich(g, i), ...g, doiTac: o('doiTac').replace(/\s+/g, ' ').slice(0, 200), thuTu: i });
    });
    // Sao kê xếp mới → cũ thì đảo thứ tự để `thuTu` lớn = muộn hơn.
    if (giaoDich.length > 1 && giaoDich[0]!.ngay > giaoDich[giaoDich.length - 1]!.ngay) {
      giaoDich.forEach((g, k) => (g.thuTu = giaoDich.length - 1 - k));
    }
    if (giaoDich.length) return { nganHang, soTk, giaoDich, boQua };
  }
  return null;
}

// ── Khớp giao dịch với đối tác ──

const TU_CHUNG =
  /\b(cong ty|cty|tnhh|co phan|cp|mtv|mot thanh vien|hai thanh vien|dich vu|thuong mai|tm|dv|tmdv|sx|san xuat|xay dung|xd|dau tu|ho kinh doanh|hkd|chi nhanh|cn|tap doan|tong cong ty|truyen thong|giai phap|cong nghe|quoc te|viet nam|vn|va|ky thuat|thiet bi|the|group|company|co|ltd|jsc|corp)\b/g;

/** Phần riêng trong tên đối tác (bỏ "Công ty TNHH…") để tìm trong nội dung chuyển khoản. */
export function tenRieng(ten: string): string {
  return chuanChu(ten)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(TU_CHUNG, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DoiTacKhop {
  ma: string;
  ten: string;
  mst?: string;
}

// Chỉ bỏ hình thức pháp lý; từ ngành nghề (dịch vụ, thương mại…) giữ lại để ghép cụm như "mt group", nhưng một cụm
// TOÀN từ thông dụng thì không dùng để khớp.
const HINH_THUC =
  /\b(cong ty|cty|tnhh|co phan|cp|mtv|mot thanh vien|hai thanh vien|ho kinh doanh|hkd|chi nhanh|cn|tap doan|tong cong ty|company|co|ltd|jsc|corp)\b/g;
const TU_THONG_DUNG = new Set(
  (
    'thanh toan chuyen khoan tien phi dich vu thuong mai tm dv tmdv san xuat xay dung dau tu truyen thong giai phap cong nghe ' +
    'quoc te viet nam vn va ky thuat thiet bi the quang cao marketing mkt website web thang theo hop dong hd tt ck cty mt ' +
    'digital google facebook ads chay thiet ke noi dung lan dot so ngay nam cho cua ung phan mem seo tiktok kenh cham soc ' +
    'ngan hang nop gui nhan tra lai hoan visa retail thue ngoai quan ly pham hoa tu dong nhan luc giai tri du lich ' +
    'xuat nhap khau sx xd tong hop phat trien kinh doanh moi truong an toan ' +
    // Từ tiếng Anh chung trong tên cửa hàng / công ty — một mình không đủ phân biệt.
    'salon spa shop store studio hotel restaurant cafe coffee clinic academy center centre media agency house home beauty ' +
    'fashion global international logistics solutions solution tech technology software education travel trading service services'
  ).split(' '),
);

/** Có phải MỘT tiếng Việt (không dấu) không: phụ âm đầu + vần + âm cuối. */
function laTiengViet(t: string): boolean {
  return /^(ngh|ng|nh|ch|gh|gi|kh|ph|qu|th|tr|[bcdghklmnpqrstvx])?[aeiouy]{1,3}(ch|ng|nh|[cmnpt])?$/.test(t);
}

interface KhoaDoiTac {
  d: DoiTacKhop;
  mst: string;
  rieng: string;
  /** Cụm 1–3 từ liền nhau trong tên (có dấu cách) — chỉ những cụm KHÔNG đối tác nào khác có */
  cum: Array<{ cach: string; lien: string }>;
}

const chiMucCache = new WeakMap<DoiTacKhop[], KhoaDoiTac[]>();

function chiMuc(ds: DoiTacKhop[]): KhoaDoiTac[] {
  const co = chiMucCache.get(ds);
  if (co) return co;
  const tho = ds.map((d) => {
    // Ngân hàng hay viết tắt địa danh: "TU DONG HOA SG" = "Tự động hoá Sài Gòn".
    const tu = chuanChu(d.ten)
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(HINH_THUC, ' ')
      .replace(/\bsai gon\b/g, 'sg')
      .replace(/\bha noi\b/g, 'hn')
      .replace(/\bho chi minh\b/g, 'hcm')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
    const cum = new Map<string, string>();
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= tu.length; i++) {
        const t = tu.slice(i, i + n);
        const lien = t.join('');
        if (t.every((x) => TU_THONG_DUNG.has(x))) continue;
        // Một từ: chỉ nhận tên kiểu thương hiệu ("topaz", "midori", "sgap") — một tiếng Việt đơn ("phong", "thanh")
        // quá dễ trùng nội dung chuyển khoản. Nhiều từ: cụm ≥ 5 chữ cái.
        if (n === 1 ? lien.length < 4 || laTiengViet(lien) : lien.length < 5) continue;
        cum.set(t.join(' '), lien);
      }
    }
    return { d, mst: (d.mst || (/^\d{10}(-\d{3})?$/.test(d.ma) ? d.ma : '')).replace(/-.*/, ''), rieng: tenRieng(d.ten), cum };
  });
  // Cụm có ở tên của ≥ 2 đối tác (khác MST/tên) thì không phân biệt được → bỏ.
  const dem = new Map<string, Set<string>>();
  // (Cùng một công ty có thể vào danh sách hai lần — mã sổ "KH004" và MST trên hoá đơn — nên đếm theo tên.)
  for (const x of tho) for (const c of x.cum.keys()) dem.set(c, (dem.get(c) || new Set()).add(x.rieng || x.mst));
  const kq = tho.map((x) => ({
    d: x.d,
    mst: x.mst,
    rieng: x.rieng,
    cum: [...x.cum.entries()].filter(([c]) => dem.get(c)!.size === 1).map(([cach, lien]) => ({ cach, lien })),
  }));
  chiMucCache.set(ds, kq);
  return kq;
}

/**
 * Đối tác của một giao dịch (anh Tâm 18/10/2026: "có tên cty mà sao k khớp được"): MST có trong nội dung → chắc chắn;
 * không thì so tên: cả tên riêng ("tu dong tin dat"), hoặc một cụm đặc trưng chỉ đối tác đó có ("topaz", "moc duc",
 * "mt group"), kể cả khi ngân hàng viết liền ("TINDAT") hay ngắt dòng giữa chữ ("MOC LIN H DUONG").
 * `noiDung` nên gồm cả cột tên bên chuyển / thụ hưởng nếu sao kê có. Hai đối tác ngang điểm → không đoán (null).
 */
export function khopDoiTac(noiDung: string, ds: DoiTacKhop[]): DoiTacKhop | null {
  const chu = chuanChu(noiDung).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nd = ` ${chu} `;
  const tuNd = new Set(chu.split(' '));
  const lienNd = chu.replace(/ /g, '');
  const ndSo = noiDung.replace(/[^\d]/g, ' ');
  let tot: { d: DoiTacKhop; diem: number } | null = null;
  let hoa = false;
  for (const k of chiMuc(ds)) {
    if (k.mst && ndSo.includes(k.mst)) return k.d;
    let diem = 0;
    if (k.rieng.length >= 4 && nd.includes(` ${k.rieng} `)) diem = 100 + k.rieng.length;
    else if (k.rieng.replace(/ /g, '').length >= 8 && lienNd.includes(k.rieng.replace(/ /g, ''))) diem = 90 + k.rieng.length;
    for (const c of k.cum) {
      let d = 0;
      if (nd.includes(` ${c.cach} `)) d = c.lien.length + 2;
      else if (tuNd.has(c.lien)) d = c.lien.length + 1; // "TINDAT" = "tin dat" viết liền
      else if (c.lien.length >= 8 && lienNd.includes(c.lien)) d = c.lien.length; // "MOC LIN H DUONG"
      if (d > diem) diem = d;
    }
    if (!diem) continue;
    if (!tot || diem > tot.diem) {
      tot = { d: k.d, diem };
      hoa = false;
    } else if (diem === tot.diem && tenRieng(tot.d.ten) !== k.rieng) hoa = true;
  }
  return tot && !hoa ? tot.d : null;
}

/**
 * Loại tiền VÀO không phải khách trả (không đưa vào "chưa khớp"): lãi tiền gửi, tiền thẻ hoàn về (Google Ads hoàn…),
 * chuyển nội bộ từ chính tài khoản công ty.
 */
export function loaiTienVao(g: Pick<GiaoDich, 'noiDung' | 'doiTac'>): 'lai' | 'hoan_the' | 'noi_bo' | 'khach' {
  const nd = chuanChu(g.noiDung);
  if (/tra lai tien gui|lai tien gui|lai nhap goc|tra lai tk|interest/.test(nd)) return 'lai';
  if (/^retail(visa|master|jcb)|hoan tien the|hoan tra the|refund|reversal|hoan phi/.test(nd)) return 'hoan_the';
  if (/\bmt digital\b/.test(chuanChu(g.doiTac || '')) && !/\b(group|media|agency)\b/.test(chuanChu(g.doiTac || ''))) return 'noi_bo';
  return 'khach';
}

/** Số hoá đơn ghi trong nội dung chuyển khoản: "HD 115", "HD85", "HĐ số 121", "hoa don 0099" → ['115', '85', …] (bỏ số 0 đầu). */
export function soHoaDonTrongNoiDung(noiDung: string): string[] {
  const ra = new Set<string>();
  for (const m of chuanChu(noiDung).matchAll(/\b(?:hd|hoa don)\s*(?:so\s*)?(\d{1,7})\b/g)) {
    const so = m[1]!.replace(/^0+/, '');
    if (so) ra.add(so);
  }
  return [...ra];
}

// ── Khớp tiền với hoá đơn; hoá đơn trả tiền mặt ──

const lui = (ngay: string, ngayLui: number) => new Date(Date.parse(ngay) - ngayLui * 86400_000).toISOString().slice(0, 10);
const boSo0 = (s: string) => s.replace(/[^\d]/g, '').replace(/^0+/, '');

/**
 * Hoá đơn ứng với một khoản tiền khi tên không khớp: số hoá đơn ghi trong nội dung ("HD 115") + đúng số tiền (hoặc chỉ
 * một hoá đơn mang số đó — trả một phần); không có số thì các hoá đơn trong 10 ngày trước đúng bằng số tiền, cùng một bên.
 */
export function hoaDonCuaGiaoDich(g: Pick<GiaoDich, 'ngay' | 'noiDung'>, soTien: number, hd: HoaDon[]): HoaDon | null {
  const truoc = hd.filter((h) => h.ngay <= g.ngay && h.ngay >= lui(g.ngay, 400));
  const so = soHoaDonTrongNoiDung(g.noiDung);
  if (so.length) {
    const ung = truoc.filter((h) => so.includes(boSo0(h.soHd)));
    const dungTien = ung.filter((h) => Math.abs(h.tongTien - soTien) <= 1000);
    if (dungTien.length === 1) return dungTien[0]!;
    if (ung.length === 1 && soTien <= ung[0]!.tongTien + 1000) return ung[0]!;
  }
  const bang = truoc.filter((h) => h.ngay >= lui(g.ngay, 10) && Math.abs(h.tongTien - soTien) <= 1);
  const cungBen = bang.length > 0 && bang.every((h) => (h.mstDoiTac || h.tenDoiTac) === (bang[0]!.mstDoiTac || bang[0]!.tenDoiTac));
  return cungBen ? bang[0]! : null;
}

/** Hoá đơn đầu vào dưới mức này mà không thấy chuyển khoản → coi như đã trả tiền mặt. */
export const NGUONG_TIEN_MAT = 5_000_000;

/**
 * Hoá đơn đầu vào sau ngày chốt coi như ĐÃ TRẢ TIỀN MẶT (anh Tâm 18/10/2026: "thường dưới 5 triệu mà mình chưa trả qua
 * tài khoản mặc định mình đã thanh toán tiền mặt"): anh đánh dấu "tiền mặt", hoặc dưới 5 triệu và nhà cung cấp đó không
 * có khoản chuyển khoản nào sau chốt (có thì để sao kê trừ, tránh trừ hai lần). Anh đánh dấu "ngân hàng" thì không bao
 * giờ coi là tiền mặt.
 */
export function tienMatSauChot(hoaDon: HoaDon[], chot: string, khopNganHang: ThanhToanDoiTac[]): ThanhToanDoiTac[] {
  if (!chot) return [];
  const coCk = new Set<string>();
  for (const t of khopNganHang) {
    if (t.mst) coCk.add(t.mst);
    coCk.add(chuanChu(t.ten));
  }
  const ra: ThanhToanDoiTac[] = [];
  for (const h of hoaDon) {
    if (h.huong !== 'vao' || !hoaDonHieuLuc(h.trangThai) || h.ngay <= chot || h.thanhToan === 'ngan_hang') continue;
    const daCk = (!!h.mstDoiTac && coCk.has(h.mstDoiTac)) || coCk.has(chuanChu(h.tenDoiTac));
    if (h.thanhToan === 'tien_mat' || (h.tongTien < NGUONG_TIEN_MAT && !daCk)) {
      ra.push({ mst: h.mstDoiTac, ten: h.tenDoiTac, soTien: h.tongTien, tienMat: true });
    }
  }
  return ra;
}

