// Trang "Kết nối MCP" — chỉ số cơ bản cho các phòng ban (anh Tâm 11/11/2026: "đưa riêng phần MCP, kết nối nền tảng ra
// riêng để các phòng ban có thể sử dụng, xem đc các chỉ số cơ bản").
//  - Giám đốc: lấy danh sách tài sản từ các kết nối (Meta Ads, Google Ads, GA4, Search Console), giao cho phòng, gắn
//    khách, bật theo dõi.
//  - Chuỗi cron: tài sản đang theo dõi đồng bộ số 35 ngày gần nhất (6 tiếng / lần) vào nen_tang_so_lieu.
//  - Mọi người: xem 7 ngày so 7 ngày trước + biểu đồ 30 ngày của tài sản giao cho phòng mình (giám đốc xem hết).
import { q } from '../db/client.js';
import { nowTz, todayIso } from '../lib/datetime.js';
import { ApiError } from '../util/errors.js';
import { dongMeta, dongGads, dongGa4, dongGsc, tomTatChiSo, gopTheoNgay, xemDuoc, LOAI_TAI_SAN, type DongSo, type LoaiTaiSan, type TomTat } from '../lib/nenTang.js';

export interface TaiSanNt {
  id: string;
  loai: LoaiTaiSan;
  maNgoai: string;
  ten: string;
  ghiChu: string;
  tienTe: string;
  teamId: string;
  khach: string;
  theoDoi: boolean;
  dongBoCuoi: number;
  loi: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowTo(r: any): TaiSanNt {
  return {
    id: String(r.id),
    loai: r.loai as LoaiTaiSan,
    maNgoai: String(r.ma_ngoai || ''),
    ten: String(r.ten || ''),
    ghiChu: String(r.ghi_chu || ''),
    tienTe: String(r.tien_te || ''),
    teamId: String(r.team_id || ''),
    khach: String(r.khach || ''),
    theoDoi: !!r.theo_doi,
    dongBoCuoi: Number(r.dong_bo_cuoi) || 0,
    loi: String(r.loi || ''),
  };
}

export async function dsTaiSan(): Promise<TaiSanNt[]> {
  return (await q('SELECT * FROM nen_tang_tai_san ORDER BY loai, ten')).map(rowTo);
}

/**
 * Lấy lại danh sách tài sản từ các kết nối. Tài sản mới thêm vào (chưa giao phòng, chưa theo dõi); tài sản đã có chỉ
 * cập nhật tên / ghi chú — phòng, khách, theo dõi anh đã chọn giữ nguyên.
 */
export async function lamMoiTaiSan(): Promise<{ so: number; loi: string[] }> {
  const k = await import('./ketNoi.service.js');
  const nguon: Array<[LoaiTaiSan, () => Promise<Array<{ id: string; ten: string; ghiChu?: string }>>]> = [
    ['meta', k.metaTaiSan],
    ['gads', k.gadsTaiKhoan],
    ['ga4', k.ga4TaiSan],
    ['gsc', k.gscTaiSan],
  ];
  const coKetNoi = new Set((await k.dsKetNoi()).map((x) => x.nenTang));
  const kq = { so: 0, loi: [] as string[] };
  const luc = nowTz().toISOString();
  for (const [loai, f] of nguon) {
    if (!coKetNoi.has(loai === 'meta' ? 'meta' : 'google')) continue;
    try {
      for (const t of await f()) {
        if (!t.id) continue;
        const ghiChu = String(t.ghiChu || '');
        // Tài khoản quản lý (MCC) không có số quảng cáo riêng.
        if (loai === 'gads' && ghiChu.startsWith('MCC')) continue;
        await q(
          `INSERT INTO nen_tang_tai_san (id, loai, ma_ngoai, ten, ghi_chu, tien_te, cap_nhat) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET ten = EXCLUDED.ten, ghi_chu = EXCLUDED.ghi_chu, tien_te = EXCLUDED.tien_te, cap_nhat = EXCLUDED.cap_nhat`,
          [`${loai}:${t.id}`, loai, t.id, t.ten || t.id, ghiChu, (/\b[A-Z]{3}\b/.exec(ghiChu) || [''])[0], luc],
        );
        kq.so++;
      }
    } catch (e) {
      kq.loi.push(`${LOAI_TAI_SAN[loai]}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  return kq;
}

export async function suaTaiSan(id: string, o: { teamId?: string; khach?: string; theoDoi?: boolean }): Promise<void> {
  const r = await q(
    `UPDATE nen_tang_tai_san SET team_id = COALESCE($2, team_id), khach = COALESCE($3, khach), theo_doi = COALESCE($4, theo_doi),
       dong_bo_cuoi = CASE WHEN $4 = true AND NOT theo_doi THEN 0 ELSE dong_bo_cuoi END
     WHERE id = $1 RETURNING id`,
    [id, o.teamId ?? null, o.khach ?? null, o.theoDoi ?? null],
  );
  if (!r.length) throw new ApiError(404, 'Không thấy tài sản');
}

const congNgay = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const NGAY_DONG_BO = 35;

async function laySo(ts: TaiSanNt, tu: string, den: string): Promise<DongSo[]> {
  const k = await import('./ketNoi.service.js');
  switch (ts.loai) {
    case 'meta':
      return dongMeta(await k.metaInsights(ts.maNgoai, tu, den));
    case 'gads':
      return dongGads(
        await k.gadsTruyVan(
          ts.maNgoai,
          `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer WHERE segments.date BETWEEN '${tu}' AND '${den}'`,
        ),
      );
    case 'ga4':
      return dongGa4(
        await k.ga4BaoCao(ts.maNgoai, {
          dateRanges: [{ startDate: tu, endDate: den }],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'keyEvents' }],
          limit: '100',
        }),
      );
    case 'gsc':
      return dongGsc(await k.gscTruyVan(ts.maNgoai, { startDate: tu, endDate: den, dimensions: ['date'], rowLimit: 100 }));
  }
}

/** Đồng bộ 35 ngày gần nhất của một tài sản (ghi đè theo ngày — số các nền tảng còn chỉnh lại vài ngày sau). */
export async function dongBoMot(ts: TaiSanNt): Promise<number> {
  const den = todayIso();
  try {
    const ds = await laySo(ts, congNgay(den, -NGAY_DONG_BO), den);
    if (ds.length) {
      const tham: unknown[] = [];
      const dong = ds.map((d) => {
        const i = tham.length;
        tham.push(ts.id, d.ngay, d.chiTieu || 0, d.hienThi || 0, d.click || 0, d.ketQua || 0, d.phien || 0, d.nguoiDung || 0, d.viTri || 0);
        return `(${Array.from({ length: 9 }, (_, j) => `$${i + j + 1}`).join(',')})`;
      });
      await q(
        `INSERT INTO nen_tang_so_lieu (tai_san_id, ngay, chi_tieu, hien_thi, click, ket_qua, phien, nguoi_dung, vi_tri) VALUES ${dong.join(',')}
         ON CONFLICT (tai_san_id, ngay) DO UPDATE SET chi_tieu = EXCLUDED.chi_tieu, hien_thi = EXCLUDED.hien_thi, click = EXCLUDED.click,
           ket_qua = EXCLUDED.ket_qua, phien = EXCLUDED.phien, nguoi_dung = EXCLUDED.nguoi_dung, vi_tri = EXCLUDED.vi_tri`,
        tham,
      );
    }
    await q(`UPDATE nen_tang_tai_san SET dong_bo_cuoi = $2, loi = '' WHERE id = $1`, [ts.id, Date.now()]);
    return ds.length;
  } catch (e) {
    // Lỗi vẫn ghi mốc để không gọi lại mỗi phút; lượt sau (6 tiếng) thử lại, hoặc bấm "Cập nhật ngay".
    await q(`UPDATE nen_tang_tai_san SET dong_bo_cuoi = $2, loi = $3 WHERE id = $1`, [ts.id, Date.now(), (e as Error).message.slice(0, 300)]);
    throw e;
  }
}

const CACH_DONG_BO_MS = 6 * 3_600_000;

/** Chuỗi cron mỗi phút: vài tài sản đến hạn (lâu chưa đồng bộ nhất trước), dừng khi hết giờ. */
export async function dongBoNenTang(han: number): Promise<number> {
  const ds = (
    await q(`SELECT * FROM nen_tang_tai_san WHERE theo_doi AND dong_bo_cuoi < $1 ORDER BY dong_bo_cuoi LIMIT 4`, [Date.now() - CACH_DONG_BO_MS]).catch(() => [])
  ).map(rowTo);
  let n = 0;
  for (const ts of ds) {
    if (Date.now() > han) break;
    await dongBoMot(ts).catch((e) => console.warn('[nen-tang] đồng bộ', ts.id, (e as Error).message.slice(0, 160)));
    n++;
  }
  return n;
}

/** Anh bấm "Cập nhật ngay": mọi tài sản đang theo dõi (của một loại nếu có). */
export async function dongBoNgay(loai?: LoaiTaiSan): Promise<{ so: number; loi: string[] }> {
  const ds = (await dsTaiSan()).filter((t) => t.theoDoi && (!loai || t.loai === loai));
  const kq = { so: 0, loi: [] as string[] };
  for (const ts of ds) {
    try {
      await dongBoMot(ts);
      kq.so++;
    } catch (e) {
      kq.loi.push(`${ts.ten}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  return kq;
}

// ── Xem ──

export interface ChiSoTaiSan {
  id: string;
  ten: string;
  khach: string;
  teamId: string;
  tienTe: string;
  loi: string;
  dongBoCuoi: number;
  tomTat: TomTat;
}

/** Chỉ số một loại nền tảng mà người này xem được: từng tài sản + tổng. */
export async function chiSo(nguoi: { role: string; teamId: string }, loai: LoaiTaiSan, locTeam?: string): Promise<{ taiSan: ChiSoTaiSan[]; tong: TomTat | null }> {
  const homNay = todayIso();
  const ts = (await dsTaiSan()).filter((t) => t.loai === loai && t.theoDoi && xemDuoc(nguoi, t.teamId) && (!locTeam || t.teamId === locTeam || t.teamId === '*'));
  if (!ts.length) return { taiSan: [], tong: null };
  const rows = await q(
    `SELECT * FROM nen_tang_so_lieu WHERE tai_san_id = ANY($1::text[]) AND ngay >= $2 ORDER BY ngay`,
    [ts.map((t) => t.id), congNgay(homNay, -45)],
  );
  const theoTs = new Map<string, DongSo[]>();
  for (const r of rows) {
    const d: DongSo = {
      ngay: String(r.ngay),
      chiTieu: Number(r.chi_tieu) || 0,
      hienThi: Number(r.hien_thi) || 0,
      click: Number(r.click) || 0,
      ketQua: Number(r.ket_qua) || 0,
      phien: Number(r.phien) || 0,
      nguoiDung: Number(r.nguoi_dung) || 0,
      viTri: Number(r.vi_tri) || 0,
    };
    theoTs.set(String(r.tai_san_id), [...(theoTs.get(String(r.tai_san_id)) || []), d]);
  }
  const taiSan = ts.map((t) => ({
    id: t.id,
    ten: t.ten,
    khach: t.khach,
    teamId: t.teamId,
    tienTe: t.tienTe,
    loi: t.loi,
    dongBoCuoi: t.dongBoCuoi,
    tomTat: tomTatChiSo(theoTs.get(t.id) || [], homNay),
  }));
  return { taiSan, tong: tomTatChiSo(gopTheoNgay([...theoTs.values()].flat()), homNay) };
}
