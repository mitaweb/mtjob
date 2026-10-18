// Kế toán thuế — đọc/ghi DB. Ghi hàng loạt (một câu INSERT nhiều dòng mỗi lô), tải lại file trùng không nhân đôi.
import { q } from '../db/client.js';
import type { HoaDon, ToKhaiGtgt, SoCongNo, BaoCaoKqkd, Huong } from '../lib/keToan.js';
import { khoaHoaDon } from '../lib/keToan.js';
import type { GiaoDich } from '../lib/saoKe.js';
import type { LuongThang } from '../lib/docAi.js';

const LO = 200;

export async function ghiHoaDon(ds: HoaDon[], nguon: string, taiLenId: string, luc: string): Promise<{ moi: number; capNhat: number }> {
  // Trùng khoá trong cùng lô → giữ bản sau.
  const theoKhoa = new Map(ds.map((h) => [khoaHoaDon(h), h]));
  const tat = [...theoKhoa.entries()];
  let moi = 0;
  let capNhat = 0;
  for (let i = 0; i < tat.length; i += LO) {
    const lo = tat.slice(i, i + LO);
    const params: unknown[] = [];
    const vals = lo.map(([khoa, h]) => {
      const b = params.length;
      params.push(
        khoa, h.huong, h.mauSo, h.kyHieu, h.soHd, h.ngay, h.mstDoiTac, h.tenDoiTac, h.dienGiai,
        h.tienHang, h.tienThue, h.tongTien, h.thueSuat, h.trangThai, h.kyKeKhai, nguon, taiLenId, luc,
      );
      return `(${Array.from({ length: 18 }, (_, j) => `$${b + j + 1}`).join(', ')})`;
    });
    const rows = await q(
      `INSERT INTO kt_hoa_don (khoa, huong, mau_so, ky_hieu, so_hd, ngay, mst_doi_tac, ten_doi_tac, dien_giai,
         tien_hang, tien_thue, tong_tien, thue_suat, trang_thai, ky_ke_khai, nguon, tai_len_id, cap_nhat)
       VALUES ${vals.join(', ')}
       -- Tải lại = CẬP NHẬT, không xoá (anh Tâm 18/10/2026: "chỉ là nội dung cập nhật, ghi đè thôi, không phải xóa hoàn
       -- toàn nội dung cũ"): ô trống / tiền 0 ở nguồn mới thì giữ số cũ; cột thanh_toan (anh tự đánh dấu) không bao giờ đụng.
       ON CONFLICT (khoa) DO UPDATE SET huong = EXCLUDED.huong, mau_so = EXCLUDED.mau_so, ky_hieu = EXCLUDED.ky_hieu,
         so_hd = EXCLUDED.so_hd, ngay = COALESCE(NULLIF(EXCLUDED.ngay, ''), kt_hoa_don.ngay),
         mst_doi_tac = COALESCE(NULLIF(EXCLUDED.mst_doi_tac, ''), kt_hoa_don.mst_doi_tac),
         ten_doi_tac = COALESCE(NULLIF(EXCLUDED.ten_doi_tac, ''), kt_hoa_don.ten_doi_tac),
         dien_giai = COALESCE(NULLIF(EXCLUDED.dien_giai, ''), kt_hoa_don.dien_giai),
         tien_hang = CASE WHEN EXCLUDED.tong_tien = 0 AND kt_hoa_don.tong_tien <> 0 THEN kt_hoa_don.tien_hang ELSE EXCLUDED.tien_hang END,
         tien_thue = CASE WHEN EXCLUDED.tong_tien = 0 AND kt_hoa_don.tong_tien <> 0 THEN kt_hoa_don.tien_thue ELSE EXCLUDED.tien_thue END,
         tong_tien = CASE WHEN EXCLUDED.tong_tien = 0 AND kt_hoa_don.tong_tien <> 0 THEN kt_hoa_don.tong_tien ELSE EXCLUDED.tong_tien END,
         thue_suat = COALESCE(NULLIF(EXCLUDED.thue_suat, ''), kt_hoa_don.thue_suat),
         trang_thai = COALESCE(NULLIF(EXCLUDED.trang_thai, ''), kt_hoa_don.trang_thai),
         -- Kỳ kê khai THỰC TẾ do kế toán ghi trong bảng kê (có thể kê muộn sang quý sau) — nguồn khác (cổng thuế, XML)
         -- chỉ biết ngày lập nên không được ghi đè.
         ky_ke_khai = CASE WHEN kt_hoa_don.nguon = 'bang_ke' AND EXCLUDED.nguon <> 'bang_ke' THEN kt_hoa_don.ky_ke_khai ELSE EXCLUDED.ky_ke_khai END,
         nguon = CASE WHEN kt_hoa_don.nguon = 'bang_ke' THEN 'bang_ke' ELSE EXCLUDED.nguon END,
         tai_len_id = EXCLUDED.tai_len_id, cap_nhat = EXCLUDED.cap_nhat
       RETURNING (xmax = 0) AS moi`,
      params,
    );
    for (const r of rows) (r.moi ? moi++ : capNhat++);
  }
  return { moi, capNhat };
}

