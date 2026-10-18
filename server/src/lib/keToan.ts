// Kế toán thuế (anh Tâm 18/10/2026: "update hóa đơn, update con số để nắm được chỉ số quan trọng: Thuế VAT cần đóng,
// Thuế TNDN cần đóng, 3 năm 2024, 2025, 2026 anh được miễn thuế TNDN. Và công nợ các bên").
//
// Hàm THUẦN: nhận dạng & đọc các file kế toán gửi (bảng kê MV-BR, hoá đơn XML TT78, tờ khai 01/GTGT XML, tổng hợp
// công nợ 131/331, báo cáo kết quả kinh doanh B02-DN) và tính VAT / TNDN / công nợ. Không gọi DB, không gọi mạng.

export type Huong = 'ra' | 'vao';

export interface HoaDon {
  huong: Huong;
  mauSo: string;
  kyHieu: string;
  soHd: string;
  /** YYYY-MM-DD */
  ngay: string;
  mstDoiTac: string;
  tenDoiTac: string;
  dienGiai: string;
  tienHang: number;
  tienThue: number;
  tongTien: number;
  thueSuat: string;
  trangThai: string;
  /** Kỳ kê khai thực tế "YYYY-Qn" (kế toán có thể kê hoá đơn muộn sang quý sau). */
  kyKeKhai: string;
  /** Khoá trong DB (chỉ có khi đọc từ DB) */
  khoa?: string;
  /** Anh đánh dấu: '' (tự xét) | 'tien_mat' | 'ngan_hang' */
  thanhToan?: string;
}

export interface ToKhaiGtgt {
  /** "YYYY-Qn" (hoặc "YYYY-Mm" nếu khai tháng) */
  ky: string;
  /** C = chính thức, B = bổ sung */
  loai: string;
  soLan: number;
  ngayLap: string;
  mst: string;
  ct: Record<string, number>;
}

export interface DongCongNo {
  ma: string;
  ten: string;
  duNoDau: number;
  duCoDau: number;
  psNo: number;
  psCo: number;
  duNo: number;
  duCo: number;
}

export interface SoCongNo {
  /** 'thu' = phải thu (TK 131), 'tra' = phải trả (TK 331) */
  loai: 'thu' | 'tra';
  tuNgay: string;
  /** Ngày chốt số dư (YYYY-MM-DD) */
  ngayChot: string;
  dong: DongCongNo[];
}

export interface BaoCaoKqkd {
  tuNgay: string;
  denNgay: string;
  /**
   * Theo mã số chỉ tiêu B02-DN: '01' doanh thu, '10' doanh thu thuần, '50' LN kế toán trước thuế, '51' thuế TNDN…
   * Báo cáo kế toán gửi (thư / ảnh) thêm: 'cpktd' chi phí KHÔNG được trừ khi tính thuế, 'lntt' lợi nhuận tính thuế
   * kế toán ghi (để đối chiếu với số tự tính).
   */
  chiTieu: Record<string, number>;
  /** 'kqkd' = báo cáo B02-DN; 'ke_toan' = số kế toán báo qua thư / ảnh (có tách chi phí không được trừ) */
  nguon?: 'kqkd' | 'ke_toan';
}

// ── Chuẩn hoá ──

/** "590,637,038.00" / "6.000.000" / "(1,000)" / "-" / 1234 → số. Lỗi → 0. */
export function soTien(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  let s = String(v ?? '').trim();
  if (!s || s === '-' || s === '—') return 0;
  let am = false;
  if (/^\(.*\)$/.test(s)) {
    am = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('+')) s = s.slice(1).trim(); // sao kê ngân hàng: "+1,000,000"
  if (s.startsWith('-')) {
    am = !am;
    s = s.slice(1);
  }
  s = s.replace(/\s|đ|vnd/gi, '');
  // "1.234.567" (dấu chấm ngăn nghìn) — không có phẩy, nhiều chấm hoặc đúng nhóm 3 số
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(am ? -n : n);
}

/** "01/04/2026" / "1/4/2026" / "2026-04-01" → "2026-04-01". Không đọc được → ''. */
export function ngayISO(v: unknown): string {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return '';
}

/** Quý của một ngày "YYYY-MM-DD" → "YYYY-Qn". */
export function quyCuaNgay(ngay: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ngay);
  if (!m) return '';
  return `${m[1]}-Q${Math.ceil(Number(m[2]) / 3)}`;
}

