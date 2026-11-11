// Lãi lỗ + công nợ ĐƠN GIẢN cho Kế toán thuế (anh Tâm 8/11/2026): "lãi lỗ sẽ bằng hóa đơn của thuế điện tử đầu ra -
// đầu vào - chi phí như lương BHXH, thuê nhà, các CP khác không xuất hiện trên thuedientu như là CP nhà thầu nước ngoài
// (FB, Tiktok Ads...), công nợ em sẽ căn cứ theo sao kê, có nội dung tên cty hoặc có tên người gửi, số tiền trùng khớp
// (ưu tiên tên cty trước)". Tiền công ty rút ra chi tiêu khác KHÔNG tính ("chỉ căn cứ vào hóa đơn thôi").
import { hoaDonHieuLuc, chuanChu, type HoaDon } from './keToan.js';
import { khopDoiTac, loaiTienVao, laGdLuong, NGUONG_TIEN_MAT, type GiaoDich, type DoiTacKhop } from './saoKe.js';

export interface ThangLaiLo {
  /** YYYY-MM */
  thang: string;
  /** Tiền hàng hoá đơn bán ra (chưa VAT) */
  doanhThu: number;
  /** Tiền hàng hoá đơn mua vào (chưa VAT) */
  hdVao: number;
  /** Lương + BHXH công ty đóng (bảng lương) */
  luongBhxh: number;
  /** Nhà thầu nước ngoài trả bằng thẻ (Facebook / Google / TikTok Ads, phần mềm nước ngoài) — trừ tiền thẻ hoàn về */
  nhaThauNN: number;
  /** Thuê nhà / văn phòng / mặt bằng (theo sao kê) */
  thueNha: number;
  laiLo: number;
}

/**
 * Tiền thuê nhà / văn phòng / mặt bằng. Ngân hàng hay ngắt dòng giữa chữ ("thanh toan tien thu e van phong") nên so cả
 * bản bỏ dấu cách cho "thuê văn phòng"; "thuê nhà" thì so theo từ nguyên vẹn để "thuê nhân viên" không bị bắt nhầm.
 */
export function laThueNha(noiDung: string): boolean {
  const chu = chuanChu(String(noiDung || '')).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
  return /thuevanphong|thuemat ?bang/.test(chu.replace(/ /g, '')) || /(^| )(thue nha|tien nha|mat bang)( |$)/.test(chu);
}

/**
 * Trả thẻ cho nhà thầu nước ngoài — không có hoá đơn trên thuế điện tử. Sao kê MB ghi "RetailVISADN-…-GOOGLE ADWS",
 * "…FACEBK…", "…ANTHROPIC CLAUDE SUB…": mọi khoản quẹt thẻ (Retail…VISA) là dịch vụ nước ngoài; thêm tên hay gặp cho
 * trường hợp ngân hàng ghi khác.
 */
export function laTheNuocNgoai(noiDung: string): boolean {
  return /^\s*retail\w*visa|facebk|facebook|meta platforms|google ?ad|tiktok|anthropic|openai|canva|adobe/i.test(String(noiDung || ''));
}

/**
 * Nhà thầu nước ngoài CÓ xuất hoá đơn đầu vào ở Việt Nam (Google Việt Nam, Meta Platforms Ireland…): tiền quẹt thẻ cho
 * họ là trả hoá đơn đó, không phải chi phí thêm. Dữ liệu thật 8/11/2026: Google 246 hoá đơn, Meta 27 hoá đơn.
 */
const THUONG_HIEU: Array<{ the: RegExp; ncc: RegExp }> = [
  { the: /google/i, ncc: /google/i },
  { the: /facebk|facebook|meta platforms/i, ncc: /meta platforms|facebook/i },
  { the: /tiktok/i, ncc: /tiktok|bytedance/i },
];

/** Nhà cung cấp (trên hoá đơn đầu vào) mà khoản quẹt thẻ này trả cho — null nếu nhà thầu đó không xuất hoá đơn. */
export function nccCuaThe(noiDung: string, hoaDon: HoaDon[]): HoaDon | null {
  if (!laTheNuocNgoai(noiDung)) return null;
  const th = THUONG_HIEU.find((x) => x.the.test(noiDung));
  return th ? hoaDon.find((h) => h.huong === 'vao' && th.ncc.test(h.tenDoiTac)) || null : null;
}

