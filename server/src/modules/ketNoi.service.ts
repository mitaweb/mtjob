// Kết nối nền tảng (anh Tâm 9–11/11/2026). CHỈ giám đốc. Token / mật khẩu app chỉ lưu BẢN MÃ.
//  - Meta Ads: MCP CHÍNH THỨC của Meta (https://mcp.facebook.com/ads, miễn phí), đăng nhập Facebook qua app Meta của
//    công ty (chế độ phát triển — không cần xác minh BM; Meta không cho MTJOB tự đăng ký: "Dynamic registration is not
//    available for this client", 11/11/2026).
//  - Google (Ads, GA4, Search Console): học cách Javis OS — anh tạo OAuth client, dán Client ID / Secret NGAY TRONG
//    MTJOB, bấm Kết nối Google; MTJOB gọi thẳng API Google (không cần máy Mac).
//  - MCP khác (n8n, máy Mac…): địa chỉ https + mã bí mật.
// Trợ lý giám đốc chỉ ĐỌC; công cụ làm thay đổi tài khoản bị chặn.
import { q } from '../db/client.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';
import { ApiError } from '../util/errors.js';
import { maHoa, giaiMa } from '../lib/maHoa.js';
import { laCongCuGhi, ketQuaThanhChu, type CongCuMcp } from '../lib/ketNoi.js';

export const META_MCP_URL = 'https://mcp.facebook.com/ads';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function khoa(): string {
  const k = process.env.KET_NOI_KEY || process.env.ZALO_SESSION_KEY || '';
  if (k.length < 32) throw new ApiError(400, 'Máy chủ chưa có khoá mã hoá (KET_NOI_KEY ≥ 32 ký tự trên Vercel)');
  return k;
}

// ── Cấu hình app đăng nhập — anh dán trong MTJOB (bản mã); biến môi trường Vercel nếu có thì thắng ──

export const KHOA_CAU_HINH = ['meta_app_id', 'meta_app_secret', 'google_client_id', 'google_client_secret', 'google_dev_token', 'google_mcc'] as const;
export type KhoaCauHinh = (typeof KHOA_CAU_HINH)[number];
/** Khoá bí mật: chỉ trả "đã có", không trả giá trị ra trình duyệt. */
const BI_MAT: KhoaCauHinh[] = ['meta_app_secret', 'google_client_secret', 'google_dev_token'];

async function docCauHinh(): Promise<Partial<Record<KhoaCauHinh, string>>> {
  const rows = await q('SELECT khoa, gia_tri_ma FROM ket_noi_cau_hinh').catch(() => []);
  const ra: Partial<Record<KhoaCauHinh, string>> = {};
  for (const r of rows) {
    try {
      ra[String(r.khoa) as KhoaCauHinh] = giaiMa(String(r.gia_tri_ma), khoa());
    } catch {
      /* khoá đổi / hỏng — bỏ */
    }
  }
  return ra;
}

/** Lưu cấu hình; giá trị '' = xoá. Khoá bí mật bỏ trống khi sửa thì giữ nguyên. */
export async function luuCauHinh(patch: Partial<Record<KhoaCauHinh, string>>): Promise<void> {
  const luc = nowTz().toISOString();
  for (const k of KHOA_CAU_HINH) {
    const v = patch[k];
    if (v === undefined) continue;
    const t = v.trim();
    if (!t) {
      if (BI_MAT.includes(k)) continue;
      await q('DELETE FROM ket_noi_cau_hinh WHERE khoa = $1', [k]);
      continue;
    }
    await q(
      `INSERT INTO ket_noi_cau_hinh (khoa, gia_tri_ma, cap_nhat) VALUES ($1, $2, $3)
       ON CONFLICT (khoa) DO UPDATE SET gia_tri_ma = EXCLUDED.gia_tri_ma, cap_nhat = EXCLUDED.cap_nhat`,
      [k, maHoa(t, khoa()), luc],
    );
  }
}

/** Cấu hình cho trình duyệt: id hiện rõ, bí mật chỉ báo có / chưa. */
export async function cauHinhChoTrang(): Promise<Record<string, string | boolean>> {
  const c = await docCauHinh();
  return {
    meta_app_id: process.env.META_APP_ID || c.meta_app_id || '',
    meta_app_secret: !!(process.env.META_APP_SECRET || c.meta_app_secret),
    google_client_id: process.env.GOOGLE_CLIENT_ID || c.google_client_id || '',
    google_client_secret: !!(process.env.GOOGLE_CLIENT_SECRET || c.google_client_secret),
    google_dev_token: !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || c.google_dev_token),
    google_mcc: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || c.google_mcc || '',
  };
}

