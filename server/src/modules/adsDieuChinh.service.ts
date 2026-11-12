// Điều chỉnh quảng cáo + nghiên cứu từ khoá ngay trên MTJOB (anh Tâm 11/11/2026).
//  - "anh muốn có thể thao tác điều chỉnh ads trên phần mềm luôn": bật / tạm dừng chiến dịch, nhóm QC, quảng cáo, từ khoá;
//    đổi ngân sách ngày (không giới hạn mức, giao diện hỏi xác nhận); thêm từ khoá, từ khoá phủ định (Google Ads).
//  - "Nhân viên quyết, thông báo đến trưởng phòng, k cần thông báo đến giám đốc nhưng có thể theo dõi được": nhân sự phòng
//    được giao tài khoản tự làm; báo trưởng phòng; mọi thao tác ghi NHẬT KÝ (giám đốc xem hết).
//  - "đối với Google Ads cần xem nghiên cứu các từ khoá": từ khoá đang chạy, cụm từ khách gõ, gợi ý từ khoá (Keyword Planner).
//  - "anh sẽ input, em sẽ học, phân tích từ bộ não thứ 2 ... để đề xuất, lọc từ khoá, loại trừ từ khoá": ghi chú về khách
//    lưu vào KHO TRI THỨC; AI đọc kho + điều hiểu về anh + số liệu → ĐỀ XUẤT (chờ người trong phòng duyệt mới làm).
import { createHash } from 'node:crypto';
import { q } from '../db/client.js';
import { newId } from '../util/id.js';
import { nowTz, todayIso } from '../lib/datetime.js';
import { ApiError } from '../util/errors.js';
import {
  lenhGads,
  kiemThaoTac,
  duocThaoTac,
  dongMetaDoiTuong,
  dongGadsDoiTuong,
  dongTuKhoa,
  dongCumTimKiem,
  dongGoiYTuKhoa,
  metaVaoDonVi,
  TEN_CAP,
  type CapQc,
  type HanhDong,
  type DoiTuongQc,
  type TuKhoaGads,
  type CumTimKiem,
} from '../lib/adsDieuChinh.js';
import { dsTaiSan, type TaiSanNt } from './nenTang.service.js';
import { locDeXuat, type NhanHq } from '../lib/adsLuat.js';

const TEN_NHAN: Record<NhanHq, string> = { thang: 'thắng', thua: 'thua', cho: 'chờ', moi: 'mỏi' };
import { notify } from './notifications.service.js';

export interface Nguoi {
  sub: string;
  role: string;
  teamId: string;
  ten: string;
}

async function taiSanCo(nguoi: Nguoi, taiSanId: string): Promise<TaiSanNt> {
  const ts = (await dsTaiSan()).find((t) => t.id === taiSanId);
  if (!ts || !['meta', 'gads'].includes(ts.loai)) throw new ApiError(404, 'Không thấy tài khoản quảng cáo này');
  if (!duocThaoTac(nguoi, ts.teamId)) throw new ApiError(403, 'Tài khoản này chưa giao cho phòng của bạn');
  return ts;
}

// ── Danh sách chiến dịch / nhóm / quảng cáo ──

export interface SoNgan {
  chi: number;
  click: number;
  ketQua: number;
}