export function laiLoTheoThang(
  nam: number,
  d: { hoaDon: HoaDon[]; luong: Array<{ thang: string; tongThuNhap: number; bhxhCty: number }>; giaoDich: GiaoDich[] },
  denThang?: string,
): ThangLaiLo[] {
  const ra: ThangLaiLo[] = [];
  for (let m = 1; m <= 12; m++) {
    const thang = `${nam}-${String(m).padStart(2, '0')}`;
    if (denThang && thang > denThang) break;
    const hd = d.hoaDon.filter((h) => h.ngay.startsWith(thang) && hoaDonHieuLuc(h.trangThai));
    const doanhThu = hd.filter((h) => h.huong === 'ra').reduce((s, h) => s + h.tienHang, 0);
    const hdVao = hd.filter((h) => h.huong === 'vao').reduce((s, h) => s + h.tienHang, 0);
    const l = d.luong.find((x) => x.thang === thang);
    const luongBhxh = l ? l.tongThuNhap + l.bhxhCty : 0;
    // Nhà thầu đã xuất hoá đơn (Google, Meta) tính theo hoá đơn đầu vào — tiền thẻ trả cho họ không cộng thêm.
    const nhaThauNN = d.giaoDich
      .filter((g) => g.ngay.startsWith(thang) && laTheNuocNgoai(g.noiDung) && !nccCuaThe(g.noiDung, d.hoaDon))
      .reduce((s, g) => s + g.ghiNo - g.ghiCo, 0);
    const thueNha = d.giaoDich
      .filter((g) => g.ngay.startsWith(thang) && g.ghiNo > 0 && !laTheNuocNgoai(g.noiDung) && laThueNha(g.noiDung))
      .reduce((s, g) => s + g.ghiNo, 0);
    ra.push({ thang, doanhThu, hdVao, luongBhxh, nhaThauNN, thueNha, laiLo: doanhThu - hdVao - luongBhxh - nhaThauNN - thueNha });
  }
  return ra;
}

// ── Công nợ theo sao kê ──

export interface CongNoSaoKe {
  /** Mã đối tác: MST, không có thì tên */
  ma: string;
  ten: string;
  mst: string;
  /** Tổng tiền (gồm VAT) hoá đơn trong kỳ sao kê */
  hoaDon: number;
  /** Tiền đã thu (phải thu) / đã trả (phải trả) khớp được với đối tác */
  daTra: number;
  /** Còn nợ = hoaDon − daTra (âm = trả dư / trả trước / trả hoá đơn trước kỳ) */
  con: number;
  /** Hoá đơn còn nợ — tiền trả trừ vào hoá đơn cũ nhất trước */
  hdChuaTra: Array<{ soHd: string; ngay: string; tongTien: number; conLai: number }>;
}

/**
 * Công nợ = hoá đơn trong kỳ có sao kê − tiền khớp từ sao kê. Kỳ bắt đầu từ ngày sớm nhất của sao kê (hoá đơn trước đó
 * không có dữ liệu tiền để đối chiếu). Khớp tiền với đối tác: tên công ty trong nội dung chuyển khoản → tên người /
 * đơn vị chuyển.
 */
