// Kế toán thuế — ghi số liệu báo cáo CÓ XÉT NGÀY (anh Tâm 11/11/2026: "đọc và hiểu các báo cáo, ưu tiên báo cáo sau ghi đè
// báo cáo cũ, các chỉ số có ngày cập nhật mới hơn phải được giữ lại, đánh giá giữ lại hay k, k hiểu thì hỏi").
//  - Báo cáo (KQKD, báo cáo kế toán gửi, báo cáo khác): gộp TỪNG chỉ số theo ngày số liệu.
//  - Bảng lương một tháng / sổ công nợ một ngày chốt: nhận hoặc giữ CẢ KHỐI.
//  - Cùng ngày / không rõ ngày mà số khác: AI đánh giá (file là bản sửa? bản nháp?); không đủ căn cứ → hỏi giám đốc (kt_hoi).
import { q } from '../db/client.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';
import { ApiError } from '../util/errors.js';
import { gopChiSo, apQuyetDinh, quyetDinhCaKhoi, phangCongNo, tomTatGop, type BanGhiChiSo, type KhacBiet } from '../lib/keToanGop.js';
import type { BaoCaoKqkd, SoCongNo } from '../lib/keToan.js';
import type { LuongThang, LuongNv } from '../lib/docAi.js';

export const TEN_KQKD: Record<string, string> = {
  '01': 'Doanh thu bán hàng',
  '02': 'Các khoản giảm trừ',
  '10': 'Doanh thu thuần',
  '11': 'Giá vốn',
  '20': 'Lợi nhuận gộp',
  '21': 'Doanh thu tài chính',
  '22': 'Chi phí tài chính',
  '25': 'Chi phí bán hàng',
  '26': 'Chi phí quản lý',
  '30': 'LN thuần từ kinh doanh',
  '31': 'Thu nhập khác',
  '32': 'Chi phí khác',
  '40': 'Lợi nhuận khác',
  '50': 'Lợi nhuận kế toán trước thuế',
  '51': 'Thuế TNDN hiện hành',
  '60': 'Lợi nhuận sau thuế',
  cpktd: 'Chi phí không được trừ',
  lntt: 'Lãi / lỗ tính thuế (kế toán ghi)',
};
const TEN_LUONG: Record<string, string> = {
  soNguoi: 'Số người',
  tongThuNhap: 'Tổng thu nhập',
  bhxhCty: 'BHXH công ty đóng',
  bhxhNld: 'BHXH người lao động',
  tncn: 'Thuế TNCN',
  thucNhan: 'Thực lãnh',
  tienMat: 'Trả tiền mặt',
  chuyenKhoan: 'Chuyển khoản',
};
const LUONG_KHOA = Object.keys(TEN_LUONG) as Array<keyof LuongThang & string>;

export interface NguCanh {
  tenFile: string;
  moTa: string;
  /** Ngày CỦA SỐ LIỆU (YYYY-MM-DD); '' = file không ghi */
  ngay: string;
  taiLenId: string;
  luc: string;
}

const json = <T>(s: unknown, mac: T): T => {
  try {
    return JSON.parse(String(s || '')) as T;
  } catch {
    return mac;
  }
};

// ── Một khối số liệu cần ghi ──

interface Khoi {
  bang: 'bao_cao' | 'luong' | 'cong_no';
  khoa: string;
  tieuDe: string;
  cu: BanGhiChiSo | null;
  moi: { giaTri: Record<string, number>; ngay: string };
  tenChiTieu: Record<string, string>;
  /** Báo cáo: gộp từng chỉ số → ghi bản đã gộp */
  ghiGop?: (bg: BanGhiChiSo) => Promise<void>;
  /** Lương / công nợ: ghi cả khối mới */
  ghiMoi?: () => Promise<void>;
  /** Đủ để áp khi anh chọn số mới (lương / công nợ) */
  duLieuHoi?: unknown;
}

const SCHEMA_XET = {
  type: 'OBJECT',
  properties: {
    quyetDinh: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { so: { type: 'INTEGER' }, chon: { type: 'STRING', enum: ['moi', 'cu', 'hoi'] }, lyDo: { type: 'STRING' } },
        required: ['so', 'chon', 'lyDo'],
      },
    },
  },
  required: ['quyetDinh'],
};

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');

