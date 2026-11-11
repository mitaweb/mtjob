// Báo cáo quảng cáo gửi khách (anh Tâm 11/11/2026): mỗi khách một cấu hình (tài khoản Google / Facebook, logo, thuế, chu kỳ
// tháng, Zalo nhận). Đến kỳ: lấy số thẳng từ nền tảng (có chuyển đổi theo loại) → AI viết Đánh giá + Đề xuất → người phụ
// trách xem, sửa, bấm Gửi (ảnh dựng ở trình duyệt) → gửi ảnh vào Zalo của khách. Chi phí luôn ĐÃ CỘNG THUẾ.
import { q } from '../db/client.js';
import { newId } from '../util/id.js';
import { nowTz, todayIso } from '../lib/datetime.js';
import { ApiError } from '../util/errors.js';
import { duocThaoTac } from '../lib/adsDieuChinh.js';
import { kyBaoCao, nenTao, coCauGads, coCauMeta, tongHop, THUE_MAC_DINH, type Ky, type LoaiKy, type SoTaiKhoan, type TongHop } from '../lib/baoCaoKhach.js';
import { dsTaiSan, type TaiSanNt } from './nenTang.service.js';
import type { Nguoi } from './adsDieuChinh.service.js';

export type NenTang = 'gads' | 'meta';
export const TEN_NEN_TANG: Record<NenTang, string> = { gads: 'Google Ads', meta: 'Facebook Ads' };

export interface CauHinh {
  id: string;
  ten: string;
  logo: string;
  mau: string;
  /** ten: tên hiện trong bảng gửi khách (trống = tên tài khoản) */
  taiKhoan: Array<{ id: string; thue: number; ten?: string }>;
  ngayChuKy: number;
  tuan: boolean;
  thang: boolean;
  zaloThread: string;
  zaloNhom: boolean;
  zaloTen: string;
  bat: boolean;
}

export interface BaoCao {
  id: string;
  cauHinhId: string;
  tenKhach: string;
  logo: string;
  mau: string;
  ky: string;
  nenTang: NenTang;
  tu: string;
  den: string;
  soLieu: TongHop;
  truoc: TongHop['tong'] | null;
  danhGia: string[];
  deXuat: string[];
  trangThai: string;
  loi: string;
  nguoiGui: string;
  guiLuc: string;
  taoLuc: string;
  zaloTen: string;
}

const json = <T>(s: unknown, mac: T): T => {
  try {
    return JSON.parse(String(s || '')) as T;
  } catch {
    return mac;
  }
};

const cauHinhTuDong = (r: Record<string, unknown>): CauHinh => ({
  id: String(r.id),
  ten: String(r.ten || ''),
  logo: String(r.logo || ''),
  mau: String(r.mau || ''),
  taiKhoan: json<Array<{ id: string; thue: number; ten?: string }>>(r.tai_khoan, []).map((t) => ({
    id: String(t.id),
    thue: Number.isFinite(Number(t.thue)) ? Number(t.thue) : THUE_MAC_DINH,
    ten: String(t.ten || '').slice(0, 80),
  })),
  ngayChuKy: Number(r.ngay_chu_ky) || 0,
  tuan: r.tuan !== false,
  thang: r.thang !== false,
  zaloThread: String(r.zalo_thread || ''),
  zaloNhom: !!r.zalo_nhom,
  zaloTen: String(r.zalo_ten || ''),
  bat: r.bat !== false,
});

/** Người được làm với cấu hình: giám đốc, hoặc MỌI tài khoản trong đó thuộc phòng mình. */
async function quyenCauHinh(nguoi: Nguoi, ch: CauHinh, taiSan?: TaiSanNt[]): Promise<boolean> {
  if (nguoi.role === 'director') return true;
  const ts = taiSan || (await dsTaiSan());
  const cua = ch.taiKhoan.map((t) => ts.find((x) => x.id === t.id));
  return cua.length > 0 && cua.every((t) => t && duocThaoTac(nguoi, t.teamId));
}

