import { describe, it, expect } from 'vitest';
import {
  computeBonus,
  computeNetSalary,
  formatVnd,
  parseVndAmount,
  tyLeDat,
  thuongLeaderThang,
  duAnDat,
  heSoDiemThanhVien,
} from './money.js';

describe('computeBonus', () => {
  it('chưa vượt mốc 6000 thì không có thưởng', () => {
    expect(computeBonus(0)).toBe(0);
    expect(computeBonus(5000)).toBe(0);
    expect(computeBonus(6000)).toBe(0);
  });

  it('vượt mốc là có tiền ngay, ăn theo tỷ lệ điểm dư', () => {
    // Anh Tâm chốt 25/7/2026 — trước đây 6999đ vẫn trắng tay vì chưa đủ trọn 1000 dư.
    expect(computeBonus(6001)).toBe(800);
    expect(computeBonus(6320)).toBe(256_000);
    expect(computeBonus(6500)).toBe(400_000);
    expect(computeBonus(6999)).toBe(799_200);
  });

  it('mốc tròn vẫn ra đúng số cũ', () => {
    expect(computeBonus(7000)).toBe(800_000);
    expect(computeBonus(8000)).toBe(1_600_000);
    expect(computeBonus(12000)).toBe(4_800_000);
  });

  it('honours a custom config', () => {
    expect(computeBonus(5000, { threshold: 4000, step: 500, amount: 100_000 })).toBe(200_000);
    expect(computeBonus(4250, { threshold: 4000, step: 500, amount: 100_000 })).toBe(50_000);
  });

  it('cấu hình hỏng (step = 0) thì trả 0, không chia cho 0', () => {
    expect(computeBonus(9000, { threshold: 6000, step: 0, amount: 800_000 })).toBe(0);
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

// ── Thưởng KPI (anh Tâm 21/9/2026) ──

/** n chỉ số, `dat` cái đầu đạt 100%, còn lại 60%. */
const chiSo = (dat: number, tong: number) => Array.from({ length: tong }, (_, i) => (i < dat ? 100 : 60));

describe('tyLeDat', () => {
  it('đếm chỉ số chạm 100%', () => {
    expect(tyLeDat([100, 120, 60, 0])).toEqual({ dat: 2, tong: 4, tyLe: 50 });
  });

  it('99,9% là CHƯA đạt — không làm tròn giúp', () => {
    expect(tyLeDat([99.9]).dat).toBe(0);
    expect(tyLeDat([100]).dat).toBe(1);
  });

  it('chỉ số không đo được bị loại khỏi cả tử lẫn mẫu', () => {
    expect(tyLeDat([100, null, null])).toEqual({ dat: 1, tong: 1, tyLe: 100 });
    expect(tyLeDat([null, NaN])).toEqual({ dat: 0, tong: 0, tyLe: null });
    expect(tyLeDat([])).toEqual({ dat: 0, tong: 0, tyLe: null });
  });
});

describe('thuongLeaderThang', () => {
  const MUC = 3_000_000;

  it('từ 80% chỉ số đạt thì trọn mức, dưới thì 0 — không có nấc giữa', () => {
    expect(thuongLeaderThang(chiSo(8, 10), MUC)).toBe(3_000_000);
    expect(thuongLeaderThang(chiSo(10, 10), MUC)).toBe(3_000_000);
    expect(thuongLeaderThang(chiSo(7, 10), MUC)).toBe(0);
    expect(thuongLeaderThang(chiSo(0, 10), MUC)).toBe(0);
  });

  it('vượt KPI không thưởng thêm — 300% cũng chỉ là "đạt"', () => {
    expect(thuongLeaderThang([300, 150, 100, 100, 50], MUC)).toBe(3_000_000);
  });

  it('không đo được chỉ số nào thì không thưởng', () => {
    expect(thuongLeaderThang([], MUC)).toBe(0);
    expect(thuongLeaderThang([null, null], MUC)).toBe(0);
  });

  it('chỉ số không đo được không kéo leader xuống', () => {
    expect(thuongLeaderThang([100, 100, 100, 100, null, null, null], MUC)).toBe(3_000_000);
  });

  it('mức theo team: chưa đặt thì 0, số âm cũng 0', () => {
    expect(thuongLeaderThang(chiSo(10, 10), 2_000_000)).toBe(2_000_000);
    expect(thuongLeaderThang(chiSo(10, 10), 0)).toBe(0);
    expect(thuongLeaderThang(chiSo(10, 10), -5)).toBe(0);
  });

  it('ngưỡng chỉnh được; ngưỡng hỏng thì về 80', () => {
    expect(thuongLeaderThang(chiSo(7, 10), MUC, 70)).toBe(3_000_000);
    expect(thuongLeaderThang(chiSo(9, 10), MUC, 100)).toBe(0);
    expect(thuongLeaderThang(chiSo(7, 10), MUC, 0)).toBe(0);
    expect(thuongLeaderThang(chiSo(8, 10), MUC, NaN)).toBe(3_000_000);
  });
});

describe('duAnDat', () => {
  it('≥ 80% chỉ số của phòng mình đạt thì dự án đạt', () => {
    expect(duAnDat(chiSo(4, 5))).toBe(true);
    expect(duAnDat(chiSo(3, 5))).toBe(false);
    expect(duAnDat([100])).toBe(true);
    expect(duAnDat([99])).toBe(false);
  });

  it('không đo được → null, khác với trượt', () => {
    expect(duAnDat([])).toBeNull();
    expect(duAnDat([null])).toBeNull();
  });
});

describe('heSoDiemThanhVien', () => {
  const duAn = (dat: number, tong: number) => Array.from({ length: tong }, (_, i) => i < dat);

  it('≥ 80% số dự án đạt thì đủ thưởng điểm', () => {
    expect(heSoDiemThanhVien(duAn(4, 5))).toBe(1);
    expect(heSoDiemThanhVien(duAn(5, 5))).toBe(1);
    expect(heSoDiemThanhVien([true])).toBe(1);
  });

  it('dưới 80% thì còn một nửa', () => {
    expect(heSoDiemThanhVien(duAn(3, 5))).toBe(0.5);
    expect(heSoDiemThanhVien([true, false])).toBe(0.5);
    expect(heSoDiemThanhVien([false])).toBe(0.5);
  });

  it('dự án không đo được bị bỏ qua; không còn dự án nào thì giữ nguyên', () => {
    expect(heSoDiemThanhVien([true, null, null])).toBe(1);
    expect(heSoDiemThanhVien([null, null])).toBe(1);
    expect(heSoDiemThanhVien([])).toBe(1);
  });

  it('ngưỡng chỉnh được', () => {
    expect(heSoDiemThanhVien(duAn(3, 5), 60)).toBe(1);
  });
});