/** AI đánh giá những chỗ không phân định được bằng ngày. AI lỗi → hỏi anh hết. */
async function aiXet(ctx: NguCanh, ds: Array<{ khoi: Khoi; canXet: KhacBiet[]; nguonCu: string }>): Promise<Array<{ chon: 'moi' | 'cu' | 'hoi'; lyDo: string }>> {
  const mac: Array<{ chon: 'moi' | 'cu' | 'hoi'; lyDo: string }> = ds.map(() => ({ chon: 'hoi', lyDo:'Cùng ngày / không rõ ngày mà số khác — cần anh xác nhận.' }));
  try {
    const { aiKhoJson } = await import('../ai/brainAi.js');
    const r = (await aiKhoJson(
      [
        'Bạn là kế toán của công ty TNHH DỊCH VỤ MT DIGITAL. Vừa tải lên một file báo cáo; một số chỗ số liệu MỚI khác số ĐANG LƯU mà',
        'không phân định được bằng ngày (cùng ngày lập, hoặc file không ghi ngày). Với từng chỗ chọn:',
        '- "moi": có căn cứ file mới là bản sửa / điều chỉnh / bổ sung / bản chốt sau (tên file, mô tả, số liệu đầy đủ hơn…).',
        '- "cu": có căn cứ file mới là bản nháp, bản cũ, bản tải lại nhầm, hoặc số đang lưu đáng tin hơn.',
        '- "hoi": KHÔNG đủ căn cứ — để giám đốc quyết. Không đoán.',
        'lyDo: một câu tiếng Việt ngắn, nêu căn cứ.',
        '',
        `FILE MỚI: «${ctx.tenFile}» — ${ctx.moTa || '(không mô tả)'} — ngày số liệu: ${ctx.ngay || 'file không ghi'}.`,
        '',
        ...ds.map(
          (x, i) =>
            `[${i}] ${x.khoi.tieuDe} — số đang lưu từ ${x.nguonCu || 'file trước'}:\n` +
            x.canXet
              .slice(0, 15)
              .map((k) => `   • ${x.khoi.tenChiTieu[k.khoa] || k.khoa}: đang lưu ${vnd(k.cu)}${k.ngayCu ? ` (ngày ${k.ngayCu})` : ''} → file mới ${vnd(k.moi)}`)
              .join('\n'),
        ),
      ].join('\n'),
      SCHEMA_XET,
    )) as { quyetDinh?: Array<{ so?: number; chon?: string; lyDo?: string }> };
    for (const d of r?.quyetDinh || []) {
      const i = Number(d.so);
      if (!mac[i]) continue;
      const chon = d.chon === 'moi' || d.chon === 'cu' ? d.chon : 'hoi';
      mac[i] = { chon, lyDo: String(d.lyDo || '').slice(0, 300) };
    }
  } catch (e) {
    console.warn('[ke-toan] AI xét báo cáo lỗi — hỏi anh:', (e as Error).message.slice(0, 160));
  }
  return mac;
}

async function nguonCua(bang: string, khoa: string): Promise<string> {
  const sql =
    bang === 'bao_cao'
      ? `SELECT t.ten_file, t.luc FROM kt_bao_cao b JOIN kt_tai_len t ON t.id = b.tai_len_id WHERE b.khoa = $1`
      : bang === 'luong'
        ? `SELECT t.ten_file, t.luc FROM kt_luong b JOIN kt_tai_len t ON t.id = b.tai_len_id WHERE b.thang = $1`
        : `SELECT t.ten_file, t.luc FROM kt_cong_no b JOIN kt_tai_len t ON t.id = b.tai_len_id WHERE b.loai || '|' || b.ngay_chot = $1 LIMIT 1`;
  const r = (await q(sql, [khoa]).catch(() => []))[0];
  return r ? `«${r.ten_file}» (tải ${String(r.luc).slice(0, 10)})` : '';
}