export async function metaCauHinh() {
  const c = await docCauHinh();
  return {
    appId: process.env.META_APP_ID || c.meta_app_id || '',
    secret: process.env.META_APP_SECRET || c.meta_app_secret || '',
    configId: process.env.META_CONFIG_ID || '',
    version: process.env.META_API_VERSION || 'v26.0',
  };
}

export async function googleCauHinh() {
  const c = await docCauHinh();
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || c.google_client_id || '',
    secret: process.env.GOOGLE_CLIENT_SECRET || c.google_client_secret || '',
    devToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || c.google_dev_token || '',
    mcc: String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || c.google_mcc || '').replace(/\D/g, ''),
    // Google Ads API ra bản mới hằng tháng; v26 = 14/10/2026. Đổi bằng biến môi trường khi Google tắt bản cũ.
    adsVersion: process.env.GOOGLE_ADS_API_VERSION || 'v26',
  };
}

// ── Kết nối đã lưu ──

export interface KetNoi {
  id: string;
  nenTang: 'meta' | 'google' | 'mcp';
  ten: string;
  url: string;
  taiKhoan: string;
  hetHan: number;
  trangThai: string;
  ghiChu: string;
  congCu: CongCuMcp[];
  kiemTra: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowTo(r: any): KetNoi {
  let congCu: CongCuMcp[] = [];
  try {
    const x = JSON.parse(String(r.cong_cu || '[]'));
    if (Array.isArray(x)) congCu = x;
  } catch {
    /* bỏ */
  }
  return {
    id: String(r.id),
    nenTang: r.nen_tang === 'meta' ? 'meta' : r.nen_tang === 'google' ? 'google' : 'mcp',
    ten: String(r.ten || ''),
    url: String(r.url || ''),
    taiKhoan: String(r.tai_khoan || ''),
    hetHan: Number(r.het_han) || 0,
    trangThai: String(r.trang_thai || 'ok'),
    ghiChu: String(r.ghi_chu || ''),
    congCu,
    kiemTra: String(r.kiem_tra || ''),
  };
}

export async function dsKetNoi(): Promise<KetNoi[]> {
  return (await q('SELECT * FROM mcp_ket_noi ORDER BY nen_tang, cap_nhat')).map(rowTo);
}

/** Google: mã truy cập (1 giờ) + mã làm mới (lâu dài). */
interface GoiToken {
  a: string;
  r?: string;
}

/** Kết nối + mã Bearer dùng được ngay (Google sắp hết hạn thì tự làm mới bằng refresh token). */
async function timKetNoi(id: string): Promise<(KetNoi & { token: string }) | null> {
  const r = (await q('SELECT * FROM mcp_ket_noi WHERE id = $1', [id]))[0];
  if (!r) return null;
  const k = rowTo(r);
  let token = '';
  if (r.token_ma) {
    try {
      token = giaiMa(String(r.token_ma), khoa());
    } catch {
      token = '';
    }
  }
  if (k.nenTang !== 'google' || !token.startsWith('{')) return { ...k, token };
  let g: GoiToken;
  try {
    g = JSON.parse(token) as GoiToken;
  } catch {
    return { ...k, token: '' };
  }
  if (g.r && k.hetHan && k.hetHan - Date.now() < 5 * 60_000) {
    try {
      const c = await googleCauHinh();
      const moi = await doiToken(GOOGLE_TOKEN_URL, { grant_type: 'refresh_token', refresh_token: g.r, client_id: c.clientId, client_secret: c.secret }, 'Google');
      g = { a: moi.access, r: moi.refresh || g.r };
      await ghi({ id: k.id, nenTang: k.nenTang, ten: k.ten, url: k.url, token: JSON.stringify(g), taiKhoan: k.taiKhoan, hetHan: moi.hetHan });
    } catch (e) {
      await q("UPDATE mcp_ket_noi SET trang_thai = 'loi', ghi_chu = $2 WHERE id = $1", [id, `Làm mới đăng nhập lỗi — bấm Kết nối lại: ${(e as Error).message}`.slice(0, 500)]);
    }
  }
  return { ...k, token: g.a };
}

async function ghi(o: { id: string; nenTang: string; ten: string; url: string; token: string; taiKhoan: string; hetHan: number }): Promise<void> {
  const luc = nowTz().toISOString();
  await q(
    `INSERT INTO mcp_ket_noi (id, nen_tang, ten, url, token_ma, tai_khoan, het_han, trang_thai, ghi_chu, cap_nhat)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ok', '', $8)
     ON CONFLICT (id) DO UPDATE SET ten = EXCLUDED.ten, url = EXCLUDED.url, token_ma = EXCLUDED.token_ma,
       tai_khoan = EXCLUDED.tai_khoan, het_han = EXCLUDED.het_han, trang_thai = 'ok', ghi_chu = '', cap_nhat = EXCLUDED.cap_nhat`,
    [o.id, o.nenTang, o.ten, o.url, o.token ? maHoa(o.token, khoa()) : '', o.taiKhoan, o.hetHan, luc],
  );
}

export async function xoaKetNoi(id: string): Promise<void> {
  await q('DELETE FROM mcp_ket_noi WHERE id = $1', [id]);
}

async function doiToken(url: string, tham: Record<string, string>, ben: string): Promise<{ access: string; refresh: string; hetHan: number }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(tham).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || !j.access_token) {
    const loi = (j.error as { message?: string } | undefined)?.message || String(j.error_description || j.error || `HTTP ${r.status}`);
    throw new ApiError(400, `${ben} báo: ${loi}`);
  }
  const giay = Number(j.expires_in) || 0;
  return { access: String(j.access_token), refresh: String(j.refresh_token || ''), hetHan: giay ? Date.now() + giay * 1000 : 0 };
}