function rowToHoaDon(r: Record<string, unknown>): HoaDon {
  return {
    huong: r.huong === 'ra' ? 'ra' : 'vao',
    mauSo: String(r.mau_so || ''),
    kyHieu: String(r.ky_hieu || ''),
    soHd: String(r.so_hd || ''),
    ngay: String(r.ngay || ''),
    mstDoiTac: String(r.mst_doi_tac || ''),
    tenDoiTac: String(r.ten_doi_tac || ''),
    dienGiai: String(r.dien_giai || ''),
    tienHang: Number(r.tien_hang) || 0,
    tienThue: Number(r.tien_thue) || 0,
    tongTien: Number(r.tong_tien) || 0,
    thueSuat: String(r.thue_suat || ''),
    trangThai: String(r.trang_thai || ''),
    kyKeKhai: String(r.ky_ke_khai || ''),
    khoa: String(r.khoa || ''),
    thanhToan: String(r.thanh_toan || ''),
  };
}

/** Mọi hoá đơn (dùng để tính VAT / TNDN / công nợ — vài nghìn dòng mỗi năm, đọc hết một lần). */
export async function tatCaHoaDon(): Promise<HoaDon[]> {
  return (await q('SELECT * FROM kt_hoa_don ORDER BY ngay')).map(rowToHoaDon);
}

export async function trangHoaDon(o: {
  huong?: Huong;
  ky?: string;
  tim?: string;
  page: number;
  size: number;
}): Promise<{ ds: Array<HoaDon & { khoa: string; nguon: string }>; tong: number; tongTienHang: number; tongThue: number }> {
  const dk: string[] = [];
  const p: unknown[] = [];
  if (o.huong) {
    p.push(o.huong);
    dk.push(`huong = $${p.length}`);
  }
  if (o.ky) {
    p.push(o.ky);
    dk.push(`ky_ke_khai = $${p.length}`);
  }
  if (o.tim?.trim()) {
    p.push(`%${o.tim.trim()}%`);
    dk.push(`(ten_doi_tac ILIKE $${p.length} OR mst_doi_tac ILIKE $${p.length} OR so_hd ILIKE $${p.length} OR dien_giai ILIKE $${p.length})`);
  }
  const where = dk.length ? `WHERE ${dk.join(' AND ')}` : '';
  const [dem, rows] = await Promise.all([
    q(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(tien_hang), 0)::bigint AS th, COALESCE(SUM(tien_thue), 0)::bigint AS tt
       FROM kt_hoa_don ${where}`,
      p,
    ),
    q(`SELECT * FROM kt_hoa_don ${where} ORDER BY ngay DESC, so_hd DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [
      ...p,
      o.size,
      (o.page - 1) * o.size,
    ]),
  ]);
  return {
    ds: rows.map((r) => ({ ...rowToHoaDon(r), khoa: String(r.khoa), nguon: String(r.nguon || '') })),
    tong: Number(dem[0]?.n) || 0,
    tongTienHang: Number(dem[0]?.th) || 0,
    tongThue: Number(dem[0]?.tt) || 0,
  };
}