/** Ghi các khối của MỘT file; trả câu tóm tắt (cập nhật / giữ / hỏi). */
async function ghiCoXet(ds: Khoi[], ctx: NguCanh): Promise<string> {
  const dem = { ghiDe: 0, giuCu: 0, aiMoi: 0, aiCu: 0, hoi: 0 };
  const choXet: Array<{ khoi: Khoi; canXet: KhacBiet[]; nguonCu: string; gop: BanGhiChiSo }> = [];
  for (const k of ds) {
    const r = gopChiSo(k.cu, k.moi);
    dem.ghiDe += r.ghiDe.length;
    dem.giuCu += r.giuCu.length;
    if (k.ghiGop) {
      if (r.canXet.length) choXet.push({ khoi: k, canXet: r.canXet, nguonCu: await nguonCua(k.bang, k.khoa), gop: r });
      else await k.ghiGop(r);
      continue;
    }
    const qd = quyetDinhCaKhoi(r, !!k.cu);
    if (qd === 'moi') await k.ghiMoi!();
    else if (qd === 'xet') choXet.push({ khoi: k, canXet: r.canXet, nguonCu: await nguonCua(k.bang, k.khoa), gop: r });
  }
  if (choXet.length) {
    const qd = await aiXet(ctx, choXet);
    for (let i = 0; i < choXet.length; i++) {
      const { khoi, canXet, gop } = choXet[i]!;
      const d = qd[i]!;
      if (d.chon === 'moi') {
        dem.aiMoi++;
        if (khoi.ghiGop) await khoi.ghiGop(apQuyetDinh(gop, canXet));
        else await khoi.ghiMoi!();
        continue;
      }
      if (khoi.ghiGop) await khoi.ghiGop(gop); // giữ số cũ ở chỗ vênh, các chỉ số khác vẫn gộp
      if (d.chon === 'cu') {
        dem.aiCu++;
        continue;
      }
      dem.hoi++;
      await q(
        `INSERT INTO kt_hoi (id, bang, khoa, tieu_de, chi_tiet, ten_file, ly_do, du_lieu, trang_thai, tao_luc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'cho',$9)`,
        [
          newId('KH'),
          khoi.bang,
          khoi.khoa,
          khoi.tieuDe,
          JSON.stringify(canXet.map((k) => ({ ...k, ten: khoi.tenChiTieu[k.khoa] || k.khoa }))),
          ctx.tenFile,
          d.lyDo,
          JSON.stringify(khoi.duLieuHoi ?? { taiLenId: ctx.taiLenId }),
          ctx.luc,
        ],
      );
    }
  }
  return tomTatGop(dem);
}

// ── Báo cáo (KQKD / kế toán gửi / báo cáo khác) ──

export interface BaoCaoGhi extends BaoCaoKqkd {
  /** loai trong kt_bao_cao: kqkd | ke_toan | bc:<tên> */
  loai?: string;
  tenBaoCao?: string;
  tenChiTieu?: Record<string, string>;
}

export async function luuBaoCao(b: BaoCaoGhi, ctx: NguCanh): Promise<string> {
  const loai = b.loai || b.nguon || 'kqkd';
  const khoa = `${loai}|${b.tuNgay}|${b.denNgay}`;
  const r = (await q('SELECT * FROM kt_bao_cao WHERE khoa = $1', [khoa]))[0];
  const tenChiTieu = { ...TEN_KQKD, ...json<Record<string, string>>(r?.ten_chi_tieu, {}), ...(b.tenChiTieu || {}) };
  const tenBaoCao = b.tenBaoCao || String(r?.ten_bao_cao || '') || (loai === 'ke_toan' ? 'Báo cáo kế toán gửi' : 'Báo cáo kết quả kinh doanh');
  return ghiCoXet(
    [
      {
        bang: 'bao_cao',
        khoa,
        tieuDe: `${tenBaoCao} ${b.tuNgay} → ${b.denNgay}`,
        cu: r ? { giaTri: json(r.chi_tieu, {}), ngay: json(r.ngay_chi_tieu, {}) } : null,
        moi: { giaTri: b.chiTieu, ngay: ctx.ngay },
        tenChiTieu,
        ghiGop: async (bg) => {
          await q(
            `INSERT INTO kt_bao_cao (khoa, loai, tu_ngay, den_ngay, chi_tieu, ngay_chi_tieu, ten_bao_cao, ten_chi_tieu, tai_len_id, cap_nhat)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (khoa) DO UPDATE SET chi_tieu = EXCLUDED.chi_tieu, ngay_chi_tieu = EXCLUDED.ngay_chi_tieu, ten_bao_cao = EXCLUDED.ten_bao_cao,
               ten_chi_tieu = EXCLUDED.ten_chi_tieu, tai_len_id = EXCLUDED.tai_len_id, cap_nhat = EXCLUDED.cap_nhat`,
            [
              khoa,
              loai,
              b.tuNgay,
              b.denNgay,
              JSON.stringify(bg.giaTri),
              JSON.stringify(bg.ngay),
              tenBaoCao,
              JSON.stringify(Object.fromEntries(Object.keys(bg.giaTri).map((k) => [k, tenChiTieu[k] || k]))),
              ctx.taiLenId,
              ctx.luc,
            ],
          );
        },
      },
    ],
    ctx,
  );
}

