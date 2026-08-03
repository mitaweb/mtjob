import { describe, it, expect } from 'vitest';
import {
  isWeekend,
  isHoliday,
  isWorkday,
  standardWorkingDays,
  workdaysInMonth,
  missingWorkdays,
} from './workdays.js';

describe('isWeekend', () => {
  it('detects Sat/Sun (June 2026)', () => {
    expect(isWeekend('2026-06-04')).toBe(false); // Thursday
    expect(isWeekend('2026-06-06')).toBe(true); // Saturday
    expect(isWeekend('2026-06-07')).toBe(true); // Sunday
    expect(isWeekend('2026-06-08')).toBe(false); // Monday
  });
});

describe('isHoliday / isWorkday', () => {
  const holidays = new Set(['2026-06-15']);
  it('treats configured holidays as non-working', () => {
    expect(isHoliday('2026-06-15', holidays)).toBe(true);
    expect(isWorkday('2026-06-15', holidays)).toBe(false);
    expect(isWorkday('2026-06-16', holidays)).toBe(true);
  });
});

describe('standardWorkingDays', () => {
  it('counts Mon-Fri in June 2026 (22)', () => {
    expect(standardWorkingDays(2026, 6)).toBe(22);
  });
  it('subtracts holidays', () => {
    expect(standardWorkingDays(2026, 6, new Set(['2026-06-15', '2026-06-16']))).toBe(20);
  });
  it('ignores holidays that fall on a weekend', () => {
    expect(standardWorkingDays(2026, 6, new Set(['2026-06-06']))).toBe(22);
  });
});

describe('workdaysInMonth', () => {
  it('bỏ thứ Bảy và Chủ nhật', () => {
    const days = workdaysInMonth(2026, 8);
    expect(days).toContain('2026-08-03'); // T2
    expect(days).not.toContain('2026-08-01'); // T7
    expect(days).not.toContain('2026-08-02'); // CN
  });

  it('bỏ ngày lễ', () => {
    const days = workdaysInMonth(2026, 9, new Set(['2026-09-02']));
    expect(days).not.toContain('2026-09-02');
  });
});

describe('missingWorkdays', () => {
  const days = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'];

  it('chỉ ra ngày làm việc chưa có công', () => {
    const co = new Set(['2026-08-03', '2026-08-05']);
    expect(missingWorkdays(days, co, { today: '2026-08-06' })).toEqual(['2026-08-04', '2026-08-06']);
  });

  it('KHÔNG tính ngày chưa tới là thiếu', () => {
    expect(missingWorkdays(days, new Set(), { today: '2026-08-04' })).toEqual(['2026-08-03', '2026-08-04']);
  });

  it('KHÔNG tính những ngày trước khi vào làm', () => {
    const r = missingWorkdays(days, new Set(), { today: '2026-08-06', joinDate: '2026-08-05' });
    expect(r).toEqual(['2026-08-05', '2026-08-06']);
  });

  it('chấm đủ thì không còn ngày nào thiếu', () => {
    expect(missingWorkdays(days, new Set(days), { today: '2026-08-31' })).toEqual([]);
  });
});