export async function dsCauHinh(nguoi: Nguoi): Promise<CauHinh[]> {
  const ts = await dsTaiSan();
  const ds = (await q(`SELECT * FROM bao_cao_kh_cau_hinh ORDER BY ten`)).map(cauHinhTuDong);
  const ra: CauHinh[] = [];
  for (const c of ds) if (await quyenCauHinh(nguoi, c, ts)) ra.push(c);
  return ra;
}

async function docCauHinh(id: string): Promise<CauHinh> {
  const r = (await q(`SELECT * FROM bao_cao_kh_cau_hinh WHERE id = $1`, [id]))[0];
  if (!r) throw new ApiError(404, 'Không thấy cấu hình báo cáo');
  return cauHinhTuDong(r);
}

export async function luuCauHinh(nguoi: Nguoi, c: Omit<CauHinh, 'id'> & { id?: string }): Promise<CauHinh> {
  const ts = await dsTaiSan();
  for (const t of c.taiKhoan) {
    const x = ts.find((y) => y.id === t.id);
    if (!x || !['gads', 'meta'].includes(x.loai)) throw new ApiError(400, `Không thấy tài khoản quảng cáo ${t.id}`);
    if (!duocThaoTac(nguoi, x.teamId)) throw new ApiError(403, `Tài khoản ${x.ten} chưa giao cho phòng của bạn`);
  }
  if (c.id) {
    const cu = await docCauHinh(c.id);
    if (!(await quyenCauHinh(nguoi, cu, ts))) throw new ApiError(403, 'Bạn không quản lý báo cáo này');
  }
  const id = c.id || newId('BCK');
  await q(
    `INSERT INTO bao_cao_kh_cau_hinh (id, ten, logo, mau, tai_khoan, ngay_chu_ky, tuan, thang, zalo_thread, zalo_nhom, zalo_ten, bat, nguoi_tao, cap_nhat)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET ten = EXCLUDED.ten, logo = EXCLUDED.logo, mau = EXCLUDED.mau, tai_khoan = EXCLUDED.tai_khoan,
       ngay_chu_ky = EXCLUDED.ngay_chu_ky, tuan = EXCLUDED.tuan, thang = EXCLUDED.thang, zalo_thread = EXCLUDED.zalo_thread,
       zalo_nhom = EXCLUDED.zalo_nhom, zalo_ten = EXCLUDED.zalo_ten, bat = EXCLUDED.bat, cap_nhat = EXCLUDED.cap_nhat`,
    [id, c.ten, c.logo, c.mau, JSON.stringify(c.taiKhoan), c.ngayChuKy, c.tuan, c.thang, c.zaloThread, c.zaloNhom, c.zaloTen, c.bat, nguoi.sub, nowTz().toISOString()],
  );
  return docCauHinh(id);
}

// ── Lấy số thẳng từ nền tảng ──

