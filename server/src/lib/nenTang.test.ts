import { describe, it, expect } from 'vitest';
import { ketQuaMeta, dongMeta, dongGads, dongGa4, dongGsc, tomTatChiSo, xemDuoc, gopTheoNgay, tomTatMetaChienDich } from './nenTang.js';

// Trang "Nền tảng" (anh Tâm 11/11/2026: "đưa riêng phần MCP, kết nối nền tảng ra riêng để các phòng ban có thể sử
// dụng, xem đc các chỉ số cơ bản"). Số liệu GIẢ.

describe('ketQuaMeta — kết quả quảng cáo Meta', () => {
  it('cộng tin nhắn + lead + mua; mỗi nhóm lấy biến thể lớn nhất (Meta báo trùng nhiều tên)', () => {
    expect(
      ketQuaMeta([
        { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '12' },
        { action_type: 'lead', value: '3' },
        { action_type: 'onsite_conversion.lead_grouped', value: '3' },
        { action_type: 'purchase', value: '2' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' },
        { action_type: 'link_click', value: '90' },
      ]),
    ).toBe(17);
    expect(ketQuaMeta(undefined)).toBe(0);
  });
});

describe('đọc số theo ngày từng nền tảng', () => {
  it('Meta insights', () => {
    expect(dongMeta({ data: [{ date_start: '2026-11-10', spend: '1500000.5', impressions: '20000', clicks: '300', actions: [{ action_type: 'lead', value: '4' }] }] })).toEqual([
      { ngay: '2026-11-10', chiTieu: 1500000.5, hienThi: 20000, click: 300, ketQua: 4 },
    ]);
  });
  it('Google Ads searchStream (tiền micros)', () => {
    expect(dongGads([{ results: [{ segments: { date: '2026-11-10' }, metrics: { costMicros: '2500000000', impressions: '1000', clicks: '50', conversions: 3.5 } }] }])).toEqual([
      { ngay: '2026-11-10', chiTieu: 2500, hienThi: 1000, click: 50, ketQua: 3.5 },
    ]);
  });
  it('GA4 runReport (ngày YYYYMMDD)', () => {
    expect(dongGa4({ rows: [{ dimensionValues: [{ value: '20261110' }], metricValues: [{ value: '120' }, { value: '95' }, { value: '6' }] }] })).toEqual([
      { ngay: '2026-11-10', phien: 120, nguoiDung: 95, ketQua: 6 },
    ]);
  });
  it('Search Console', () => {
    expect(dongGsc({ rows: [{ keys: ['2026-11-08'], clicks: 40, impressions: 2000, position: 12.34 }] })).toEqual([
      { ngay: '2026-11-08', click: 40, hienThi: 2000, viTri: 12.34 },
    ]);
  });
  it('dữ liệu hỏng thì rỗng', () => {
    expect(dongMeta(null)).toEqual([]);
    expect(dongGads({})).toEqual([]);
    expect(dongGa4(undefined)).toEqual([]);
    expect(dongGsc('x')).toEqual([]);
  });
});

describe('tomTatChiSo — 7 ngày gần nhất so 7 ngày trước', () => {
  // 14 ngày: 28/10 … 10/11, chi 100/ngày tuần trước, 150/ngày tuần này; vị trí GSC theo hiển thị.
  const ngay = (i: number) => `2026-11-${String(i).padStart(2, '0')}`;
  const ds = [
    ...[28, 29, 30, 31].map((d) => ({ ngay: `2026-10-${d}`, chiTieu: 100, hienThi: 10, click: 1, viTri: 20 })),
    ...[1, 2, 3].map((d) => ({ ngay: ngay(d), chiTieu: 100, hienThi: 10, click: 1, viTri: 20 })),
    ...[4, 5, 6, 7, 8, 9, 10].map((d) => ({ ngay: ngay(d), chiTieu: 150, hienThi: 30, click: 3, viTri: d === 10 ? 2 : 10 })),
    { ngay: ngay(11), chiTieu: 999, hienThi: 999, click: 999, viTri: 1 }, // hôm nay — chưa đủ ngày, không tính
  ];
  it('lấy mốc là hôm qua, bỏ hôm nay', () => {
    const t = tomTatChiSo(ds, '2026-11-11');
    expect(t.denNgay).toBe('2026-11-10');
    expect(t.ky.chiTieu).toBe(1050);
    expect(t.truoc.chiTieu).toBe(700);
    expect(t.ky.click).toBe(21);
    expect(t.ky.ctr).toBeCloseTo(0.1);
    // vị trí bình quân theo hiển thị: (6*30*10 + 30*2) / 210
    expect(t.ky.viTri).toBeCloseTo(8.857, 2);
    expect(t.chuoi.length).toBe(30);
    expect(t.chuoi.at(-1)).toMatchObject({ ngay: '2026-11-10', chiTieu: 150 });
  });
  it('Search Console trễ vài ngày → mốc là ngày cuối có số', () => {
    const t = tomTatChiSo(ds.filter((x) => x.ngay <= '2026-11-08'), '2026-11-11');
    expect(t.denNgay).toBe('2026-11-08');
  });
});

describe('xemDuoc — ai xem tài khoản nào', () => {
  it('giám đốc xem hết; nhân sự chỉ xem tài khoản giao cho phòng mình hoặc giao mọi phòng', () => {
    expect(xemDuoc({ role: 'director', teamId: '' }, '')).toBe(true);
    expect(xemDuoc({ role: 'member', teamId: 'Ads' }, 'Ads')).toBe(true);
    expect(xemDuoc({ role: 'leader', teamId: 'SEO' }, 'Ads')).toBe(false);
    expect(xemDuoc({ role: 'member', teamId: 'SEO' }, '*')).toBe(true);
    expect(xemDuoc({ role: 'member', teamId: 'Ads' }, '')).toBe(false); // chưa giao = chỉ giám đốc
    expect(xemDuoc({ role: 'sale', teamId: '' }, 'Ads')).toBe(false);
  });
});

describe('gopTheoNgay — cộng nhiều tài khoản thành một dòng mỗi ngày', () => {
  it('cộng số; vị trí lấy bình quân theo hiển thị', () => {
    expect(
      gopTheoNgay([
        { ngay: '2026-11-10', chiTieu: 100, click: 2, hienThi: 100, viTri: 10 },
        { ngay: '2026-11-10', chiTieu: 50, click: 1, hienThi: 300, viTri: 2 },
        { ngay: '2026-11-09', chiTieu: 10 },
      ]),
    ).toEqual([
      { ngay: '2026-11-09', chiTieu: 10, hienThi: 0, click: 0, ketQua: 0, phien: 0, nguoiDung: 0, viTri: 0 },
      { ngay: '2026-11-10', chiTieu: 150, hienThi: 400, click: 3, ketQua: 0, phien: 0, nguoiDung: 0, viTri: 4 },
    ]);
  });
});

describe('tomTatMetaChienDich — số chiến dịch Meta cho trợ lý đọc', () => {
  it('mỗi chiến dịch một dòng: chi, hiển thị, click, mọi loại hành động (bỏ trùng tên con)', () => {
    const s = tomTatMetaChienDich({
      data: [
        {
          campaign_name: 'Tin nhắn Salon',
          objective: 'OUTCOME_ENGAGEMENT',
          spend: '850000',
          impressions: '20000',
          clicks: '1500',
          actions: [
            { action_type: 'link_click', value: '1200' },
            { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '35' },
          ],
        },
      ],
    });
    expect(s).toContain('Tin nhắn Salon');
    expect(s).toContain('OUTCOME_ENGAGEMENT');
    expect(s).toContain('850.000đ');
    expect(s).toContain('onsite_conversion.messaging_conversation_started_7d: 35');
    expect(s).toContain('link_click: 1.200');
  });
  it('không có số thì nói rõ', () => {
    expect(tomTatMetaChienDich({ data: [] })).toBe('Không có số liệu trong khoảng này.');
  });
});
