// Kế toán thuế (anh Tâm 18/10/2026): nhận file kế toán gửi → ghi số liệu → VAT phải nộp, TNDN phải nộp (miễn 2024–2026),
// công nợ các bên. Trang chỉ giám đốc.
import {
  nhanDangBang,
  docBangKe,
  docCongNo,
  docKqkd,
  nhanDangXml,
  docHoaDonXml,
  docToKhaiGtgt,
  mstNguoiBanXml,
  mstNguoiMuaXml,
  tinhVatTheoQuy,
  tinhTndn,
  tinhCongNo,
  quyCuaNgay,
  type SheetDuLieu,
  type HoaDon,
} from '../lib/keToan.js';
import {
  ghiHoaDon,
  tatCaHoaDon,
  ghiToKhai,
  tatCaToKhai,
  ghiCongNo,
  soCongNoMoiNhat,
  ghiBaoCao,
  tatCaBaoCao,
  ghiTaiLen,
  docCaiDat,
  ghiCaiDat,
  ghiGiaoDich,
  tatCaGiaoDich,
  ghiLuong,
  tatCaLuong,
} from './keToan.repo.js';
import { laSaoKe, docSaoKe, khopDoiTac, type GiaoDich, type DoiTacKhop } from '../lib/saoKe.js';
import { hoaDonHieuLuc, type SoCongNo, type ThanhToanDoiTac } from '../lib/keToan.js';
import { xemTruoc, hoaDonTheoBanDo, giaoDichTheoBanDo, congNoTheoBanDo, luongTheoBanDo, kqkdTheoBanDo, type BanDoAi } from '../lib/docAi.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';

/** Anh Tâm: "3 năm 2024, 2025, 2026 anh được miễn thuế TNDN". Sửa được ở trang. */
export const MIEN_TNDN_MAC_DINH = '2024,2025,2026';

export interface CaiDatKeToan {
  mst: string;
  namMien: number[];
}

export async function caiDat(): Promise<CaiDatKeToan> {
  const c = await docCaiDat();
  return {
    mst: c.mst || '',
    namMien: (c.mien_tndn ?? MIEN_TNDN_MAC_DINH)
      .split(/[,\s;]+/)
      .map(Number)
      .filter((n) => n > 2000 && n < 2100),
  };
}

export async function luuCaiDat(o: { mst?: string; mienTndn?: string }): Promise<CaiDatKeToan> {
  if (o.mst !== undefined) await ghiCaiDat('mst', o.mst.replace(/\s/g, '').slice(0, 20));
  if (o.mienTndn !== undefined) await ghiCaiDat('mien_tndn', o.mienTndn.slice(0, 100));
  return caiDat();
}

export interface KetQuaTep {
  ten: string;
  loai: string;
  ok: boolean;
  thongDiep: string;
}

const tien = (n: number) => n.toLocaleString('vi-VN');

/** Một file bảng (Excel/CSV đã được trình duyệt đọc thành các dòng chữ). */
/**
 * Một file bảng (Excel/CSV đã được trình duyệt đọc thành các dòng chữ). Bộ đọc theo mẫu đã biết chạy trước (nhanh,
 * không tốn AI); không nhận ra / không ra dòng nào thì AI đọc phần đầu file để chỉ ra loại file và cột (anh Tâm
 * 18/10/2026: "cho AI vào đọc file luôn đỡ phải setup định dạng").
 */
export async function nhapBang(ten: string, sheets: SheetDuLieu[], nguoi: string): Promise<KetQuaTep> {
  const kq = await nhapBangTheoMau(ten, sheets, nguoi);
  if (kq.ok) return kq;
  try {
    return await nhapBangAi(ten, sheets, nguoi);
  } catch (e) {
    return { ten, loai: 'Chưa nhận dạng', ok: false, thongDiep: `${kq.thongDiep} · AI cũng chưa đọc được: ${(e as Error).message.slice(0, 200)}` };
  }
}

