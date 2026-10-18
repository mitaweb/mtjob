// AI đọc file kế toán lạ (anh Tâm 18/10/2026: "ở phần upload file này em cho AI vào đọc file luôn đỡ phải setup định
// dạng"). AI chỉ xem PHẦN ĐẦU file (đã che số dài: CCCD, số tài khoản) rồi trả "bản đồ": loại file, sheet, dòng bắt đầu dữ
// liệu, cột nào là gì. Các hàm THUẦN ở đây đọc TOÀN BỘ file theo bản đồ đó — số tiền lấy nguyên từ file, AI không
// chép lại số nên không sai chữ số.
import { soTien, ngayISO, quyCuaNgay, khoaHoaDon, chuanChu, type HoaDon, type Huong, type SheetDuLieu, type SoCongNo, type BaoCaoKqkd } from './keToan.js';
import type { GiaoDich } from './saoKe.js';
import { createHash } from 'node:crypto';

export type LoaiAi = 'hoa_don' | 'sao_ke' | 'cong_no' | 'kqkd' | 'bang_luong' | 'khac';

/** Bản đồ AI trả về cho một sheet. Cột = chỉ số (0 = cột A); -1 / thiếu = không có. */
export interface BanDoSheet {
  sheet: string;
  /** Dòng (0 = dòng đầu) bắt đầu có dữ liệu, sau các dòng tiêu đề */
  dongDuLieu: number;
  /** Hoá đơn: 'ra' bán ra / 'vao' mua vào */
  huong?: string;
  cot: Record<string, number | number[]>;
}

export interface BanDoAi {
  loai: LoaiAi;
  moTa: string;
  bang: BanDoSheet[];
  // Sao kê
  nganHang?: string;
  soTk?: string;
  // Công nợ
  loaiCongNo?: string;
  ngayChot?: string;
  tuNgay?: string;
  denNgay?: string;
  // Bảng lương: năm của các tháng ghi dạng "T01"
  nam?: number;
  // Báo cáo kết quả kinh doanh — vài con số AI đọc thẳng (ít, có đối chiếu)
  doanhThu?: number;
  loiNhuanTruocThue?: number;
}

/** Che dãy số dài (≥ 9 chữ số liền, kể cả có dấu cách / chấm xen giữa CCCD / STK) trước khi gửi AI. */
export function cheSoDai(s: string): string {
  return String(s ?? '').replace(/\d[\d .-]{7,}\d/g, (m) => {
    const so = m.replace(/[^\d]/g, '');
    // Số tiền dạng 1,234,567 / 1.234.567 thì giữ (AI cần thấy cột tiền); còn lại ≥ 9 chữ số là mã định danh → che.
    if (/^\d{1,3}([.,]\d{3})+([.,]\d+)?$/.test(m.trim())) return m;
    return so.length >= 9 ? '#'.repeat(Math.min(so.length, 12)) : m;
  });
}

/** Phần đầu các sheet cho AI xem: "[sheet] (n dòng)" + "dòng i: c0 | c1 | …" (ô cắt ngắn, số dài đã che). */
export function xemTruoc(sheets: SheetDuLieu[], soDong = 30): string {
  return sheets
    .filter((s) => s.rows.some((r) => r.some((x) => String(x).trim())))
    .slice(0, 10)
    .map((s) => {
      const dong = s.rows.slice(0, soDong).map((r, i) => {
        const o = r.slice(0, 40).map((x) => cheSoDai(String(x ?? '').replace(/\s+/g, ' ').trim()).slice(0, 32));
        while (o.length && !o[o.length - 1]) o.pop();
        return `dòng ${i}: ${o.map((x, j) => `[${j}]${x}`).join(' | ')}`;
      });
      return `### SHEET "${s.ten}" (${s.rows.length} dòng)\n${dong.join('\n')}`;
    })
    .join('\n\n')
    .slice(0, 28_000);
}

const cotSo = (c: number | number[] | undefined): number => (typeof c === 'number' && c >= 0 ? c : -1);
const cacCot = (c: number | number[] | undefined): number[] =>
  (Array.isArray(c) ? c : typeof c === 'number' ? [c] : []).filter((x) => Number.isInteger(x) && x >= 0);

function oCua(r: string[], c: number | number[] | undefined): string {
  const i = cotSo(c);
  return i < 0 ? '' : String(r[i] ?? '').trim();
}

function sheetCua(sheets: SheetDuLieu[], ten: string): SheetDuLieu | undefined {
  return sheets.find((s) => s.ten === ten) || sheets.find((s) => chuanChu(s.ten) === chuanChu(ten));
}

