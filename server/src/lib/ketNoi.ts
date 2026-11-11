import { createHash, randomBytes } from 'node:crypto';

// Kết nối nền tảng qua MCP (anh Tâm 9–10/11/2026: gom việc Agency vào MTJOB; "Phần MCP ads anh chưa thấy ở đâu").
// Hàm THUẦN: link đăng nhập Facebook, nhận ra công cụ làm THAY ĐỔI tài khoản (bị chặn — thao tác phải qua anh duyệt),
// đổi kết quả công cụ MCP thành chữ cho trợ lý đọc.

export function urlDangNhapMeta(o: { appId: string; redirectUri: string; state: string; version: string; configId?: string }): string {
  const u = new URL(`https://www.facebook.com/${o.version}/dialog/oauth`);
  u.searchParams.set('client_id', o.appId);
  u.searchParams.set('redirect_uri', o.redirectUri);
  u.searchParams.set('state', o.state);
  u.searchParams.set('response_type', 'code');
  // Facebook Login for Business: quyền khai trong "cấu hình" (config_id); app thường thì xin quyền bằng scope.
  if (o.configId) u.searchParams.set('config_id', o.configId);
  else u.searchParams.set('scope', 'ads_mcp_management,ads_read,business_management');
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

// ── Chuẩn MCP OAuth (tự đăng ký client + PKCE) — nối MCP chính thức của Meta KHÔNG cần tạo app (anh Tâm 11/11/2026) ──

/** code_challenge S256 = base64url(sha256(verifier)) — RFC 7636. */
export function thachThucPkce(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function taoPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: thachThucPkce(verifier) };
}

export function urlDangNhapMcp(o: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scopes: string[];
  resource: string;
}): string {
  const u = new URL(o.authorizationEndpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', o.clientId);
  u.searchParams.set('redirect_uri', o.redirectUri);
  u.searchParams.set('state', o.state);
  u.searchParams.set('code_challenge', o.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('scope', o.scopes.join(' '));
  u.searchParams.set('resource', o.resource);
  return u.toString();
}
