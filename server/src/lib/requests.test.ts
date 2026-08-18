import { describe, it, expect } from 'vitest';
import { chanNopDon, hanNopDon, laDonGiaiTrinh, TEN_DON } from './requests.js';

// Anh Tâm 4/8/2026: "trong 24h phải làm đơn nếu không thì không làm được".
describe('chanNopDon', () => {
  it('nộp cho HÔM NAY thì được', () => {
    expect(chanNopDon('2026-08-12', '2026-08-12')).toBe('');
  });

  it('nộp cho HÔM QUA thì vẫn được — đây là phần "trong 24h"', () => {
    expect(chanNopDon('2026-08-11', '2026-08-12')).toBe('');
  });

  it('nộp cho HÔM KIA thì CHẶN, và nói rõ hạn là ngày nào', () => {
    const r = chanNopDon('2026-08-10', '2026-08-12');
    expect(r).toMatch(/Quá hạn/);
    expect(r).toContain('2026-08-11');
  });

  it('chặn cả những ngày xa hơn', () => {
    expect(chanNopDon('2026-07-01', '2026-08-12')).toMatch(/Quá hạn/);
  });

  it('nộp cho NGÀY MAI thì chặn — chưa xảy ra thì chưa có gì để giải trình', () => {
    expect(chanNopDon('2026-08-13', '2026-08-12')).toMatch(/Chưa tới ngày/);
  });

  it('vắt qua đầu tháng vẫn đúng', () => {
    expect(chanNopDon('2026-07-31', '2026-08-01')).toBe('');
    expect(chanNopDon('2026-07-31', '2026-08-02')).toMatch(/Quá hạn/);
  });

  it('ngày hỏng thì chặn, không ném lỗi', () => {
    expect(chanNopDon('linh tinh', '2026-08-12')).toBe('Ngày không hợp lệ.');
    expect(chanNopDon('', '2026-08-12')).toBe('Ngày không hợp lệ.');
  });
});

describe('hanNopDon', () => {
  it('là hết ngày hôm sau', () => {
    expect(hanNopDon('2026-08-12')).toBe('2026-08-13');
    expect(hanNopDon('2026-12-31')).toBe('2027-01-01');
  });
});

describe('laDonGiaiTrinh', () => {
  it('nhận đúng ba loại mới', () => {
    for (const k of ['forgot', 'late', 'early']) expect(laDonGiaiTrinh(k)).toBe(true);
  });

  it('KHÔNG nhận đơn nghỉ/online — hai loại đó không theo luật 24h', () => {
    expect(laDonGiaiTrinh('leave')).toBe(false);
    expect(laDonGiaiTrinh('online')).toBe(false);
  });

  it('có tên tiếng Việt cho cả ba', () => {
    expect(TEN_DON.forgot).toBe('Quên chấm công');
    expect(TEN_DON.late).toBe('Đi trễ');
    expect(TEN_DON.early).toBe('Về sớm');
  });
});
