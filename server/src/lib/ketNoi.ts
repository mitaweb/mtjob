// Kết nối nền tảng qua MCP (anh Tâm 9–10/11/2026: gom việc Agency vào MTJOB; "Phần MCP ads anh chưa thấy ở đâu").
// Hàm THUẦN: link đăng nhập Facebook, nhận ra công cụ làm THAY ĐỔI tài khoản (bị chặn — thao tác phải qua anh duyệt),
// đổi kết quả công cụ MCP thành chữ cho trợ lý đọc.

const QUYEN_META_ADS = 'ads_mcp_management,ads_read,business_management,pages_show_list,pages_read_engagement';
/** Quyền Fanpage — app Meta phải bật nhóm quyền Trang (use case Quản lý mọi thứ trên Trang), không thì Facebook báo Invalid Scopes. */
const QUYEN_META_FANPAGE = 'pages_read_user_content,pages_manage_posts,pages_manage_engagement';

export function urlDangNhapMeta(o: { appId: string; redirectUri: string; state: string; version: string; configId?: string; fanpage?: boolean }): string {
  const u = new URL(`https://www.facebook.com/${o.version}/dialog/oauth`);
  u.searchParams.set('client_id', o.appId);
  u.searchParams.set('redirect_uri', o.redirectUri);
  u.searchParams.set('state', o.state);
  u.searchParams.set('response_type', 'code');
  // Facebook Login for Business: quyền khai trong "cấu hình" (config_id); app thường thì xin quyền bằng scope.
  if (o.configId) u.searchParams.set('config_id', o.configId);
  // Mặc định CHỈ quyền quảng cáo (anh Tâm 11/11/2026: thêm quyền Trang vào đây làm Facebook báo Invalid Scopes khi app
  // chưa bật nhóm quyền Trang). Nút Kết nối Fanpage mới xin thêm — token Facebook giữ mọi quyền đã cấp nên không mất quyền
  // quảng cáo.
  else u.searchParams.set('scope', o.fanpage ? `${QUYEN_META_ADS},${QUYEN_META_FANPAGE}` : QUYEN_META_ADS);
  return u.toString();
}

export interface CongCuMcp {
  name: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  inputSchema?: unknown;
}

const TEN_GHI = /(^|_|-)(create|update|delete|remove|pause|resume|enable|disable|set|upload|edit|mutate|duplicate|copy|publish|add|archive|assign|send|submit|apply)(_|-|$)|^mutate/i;

/** Công cụ làm THAY ĐỔI tài khoản (tạo / sửa / tạm dừng / xoá / đổi ngân sách…) — trợ lý không được tự gọi. */
export function laCongCuGhi(c: Pick<CongCuMcp, 'name' | 'annotations'>): boolean {
  if (c.annotations?.destructiveHint) return true;
  if (c.annotations?.readOnlyHint) return false;
  return TEN_GHI.test(c.name);
}

export function tomTatCongCu(ds: CongCuMcp[]): string {
  return ds
    .map((c) => {
      const mo = String(c.description || '').split('\n')[0]!.trim().slice(0, 160);
      return `- ${c.name}${laCongCuGhi(c) ? ' (THAY ĐỔI — cần anh duyệt)' : ''}${mo ? `: ${mo}` : ''}`;
    })
    .join('\n');
}

/** Kết quả gọi công cụ MCP → chữ (cắt ngắn để không tràn lời nhắc AI). */
export function ketQuaThanhChu(
  r: { content?: Array<{ type: string; text?: string; [k: string]: unknown }>; structuredContent?: unknown; isError?: boolean },
  toiDa = 8000,
): string {
  let chu = (r.content || []).map((c) => (c.type === 'text' ? String(c.text || '') : `[${c.type}]`)).join('\n').trim();
  if (!chu && r.structuredContent !== undefined) chu = JSON.stringify(r.structuredContent);
  if (r.isError) chu = `LỖI từ MCP: ${chu}`;
  return chu.length > toiDa ? `${chu.slice(0, toiDa)}… (đã cắt bớt)` : chu;
}