// ── Bảng lương (mỗi tháng một khối) ──

async function ghiLuongThang(l: LuongThang, nv: LuongNv[], ngay: string, taiLenId: string, luc: string): Promise<void> {
  const { ghiLuong, ghiLuongNv } = await import('./keToan.repo.js');
  await ghiLuong([l], taiLenId, luc);
  await q('UPDATE kt_luong SET ngay_so_lieu = $2 WHERE thang = $1', [l.thang, ngay]).catch(() => undefined);
  if (nv.length) await ghiLuongNv(nv, taiLenId, luc).catch(() => undefined);
}

export async function luuLuong(luong: LuongThang[], nv: LuongNv[], ctx: NguCanh): Promise<string> {
  const cu = new Map((await q('SELECT * FROM kt_luong WHERE thang = ANY($1::text[])', [luong.map((l) => l.thang)])).map((r) => [String(r.thang), r]));
  return ghiCoXet(
    luong.map((l) => {
      const r = cu.get(l.thang);
      const nvThang = nv.filter((x) => x.thang === l.thang);
      const giaTri = Object.fromEntries(LUONG_KHOA.map((k) => [k, Number(l[k]) || 0]));
      return {
        bang: 'luong' as const,
        khoa: l.thang,
        tieuDe: `Bảng lương tháng ${l.thang.slice(5)}/${l.thang.slice(0, 4)}`,
        cu: r
          ? {
              giaTri: {
                soNguoi: Number(r.so_nguoi) || 0,
                tongThuNhap: Number(r.tong_thu_nhap) || 0,
                bhxhCty: Number(r.bhxh_cty) || 0,
                bhxhNld: Number(r.bhxh_nld) || 0,
                tncn: Number(r.tncn) || 0,
                thucNhan: Number(r.thuc_nhan) || 0,
                tienMat: Number(r.tien_mat) || 0,
                chuyenKhoan: Number(r.chuyen_khoan) || 0,
              },
              ngay: Object.fromEntries(LUONG_KHOA.map((k) => [k, String(r.ngay_so_lieu || '')])),
            }
          : null,
        moi: { giaTri, ngay: ctx.ngay },
        tenChiTieu: TEN_LUONG,
        ghiMoi: () => ghiLuongThang(l, nvThang, ctx.ngay, ctx.taiLenId, ctx.luc),
        duLieuHoi: { luong: l, nv: nvThang, ngay: ctx.ngay, taiLenId: ctx.taiLenId },
      };
    }),
    ctx,
  );
}

// ── Sổ công nợ (một ngày chốt một khối) ──

async function ghiCongNoNgay(so: SoCongNo, ngay: string, taiLenId: string): Promise<void> {
  const { ghiCongNo } = await import('./keToan.repo.js');
  await ghiCongNo(so, taiLenId);
  await q('UPDATE kt_cong_no SET ngay_so_lieu = $3 WHERE loai = $1 AND ngay_chot = $2', [so.loai, so.ngayChot, ngay]).catch(() => undefined);
}

export async function luuCongNo(so: SoCongNo, ctx: NguCanh): Promise<string> {
  const rows = await q('SELECT * FROM kt_cong_no WHERE loai = $1 AND ngay_chot = $2', [so.loai, so.ngayChot]);
  const ten: Record<string, string> = {};
  for (const d of so.dong) {
    ten[`${d.ma}|duNo`] = `${d.ten || d.ma} — dư nợ`;
    ten[`${d.ma}|duCo`] = `${d.ten || d.ma} — dư có`;
  }
  const cu = rows.length
    ? {
        giaTri: phangCongNo({ dong: rows.map((r) => ({ ma: String(r.ma), duNo: Number(r.du_no) || 0, duCo: Number(r.du_co) || 0 })) }),
        ngay: Object.fromEntries(rows.flatMap((r) => [[`${r.ma}|duNo`, String(r.ngay_so_lieu || '')], [`${r.ma}|duCo`, String(r.ngay_so_lieu || '')]])),
      }
    : null;
  return ghiCoXet(
    [
      {
        bang: 'cong_no',
        khoa: `${so.loai}|${so.ngayChot}`,
        tieuDe: `Công nợ ${so.loai === 'thu' ? 'phải thu' : 'phải trả'} chốt ${so.ngayChot}`,
        cu,
        moi: { giaTri: phangCongNo({ dong: so.dong.map((d) => ({ ma: d.ma, duNo: d.duNo, duCo: d.duCo })) }), ngay: ctx.ngay },
        tenChiTieu: ten,
        ghiMoi: () => ghiCongNoNgay(so, ctx.ngay, ctx.taiLenId),
        duLieuHoi: { so, ngay: ctx.ngay, taiLenId: ctx.taiLenId },
      },
    ],
    ctx,
  );
}

