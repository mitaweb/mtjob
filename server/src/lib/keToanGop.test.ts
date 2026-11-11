import { describe, it, expect } from 'vitest';
import { gopChiSo, tinhThangDaLay } from './keToanGop.js';

// Anh Tâm 11/11/2026: "Phần kế toán thuế anh cần thông minh hơn, đọc và hiểu các báo cáo, ưu tiên báo cáo sau ghi đè báo cáo
// cũ, các chỉ số có ngày cập nhật mới hơn phải được giữ lại, đánh giá giữ lại hay k, k hiểu thì hỏi". Số GIẢ.

describe('gopChiSo — chỉ số nào giữ, chỉ số nào ghi đè', () => {
  const cu = { giaTri: { '01': 1000, '50': 200, cpktd: 30 }, ngay: { '01': '2026-09-05', '50': '2026-09-05', cpktd: '2026-08-10' } };

  it('báo cáo MỚI HƠN ghi đè; chỉ số mới thêm vào; chỉ số báo cáo mới không có thì giữ', () => {
    const r = gopChiSo(cu, { giaTri: { '01': 1100, '50': 200, lntt: 230 }, ngay: '2026-10-01' });
    expect(r.giaTri).toEqual({ '01': 1100, '50': 200, cpktd: 30, lntt: 230 });
    expect(r.ngay).toEqual({ '01': '2026-10-01', '50': '2026-10-01', cpktd: '2026-08-10', lntt: '2026-10-01' });
    expect(r.ghiDe).toEqual([{ khoa: '01', cu: 1000, moi: 1100, ngayCu: '2026-09-05', ngayMoi: '2026-10-01' }]);
    expect(r.giuCu).toEqual([]);
    expect(r.canXet).toEqual([]);
  });

  it('báo cáo CŨ HƠN không đè số mới — chỉ báo lại', () => {
    const r = gopChiSo(cu, { giaTri: { '01': 900, cpktd: 35 }, ngay: '2026-08-31' });
    expect(r.giaTri['01']).toBe(1000);
    expect(r.giuCu).toEqual([{ khoa: '01', cu: 1000, moi: 900, ngayCu: '2026-09-05', ngayMoi: '2026-08-31' }]);
    // cpktd của báo cáo cũ (10/8) cũ hơn báo cáo này (31/8) → ghi đè
    expect(r.giaTri.cpktd).toBe(35);
  });

  it('cùng ngày hoặc không rõ ngày mà số KHÁC → cần xét (AI / hỏi anh), tạm giữ số cũ', () => {
    const r1 = gopChiSo(cu, { giaTri: { '50': 250 }, ngay: '2026-09-05' });
    expect(r1.giaTri['50']).toBe(200);
    expect(r1.canXet).toEqual([{ khoa: '50', cu: 200, moi: 250, ngayCu: '2026-09-05', ngayMoi: '2026-09-05' }]);
    const r2 = gopChiSo(cu, { giaTri: { '50': 250 }, ngay: '' });
    expect(r2.canXet.length).toBe(1);
  });

  it('số GIỐNG nhau → không có gì phải xét, ngày lấy cái mới hơn', () => {
    const r = gopChiSo(cu, { giaTri: { '50': 200 }, ngay: '' });
    expect(r.canXet).toEqual([]);
    expect(r.ngay['50']).toBe('2026-09-05');
  });

  it('chưa có gì → nhận hết', () => {
    const r = gopChiSo(null, { giaTri: { '01': 5 }, ngay: '' });
    expect(r.giaTri).toEqual({ '01': 5 });
    expect(r.canXet).toEqual([]);
  });
});

// Anh Tâm 11/11/2026: "tháng nào mà đã cập nhật từ cổng thuế có trên hệ thống rồi thì note lại, đã cập nhật từ tháng... để
// cập nhật tiếp mà k phải lấy nhiều".
describe('tinhThangDaLay — tháng nào đã lấy đủ từ cổng thuế', () => {
  it('đủ = lấy sau khi tháng kết thúc ≥ 5 ngày; tháng đang chạy / lấy sớm thì cần lấy lại; gợi ý tháng tiếp', () => {
    const r = tinhThangDaLay(
      {
        '2026-08': '2026-09-20T10:00:00.000Z',
        '2026-09': '2026-10-06T10:00:00.000Z',
        '2026-10': '2026-10-28T10:00:00.000Z', // lấy khi tháng 10 chưa hết → cần lấy lại
      },
      '2026-11-11',
    );
    expect(r.duTu).toBe('2026-08');
    expect(r.duDen).toBe('2026-09');
    expect(r.canLayLai).toEqual(['2026-10']);
    expect(r.goiY).toBe('2026-10');
  });
  it('chưa lấy tháng nào → gợi ý tháng trước', () => {
    expect(tinhThangDaLay({}, '2026-11-11')).toEqual({ duTu: '', duDen: '', canLayLai: [], goiY: '2026-10' });
  });
  it('đủ hết tới tháng trước → gợi ý tháng hiện tại', () => {
    const r = tinhThangDaLay({ '2026-10': '2026-11-06T00:00:00.000Z' }, '2026-11-11');
    expect(r.duDen).toBe('2026-10');
    expect(r.goiY).toBe('2026-11');
  });
  it('tháng bị bỏ trống ở giữa → gợi ý tháng trống', () => {
    const r = tinhThangDaLay({ '2026-07': '2026-08-20T00:00:00.000Z', '2026-09': '2026-10-20T00:00:00.000Z' }, '2026-11-11');
    expect(r.goiY).toBe('2026-08');
  });
});