async function nhapBangTheoMau(ten: string, sheets: SheetDuLieu[], nguoi: string): Promise<KetQuaTep> {
  const loai = nhanDangBang(sheets);
  const id = newId('KT');
  const luc = nowTz().toISOString();
  let kq: KetQuaTep;
  if (loai === 'bang_ke') {
    const { hoaDon, boQua } = docBangKe(sheets);
    const ghi = await ghiHoaDon(hoaDon, 'bang_ke', id, luc);
    const ra = hoaDon.filter((h) => h.huong === 'ra');
    const vao = hoaDon.filter((h) => h.huong === 'vao');
    const ky = [...new Set(hoaDon.map((h) => h.kyKeKhai))].sort().join(', ');
    kq = {
      ten,
      loai: 'Bảng kê hoá đơn',
      ok: hoaDon.length > 0,
      thongDiep: hoaDon.length
        ? `${ra.length} HĐ bán ra (VAT ${tien(ra.reduce((s, h) => s + h.tienThue, 0))}), ${vao.length} HĐ mua vào (VAT ${tien(vao.reduce((s, h) => s + h.tienThue, 0))}) · kỳ ${ky} · ${ghi.moi} mới, ${ghi.capNhat} cập nhật${boQua ? ` · ${boQua} dòng không đọc được` : ''}`
        : 'Không đọc được dòng hoá đơn nào',
    };
  } else if (loai === 'cong_no_thu' || loai === 'cong_no_tra') {
    const l = loai === 'cong_no_thu' ? 'thu' : 'tra';
    const so = docCongNo(sheets, l, ten);
    if (so) {
      const n = await ghiCongNo(so, id);
      const tong = so.dong.reduce((s, d) => s + (l === 'thu' ? d.duNo - d.duCo : d.duCo - d.duNo), 0);
      kq = { ten, loai: l === 'thu' ? 'Công nợ phải thu (131)' : 'Công nợ phải trả (331)', ok: true, thongDiep: `${n} đối tác, chốt ngày ${so.ngayChot} · tổng ${tien(tong)}` };
    } else kq = { ten, loai: 'Công nợ', ok: false, thongDiep: 'Không đọc được ngày chốt / bảng số dư' };
  } else if (loai === 'kqkd') {
    const b = docKqkd(sheets);
    if (b) {
      await ghiBaoCao(b, id, luc);
      kq = { ten, loai: 'Báo cáo kết quả kinh doanh', ok: true, thongDiep: `Kỳ ${b.tuNgay} → ${b.denNgay} · doanh thu ${tien(b.chiTieu['01'] ?? 0)}, LN trước thuế ${tien(b.chiTieu['50'] ?? 0)}` };
    } else kq = { ten, loai: 'Báo cáo KQKD', ok: false, thongDiep: 'Không đọc được kỳ / các chỉ tiêu' };
  } else if (laSaoKe(sheets)) {
    const sk = docSaoKe(sheets, ten);
    if (sk) {
      const ghi = await ghiGiaoDich(sk.giaoDich, id);
      const ngay = sk.giaoDich.map((g) => g.ngay).sort();
      const vao = sk.giaoDich.reduce((s, g) => s + g.ghiCo, 0);
      const raTien = sk.giaoDich.reduce((s, g) => s + g.ghiNo, 0);
      kq = {
        ten,
        loai: `Sao kê ${sk.nganHang || 'ngân hàng'}${sk.soTk ? ` ···${sk.soTk.slice(-4)}` : ''}`,
        ok: true,
        thongDiep: `${sk.giaoDich.length} giao dịch ${ngay[0]} → ${ngay[ngay.length - 1]} · vào ${tien(vao)}, ra ${tien(raTien)} · ${ghi.moi} mới, ${ghi.trung} đã có${sk.boQua ? ` · ${sk.boQua} dòng không đọc được` : ''}`,
      };
    } else kq = { ten, loai: 'Sao kê', ok: false, thongDiep: 'Nhận ra là sao kê nhưng không đọc được dòng giao dịch nào' };
  } else {
    kq = {
      ten,
      loai: 'Chưa nhận dạng',
      ok: false,
      thongDiep: 'Chưa nhận ra loại file — đọc được: bảng kê MV-BR / Excel hoá đơn cổng thuế, sao kê ngân hàng, tổng hợp công nợ 131/331, báo cáo kết quả kinh doanh',
    };
  }
  if (kq.ok) await ghiTaiLen({ id, tenFile: ten, loai: kq.loai, ketQua: kq.thongDiep, nguoi, luc });
  return kq;
}