/** Bỏ dấu, thường hoá, gọn khoảng trắng — để so tiêu đề cột. */
export function chuanChu(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const laMst = (s: string) => /^\d{10}(-\d{3})?$|^\d{12}$/.test(s.trim());

/** Hoá đơn bị huỷ / bị thay thế → không tính vào số liệu (hoá đơn thay thế / điều chỉnh vẫn tính). */
export function hoaDonHieuLuc(trangThai: string): boolean {
  const t = chuanChu(trangThai);
  return !/huy|bi thay the|da bi thay the/.test(t);
}

/** Khoá chống trùng: hoá đơn bán ra theo ký hiệu + số (dãy của mình); mua vào thêm MST người bán. */
export function khoaHoaDon(h: Pick<HoaDon, 'huong' | 'mauSo' | 'kyHieu' | 'soHd' | 'mstDoiTac'>): string {
  const so = String(Number(h.soHd) || h.soHd).trim();
  const kh = `${h.mauSo}${h.kyHieu}`.toUpperCase().replace(/\s/g, '');
  return h.huong === 'ra' ? `ra|${kh}|${so}` : `vao|${h.mstDoiTac.trim()}|${kh}|${so}`;
}

// ── Nhận dạng file bảng ──

export interface SheetDuLieu {
  ten: string;
  rows: string[][];
}

export type LoaiBang = 'bang_ke' | 'cong_no_thu' | 'cong_no_tra' | 'kqkd';

export function nhanDangBang(sheets: SheetDuLieu[]): LoaiBang | null {
  const dau = (sh: SheetDuLieu) => chuanChu(sh.rows.slice(0, 12).map((r) => r.join(' ')).join(' '));
  for (const sh of sheets) {
    const d = dau(sh);
    if (d.includes('bang ke chi tiet hoa don') || (/ban ra|mua vao/.test(chuanChu(sh.ten)) && d.includes('so hoa don'))) return 'bang_ke';
    // Excel xuất từ cổng hoá đơn điện tử: "DANH SÁCH HÓA ĐƠN …", cột "MST người bán" / "MST người mua".
    if (d.includes('so hoa don') && (d.includes('danh sach hoa don') || /(mst|ma so thue) nguoi (ban|mua)/.test(d))) return 'bang_ke';
    if (d.includes('tong hop cong no phai thu') || (d.includes('cong no') && /tai khoan: ?131/.test(d))) return 'cong_no_thu';
    if (d.includes('tong hop cong no phai tra') || (d.includes('cong no') && /tai khoan: ?331/.test(d))) return 'cong_no_tra';
    if (d.includes('ket qua hoat dong kinh doanh')) return 'kqkd';
  }
  return null;
}

/**
 * Tìm tiêu đề có đủ các cột cần (theo từ khoá đã bỏ dấu) → chỉ số cột cho từng khoá. Tiêu đề có thể trải trên 2 dòng
 * (ô gộp: dòng trên "Ký hiệu hoá đơn" / "HOÁ ĐƠN", dòng dưới tên các cột tiền) — xét gộp dòng i và i+1.
 * Trả `dong` = dòng tiêu đề cuối cùng (dữ liệu bắt đầu ngay sau).
 */
export function timCot(rows: string[][], can: Record<string, (t: string) => boolean>, batBuoc: string[]): { dong: number; cot: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    for (const soDong of [1, 2]) {
      const cot: Record<string, number> = {};
      let dungDong2 = false;
      let dungDong1 = false;
      for (let d = 0; d < soDong; d++) {
        (rows[i + d] || []).forEach((o, j) => {
          const t = chuanChu(o);
          if (!t) return;
          for (const [k, f] of Object.entries(can)) {
            if (cot[k] === undefined && f(t)) {
              cot[k] = j;
              if (d === 1) dungDong2 = true;
              else dungDong1 = true;
            }
          }
        });
      }
      if (batBuoc.every((k) => cot[k] !== undefined)) {
        // Gộp 2 dòng chỉ khi dòng trên CÓ tên cột (không phải dòng "Từ ngày … đến ngày …" đứng trên tiêu đề).
        if (soDong === 2) {
          if (!dungDong1) continue;
          return { dong: i + (dungDong2 ? 1 : 0), cot };
        }
        // Dòng dưới vẫn là tiêu đề (có chữ, không có ngày, ô đầu không phải số thứ tự): lấy thêm cột còn thiếu ở đó
        // (mẫu cổng thuế: "Thông tin hóa đơn" ở trên, "MST người bán" ở dưới) và bỏ qua dòng đó khi đọc dữ liệu.
        const duoi = rows[i + 1] || [];
        const duoiLaTieuDe =
          duoi.some((x) => /[a-zA-ZÀ-ỹ]/.test(String(x))) &&
          !duoi.some((x) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(String(x))) &&
          !/^\d+$/.test(String(duoi[0] ?? '').trim());
        if (!duoiLaTieuDe) return { dong: i, cot };
        let them = false;
        duoi.forEach((o, j) => {
          const t = chuanChu(o);
          if (!t) return;
          for (const [k, f] of Object.entries(can)) {
            if (cot[k] === undefined && f(t)) {
              cot[k] = j;
              them = true;
            }
          }
        });
        return { dong: i + (them || chuanChu(duoi[0]) === chuanChu(rows[i]![0]) ? 1 : 0), cot };
      }
    }
  }
  return null;
}

// ── Bảng kê MV-BR (mẫu của kế toán: sheet "BAN RA" / "MUA VAO") ──