// ── Meta: đăng nhập Facebook → token dài hạn (~60 ngày) ──

async function graph(duongDan: string, tham: Record<string, string>): Promise<Record<string, unknown>> {
  const { version } = await metaCauHinh();
  const u = new URL(`https://graph.facebook.com/${version}/${duongDan}`);
  for (const [k, v] of Object.entries(tham)) u.searchParams.set(k, v);
  const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const loi = (j.error as { message?: string } | undefined)?.message || `HTTP ${r.status}`;
    throw new ApiError(400, `Facebook báo: ${loi}`);
  }
  return j;
}

export async function metaNhanCode(code: string, redirectUri: string): Promise<string> {
  const c = await metaCauHinh();
  if (!c.appId || !c.secret) throw new ApiError(400, 'Chưa có App ID / App Secret của app Meta — dán ở mục Kết nối nền tảng');
  const ngan = await graph('oauth/access_token', { client_id: c.appId, client_secret: c.secret, redirect_uri: redirectUri, code });
  const dai = await graph('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: c.appId,
    client_secret: c.secret,
    fb_exchange_token: String(ngan.access_token || ''),
  });
  const token = String(dai.access_token || ngan.access_token || '');
  if (!token) throw new ApiError(400, 'Facebook không trả mã truy cập');
  const giay = Number(dai.expires_in) || 0;
  const me = await graph('me', { fields: 'name', access_token: token }).catch(() => ({ name: '' }));
  await ghi({ id: 'meta', nenTang: 'meta', ten: 'Meta Ads (MCP chính thức)', url: META_MCP_URL, token, taiKhoan: String(me.name || ''), hetHan: giay ? Date.now() + giay * 1000 : 0 });
  return String(me.name || '');
}

export interface TaiSan {
  loai: string;
  id: string;
  ten: string;
  ghiChu?: string;
}

/** Tài khoản quảng cáo token này thấy được (Graph API — để anh kiểm nhanh đã kết nối đúng BM chưa). */
async function metaTaiKhoanQc(token: string): Promise<TaiSan[]> {
  const j = await graph('me/adaccounts', { fields: 'name,account_id,account_status,currency', limit: '200', access_token: token });
  return ((j.data as Array<Record<string, unknown>>) || []).map((x) => ({
    loai: 'Meta Ads',
    id: String(x.account_id || x.id || ''),
    ten: String(x.name || ''),
    ghiChu: `${String(x.currency || '')}${Number(x.account_status) !== 1 ? ` · không hoạt động (${Number(x.account_status) || 0})` : ''}`,
  }));
}