async function soTaiKhoan(ts: TaiSanNt, thue: number, ky: Ky, tenRieng = ''): Promise<SoTaiKhoan> {
  const k = await import('./ketNoi.service.js');
  const ten = tenRieng || ts.ten || ts.khach;
  if (ts.loai === 'gads') {
    const khoang = `segments.date BETWEEN '${ky.tu}' AND '${ky.den}'`;
    const [tong, cc] = await Promise.all([
      k.gadsTruyVan(ts.maNgoai, `SELECT metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros FROM customer WHERE ${khoang}`),
      k.gadsTruyVan(ts.maNgoai, `SELECT segments.conversion_action_category, segments.conversion_action_name, metrics.conversions FROM customer WHERE ${khoang}`),
    ]);
    const s = { hienThi: 0, click: 0, chuyenDoi: 0, chi: 0 };
    for (const r of (Array.isArray(tong) ? tong : []).flatMap((x: { results?: Array<{ metrics?: Record<string, unknown> }> }) => x.results || [])) {
      const m = r.metrics || {};
      s.hienThi += Number(m.impressions) || 0;
      s.click += Number(m.clicks) || 0;
      s.chuyenDoi += Number(m.conversions) || 0;
      s.chi += (Number(m.costMicros) || 0) / 1e6;
    }
    return { ten, thue, ...s, chuyenDoi: Math.round(s.chuyenDoi * 100) / 100, coCau: coCauGads(cc) };
  }
  const j = (await k.metaGraph(`act_${ts.maNgoai.replace(/\D/g, '')}/insights`, {
    level: 'account',
    time_range: JSON.stringify({ since: ky.tu, until: ky.den }),
    fields: 'spend,impressions,clicks,actions',
  })) as { data?: Array<Record<string, unknown>> };
  const r = j.data?.[0] || {};
  const coCau = coCauMeta(r.actions as Array<{ action_type?: string; value?: unknown }>);
  return {
    ten,
    thue,
    hienThi: Number(r.impressions) || 0,
    click: Number(r.clicks) || 0,
    chuyenDoi: Object.values(coCau).reduce((a, b) => a + b, 0),
    chi: Number(r.spend) || 0,
    coCau,
  };
}

async function soLieu(ch: CauHinh, nenTang: NenTang, ky: Ky): Promise<TongHop> {
  const ts = await dsTaiSan();
  const ds = ch.taiKhoan.map((t) => ({ t, x: ts.find((y) => y.id === t.id) })).filter((v) => v.x?.loai === nenTang);
  return tongHop(await Promise.all(ds.map((v) => soTaiKhoan(v.x!, v.t.thue, ky, v.t.ten))));
}

const nenTangCua = async (ch: CauHinh): Promise<NenTang[]> => {
  const ts = await dsTaiSan();
  const co = new Set(ch.taiKhoan.map((t) => ts.find((y) => y.id === t.id)?.loai));
  return (['gads', 'meta'] as const).filter((n) => co.has(n));
};

// ── AI viết nhận xét gửi khách ──