export function docBangKe(sheets: SheetDuLieu[]): { hoaDon: HoaDon[]; boQua: number } {
  const theoKhoa = new Map<string, HoaDon>();
  let boQua = 0;
  for (const sh of sheets) {
    const tenSh = chuanChu(sh.ten);
    const dauSh = chuanChu(sh.rows.slice(0, 12).map((r) => r.join(' ')).join(' '));
    const huong: Huong | null = /ban ra|\bbr\b/.test(tenSh) || dauSh.includes('ban ra')
      ? 'ra'
      : /mua vao|\bmv\b/.test(tenSh) || dauSh.includes('mua vao')
        ? 'vao'
        : null;
    const huongTheoCot: Huong | null = /(mst|ma so thue|thong tin) nguoi ban/.test(dauSh)
      ? 'vao'
      : /(mst|ma so thue|thong tin) nguoi mua/.test(dauSh)
        ? 'ra'
        : null;
    const huongSh = huong || huongTheoCot;
    if (!huongSh) continue;
    const td = timCot(
      sh.rows,
      {
        mauSo: (t) => t.includes('mau so'),
        kyHieu: (t) => t.startsWith('ky hieu hoa don') || t === 'ky hieu',
        soHd: (t) => t.startsWith('so hoa don'),
        ngay: (t) => t.startsWith('ngay hoa don') || t === 'ngay lap',
        mst: (t) => t.startsWith('ma so thue') || t.startsWith('mst'),
        ten: (t) => t.startsWith('ten khach hang') || t.startsWith('ten nguoi ban') || t.startsWith('ten nguoi mua'),
        dienGiai: (t) => t.startsWith('dien giai') || t.startsWith('mat hang'),
        tienHang: (t) => t.includes('chua gom thue') || t.includes('chua vat') || t.includes('chua thue'),
        tienThue: (t) => (t.includes('thue gtgt') || t === 'tien thue' || t.startsWith('tong tien thue')) && !t.includes('suat'),
        tongTien: (t) =>
          t.includes('thanh toan') || (t.startsWith('tong tien') && !/chua|thue|chiet khau|phi/.test(t)),
        thueSuat: (t) => t.startsWith('thue suat'),
        trangThai: (t) => t.startsWith('tinh trang') || t.startsWith('trang thai hoa don'),
        nam: (t) => t === 'nam',
        quy: (t) => t.startsWith('thang/quy') || t === 'quy',
      },
      ['kyHieu', 'soHd', 'ngay', 'tienHang', 'tienThue'],
    );
    if (!td) continue;
    const { dong, cot } = td;
    for (const r of sh.rows.slice(dong + 1)) {
      const o = (k: string) => (cot[k] === undefined ? '' : String(r[cot[k]!] ?? '').trim());
      const soHd = o('soHd');
      const ngay = ngayISO(o('ngay'));
      if (!soHd || !/\d/.test(soHd) || !ngay) {
        if (r.some((x) => String(x).trim()) && !r.some((x) => chuanChu(x).startsWith('tong cong'))) boQua++;
        continue;
      }
      const nam = o('nam');
      const quy = /(\d)/.exec(o('quy'))?.[1];
      const kyKeKhai = /^\d{4}$/.test(nam) && quy ? `${nam}-Q${quy}` : quyCuaNgay(ngay);
      let mauSo = o('mauSo');
      let kyHieu = o('kyHieu').replace(/\s/g, '');
      const dinh = /^(\d)([A-Z]\d{2}[A-Z]{2,4})$/i.exec(kyHieu);
      if (!mauSo && dinh) {
        mauSo = dinh[1]!;
        kyHieu = dinh[2]!;
      }
      const h: HoaDon = {
        huong: huongSh,
        mauSo: mauSo || '1',
        kyHieu,
        soHd: String(Number(soHd) || soHd),
        ngay,
        mstDoiTac: o('mst').replace(/\s/g, ''),
        tenDoiTac: o('ten'),
        dienGiai: o('dienGiai'),
        tienHang: soTien(o('tienHang')),
        tienThue: soTien(o('tienThue')),
        tongTien: soTien(o('tongTien')),
        thueSuat: o('thueSuat'),
        trangThai: o('trangThai') || 'Hóa đơn mới',
        kyKeKhai,
      };
      if (!h.tongTien) h.tongTien = h.tienHang + h.tienThue;
      // Một hoá đơn nhiều dòng (nhiều thuế suất / nhiều mặt hàng) → cộng dồn.
      const k = khoaHoaDon(h);
      const cu = theoKhoa.get(k);
      if (cu) {
        cu.tienHang += h.tienHang;
        cu.tienThue += h.tienThue;
        cu.tongTien += h.tongTien;
        if (h.thueSuat && !cu.thueSuat.split(',').includes(h.thueSuat)) cu.thueSuat = [cu.thueSuat, h.thueSuat].filter(Boolean).join(',');
        if (h.dienGiai && !cu.dienGiai.includes(h.dienGiai)) cu.dienGiai = `${cu.dienGiai}; ${h.dienGiai}`.slice(0, 500);
      } else theoKhoa.set(k, h);
    }
  }
  return { hoaDon: [...theoKhoa.values()], boQua };
}

// ── Tổng hợp công nợ (TK 131 phải thu / 331 phải trả) ──