export async function ghiToKhai(t: ToKhaiGtgt, taiLenId: string, luc: string): Promise<void> {
  await q(
    `INSERT INTO kt_to_khai (khoa, ky, loai, so_lan, ngay_lap, chi_tieu, tai_len_id, cap_nhat)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (khoa) DO UPDATE SET loai = EXCLUDED.loai, ngay_lap = EXCLUDED.ngay_lap, chi_tieu = EXCLUDED.chi_tieu,
       tai_len_id = EXCLUDED.tai_len_id, cap_nhat = EXCLUDED.cap_nhat`,
    [`gtgt|${t.ky}|${t.soLan}`, t.ky, t.loai, t.soLan, t.ngayLap, JSON.stringify(t.ct), taiLenId, luc],
  );
}

export async function tatCaToKhai(): Promise<ToKhaiGtgt[]> {
  const rows = await q('SELECT * FROM kt_to_khai ORDER BY ky, so_lan');
  return rows.map((r) => {
    let ct: Record<string, number> = {};
    try {
      ct = JSON.parse(String(r.chi_tieu || '{}'));
    } catch {
      /* hỏng thì bỏ */
    }
    return { ky: String(r.ky), loai: String(r.loai || 'C'), soLan: Number(r.so_lan) || 0, ngayLap: String(r.ngay_lap || ''), mst: '', ct };
  });
}

/**
 * Sổ công nợ tại một ngày chốt: CẬP NHẬT từng đối tác có trong file (ghi đè số mới), KHÔNG xoá dòng cũ — anh Tâm
 * 18/10/2026: "chỉ là nội dung cập nhật, ghi đè thôi, không phải xóa hoàn toàn nội dung cũ".
 */
export async function ghiCongNo(so: SoCongNo, taiLenId: string): Promise<number> {
  for (let i = 0; i < so.dong.length; i += LO) {
    const lo = so.dong.slice(i, i + LO);
    const params: unknown[] = [];
    const vals = lo.map((d) => {
      const b = params.length;
      params.push(so.loai, so.ngayChot, d.ma, d.ten, d.duNoDau, d.duCoDau, d.psNo, d.psCo, d.duNo, d.duCo, so.tuNgay, taiLenId);
      return `(${Array.from({ length: 12 }, (_, j) => `$${b + j + 1}`).join(', ')})`;
    });
    await q(
      `INSERT INTO kt_cong_no (loai, ngay_chot, ma, ten, du_no_dau, du_co_dau, ps_no, ps_co, du_no, du_co, tu_ngay, tai_len_id)
       VALUES ${vals.join(', ')}
       ON CONFLICT (loai, ngay_chot, ma) DO UPDATE SET ten = COALESCE(NULLIF(EXCLUDED.ten, ''), kt_cong_no.ten), du_no = EXCLUDED.du_no, du_co = EXCLUDED.du_co,
         ps_no = EXCLUDED.ps_no, ps_co = EXCLUDED.ps_co, du_no_dau = EXCLUDED.du_no_dau, du_co_dau = EXCLUDED.du_co_dau`,
      params,
    );
  }
  return so.dong.length;
}