const SCHEMA_NHAN_XET = {
  type: 'OBJECT',
  properties: { danhGia: { type: 'ARRAY', items: { type: 'STRING' } }, deXuat: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['danhGia', 'deXuat'],
};

const vn = (n: number) => Math.round(n).toLocaleString('vi-VN');

async function aiNhanXet(ch: CauHinh, nenTang: NenTang, ky: Ky, loai: string, th: TongHop, truoc: TongHop['tong'] | null): Promise<{ danhGia: string[]; deXuat: string[] }> {
  // Ghi chú khách trong kho (mục tiêu, sản phẩm, điều cần tránh) — giúp đề xuất đúng khách.
  const ghiChu: string[] = [];
  try {
    const { findItem } = await import('./brainItems.repo.js');
    const { createHash } = await import('node:crypto');
    for (const t of ch.taiKhoan) {
      const it = await findItem(`ADS-${createHash('sha1').update(t.id).digest('hex').slice(0, 16)}`).catch(() => undefined);
      if (it?.body) ghiChu.push(it.body.slice(0, 1500));
    }
  } catch {
    /* không có kho thì thôi */
  }
  const dong = (t: TongHop['tong']) => `hiển thị ${vn(t.hienThi)}, nhấp ${vn(t.click)}, chuyển đổi ${vn(t.chuyenDoi)}, chi phí (đã gồm thuế) ${vn(t.chiSauThue)}đ, chi phí / chuyển đổi ${vn(t.cpa)}đ`;
  const { aiKhoJson } = await import('../ai/brainAi.js');
  const r = (await aiKhoJson(
    [
      `Bạn là chuyên viên quảng cáo của MT Digital, viết phần nhận xét cho BÁO CÁO ${TEN_NEN_TANG[nenTang].toUpperCase()} ${loai === 'tuan' ? 'TUẦN' : 'THÁNG'} gửi KHÁCH HÀNG «${ch.ten}» (${ky.tu} → ${ky.den}).`,
      'Viết tiếng Việt, lịch sự, ngắn gọn, đúng số liệu, KHÔNG bịa số. Tích cực nhưng trung thực: kết quả giảm thì nói rõ và nêu hướng xử lý.',
      'KHÔNG nhắc tới giá dịch vụ, phí quản lý, lợi nhuận của MT Digital, tên công cụ nội bộ hay thông tin của khách khác.',
      '- danhGia: 2–4 câu, mỗi câu ≤ 25 chữ, dựa trên số kỳ này (so kỳ trước nếu có).',
      '- deXuat: 1–3 việc cụ thể sẽ làm kỳ tới, mỗi câu ≤ 25 chữ.',
      '',
      `KỲ NÀY: ${dong(th.tong)}.`,
      truoc && truoc.chiSauThue > 0 ? `KỲ TRƯỚC: ${dong(truoc)}.` : 'KỲ TRƯỚC: không có số.',
      th.coCau.length ? `CƠ CẤU CHUYỂN ĐỔI: ${th.coCau.map((c) => `${c.nhan} ${vn(c.so)} (${Math.round(c.tyLe * 1000) / 10}%)`).join(', ')}.` : '',
      th.tk.length > 1 ? `THEO TÀI KHOẢN: ${th.tk.map((t) => `${t.ten}: ${vn(t.chuyenDoi)} chuyển đổi, ${vn(t.chiSauThue)}đ, ${vn(t.cpa)}đ / chuyển đổi`).join('; ')}.` : '',
      ghiChu.length ? `\nGHI CHÚ NỘI BỘ VỀ KHÁCH (chỉ để hiểu khách, KHÔNG chép ra):\n${ghiChu.join('\n---\n')}` : '',
    ].join('\n'),
    SCHEMA_NHAN_XET,
  )) as { danhGia?: unknown[]; deXuat?: unknown[] };
  const sach = (a: unknown[] | undefined, toiDa: number) =>
    (Array.isArray(a) ? a : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .slice(0, toiDa)
      .map((x) => x.slice(0, 220));
  return { danhGia: sach(r?.danhGia, 4), deXuat: sach(r?.deXuat, 3) };
}

// ── Tạo báo cáo ──

/** Tạo (hoặc làm lại) báo cáo một kỳ × nền tảng. Đã gửi rồi thì không làm lại. */
export async function taoBaoCao(ch: CauHinh, nenTang: NenTang, loai: LoaiKy | 'tuy_chon', ky: Ky): Promise<string> {
  const cu = (await q(`SELECT id, trang_thai FROM bao_cao_kh WHERE cau_hinh_id = $1 AND ky = $2 AND nen_tang = $3 AND tu = $4 AND den = $5`, [ch.id, loai, nenTang, ky.tu, ky.den]))[0];
  if (cu?.trang_thai === 'da_gui') throw new ApiError(400, 'Báo cáo kỳ này đã gửi khách rồi');
  const id = String(cu?.id || newId('BC'));
  const luc = nowTz().toISOString();
  try {
    const th = await soLieu(ch, nenTang, ky);
    // Kỳ trước cùng độ dài để so sánh.
    const soNgay = Math.round((Date.parse(ky.den) - Date.parse(ky.tu)) / 86_400_000) + 1;
    const { congNgay } = await import('../lib/khoangNgay.js');
    const kyTruoc = loai === 'tuy_chon' ? { tu: congNgay(ky.tu, -soNgay), den: congNgay(ky.tu, -1) } : kyBaoCao(loai, ky.tu, ch.ngayChuKy);
    const truoc = await soLieu(ch, nenTang, kyTruoc)
      .then((t) => t.tong)
      .catch(() => null);
    const nx = await aiNhanXet(ch, nenTang, ky, loai, th, truoc).catch((e) => {
      console.warn('[bao-cao-khach] AI nhận xét lỗi:', (e as Error).message.slice(0, 160));
      return { danhGia: [] as string[], deXuat: [] as string[] };
    });
    await q(
      `INSERT INTO bao_cao_kh (id, cau_hinh_id, ky, nen_tang, tu, den, so_lieu, truoc, danh_gia, de_xuat, trang_thai, loi, tao_luc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'cho','',$11)
       ON CONFLICT (id) DO UPDATE SET so_lieu = EXCLUDED.so_lieu, truoc = EXCLUDED.truoc, danh_gia = EXCLUDED.danh_gia,
         de_xuat = EXCLUDED.de_xuat, trang_thai = 'cho', loi = '', tao_luc = EXCLUDED.tao_luc`,
      [id, ch.id, loai, nenTang, ky.tu, ky.den, JSON.stringify(th), JSON.stringify(truoc), JSON.stringify(nx.danhGia), JSON.stringify(nx.deXuat), luc],
    );
  } catch (e) {
    const loi = (e as Error).message.slice(0, 400);
    await q(
      `INSERT INTO bao_cao_kh (id, cau_hinh_id, ky, nen_tang, tu, den, trang_thai, loi, tao_luc) VALUES ($1,$2,$3,$4,$5,$6,'loi',$7,$8)
       ON CONFLICT (id) DO UPDATE SET trang_thai = 'loi', loi = EXCLUDED.loi, tao_luc = EXCLUDED.tao_luc`,
      [id, ch.id, loai, nenTang, ky.tu, ky.den, loi, luc],
    );
    throw e;
  }
  await baoNguoiPhuTrach(ch, nenTang, ky).catch(() => undefined);
  return id;
}

async function baoNguoiPhuTrach(ch: CauHinh, nenTang: NenTang, ky: Ky): Promise<void> {
  const ts = await dsTaiSan();
  const team = ch.taiKhoan.map((t) => ts.find((y) => y.id === t.id)?.teamId || '').find((x) => x && x !== '*');
  const { notify } = await import('./notifications.service.js');
  const ai = new Set<string>();
  if (team) {
    const { teamLeaderId } = await import('./teams.repo.js');
    const l = await teamLeaderId(team).catch(() => '');
    if (l) ai.add(l);
  }
  if (!ai.size) {
    const gd = await q(`SELECT member_id FROM members WHERE role = 'director' LIMIT 3`).catch(() => []);
    for (const r of gd) ai.add(String(r.member_id));
  }
  for (const m of ai)
    await notify(m, {
      type: 'bao_cao_khach',
      title: `📊 Báo cáo ${TEN_NEN_TANG[nenTang]} ${ch.ten} chờ duyệt`,
      body: `Kỳ ${ky.tu} → ${ky.den}. Xem lại nhận xét AI rồi bấm Gửi cho khách.`,
      url: '/ket-noi-mcp?tab=bao_cao',
    }).catch(() => undefined);
}

/** Bấm "Tạo ngay" — kỳ tuần / tháng vừa rồi hoặc khoảng tự chọn. */
export async function taoNgay(nguoi: Nguoi, cauHinhId: string, loai: LoaiKy | 'tuy_chon', tu?: string, den?: string): Promise<string[]> {
  const ch = await docCauHinh(cauHinhId);
  if (!(await quyenCauHinh(nguoi, ch))) throw new ApiError(403, 'Bạn không quản lý báo cáo này');
  const ky = loai === 'tuy_chon' ? { tu: String(tu || ''), den: String(den || '') } : kyBaoCao(loai, todayIso(), ch.ngayChuKy);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ky.tu) || !/^\d{4}-\d{2}-\d{2}$/.test(ky.den) || ky.tu > ky.den) throw new ApiError(400, 'Khoảng ngày không hợp lệ');
  const ra: string[] = [];
  for (const n of await nenTangCua(ch)) ra.push(await taoBaoCao(ch, n, loai, ky));
  return ra;
}

