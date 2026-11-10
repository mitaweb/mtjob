// Kết nối nền tảng qua MCP (anh Tâm 9–10/11/2026). Đợt 1: Meta Ads — MCP CHÍNH THỨC của Meta (https://mcp.facebook.com/ads,
// miễn phí) đăng nhập bằng Facebook; MCP khác (vd chạy trên máy Mac) thêm bằng địa chỉ + mã bí mật. Token chỉ lưu BẢN MÃ.
// Trợ lý giám đốc gọi được công cụ CHỈ ĐỌC; công cụ làm thay đổi tài khoản bị chặn (đợt sau: đề xuất → anh duyệt).
import { q } from '../db/client.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';
import { ApiError } from '../util/errors.js';
import { maHoa, giaiMa } from '../lib/maHoa.js';
import { laCongCuGhi, ketQuaThanhChu, type CongCuMcp } from '../lib/ketNoi.js';

export const META_MCP_URL = 'https://mcp.facebook.com/ads';

function khoa(): string {
  const k = process.env.KET_NOI_KEY || process.env.ZALO_SESSION_KEY || '';
  if (k.length < 32) throw new ApiError(400, 'Máy chủ chưa có khoá mã hoá (KET_NOI_KEY ≥ 32 ký tự trên Vercel)');
  return k;
}

export function metaCauHinh() {
  return {
    appId: process.env.META_APP_ID || '',
    secret: process.env.META_APP_SECRET || '',
    configId: process.env.META_CONFIG_ID || '',
    version: process.env.META_API_VERSION || 'v26.0',
  };
}

export interface KetNoi {
  id: string;
  nenTang: 'meta' | 'mcp';
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
    nenTang: r.nen_tang === 'meta' ? 'meta' : 'mcp',
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

async function timKetNoi(id: string): Promise<(KetNoi & { token: string }) | null> {
  const r = (await q('SELECT * FROM mcp_ket_noi WHERE id = $1', [id]))[0];
  if (!r) return null;
  let token = '';
  if (r.token_ma) {
    try {
      token = giaiMa(String(r.token_ma), khoa());
    } catch {
      token = '';
    }
  }
  return { ...rowTo(r), token };
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

// ── Meta: đăng nhập Facebook → token dài hạn (~60 ngày) ──

async function graph(duongDan: string, tham: Record<string, string>): Promise<Record<string, unknown>> {
  const { version } = metaCauHinh();
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
  const c = metaCauHinh();
  if (!c.appId || !c.secret) throw new ApiError(400, 'Chưa cấu hình META_APP_ID / META_APP_SECRET trên Vercel');
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

/** Tài khoản quảng cáo token này thấy được (Graph API — để anh kiểm nhanh đã kết nối đúng BM chưa). */
async function metaTaiKhoanQc(token: string): Promise<Array<{ id: string; ten: string; trangThai: number; tienTe: string }>> {
  const j = await graph('me/adaccounts', { fields: 'name,account_id,account_status,currency', limit: '200', access_token: token });
  return ((j.data as Array<Record<string, unknown>>) || []).map((x) => ({
    id: String(x.account_id || x.id || ''),
    ten: String(x.name || ''),
    trangThai: Number(x.account_status) || 0,
    tienTe: String(x.currency || ''),
  }));
}

// ── MCP khác (máy Mac / máy chủ riêng): địa chỉ + mã bí mật ──

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

async function moMcp(k: { url: string; token: string }) {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
  ]);
  const client = new Client({ name: 'mtjob', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(k.url), {
    requestInit: k.token ? { headers: { Authorization: `Bearer ${k.token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

async function ghiTrangThai(id: string, o: { trangThai: string; ghiChu: string; congCu?: CongCuMcp[] }): Promise<void> {
  await q(
    `UPDATE mcp_ket_noi SET trang_thai = $2, ghi_chu = $3, cong_cu = COALESCE($4, cong_cu), kiem_tra = $5 WHERE id = $1`,
    [id, o.trangThai, o.ghiChu.slice(0, 500), o.congCu ? JSON.stringify(o.congCu) : null, nowTz().toISOString()],
  );
}

/** Kiểm tra kết nối: liệt kê công cụ MCP (lưu lại cho trợ lý), Meta thì kèm danh sách tài khoản quảng cáo. */
export async function kiemTra(id: string): Promise<{ congCu: CongCuMcp[]; taiKhoanQc?: Array<{ id: string; ten: string; trangThai: number; tienTe: string }>; loiMcp?: string }> {
  const k = await timKetNoi(id);
  if (!k) throw new ApiError(404, 'Không thấy kết nối này');
  const kq: { congCu: CongCuMcp[]; taiKhoanQc?: Array<{ id: string; ten: string; trangThai: number; tienTe: string }>; loiMcp?: string } = { congCu: [] };
  if (k.nenTang === 'meta') kq.taiKhoanQc = await metaTaiKhoanQc(k.token).catch(() => []);
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
    kq.loiMcp = (e as Error).message.slice(0, 300);
    await ghiTrangThai(id, { trangThai: 'loi', ghiChu: kq.loiMcp });
  }
  return kq;
}

/** Trợ lý gọi một công cụ MCP — CHỈ ĐỌC; công cụ làm thay đổi tài khoản bị chặn. */
export async function goiCongCu(id: string, ten: string, thamSo: Record<string, unknown>): Promise<string> {
  const k = await timKetNoi(id);
  if (!k) return `Không có kết nối "${id}".`;
  const cc = k.congCu.find((c) => c.name === ten);
  if (!cc) return `Kết nối "${k.ten}" không có công cụ "${ten}". Các công cụ: ${k.congCu.map((c) => c.name).join(', ') || '(chưa kiểm tra — vào Quản trị → Kết nối nền tảng bấm Kiểm tra)'}.`;
  if (laCongCuGhi(cc)) return `CHƯA LÀM: "${ten}" làm THAY ĐỔI tài khoản quảng cáo — trợ lý chỉ được đọc. Thao tác này anh làm trực tiếp (đợt sau sẽ có đề xuất → anh duyệt).`;
  const c = await moMcp(k);
  try {
    const r = await c.callTool({ name: ten, arguments: thamSo }, undefined, { timeout: 90_000 });
    return ketQuaThanhChu(r as Parameters<typeof ketQuaThanhChu>[0]) || '(công cụ không trả nội dung)';
  } finally {
    await c.close().catch(() => undefined);
  }
}