// ── Google: OAuth của chính công ty → gọi thẳng API ──

export async function googleNhanCode(code: string, redirectUri: string): Promise<string> {
  const c = await googleCauHinh();
  if (!c.clientId || !c.secret) throw new ApiError(400, 'Chưa có Client ID / Client Secret Google — dán ở mục Kết nối nền tảng');
  const t = await doiToken(GOOGLE_TOKEN_URL, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: c.clientId, client_secret: c.secret }, 'Google');
  if (!t.refresh) throw new ApiError(400, 'Google không trả mã làm mới — vào myaccount.google.com/permissions gỡ quyền app rồi kết nối lại');
  let email = '';
  try {
    const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access}` }, signal: AbortSignal.timeout(15_000) });
    email = String(((await r.json()) as { email?: string }).email || '');
  } catch {
    /* không có email cũng được */
  }
  await ghi({ id: 'google', nenTang: 'google', ten: 'Google (Ads · GA4 · Search Console)', url: '', token: JSON.stringify({ a: t.access, r: t.refresh }), taiKhoan: email, hetHan: t.hetHan });
  return email;
}

/** Gọi API Google bằng kết nối đã lưu. Lỗi → câu dễ hiểu (thường gặp: chưa bật API trong project, chưa đủ quyền). */
async function googleApi(url: string, init: RequestInit & { ads?: { loginCustomerId?: string } } = {}): Promise<unknown> {
  const k = await timKetNoi('google');
  if (!k?.token) throw new ApiError(400, 'Chưa kết nối Google — vào Quản trị → Kết nối nền tảng bấm Kết nối Google');
  const headers: Record<string, string> = { Authorization: `Bearer ${k.token}`, accept: 'application/json' };
  if (init.body) headers['content-type'] = 'application/json';
  if (init.ads) {
    const c = await googleCauHinh();
    if (c.devToken) headers['developer-token'] = c.devToken;
    const login = String(init.ads.loginCustomerId || c.mcc || '').replace(/\D/g, '');
    if (login) headers['login-customer-id'] = login;
  }
  const r = await fetch(url, { method: init.method || 'GET', body: init.body, headers, signal: AbortSignal.timeout(60_000) });
  const j = (await r.json().catch(() => ({}))) as unknown;
  if (!r.ok) {
    const e = (Array.isArray(j) ? j[0] : j) as { error?: { message?: string; status?: string } };
    const msg = e?.error?.message || `HTTP ${r.status}`;
    const goiY = /has not been used|is disabled|SERVICE_DISABLED/i.test(msg)
      ? ' — vào console.cloud.google.com bật API này cho project rồi thử lại'
      : /developer.token|DEVELOPER_TOKEN/i.test(msg)
        ? ' — project chưa được duyệt truy cập Google Ads API (xin mức Explorer), hoặc cần dán developer token'
        : r.status === 403
          ? ' — tài khoản Google đã kết nối chưa có quyền với mục này'
          : '';
    throw new ApiError(400, `Google báo: ${msg.slice(0, 300)}${goiY}`);
  }
  return j;
}

export async function gadsTaiKhoan(): Promise<TaiSan[]> {
  const c = await googleCauHinh();
  // Có MCC: liệt kê tài khoản con của MCC (agency) — kèm tên; không thì danh sách tài khoản đăng nhập thấy được.
  if (c.mcc) {
    const lo = (await googleApi(`https://googleads.googleapis.com/${c.adsVersion}/customers/${c.mcc}/googleAds:searchStream`, {
      method: 'POST',
      body: JSON.stringify({
        query:
          'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status, customer_client.currency_code FROM customer_client WHERE customer_client.level <= 1',
      }),
      ads: { loginCustomerId: c.mcc },
    })) as Array<{ results?: Array<{ customerClient?: Record<string, unknown> }> }>;
    return lo
      .flatMap((x) => x.results || [])
      .map((x) => x.customerClient || {})
      .map((cc) => ({
        loai: 'Google Ads',
        id: String(cc.id || ''),
        ten: String(cc.descriptiveName || ''),
        ghiChu: `${cc.manager ? 'MCC · ' : ''}${String(cc.currencyCode || '')}${cc.status && cc.status !== 'ENABLED' ? ` · ${String(cc.status)}` : ''}`,
      }));
  }
  const j = (await googleApi(`https://googleads.googleapis.com/${c.adsVersion}/customers:listAccessibleCustomers`, { ads: {} })) as { resourceNames?: string[] };
  return (j.resourceNames || []).map((r) => ({ loai: 'Google Ads', id: r.replace('customers/', ''), ten: '' }));
}