export function docCongNo(sheets: SheetDuLieu[], loai: 'thu' | 'tra', tenFile = ''): SoCongNo | null {
  for (const sh of sheets) {
    const dau = sh.rows.slice(0, 6).map((r) => r.join(' ')).join(' ');
    const m = /t[ừu]\s*ng[àa]y\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*đ[ếe]n\s*ng[àa]y\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(dau);
    let tuNgay = m ? ngayISO(m[1]) : '';
    let ngayChot = m ? ngayISO(m[2]) : '';
    if (!ngayChot) {
      const f = /(\d{1,2})[._-](\d{1,2})[._-](\d{4})/.exec(tenFile);
      if (f) ngayChot = ngayISO(`${f[1]}/${f[2]}/${f[3]}`);
    }
    // Tiêu đề 2 tầng: "Mã | Tên | TK | Số dư đầu kỳ | | Phát sinh | | Số dư cuối kỳ" rồi "Nợ | Có | …".
    const i = sh.rows.findIndex((r) => chuanChu(r[0]).startsWith('ma ') && r.some((x) => chuanChu(x).includes('cuoi ky')));
    if (i < 0 || !ngayChot) continue;
    const dong: DongCongNo[] = [];
    for (const r of sh.rows.slice(i + 2)) {
      const ma = String(r[0] ?? '').trim();
      const ten = String(r[1] ?? '').trim();
      if (!ma || chuanChu(ma).startsWith('so dong') || chuanChu(ma).startsWith('tong') || !ten) continue;
      const so = r.slice(3, 9).map(soTien);
      dong.push({ ma, ten, duNoDau: so[0]!, duCoDau: so[1]!, psNo: so[2]!, psCo: so[3]!, duNo: so[4]!, duCo: so[5]! });
    }
    if (!tuNgay) tuNgay = `${ngayChot.slice(0, 4)}-01-01`;
    return { loai, tuNgay, ngayChot, dong };
  }
  return null;
}

// ── Báo cáo kết quả hoạt động kinh doanh (B02-DN) ──

const CUOI_THANG = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function docKqkd(sheets: SheetDuLieu[]): BaoCaoKqkd | null {
  for (const sh of sheets) {
    const dauDu = sh.rows.slice(0, 8).map((r) => r.join(' ')).join(' ');
    // Ưu tiên câu "Kỳ kế toán …" / "Năm …" — tránh ngày tháng trong dòng "Thông tư số … ngày 27 tháng 10 năm 2025".
    const dau = /k[ỳy]\s*k[ếe]\s*to[áa]n[^|]*/i.exec(dauDu)?.[0] || dauDu.replace(/th[ôo]ng\s*t[ưu][^)]*\)/gi, '');
    let tuNgay = '';
    let denNgay = '';
    const tu = /t[ừu]\s*ng[àa]y\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*đ[ếe]n\s*ng[àa]y\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(dau);
    const thang = /th[áa]ng\s*(\d{1,2})\s*n[ăa]m\s*(\d{4})/i.exec(dau);
    const nam = /n[ăa]m\s*(\d{4})/i.exec(dau);
    if (tu) {
      tuNgay = ngayISO(tu[1]);
      denNgay = ngayISO(tu[2]);
    } else if (thang) {
      const y = Number(thang[2]);
      const mo = Number(thang[1]);
      tuNgay = `${y}-${String(mo).padStart(2, '0')}-01`;
      denNgay = `${y}-${String(mo).padStart(2, '0')}-${CUOI_THANG(y, mo)}`;
    } else if (nam) {
      tuNgay = `${nam[1]}-01-01`;
      denNgay = `${nam[1]}-12-31`;
    }
    if (!tuNgay) continue;
    // Cột "Mã số" và cột "Kỳ này" (giá trị kỳ báo cáo).
    const iTd = sh.rows.findIndex((r) => r.some((x) => chuanChu(x) === 'ma so'));
    if (iTd < 0) continue;
    const td = sh.rows[iTd]!;
    const cMa = td.findIndex((x) => chuanChu(x) === 'ma so');
    let cKy = td.findIndex((x) => chuanChu(x).startsWith('ky nay') || chuanChu(x).startsWith('nam nay'));
    const chiTieu: Record<string, number> = {};
    for (const r of sh.rows.slice(iTd + 1)) {
      const ma = String(r[cMa] ?? '').trim();
      if (!/^\d{2}$/.test(ma)) continue;
      if (cKy < 0) cKy = r.findIndex((x, j) => j > cMa + 1 && /\d/.test(String(x)));
      if (cKy < 0) continue;
      chiTieu[ma] = soTien(r[cKy]);
    }
    if (Object.keys(chiTieu).length) return { tuNgay, denNgay, chiTieu };
  }
  return null;
}

// ── XML: hoá đơn TT78 & tờ khai 01/GTGT ──

/** Lấy nội dung thẻ đầu tiên trong đoạn (đơn giản, đủ cho XML hoá đơn / tờ khai — không cần thư viện). */
function the(xml: string, ten: string): string {
  const m = new RegExp(`<${ten}(?:\\s[^>]*)?>([\\s\\S]*?)</${ten}>`).exec(xml);
  return m ? m[1]!.replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
}
function doan(xml: string, ten: string): string {
  const m = new RegExp(`<${ten}(?:\\s[^>]*)?>([\\s\\S]*?)</${ten}>`).exec(xml);
  return m ? m[1]! : '';
}

export type LoaiXml = 'hoa_don' | 'to_khai_gtgt' | 'khac';