/** Sổ công nợ có ngày chốt MỚI NHẤT của một loại. */
export async function soCongNoMoiNhat(loai: 'thu' | 'tra'): Promise<SoCongNo | null> {
  const rows = await q(
    `SELECT * FROM kt_cong_no WHERE loai = $1 AND ngay_chot = (SELECT MAX(ngay_chot) FROM kt_cong_no WHERE loai = $1) ORDER BY ma`,
    [loai],
  );
  if (!rows.length) return null;
  return {
    loai,
    tuNgay: String(rows[0]!.tu_ngay || ''),
    ngayChot: String(rows[0]!.ngay_chot),
    dong: rows.map((r) => ({
      ma: String(r.ma),
      ten: String(r.ten || ''),
      duNoDau: Number(r.du_no_dau) || 0,
      duCoDau: Number(r.du_co_dau) || 0,
      psNo: Number(r.ps_no) || 0,
      psCo: Number(r.ps_co) || 0,
      duNo: Number(r.du_no) || 0,
      duCo: Number(r.du_co) || 0,
    })),
  };
}

export async function ghiBaoCao(b: BaoCaoKqkd, taiLenId: string, luc: string): Promise<void> {
  await q(
    `INSERT INTO kt_bao_cao (khoa, loai, tu_ngay, den_ngay, chi_tieu, tai_len_id, cap_nhat) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (khoa) DO UPDATE SET chi_tieu = EXCLUDED.chi_tieu, tai_len_id = EXCLUDED.tai_len_id, cap_nhat = EXCLUDED.cap_nhat`,
    [`${b.nguon || 'kqkd'}|${b.tuNgay}|${b.denNgay}`, b.nguon || 'kqkd', b.tuNgay, b.denNgay, JSON.stringify(b.chiTieu), taiLenId, luc],
  );
}

export async function tatCaBaoCao(): Promise<BaoCaoKqkd[]> {
  const rows = await q(`SELECT * FROM kt_bao_cao WHERE loai IN ('kqkd', 'ke_toan') ORDER BY tu_ngay, den_ngay`);
  return rows.map((r) => {
    let chiTieu: Record<string, number> = {};
    try {
      chiTieu = JSON.parse(String(r.chi_tieu || '{}'));
    } catch {
      /* hỏng thì bỏ */
    }
    return { tuNgay: String(r.tu_ngay), denNgay: String(r.den_ngay), chiTieu, nguon: r.loai === 'ke_toan' ? ('ke_toan' as const) : ('kqkd' as const) };
  });
}

export async function ghiTaiLen(t: { id: string; tenFile: string; loai: string; ketQua: string; nguoi: string; luc: string }): Promise<void> {
  await q('INSERT INTO kt_tai_len (id, ten_file, loai, ket_qua, nguoi, luc) VALUES ($1, $2, $3, $4, $5, $6)', [
    t.id,
    t.tenFile.slice(0, 300),
    t.loai,
    t.ketQua.slice(0, 500),
    t.nguoi,
    t.luc,
  ]);
}

export async function lichSuTaiLen(limit = 30): Promise<Array<{ id: string; tenFile: string; loai: string; ketQua: string; luc: string }>> {
  const rows = await q('SELECT * FROM kt_tai_len ORDER BY luc DESC LIMIT $1', [limit]);
  return rows.map((r) => ({ id: String(r.id), tenFile: String(r.ten_file || ''), loai: String(r.loai || ''), ketQua: String(r.ket_qua || ''), luc: String(r.luc || '') }));
}

export async function docCaiDat(): Promise<Record<string, string>> {
  const rows = await q('SELECT khoa, gia_tri FROM kt_cai_dat');
  return Object.fromEntries(rows.map((r) => [String(r.khoa), String(r.gia_tri || '')]));
}

export async function ghiCaiDat(khoa: string, giaTri: string): Promise<void> {
  await q(
    'INSERT INTO kt_cai_dat (khoa, gia_tri) VALUES ($1, $2) ON CONFLICT (khoa) DO UPDATE SET gia_tri = EXCLUDED.gia_tri',
    [khoa, giaTri],
  );
}

// ── Sao kê ngân hàng ──