// ── Google (anh Tâm 11/11/2026: "làm nút kết nối google" — học cách Javis: OAuth client anh tự tạo, dán vào MTJOB) ──

export const QUYEN_GOOGLE = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
];

export function urlDangNhapGoogle(o: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', o.clientId);
  u.searchParams.set('redirect_uri', o.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', o.state);
  // offline + consent: Google mới trả refresh token (Javis cũng đặt như vậy).
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('scope', QUYEN_GOOGLE.join(' '));
  return u.toString();
}

const TOI_DA_DONG = 200;

/** GA4 Data API runReport → bảng chữ. */
export function tomTatGa4(r: {
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string }>;
  rows?: Array<{ dimensionValues?: Array<{ value: string }>; metricValues?: Array<{ value: string }> }>;
  rowCount?: number;
}): string {
  const rows = r.rows || [];
  if (!rows.length) return 'Không có số liệu trong khoảng này.';
  const dau = [...(r.dimensionHeaders || []), ...(r.metricHeaders || [])].map((h) => h.name).join(' | ');
  const dong = rows.slice(0, TOI_DA_DONG).map((x) => [...(x.dimensionValues || []), ...(x.metricValues || [])].map((v) => v.value).join(' | '));
  return [dau, ...dong, `(${r.rowCount ?? rows.length} dòng${rows.length > TOI_DA_DONG ? `, hiện ${TOI_DA_DONG}` : ''})`].join('\n');
}

/** Search Console searchAnalytics.query → bảng chữ. */
export function tomTatGsc(r: { rows?: Array<{ keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }> }, dims: string[]): string {
  const rows = r.rows || [];
  if (!rows.length) return 'Không có số liệu trong khoảng này.';
  return [
    [...dims, 'click', 'hiển thị', 'CTR', 'vị trí'].join(' | '),
    ...rows
      .slice(0, TOI_DA_DONG)
      .map((x) => [...(x.keys || []), x.clicks, x.impressions, `${(x.ctr * 100).toFixed(1)}%`, x.position.toFixed(1)].join(' | ')),
  ].join('\n');
}

function phang(o: unknown, tien = ''): Array<[string, unknown]> {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return [[tien, o]];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => phang(v, tien ? `${tien}.${k}` : k));
}

/** Google Ads searchStream → mỗi dòng "khoá=giá trị"; *Micros đổi ra đồng (÷ 1.000.000). */
export function tomTatGaql(lo: Array<{ results?: Array<Record<string, unknown>> }>): string {
  const kq = lo.flatMap((x) => x.results || []);
  if (!kq.length) return 'Không có dòng nào.';
  const dong = kq.slice(0, TOI_DA_DONG).map((r) =>
    phang(r)
      .map(([k, v]) => {
        if (/Micros$/.test(k)) return `${k.replace(/Micros$/, '')}=${Math.round(Number(v) / 1_000_000).toLocaleString('vi-VN')}`;
        return `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`;
      })
      .join(' · '),
  );
  return [...dong, `(${kq.length} dòng${kq.length > TOI_DA_DONG ? `, hiện ${TOI_DA_DONG}` : ''})`].join('\n');
}

/** Lỗi Google API → mã lỗi cụ thể (Google Ads để trong details[].errors[].errorCode) + câu lỗi đầy đủ. */
export function chiTietLoiGoogle(j: unknown): { ma: string; cau: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = (Array.isArray(j) ? j[0] : j) as any;
  const err = e?.error;
  if (!err) return { ma: '', cau: '' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loi = (Array.isArray(err.details) ? err.details : []).flatMap((d: any) => (Array.isArray(d?.errors) ? d.errors : []));
  const ma = loi.map((x: { errorCode?: Record<string, string> }) => Object.values(x?.errorCode || {})[0]).find(Boolean) || '';
  const them = loi.map((x: { message?: string }) => String(x?.message || '')).filter(Boolean)[0] || '';
  const cau = [String(err.message || ''), them].filter(Boolean).join(' — ');
  return { ma: String(ma), cau };
}
