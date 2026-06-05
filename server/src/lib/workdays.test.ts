import { describe, it, expect } from 'vitest';
import { isWeekend, isHoliday, isWorkday, standardWorkingDays } from './workdays.js';

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