export async function ghiGiaoDich(ds: GiaoDich[], taiLenId: string): Promise<{ moi: number; trung: number }> {
  const theoId = new Map(ds.map((g) => [g.id, g]));
  const tat = [...theoId.values()];
  let moi = 0;
  for (let i = 0; i < tat.length; i += LO) {
    const lo = tat.slice(i, i + LO);
    const params: unknown[] = [];
    const vals = lo.map((g) => {
      const b = params.length;
      params.push(g.id, g.soTk, g.nganHang, g.ngay, g.ghiNo, g.ghiCo, g.soDu, g.noiDung, g.soRef, g.thuTu, taiLenId, g.doiTac || '');
      return `(${Array.from({ length: 12 }, (_, j) => `$${b + j + 1}`).join(', ')})`;
    });
    // Giao dịch đã có: chỉ điền thêm tên đối tác nếu trước chưa có (sao kê tải trước khi app đọc cột này).
    const rows = await q(
      `INSERT INTO kt_giao_dich (id, so_tk, ngan_hang, ngay, ghi_no, ghi_co, so_du, noi_dung, so_ref, thu_tu, tai_len_id, doi_tac)
       VALUES ${vals.join(', ')}
       ON CONFLICT (id) DO UPDATE SET doi_tac = EXCLUDED.doi_tac
         WHERE COALESCE(kt_giao_dich.doi_tac, '') = '' AND EXCLUDED.doi_tac <> ''
       RETURNING (xmax = 0) AS moi`,
      params,
    );
    moi += rows.filter((r) => r.moi).length;
  }
  return { moi, trung: tat.length - moi };
}

function rowToGiaoDich(r: Record<string, unknown>): GiaoDich {
  return {
    id: String(r.id),
    soTk: String(r.so_tk || ''),
    nganHang: String(r.ngan_hang || ''),
    ngay: String(r.ngay || ''),
    ghiNo: Number(r.ghi_no) || 0,
    ghiCo: Number(r.ghi_co) || 0,
    soDu: Number(r.so_du) || 0,
    noiDung: String(r.noi_dung || ''),
    soRef: String(r.so_ref || ''),
    doiTac: String(r.doi_tac || ''),
    thuTu: Number(r.thu_tu) || 0,
  };
}

export async function tatCaGiaoDich(): Promise<GiaoDich[]> {
  return (await q('SELECT * FROM kt_giao_dich ORDER BY ngay, thu_tu')).map(rowToGiaoDich);
}