export async function gadsTruyVan(customerId: string, query: string, loginCustomerId?: string): Promise<unknown> {
  const c = await googleCauHinh();
  const cid = customerId.replace(/\D/g, '');
  if (!cid) throw new ApiError(400, 'Thiếu mã tài khoản Google Ads (10 số)');
  if (!/^\s*select\s/i.test(query)) throw new ApiError(400, 'Chỉ được truy vấn đọc (GAQL bắt đầu bằng SELECT)');
  return googleApi(`https://googleads.googleapis.com/${c.adsVersion}/customers/${cid}/googleAds:searchStream`, {
    method: 'POST',
    body: JSON.stringify({ query }),
    ads: { loginCustomerId },
  });
}

export async function ga4TaiSan(): Promise<TaiSan[]> {
  const j = (await googleApi('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200')) as {
    accountSummaries?: Array<{ displayName?: string; propertySummaries?: Array<{ property?: string; displayName?: string }> }>;
  };
  return (j.accountSummaries || []).flatMap((a) =>
    (a.propertySummaries || []).map((p) => ({ loai: 'GA4', id: String(p.property || '').replace('properties/', ''), ten: String(p.displayName || ''), ghiChu: String(a.displayName || '') })),
  );
}

export async function ga4BaoCao(propertyId: string, body: Record<string, unknown>): Promise<unknown> {
  const id = String(propertyId).replace(/\D/g, '');
  if (!id) throw new ApiError(400, 'Thiếu mã property GA4');
  return googleApi(`https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`, { method: 'POST', body: JSON.stringify(body) });
}

export async function gscTaiSan(): Promise<TaiSan[]> {
  const j = (await googleApi('https://www.googleapis.com/webmasters/v3/sites')) as { siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> };
  return (j.siteEntry || []).map((s) => ({ loai: 'Search Console', id: String(s.siteUrl || ''), ten: String(s.siteUrl || ''), ghiChu: String(s.permissionLevel || '') }));
}

export async function gscTruyVan(siteUrl: string, body: Record<string, unknown>): Promise<unknown> {
  if (!siteUrl) throw new ApiError(400, 'Thiếu site (vd https://mtdigital.vn/ hoặc sc-domain:mtdigital.vn)');
  return googleApi(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { method: 'POST', body: JSON.stringify(body) });
}

// ── MCP khác (n8n / máy Mac / máy chủ riêng): địa chỉ + mã bí mật ──

export async function themMcp(o: { ten: string; url: string; token: string }): Promise<string> {
  let u: URL;
  try {
    u = new URL(o.url);
  } catch {
    throw new ApiError(400, 'Địa chỉ MCP không hợp lệ');
  }
  if (u.protocol !== 'https:') throw new ApiError(400, 'Địa chỉ MCP phải là https:// (vd qua Cloudflare Tunnel)');
  const id = newId('MCP');
  await ghi({ id, nenTang: 'mcp', ten: o.ten.trim() || u.hostname, url: u.toString(), token: o.token.trim(), taiKhoan: '', hetHan: 0 });
  return id;
}

// ── Gọi MCP ──

/**
 * Mở phiên MCP: Streamable HTTP trước; máy chủ chỉ nói SSE (n8n bản cũ, địa chỉ kết thúc /sse…) thì thử lại bằng SSE
 * (anh Tâm 11/11/2026: "kết hợp n8n"). Mã bí mật gửi `Authorization: Bearer` ở cả hai kiểu.
 */
async function moMcp(k: { url: string; token: string }) {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
  ]);
  const headers: Record<string, string> = k.token ? { Authorization: `Bearer ${k.token}` } : {};
  const url = new URL(k.url);
  const chiSse = /\/sse\/?$/.test(url.pathname);
  if (!chiSse) {
    const client = new Client({ name: 'mtjob', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
      return client;
    } catch (e) {
      // Sai mã bí mật thì báo luôn, khỏi thử SSE.
      if (/\b401\b|unauthori[sz]ed|forbidden|\b403\b/i.test((e as Error).message)) throw e;
    }
  }
  const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
  const client = new Client({ name: 'mtjob', version: '1.0.0' });
  await client.connect(
    new SSEClientTransport(url, {
      requestInit: { headers },
      eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headers } }) },
    }),
  );
  return client;
}