/** Hoá đơn theo bản đồ (cột: ngay, kyHieu, soHd, mauSo, mst, ten, dienGiai, tienHang, tienThue, tongTien, thueSuat, trangThai). */
export function hoaDonTheoBanDo(sheets: SheetDuLieu[], bd: BanDoAi): HoaDon[] {
  const theoKhoa = new Map<string, HoaDon>();
  for (const b of bd.bang) {
    const sh = sheetCua(sheets, b.sheet);
    const huong: Huong | null = b.huong === 'ra' ? 'ra' : b.huong === 'vao' ? 'vao' : null;
    if (!sh || !huong) continue;
    for (const r of sh.rows.slice(Math.max(0, b.dongDuLieu))) {
      const soHd = oCua(r, b.cot.soHd);
      const ngay = ngayISO(oCua(r, b.cot.ngay));
      if (!soHd || !/\d/.test(soHd) || !ngay) continue;
      let mauSo = oCua(r, b.cot.mauSo);
      let kyHieu = oCua(r, b.cot.kyHieu).replace(/\s/g, '');
      const dinh = /^(\d)([A-Z]\d{2}[A-Z]{2,4})$/i.exec(kyHieu);
      if (!mauSo && dinh) {
        mauSo = dinh[1]!;
        kyHieu = dinh[2]!;
      }
      const tienHang = soTien(oCua(r, b.cot.tienHang));
      const tienThue = soTien(oCua(r, b.cot.tienThue));
      const h: HoaDon = {
        huong,
        mauSo: mauSo || '1',
        kyHieu,
        soHd: String(Number(soHd) || soHd),
        ngay,
        mstDoiTac: oCua(r, b.cot.mst).replace(/\s/g, ''),
        tenDoiTac: oCua(r, b.cot.ten),
        dienGiai: oCua(r, b.cot.dienGiai).slice(0, 500),
        tienHang,
        tienThue,
        tongTien: soTien(oCua(r, b.cot.tongTien)) || tienHang + tienThue,
        thueSuat: oCua(r, b.cot.thueSuat),
        trangThai: oCua(r, b.cot.trangThai) || 'Hóa đơn mới',
        kyKeKhai: quyCuaNgay(ngay),
      };
      const k = khoaHoaDon(h);
      const cu = theoKhoa.get(k);
      if (cu) {
        cu.tienHang += h.tienHang;
        cu.tienThue += h.tienThue;
        cu.tongTien += h.tongTien;
      } else theoKhoa.set(k, h);
    }
  }
  return [...theoKhoa.values()];
}

/** Giao dịch ngân hàng theo bản đồ (cột: ngay, noiDung, no, co, soTien, soDu, soRef). */
export function giaoDichTheoBanDo(sheets: SheetDuLieu[], bd: BanDoAi): GiaoDich[] {
  const ra: GiaoDich[] = [];
  const soTk = String(bd.soTk || '').replace(/[^\d]/g, '');
  const nganHang = String(bd.nganHang || '').slice(0, 40);
  for (const b of bd.bang) {
    const sh = sheetCua(sheets, b.sheet);
    if (!sh) continue;
    const haiCot = cotSo(b.cot.no) >= 0 && cotSo(b.cot.co) >= 0;
    const ds: GiaoDich[] = [];
    sh.rows.slice(Math.max(0, b.dongDuLieu)).forEach((r, i) => {
      const ngay = ngayISO(oCua(r, b.cot.ngay));
      if (!ngay) return;
      let ghiNo = 0;
      let ghiCo = 0;
      if (haiCot) {
        ghiNo = Math.abs(soTien(oCua(r, b.cot.no)));
        ghiCo = Math.abs(soTien(oCua(r, b.cot.co)));
      } else {
        const st = soTien(oCua(r, b.cot.soTien));
        if (st < 0) ghiNo = -st;
        else ghiCo = st;
      }
      if (!ghiNo && !ghiCo) return;
      const g = { soTk, nganHang, ngay, ghiNo, ghiCo, soDu: soTien(oCua(r, b.cot.soDu)), noiDung: oCua(r, b.cot.noiDung).replace(/\s+/g, ' ').slice(0, 500), soRef: oCua(r, b.cot.soRef).slice(0, 60) };
      const nguon = [g.soTk, g.ngay, g.ghiNo, g.ghiCo, g.soDu, g.soRef, chuanChu(g.noiDung).slice(0, 120), g.soRef || g.soDu ? '' : i].join('|');
      ds.push({ id: createHash('sha1').update(nguon).digest('hex').slice(0, 24), ...g, doiTac: oCua(r, b.cot.doiTac).replace(/s+/g, ' ').slice(0, 200), thuTu: i });
    });
    if (ds.length > 1 && ds[0]!.ngay > ds[ds.length - 1]!.ngay) ds.forEach((g, k) => (g.thuTu = ds.length - 1 - k));
    ra.push(...ds);
  }
  return ra;
}