export function nhanDangXml(xml: string): LoaiXml {
  if (/<HDon[\s>]/.test(xml) && /<DLHDon/.test(xml)) return 'hoa_don';
  if (/<HSoThueDTu/.test(xml) && /<maTKhai>\s*842\s*</.test(xml)) return 'to_khai_gtgt';
  return 'khac';
}

/** Hoá đơn XML (TT78): hướng ra/vào theo MST công ty — người bán là mình → bán ra. */
export function docHoaDonXml(xml: string, mstCongTy: string): HoaDon | null {
  const tt = doan(xml, 'TTChung');
  const nd = doan(xml, 'NDHDon');
  if (!tt || !nd) return null;
  const nBan = doan(nd, 'NBan');
  const nMua = doan(nd, 'NMua');
  const toan = doan(nd, 'TToan');
  const mstBan = the(nBan, 'MST');
  const laRa = !!mstCongTy && mstBan.replace(/-.*/, '') === mstCongTy.replace(/-.*/, '');
  const doiTac = laRa ? nMua : nBan;
  const ngay = ngayISO(the(tt, 'NLap'));
  const suat = [...nd.matchAll(/<TSuat>([^<]*)<\/TSuat>/g)].map((m) => m[1]!.replace('%', '').trim()).filter(Boolean);
  const tinhChat = the(tt, 'TCHDon'); // 1 = thay thế, 2 = điều chỉnh
  const h: HoaDon = {
    huong: laRa ? 'ra' : 'vao',
    mauSo: the(tt, 'KHMSHDon') || '1',
    kyHieu: the(tt, 'KHHDon'),
    soHd: String(Number(the(tt, 'SHDon')) || the(tt, 'SHDon')),
    ngay,
    mstDoiTac: the(doiTac, 'MST') || the(doiTac, 'CCCDan'),
    tenDoiTac: the(doiTac, 'Ten') || the(doiTac, 'HVTNMHang'),
    dienGiai: [...nd.matchAll(/<THHDVu>([^<]*)<\/THHDVu>/g)].map((m) => m[1]!.trim()).slice(0, 3).join('; ').slice(0, 500),
    tienHang: soTien(the(toan, 'TgTCThue')),
    tienThue: soTien(the(toan, 'TgTThue')),
    tongTien: soTien(the(toan, 'TgTTTBSo')),
    thueSuat: [...new Set(suat)].join(','),
    trangThai: tinhChat === '1' ? 'Hóa đơn thay thế' : tinhChat === '2' ? 'Hóa đơn điều chỉnh' : 'Hóa đơn mới',
    kyKeKhai: quyCuaNgay(ngay),
  };
  if (!h.kyHieu || !h.soHd || !ngay) return null;
  if (!h.tongTien) h.tongTien = h.tienHang + h.tienThue;
  return h;
}

/** MST người bán trong hoá đơn XML (để đoán MST công ty khi chưa có). */
export function mstNguoiBanXml(xml: string): string {
  return the(doan(doan(xml, 'NDHDon'), 'NBan'), 'MST');
}
export function mstNguoiMuaXml(xml: string): string {
  return the(doan(doan(xml, 'NDHDon'), 'NMua'), 'MST');
}

/** Tờ khai 01/GTGT (XML nộp thuế điện tử): kỳ, chính thức / bổ sung lần mấy, và các chỉ tiêu ct21…ct43. */
export function docToKhaiGtgt(xml: string): ToKhaiGtgt | null {
  const ttc = doan(xml, 'TTinChung');
  const kieuKy = the(ttc, 'kieuKy');
  const kyKKhai = the(ttc, 'kyKKhai');
  const m = /^(\d{1,2})\/(\d{4})$/.exec(kyKKhai);
  if (!m) return null;
  const ky = kieuKy === 'M' ? `${m[2]}-M${m[1]!.padStart(2, '0')}` : `${m[2]}-Q${m[1]}`;
  const ct: Record<string, number> = {};
  const noiDung = doan(xml, 'CTieuTKhaiChinh') || xml;
  for (const x of noiDung.matchAll(/<(ct\d+[a-z]?)>([^<]*)<\/\1>/g)) if (ct[x[1]!] === undefined) ct[x[1]!] = soTien(x[2]);
  return {
    ky,
    loai: the(ttc, 'loaiTKhai') || 'C',
    soLan: Number(the(ttc, 'soLan')) || 0,
    ngayLap: ngayISO(the(ttc, 'ngayLapTKhai')),
    mst: the(ttc, 'mst') || the(xml, 'mst'),
    ct,
  };
}

// ── Tính toán ──

/** Hạn nộp tờ khai / thuế GTGT theo quý: ngày cuối tháng đầu của quý sau. */
export function hanNopVat(ky: string): string {
  const m = /^(\d{4})-Q(\d)$/.exec(ky);
  if (!m) return '';
  let y = Number(m[1]);
  let thang = Number(m[2]) * 3 + 1;
  if (thang > 12) {
    thang = 1;
    y++;
  }
  return `${y}-${String(thang).padStart(2, '0')}-${CUOI_THANG(y, thang)}`;
}

export function quyKe(ky: string): string {
  const m = /^(\d{4})-Q(\d)$/.exec(ky)!;
  const q = Number(m[2]);
  return q === 4 ? `${Number(m[1]) + 1}-Q1` : `${m[1]}-Q${q + 1}`;
}