async function ghiTrangThai(id: string, o: { trangThai: string; ghiChu: string; congCu?: CongCuMcp[] }): Promise<void> {
  await q(
    `UPDATE mcp_ket_noi SET trang_thai = $2, ghi_chu = $3, cong_cu = COALESCE($4, cong_cu), kiem_tra = $5 WHERE id = $1`,
    [id, o.trangThai, o.ghiChu.slice(0, 500), o.congCu ? JSON.stringify(o.congCu) : null, nowTz().toISOString()],
  );
}

export interface KetQuaKiemTra {
  congCu: CongCuMcp[];
  taiSan: TaiSan[];
  /** Lỗi từng phần (vd chưa bật API GA4) — các phần khác vẫn chạy */
  loi: string[];
}

/** Kiểm tra kết nối: Google → tài khoản Ads / property GA4 / site Search Console; Meta / MCP → công cụ MCP (+ TK quảng cáo). */
export async function kiemTra(id: string): Promise<KetQuaKiemTra> {
  const k = await timKetNoi(id);
  if (!k) throw new ApiError(404, 'Không thấy kết nối này');
  const kq: KetQuaKiemTra = { congCu: [], taiSan: [], loi: [] };
  if (k.nenTang === 'google') {
    for (const [ten, f] of [
      ['Google Ads', gadsTaiKhoan],
      ['GA4', ga4TaiSan],
      ['Search Console', gscTaiSan],
    ] as const) {
      try {
        kq.taiSan.push(...(await f()));
      } catch (e) {
        kq.loi.push(`${ten}: ${(e as Error).message}`);
      }
    }
    await ghiTrangThai(id, {
      trangThai: kq.loi.length === 3 ? 'loi' : 'ok',
      ghiChu: kq.loi.length ? kq.loi.join(' | ') : `${kq.taiSan.length} tài sản`,
    });
    return kq;
  }
  if (k.nenTang === 'meta') kq.taiSan = await metaTaiKhoanQc(k.token).catch((e) => (kq.loi.push(`Tài khoản quảng cáo: ${(e as Error).message}`), []));
  try {
    const c = await moMcp(k);
    try {
      const r = await c.listTools();
      kq.congCu = (r.tools || []).map((t) => ({ name: t.name, description: (t.description || '').slice(0, 600), annotations: t.annotations, inputSchema: t.inputSchema }));
    } finally {
      await c.close().catch(() => undefined);
    }
    await ghiTrangThai(id, { trangThai: 'ok', ghiChu: `${kq.congCu.length} công cụ`, congCu: kq.congCu });
  } catch (e) {
    kq.loi.push(`MCP: ${(e as Error).message.slice(0, 300)}`);
    await ghiTrangThai(id, { trangThai: 'loi', ghiChu: kq.loi.join(' | ') });
  }
  return kq;
}

/** Trợ lý gọi một công cụ MCP — CHỈ ĐỌC; công cụ làm thay đổi tài khoản bị chặn. */
export async function goiCongCu(id: string, ten: string, thamSo: Record<string, unknown>): Promise<string> {
  const k = await timKetNoi(id);
  if (!k) return `Không có kết nối "${id}".`;
  const cc = k.congCu.find((c) => c.name === ten);
  if (!cc) return `Kết nối "${k.ten}" không có công cụ "${ten}". Các công cụ: ${k.congCu.map((c) => c.name).join(', ') || '(chưa kiểm tra — vào Quản trị → Kết nối nền tảng bấm Kiểm tra)'}.`;
  if (laCongCuGhi(cc)) return `CHƯA LÀM: "${ten}" làm THAY ĐỔI tài khoản — trợ lý chỉ được đọc. Thao tác này anh làm trực tiếp (đợt sau sẽ có đề xuất → anh duyệt).`;
  const c = await moMcp(k);
  try {
    const r = await c.callTool({ name: ten, arguments: thamSo }, undefined, { timeout: 90_000 });
    return ketQuaThanhChu(r as Parameters<typeof ketQuaThanhChu>[0]) || '(công cụ không trả nội dung)';
  } finally {
    await c.close().catch(() => undefined);
  }
}
