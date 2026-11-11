// Chỉ số nền tảng (anh Tâm 11/11/2026: "đưa riêng phần MCP, kết nối nền tảng ra riêng để các phòng ban có thể sử dụng,
// xem đc các chỉ số cơ bản"). Hàm thuần: đọc số theo ngày từ API từng nền tảng, tóm tắt 7 ngày so 7 ngày trước, quyền xem.

export type LoaiTaiSan = 'meta' | 'gads' | 'ga4' | 'gsc';
export const LOAI_TAI_SAN: Record<LoaiTaiSan, string> = { meta: 'Meta Ads', gads: 'Google Ads', ga4: 'Google Analytics 4', gsc: 'Search Console' };

/** Một ngày số liệu của một tài sản. Trường nào nền tảng không có thì bỏ trống. */
export interface DongSo {
  ngay: string;
  chiTieu?: number;
  hienThi?: number;
  click?: number;
  /** Meta: tin nhắn + lead + mua; Google Ads: chuyển đổi; GA4: sự kiện chính */
  ketQua?: number;
  phien?: number;
  nguoiDung?: number;
  /** Search Console: vị trí trung bình */
  viTri?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const so = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

/** Nhóm kết quả Meta — mỗi nhóm Meta báo dưới nhiều tên trùng nhau, lấy tên có số lớn nhất rồi cộng các nhóm. */
const NHOM_KET_QUA_META = [
  ['onsite_conversion.messaging_conversation_started_7d'],
  ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'],
  ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'],
];

export function ketQuaMeta(actions: Array<{ action_type?: string; value?: unknown }> | undefined): number {
  const theoTen = new Map((Array.isArray(actions) ? actions : []).map((a) => [String(a?.action_type || ''), so(a?.value)]));
  return NHOM_KET_QUA_META.reduce((t, nhom) => t + Math.max(0, ...nhom.map((ten) => theoTen.get(ten) || 0)), 0);
}

/** Meta `act_x/insights?time_increment=1&fields=spend,impressions,clicks,actions` */
export function dongMeta(j: Json): DongSo[] {
  return (Array.isArray(j?.data) ? j.data : [])
    .filter((r: Json) => /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date_start || '')))
    .map((r: Json) => ({ ngay: String(r.date_start), chiTieu: so(r.spend), hienThi: so(r.impressions), click: so(r.clicks), ketQua: ketQuaMeta(r.actions) }));
}

/** Google Ads searchStream: `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer` */
export function dongGads(j: Json): DongSo[] {
  const theoNgay = new Map<string, DongSo>();
  for (const r of (Array.isArray(j) ? j : []).flatMap((x: Json) => (Array.isArray(x?.results) ? x.results : []))) {
    const ngay = String(r?.segments?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) continue;
    const m = r?.metrics || {};
    const cu = theoNgay.get(ngay) || { ngay, chiTieu: 0, hienThi: 0, click: 0, ketQua: 0 };
    cu.chiTieu! += so(m.costMicros) / 1e6;
    cu.hienThi! += so(m.impressions);
    cu.click! += so(m.clicks);
    cu.ketQua! += so(m.conversions);
    theoNgay.set(ngay, cu);
  }
  return [...theoNgay.values()];
}

/** GA4 runReport: dimension date; metrics sessions, activeUsers, keyEvents (đúng thứ tự). */
export function dongGa4(j: Json): DongSo[] {
  return (Array.isArray(j?.rows) ? j.rows : [])
    .map((r: Json) => {
      const d = String(r?.dimensionValues?.[0]?.value || '');
      const v = Array.isArray(r?.metricValues) ? r.metricValues : [];
      return { ngay: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, phien: so(v[0]?.value), nguoiDung: so(v[1]?.value), ketQua: so(v[2]?.value), ok: /^\d{8}$/.test(d) };
    })
    .filter((x: { ok: boolean }) => x.ok)
    .map(({ ok: _ok, ...x }: { ok: boolean } & DongSo) => x);
}

/** Search Console searchAnalytics: dimensions ['date']. */
export function dongGsc(j: Json): DongSo[] {
  return (Array.isArray(j?.rows) ? j.rows : [])
    .filter((r: Json) => /^\d{4}-\d{2}-\d{2}$/.test(String(r?.keys?.[0] || '')))
    .map((r: Json) => ({ ngay: String(r.keys[0]), click: so(r.clicks), hienThi: so(r.impressions), viTri: so(r.position) }));
}

// ── Tóm tắt ──

export interface TongKy {
  chiTieu: number;
  hienThi: number;
  click: number;
  ketQua: number;
  phien: number;
  nguoiDung: number;
  /** click / hiển thị */
  ctr: number;
  /** vị trí trung bình (theo hiển thị); 0 = không có */
  viTri: number;
}