export interface DongVat {
  ky: string;
  dauRa: number;
  dauVao: number;
  /** Thuế còn được khấu trừ kỳ trước chuyển sang */
  kyTruoc: number;
  phaiNop: number;
  /** Còn được khấu trừ chuyển kỳ sau */
  chuyenKySau: number;
  nguon: 'to_khai' | 'uoc_tinh';
  hanNop: string;
  soHdRa: number;
  soHdVao: number;
}

/**
 * VAT theo quý, xâu chuỗi số chuyển kỳ sau. Quý có tờ khai (bản bổ sung mới nhất) → lấy số CHÍNH THỨC (ct22, ct25,
 * ct35, ct40, ct43); quý chưa khai → ƯỚC TÍNH = đầu ra − đầu vào − chuyển kỳ trước (chưa trừ hoá đơn đầu vào không
 * đủ điều kiện khấu trừ, nên số thật thường cao hơn).
 */
export function tinhVatTheoQuy(hoaDon: HoaDon[], toKhai: ToKhaiGtgt[], tuKy: string, denKy: string): DongVat[] {
  const tk = new Map<string, ToKhaiGtgt>();
  for (const t of toKhai) {
    const cu = tk.get(t.ky);
    if (!cu || t.soLan > cu.soLan) tk.set(t.ky, t);
  }
  const ra: DongVat[] = [];
  let chuyen = 0;
  for (let ky = tuKy; ky <= denKy; ky = quyKe(ky)) {
    const hd = hoaDon.filter((h) => h.kyKeKhai === ky && hoaDonHieuLuc(h.trangThai));
    const dauRa = hd.filter((h) => h.huong === 'ra').reduce((s, h) => s + h.tienThue, 0);
    const dauVao = hd.filter((h) => h.huong === 'vao').reduce((s, h) => s + h.tienThue, 0);
    const t = tk.get(ky);
    const dong: DongVat = t
      ? {
          ky,
          dauRa: t.ct.ct35 ?? dauRa,
          dauVao: t.ct.ct25 ?? dauVao,
          kyTruoc: t.ct.ct22 ?? 0,
          phaiNop: t.ct.ct40 ?? 0,
          chuyenKySau: t.ct.ct43 ?? 0,
          nguon: 'to_khai',
          hanNop: hanNopVat(ky),
          soHdRa: hd.filter((h) => h.huong === 'ra').length,
          soHdVao: hd.filter((h) => h.huong === 'vao').length,
        }
      : (() => {
          const rong = dauRa - dauVao - chuyen;
          return {
            ky,
            dauRa,
            dauVao,
            kyTruoc: chuyen,
            phaiNop: Math.max(0, rong),
            chuyenKySau: Math.max(0, -rong),
            nguon: 'uoc_tinh' as const,
            hanNop: hanNopVat(ky),
            soHdRa: hd.filter((h) => h.huong === 'ra').length,
            soHdVao: hd.filter((h) => h.huong === 'vao').length,
          };
        })();
    chuyen = dong.chuyenKySau;
    ra.push(dong);
  }
  return ra;
}

export interface KetQuaTndn {
  nam: number;
  /** Lợi nhuận TÍNH THUẾ (= kế toán + chi phí không được trừ) — cơ sở tính thuế */
  loiNhuan: number;
  /** Lãi / lỗ kế toán trước thuế (mã 50) */
  loiNhuanKeToan: number;
  /** Chi phí không được trừ khi tính thuế (kế toán báo) */
  chiPhiKhongTru: number;
  /** Lợi nhuận tính thuế kế toán GHI trong báo cáo (nếu có) — khác số tự tính thì trang báo chênh lệch */
  loiNhuanTinhThueKeToanGhi: number | null;
  doanhThu: number;
  /** 'bao_cao' = từ báo cáo KQKD cả năm; 'bao_cao_luy_ke' = báo cáo tới ngày; 'uoc_tinh' = từ hoá đơn */
  nguon: 'bao_cao' | 'bao_cao_luy_ke' | 'uoc_tinh';
  /** Báo cáo dùng là số kế toán gửi qua thư / ảnh */
  tuKeToan: boolean;
  denNgay: string;
  thueSuat: number;
  /** Thuế tính được nếu KHÔNG miễn */
  thueNeuKhongMien: number;
  mien: boolean;
  phaiNop: number;
  /** Chi phí lương đã trừ khi ước tính (0 nếu lấy từ báo cáo KQKD) */
  chiPhiLuong: number;
}

/** Thuế suất TNDN: từ kỳ tính thuế 2025 doanh thu năm ≤ 3 tỷ 15%, ≤ 50 tỷ 17%, còn lại 20%; trước 2025: 20%. */
export function thueSuatTndn(nam: number, doanhThuNam: number): number {
  if (nam < 2025) return 0.2;
  if (doanhThuNam <= 3_000_000_000) return 0.15;
  if (doanhThuNam <= 50_000_000_000) return 0.17;
  return 0.2;
}