export async function trangGiaoDich(o: { loai?: 'vao' | 'ra'; tim?: string; page: number; size: number }): Promise<{ ds: GiaoDich[]; tong: number }> {
  const dk: string[] = [];
  const p: unknown[] = [];
  if (o.loai === 'vao') dk.push('ghi_co > 0');
  if (o.loai === 'ra') dk.push('ghi_no > 0');
  if (o.tim?.trim()) {
    p.push(`%${o.tim.trim()}%`);
    dk.push(`(noi_dung ILIKE $${p.length} OR so_ref ILIKE $${p.length} OR doi_tac ILIKE $${p.length})`);
  }
  const where = dk.length ? `WHERE ${dk.join(' AND ')}` : '';
  const [dem, rows] = await Promise.all([
    q(`SELECT COUNT(*)::int AS n FROM kt_giao_dich ${where}`, p),
    q(`SELECT * FROM kt_giao_dich ${where} ORDER BY ngay DESC, thu_tu DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [...p, o.size, (o.page - 1) * o.size]),
  ]);
  return { ds: rows.map(rowToGiaoDich), tong: Number(dem[0]?.n) || 0 };
}

// ── Bảng lương theo tháng (AI đọc file lương / BHXH) ──

/** Ghi đè từng tháng có trong file (tải lại bảng lương mới thay số cũ của tháng đó). */
export async function ghiLuong(ds: LuongThang[], taiLenId: string, luc: string): Promise<void> {
  for (const x of ds) {
    await q(
      `INSERT INTO kt_luong (thang, so_nguoi, tong_thu_nhap, bhxh_cty, bhxh_nld, tncn, thuc_nhan, tai_len_id, cap_nhat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (thang) DO UPDATE SET so_nguoi = EXCLUDED.so_nguoi, tong_thu_nhap = EXCLUDED.tong_thu_nhap,
         bhxh_cty = EXCLUDED.bhxh_cty, bhxh_nld = EXCLUDED.bhxh_nld, tncn = EXCLUDED.tncn, thuc_nhan = EXCLUDED.thuc_nhan,
         tai_len_id = EXCLUDED.tai_len_id, cap_nhat = EXCLUDED.cap_nhat`,
      [x.thang, x.soNguoi, x.tongThuNhap, x.bhxhCty, x.bhxhNld, x.tncn, x.thucNhan, taiLenId, luc],
    );
  }
}

export async function tatCaLuong(): Promise<LuongThang[]> {
  const rows = await q('SELECT * FROM kt_luong ORDER BY thang');
  return rows.map((r) => ({
    thang: String(r.thang),
    soNguoi: Number(r.so_nguoi) || 0,
    tongThuNhap: Number(r.tong_thu_nhap) || 0,
    bhxhCty: Number(r.bhxh_cty) || 0,
    bhxhNld: Number(r.bhxh_nld) || 0,
    tncn: Number(r.tncn) || 0,
    thucNhan: Number(r.thuc_nhan) || 0,
  }));
}

// ── Việc kế toán cần giám đốc xác nhận / bổ sung (AI tách từ thư kế toán gửi) ──

export interface ViecKeToan {
  id: string;
  /** xac_nhan_cong_no | bo_sung_hoa_don | xac_nhan_giao_dich | khac */
  loai: string;
  noiDung: string;
  soTien: number;
  doiTac: string;
  ngay: string;
  xong: boolean;
  taoLuc: string;
}

export async function ghiViec(ds: Array<Omit<ViecKeToan, 'xong' | 'taoLuc'>>, luc: string): Promise<number> {
  let moi = 0;
  for (const v of ds) {
    const r = await q(
      `INSERT INTO kt_viec (id, loai, noi_dung, so_tien, doi_tac, ngay, xong, tao_luc) VALUES ($1, $2, $3, $4, $5, $6, false, $7)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [v.id, v.loai, v.noiDung.slice(0, 1000), v.soTien, v.doiTac.slice(0, 200), v.ngay, luc],
    );
    moi += r.length;
  }
  return moi;
}

export async function dsViec(): Promise<ViecKeToan[]> {
  const rows = await q('SELECT * FROM kt_viec ORDER BY xong, tao_luc DESC LIMIT 200');
  return rows.map((r) => ({
    id: String(r.id),
    loai: String(r.loai || 'khac'),
    noiDung: String(r.noi_dung || ''),
    soTien: Number(r.so_tien) || 0,
    doiTac: String(r.doi_tac || ''),
    ngay: String(r.ngay || ''),
    xong: !!r.xong,
    taoLuc: String(r.tao_luc || ''),
  }));
}

export async function datXongViec(id: string, xong: boolean): Promise<void> {
  await q('UPDATE kt_viec SET xong = $2 WHERE id = $1', [id, xong]);
}

/** Anh đánh dấu cách trả một hoá đơn đầu vào ('' = để app tự xét). Tải lại hoá đơn không ghi đè. */
export async function datThanhToanHoaDon(khoa: string, cach: '' | 'tien_mat' | 'ngan_hang'): Promise<boolean> {
  const r = await q('UPDATE kt_hoa_don SET thanh_toan = $2 WHERE khoa = $1 RETURNING khoa', [khoa, cach]);
  return r.length > 0;
}
