import { describe, it, expect } from 'vitest';
import { computeBonus, computeNetSalary, formatVnd, parseVndAmount } from './money.js';

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

  it('direct mode subtracts the BHXH amount as-is', () => {
    const r = computeNetSalary({
      grossSalary: 8_000_000,
      standardDays: 22,
      actualDays: 22,
      bhxh: 5_400_000,
      bhxhMode: 'direct',
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

  it('floors net salary at 0 when days worked are too few to cover BHXH', () => {
    const r = computeNetSalary({
      grossSalary: 8_000_000,
      standardDays: 22,
      actualDays: 0,
      bhxh: 5_400_000,
    });
    expect(r.netSalary).toBe(0); // không âm -5.4tr
  });
});

describe('formatVnd', () => {
  it('formats with Vietnamese grouping', () => {
    expect(formatVnd(1_600_000)).toBe('1.600.000đ');
    expect(formatVnd(0)).toBe('0đ');
  });
});

describe('parseVndAmount', () => {
  it('reads shorthand units the way people say them', () => {
    expect(parseVndAmount('20tr')).toBe(20_000_000);
    expect(parseVndAmount('20 triệu')).toBe(20_000_000);
    expect(parseVndAmount('500k')).toBe(500_000);
    expect(parseVndAmount('300 nghìn')).toBe(300_000);
    expect(parseVndAmount('1 tỷ')).toBe(1_000_000_000);
  });

  it('treats , and . as decimal point ONLY when a unit follows', () => {
    expect(parseVndAmount('1,5 triệu')).toBe(1_500_000);
    expect(parseVndAmount('1.5tr')).toBe(1_500_000);
    expect(parseVndAmount('20.000.000')).toBe(20_000_000); // không hậu tố = ngăn nghìn
    expect(parseVndAmount('1,500,000')).toBe(1_500_000);
  });

  it('ignores the currency word or symbol', () => {
    expect(parseVndAmount('20 triệu đồng')).toBe(20_000_000);
    expect(parseVndAmount('500.000đ')).toBe(500_000);
    expect(parseVndAmount('500000 VNĐ')).toBe(500_000);
  });

  it('passes numbers through', () => {
    expect(parseVndAmount(20_000_000)).toBe(20_000_000);
    expect(parseVndAmount(0)).toBe(0);
  });

  it('returns NaN rather than guessing', () => {
    expect(parseVndAmount('')).toBeNaN();
    expect(parseVndAmount(null)).toBeNaN();
    expect(parseVndAmount('nhiều lắm')).toBeNaN();
    expect(parseVndAmount('20 xu')).toBeNaN(); // hậu tố lạ
  });
});