/** Cron: từ 8h, ≥ 15 phút / lượt — kỳ tuần (thứ Hai) / tháng (ngày chu kỳ) vừa kết thúc mà chưa có báo cáo thì tạo. */
export async function chayBaoCaoKhach(han: number): Promise<number> {
  if (Number(nowTz().format('H')) < 8) return 0;
  const { docMoc, ghiMoc } = await import('./hieuAnh.repo.js');
  if (Date.now() - (await docMoc('bao_cao_kh_luot').catch(() => Date.now())) < 15 * 60_000) return 0;
  await ghiMoc('bao_cao_kh_luot', Date.now());
  const homNay = todayIso();
  let tao = 0;
  const ds = (await q(`SELECT * FROM bao_cao_kh_cau_hinh WHERE bat`).catch(() => [])).map(cauHinhTuDong);
  for (const ch of ds) {
    for (const loai of ['tuan', 'thang'] as const) {
      if (!ch[loai]) continue;
      const ky = kyBaoCao(loai, homNay, ch.ngayChuKy);
      if (!nenTao(ky, homNay)) continue;
      for (const n of await nenTangCua(ch)) {
        if (Date.now() > han) return tao;
        const co = await q(`SELECT 1 FROM bao_cao_kh WHERE cau_hinh_id = $1 AND ky = $2 AND nen_tang = $3 AND tu = $4 AND den = $5`, [ch.id, loai, n, ky.tu, ky.den]);
        if (co.length) continue;
        await taoBaoCao(ch, n, loai, ky).catch((e) => console.warn('[bao-cao-khach]', ch.ten, n, (e as Error).message.slice(0, 160)));
        tao++;
      }
    }
  }
  return tao;
}

