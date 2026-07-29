import { describe, it, expect } from 'vitest';
import { validateAdjust, adjustIsoAt, adjustTaskName, adjustNote, MAX_ADJUST_POINTS } from './adjust.js';

const ok = { date: '2026-07-01', points: 300, reason: 'nhập bổ sung' };

describe('validateAdjust', () => {
  it('cho qua dữ liệu hợp lệ', () => {
    expect(validateAdjust(ok, '2026-07-29')).toBe('');
  });

  it('bù được cho chính hôm nay', () => {
    expect(validateAdjust({ ...ok, date: '2026-07-29' }, '2026-07-29')).toBe('');
  });

  it('chặn ngày chưa tới', () => {
    expect(validateAdjust({ ...ok, date: '2026-07-30' }, '2026-07-29')).toMatch(/chưa tới/);
  });

  it('chặn ngày sai định dạng', () => {
    expect(validateAdjust({ ...ok, date: '01/07/2026' }, '2026-07-29')).toMatch(/Chọn ngày/);
    expect(validateAdjust({ ...ok, date: '' }, '2026-07-29')).toMatch(/Chọn ngày/);
  });

  it('chặn ngày không có thật', () => {
    expect(validateAdjust({ ...ok, date: '2026-02-30' }, '2026-07-29')).toMatch(/không có thật/);
  });

  it('cho phép ngày 29/2 của năm nhuận', () => {
    expect(validateAdjust({ ...ok, date: '2028-02-29' }, '2028-07-29')).toBe('');
  });

  it('chặn điểm 0 và điểm lẻ', () => {
    expect(validateAdjust({ ...ok, points: 0 }, '2026-07-29')).toMatch(/khác 0/);
    expect(validateAdjust({ ...ok, points: 12.5 }, '2026-07-29')).toMatch(/số nguyên/);
  });

  it('cho phép trừ điểm khi ghi dư', () => {
    expect(validateAdjust({ ...ok, points: -300 }, '2026-07-29')).toBe('');
  });

  it('chặn số quá lớn ở cả hai chiều — gõ nhầm 30000 là lệch cả bảng xếp hạng', () => {
    expect(validateAdjust({ ...ok, points: MAX_ADJUST_POINTS + 1 }, '2026-07-29')).toMatch(/tối đa/);
    expect(validateAdjust({ ...ok, points: -(MAX_ADJUST_POINTS + 1) }, '2026-07-29')).toMatch(/tối đa/);
    expect(validateAdjust({ ...ok, points: MAX_ADJUST_POINTS }, '2026-07-29')).toBe('');
  });

  it('bắt buộc có lý do', () => {
    expect(validateAdjust({ ...ok, reason: '' }, '2026-07-29')).toMatch(/lý do/);
    expect(validateAdjust({ ...ok, reason: '  x  ' }, '2026-07-29')).toMatch(/lý do/);
  });
});

describe('adjustIsoAt', () => {
  it('rơi đúng ngày đã chọn sau khi đổi sang UTC', () => {
    // Bảng điểm gom ngày bằng slice(0,10) trên chuỗi UTC. Giữa trưa VN lệch về 05:00Z
    // nên vẫn cùng ngày; mốc 0h hoặc 23h sẽ nhảy sang ngày bên cạnh.
    expect(adjustIsoAt('2026-07-01').slice(0, 10)).toBe('2026-07-01');
  });

  it('giữ đúng ngày cả ở đầu và cuối tháng', () => {
    expect(adjustIsoAt('2026-07-31').slice(0, 10)).toBe('2026-07-31');
    expect(adjustIsoAt('2026-08-01').slice(0, 10)).toBe('2026-08-01');
  });

  it('giữ đúng ngày ở giao thừa', () => {
    expect(adjustIsoAt('2026-12-31').slice(0, 10)).toBe('2026-12-31');
    expect(adjustIsoAt('2027-01-01').slice(0, 10)).toBe('2027-01-01');
  });
});

describe('nhãn và ghi chú', () => {
  it('gọi tên theo dấu của số điểm', () => {
    expect(adjustTaskName(300)).toBe('Bổ sung điểm');
    expect(adjustTaskName(-300)).toBe('Trừ điểm');
  });

  it('ghi chú kèm tên người nhập để sau này truy được', () => {
    expect(adjustNote('nhập bổ sung', 'Minh Tâm')).toBe('nhập bổ sung — Minh Tâm nhập bù');
  });

  it('không có tên vẫn ra câu đọc được', () => {
    expect(adjustNote('nhập bổ sung', '')).toBe('nhập bổ sung — nhập bù');
  });
});
