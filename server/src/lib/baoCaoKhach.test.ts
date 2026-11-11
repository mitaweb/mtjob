import { describe, it, expect } from 'vitest';
import { kyBaoCao, nenTao, coCauGads, coCauMeta, tongHop } from './baoCaoKhach.js';

// Anh Tâm 11/11/2026: "agent để báo cáo hàng tuần cho khách hàng… chi phí sẽ tổng cả thuế vào… báo cáo hàng tuần, tháng cho
// các bên chạy ads, GG và FB". Kỳ tháng theo chu kỳ từng khách (mẫu anh gửi 11/10 → 09/11). Số GIẢ.

describe('kyBaoCao — kỳ vừa kết thúc', () => {
  it('tuần: thứ Hai → Chủ nhật tuần trước', () => {
    expect(kyBaoCao('tuan', '2026-11-11', 0)).toEqual({ tu: '2026-11-02', den: '2026-11-08' });
    expect(kyBaoCao('tuan', '2026-11-09', 0)).toEqual({ tu: '2026-11-02', den: '2026-11-08' });
  });
  it('tháng theo chu kỳ khách ngày 11: 11 tháng trước → 10 tháng này', () => {
    expect(kyBaoCao('thang', '2026-11-11', 11)).toEqual({ tu: '2026-10-11', den: '2026-11-10' });
    expect(kyBaoCao('thang', '2026-11-05', 11)).toEqual({ tu: '2026-09-11', den: '2026-10-10' });
  });
  it('chưa đặt chu kỳ → tháng dương lịch trước', () => {
    expect(kyBaoCao('thang', '2026-11-11', 0)).toEqual({ tu: '2026-10-01', den: '2026-10-31' });
    expect(kyBaoCao('thang', '2026-01-03', 0)).toEqual({ tu: '2025-12-01', den: '2025-12-31' });
  });
});

describe('nenTao — chỉ tạo khi kỳ vừa kết thúc (≤ 3 ngày), không tạo bù kỳ cũ', () => {
  it('', () => {
    expect(nenTao({ tu: '2026-11-02', den: '2026-11-08' }, '2026-11-09')).toBe(true);
    expect(nenTao({ tu: '2026-11-02', den: '2026-11-08' }, '2026-11-11')).toBe(true);
    expect(nenTao({ tu: '2026-11-02', den: '2026-11-08' }, '2026-11-12')).toBe(false);
  });
});

describe('coCauGads — chuyển đổi theo loại (tiếng Việt)', () => {
  it('gộp theo loại, bỏ loại 0', () => {
    const j = [
      {
        results: [
          { segments: { conversionActionCategory: 'GET_DIRECTIONS' }, metrics: { conversions: 50 } },
          { segments: { conversionActionCategory: 'GET_DIRECTIONS' }, metrics: { conversions: 30 } },
          { segments: { conversionActionCategory: 'PHONE_CALL_LEAD' }, metrics: { conversions: 4 } },
          { segments: { conversionActionCategory: 'PURCHASE' }, metrics: { conversions: 0 } },
          { segments: { conversionActionCategory: 'LẠ_QUÁ' }, metrics: { conversions: 1.5 } },
        ],
      },
    ];
    expect(coCauGads(j)).toEqual({ 'Chỉ đường': 80, 'Cuộc gọi': 4, Khác: 1.5 });
  });
});

describe('coCauMeta — kết quả Facebook theo loại', () => {
  it('mỗi nhóm lấy tên có số lớn nhất (Meta báo trùng nhiều tên)', () => {
    const actions = [
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '12' },
      { action_type: 'lead', value: '3' },
      { action_type: 'onsite_conversion.lead_grouped', value: '3' },
      { action_type: 'link_click', value: '99' },
    ];
    expect(coCauMeta(actions)).toEqual({ 'Tin nhắn': 12, 'Khách để lại thông tin': 3 });
  });
});

describe('tongHop — chi phí CỘNG THUẾ, tổng = cộng các dòng (khớp bảng)', () => {
  const tk = [
    { ten: 'Mịn Skinlab', thue: 10, hienThi: 8289, click: 96, chuyenDoi: 33, chi: 691653, coCau: { 'Chỉ đường': 31, 'Cuộc gọi': 2 } },
    { ten: 'Mịn Skinlab 2', thue: 10, hienThi: 6752, click: 112, chuyenDoi: 51, chi: 1109810, coCau: { 'Chỉ đường': 49, 'Cuộc gọi': 2 } },
  ];
  const r = tongHop(tk);
  it('từng tài khoản: chi sau thuế + chi phí / chuyển đổi', () => {
    expect(r.tk[0]).toMatchObject({ ten: 'Mịn Skinlab', chiSauThue: 760818, cpa: 23055 });
    expect(r.tk[1]).toMatchObject({ chiSauThue: 1220791, cpa: 23937 });
  });
  it('tổng (như mẫu: 15.041 · 208 · 84 · 1.981.609đ · 23.591đ)', () => {
    expect(r.tong).toEqual({ hienThi: 15041, click: 208, chuyenDoi: 84, chiSauThue: 1981609, cpa: 23591, ctr: 208 / 15041 });
  });
  it('cơ cấu chuyển đổi: lớn trước, có %', () => {
    expect(r.coCau).toEqual([
      { nhan: 'Chỉ đường', so: 80, tyLe: 80 / 84 },
      { nhan: 'Cuộc gọi', so: 4, tyLe: 4 / 84 },
    ]);
  });
  it('0 chuyển đổi → cpa 0, không chia cho 0', () => {
    expect(tongHop([{ ten: 'A', thue: 10, hienThi: 0, click: 0, chuyenDoi: 0, chi: 0, coCau: {} }]).tong.cpa).toBe(0);
  });
});