// ── Danh sách, sửa, gửi ──

export async function dsBaoCao(nguoi: Nguoi, o: { trangThai?: string } = {}): Promise<BaoCao[]> {
  const chs = new Map((await dsCauHinh(nguoi)).map((c) => [c.id, c]));
  if (!chs.size) return [];
  const rows = await q(
    `SELECT * FROM bao_cao_kh WHERE cau_hinh_id = ANY($1::text[]) ${o.trangThai ? `AND trang_thai = $2` : ''} ORDER BY tao_luc DESC LIMIT 60`,
    o.trangThai ? [[...chs.keys()], o.trangThai] : [[...chs.keys()]],
  );
  return rows.map((r) => {
    const ch = chs.get(String(r.cau_hinh_id))!;
    return {
      id: String(r.id),
      cauHinhId: ch.id,
      tenKhach: ch.ten,
      logo: ch.logo,
      mau: ch.mau,
      ky: String(r.ky),
      nenTang: String(r.nen_tang) as NenTang,
      tu: String(r.tu),
      den: String(r.den),
      soLieu: json<TongHop>(r.so_lieu, { tk: [], tong: { hienThi: 0, click: 0, chuyenDoi: 0, chiSauThue: 0, cpa: 0, ctr: 0 }, coCau: [] }),
      truoc: json<TongHop['tong'] | null>(r.truoc, null),
      danhGia: json<string[]>(r.danh_gia, []),
      deXuat: json<string[]>(r.de_xuat, []),
      trangThai: String(r.trang_thai),
      loi: String(r.loi || ''),
      nguoiGui: String(r.nguoi_gui || ''),
      guiLuc: String(r.gui_luc || ''),
      taoLuc: String(r.tao_luc || ''),
      zaloTen: ch.zaloTen,
    };
  });
}

async function baoCaoCua(nguoi: Nguoi, id: string): Promise<{ r: Record<string, unknown>; ch: CauHinh }> {
  const r = (await q(`SELECT * FROM bao_cao_kh WHERE id = $1`, [id]))[0];
  if (!r) throw new ApiError(404, 'Không thấy báo cáo');
  const ch = await docCauHinh(String(r.cau_hinh_id));
  if (!(await quyenCauHinh(nguoi, ch))) throw new ApiError(403, 'Bạn không quản lý báo cáo này');
  return { r, ch };
}