export interface TomTat {
  /** Ngày cuối của kỳ (hôm qua, hoặc ngày cuối có số nếu nền tảng trễ) */
  denNgay: string;
  ky: TongKy;
  truoc: TongKy;
  /** 30 ngày tới denNgay, ngày không có số = 0 */
  chuoi: DongSo[];
}

const congNgay = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function tong(ds: DongSo[]): TongKy {
  const t = { chiTieu: 0, hienThi: 0, click: 0, ketQua: 0, phien: 0, nguoiDung: 0, ctr: 0, viTri: 0 };
  let viTriNhan = 0;
  let viTriHienThi = 0;
  for (const d of ds) {
    t.chiTieu += d.chiTieu || 0;
    t.hienThi += d.hienThi || 0;
    t.click += d.click || 0;
    t.ketQua += d.ketQua || 0;
    t.phien += d.phien || 0;
    t.nguoiDung += d.nguoiDung || 0;
    if (d.viTri && d.hienThi) {
      viTriNhan += d.viTri * d.hienThi;
      viTriHienThi += d.hienThi;
    }
  }
  t.ctr = t.hienThi ? t.click / t.hienThi : 0;
  t.viTri = viTriHienThi ? viTriNhan / viTriHienThi : 0;
  return t;
}

/** 7 ngày tới mốc (hôm qua — hôm nay chưa đủ ngày; nền tảng trễ thì ngày cuối có số) so với 7 ngày trước đó. */
export function tomTatChiSo(ds: DongSo[], homNay: string): TomTat {
  const homQua = congNgay(homNay, -1);
  const cuoi = ds.reduce((m, d) => (d.ngay <= homQua && d.ngay > m ? d.ngay : m), '');
  const denNgay = cuoi || homQua;
  const trong = (tu: string, den: string) => ds.filter((d) => d.ngay >= tu && d.ngay <= den);
  const theoNgay = new Map(ds.map((d) => [d.ngay, d]));
  return {
    denNgay,
    ky: tong(trong(congNgay(denNgay, -6), denNgay)),
    truoc: tong(trong(congNgay(denNgay, -13), congNgay(denNgay, -7))),
    chuoi: Array.from({ length: 30 }, (_, i) => {
      const ngay = congNgay(denNgay, i - 29);
      return { ...(theoNgay.get(ngay) || {}), ngay };
    }),
  };
}

// ── Quyền xem ──

/**
 * Giám đốc xem mọi tài sản. Người khác: tài sản giao cho phòng mình (team_id) hoặc giao mọi phòng ('*'). Chưa giao ('')
 * = chỉ giám đốc.
 */
export function xemDuoc(nguoi: { role: string; teamId: string }, teamTaiSan: string): boolean {
  if (nguoi.role === 'director') return true;
  if (teamTaiSan === '*') return true;
  return !!teamTaiSan && !!nguoi.teamId && teamTaiSan === nguoi.teamId;
}

/** Cộng số nhiều tài sản cùng ngày (thẻ tổng của một nền tảng). Vị trí: bình quân theo hiển thị. Ngày tăng dần. */
export function gopTheoNgay(ds: DongSo[]): DongSo[] {
  const nhom = new Map<string, DongSo[]>();
  for (const d of ds) nhom.set(d.ngay, [...(nhom.get(d.ngay) || []), d]);
  return [...nhom.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ngay, cua]) => {
      const t = tong(cua);
      return { ngay, chiTieu: t.chiTieu, hienThi: t.hienThi, click: t.click, ketQua: t.ketQua, phien: t.phien, nguoiDung: t.nguoiDung, viTri: t.viTri };
    });
}

/** Insights cấp chiến dịch (Graph API) → chữ cho trợ lý: mỗi chiến dịch một dòng, kèm mọi loại hành động. */
export function tomTatMetaChienDich(j: Json): string {
  const ds = Array.isArray(j?.data) ? j.data : [];
  if (!ds.length) return 'Không có số liệu trong khoảng này.';
  const vn = (x: unknown) => Math.round(so(x)).toLocaleString('vi-VN');
  return ds
    .map((c: Json) => {
      const hanhDong = (Array.isArray(c?.actions) ? c.actions : [])
        .map((a: Json) => `${String(a?.action_type || '')}: ${vn(a?.value)}`)
        .join('; ');
      return (
        `- ${String(c?.campaign_name || '(không tên)')} [${String(c?.objective || '?')}] · chi ${vn(c?.spend)}đ · ${vn(c?.impressions)} hiển thị · ` +
        `${vn(c?.clicks)} click${hanhDong ? `\n  Hành động: ${hanhDong}` : ''}`
      );
    })
    .join('\n');
}