/**
 * Nhiều file XML một lượt (hoá đơn TT78, tờ khai 01/GTGT). Hướng hoá đơn (ra/vào) theo MST công ty — chưa có thì lấy
 * MST trên tờ khai, hoặc MST xuất hiện nhiều nhất trong lô hoá đơn (công ty là bên bán ở HĐ ra, bên mua ở HĐ vào).
 */
export async function nhapXml(files: Array<{ ten: string; noiDung: string }>, nguoi: string): Promise<KetQuaTep[]> {
  const cd = await caiDat();
  let mst = cd.mst;
  const luc = nowTz().toISOString();
  const ketQua: KetQuaTep[] = [];
  // Tờ khai trước — có MST công ty.
  const loaiCua = files.map((f) => nhanDangXml(f.noiDung));
  for (let i = 0; i < files.length; i++) {
    if (loaiCua[i] !== 'to_khai_gtgt') continue;
    const f = files[i]!;
    const t = docToKhaiGtgt(f.noiDung);
    if (!t) {
      ketQua.push({ ten: f.ten, loai: 'Tờ khai GTGT', ok: false, thongDiep: 'Không đọc được kỳ kê khai' });
      continue;
    }
    if (!mst && t.mst) {
      mst = t.mst;
      await ghiCaiDat('mst', mst);
    }
    const id = newId('KT');
    await ghiToKhai(t, id, luc);
    const thongDiep = `Kỳ ${t.ky}${t.loai === 'B' ? ` (bổ sung lần ${t.soLan})` : ''} · VAT phải nộp ${tien(t.ct.ct40 ?? 0)}, chuyển kỳ sau ${tien(t.ct.ct43 ?? 0)}`;
    await ghiTaiLen({ id, tenFile: f.ten, loai: 'Tờ khai GTGT', ketQua: thongDiep, nguoi, luc });
    ketQua.push({ ten: f.ten, loai: 'Tờ khai GTGT', ok: true, thongDiep });
  }
  const hdIdx = loaiCua.map((l, i) => (l === 'hoa_don' ? i : -1)).filter((i) => i >= 0);
  if (hdIdx.length && !mst) {
    const dem = new Map<string, number>();
    for (const i of hdIdx) {
      for (const m of [mstNguoiBanXml(files[i]!.noiDung), mstNguoiMuaXml(files[i]!.noiDung)]) if (m) dem.set(m, (dem.get(m) || 0) + 1);
    }
    const [top, n] = [...dem.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
    if (top && n >= Math.max(2, Math.ceil(hdIdx.length * 0.8))) {
      mst = top;
      await ghiCaiDat('mst', mst);
    }
  }
  if (hdIdx.length) {
    if (!mst) {
      for (const i of hdIdx) ketQua.push({ ten: files[i]!.ten, loai: 'Hoá đơn XML', ok: false, thongDiep: 'Chưa biết MST công ty để xác định bán ra / mua vào — nhập MST ở phần Cài đặt rồi tải lại' });
    } else {
      const ds: HoaDon[] = [];
      for (const i of hdIdx) {
        const h = docHoaDonXml(files[i]!.noiDung, mst);
        if (h) ds.push(h);
        else ketQua.push({ ten: files[i]!.ten, loai: 'Hoá đơn XML', ok: false, thongDiep: 'Không đọc được ký hiệu / số / ngày' });
      }
      if (ds.length) {
        const id = newId('KT');
        const ghi = await ghiHoaDon(ds, 'xml', id, luc);
        const ra = ds.filter((h) => h.huong === 'ra').length;
        const thongDiep = `${ds.length} hoá đơn (${ra} bán ra, ${ds.length - ra} mua vào) · ${ghi.moi} mới, ${ghi.capNhat} cập nhật`;
        await ghiTaiLen({ id, tenFile: `${ds.length} file XML hoá đơn`, loai: 'Hoá đơn XML', ketQua: thongDiep, nguoi, luc });
        ketQua.push({ ten: `${ds.length} file hoá đơn XML`, loai: 'Hoá đơn XML', ok: true, thongDiep });
      }
    }
  }
  for (let i = 0; i < files.length; i++) {
    if (loaiCua[i] === 'khac') ketQua.push({ ten: files[i]!.ten, loai: 'XML khác', ok: false, thongDiep: 'Không phải hoá đơn hay tờ khai GTGT — bỏ qua (thông báo chấp nhận, tờ khai TNCN…)' });
  }
  return ketQua;
}

/**
 * Lấy hoá đơn MỘT tháng, một hướng từ cổng thuế (anh Tâm 18/10/2026: "các hóa đơn đầu vào sẽ tìm cách lấy từ cổng
 * thuế") rồi ghi. `xong` = false khi tháng quá nhiều hoá đơn, chưa lấy hết trong một lượt (trang gọi lại).
 */
export async function layTuCongThue(token: string, thang: string, huong: 'ra' | 'vao', nguoi: string): Promise<KetQuaTep & { xong: boolean; soHd: number }> {
  const { layHoaDonThang } = await import('./congThue.js');
  const { hoaDon, xong } = await layHoaDonThang(token, thang, huong, Date.now() + 40_000);
  const luc = nowTz().toISOString();
  const id = newId('KT');
  const ghi = hoaDon.length ? await ghiHoaDon(hoaDon, 'cong_thue', id, luc) : { moi: 0, capNhat: 0 };
  const ten = `Cổng thuế · ${huong === 'vao' ? 'mua vào' : 'bán ra'} tháng ${thang.slice(5)}/${thang.slice(0, 4)}`;
  const vat = hoaDon.reduce((s, h) => s + h.tienThue, 0);
  const thongDiep = `${hoaDon.length} hoá đơn (VAT ${tien(vat)}) · ${ghi.moi} mới, ${ghi.capNhat} cập nhật${xong ? '' : ' · chưa hết, đang lấy tiếp'}`;
  if (hoaDon.length) await ghiTaiLen({ id, tenFile: ten, loai: 'Cổng thuế', ketQua: thongDiep, nguoi, luc });
  return { ten, loai: 'Cổng thuế', ok: true, thongDiep, xong, soHd: hoaDon.length };
}

/** Tổng quan một năm: VAT theo quý, TNDN các năm, công nợ, hạn nộp gần nhất. */
export async function tongQuan(nam: number) {
  const [hoaDon, toKhai, baoCao, soThu, soTra, cd, giaoDich, luong] = await Promise.all([
    tatCaHoaDon(),
    tatCaToKhai(),
    tatCaBaoCao(),
    soCongNoMoiNhat('thu'),
    soCongNoMoiNhat('tra'),
    caiDat(),
    tatCaGiaoDich().catch(() => [] as GiaoDich[]),
    tatCaLuong().catch(() => []),
  ]);
  const homNay = nowTz().format('YYYY-MM-DD');
  const quyNay = quyCuaNgay(homNay);
  // Xâu chuỗi số chuyển kỳ từ quý sớm nhất có dữ liệu, rồi lấy các quý của năm đang xem.
  const cacKy = [...hoaDon.map((h) => h.kyKeKhai), ...toKhai.map((t) => t.ky)].filter((k) => /^\d{4}-Q\d$/.test(k)).sort();
  const tuKy = cacKy[0] && cacKy[0] < `${nam}-Q1` ? cacKy[0] : `${nam}-Q1`;
  const denKy = nam < Number(homNay.slice(0, 4)) ? `${nam}-Q4` : quyNay;
  const vatTatCa = denKy >= tuKy ? tinhVatTheoQuy(hoaDon, toKhai, tuKy, denKy) : [];
  const vat = vatTatCa.filter((v) => v.ky.startsWith(`${nam}-`));
  const namCo = [...new Set([2024, ...hoaDon.map((h) => Number(h.ngay.slice(0, 4))), Number(homNay.slice(0, 4))])].filter((n) => n >= 2024).sort();
  const luongNam = (n: number) => luong.filter((x) => x.thang.startsWith(String(n))).reduce((s, x) => s + x.tongThuNhap + x.bhxhCty, 0);
  const tndn = namCo.map((n) => tinhTndn(n, baoCao, hoaDon, cd.namMien, luongNam(n)));
  // Tiền đã thu / đã trả sau ngày chốt sổ (theo sao kê) → trừ công nợ đúng đối tác.
  const ttThu = thanhToanSauChot(giaoDich, soThu?.ngayChot || '', 'thu', doiTacDeKhop(soThu, hoaDon, 'ra'));
  const ttTra = thanhToanSauChot(giaoDich, soTra?.ngayChot || '', 'tra', doiTacDeKhop(soTra, hoaDon, 'vao'));
  const congNoThu = tinhCongNo(soThu, hoaDon, 'thu', ttThu.khop);
  const congNoTra = tinhCongNo(soTra, hoaDon, 'tra', ttTra.khop);
  // Hạn nộp sắp tới: quý gần nhất chưa quá hạn có VAT phải nộp (hoặc quý vừa kết thúc).
  const sapToi = vatTatCa.filter((v) => v.hanNop >= homNay && v.ky < quyNay).sort((a, b) => a.hanNop.localeCompare(b.hanNop))[0] || null;
  return {
    nam,
    homNay,
    quyNay,
    caiDat: cd,
    vat,
    quyDangChay: vatTatCa.find((v) => v.ky === quyNay) || null,
    sapToi,
    tndn,
    congNo: { thu: congNoThu, tra: congNoTra },
    nganHang: {
      taiKhoan: tomTatTaiKhoan(giaoDich),
      /** Tiền vào sau ngày chốt chưa khớp được khách nào (có thể là khách chưa có trong sổ / chuyển nội bộ) */
      tienVaoChuaKhop: ttThu.chuaKhop.slice(-20).reverse(),
      soTienVaoChuaKhop: ttThu.chuaKhop.length,
      canhBao5tr: hoaDonChuaThanhToanNganHang(hoaDon, giaoDich),
    },
    soHoaDon: hoaDon.length,
    coDuLieu: hoaDon.length > 0 || toKhai.length > 0 || !!soThu || !!soTra || giaoDich.length > 0,
  };
}

const LA_MST = /^\d{10}(-\d{3})?$|^\d{12}$/;

/** Đối tác để khớp sao kê: các bên trong sổ công nợ + đối tác trên hoá đơn cùng chiều. */
function doiTacDeKhop(so: SoCongNo | null, hoaDon: HoaDon[], huong: 'ra' | 'vao'): DoiTacKhop[] {
  const ds = new Map<string, DoiTacKhop>();
  for (const d of so?.dong || []) ds.set(d.ma, { ma: d.ma, ten: d.ten, mst: LA_MST.test(d.ma) ? d.ma : '' });
  for (const h of hoaDon) {
    if (h.huong !== huong) continue;
    const k = h.mstDoiTac || h.tenDoiTac;
    if (k && !ds.has(k)) ds.set(k, { ma: k, ten: h.tenDoiTac, mst: h.mstDoiTac });
  }
  return [...ds.values()];
}

/** Giao dịch sau ngày chốt: tiền vào (phải thu) / tiền ra (phải trả) — khớp được đối tác thì trừ công nợ. */
function thanhToanSauChot(
  gd: GiaoDich[],
  chot: string,
  loai: 'thu' | 'tra',
  doiTac: DoiTacKhop[],
): { khop: ThanhToanDoiTac[]; chuaKhop: GiaoDich[] } {
  const khop: ThanhToanDoiTac[] = [];
  const chuaKhop: GiaoDich[] = [];
  if (!chot) return { khop, chuaKhop };
  for (const g of gd) {
    const soTien = loai === 'thu' ? g.ghiCo : g.ghiNo;
    if (!soTien || g.ngay <= chot) continue;
    const d = khopDoiTac(g.noiDung, doiTac);
    if (d) khop.push({ mst: d.mst || (LA_MST.test(d.ma) ? d.ma : ''), ten: d.ten, soTien });
    else chuaKhop.push(g);
  }
  return { khop, chuaKhop };
}

/** Mỗi tài khoản: khoảng ngày có sao kê, tổng vào / ra, số dư cuối. */
function tomTatTaiKhoan(gd: GiaoDich[]) {
  const m = new Map<string, { soTk: string; nganHang: string; tuNgay: string; denNgay: string; soGd: number; tongVao: number; tongRa: number; soDuCuoi: number; cuoi: GiaoDich | null }>();
  for (const g of gd) {
    const k = `${g.nganHang}|${g.soTk}`;
    const x = m.get(k) || { soTk: g.soTk, nganHang: g.nganHang, tuNgay: g.ngay, denNgay: g.ngay, soGd: 0, tongVao: 0, tongRa: 0, soDuCuoi: 0, cuoi: null };
    x.soGd++;
    x.tongVao += g.ghiCo;
    x.tongRa += g.ghiNo;
    if (g.ngay < x.tuNgay) x.tuNgay = g.ngay;
    if (!x.cuoi || g.ngay > x.cuoi.ngay || (g.ngay === x.cuoi.ngay && g.thuTu > x.cuoi.thuTu)) x.cuoi = g;
    x.denNgay = x.cuoi.ngay;
    x.soDuCuoi = x.cuoi.soDu;
    m.set(k, x);
  }
  return [...m.values()].map(({ cuoi: _c, ...x }) => x);
}

/**
 * Hoá đơn đầu vào từ 5 triệu (tổng thanh toán) trong khoảng ngày có sao kê mà chưa thấy chuyển khoản trả — không đủ
 * điều kiện khấu trừ VAT nếu trả tiền mặt (Luật Thuế GTGT 2024, từ 01/7/2025: ngưỡng 5 triệu).
 */
function hoaDonChuaThanhToanNganHang(hoaDon: HoaDon[], gd: GiaoDich[]) {
  const ra = gd.filter((g) => g.ghiNo > 0);
  if (!ra.length) return { so: 0, tongThue: 0, ds: [] as HoaDon[] };
  const tu = ra[0]!.ngay;
  const den = ra[ra.length - 1]!.ngay;
  const lui = (ngay: string, ngayLui: number) => new Date(Date.parse(ngay) - ngayLui * 86400_000).toISOString().slice(0, 10);
  const ds = hoaDon.filter((h) => {
    if (h.huong !== 'vao' || !hoaDonHieuLuc(h.trangThai) || h.tongTien < 5_000_000 || h.ngay < tu || h.ngay > den) return false;
    const dt = [{ ma: h.mstDoiTac || h.tenDoiTac, ten: h.tenDoiTac, mst: h.mstDoiTac }];
    const tuNgay = lui(h.ngay, 30);
    return !ra.some((g) => g.ngay >= tuNgay && (Math.abs(g.ghiNo - h.tongTien) <= 1000 || !!khopDoiTac(g.noiDung, dt)));
  });
  return { so: ds.length, tongThue: ds.reduce((s, h) => s + h.tienThue, 0), ds: ds.slice(0, 30) };
}

// ── AI đọc file lạ (anh Tâm 18/10/2026: "cho AI vào đọc file luôn đỡ phải setup định dạng") ──

const SO_COT = { type: 'INTEGER' };
const NHIEU_COT = { type: 'ARRAY', items: { type: 'INTEGER' } };

const SCHEMA_BAN_DO = {
  type: 'OBJECT',
  properties: {
    loai: { type: 'STRING', enum: ['hoa_don', 'sao_ke', 'cong_no', 'kqkd', 'bang_luong', 'khac'] },
    moTa: { type: 'STRING' },
    bang: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sheet: { type: 'STRING' },
          dongDuLieu: { type: 'INTEGER' },
          huong: { type: 'STRING' },
          cot: {
            type: 'OBJECT',
            properties: {
              ngay: SO_COT, kyHieu: SO_COT, soHd: SO_COT, mauSo: SO_COT, mst: SO_COT, ten: SO_COT, dienGiai: SO_COT,
              tienHang: SO_COT, tienThue: SO_COT, tongTien: SO_COT, thueSuat: SO_COT, trangThai: SO_COT,
              noiDung: SO_COT, no: SO_COT, co: SO_COT, soTien: SO_COT, soDu: SO_COT, soRef: SO_COT,
              ma: SO_COT, duNo: SO_COT, duCo: SO_COT,
              thang: SO_COT, tongThuNhap: SO_COT, bhxhCty: NHIEU_COT, bhxhNld: NHIEU_COT, tncn: SO_COT, thucNhan: SO_COT,
            },
          },
        },
        required: ['sheet', 'dongDuLieu', 'cot'],
      },
    },
    nganHang: { type: 'STRING' },
    soTk: { type: 'STRING' },
    loaiCongNo: { type: 'STRING' },
    ngayChot: { type: 'STRING' },
    tuNgay: { type: 'STRING' },
    denNgay: { type: 'STRING' },
    nam: { type: 'INTEGER' },
    doanhThu: { type: 'NUMBER' },
    loiNhuanTruocThue: { type: 'NUMBER' },
  },
  required: ['loai', 'moTa', 'bang'],
};

