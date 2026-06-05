import { describe, it, expect } from 'vitest';
import { computeBonus, computeNetSalary, formatVnd } from './money.js';

describe('computeBonus', () => {
  it('is 0 at or below the 6000 threshold', () => {
    expect(computeBonus(0)).toBe(0);
    expect(computeBonus(5000)).toBe(0);
    expect(computeBonus(6000)).toBe(0);
    expect(computeBonus(6999)).toBe(0);
  });

  it('grants 800k per full 1000 above 6000', () => {
    expect(computeBonus(7000)).toBe(800_000);
    expect(computeBonus(7999)).toBe(800_000);
    expect(computeBonus(8000)).toBe(1_600_000);
    expect(computeBonus(12000)).toBe(4_800_000);
  });

  it('honours a custom config', () => {
    expect(computeBonus(5000, { threshold: 4000, step: 500, amount: 100_000 })).toBe(200_000);
  });
});

describe('computeNetSalary', () => {
  it('full month, no BHXH -> full gross', () => {
    const r = computeNetSalary({ grossSalary: 8_000_000, standardDays: 22, actualDays: 22, bhxh: 0 });
    expect(r.proratedSalary).toBe(8_000_000);
    expect(r.netSalary).toBe(8_000_000);
  });

  it('subtracts BHXH directly (default mode)', () => {
    const r = computeNetSalary({
      grossSalary: 8_000_000,
      standardDays: 22,
      actualDays: 22,
      bhxh: 5_400_000,
    });
    expect(r.bhxhDeduction).toBe(5_400_000);
    expect(r.netSalary).toBe(2_600_000);
  });

  it('prorates by actual days worked', () => {
    const r = computeNetSalary({ grossSalary: 8_000_000, standardDays: 22, actualDays: 11, bhxh: 0 });
    expect(r.proratedSalary).toBe(4_000_000);
  });

  it('percent mode deducts 10.5% of the BHXH base', () => {
    const r = computeNetSalary({
      grossSalary: 8_000_000,
      standardDays: 22,
      actualDays: 22,
      bhxh: 5_400_000,
      bhxhMode: 'percent',
    });
    expect(r.bhxhDeduction).toBe(567_000);
    expect(r.netSalary).toBe(7_433_000);
  });

  it('guards against zero standard days', () => {
    const r = computeNetSalary({ grossSalary: 8_000_000, standardDays: 0, actualDays: 0, bhxh: 0 });
    expect(r.proratedSalary).toBe(0);
    expect(r.netSalary).toBe(0);
  });
});

describe('formatVnd', () => {
  it('formats with Vietnamese grouping', () => {
    expect(formatVnd(1_600_000)).toBe('1.600.000đ');
    expect(formatVnd(0)).toBe('0đ');
  });
});