/** `chiPhiLuong` = tổng thu nhập + BHXH công ty đóng của năm (từ bảng lương) — trừ khi ước tính từ hoá đơn. */
export function tinhTndn(nam: number, baoCao: BaoCaoKqkd[], hoaDon: HoaDon[], namMien: number[], chiPhiLuong = 0): KetQuaTndn {
  // Báo cáo phủ từ đầu năm, đến ngày muộn nhất trong năm; cùng ngày thì ưu tiên số kế toán gửi (có tách chi phí không
  // được trừ — anh Tâm 18/10/2026: "lãi lỗ so với phần mềm đang tính sai").
  const bc = baoCao
    .filter((b) => b.tuNgay === `${nam}-01-01` && b.denNgay.startsWith(String(nam)) && b.chiTieu['50'] !== undefined)
    .sort((a, b) => b.denNgay.localeCompare(a.denNgay) || (b.nguon === 'ke_toan' ? 1 : 0) - (a.nguon === 'ke_toan' ? 1 : 0))[0];
  let loiNhuanKeToan: number;
  let chiPhiKhongTru = 0;
  let loiNhuanTinhThueKeToanGhi: number | null = null;
  let doanhThu: number;
  let nguon: KetQuaTndn['nguon'];
  let denNgay = '';
  if (bc) {
    loiNhuanKeToan = bc.chiTieu['50'] ?? 0;
    // Chi phí không được trừ: lấy từ báo cáo kế toán cùng kỳ (nếu báo cáo đang dùng là B02 không có số này).
    const cungKy = baoCao.find((b) => b.tuNgay === bc.tuNgay && b.denNgay === bc.denNgay && b.chiTieu.cpktd !== undefined);
    chiPhiKhongTru = bc.chiTieu.cpktd ?? cungKy?.chiTieu.cpktd ?? 0;
    const ghi = bc.chiTieu.lntt ?? cungKy?.chiTieu.lntt;
    loiNhuanTinhThueKeToanGhi = ghi === undefined ? null : ghi;
    // Thư kế toán thường không ghi doanh thu → lấy từ báo cáo B02 cùng kỳ, rồi mới tới hoá đơn.
    const coDoanhThu = baoCao.find((b) => b.tuNgay === bc.tuNgay && b.denNgay === bc.denNgay && (b.chiTieu['01'] ?? b.chiTieu['10']) !== undefined);
    doanhThu = bc.chiTieu['01'] ?? bc.chiTieu['10'] ?? coDoanhThu?.chiTieu['01'] ?? coDoanhThu?.chiTieu['10'] ?? 0;
    if (!doanhThu) {
      doanhThu = hoaDon
        .filter((h) => h.huong === 'ra' && h.ngay >= bc.tuNgay && h.ngay <= bc.denNgay && hoaDonHieuLuc(h.trangThai))
        .reduce((s, h) => s + h.tienHang, 0);
    }
    nguon = bc.denNgay === `${nam}-12-31` ? 'bao_cao' : 'bao_cao_luy_ke';
    denNgay = bc.denNgay;
  } else {
    const hd = hoaDon.filter((h) => h.ngay.startsWith(String(nam)) && hoaDonHieuLuc(h.trangThai));
    doanhThu = hd.filter((h) => h.huong === 'ra').reduce((s, h) => s + h.tienHang, 0);
    loiNhuanKeToan = doanhThu - hd.filter((h) => h.huong === 'vao').reduce((s, h) => s + h.tienHang, 0) - chiPhiLuong;
    nguon = 'uoc_tinh';
  }
  // Lợi nhuận tính thuế = lãi / lỗ kế toán + chi phí không được trừ.
  const loiNhuan = loiNhuanKeToan + chiPhiKhongTru;
  const thueSuat = thueSuatTndn(nam, doanhThu);
  const thueNeuKhongMien = Math.max(0, Math.round(loiNhuan * thueSuat));
  const mien = namMien.includes(nam);
  return {
    nam,
    loiNhuan,
    loiNhuanKeToan,
    chiPhiKhongTru,
    loiNhuanTinhThueKeToanGhi,
    doanhThu,
    nguon,
    tuKeToan: bc?.nguon === 'ke_toan',
    denNgay,
    thueSuat,
    thueNeuKhongMien,
    mien,
    phaiNop: mien ? 0 : thueNeuKhongMien,
    chiPhiLuong: bc ? 0 : chiPhiLuong,
  };
}

export interface DongKetQuaThang {
  /** YYYY-MM */
  thang: string;
  /** Doanh thu: tiền hàng HĐ bán ra (chưa VAT) */
  thu: number;
  /** Chi phí có hoá đơn: tiền hàng HĐ mua vào (chưa VAT) */
  chi: number;
  /** Lương: tổng thu nhập + BHXH công ty đóng (bảng lương) */
  luong: number;
  laiLo: number;
  soHdRa: number;
  soHdVao: number;
  coLuong: boolean;
}

/**
 * Thu / chi / lương / lãi lỗ theo tháng của một năm (anh Tâm 18/10/2026: "Thu, chi, lương, tách ra"). Theo NGÀY hoá
 * đơn; chưa gồm chi phí không có hoá đơn và các bút toán kế toán (khấu hao, phân bổ…) — đối chiếu với số kế toán bên dưới.
 */
