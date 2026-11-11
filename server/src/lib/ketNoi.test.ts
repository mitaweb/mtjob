import { describe, it, expect } from 'vitest';
import { urlDangNhapMeta, laCongCuGhi, ketQuaThanhChu, tomTatCongCu, taoPkce, thachThucPkce, urlDangNhapMcp } from './ketNoi.js';

// Anh Tâm 10/11/2026: "Phần MCP ads anh chưa thấy ở đâu" — kết nối Meta Ads (MCP chính thức) bằng đăng nhập Facebook,
// trợ lý gọi công cụ MCP CHỈ ĐỌC (thao tác thay đổi quảng cáo phải qua duyệt — đợt sau).

describe('urlDangNhapMeta', () => {
  it('Facebook Login: app id, đường quay về, state, quyền ads_mcp_management + ads_read', () => {
    const u = new URL(urlDangNhapMeta({ appId: '123', redirectUri: 'https://job.mtdigital.vn/api/ket-noi/meta/callback', state: 'S1', version: 'v26.0' }));
    expect(u.origin + u.pathname).toBe('https://www.facebook.com/v26.0/dialog/oauth');
    expect(u.searchParams.get('client_id')).toBe('123');
    expect(u.searchParams.get('redirect_uri')).toBe('https://job.mtdigital.vn/api/ket-noi/meta/callback');
    expect(u.searchParams.get('state')).toBe('S1');
    expect(u.searchParams.get('scope')).toBe('ads_mcp_management,ads_read,business_management');
    expect(u.searchParams.get('response_type')).toBe('code');
  });
  it('có cấu hình Facebook Login for Business (config_id) thì dùng config_id thay scope', () => {
    const u = new URL(urlDangNhapMeta({ appId: '1', redirectUri: 'https://x/cb', state: 's', version: 'v26.0', configId: '999' }));
    expect(u.searchParams.get('config_id')).toBe('999');
    expect(u.searchParams.get('scope')).toBeNull();
  });
});

describe('laCongCuGhi — chặn công cụ làm thay đổi tài khoản', () => {
  it('đánh dấu chỉ đọc thì cho; đánh dấu phá huỷ thì chặn', () => {
    expect(laCongCuGhi({ name: 'create_campaign', annotations: { readOnlyHint: true } })).toBe(false);
    expect(laCongCuGhi({ name: 'get_insights', annotations: { destructiveHint: true } })).toBe(true);
  });
  it('không đánh dấu thì xét theo tên', () => {
    for (const n of ['create_campaign', 'update_adset', 'pause_ad', 'delete_ad', 'upload_image', 'set_budget', 'duplicate_ad', 'mutate']) expect(laCongCuGhi({ name: n })).toBe(true);
    for (const n of ['get_insights', 'list_ad_accounts', 'search', 'get_campaigns', 'list_accessible_customers', 'run_report']) expect(laCongCuGhi({ name: n })).toBe(false);
  });
});

describe('ketQuaThanhChu', () => {
  it('ghép các khối chữ, bỏ khối không phải chữ, cắt ngắn', () => {
    const r = ketQuaThanhChu({ content: [{ type: 'text', text: 'Dòng 1' }, { type: 'image', data: 'xx' }, { type: 'text', text: 'Dòng 2' }] }, 100);
    expect(r).toBe('Dòng 1\n[image]\nDòng 2');
    expect(ketQuaThanhChu({ content: [{ type: 'text', text: 'a'.repeat(50) }] }, 20)).toBe(`${'a'.repeat(20)}… (đã cắt bớt)`);
    expect(ketQuaThanhChu({ isError: true, content: [{ type: 'text', text: 'hết quyền' }] }, 100)).toBe('LỖI từ MCP: hết quyền');
    expect(ketQuaThanhChu({ structuredContent: { a: 1 } }, 100)).toBe('{"a":1}');
  });
});

describe('tomTatCongCu', () => {
  it('tên + mô tả ngắn, đánh dấu công cụ ghi', () => {
    const t = tomTatCongCu([
      { name: 'get_insights', description: 'Lấy số liệu quảng cáo theo ngày.\nChi tiết dài…' },
      { name: 'pause_campaign', description: 'Tạm dừng chiến dịch' },
    ]);
    expect(t).toBe('- get_insights: Lấy số liệu quảng cáo theo ngày.\n- pause_campaign (THAY ĐỔI — cần anh duyệt): Tạm dừng chiến dịch');
  });
});

// Anh Tâm 10–11/11/2026: xác minh BM bị lỗi → nối MCP chính thức của Meta KHÔNG cần tạo app: chuẩn MCP OAuth (tự đăng
// ký client + PKCE). Máy chủ Meta khai registration_endpoint, token_endpoint_auth_methods "none", PKCE S256.
describe('PKCE + link đăng nhập MCP', () => {
  it('code_challenge = base64url(sha256(verifier)) — ví dụ chuẩn RFC 7636', () => {
    expect(thachThucPkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const p = taoPkce();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(p.challenge).toBe(thachThucPkce(p.verifier));
  });
  it('link đăng nhập: client tự đăng ký, PKCE S256, quyền cách nhau dấu cách, chỉ định tài nguyên MCP', () => {
    const u = new URL(
      urlDangNhapMcp({
        authorizationEndpoint: 'https://www.facebook.com/v27.0/dialog/oauth',
        clientId: 'C1',
        redirectUri: 'https://job.mtdigital.vn/api/ket-noi/meta/callback',
        state: 'S',
        challenge: 'CH',
        scopes: ['ads_mcp_management', 'ads_read'],
        resource: 'https://mcp.facebook.com/ads',
      }),
    );
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'C1',
      redirect_uri: 'https://job.mtdigital.vn/api/ket-noi/meta/callback',
      state: 'S',
      code_challenge: 'CH',
      code_challenge_method: 'S256',
      scope: 'ads_mcp_management ads_read',
      resource: 'https://mcp.facebook.com/ads',
    });
  });
});
