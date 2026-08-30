import { describe, it, expect } from 'vitest';
import {
  computeBonus,
  computeNetSalary,
  formatVnd,
  parseVndAmount,
  thuongLeader,
  thuongThanhVien,
  nhanThuongDiem,
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

// ── Thưởng KPI dự án (anh Tâm 21/8/2026) ──

describe('thuongLeader', () => {
  const MUC = 10_000_000;

  it('tỉ lệ thuận với mức đạt', () => {
    expect(thuongLeader(MUC, 100)).toBe(10_000_000);
    expect(thuongLeader(MUC, 50)).toBe(5_000_000);
    expect(thuongLeader(MUC, 80)).toBe(8_000_000);
  });

  it('TRẦN 100% — vượt KPI không thưởng thêm', () => {
    expect(thuongLeader(MUC, 120)).toBe(10_000_000);
    expect(thuongLeader(MUC, 300)).toBe(10_000_000);
  });

  it('không đạt thì không thưởng, cũng không âm', () => {
    expect(thuongLeader(MUC, 0)).toBe(0);
    expect(thuongLeader(MUC, -50)).toBe(0);
  });

  it('tháng không đo được thì không thưởng', () => {
    expect(thuongLeader(MUC, null)).toBe(0);
  });

  it('chưa đặt mức thưởng thì không ai có gì', () => {
    expect(thuongLeader(0, 100)).toBe(0);
  });
});

describe('thuongThanhVien', () => {
  const MUC = 10_000_000;

  it('dưới 80% thì không có thưởng thêm', () => {
    expect(thuongThanhVien(MUC, 0)).toBe(0);
    expect(thuongThanhVien(MUC, 79)).toBe(0);
  });

  it('80–99% được một nửa mức', () => {
    expect(thuongThanhVien(MUC, 80)).toBe(5_000_000);
    expect(thuongThanhVien(MUC, 99)).toBe(5_000_000);
  });

  it('từ 100% được trọn mức, vượt cũng chỉ tới đó', () => {
    expect(thuongThanhVien(MUC, 100)).toBe(10_000_000);
    expect(thuongThanhVien(MUC, 130)).toBe(10_000_000);
  });

  it('tháng không đo được thì không thưởng', () => {
    expect(thuongThanhVien(MUC, null)).toBe(0);
  });
});

describe('nhanThuongDiem', () => {
  const THUONG = 800_000;

  it('mọi dự án đạt trên 50% thì giữ nguyên', () => {
    expect(nhanThuongDiem(THUONG, [60, 70, 100])).toBe(800_000);
    expect(nhanThuongDiem(THUONG, [50])).toBe(800_000);
  });

  it('CHỈ CẦN MỘT dự án dưới 50% là còn một nửa', () => {
    expect(nhanThuongDiem(THUONG, [40, 60])).toBe(400_000);
    expect(nhanThuongDiem(THUONG, [49])).toBe(400_000);
    expect(nhanThuongDiem(THUONG, [100, 100, 10])).toBe(400_000);
  });

  it('dự án không đo được thì bỏ qua, không kéo ai xuống', () => {
    expect(nhanThuongDiem(THUONG, [null, 60])).toBe(800_000);
    expect(nhanThuongDiem(THUONG, [null, null])).toBe(800_000);
    expect(nhanThuongDiem(THUONG, [])).toBe(800_000);
  });

  it('không có thưởng điểm thì không đẻ ra tiền', () => {
    expect(nhanThuongDiem(0, [10])).toBe(0);
  });
});
