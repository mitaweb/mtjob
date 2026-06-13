import { describe, it, expect } from 'vitest';
import { nextDueDateIso, daysUntil } from './finance.js';

describe('nextDueDateIso', () => {
  it('lấy ngày thu trong tháng nếu chưa qua', () => {
    expect(nextDueDateIso(20, '2026-06-12')).toBe('2026-06-20');
    expect(nextDueDateIso(12, '2026-06-12')).toBe('2026-06-12'); // đúng hôm nay
  });
  it('nhảy sang tháng sau nếu đã qua', () => {
    expect(nextDueDateIso(10, '2026-06-12')).toBe('2026-07-10');
  });
  it('clamp ngày 31 về cuối tháng (tháng 2)', () => {
    expect(nextDueDateIso(31, '2026-02-01')).toBe('2026-02-28');
  });
});

describe('daysUntil', () => {
  it('đếm số ngày còn lại', () => {
    expect(daysUntil('2026-06-20', '2026-06-15')).toBe(5);
    expect(daysUntil('2026-06-15', '2026-06-15')).toBe(0);
    expect(daysUntil('2026-06-10', '2026-06-15')).toBe(-5);
  });
});