function loiNhacBanDo(ten: string, xem: string, mst: string): string {
  return [
    `Bạn là kế toán của công ty TNHH DỊCH VỤ MT DIGITAL${mst ? ` (MST ${mst})` : ''}. Dưới đây là PHẦN ĐẦU một file Excel kế toán`,
    `tên "${ten}" (mỗi ô ghi [chỉ số cột]giá trị; số dài đã che bằng #). Xác định file là loại gì và cột nào chứa gì, để`,
    'chương trình tự đọc TOÀN BỘ file theo đúng các cột đó. KHÔNG chép số liệu từng dòng.',
    '',
    'loai:',
    '- "hoa_don": danh sách / bảng kê hoá đơn. Mỗi sheet hoá đơn ghi huong = "ra" (công ty BÁN — cột khách hàng / người mua)',
    '  hoặc "vao" (công ty MUA — cột người bán). Cột: ngay (ngày hoá đơn), kyHieu, soHd, mauSo (nếu tách riêng), mst (của',
    '  đối tác), ten (đối tác), dienGiai, tienHang (chưa thuế), tienThue (thuế GTGT — KHÔNG phải thuế xuất khẩu), tongTien,',
    '  thueSuat, trangThai.',
    '- "sao_ke": sao kê / sổ phụ ngân hàng. Cột: ngay, noiDung, no (tiền ra / ghi nợ), co (tiền vào / ghi có) — hoặc soTien',
    '  nếu chỉ một cột có dấu; soDu, soRef. Ghi nganHang và soTk nếu thấy (số TK bị che thì để trống).',
    '- "cong_no": tổng hợp công nợ. loaiCongNo = "thu" (phải thu khách, TK 131) / "tra" (phải trả nhà cung cấp, TK 331);',
    '  ngayChot = ngày cuối kỳ (YYYY-MM-DD), tuNgay. Cột: ma, ten, duNo, duCo (số dư CUỐI kỳ).',
    '- "kqkd": báo cáo kết quả kinh doanh — ghi tuNgay, denNgay, doanhThu (mã 01), loiNhuanTruocThue (mã 50) đọc từ cột kỳ này.',
    '- "bang_luong": bảng lương / BHXH. Cột: thang (cột tháng, vd "T01"), ten (họ tên), tongThuNhap (TỔNG thu nhập trước',
    '  khấu trừ: lương + phụ cấp + thưởng), bhxhCty (MỌI cột BHXH/BHYT/BHTN/KPCĐ phần DOANH NGHIỆP đóng — thường 17%, 3%,',
    '  1%, 0,5%), bhxhNld (các cột phần NGƯỜI LAO ĐỘNG đóng — thường 8%, 1,5%, 1%), tncn (thuế TNCN), thucNhan. Ghi nam',
    '  nếu cột tháng không có năm (lấy từ tên sheet / cột kỳ kê khai).',
    '- "khac": không phải các loại trên (danh sách nhân viên, quy định KPI…).',
    '',
    'bang: các sheet chứa dữ liệu chính (bỏ sheet phụ / trống). dongDuLieu = số dòng (theo "dòng i") của DÒNG DỮ LIỆU ĐẦU',
    'TIÊN, sau mọi dòng tiêu đề / dòng tổng / dòng tỉ lệ %. Cột ghi bằng chỉ số [j]; cột không có thì bỏ trống.',
    'Ngày ghi YYYY-MM-DD. moTa: một câu tiếng Việt mô tả file.',
    '',
    xem,
  ].join('\n');
}