export function congNoTheoSaoKe(o: { loai: 'thu' | 'tra'; hoaDon: HoaDon[]; giaoDich: GiaoDich[] }): {
  tuNgay: string;
  ds: CongNoSaoKe[];
  /** Tiền vào / ra chưa khớp được đối tác nào */
  chuaKhop: GiaoDich[];
  phai: number;
  truoc: number;
} {
  const huong = o.loai === 'thu' ? 'ra' : 'vao';
  const tuNgay = o.giaoDich.reduce((m, g) => (!m || g.ngay < m ? g.ngay : m), '');
  const hd = o.hoaDon.filter((h) => h.huong === huong && hoaDonHieuLuc(h.trangThai) && (!tuNgay || h.ngay >= tuNgay));
  const theoMa = new Map<string, CongNoSaoKe>();
  const dong = (mst: string, ten: string) => {
    const ma = mst || ten;
    const x = theoMa.get(ma) || { ma, ten, mst, hoaDon: 0, daTra: 0, con: 0, hdChuaTra: [] };
    theoMa.set(ma, x);
    return x;
  };
  for (const h of hd) dong(h.mstDoiTac, h.tenDoiTac).hoaDon += h.tongTien;
  const doiTac: DoiTacKhop[] = [...theoMa.values()].map((x) => ({ ma: x.ma, ten: x.ten, mst: x.mst }));
  const daKhopTien = new Set<HoaDon>();
  const chuaKhop: GiaoDich[] = [];
  for (const g of o.giaoDich) {
    const soTien = o.loai === 'thu' ? g.ghiCo : g.ghiNo;
    if (!soTien) continue;
    if (o.loai === 'thu' && loaiTienVao(g) !== 'khach') continue;
    if (o.loai === 'tra') {
      // Quẹt thẻ cho nhà thầu có hoá đơn (Google, Meta) = trả hoá đơn của họ.
      const ncc = nccCuaThe(g.noiDung, hd);
      if (ncc) {
        theoMa.get(ncc.mstDoiTac || ncc.tenDoiTac)!.daTra += soTien;
        continue;
      }
      if (khongPhaiTraNcc(g.noiDung)) continue;
    }
    // Ưu tiên tên công ty trong NỘI DUNG (người khác trả hộ vẫn ghi tên công ty), rồi tới tên người / đơn vị chuyển.
    const d = khopDoiTac(g.noiDung, doiTac) || (g.doiTac ? khopDoiTac(g.doiTac, doiTac) : null);
    if (d) {
      theoMa.get(d.ma)!.daTra += soTien;
      continue;
    }
    // Không có tên: số tiền trùng ĐÚNG một hoá đơn chưa khớp (lệch ≤ 1.000đ). Trùng hoá đơn của hai bên → không đoán.
    const trung = hd.filter((h) => !daKhopTien.has(h) && Math.abs(h.tongTien - soTien) <= 1000);
    const ben = new Set(trung.map((h) => h.mstDoiTac || h.tenDoiTac));
    if (trung.length && ben.size === 1) {
      daKhopTien.add(trung[0]!);
      theoMa.get(trung[0]!.mstDoiTac || trung[0]!.tenDoiTac)!.daTra += soTien;
      continue;
    }
    chuaKhop.push(g);
  }
  // Phải trả: hoá đơn dưới 5 triệu coi như đã trả tiền mặt (anh Tâm: "các khoản dưới 5tr vẫn chi tiền mặt bình thường")
  // — trừ khi nhà cung cấp đó có nhận chuyển khoản (để sao kê trừ, tránh trừ hai lần); anh đánh dấu tiền mặt / chuyển
  // khoản trên hoá đơn thì theo anh.
  // Anh Tâm 11/11/2026: "Mặc định các giao dịch phải trả dưới 5 triệu nếu k có trong sao kê thì anh đã trả tiền mặt".
  // Trước đây nhà cung cấp có nhận chuyển khoản thì MỌI hoá đơn nhỏ của họ bị coi là còn nợ. Giờ: tiền sao kê trừ vào hoá
  // đơn lớn trước (từ 5 triệu phải chuyển khoản), rồi hoá đơn nhỏ; hoá đơn nhỏ nào tiền sao kê không phủ tới = tiền mặt.
  // Chuyển khoản gộp nhiều hoá đơn nhỏ vẫn được trừ đúng, không tính thêm tiền mặt (không trừ hai lần).
  if (o.loai === 'tra') {
    for (const x of theoMa.values()) {
      const cua = hd.filter((h) => (h.mstDoiTac || h.tenDoiTac) === x.ma);
      let nganHang = x.daTra;
      let tienMat = 0;
      const lon = (h: HoaDon) => h.thanhToan === 'ngan_hang' || h.tongTien >= NGUONG_TIEN_MAT;
      const theoThuTu = [...cua.filter((h) => h.thanhToan !== 'tien_mat' && lon(h)), ...cua.filter((h) => h.thanhToan !== 'tien_mat' && !lon(h))];
      for (const h of theoThuTu.sort((a, b) => Number(lon(b)) - Number(lon(a)) || a.ngay.localeCompare(b.ngay))) {
        const tra = Math.min(nganHang, h.tongTien);
        nganHang -= tra;
        if (!lon(h)) tienMat += h.tongTien - tra;
      }
      for (const h of cua) if (h.thanhToan === 'tien_mat') tienMat += h.tongTien;
      x.daTra += tienMat;
    }
  }
  const ds = [...theoMa.values()]
    .map((x) => {
      // Trừ tiền đã trả vào hoá đơn cũ nhất trước.
      let du = x.daTra;
      const hdChuaTra: CongNoSaoKe['hdChuaTra'] = [];
      for (const h of hd.filter((h) => (h.mstDoiTac || h.tenDoiTac) === x.ma).sort((a, b) => a.ngay.localeCompare(b.ngay))) {
        const tra = Math.min(du, h.tongTien);
        du -= tra;
        if (h.tongTien - tra > 0) hdChuaTra.push({ soHd: h.soHd, ngay: h.ngay, tongTien: h.tongTien, conLai: h.tongTien - tra });
      }
      return { ...x, con: x.hoaDon - x.daTra, hdChuaTra };
    })
    .sort((a, b) => b.con - a.con);
  return {
    tuNgay,
    ds,
    chuaKhop,
    phai: ds.filter((x) => x.con > 0).reduce((s, x) => s + x.con, 0),
    truoc: ds.filter((x) => x.con < 0).reduce((s, x) => s - x.con, 0),
  };
}

/** Khoản chi KHÔNG phải trả nhà cung cấp: lương, BHXH, nộp thuế, thẻ nước ngoài, thuê nhà, rút tiền mặt. */
export function khongPhaiTraNcc(noiDung: string): boolean {
  if (laTheNuocNgoai(noiDung) || laThueNha(noiDung) || laGdLuong({ ghiNo: 1, noiDung })) return true;
  const chu = chuanChu(String(noiDung || '')).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
  return /(^| )(bhxh|bhx h|ntdt|kbnn|nop thue|nop ngan sach|rut tien)( |$)/.test(chu);
}