export function ketQuaTheoThang(
  nam: number,
  hoaDon: HoaDon[],
  luong: Array<{ thang: string; tongThuNhap: number; bhxhCty: number }>,
  denThang?: string,
): DongKetQuaThang[] {
  const ra: DongKetQuaThang[] = [];
  for (let m = 1; m <= 12; m++) {
    const thang = `${nam}-${String(m).padStart(2, '0')}`;
    if (denThang && thang > denThang) break;
    const hd = hoaDon.filter((h) => h.ngay.startsWith(thang) && hoaDonHieuLuc(h.trangThai));
    const hdRa = hd.filter((h) => h.huong === 'ra');
    const hdVao = hd.filter((h) => h.huong === 'vao');
    const l = luong.find((x) => x.thang === thang);
    const thu = hdRa.reduce((s, h) => s + h.tienHang, 0);
    const chi = hdVao.reduce((s, h) => s + h.tienHang, 0);
    const tienLuong = l ? l.tongThuNhap + l.bhxhCty : 0;
    ra.push({ thang, thu, chi, luong: tienLuong, laiLo: thu - chi - tienLuong, soHdRa: hdRa.length, soHdVao: hdVao.length, coLuong: !!l });
  }
  return ra;
}

export interface CongNoDoiTac {
  ma: string;
  ten: string;
  /** Số dư theo sổ tại ngày chốt (phải thu: Nợ − Có; phải trả: Có − Nợ) */
  soDu: number;
  /** Hoá đơn phát sinh SAU ngày chốt (chưa có trong sổ) */
  hoaDonSau: number;
  /** Tiền đã thu (phải thu) / đã trả (phải trả) SAU ngày chốt, theo sao kê ngân hàng */
  thanhToanSau: number;
  /** Hoá đơn đầu vào sau chốt đã trả tiền mặt (anh đánh dấu, hoặc dưới 5 triệu không thấy chuyển khoản) */
  tienMatSau: number;
  tong: number;
}

/** Một khoản tiền sau ngày chốt đã khớp được đối tác (từ sao kê). */
export interface ThanhToanDoiTac {
  mst: string;
  ten: string;
  soTien: number;
  /** Trả tiền mặt (không qua ngân hàng) */
  tienMat?: boolean;
}

/**
 * Công nợ theo đối tác = số dư sổ tại ngày chốt + hoá đơn sau ngày chốt − tiền đã thu/trả sau ngày chốt (sao kê).
 * Khớp đối tác theo MST, hoặc theo tên khi sổ dùng mã nội bộ (KH002…).
 * `phai` = tổng các bên còn nợ / mình còn nợ (số dương); `truoc` = tổng tiền đã ứng trước (bên có số dư ngược chiều —
 * khách trả trước, hoặc mình đã trả trước cho nhà cung cấp); `tong` = phai − truoc.
 */
export function tinhCongNo(
  so: SoCongNo | null,
  hoaDon: HoaDon[],
  loai: 'thu' | 'tra',
  thanhToan: ThanhToanDoiTac[] = [],
): { ngayChot: string; ds: CongNoDoiTac[]; tong: number; phai: number; truoc: number } {
  const huong: Huong = loai === 'thu' ? 'ra' : 'vao';
  const m = new Map<string, CongNoDoiTac>();
  for (const d of so?.dong || []) {
    const soDu = loai === 'thu' ? d.duNo - d.duCo : d.duCo - d.duNo;
    m.set(d.ma, { ma: d.ma, ten: d.ten, soDu, hoaDonSau: 0, thanhToanSau: 0, tienMatSau: 0, tong: soDu });
  }
  const chot = so?.ngayChot || '';
  const dongCua = (mst: string, ten: string): CongNoDoiTac => {
    // Sổ có khách mang mã nội bộ (KH002…) thay vì MST → khớp thêm theo tên đã chuẩn hoá.
    const theoTen = [...m.values()].find((x) => chuanChu(x.ten) === chuanChu(ten));
    const ma = mst && m.has(mst) ? mst : theoTen?.ma || mst || ten;
    const x = m.get(ma) || { ma, ten, soDu: 0, hoaDonSau: 0, thanhToanSau: 0, tienMatSau: 0, tong: 0 };
    m.set(ma, x);
    return x;
  };
  if (chot) {
    for (const h of hoaDon) {
      if (h.huong !== huong || !hoaDonHieuLuc(h.trangThai) || h.ngay <= chot) continue;
      dongCua(h.mstDoiTac, h.tenDoiTac).hoaDonSau += h.tongTien;
    }
    for (const t of thanhToan) {
      const x = dongCua(t.mst, t.ten);
      if (t.tienMat) x.tienMatSau += t.soTien;
      else x.thanhToanSau += t.soTien;
    }
  }
  for (const x of m.values()) x.tong = x.soDu + x.hoaDonSau - x.thanhToanSau - x.tienMatSau;
  const ds = [...m.values()].filter((x) => x.tong !== 0).sort((a, b) => b.tong - a.tong);
  const phai = ds.filter((x) => x.tong > 0).reduce((s, x) => s + x.tong, 0);
  const truoc = ds.filter((x) => x.tong < 0).reduce((s, x) => s - x.tong, 0);
  return { ngayChot: chot, ds, tong: phai - truoc, phai, truoc };
}

export { laMst };