export async function dsDoiTuong(nguoi: Nguoi, taiSanId: string): Promise<{ doiTuong: DoiTuongQc[]; so7: Record<string, SoNgan>; tienTe: string }> {
  const ts = await taiSanCo(nguoi, taiSanId);
  const k = await import('./ketNoi.service.js');
  const so7: Record<string, SoNgan> = {};
  if (ts.loai === 'meta') {
    const act = `act_${ts.maNgoai.replace(/\D/g, '')}`;
    const loc = { effective_status: JSON.stringify(['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'WITH_ISSUES', 'IN_PROCESS']), limit: '300' };
    const [c, a, d, ins] = await Promise.all([
      k.metaGraph(`${act}/campaigns`, { fields: 'id,name,status,effective_status,daily_budget', ...loc }),
      k.metaGraph(`${act}/adsets`, { fields: 'id,name,status,effective_status,daily_budget,campaign_id', ...loc }),
      k.metaGraph(`${act}/ads`, { fields: 'id,name,status,effective_status,adset_id', ...loc }),
      k.metaGraph(`${act}/insights`, { level: 'campaign', date_preset: 'last_7d', fields: 'campaign_id,spend,clicks,actions', limit: '300' }).catch(() => ({ data: [] })),
    ]);
    const { ketQuaMeta } = await import('../lib/nenTang.js');
    for (const r of (ins.data as Array<Record<string, unknown>>) || []) {
      so7[String(r.campaign_id)] = { chi: Number(r.spend) || 0, click: Number(r.clicks) || 0, ketQua: ketQuaMeta(r.actions as never) };
    }
    return { doiTuong: [...dongMetaDoiTuong(c, 'campaign', ts.tienTe), ...dongMetaDoiTuong(a, 'adgroup', ts.tienTe), ...dongMetaDoiTuong(d, 'ad', ts.tienTe)], so7, tienTe: ts.tienTe || 'VND' };
  }
  const cid = ts.maNgoai;
  const [c, a, d, m] = await Promise.all([
    k.gadsTruyVan(
      cid,
      "SELECT campaign.id, campaign.name, campaign.status, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared FROM campaign WHERE campaign.status != 'REMOVED'",
    ),
    k.gadsTruyVan(cid, "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'"),
    k.gadsTruyVan(
      cid,
      "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.status, ad_group.id FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' AND campaign.status != 'REMOVED' LIMIT 500",
    ),
    k.gadsTruyVan(cid, 'SELECT campaign.id, metrics.cost_micros, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date DURING LAST_7_DAYS').catch(() => []),
  ]);
  for (const r of ((m as Array<{ results?: Array<Record<string, Record<string, unknown>>> }>) || []).flatMap((x) => x.results || [])) {
    const id = String(r.campaign?.id);
    const cu = so7[id] || { chi: 0, click: 0, ketQua: 0 };
    cu.chi += (Number(r.metrics?.costMicros) || 0) / 1e6;
    cu.click += Number(r.metrics?.clicks) || 0;
    cu.ketQua += Number(r.metrics?.conversions) || 0;
    so7[id] = cu;
  }
  return { doiTuong: [...dongGadsDoiTuong(c, 'campaign'), ...dongGadsDoiTuong(a, 'adgroup'), ...dongGadsDoiTuong(d, 'ad')], so7, tienTe: ts.tienTe || 'VND' };
}

// ── Thao tác ──

export interface ThaoTacVao {
  taiSanId: string;
  cap: CapQc;
  doiTuongId: string;
  ten: string;
  hanhDong: HanhDong;
  nganSach?: number;
  /** Giá trị trước khi đổi (trạng thái / ngân sách cũ) — ghi nhật ký */
  giaTriCu?: string;
  budgetResource?: string;
  tuKhoa?: string;
  kieuKhop?: 'EXACT' | 'PHRASE' | 'BROAD';
  lyDo?: string;
}

const moTaGiaTri = (v: ThaoTacVao) =>
  v.hanhDong === 'bat' ? 'BẬT' : v.hanhDong === 'tat' ? 'TẠM DỪNG' : v.hanhDong === 'ngan_sach' ? String(v.nganSach) : `${v.tuKhoa} [${v.kieuKhop || 'PHRASE'}]`;

async function chay(ts: TaiSanNt, v: ThaoTacVao): Promise<string> {
  const k = await import('./ketNoi.service.js');
  if (ts.loai === 'meta') {
    if (!['campaign', 'adgroup', 'ad'].includes(v.cap) || !['bat', 'tat', 'ngan_sach'].includes(v.hanhDong)) throw new ApiError(400, 'Meta: chỉ bật / tạm dừng / đổi ngân sách');
    if (v.hanhDong === 'ngan_sach') {
      // Chiến dịch ngân sách ở nhóm (ABO) / nhóm dùng ngân sách chiến dịch (CBO) / ngân sách trọn đời: KHÔNG đặt ngân sách ngày ở cấp này.
      const hien = (await k.metaGraph(v.doiTuongId.replace(/\D/g, ''), { fields: 'daily_budget,lifetime_budget' })) as { daily_budget?: string; lifetime_budget?: string };
      if (!Number(hien.daily_budget)) {
        throw new ApiError(
          400,
          Number(hien.lifetime_budget) > 0
            ? 'Đối tượng này dùng ngân sách trọn đời — không đổi ngân sách ngày được'
            : v.cap === 'campaign'
              ? 'Chiến dịch này để ngân sách ở từng nhóm quảng cáo — đổi ngân sách ở nhóm'
              : 'Nhóm này dùng ngân sách của chiến dịch — đổi ngân sách ở chiến dịch',
        );
      }
    }
    const tham: Record<string, string> =
      v.hanhDong === 'ngan_sach' ? { daily_budget: metaVaoDonVi(Number(v.nganSach), ts.tienTe) } : { status: v.hanhDong === 'bat' ? 'ACTIVE' : 'PAUSED' };
    const r = await k.metaGraph(v.doiTuongId.replace(/\D/g, ''), tham, 'POST');
    return r.success === false ? 'Facebook không nhận' : 'ok';
  }
  const lenh = lenhGads({
    cid: ts.maNgoai,
    cap: v.cap,
    id: v.doiTuongId,
    hanhDong: v.hanhDong,
    nganSach: v.nganSach,
    budgetResource: v.budgetResource,
    tuKhoa: v.tuKhoa ? { chu: v.tuKhoa, kieuKhop: v.kieuKhop || 'PHRASE' } : undefined,
  });
  if (v.hanhDong === 'ngan_sach' && !v.budgetResource) throw new ApiError(400, 'Chiến dịch này không có ngân sách riêng để đổi');
  const r = (await k.gadsGoi(lenh.duongDan, lenh.body)) as { results?: Array<{ resourceName?: string }> };
  return r.results?.[0]?.resourceName || 'ok';
}

/** Báo trưởng phòng của tài khoản (không báo giám đốc — anh Tâm 11/11/2026). */
async function baoTruongPhong(ts: TaiSanNt, nguoi: Nguoi, noiDung: string): Promise<void> {
  if (!ts.teamId || ts.teamId === '*') return;
  const { teamLeaderId } = await import('./teams.repo.js');
  const leader = await teamLeaderId(ts.teamId).catch(() => '');
  if (!leader || leader === nguoi.sub) return;
  await notify(leader, { type: 'ads_thao_tac', title: `📣 ${nguoi.ten} chỉnh quảng cáo ${ts.khach || ts.ten}`, body: noiDung.slice(0, 300), url: '/ket-noi-mcp?tab=nhat_ky' });
}

export async function thaoTac(nguoi: Nguoi, v: ThaoTacVao, deXuatId?: string): Promise<{ ok: boolean; ketQua: string }> {
  const ts = await taiSanCo(nguoi, v.taiSanId);
  const loi = kiemThaoTac({ hanhDong: v.hanhDong, cap: v.cap, nganSach: v.nganSach, tuKhoa: v.tuKhoa });
  if (loi) throw new ApiError(400, loi);
  const luc = nowTz().toISOString();
  let ketQua = '';
  let ok = true;
  try {
    ketQua = await chay(ts, v);
  } catch (e) {
    ok = false;
    ketQua = (e as Error).message.slice(0, 500);
  }
  const trangThai = ok ? 'da_lam' : 'loi';
  if (deXuatId) {
    await q(`UPDATE ads_thao_tac SET trang_thai = $2, ket_qua = $3, nguoi_lam = $4, lam_luc = $5 WHERE id = $1`, [deXuatId, trangThai, ketQua, nguoi.ten, luc]);
  } else {
    await q(
      `INSERT INTO ads_thao_tac (id, tai_san_id, cap, doi_tuong_id, ten, hanh_dong, gia_tri_cu, gia_tri_moi, ly_do, trang_thai, ket_qua, nguoi_tao, nguoi_lam, tao_luc, lam_luc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
      [newId('AT-'), ts.id, v.cap, v.doiTuongId, v.ten.slice(0, 200), v.hanhDong, String(v.giaTriCu || ''), moTaGiaTri(v), String(v.lyDo || ''), trangThai, ketQua, nguoi.sub, nguoi.ten, luc],
    );
  }
  if (ok) {
    const viec = v.hanhDong === 'ngan_sach' ? `đổi ngân sách ngày ${v.giaTriCu ? `${v.giaTriCu} → ` : ''}${v.nganSach}` : v.hanhDong === 'bat' ? 'bật' : v.hanhDong === 'tat' ? 'tạm dừng' : v.hanhDong === 'tu_khoa_am' ? `thêm từ khoá phủ định "${v.tuKhoa}" vào` : `thêm từ khoá "${v.tuKhoa}" vào`;
    await baoTruongPhong(ts, nguoi, `${viec} ${TEN_CAP[v.cap]} «${v.ten}»${v.lyDo ? ` — ${v.lyDo}` : ''}`).catch(() => undefined);
  }
  if (!ok) throw new ApiError(400, ketQua);
  return { ok, ketQua };
}

// ── Nhật ký + đề xuất ──

export interface DongNhatKy {
  id: string;
  taiSanId: string;
  taiKhoan: string;
  khach: string;
  cap: CapQc;
  doiTuongId: string;
  ten: string;
  hanhDong: HanhDong;
  giaTriCu: string;
  giaTriMoi: string;
  lyDo: string;
  trangThai: string;
  ketQua: string;
  nguoiTao: string;
  nguoiLam: string;
  taoLuc: string;
  lamLuc: string;
}

export async function nhatKy(nguoi: Nguoi, o: { taiSanId?: string; deXuat?: boolean } = {}): Promise<DongNhatKy[]> {
  const ts = (await dsTaiSan()).filter((t) => ['meta', 'gads'].includes(t.loai) && duocThaoTac(nguoi, t.teamId) && (!o.taiSanId || t.id === o.taiSanId));
  if (!ts.length) return [];
  const theoId = new Map(ts.map((t) => [t.id, t]));
  const rows = await q(
    `SELECT * FROM ads_thao_tac WHERE tai_san_id = ANY($1::text[]) AND ${o.deXuat ? "trang_thai = 'de_xuat'" : "trang_thai <> 'de_xuat'"} ORDER BY tao_luc DESC LIMIT 200`,
    [[...theoId.keys()]],
  );
  return rows.map((r) => ({
    id: String(r.id),
    taiSanId: String(r.tai_san_id),
    taiKhoan: theoId.get(String(r.tai_san_id))?.ten || '',
    khach: theoId.get(String(r.tai_san_id))?.khach || '',
    cap: r.cap as CapQc,
    doiTuongId: String(r.doi_tuong_id),
    ten: String(r.ten || ''),
    hanhDong: r.hanh_dong as HanhDong,
    giaTriCu: String(r.gia_tri_cu || ''),
    giaTriMoi: String(r.gia_tri_moi || ''),
    lyDo: String(r.ly_do || ''),
    trangThai: String(r.trang_thai || ''),
    ketQua: String(r.ket_qua || ''),
    nguoiTao: String(r.nguoi_tao || ''),
    nguoiLam: String(r.nguoi_lam || ''),
    taoLuc: String(r.tao_luc || ''),
    lamLuc: String(r.lam_luc || ''),
  }));
}

/** Người trong phòng duyệt đề xuất của AI → làm thật. */
export async function duyetDeXuat(nguoi: Nguoi, id: string): Promise<{ ok: boolean; ketQua: string }> {
  const r = (await q(`SELECT * FROM ads_thao_tac WHERE id = $1 AND trang_thai = 'de_xuat'`, [id]))[0];
  if (!r) throw new ApiError(404, 'Đề xuất không còn chờ duyệt');
  let them: { nganSach?: number; budgetResource?: string; tuKhoa?: string; kieuKhop?: 'EXACT' | 'PHRASE' | 'BROAD' } = {};
  try {
    them = JSON.parse(String(r.ket_qua || '{}'));
  } catch {
    them = {};
  }
  return thaoTac(
    nguoi,
    { taiSanId: String(r.tai_san_id), cap: r.cap, doiTuongId: String(r.doi_tuong_id), ten: String(r.ten), hanhDong: r.hanh_dong, giaTriCu: String(r.gia_tri_cu || ''), lyDo: String(r.ly_do || ''), ...them },
    id,
  );
}

export async function boDeXuat(nguoi: Nguoi, id: string): Promise<void> {
  const r = (await q(`SELECT tai_san_id FROM ads_thao_tac WHERE id = $1`, [id]))[0];
  if (!r) return;
  await taiSanCo(nguoi, String(r.tai_san_id));
  await q(`UPDATE ads_thao_tac SET trang_thai = 'bo', nguoi_lam = $2, lam_luc = $3 WHERE id = $1 AND trang_thai = 'de_xuat'`, [id, nguoi.ten, nowTz().toISOString()]);
}

// ── Nghiên cứu từ khoá (Google Ads) ──

export async function tuKhoa(nguoi: Nguoi, taiSanId: string): Promise<{ tuKhoa: TuKhoaGads[]; cum: CumTimKiem[] }> {
  const ts = await taiSanCo(nguoi, taiSanId);
  if (ts.loai !== 'gads') throw new ApiError(400, 'Nghiên cứu từ khoá chỉ có ở Google Ads');
  const k = await import('./ketNoi.service.js');
  const [a, b] = await Promise.all([
    k.gadsTruyVan(
      ts.maNgoai,
      'SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ' +
        'ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.quality_info.quality_score, metrics.impressions, ' +
        "metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.average_cpc FROM keyword_view WHERE segments.date DURING LAST_30_DAYS AND ad_group_criterion.status != 'REMOVED'",
    ),
    k.gadsTruyVan(
      ts.maNgoai,
      'SELECT search_term_view.search_term, search_term_view.status, campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
        'metrics.conversions FROM search_term_view WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.cost_micros DESC LIMIT 300',
    ),
  ]);
  return { tuKhoa: dongTuKhoa(a).sort((x, y) => y.chi - x.chi), cum: dongCumTimKiem(b) };
}

/** Gợi ý từ khoá (Keyword Planner): tiếng Việt, Việt Nam, mạng tìm kiếm Google. */
export async function goiYTuKhoa(nguoi: Nguoi, taiSanId: string, o: { tuKhoa: string[]; url?: string }) {
  const ts = await taiSanCo(nguoi, taiSanId);
  if (ts.loai !== 'gads') throw new ApiError(400, 'Gợi ý từ khoá chỉ có ở Google Ads');
  const tu = o.tuKhoa.map((x) => x.trim()).filter(Boolean).slice(0, 10);
  const url = String(o.url || '').trim();
  if (!tu.length && !url) throw new ApiError(400, 'Nhập vài từ khoá gốc hoặc địa chỉ trang web');
  const seed = tu.length && url ? { keywordAndUrlSeed: { keywords: tu, url } } : tu.length ? { keywordSeed: { keywords: tu } } : { urlSeed: { url } };
  const k = await import('./ketNoi.service.js');
  try {
    const j = await k.gadsGoi(`customers/${ts.maNgoai.replace(/\D/g, '')}:generateKeywordIdeas`, {
      language: 'languageConstants/1040',
      geoTargetConstants: ['geoTargetConstants/2704'],
      keywordPlanNetwork: 'GOOGLE_SEARCH',
      includeAdultKeywords: false,
      pageSize: 200,
      ...seed,
    });
    return { nguon: 'planner' as const, goiY: dongGoiYTuKhoa(j).sort((a, b) => b.luongTim - a.luongTim) };
  } catch (e) {
    // Keyword Planner cần mức Basic (Explorer bị chặn — kiểm thật 11/11/2026) → AI gợi ý từ bộ não + cụm khách gõ.
    if (!/explorer access|DEVELOPER_TOKEN_NOT_APPROVED|basic or standard/i.test((e as Error).message)) throw e;
    return { nguon: 'ai' as const, goiY: await goiYTuKhoaAi(nguoi, ts, tu, url) };
  }
}

/** Gợi ý từ khoá bằng AI: đọc ghi chú quảng cáo + kho tri thức về khách + cụm khách gõ có chuyển đổi. Không có lượng tìm. */
async function goiYTuKhoaAi(nguoi: Nguoi, ts: TaiSanNt, tu: string[], url: string): Promise<Array<{ tuKhoa: string; luongTim: number; canhTranh: string; giaThapNhat: number; giaCaoNhat: number; lyDo: string }>> {
  const ten = ts.khach || ts.ten;
  const [ghiChu, tk, { timTriThuc }] = await Promise.all([
    docGhiChu(nguoi, ts.id).catch(() => ''),
    tuKhoa(nguoi, ts.id).catch(() => ({ tuKhoa: [] as TuKhoaGads[], cum: [] as CumTimKiem[] })),
    import('./brainItems.service.js'),
  ]);
  const kho = await timTriThuc(`${ten} sản phẩm dịch vụ khu vực khách hàng`, { directorScope: true, customer: ts.khach || undefined }).catch(() => '');
  const daCo = new Set(tk.tuKhoa.map((x) => x.tuKhoa.toLowerCase()));
  const { aiKhoJson } = await import('../ai/brainAi.js');
  const r = (await aiKhoJson(
    [
      `Gợi ý 20–40 từ khoá Google Ads tiếng Việt cho khách «${ten}». Chỉ từ khoá ĐÚNG sản phẩm / dịch vụ / khu vực của khách theo ghi chú và kho`,
      'tri thức; tránh mọi điều ghi chú nói KHÔNG nhận. Ưu tiên ý định mua / liên hệ. Không lặp từ khoá đã có. lyDo: vì sao hợp (≤ 15 chữ).',
      tu.length ? `TỪ KHOÁ GỐC: ${tu.join(', ')}` : '',
      url ? `TRANG WEB: ${url}` : '',
      `\nGHI CHÚ QUẢNG CÁO VỀ KHÁCH:\n${ghiChu || '(chưa có)'}`,
      `\nKHO TRI THỨC:\n${String(kho).slice(0, 3000) || '(không có)'}`,
      `\nCỤM KHÁCH GÕ CÓ CHUYỂN ĐỔI:\n${tk.cum.filter((c) => c.chuyenDoi > 0).slice(0, 40).map((c) => `- ${c.cum} (${c.chuyenDoi.toFixed(1)} CĐ)`).join('\n') || '(không có)'}`,
      `\nTỪ KHOÁ ĐÃ CÓ:\n${[...daCo].slice(0, 120).join(', ') || '(không có)'}`,
    ]
      .filter(Boolean)
      .join('\n'),
    {
      type: 'OBJECT',
      properties: { goiY: { type: 'ARRAY', items: { type: 'OBJECT', properties: { tuKhoa: { type: 'STRING' }, lyDo: { type: 'STRING' } }, required: ['tuKhoa'] } } },
      required: ['goiY'],
    },
  )) as { goiY?: Array<{ tuKhoa?: string; lyDo?: string }> };
  const thay = new Set<string>();
  return (r?.goiY || [])
    .map((g) => ({ tuKhoa: String(g.tuKhoa || '').trim().toLowerCase(), lyDo: String(g.lyDo || '').slice(0, 120) }))
    .filter((g) => g.tuKhoa && !daCo.has(g.tuKhoa) && !thay.has(g.tuKhoa) && thay.add(g.tuKhoa))
    .slice(0, 40)
    .map((g) => ({ ...g, luongTim: 0, canhTranh: '', giaThapNhat: 0, giaCaoNhat: 0 }));
}

// ── Ghi chú về khách → kho tri thức (bộ não thứ 2) ──

const maMucGhiChu = (taiSanId: string) => `ADS-${createHash('sha1').update(taiSanId).digest('hex').slice(0, 16)}`;

export async function docGhiChu(nguoi: Nguoi, taiSanId: string): Promise<string> {
  await taiSanCo(nguoi, taiSanId);
  const { findItem } = await import('./brainItems.repo.js');
  return (await findItem(maMucGhiChu(taiSanId)).catch(() => undefined))?.body || '';
}

// ── CPA mục tiêu (luật thắng / thua — học từ loganriebel/meta-ads-agent, 12/11/2026) ──

export interface MucTieuCpa {
  /** Anh / nhân sự đặt; 0 = chưa đặt */
  caiDat: number;
  /** CPA trung bình 30 ngày của tài khoản (dùng khi chưa đặt) */
  tuDong: number;
  /** Số AI dùng */
  dung: number;
}

async function mucTieuCua(taiSanId: string): Promise<MucTieuCpa> {
  const { cpaMucTieu } = await import('../lib/adsLuat.js');
  const [c, s] = await Promise.all([
    q(`SELECT COALESCE(cpa_muc_tieu, 0) AS c FROM nen_tang_tai_san WHERE id = $1`, [taiSanId]).catch(() => [] as Array<Record<string, unknown>>),
    q(`SELECT COALESCE(SUM(chi_tieu), 0) AS chi, COALESCE(SUM(ket_qua), 0) AS kq FROM nen_tang_so_lieu WHERE tai_san_id = $1 AND ngay >= $2`, [
      taiSanId,
      nowTz().subtract(30, 'day').format('YYYY-MM-DD'),
    ]),
  ]);
  const caiDat = Number(c[0]?.c) || 0;
  const tuDong = Math.round(cpaMucTieu(0, Number(s[0]?.chi) || 0, Number(s[0]?.kq) || 0));
  return { caiDat, tuDong, dung: caiDat > 0 ? caiDat : tuDong };
}

export async function docMucTieu(nguoi: Nguoi, taiSanId: string): Promise<MucTieuCpa> {
  await taiSanCo(nguoi, taiSanId);
  return mucTieuCua(taiSanId);
}

export async function luuMucTieu(nguoi: Nguoi, taiSanId: string, cpa: number): Promise<MucTieuCpa> {
  await taiSanCo(nguoi, taiSanId);
  await q(`UPDATE nen_tang_tai_san SET cpa_muc_tieu = $2 WHERE id = $1`, [taiSanId, Math.max(0, Math.round(cpa) || 0)]);
  return mucTieuCua(taiSanId);
}

/**
 * Số 7 ngày từng chiến dịch / nhóm / quảng cáo (Google: + từ khoá 30 ngày) kèm hiển thị, tần suất → phân loại theo luật.
 * Khoá `cap:id` như đối tượng.
 */
async function phanLoaiTaiKhoan(ts: TaiSanNt, tuKhoa30: TuKhoaGads[], cpa: number) {
  const [{ phanLoai }, { ketQuaMeta }, k] = await Promise.all([import('../lib/adsLuat.js'), import('../lib/nenTang.js'), import('./ketNoi.service.js')]);
  const so = new Map<string, { chi: number; hienThi: number; ketQua: number; tanSuat?: number }>();
  if (ts.loai === 'meta') {
    const levels: Array<[CapQc, string]> = [
      ['campaign', 'campaign'],
      ['adgroup', 'adset'],
      ['ad', 'ad'],
    ];
    await Promise.all(
      levels.map(async ([cap, level]) => {
        const j = await k
          .metaGraph(`${actCua(ts)}/insights`, { level, date_preset: 'last_7d', fields: `${level}_id,spend,impressions,frequency,actions`, limit: '500' })
          .catch(() => ({ data: [] }));
        for (const r of (j.data as Array<Record<string, unknown>>) || []) {
          so.set(`${cap}:${String(r[`${level}_id`])}`, {
            chi: Number(r.spend) || 0,
            hienThi: Number(r.impressions) || 0,
            ketQua: ketQuaMeta(r.actions as never),
            tanSuat: Number(r.frequency) || 0,
          });
        }
      }),
    );
  } else {
    const [c, g] = await Promise.all([
      k.gadsTruyVan(ts.maNgoai, 'SELECT campaign.id, metrics.impressions, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_7_DAYS').catch(() => []),
      k.gadsTruyVan(ts.maNgoai, 'SELECT ad_group.id, metrics.impressions, metrics.cost_micros, metrics.conversions FROM ad_group WHERE segments.date DURING LAST_7_DAYS').catch(() => []),
    ]);
    const gom = (j: unknown, cap: CapQc) => {
      for (const r of ((j as Array<{ results?: Array<Record<string, Record<string, unknown>>> }>) || []).flatMap((x) => x.results || [])) {
        const id = String(cap === 'campaign' ? r.campaign?.id : r.adGroup?.id);
        const cu = so.get(`${cap}:${id}`) || { chi: 0, hienThi: 0, ketQua: 0 };
        cu.chi += (Number(r.metrics?.costMicros) || 0) / 1e6;
        cu.hienThi += Number(r.metrics?.impressions) || 0;
        cu.ketQua += Number(r.metrics?.conversions) || 0;
        so.set(`${cap}:${id}`, cu);
      }
    };
    gom(c, 'campaign');
    gom(g, 'adgroup');
    for (const x of tuKhoa30) so.set(`keyword:${x.id}`, { chi: x.chi, hienThi: x.hienThi, ketQua: x.chuyenDoi });
  }
  // Vừa sửa trên MTJOB → để nền tảng học lại.
  const sua = new Map<string, number>();
  for (const r of await q(`SELECT doi_tuong_id, MAX(lam_luc) AS luc FROM ads_thao_tac WHERE tai_san_id = $1 AND trang_thai = 'da_lam' AND lam_luc >= $2 GROUP BY doi_tuong_id`, [
    ts.id,
    nowTz().subtract(7, 'day').toISOString(),
  ]).catch(() => [] as Array<Record<string, unknown>>)) {
    sua.set(String(r.doi_tuong_id), Math.floor((Date.now() - Date.parse(String(r.luc))) / 86_400_000));
  }
  const nen = ts.loai === 'meta' ? 'meta' : 'gads';
  const pl = new Map<string, ReturnType<typeof phanLoai>>();
  for (const [khoa, s] of so) {
    if (!(s.chi > 0)) continue;
    pl.set(khoa, phanLoai(s, { cpaMucTieu: cpa, nen, ngayTuLanSua: sua.get(khoa.slice(khoa.indexOf(':') + 1)) }));
  }
  return pl;
}

/** Anh / nhân sự ghi điều cần biết khi chạy quảng cáo cho khách → mục kho tri thức của khách (AI đề xuất dựa vào đây). */
export async function luuGhiChu(nguoi: Nguoi, taiSanId: string, noiDung: string): Promise<string> {
  const ts = await taiSanCo(nguoi, taiSanId);
  const body = noiDung.trim().slice(0, 6000);
  const [{ findItem, upsertItem }, { dongBoDoan }, { getCustomers }, { khopKhach }] = await Promise.all([
    import('./brainItems.repo.js'),
    import('./brainItems.service.js'),
    import('./crm.repo.js'),
    import('../lib/brainGate.js'),
  ]);
  const id = maMucGhiChu(taiSanId);
  const cu = await findItem(id).catch(() => undefined);
  const luc = nowTz().toISOString();
  const kh = ts.khach ? khopKhach(ts.khach, await getCustomers().catch(() => [])) : null;
  const ten = ts.khach || ts.ten;
  const item = {
    id,
    title: `Quảng cáo ${ts.loai === 'gads' ? 'Google Ads' : 'Meta'} — ${ten}: lưu ý từ khoá, đối tượng, điều không làm`,
    body,
    summary: `Điều cần biết khi chạy quảng cáo cho ${ten} (sản phẩm, khu vực, từ khoá nên / không nên).`,
    category: 'khach_hang',
    customerId: kh?.id || '',
    customer: kh?.name || ts.khach || '',
    teamId: '',
    tags: ['quảng cáo', 'từ khoá', ts.loai === 'gads' ? 'google ads' : 'meta ads'],
    scope: 'all',
    status: (body ? 'published' : 'archived') as 'published' | 'archived',
    source: 'ads_ghi_chu',
    submittedBy: cu?.submittedBy || nguoi.sub,
    submittedName: cu?.submittedName || nguoi.ten,
    approvedBy: '',
    aiReason: `Ghi chú quảng cáo — sửa lần cuối bởi ${nguoi.ten}`,
    createdAt: cu?.createdAt || luc,
    updatedAt: luc,
  };
  await upsertItem(item);
  await dongBoDoan(item).catch(() => undefined);
  return body;
}

// ── AI đề xuất (đọc bộ não + số liệu) ──

const SCHEMA_DE_XUAT = {
  type: 'OBJECT',
  properties: {
    deXuat: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          hanhDong: { type: 'STRING', enum: ['tu_khoa_am', 'them_tu_khoa', 'tat', 'bat', 'ngan_sach'] },
          cap: { type: 'STRING', enum: ['campaign', 'adgroup', 'ad', 'keyword'] },
          doiTuongId: { type: 'STRING' },
          tuKhoa: { type: 'STRING' },
          kieuKhop: { type: 'STRING', enum: ['EXACT', 'PHRASE', 'BROAD'] },
          nganSach: { type: 'NUMBER' },
          lyDo: { type: 'STRING' },
        },
        required: ['hanhDong', 'cap', 'doiTuongId', 'lyDo'],
      },
    },
  },
  required: ['deXuat'],
};

const vn = (n: number) => Math.round(n).toLocaleString('vi-VN');

/**
 * AI đọc: điều cần biết về khách (ghi chú quảng cáo + kho tri thức) + điều hiểu về anh Tâm + số chiến dịch + từ khoá + cụm
 * từ khách gõ → đề xuất (≤ 15). Kiểm từng đề xuất trỏ đúng đối tượng có thật; bỏ trùng đề xuất đang chờ. Chờ người duyệt.
 */
export async function aiDeXuat(taiSanId: string, nguoi?: Nguoi): Promise<number> {
  const he: Nguoi = nguoi || { sub: 'ai', role: 'director', teamId: '', ten: 'AI' };
  await taiSanCo(he, taiSanId);
  // Mỗi tài khoản một lượt AI tại một thời điểm (cron + người bấm tay chạy chồng → đề xuất trùng, kiểm thật 11/11/2026).
  const { layKhoa, thaKhoa } = await import('./hieuAnh.repo.js');
  const khoa = `ads_ai:${taiSanId}`;
  if (!(await layKhoa(khoa, 3 * 60_000))) throw new ApiError(409, 'AI đang xét tài khoản này — thử lại sau 1–2 phút');
  try {
    return await aiDeXuatKhongKhoa(taiSanId, he);
  } finally {
    await thaKhoa(khoa).catch(() => undefined);
  }
}

async function aiDeXuatKhongKhoa(taiSanId: string, he: Nguoi): Promise<number> {
  const ts = await taiSanCo(he, taiSanId);
  const { doiTuong, so7, tienTe } = await dsDoiTuong(he, taiSanId);
  const camp = doiTuong.filter((d) => d.cap === 'campaign');
  if (!camp.length) return 0;
  const tk = ts.loai === 'gads' ? await tuKhoa(he, taiSanId).catch(() => ({ tuKhoa: [], cum: [] })) : { tuKhoa: [], cum: [] };
  const ghiChu = await docGhiChu(he, taiSanId).catch(() => '');
  const ten = ts.khach || ts.ten;
  const [{ timTriThuc }, hieuAnh] = await Promise.all([
    import('./brainItems.service.js'),
    import('./hieuAnh.service.js').then((m) => m.loiNhacHieuAnh(`${ten} quảng cáo Google Ads từ khoá`)).catch(() => ''),
  ]);
  const kho = await timTriThuc(`${ten} sản phẩm dịch vụ khu vực khách hàng mục tiêu quảng cáo`, { directorScope: true, customer: ts.khach || undefined }).catch(() => '');
  const nhom = doiTuong.filter((d) => d.cap === 'adgroup');
  // Luật thắng / thua / chờ (học từ loganriebel/meta-ads-agent) — AI chỉ được đề xuất trong khuôn luật.
  const mt = await mucTieuCua(ts.id);
  const pl = await phanLoaiTaiKhoan(ts, tk.tuKhoa, mt.dung).catch(() => new Map<string, import('../lib/adsLuat.js').PhanLoaiHq>());
  const tenDt = new Map<string, string>([...doiTuong.map((d) => [`${d.cap}:${d.id}`, `${TEN_CAP[d.cap]} ${d.ten}`] as const), ...tk.tuKhoa.map((x) => [`keyword:${x.id}`, `từ khoá ${x.tuKhoa}`] as const)]);
  const dongLuat = [...pl.entries()]
    .filter(([, p]) => p.nhan !== 'cho')
    .sort((a, b) => a[1].nhan.localeCompare(b[1].nhan))
    .slice(0, 80)
    .map(([khoa, p]) => `- ${khoa} · ${tenDt.get(khoa) || ''} · ${p.nhan.toUpperCase()}${p.tangToiDa ? ` (tăng tối đa ${Math.round(p.tangToiDa * 100)}%)` : ''} · ${p.lyDo}`);
  const soCho = [...pl.values()].filter((p) => p.nhan === 'cho').length;
  const prompt = [
    `Bạn là chuyên viên ${ts.loai === 'gads' ? 'Google Ads' : 'Meta Ads'} của agency MT Digital, tối ưu tài khoản «${ts.ten}» của khách «${ten}» (tiền: ${tienTe}).`,
    'Đề xuất điều chỉnh CỤ THỂ, mỗi đề xuất có lý do ngắn bằng tiếng Việt dựa trên số liệu VÀ hiểu biết về khách bên dưới. Người trong phòng sẽ duyệt.',
    'Ưu tiên: (1) cụm từ khách gõ KHÔNG đúng sản phẩm / khu vực / đối tượng của khách hoặc tốn tiền mà 0 chuyển đổi → tu_khoa_am (gắn vào',
    'chiến dịch: cap=campaign, doiTuongId = mã chiến dịch, tuKhoa = cụm cần loại, kieuKhop PHRASE hoặc EXACT); (2) từ khoá đang chạy tốn tiền',
    'mà không hiệu quả → tat (cap=keyword, doiTuongId = mã từ khoá); (3) cụm khách gõ có chuyển đổi tốt chưa thành từ khoá → them_tu_khoa',
    '(cap=adgroup, doiTuongId = mã nhóm QC phù hợp); (4) chiến dịch hiệu quả tốt / kém rõ rệt → ngan_sach (nganSach = ngân sách ngày MỚI) ĐẶT',
    'ĐÚNG CHỖ ĐANG GIỮ NGÂN SÁCH: chiến dịch có ngân sách riêng → cap=campaign; chiến dịch "không có ngân sách riêng" mà nhóm có ngân sách → cap=adgroup',
    '(mã nhóm); không có ngân sách ngày ở đâu thì KHÔNG đề xuất ngan_sach — hoặc tat. Không đề xuất khi thiếu dữ liệu. Tuyệt đối làm theo ghi chú về khách và điều anh Tâm dặn. Tối đa 15 đề xuất; không',
    'có gì đáng làm thì trả danh sách rỗng. Chỉ dùng mã có trong dữ liệu.',
    'LUẬT BẮT BUỘC (máy đã phân loại sẵn bên dưới, đề xuất trái luật sẽ bị loại): chỉ "tat" đối tượng THUA; chỉ TĂNG ngân sách đối tượng THANG và',
    'không quá mức ghi trong ngoặc; chỉ GIẢM ngân sách đối tượng THUA / MOI; đối tượng MOI (tần suất cao) → nêu trong lý do là cần thay nội dung;',
    'đối tượng CHỜ / không có trong danh sách → không tắt, không đổi ngân sách. Meta: ưu tiên tắt ở cấp QUẢNG CÁO (ad) thua thay vì tắt cả',
    'chiến dịch / nhóm — sửa lớn ở cấp trên làm Meta học lại từ đầu.',
    `CPA mục tiêu: ${mt.dung ? `${vn(mt.dung)} ${tienTe} (${mt.caiDat ? 'phòng đặt' : 'trung bình 30 ngày của tài khoản'})` : 'chưa có'}.`,
    `\nPHÂN LOẠI THEO LUẬT (khoá cap:mã · tên · nhãn · lý do)${soCho ? ` — còn ${soCho} đối tượng CHỜ (thiếu dữ liệu, để yên)` : ''}:\n${dongLuat.join('\n') || '(không có đối tượng thắng / thua / mỏi)'}`,
    '',
    `GHI CHÚ QUẢNG CÁO VỀ KHÁCH (anh / nhân sự nhập):\n${ghiChu || '(chưa có)'}`,
    `\nKHO TRI THỨC VỀ KHÁCH:\n${String(kho).slice(0, 4000) || '(không có)'}`,
    hieuAnh ? `\n${hieuAnh.slice(0, 3000)}` : '',
    `\nCHIẾN DỊCH (mã · tên · trạng thái · ngân sách ngày · 7 ngày: chi / click / kết quả):\n${camp
      .map((c) => `- ${c.id} · ${c.ten} · ${c.bat ? 'BẬT' : 'DỪNG'} · ${c.nganSach ? vn(c.nganSach) : 'không có ngân sách riêng'}${c.nganSachChung ? ' (ngân sách DÙNG CHUNG)' : ''} · ${vn(so7[c.id]?.chi || 0)} / ${so7[c.id]?.click || 0} / ${(so7[c.id]?.ketQua || 0).toFixed(1)}`)
      .join('\n')}`,
    nhom.length
      ? `\nNHÓM QUẢNG CÁO (mã · tên · chiến dịch · ngân sách ngày):\n${nhom
          .slice(0, 120)
          .map((g) => `- ${g.id} · ${g.ten} · ${g.cha} · ${g.nganSach ? vn(g.nganSach) : 'không'}`)
          .join('\n')}`
      : '',
    tk.tuKhoa.length
      ? `\nTỪ KHOÁ 30 NGÀY (mã · từ khoá · trạng thái · điểm CL · click · chi · chuyển đổi):\n${tk.tuKhoa
          .slice(0, 120)
          .map((x) => `- ${x.id} · ${x.tuKhoa} [${x.kieuKhop}] · ${x.bat ? 'BẬT' : 'DỪNG'} · ${x.diemCL || '-'} · ${x.click} · ${vn(x.chi)} · ${x.chuyenDoi.toFixed(1)}`)
          .join('\n')}`
      : '',
    tk.cum.length
      ? `\nCỤM TỪ KHÁCH GÕ 30 NGÀY (chiến dịch · cụm · trạng thái · click · chi · chuyển đổi):\n${tk.cum
          .slice(0, 150)
          .map((x) => `- ${x.campaignId} · ${x.cum} · ${x.trangThai} · ${x.click} · ${vn(x.chi)} · ${x.chuyenDoi.toFixed(1)}`)
          .join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  const { aiKhoJson } = await import('../ai/brainAi.js');
  const r = (await aiKhoJson(prompt, SCHEMA_DE_XUAT)) as { deXuat?: Array<Record<string, unknown>> };
  const coThat = new Set([...doiTuong.map((d) => `${d.cap}:${d.id}`), ...tk.tuKhoa.map((x) => `keyword:${x.id}`)]);
  const tenCua = new Map([...doiTuong.map((d) => [`${d.cap}:${d.id}`, d] as const)]);
  const tkCua = new Map(tk.tuKhoa.map((x) => [x.id, x]));
  const dangCho = new Set(
    (await q(`SELECT hanh_dong, doi_tuong_id, gia_tri_moi FROM ads_thao_tac WHERE tai_san_id = $1 AND trang_thai = 'de_xuat'`, [ts.id])).map(
      (x) => `${x.hanh_dong}|${x.doi_tuong_id}|${x.gia_tri_moi}`,
    ),
  );
  let n = 0;
  for (const d of (r?.deXuat || []).slice(0, 15)) {
    const hanhDong = String(d.hanhDong) as HanhDong;
    const cap = String(d.cap) as CapQc;
    const id = String(d.doiTuongId || '');
    if (!coThat.has(`${cap}:${id}`)) continue;
    if (ts.loai === 'meta' && !['bat', 'tat', 'ngan_sach'].includes(hanhDong)) continue;
    const kieuKhop = (['EXACT', 'PHRASE', 'BROAD'].includes(String(d.kieuKhop)) ? d.kieuKhop : 'PHRASE') as 'EXACT' | 'PHRASE' | 'BROAD';
    const dt = tenCua.get(`${cap}:${id}`);
    const v: ThaoTacVao = {
      taiSanId: ts.id,
      cap,
      doiTuongId: id,
      // Nhóm / quảng cáo trùng tên ở nhiều chiến dịch ("Nhóm cha mẹ" — kiểm thật 12/11/2026) → kèm tên cấp trên cho người duyệt.
      ten:
        cap === 'keyword'
          ? tkCua.get(id)?.tuKhoa || id
          : `${dt?.ten || id}${dt?.cha ? ` · ${tenCua.get(`${cap === 'ad' ? 'adgroup' : 'campaign'}:${dt.cha}`)?.ten || ''}` : ''}`.replace(/ · $/, ''),
      hanhDong,
      nganSach: Number(d.nganSach) || undefined,
      budgetResource: dt?.budgetResource,
      tuKhoa: String(d.tuKhoa || '').trim() || undefined,
      kieuKhop,
    };
    if (kiemThaoTac({ hanhDong, cap, nganSach: v.nganSach, tuKhoa: v.tuKhoa })) continue;
    // Chỉ đổi ngân sách ở đúng cấp đang giữ ngân sách ngày (12/11/2026: AI đề xuất ngân sách cho chiến dịch Meta để ngân sách ở nhóm).
    if (hanhDong === 'ngan_sach' && !(dt?.nganSach && (ts.loai === 'meta' || dt.budgetResource))) continue;
    const luat = locDeXuat({ hanhDong, cap, doiTuongId: id, nganSach: v.nganSach }, pl, dt?.nganSach || 0);
    if (luat.bo) continue;
    if (luat.nganSach) v.nganSach = luat.nganSach;
    const nhanLuat = pl.get(`${cap}:${id}`);
    const lyDo = `${String(d.lyDo || '')}${nhanLuat && ['tat', 'ngan_sach'].includes(hanhDong) ? ` [Luật: ${TEN_NHAN[nhanLuat.nhan]} — ${nhanLuat.lyDo}]` : ''}`;
    const moi = moTaGiaTri(v);
    if (dangCho.has(`${hanhDong}|${id}|${moi}`)) continue;
    dangCho.add(`${hanhDong}|${id}|${moi}`);
    const cu = hanhDong === 'ngan_sach' ? String(dt?.nganSach || '') : dt ? (dt.bat ? 'BẬT' : 'DỪNG') : '';
    // ON CONFLICT: index duy nhất cho đề xuất đang chờ — hai lượt AI song song không tạo trùng.
    const vao = await q(
      `INSERT INTO ads_thao_tac (id, tai_san_id, cap, doi_tuong_id, ten, hanh_dong, gia_tri_cu, gia_tri_moi, ly_do, trang_thai, ket_qua, nguoi_tao, tao_luc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'de_xuat',$10,'ai',$11) ON CONFLICT DO NOTHING RETURNING id`,
      [
        newId('AT-'),
        ts.id,
        cap,
        id,
        v.ten.slice(0, 200),
        hanhDong,
        cu,
        moi,
        lyDo.slice(0, 800),
        JSON.stringify({ nganSach: v.nganSach, budgetResource: v.budgetResource, tuKhoa: v.tuKhoa, kieuKhop: v.kieuKhop }),
        nowTz().toISOString(),
      ],
    );
    if (vao.length) n++;
  }
  if (n && ts.teamId && ts.teamId !== '*') {
    const { teamLeaderId } = await import('./teams.repo.js');
    const leader = await teamLeaderId(ts.teamId).catch(() => '');
    if (leader) await notify(leader, { type: 'ads_thao_tac', title: `🤖 ${n} đề xuất quảng cáo cho ${ten}`, body: 'AI đọc kho tri thức + số liệu, chờ phòng duyệt.', url: '/ket-noi-mcp?tab=nhat_ky' }).catch(() => undefined);
  }
  return n;
}

/**
 * Chuỗi cron: từ 7h sáng, mỗi lượt AI xét MỘT tài khoản quảng cáo đang theo dõi, có chi tiền 7 ngày qua, chưa xét hôm nay.
 */
export async function aiDeXuatHangNgay(): Promise<number> {
  if (Number(nowTz().format('H')) < 7) return 0;
  const homNay = todayIso();
  const { docMoc, ghiMoc } = await import('./hieuAnh.repo.js');
  const ngay = Number(homNay.replace(/-/g, ''));
  const ts = (await dsTaiSan()).filter((t) => t.theoDoi && ['meta', 'gads'].includes(t.loai) && t.teamId);
  for (const t of ts) {
    const khoa = `ads_de_xuat:${t.id}`;
    if ((await docMoc(khoa).catch(() => ngay)) >= ngay) continue;
    await ghiMoc(khoa, ngay);
    const chi = await q(`SELECT COALESCE(SUM(chi_tieu), 0) AS c FROM nen_tang_so_lieu WHERE tai_san_id = $1 AND ngay >= $2`, [
      t.id,
      nowTz().subtract(7, 'day').format('YYYY-MM-DD'),
    ]);
    if (!(Number(chi[0]?.c) > 0)) continue;
    return aiDeXuat(t.id).catch((e) => {
      console.warn('[ads] AI đề xuất', t.id, (e as Error).message.slice(0, 160));
      return 0;
    });
  }
  return 0;
}

// ── Chỉ số chi tiết như Trình quản lý quảng cáo (anh Tâm 11/11/2026) ──

/** Khoảng ngày (YYYY-MM-DD) — như Trình quản lý quảng cáo (anh Tâm 11/11/2026: "xem theo ngày tuần tháng... như fb"). */
export interface Khoang {
  tu: string;
  den: string;
}

const COT_META = 'spend,impressions,reach,frequency,clicks,inline_link_clicks,actions,action_values';
const COT_GADS = 'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value';
const COT_GADS_IS =
  'metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share, ' +
  'metrics.search_top_impression_share, metrics.search_absolute_top_impression_share';
// Cấp tài khoản (FROM customer) Google KHÔNG cho lấy tỷ lệ hiển thị đầu trang (PROHIBITED_METRIC — thử thật 11/11/2026).
const COT_GADS_IS_TK = 'metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share';
const actCua = (ts: TaiSanNt) => `act_${ts.maNgoai.replace(/\D/g, '')}`;

export async function chiTiet(nguoi: Nguoi, taiSanId: string, cap: CapQc, kh: Khoang): Promise<Record<string, unknown>> {
  const ts = await taiSanCo(nguoi, taiSanId);
  const k = await import('./ketNoi.service.js');
  const { chiTietGads, chiTietMeta } = await import('../lib/adsDieuChinh.js');
  if (ts.loai === 'meta') {
    const level = cap === 'campaign' ? 'campaign' : cap === 'adgroup' ? 'adset' : 'ad';
    const j = await k.metaGraph(`${actCua(ts)}/insights`, {
      level,
      time_range: JSON.stringify({ since: kh.tu, until: kh.den }),
      fields: `${level}_id,${COT_META}`,
      limit: '500',
    });
    return chiTietMeta(j, cap);
  }
  const khoang = `segments.date BETWEEN '${kh.tu}' AND '${kh.den}'`;
  const q2 =
    cap === 'campaign'
      ? `SELECT campaign.id, ${COT_GADS}, ${COT_GADS_IS} FROM campaign WHERE ${khoang}`
      : cap === 'adgroup'
        ? `SELECT ad_group.id, ${COT_GADS}, metrics.search_impression_share, metrics.search_rank_lost_impression_share, metrics.search_top_impression_share, ` +
          `metrics.search_absolute_top_impression_share FROM ad_group WHERE ${khoang}`
        : `SELECT ad_group.id, ad_group_ad.ad.id, ${COT_GADS} FROM ad_group_ad WHERE ${khoang}`;
  return chiTietGads(await k.gadsTruyVan(ts.maNgoai, q2), cap);
}

/** Cả tài khoản chia theo ngày / tuần / tháng (như "Chia nhỏ → Theo thời gian" của Facebook). */
export async function theoThoiGian(nguoi: Nguoi, taiSanId: string, kh: Khoang, nhom: 'ngay' | 'tuan' | 'thang') {
  const ts = await taiSanCo(nguoi, taiSanId);
  const k = await import('./ketNoi.service.js');
  const { chiTietGads, chiTietMeta } = await import('../lib/adsDieuChinh.js');
  const { nhomThoiGian } = await import('../lib/khoangNgay.js');
  const ngay: Array<{ ngay: string; chiSo: Record<string, number | undefined> }> = [];
  if (ts.loai === 'meta') {
    const j = (await k.metaGraph(`${actCua(ts)}/insights`, {
      level: 'account',
      time_increment: '1',
      time_range: JSON.stringify({ since: kh.tu, until: kh.den }),
      fields: COT_META,
      limit: '500',
    })) as { data?: Array<Record<string, unknown>> };
    // chiTietMeta gom theo mã đối tượng → dùng ngày làm "mã chiến dịch".
    const cs = chiTietMeta({ data: (j.data || []).map((r) => ({ ...r, campaign_id: r.date_start })) }, 'campaign');
    for (const [d, c] of Object.entries(cs)) ngay.push({ ngay: d, chiSo: c as unknown as Record<string, number> });
  } else {
    const j = (await k.gadsTruyVan(
      ts.maNgoai,
      `SELECT segments.date, ${COT_GADS}, ${COT_GADS_IS_TK} FROM customer WHERE segments.date BETWEEN '${kh.tu}' AND '${kh.den}'`,
    )) as Array<{ results?: Array<Record<string, Record<string, unknown>>> }>;
    const hang = (j || []).flatMap((x) => x.results || []).map((r) => ({ ...r, campaign: { id: String(r.segments?.date || '') } }));
    const cs = chiTietGads([{ results: hang }], 'campaign');
    for (const [d, c] of Object.entries(cs)) ngay.push({ ngay: d, chiSo: c as unknown as Record<string, number> });
  }
  return nhomThoiGian(ngay, nhom);
}
