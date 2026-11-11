import { describe, it, expect } from 'vitest';
import { metaRaTien, metaVaoDonVi, lenhGads, duocThaoTac, kiemThaoTac, dongMetaDoiTuong, dongGadsDoiTuong, dongTuKhoa, dongCumTimKiem, dongGoiYTuKhoa, chiTietGads, chiTietMeta } from './adsDieuChinh.js';

// Điều chỉnh quảng cáo ngay trên MTJOB (anh Tâm 11/11/2026). Số liệu GIẢ.

describe('ngân sách Meta — đơn vị nhỏ nhất của loại tiền', () => {
  it('VND không có số lẻ: giữ nguyên; USD: chia 100', () => {
    expect(metaRaTien('500000', 'VND')).toBe(500000);
    expect(metaRaTien('2550', 'USD')).toBe(25.5);
    expect(metaVaoDonVi(500000, 'VND')).toBe('500000');
    expect(metaVaoDonVi(25.5, 'USD')).toBe('2550');
  });
});

describe('lenhGads — lệnh sửa Google Ads', () => {
  it('tạm dừng chiến dịch', () => {
    expect(lenhGads({ cid: '123-456-7890', cap: 'campaign', id: '111', hanhDong: 'tat' })).toEqual({
      duongDan: 'customers/1234567890/campaigns:mutate',
      body: { operations: [{ update: { resourceName: 'customers/1234567890/campaigns/111', status: 'PAUSED' }, updateMask: 'status' }] },
    });
  });
  it('bật nhóm quảng cáo; bật quảng cáo (mã nhóm~mã QC)', () => {
    expect(lenhGads({ cid: '1', cap: 'adgroup', id: '22', hanhDong: 'bat' }).body.operations[0]).toEqual({
      update: { resourceName: 'customers/1/adGroups/22', status: 'ENABLED' },
      updateMask: 'status',
    });
    expect(lenhGads({ cid: '1', cap: 'ad', id: '22~33', hanhDong: 'tat' })).toEqual({
      duongDan: 'customers/1/adGroupAds:mutate',
      body: { operations: [{ update: { resourceName: 'customers/1/adGroupAds/22~33', status: 'PAUSED' }, updateMask: 'status' }] },
    });
  });
  it('đổi ngân sách ngày: sửa campaign budget, tiền micros', () => {
    expect(lenhGads({ cid: '1', cap: 'campaign', id: '111', hanhDong: 'ngan_sach', nganSach: 350000, budgetResource: 'customers/1/campaignBudgets/9' })).toEqual({
      duongDan: 'customers/1/campaignBudgets:mutate',
      body: { operations: [{ update: { resourceName: 'customers/1/campaignBudgets/9', amountMicros: '350000000000' }, updateMask: 'amount_micros' }] },
    });
  });
});

describe('kiemThaoTac — chặn lệnh sai', () => {
  it('ngân sách phải là số dương; chỉ chiến dịch / nhóm có ngân sách', () => {
    expect(kiemThaoTac({ hanhDong: 'ngan_sach', nganSach: 0, cap: 'campaign' })).toMatch(/ngân sách/i);
    expect(kiemThaoTac({ hanhDong: 'ngan_sach', nganSach: 200000, cap: 'ad' })).toMatch(/không có ngân sách/i);
    expect(kiemThaoTac({ hanhDong: 'ngan_sach', nganSach: 200000, cap: 'campaign' })).toBeNull();
    expect(kiemThaoTac({ hanhDong: 'tat', cap: 'ad' })).toBeNull();
    expect(kiemThaoTac({ hanhDong: 'xoa' as never, cap: 'ad' })).toMatch(/không hỗ trợ/i);
  });
});

describe('duocThaoTac — ai được chỉnh tài khoản nào', () => {
  it('giám đốc mọi tài khoản; nhân sự tài khoản giao cho phòng mình (hoặc mọi phòng); chưa giao thì chỉ giám đốc', () => {
    expect(duocThaoTac({ role: 'director', teamId: '' }, '')).toBe(true);
    expect(duocThaoTac({ role: 'member', teamId: 'Ads' }, 'Ads')).toBe(true);
    expect(duocThaoTac({ role: 'leader', teamId: 'SEO' }, 'Ads')).toBe(false);
    expect(duocThaoTac({ role: 'member', teamId: 'Ads' }, '*')).toBe(true);
    expect(duocThaoTac({ role: 'member', teamId: 'Ads' }, '')).toBe(false);
  });
});

