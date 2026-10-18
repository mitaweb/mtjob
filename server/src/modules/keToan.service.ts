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
} from './keToan.repo.js';
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
export async function nhapBang(ten: string, sheets: SheetDuLieu[], nguoi: string): Promise<KetQuaTep> {
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
  } else {
    kq = {
      ten,
      loai: 'Chưa nhận dạng',
      ok: false,
      thongDiep: 'Chưa nhận ra loại file — hiện đọc được: bảng kê MV-BR, tổng hợp công nợ 131/331, báo cáo kết quả kinh doanh',
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

/** Tổng quan một năm: VAT theo quý, TNDN các năm, công nợ, hạn nộp gần nhất. */
export async function tongQuan(nam: number) {
  const [hoaDon, toKhai, baoCao, soThu, soTra, cd] = await Promise.all([
    tatCaHoaDon(),
    tatCaToKhai(),
    tatCaBaoCao(),
    soCongNoMoiNhat('thu'),
    soCongNoMoiNhat('tra'),
    caiDat(),
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
  const tndn = namCo.map((n) => tinhTndn(n, baoCao, hoaDon, cd.namMien));
  const congNoThu = tinhCongNo(soThu, hoaDon, 'thu');
  const congNoTra = tinhCongNo(soTra, hoaDon, 'tra');
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
    soHoaDon: hoaDon.length,
    coDuLieu: hoaDon.length > 0 || toKhai.length > 0 || !!soThu || !!soTra,
  };
}