export async function suaNhanXet(nguoi: Nguoi, id: string, danhGia: string[], deXuat: string[]): Promise<void> {
  const { r } = await baoCaoCua(nguoi, id);
  if (r.trang_thai === 'da_gui') throw new ApiError(400, 'Báo cáo đã gửi khách — không sửa được');
  await q(`UPDATE bao_cao_kh SET danh_gia = $2, de_xuat = $3 WHERE id = $1`, [id, JSON.stringify(danhGia), JSON.stringify(deXuat)]);
}

export async function doiTrangThai(nguoi: Nguoi, id: string, trangThai: 'bo' | 'da_gui' | 'cho'): Promise<void> {
  const { r } = await baoCaoCua(nguoi, id);
  if (r.trang_thai === 'da_gui' && trangThai !== 'da_gui') throw new ApiError(400, 'Báo cáo đã gửi khách');
  await q(`UPDATE bao_cao_kh SET trang_thai = $2, nguoi_gui = CASE WHEN $2 = 'da_gui' THEN $3 ELSE nguoi_gui END, gui_luc = CASE WHEN $2 = 'da_gui' THEN $4 ELSE gui_luc END WHERE id = $1`, [
    id,
    trangThai,
    nguoi.ten,
    nowTz().toISOString(),
  ]);
}

/** Gửi ảnh báo cáo (PNG/JPEG do trình duyệt dựng) vào Zalo đã cấu hình của khách. */
export async function guiZalo(nguoi: Nguoi, id: string, anh: { data: string; rong: number; cao: number }, loiNhan: string): Promise<void> {
  const { r, ch } = await baoCaoCua(nguoi, id);
  if (r.trang_thai === 'da_gui') throw new ApiError(400, 'Báo cáo này đã gửi rồi');
  if (!ch.zaloThread) throw new ApiError(400, 'Chưa chọn Zalo nhận báo cáo cho khách này — sửa cấu hình, chọn nhóm / người nhận');
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(anh.data);
  if (!m) throw new ApiError(400, 'Ảnh không hợp lệ');
  const buf = Buffer.from(m[2]!, 'base64');
  if (buf.length > 4_000_000) throw new ApiError(400, 'Ảnh quá lớn');
  const { guiAnhZalo } = await import('./zalo.client.js');
  await guiAnhZalo(ch.zaloThread, ch.zaloNhom, { data: buf, duoi: m[1] === 'png' ? 'png' : 'jpg', rong: anh.rong, cao: anh.cao }, loiNhan.slice(0, 1000));
  await q(`UPDATE bao_cao_kh SET trang_thai = 'da_gui', nguoi_gui = $2, gui_luc = $3, loi = '' WHERE id = $1`, [id, nguoi.ten, nowTz().toISOString()]);
}

/** Cuộc Zalo để chọn làm nơi nhận báo cáo (nhóm khách trước). */
export async function timZalo(tu: string): Promise<Array<{ id: string; ten: string; laNhom: boolean; khach: string }>> {
  const t = `%${tu.trim().toLowerCase()}%`;
  const rows = await q(
    `SELECT thread_id, name, is_group, customer FROM zalo_threads WHERE ($1 = '%%' OR lower(name) LIKE $1 OR lower(customer) LIKE $1)
     ORDER BY is_group DESC, last_msg_at DESC NULLS LAST LIMIT 20`,
    [t],
  );
  return rows.map((r) => ({ id: String(r.thread_id), ten: String(r.name || ''), laNhom: !!r.is_group, khach: String(r.customer || '') }));
}

export type { LoaiKy };

/** Tài khoản Google / Facebook Ads người này được làm báo cáo (theo phòng; giám đốc tất cả). */
export async function dsTaiKhoanQc(nguoi: Nguoi): Promise<Array<{ id: string; loai: string; ten: string; khach: string }>> {
  return (await dsTaiSan())
    .filter((t) => ['gads', 'meta'].includes(t.loai) && duocThaoTac(nguoi, t.teamId))
    .map((t) => ({ id: t.id, loai: t.loai, ten: t.ten, khach: t.khach }));
}