describe('đọc danh sách đối tượng quảng cáo', () => {
  it('Meta: chiến dịch có ngân sách ngày, trạng thái', () => {
    expect(
      dongMetaDoiTuong(
        { data: [{ id: '1', name: 'C1', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '300000' }, { id: '2', name: 'C2', status: 'PAUSED', effective_status: 'PAUSED' }] },
        'campaign',
        'VND',
      ),
    ).toEqual([
      { id: '1', ten: 'C1', cap: 'campaign', bat: true, trangThai: 'ACTIVE', nganSach: 300000, cha: '' },
      { id: '2', ten: 'C2', cap: 'campaign', bat: false, trangThai: 'PAUSED', nganSach: 0, cha: '' },
    ]);
  });
  it('Google Ads: chiến dịch kèm ngân sách (micros) và mã ngân sách; bỏ đã xoá', () => {
    expect(
      dongGadsDoiTuong(
        [
          {
            results: [
              { campaign: { id: '111', name: 'Search', status: 'ENABLED' }, campaignBudget: { resourceName: 'customers/1/campaignBudgets/9', amountMicros: '350000000000', explicitlyShared: false } },
              { campaign: { id: '112', name: 'Cũ', status: 'REMOVED' } },
            ],
          },
        ],
        'campaign',
      ),
    ).toEqual([{ id: '111', ten: 'Search', cap: 'campaign', bat: true, trangThai: 'ENABLED', nganSach: 350000, cha: '', budgetResource: 'customers/1/campaignBudgets/9', nganSachChung: false }]);
  });
});

// Anh Tâm 11/11/2026: "đối với Google Ads cần xem nghiên cứu các từ khoá nhiều hơn chỉ là chỉ số".
describe('nghiên cứu từ khoá Google Ads', () => {
  it('từ khoá đang chạy: chữ, kiểu khớp, điểm chất lượng, click, chi, chuyển đổi, CPC', () => {
    expect(
      dongTuKhoa([
        {
          results: [
            {
              campaign: { id: '111', name: 'Search' },
              adGroup: { id: '22', name: 'Nail' },
              adGroupCriterion: { criterionId: '77', status: 'ENABLED', keyword: { text: 'làm nail', matchType: 'PHRASE' }, qualityInfo: { qualityScore: 7 } },
              metrics: { impressions: '1000', clicks: '50', costMicros: '250000000000', conversions: 5, averageCpc: '5000000000' },
            },
          ],
        },
      ]),
    ).toEqual([
      { id: '22~77', tuKhoa: 'làm nail', kieuKhop: 'PHRASE', bat: true, trangThai: 'ENABLED', campaignId: '111', chienDich: 'Search', nhom: 'Nail', diemCL: 7, hienThi: 1000, click: 50, chi: 250000, chuyenDoi: 5, cpc: 5000 },
    ]);
  });
  it('cụm từ khách gõ: gộp theo chiến dịch + cụm, đánh dấu tốn tiền mà không ra chuyển đổi', () => {
    const ds = dongCumTimKiem([
      {
        results: [
          { searchTermView: { searchTerm: 'nail giá rẻ', status: 'NONE' }, campaign: { id: '111', name: 'Search' }, metrics: { impressions: '100', clicks: '10', costMicros: '80000000000', conversions: 0 } },
          { searchTermView: { searchTerm: 'nail giá rẻ', status: 'NONE' }, campaign: { id: '111', name: 'Search' }, metrics: { impressions: '50', clicks: '5', costMicros: '20000000000', conversions: 0 } },
          { searchTermView: { searchTerm: 'tiệm nail quận 3', status: 'ADDED' }, campaign: { id: '111', name: 'Search' }, metrics: { impressions: '80', clicks: '8', costMicros: '40000000000', conversions: 2 } },
        ],
      },
    ]);
    expect(ds[0]).toEqual({ cum: 'nail giá rẻ', campaignId: '111', chienDich: 'Search', trangThai: 'NONE', hienThi: 150, click: 15, chi: 100000, chuyenDoi: 0, langPhi: true });
    expect(ds[1]).toMatchObject({ cum: 'tiệm nail quận 3', chuyenDoi: 2, langPhi: false });
  });
  it('gợi ý từ khoá: lượng tìm / tháng, cạnh tranh, giá thầu đầu trang', () => {
    expect(
      dongGoiYTuKhoa({
        results: [
          { text: 'tiệm nail gần đây', keywordIdeaMetrics: { avgMonthlySearches: '2900', competition: 'HIGH', lowTopOfPageBidMicros: '3000000000', highTopOfPageBidMicros: '12000000000' } },
          { text: 'nail art', keywordIdeaMetrics: {} },
        ],
      }),
    ).toEqual([
      { tuKhoa: 'tiệm nail gần đây', luongTim: 2900, canhTranh: 'HIGH', giaThapNhat: 3000, giaCaoNhat: 12000 },
      { tuKhoa: 'nail art', luongTim: 0, canhTranh: '', giaThapNhat: 0, giaCaoNhat: 0 },
    ]);
  });
});

