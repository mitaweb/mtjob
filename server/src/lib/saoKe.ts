// Sao kê ngân hàng (anh Tâm 18/10/2026: "1 phần tải sao kê ngân hàng lên nữa là đủ"). Hàm THUẦN: đọc file Excel sao kê
// (Shinhan, MB, ACB, VPBank… — mỗi ngân hàng một mẫu, nhận theo tên cột), khớp giao dịch với đối tác, và dùng tiền đã
// thu / đã trả SAU ngày chốt sổ để trừ công nợ.
import { createHash } from 'node:crypto';
import { chuanChu, ngayISO, soTien, timCot, type SheetDuLieu } from './keToan.js';

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

function khoaGiaoDich(g: Omit<GiaoDich, 'id' | 'thuTu'>, thuTu: number): string {
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
      giaoDich.push({ id: khoaGiaoDich(g, i), ...g, thuTu: i });
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

/** Đối tác của một giao dịch: MST có trong nội dung, hoặc phần tên riêng (dài nhất) có trong nội dung. */
export function khopDoiTac(noiDung: string, ds: DoiTacKhop[]): DoiTacKhop | null {
  const nd = ` ${chuanChu(noiDung).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ')} `;
  const ndSo = noiDung.replace(/[^\d]/g, ' ');
  let tot: { d: DoiTacKhop; diem: number } | null = null;
  for (const d of ds) {
    const mst = (d.mst || (/^\d{10}(-\d{3})?$/.test(d.ma) ? d.ma : '')).replace(/-.*/, '');
    if (mst && ndSo.includes(mst)) return d;
    const r = tenRieng(d.ten);
    if (r.length < 4) continue;
    // Cả cụm tên riêng; tên dài (≥ 3 từ) thì chấp nhận 2 từ đầu liền nhau.
    const tu = r.split(' ');
    const cum = [r, ...(tu.length >= 3 ? [tu.slice(0, 2).join(' ')] : [])];
    for (const c of cum) {
      if (c.length >= 4 && nd.includes(` ${c} `)) {
        const diem = c.length + (c === r ? 100 : 0);
        if (!tot || diem > tot.diem) tot = { d, diem };
        break;
      }
    }
  }
  return tot?.d || null;
}
