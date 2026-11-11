import { describe, it, expect } from 'vitest';
import { urlDangNhapMeta, laCongCuGhi, ketQuaThanhChu, tomTatCongCu, urlDangNhapGoogle, tomTatGa4, tomTatGsc, tomTatGaql, chiTietLoiGoogle } from './ketNoi.js';

// Anh Tâm 10/11/2026: "Phần MCP ads anh chưa thấy ở đâu" — kết nối Meta Ads (MCP chính thức) bằng đăng nhập Facebook,
// trợ lý gọi công cụ MCP CHỈ ĐỌC (thao tác thay đổi quảng cáo phải qua duyệt — đợt sau).

describe('urlDangNhapMeta', () => {
  it('Facebook Login: app id, đường quay về, state, quyền ads_mcp_management + ads_read', () => {
    const u = new URL(urlDangNhapMeta({ appId: '123', redirectUri: 'https://job.mtdigital.vn/api/ket-noi/meta/callback', state: 'S1', version: 'v26.0' }));
    expect(u.origin + u.pathname).toBe('https://www.facebook.com/v26.0/dialog/oauth');
    expect(u.searchParams.get('client_id')).toBe('123');
    expect(u.searchParams.get('redirect_uri')).toBe('https://job.mtdigital.vn/api/ket-noi/meta/callback');
    expect(u.searchParams.get('state')).toBe('S1');
    // Chỉ quyền quảng cáo: app Meta chưa bật nhóm quyền Trang thì Facebook báo Invalid Scopes (anh Tâm 11/11/2026).
    expect(u.searchParams.get('scope')).toBe('ads_mcp_management,ads_read,business_management,pages_show_list,pages_read_engagement');
    expect(u.searchParams.get('response_type')).toBe('code');
  });
  it('Fanpage: xin thêm quyền đọc bình luận, đăng bài, trả lời bình luận', () => {
    const u = new URL(urlDangNhapMeta({ appId: '1', redirectUri: 'https://x/cb', state: 's', version: 'v26.0', fanpage: true }));
    expect(u.searchParams.get('scope')).toBe('ads_mcp_management,ads_read,business_management,pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_posts,pages_manage_engagement');
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

// Anh Tâm 11/11/2026: "em làm nút kết nối google" — học cách Javis: anh dán Client ID / Secret của OAuth client (loại Web)
// ngay trong MTJOB, bấm Kết nối Google, MTJOB gọi thẳng API Google (Ads, GA4, Search Console) — không cần máy Mac.
describe('Google', () => {
  it('link đăng nhập: offline + consent (lấy refresh token), đủ quyền Ads / GA4 / Search Console (chỉ đọc)', () => {
    const u = new URL(urlDangNhapGoogle({ clientId: 'CID.apps.googleusercontent.com', redirectUri: 'https://job.mtdigital.vn/api/ket-noi/google/callback', state: 'S' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'CID.apps.googleusercontent.com',
      redirect_uri: 'https://job.mtdigital.vn/api/ket-noi/google/callback',
      response_type: 'code',
      state: 'S',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope:
        'openid email https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly',
    });
  });
  it('GA4 runReport → bảng chữ (tiêu đề cột + dòng)', () => {
    const t = tomTatGa4({
      dimensionHeaders: [{ name: 'date' }],
      metricHeaders: [{ name: 'sessions' }, { name: 'activeUsers' }],
      rows: [
        { dimensionValues: [{ value: '20261101' }], metricValues: [{ value: '120' }, { value: '95' }] },
        { dimensionValues: [{ value: '20261102' }], metricValues: [{ value: '80' }, { value: '70' }] },
      ],
      rowCount: 2,
    });
    expect(t).toBe('date | sessions | activeUsers\n20261101 | 120 | 95\n20261102 | 80 | 70\n(2 dòng)');
    expect(tomTatGa4({ rows: [] })).toBe('Không có số liệu trong khoảng này.');
  });
  it('Search Console → bảng chữ, CTR %, vị trí 1 số lẻ', () => {
    const t = tomTatGsc({ rows: [{ keys: ['dịch vụ seo'], clicks: 12, impressions: 340, ctr: 0.0353, position: 7.264 }] }, ['query']);
    expect(t).toBe('query | click | hiển thị | CTR | vị trí\ndịch vụ seo | 12 | 340 | 3.5% | 7.3');
  });
  it('Google Ads searchStream → dòng phẳng; tiền micros đổi ra đồng', () => {
    const t = tomTatGaql([
      { results: [{ campaign: { name: 'Search VN', status: 'ENABLED' }, metrics: { clicks: '15', costMicros: '2500000000000', conversions: 3 } }] },
    ]);
    expect(t).toBe('campaign.name=Search VN · campaign.status=ENABLED · metrics.clicks=15 · metrics.cost=2.500.000 · metrics.conversions=3\n(1 dòng)');
    expect(tomTatGaql([])).toBe('Không có dòng nào.');
  });
});

describe('chiTietLoiGoogle — mã lỗi Google Ads cụ thể (anh Tâm 11/11/2026: "kết nối rồi mà chưa có gg ads")', () => {
  it('lấy mã lỗi + câu lỗi trong details của Google Ads', () => {
    const j = [
      {
        error: {
          code: 403,
          message: 'The caller does not have permission',
          status: 'PERMISSION_DENIED',
          details: [
            {
              '@type': 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure',
              errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' }, message: "User doesn't have permission to access customer." }],
            },
          ],
        },
      },
    ];
    expect(chiTietLoiGoogle(j)).toEqual({ ma: 'USER_PERMISSION_DENIED', cau: "The caller does not have permission — User doesn't have permission to access customer." });
  });
  it('lỗi thường (không có details)', () => {
    expect(chiTietLoiGoogle({ error: { message: 'API disabled' } })).toEqual({ ma: '', cau: 'API disabled' });
    expect(chiTietLoiGoogle(null)).toEqual({ ma: '', cau: '' });
  });
});