/** Sổ công nợ theo bản đồ (cột: ma, ten, duNo, duCo — số dư CUỐI kỳ). */
export function congNoTheoBanDo(sheets: SheetDuLieu[], bd: BanDoAi): SoCongNo | null {
  const loai = bd.loaiCongNo === 'tra' ? 'tra' : bd.loaiCongNo === 'thu' ? 'thu' : null;
  const ngayChot = ngayISO(bd.ngayChot || '');
  if (!loai || !ngayChot) return null;
  const dong: SoCongNo['dong'] = [];
  for (const b of bd.bang) {
    const sh = sheetCua(sheets, b.sheet);
    if (!sh) continue;
    for (const r of sh.rows.slice(Math.max(0, b.dongDuLieu))) {
      const ten = oCua(r, b.cot.ten);
      const ma = oCua(r, b.cot.ma) || ten;
      if (!ten || /^(tong|cong|so dong)/.test(chuanChu(ma))) continue;
      const duNo = soTien(oCua(r, b.cot.duNo));
      const duCo = soTien(oCua(r, b.cot.duCo));
      dong.push({ ma, ten, duNoDau: 0, duCoDau: 0, psNo: 0, psCo: 0, duNo, duCo });
    }
  }
  return dong.length ? { loai, tuNgay: ngayISO(bd.tuNgay || '') || `${ngayChot.slice(0, 4)}-01-01`, ngayChot, dong } : null;
}

export interface LuongThang {
  /** YYYY-MM */
  thang: string;
  soNguoi: number;
  /** Tổng thu nhập (lương + phụ cấp + thưởng) — chi phí lương */
  tongThuNhap: number;
  /** BHXH / BHYT / BHTN công ty đóng — chi phí */
  bhxhCty: number;
  /** BHXH người lao động đóng (trừ vào lương) */
  bhxhNld: number;
  tncn: number;
  thucNhan: number;
}

/** Tháng của một ô: "T01" / "01/2026" / "Tháng 1" / ngày → "YYYY-MM" (năm lấy từ bản đồ khi ô không có năm). */
export function thangCua(o: string, nam?: number): string {
  const s = chuanChu(o);
  let m = /(\d{1,2})[/.-](\d{4})/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
  const d = ngayISO(o);
  if (d) return d.slice(0, 7);
  m = /^(?:t|thang)\s*0?(\d{1,2})\b/.exec(s);
  if (m && nam && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${nam}-${m[1]!.padStart(2, '0')}`;
  return '';
}

/** Bảng lương theo bản đồ (cột: thang, ten, tongThuNhap, bhxhCty[], bhxhNld[], tncn, thucNhan) → cộng theo tháng. */
export function luongTheoBanDo(sheets: SheetDuLieu[], bd: BanDoAi): LuongThang[] {
  const m = new Map<string, LuongThang>();
  for (const b of bd.bang) {
    const sh = sheetCua(sheets, b.sheet);
    if (!sh) continue;
    for (const r of sh.rows.slice(Math.max(0, b.dongDuLieu))) {
      const ten = oCua(r, b.cot.ten);
      const thang = thangCua(oCua(r, b.cot.thang), bd.nam);
      const tongThuNhap = soTien(oCua(r, b.cot.tongThuNhap));
      if (!ten || !thang || !tongThuNhap || /^(tong|cong)/.test(chuanChu(ten))) continue;
      const x = m.get(thang) || { thang, soNguoi: 0, tongThuNhap: 0, bhxhCty: 0, bhxhNld: 0, tncn: 0, thucNhan: 0 };
      x.soNguoi++;
      x.tongThuNhap += tongThuNhap;
      x.bhxhCty += cacCot(b.cot.bhxhCty).reduce((s, c) => s + soTien(r[c]), 0);
      x.bhxhNld += cacCot(b.cot.bhxhNld).reduce((s, c) => s + soTien(r[c]), 0);
      x.tncn += soTien(oCua(r, b.cot.tncn));
      x.thucNhan += soTien(oCua(r, b.cot.thucNhan));
      m.set(thang, x);
    }
  }
  return [...m.values()].sort((a, c) => a.thang.localeCompare(c.thang));
}

/** Báo cáo kết quả kinh doanh từ số AI đọc thẳng (chỉ 2 con số chính). */
export function kqkdTheoBanDo(bd: BanDoAi): BaoCaoKqkd | null {
  const tuNgay = ngayISO(bd.tuNgay || '');
  const denNgay = ngayISO(bd.denNgay || '');
  if (!tuNgay || !denNgay || bd.loiNhuanTruocThue === undefined) return null;
  const chiTieu: Record<string, number> = { '50': Math.round(Number(bd.loiNhuanTruocThue) || 0) };
  if (bd.doanhThu !== undefined) chiTieu['01'] = Math.round(Number(bd.doanhThu) || 0);
  return { tuNgay, denNgay, chiTieu };
}