// ── Câu hỏi chờ anh quyết ──

export interface CauHoi {
  id: string;
  bang: string;
  khoa: string;
  tieuDe: string;
  chiTiet: Array<KhacBiet & { ten: string }>;
  tenFile: string;
  lyDo: string;
  taoLuc: string;
}

export async function dsHoi(): Promise<CauHoi[]> {
  const rows = await q(`SELECT * FROM kt_hoi WHERE trang_thai = 'cho' ORDER BY tao_luc DESC LIMIT 100`).catch(() => []);
  return rows.map((r) => ({
    id: String(r.id),
    bang: String(r.bang),
    khoa: String(r.khoa),
    tieuDe: String(r.tieu_de || ''),
    chiTiet: json(r.chi_tiet, []),
    tenFile: String(r.ten_file || ''),
    lyDo: String(r.ly_do || ''),
    taoLuc: String(r.tao_luc || ''),
  }));
}

/** Anh chọn: 'moi' = dùng số file mới; 'cu' = giữ số đang lưu. */
export async function traLoiHoi(id: string, chon: 'moi' | 'cu'): Promise<void> {
  const r = (await q(`SELECT * FROM kt_hoi WHERE id = $1`, [id]))[0];
  if (!r) throw new ApiError(404, 'Không thấy câu hỏi');
  if (r.trang_thai !== 'cho') throw new ApiError(400, 'Câu hỏi này đã trả lời rồi');
  const luc = nowTz().toISOString();
  if (chon === 'moi') {
    const d = json<Record<string, unknown>>(r.du_lieu, {});
    if (r.bang === 'bao_cao') {
      const b = (await q('SELECT * FROM kt_bao_cao WHERE khoa = $1', [r.khoa]))[0];
      if (b) {
        const bg = apQuyetDinh({ giaTri: json(b.chi_tieu, {}), ngay: json(b.ngay_chi_tieu, {}) }, json(r.chi_tiet, []));
        await q(`UPDATE kt_bao_cao SET chi_tieu = $2, ngay_chi_tieu = $3, cap_nhat = $4 WHERE khoa = $1`, [r.khoa, JSON.stringify(bg.giaTri), JSON.stringify(bg.ngay), luc]);
      }
    } else if (r.bang === 'luong') {
      await ghiLuongThang(d.luong as LuongThang, (d.nv as LuongNv[]) || [], String(d.ngay || ''), String(d.taiLenId || ''), luc);
    } else if (r.bang === 'cong_no') {
      await ghiCongNoNgay(d.so as SoCongNo, String(d.ngay || ''), String(d.taiLenId || ''));
    }
  }
  await q(`UPDATE kt_hoi SET trang_thai = $2, tra_loi_luc = $3 WHERE id = $1`, [id, chon, luc]);
}

// ── Báo cáo khác đã đọc (bảng cân đối, lưu chuyển tiền tệ…) ──

export async function dsBaoCaoKhac(): Promise<Array<{ khoa: string; tenBaoCao: string; tuNgay: string; denNgay: string; chiTieu: Array<{ khoa: string; ten: string; giaTri: number; ngay: string }> }>> {
  const rows = await q(`SELECT * FROM kt_bao_cao WHERE loai LIKE 'bc:%' ORDER BY den_ngay DESC, ten_bao_cao`).catch(() => []);
  return rows.map((r) => {
    const gt = json<Record<string, number>>(r.chi_tieu, {});
    const ngay = json<Record<string, string>>(r.ngay_chi_tieu, {});
    const ten = json<Record<string, string>>(r.ten_chi_tieu, {});
    return {
      khoa: String(r.khoa),
      tenBaoCao: String(r.ten_bao_cao || ''),
      tuNgay: String(r.tu_ngay || ''),
      denNgay: String(r.den_ngay || ''),
      chiTieu: Object.entries(gt).map(([k, v]) => ({ khoa: k, ten: ten[k] || k, giaTri: v, ngay: ngay[k] || '' })),
    };
  });
}
