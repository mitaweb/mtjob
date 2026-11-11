// Điều chỉnh quảng cáo ngay trên MTJOB (anh Tâm 11/11/2026: "anh muốn có thể thao tác điều chỉnh ads trên phần mềm luôn").
// Chốt: bật / tạm dừng chiến dịch, nhóm quảng cáo, quảng cáo, từ khoá; đổi ngân sách ngày (không giới hạn mức, chỉ hỏi xác
// nhận); thêm từ khoá phủ định (Google Ads). Nhân sự phòng được giao tài khoản tự làm, báo trưởng phòng; giám đốc xem nhật ký.
// Hàm THUẦN: quy đổi tiền, tạo lệnh sửa Google Ads, kiểm lệnh, quyền, đọc danh sách đối tượng.

export type CapQc = 'campaign' | 'adgroup' | 'ad' | 'keyword';
export type HanhDong = 'bat' | 'tat' | 'ngan_sach' | 'tu_khoa_am' | 'them_tu_khoa';
export const TEN_CAP: Record<CapQc, string> = { campaign: 'chiến dịch', adgroup: 'nhóm quảng cáo', ad: 'quảng cáo', keyword: 'từ khoá' };

/** Meta: ngân sách tính theo đơn vị nhỏ nhất của loại tiền — tiền không có số lẻ (VND, JPY, KRW…) giữ nguyên, còn lại ×100. */
const KHONG_SO_LE = new Set(['VND', 'JPY', 'KRW', 'CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'PYG', 'TWD']);
const heSo = (tienTe: string) => (KHONG_SO_LE.has(String(tienTe || 'VND').toUpperCase()) ? 1 : 100);
export const metaRaTien = (donVi: unknown, tienTe: string) => (Number(donVi) || 0) / heSo(tienTe);
export const metaVaoDonVi = (tien: number, tienTe: string) => String(Math.round(tien * heSo(tienTe)));

// ── Google Ads ──

export interface LenhGads {
  cid: string;
  cap: CapQc;
  /** campaign / adgroup: mã số; ad / keyword: "mãNhóm~mãQC|mãTừKhoá" */
  id: string;
  hanhDong: HanhDong;
  nganSach?: number;
  /** campaign_budget.resource_name của chiến dịch (đổi ngân sách) */
  budgetResource?: string;
  /** Từ khoá phủ định: chữ + kiểu khớp; gắn vào chiến dịch `id` */
  tuKhoa?: { chu: string; kieuKhop: 'EXACT' | 'PHRASE' | 'BROAD' };
}

const TAI_NGUYEN: Record<CapQc, string> = { campaign: 'campaigns', adgroup: 'adGroups', ad: 'adGroupAds', keyword: 'adGroupCriteria' };

export function lenhGads(l: LenhGads): { duongDan: string; body: { operations: unknown[] } } {
  const cid = l.cid.replace(/\D/g, '');
  if (l.hanhDong === 'ngan_sach') {
    return {
      duongDan: `customers/${cid}/campaignBudgets:mutate`,
      body: { operations: [{ update: { resourceName: l.budgetResource, amountMicros: String(Math.round((l.nganSach || 0) * 1e6)) }, updateMask: 'amount_micros' }] },
    };
  }
  if (l.hanhDong === 'them_tu_khoa') {
    return {
      duongDan: `customers/${cid}/adGroupCriteria:mutate`,
      body: {
        operations: [
          { create: { adGroup: `customers/${cid}/adGroups/${l.id}`, status: 'ENABLED', keyword: { text: l.tuKhoa?.chu || '', matchType: l.tuKhoa?.kieuKhop || 'PHRASE' } } },
        ],
      },
    };
  }
  if (l.hanhDong === 'tu_khoa_am') {
    return {
      duongDan: `customers/${cid}/campaignCriteria:mutate`,
      body: {
        operations: [
          { create: { campaign: `customers/${cid}/campaigns/${l.id}`, negative: true, keyword: { text: l.tuKhoa?.chu || '', matchType: l.tuKhoa?.kieuKhop || 'PHRASE' } } },
        ],
      },
    };
  }
  const tn = TAI_NGUYEN[l.cap];
  return {
    duongDan: `customers/${cid}/${tn}:mutate`,
    body: { operations: [{ update: { resourceName: `customers/${cid}/${tn}/${l.id}`, status: l.hanhDong === 'bat' ? 'ENABLED' : 'PAUSED' }, updateMask: 'status' }] },
  };
}

/** Lệnh sai → câu lỗi; hợp lệ → null. */
export function kiemThaoTac(o: { hanhDong: HanhDong; cap: CapQc; nganSach?: number; tuKhoa?: string }): string | null {
  if (!['bat', 'tat', 'ngan_sach', 'tu_khoa_am', 'them_tu_khoa'].includes(o.hanhDong)) return 'Thao tác không hỗ trợ.';
  if (o.hanhDong === 'them_tu_khoa') {
    if (o.cap !== 'adgroup') return 'Từ khoá mới phải thêm vào một nhóm quảng cáo.';
    if (!String(o.tuKhoa || '').trim()) return 'Thiếu từ khoá.';
  }
  if (o.hanhDong === 'ngan_sach') {
    if (!['campaign', 'adgroup'].includes(o.cap)) return `${TEN_CAP[o.cap]} không có ngân sách riêng.`;
    if (!(Number(o.nganSach) > 0)) return 'Ngân sách ngày phải là số lớn hơn 0.';
  }
  if (o.hanhDong === 'tu_khoa_am') {
    if (o.cap !== 'campaign') return 'Từ khoá phủ định gắn vào chiến dịch.';
    if (!String(o.tuKhoa || '').trim()) return 'Thiếu từ khoá phủ định.';
  }
  return null;
}

/** Giống quyền xem: giám đốc mọi tài khoản; nhân sự tài khoản giao cho phòng mình hoặc mọi phòng ('*'). */
export function duocThaoTac(nguoi: { role: string; teamId: string }, teamTaiSan: string): boolean {
  if (nguoi.role === 'director') return true;
  if (teamTaiSan === '*') return true;
  return !!teamTaiSan && !!nguoi.teamId && teamTaiSan === nguoi.teamId;
}

// ── Danh sách đối tượng ──

export interface DoiTuongQc {
  id: string;
  ten: string;
  cap: CapQc;
  bat: boolean;
  trangThai: string;
  /** Ngân sách ngày (tiền, không phải đơn vị nhỏ); 0 = không có ngân sách riêng */
  nganSach: number;
  /** Mã cấp trên (nhóm QC → chiến dịch; QC / từ khoá → nhóm QC) */
  cha: string;
  budgetResource?: string;
  /** Google Ads: ngân sách dùng chung nhiều chiến dịch — đổi là đổi cả các chiến dịch kia */
  nganSachChung?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export function dongMetaDoiTuong(j: Json, cap: CapQc, tienTe: string): DoiTuongQc[] {
  return (Array.isArray(j?.data) ? j.data : []).map((x: Json) => ({
    id: String(x.id),
    ten: String(x.name || ''),
    cap,
    bat: String(x.status || '') === 'ACTIVE',
    trangThai: String(x.effective_status || x.status || ''),
    nganSach: x.daily_budget ? metaRaTien(x.daily_budget, tienTe) : 0,
    cha: String(cap === 'adgroup' ? x.campaign_id || '' : cap === 'ad' ? x.adset_id || '' : ''),
  }));
}

export function dongGadsDoiTuong(j: Json, cap: CapQc): DoiTuongQc[] {
  const ra: DoiTuongQc[] = [];
  for (const r of (Array.isArray(j) ? j : []).flatMap((x: Json) => (Array.isArray(x?.results) ? x.results : []))) {
    let o: DoiTuongQc | null = null;
    if (cap === 'campaign' && r.campaign) {
      o = { id: String(r.campaign.id), ten: String(r.campaign.name || ''), cap, bat: r.campaign.status === 'ENABLED', trangThai: String(r.campaign.status || ''), nganSach: 0, cha: '' };
      if (r.campaignBudget?.resourceName) {
        o.nganSach = (Number(r.campaignBudget.amountMicros) || 0) / 1e6;
        o.budgetResource = String(r.campaignBudget.resourceName);
        o.nganSachChung = !!r.campaignBudget.explicitlyShared;
      }
    } else if (cap === 'adgroup' && r.adGroup) {
      o = { id: String(r.adGroup.id), ten: String(r.adGroup.name || ''), cap, bat: r.adGroup.status === 'ENABLED', trangThai: String(r.adGroup.status || ''), nganSach: 0, cha: String(r.campaign?.id || '') };
    } else if (cap === 'ad' && r.adGroupAd) {
      const ad = r.adGroupAd.ad || {};
      const ten = String(ad.name || ad.responsiveSearchAd?.headlines?.[0]?.text || `Quảng cáo ${ad.id}`);
      o = { id: `${r.adGroup?.id}~${ad.id}`, ten, cap, bat: r.adGroupAd.status === 'ENABLED', trangThai: String(r.adGroupAd.status || ''), nganSach: 0, cha: String(r.adGroup?.id || '') };
    } else if (cap === 'keyword' && r.adGroupCriterion) {
      const k = r.adGroupCriterion;
      o = {
        id: `${r.adGroup?.id}~${k.criterionId}`,
        ten: `${String(k.keyword?.text || '')} [${String(k.keyword?.matchType || '')}]`,
        cap,
        bat: k.status === 'ENABLED',
        trangThai: String(k.status || ''),
        nganSach: 0,
        cha: String(r.adGroup?.id || ''),
      };
    }
    if (o && o.trangThai !== 'REMOVED') ra.push(o);
  }
  return ra;
}

// ── Nghiên cứu từ khoá Google Ads (anh Tâm 11/11/2026: "cần xem nghiên cứu các từ khoá nhiều hơn chỉ là chỉ số") ──

const so = (x: unknown) => Number(x) || 0;
const tienMicros = (x: unknown) => so(x) / 1e6;
const hang = (j: Json): Json[] => (Array.isArray(j) ? j : []).flatMap((x: Json) => (Array.isArray(x?.results) ? x.results : []));

export interface TuKhoaGads {
  id: string;
  tuKhoa: string;
  kieuKhop: string;
  bat: boolean;
  trangThai: string;
  campaignId: string;
  chienDich: string;
  nhom: string;
  /** Điểm chất lượng 1–10; 0 = Google chưa chấm */
  diemCL: number;
  hienThi: number;
  click: number;
  chi: number;
  chuyenDoi: number;
  cpc: number;
}

/** GAQL keyword_view (không chia theo ngày → mỗi từ khoá một dòng). */
export function dongTuKhoa(j: Json): TuKhoaGads[] {
  return hang(j)
    .filter((r) => r?.adGroupCriterion?.keyword)
    .map((r) => {
      const k = r.adGroupCriterion;
      const m = r.metrics || {};
      return {
        id: `${r.adGroup?.id}~${k.criterionId}`,
        tuKhoa: String(k.keyword.text || ''),
        kieuKhop: String(k.keyword.matchType || ''),
        bat: k.status === 'ENABLED',
        trangThai: String(k.status || ''),
        campaignId: String(r.campaign?.id || ''),
        chienDich: String(r.campaign?.name || ''),
        nhom: String(r.adGroup?.name || ''),
        diemCL: so(k.qualityInfo?.qualityScore),
        hienThi: so(m.impressions),
        click: so(m.clicks),
        chi: tienMicros(m.costMicros),
        chuyenDoi: so(m.conversions),
        cpc: tienMicros(m.averageCpc),
      };
    });
}

export interface CumTimKiem {
  cum: string;
  campaignId: string;
  chienDich: string;
  /** ADDED = đã thành từ khoá; EXCLUDED = đã phủ định; NONE = chưa xử lý */
  trangThai: string;
  hienThi: number;
  click: number;
  chi: number;
  chuyenDoi: number;
  /** Tốn tiền mà không ra chuyển đổi — ứng viên từ khoá phủ định */
  langPhi: boolean;
}

/** GAQL search_term_view — gộp các dòng cùng chiến dịch + cụm từ (Google tách theo nhóm QC). Tốn nhiều trước. */
export function dongCumTimKiem(j: Json): CumTimKiem[] {
  const gop = new Map<string, CumTimKiem>();
  for (const r of hang(j)) {
    const cum = String(r?.searchTermView?.searchTerm || '').trim();
    if (!cum) continue;
    const khoa = `${r.campaign?.id}|${cum}`;
    const m = r.metrics || {};
    const cu = gop.get(khoa) || {
      cum,
      campaignId: String(r.campaign?.id || ''),
      chienDich: String(r.campaign?.name || ''),
      trangThai: String(r.searchTermView?.status || ''),
      hienThi: 0,
      click: 0,
      chi: 0,
      chuyenDoi: 0,
      langPhi: false,
    };
    cu.hienThi += so(m.impressions);
    cu.click += so(m.clicks);
    cu.chi += tienMicros(m.costMicros);
    cu.chuyenDoi += so(m.conversions);
    gop.set(khoa, cu);
  }
  return [...gop.values()].map((x) => ({ ...x, langPhi: x.chi > 0 && x.chuyenDoi === 0 })).sort((a, b) => b.chi - a.chi);
}

export interface GoiYTuKhoa {
  tuKhoa: string;
  luongTim: number;
  canhTranh: string;
  giaThapNhat: number;
  giaCaoNhat: number;
}

/** KeywordPlanIdeaService.generateKeywordIdeas — giá thầu đầu trang (micros → tiền). */
export function dongGoiYTuKhoa(j: Json): GoiYTuKhoa[] {
  return (Array.isArray(j?.results) ? j.results : []).map((r: Json) => {
    const m = r?.keywordIdeaMetrics || {};
    return {
      tuKhoa: String(r?.text || ''),
      luongTim: so(m.avgMonthlySearches),
      canhTranh: String(m.competition || ''),
      giaThapNhat: tienMicros(m.lowTopOfPageBidMicros),
      giaCaoNhat: tienMicros(m.highTopOfPageBidMicros),
    };
  });
}

// ── Chỉ số chi tiết như Trình quản lý quảng cáo (anh Tâm 11/11/2026: "lấy đc càng nhiều chỉ số về để tối ưu càng tốt") ──

export interface ChiTietGads {
  hienThi: number;
  click: number;
  ctr: number;
  cpc: number;
  chi: number;
  chuyenDoi: number;
  tyLeCD: number;
  cpa: number;
  giaTriCD: number;
  roas: number;
  /** Tỷ lệ hiển thị trên mạng tìm kiếm (0–1); undefined = không có (vd quảng cáo) */
  tyLeHienThi?: number;
  matNganSach?: number;
  matXepHang?: number;
  dauTrang?: number;
  dauTrangTuyetDoi?: number;
}

const idGads = (r: Json, cap: CapQc) =>
  cap === 'campaign' ? String(r.campaign?.id || '') : cap === 'adgroup' ? String(r.adGroup?.id || '') : `${r.adGroup?.id}~${r.adGroupAd?.ad?.id}`;
const tyLe = (x: unknown) => (x === undefined || x === null || x === '' ? undefined : so(x));

/** GAQL (không chia ngày) → chỉ số theo mã đối tượng; tỷ lệ tính lại từ tổng. */
export function chiTietGads(j: Json, cap: CapQc): Record<string, ChiTietGads> {
  const ra: Record<string, ChiTietGads> = {};
  for (const r of hang(j)) {
    const id = idGads(r, cap);
    if (!id || id.includes('undefined')) continue;
    const m = r.metrics || {};
    const cu = ra[id] || { hienThi: 0, click: 0, ctr: 0, cpc: 0, chi: 0, chuyenDoi: 0, tyLeCD: 0, cpa: 0, giaTriCD: 0, roas: 0 };
    cu.hienThi += so(m.impressions);
    cu.click += so(m.clicks);
    cu.chi += tienMicros(m.costMicros);
    cu.chuyenDoi += so(m.conversions);
    cu.giaTriCD += so(m.conversionsValue);
    for (const [k, f] of [
      ['tyLeHienThi', 'searchImpressionShare'],
      ['matNganSach', 'searchBudgetLostImpressionShare'],
      ['matXepHang', 'searchRankLostImpressionShare'],
      ['dauTrang', 'searchTopImpressionShare'],
      ['dauTrangTuyetDoi', 'searchAbsoluteTopImpressionShare'],
    ] as const) {
      const v = tyLe(m[f]);
      if (v !== undefined) cu[k] = v;
    }
    ra[id] = cu;
  }
  for (const c of Object.values(ra)) {
    c.ctr = c.hienThi ? c.click / c.hienThi : 0;
    c.cpc = c.click ? c.chi / c.click : 0;
    c.tyLeCD = c.click ? c.chuyenDoi / c.click : 0;
    c.cpa = c.chuyenDoi ? c.chi / c.chuyenDoi : 0;
    c.roas = c.chi ? c.giaTriCD / c.chi : 0;
  }
  return ra;
}

export interface ChiTietMeta {
  chi: number;
  hienThi: number;
  tiepCan: number;
  tanSuat: number;
  click: number;
  clickLink: number;
  ctr: number;
  cpc: number;
  cpm: number;
  tinNhan: number;
  lead: number;
  mua: number;
  giaTriMua: number;
  roas: number;
  /** tin nhắn + lead + mua (như ô Kết quả) */
  ketQua: number;
  cpa: number;
}

const lonNhat = (ds: Json, ten: string[]) => {
  const m = new Map((Array.isArray(ds) ? ds : []).map((a: Json) => [String(a?.action_type || ''), so(a?.value)]));
  return Math.max(0, ...ten.map((t) => (m.get(t) as number) || 0));
};

/** Meta insights (level campaign / adset / ad) → chỉ số theo mã đối tượng. */
export function chiTietMeta(j: Json, cap: CapQc): Record<string, ChiTietMeta> {
  const truong = cap === 'campaign' ? 'campaign_id' : cap === 'adgroup' ? 'adset_id' : 'ad_id';
  const ra: Record<string, ChiTietMeta> = {};
  for (const r of Array.isArray(j?.data) ? j.data : []) {
    const id = String(r?.[truong] || '');
    if (!id) continue;
    const chi = so(r.spend);
    const hienThi = so(r.impressions);
    const click = so(r.clicks);
    const tinNhan = lonNhat(r.actions, ['onsite_conversion.messaging_conversation_started_7d']);
    const lead = lonNhat(r.actions, ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']);
    const mua = lonNhat(r.actions, ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase']);
    const giaTriMua = lonNhat(r.action_values, ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase']);
    const ketQua = tinNhan + lead + mua;
    ra[id] = {
      chi,
      hienThi,
      tiepCan: so(r.reach),
      tanSuat: so(r.frequency),
      click,
      clickLink: so(r.inline_link_clicks),
      ctr: hienThi ? click / hienThi : 0,
      cpc: click ? chi / click : 0,
      cpm: hienThi ? (chi / hienThi) * 1000 : 0,
      tinNhan,
      lead,
      mua,
      giaTriMua,
      roas: chi ? giaTriMua / chi : 0,
      ketQua,
      cpa: ketQua ? chi / ketQua : 0,
    };
  }
  return ra;
}