describe('thêm từ khoá vào nhóm quảng cáo', () => {
  it('tạo ad group criterion với chữ + kiểu khớp', () => {
    expect(lenhGads({ cid: '1', cap: 'adgroup', id: '22', hanhDong: 'them_tu_khoa', tuKhoa: { chu: 'tiệm nail quận 3', kieuKhop: 'PHRASE' } })).toEqual({
      duongDan: 'customers/1/adGroupCriteria:mutate',
      body: { operations: [{ create: { adGroup: 'customers/1/adGroups/22', status: 'ENABLED', keyword: { text: 'tiệm nail quận 3', matchType: 'PHRASE' } } }] },
    });
    expect(kiemThaoTac({ hanhDong: 'them_tu_khoa', cap: 'campaign', tuKhoa: 'x' })).toMatch(/nhóm quảng cáo/);
    expect(kiemThaoTac({ hanhDong: 'them_tu_khoa', cap: 'adgroup', tuKhoa: 'tiệm nail' })).toBeNull();
  });
});

// Anh Tâm 11/11/2026: "click vào từng tài khoản sẽ ra thông tin chi tiết giống như ở trong tài khoản quảng cáo, lấy đc càng nhiều
// chỉ số về để tối ưu càng tốt".
describe('chỉ số chi tiết như Trình quản lý quảng cáo', () => {
  it('Google Ads: đủ chỉ số + tỷ lệ hiển thị, mất do ngân sách / xếp hạng', () => {
    const r = chiTietGads(
      [
        {
          results: [
            {
              campaign: { id: '111' },
              metrics: {
                impressions: '2000',
                clicks: '100',
                ctr: 0.05,
                averageCpc: '5000000000',
                costMicros: '500000000000',
                conversions: 10,
                conversionsValue: 2000000,
                searchImpressionShare: 0.42,
                searchBudgetLostImpressionShare: 0.3,
                searchRankLostImpressionShare: 0.28,
                searchTopImpressionShare: 0.6,
                searchAbsoluteTopImpressionShare: 0.2,
              },
            },
          ],
        },
      ],
      'campaign',
    );
    expect(r['111']).toEqual({
      hienThi: 2000,
      click: 100,
      ctr: 0.05,
      cpc: 5000,
      chi: 500000,
      chuyenDoi: 10,
      tyLeCD: 0.1,
      cpa: 50000,
      giaTriCD: 2000000,
      roas: 4,
      tyLeHienThi: 0.42,
      matNganSach: 0.3,
      matXepHang: 0.28,
      dauTrang: 0.6,
      dauTrangTuyetDoi: 0.2,
    });
  });
  it('Meta: tiếp cận, tần suất, CPM, click liên kết, tin nhắn, lead, mua, ROAS', () => {
    const r = chiTietMeta(
      {
        data: [
          {
            campaign_id: '9',
            spend: '1000000',
            impressions: '50000',
            reach: '20000',
            frequency: '2.5',
            clicks: '800',
            inline_link_clicks: '600',
            ctr: '1.6',
            cpc: '1250',
            cpm: '20000',
            actions: [
              { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '40' },
              { action_type: 'lead', value: '5' },
              { action_type: 'purchase', value: '2' },
            ],
            action_values: [{ action_type: 'purchase', value: '3000000' }],
          },
        ],
      },
      'campaign',
    );
    expect(r['9']).toEqual({
      chi: 1000000,
      hienThi: 50000,
      tiepCan: 20000,
      tanSuat: 2.5,
      click: 800,
      clickLink: 600,
      ctr: 0.016,
      cpc: 1250,
      cpm: 20000,
      tinNhan: 40,
      lead: 5,
      mua: 2,
      giaTriMua: 3000000,
      roas: 3,
      ketQua: 47,
      cpa: 1000000 / 47,
    });
  });
});