async function nhapBangAi(ten: string, sheets: SheetDuLieu[], nguoi: string): Promise<KetQuaTep> {
  const { aiKhoJson } = await import('../ai/brainAi.js');
  const cd = await caiDat();
  const bd = (await aiKhoJson(loiNhacBanDo(ten, xemTruoc(sheets), cd.mst), SCHEMA_BAN_DO)) as BanDoAi;
  if (!bd || !Array.isArray(bd.bang)) throw new Error('AI không trả bản đồ cột');
  const id = newId('KT');
  const luc = nowTz().toISOString();
  const nhan = (l: string) => `${l} (AI nhận dạng)`;
  let kq: KetQuaTep;
  if (bd.loai === 'hoa_don') {
    const hoaDon = hoaDonTheoBanDo(sheets, bd);
    if (!hoaDon.length) throw new Error(`AI nhận là hoá đơn ("${bd.moTa}") nhưng không đọc ra dòng nào`);
    const ghi = await ghiHoaDon(hoaDon, 'ai', id, luc);
    const ra = hoaDon.filter((h) => h.huong === 'ra');
    const vao = hoaDon.filter((h) => h.huong === 'vao');
    kq = {
      ten,
      loai: nhan('Hoá đơn'),
      ok: true,
      thongDiep: `${ra.length} HĐ bán ra (VAT ${tien(ra.reduce((s, h) => s + h.tienThue, 0))}), ${vao.length} HĐ mua vào (VAT ${tien(vao.reduce((s, h) => s + h.tienThue, 0))}) · ${ghi.moi} mới, ${ghi.capNhat} cập nhật`,
    };
  } else if (bd.loai === 'sao_ke') {
    const gd = giaoDichTheoBanDo(sheets, bd);
    if (!gd.length) throw new Error(`AI nhận là sao kê ("${bd.moTa}") nhưng không đọc ra giao dịch nào`);
    const ghi = await ghiGiaoDich(gd, id);
    const ngay = gd.map((g) => g.ngay).sort();
    kq = {
      ten,
      loai: nhan(`Sao kê ${bd.nganHang || 'ngân hàng'}`),
      ok: true,
      thongDiep: `${gd.length} giao dịch ${ngay[0]} → ${ngay[ngay.length - 1]} · vào ${tien(gd.reduce((s, g) => s + g.ghiCo, 0))}, ra ${tien(gd.reduce((s, g) => s + g.ghiNo, 0))} · ${ghi.moi} mới, ${ghi.trung} đã có`,
    };
  } else if (bd.loai === 'cong_no') {
    const so = congNoTheoBanDo(sheets, bd);
    if (!so) throw new Error(`AI nhận là công nợ ("${bd.moTa}") nhưng thiếu loại (thu / trả) hoặc ngày chốt`);
    const n = await ghiCongNo(so, id);
    kq = { ten, loai: nhan(so.loai === 'thu' ? 'Công nợ phải thu' : 'Công nợ phải trả'), ok: true, thongDiep: `${n} đối tác, chốt ngày ${so.ngayChot}` };
  } else if (bd.loai === 'kqkd') {
    const b = kqkdTheoBanDo(bd);
    if (!b) throw new Error('AI nhận là báo cáo kết quả kinh doanh nhưng thiếu kỳ / lợi nhuận');
    await ghiBaoCao(b, id, luc);
    kq = {
      ten,
      loai: nhan('Báo cáo kết quả kinh doanh'),
      ok: true,
      thongDiep: `Kỳ ${b.tuNgay} → ${b.denNgay} · doanh thu ${tien(b.chiTieu['01'] ?? 0)}, LN trước thuế ${tien(b.chiTieu['50'] ?? 0)}`,
    };
  } else if (bd.loai === 'bang_luong') {
    const luong = luongTheoBanDo(sheets, bd);
    if (!luong.length) throw new Error(`AI nhận là bảng lương ("${bd.moTa}") nhưng không cộng được tháng nào`);
    await ghiLuong(luong, id, luc);
    const tong = luong.reduce((s, x) => s + x.tongThuNhap, 0);
    const bh = luong.reduce((s, x) => s + x.bhxhCty, 0);
    kq = {
      ten,
      loai: nhan('Bảng lương'),
      ok: true,
      thongDiep: `${luong.length} tháng (${luong.map((x) => `${x.thang.slice(5)}/${x.thang.slice(0, 4)}`).join(', ')}) · tổng thu nhập ${tien(tong)}, BHXH công ty đóng ${tien(bh)}`,
    };
  } else {
    return { ten, loai: 'Không dùng cho số liệu thuế', ok: false, thongDiep: `AI đọc: ${bd.moTa || 'không phải hoá đơn / sao kê / công nợ / báo cáo / bảng lương'}` };
  }
  await ghiTaiLen({ id, tenFile: ten, loai: kq.loai, ketQua: kq.thongDiep, nguoi, luc });
  return kq;
}
