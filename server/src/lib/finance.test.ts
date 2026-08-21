import { describe, it, expect } from 'vitest';
import { nextDueDateIso, daysUntil, debtMonths, computeDebt } from './finance.js';

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

// Anh Tâm 1/8/2026: "ở phần công nợ nếu tháng trước chưa thu thì em cộng dồn vào để theo dõi."
// Mốc theo dõi chốt là 2026-08 — trước đó coi như đã xử lý ngoài app.

describe('debtMonths', () => {
  it('liệt kê các kỳ từ mốc theo dõi tới tháng đang xem', () => {
    expect(debtMonths('', '2026-10')).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('KHÔNG lùi trước mốc dù bên đó bắt đầu từ lâu', () => {
    expect(debtMonths('2024-01', '2026-09')).toEqual(['2026-08', '2026-09']);
  });

  it('bên mới vào sau thì tính từ tháng của bên đó', () => {
    expect(debtMonths('2026-10', '2026-11')).toEqual(['2026-10', '2026-11']);
  });

  it('xem tháng trước mốc thì không có kỳ nào', () => {
    expect(debtMonths('', '2026-07')).toEqual([]);
  });

  it('vắt qua năm vẫn đúng', () => {
    expect(debtMonths('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('computeDebt', () => {
  const base = { receivable: 21_000_000, startMonth: '', month: '2026-10' };

  it('chưa thu hai tháng trước thì nợ cũ gấp đôi', () => {
    const r = computeDebt({ ...base, paid: {} });
    expect(r.carryOver).toBe(42_000_000); // 8 và 9
    expect(r.thisMonth).toBe(21_000_000);
    expect(r.total).toBe(63_000_000);
    expect(r.unpaidMonths).toEqual(['2026-08', '2026-09']);
  });

  it('thu đủ các tháng trước thì không còn nợ cũ', () => {
    const r = computeDebt({ ...base, paid: { '2026-08': 21_000_000, '2026-09': 21_000_000 } });
    expect(r.carryOver).toBe(0);
    expect(r.total).toBe(21_000_000);
  });

  it('THU MỘT PHẦN vẫn giữ lại phần còn thiếu', () => {
    const r = computeDebt({ ...base, paid: { '2026-08': 10_000_000, '2026-09': 21_000_000 } });
    expect(r.carryOver).toBe(11_000_000);
    expect(r.unpaidMonths).toEqual(['2026-08']);
  });

  it('đã thu kỳ đang xem thì trừ khỏi tổng', () => {
    const r = computeDebt({
      ...base,
      paid: { '2026-08': 21_000_000, '2026-09': 21_000_000, '2026-10': 21_000_000 },
    });
    expect(r.total).toBe(0);
  });

  it('thu dư (khách trả trước) không làm tổng âm', () => {
    const r = computeDebt({ ...base, month: '2026-08', paid: { '2026-08': 50_000_000 } });
    expect(r.total).toBe(0);
    expect(r.credit).toBe(29_000_000);
  });

  // Anh Tâm 21/8/2026: "khách trả trước 2-3 lần thì sao".
  describe('khách trả trước cho nhiều kỳ', () => {
    it('trả gọn 3 kỳ một lần thì hai kỳ sau không còn nợ', () => {
      const paid = { '2026-08': 63_000_000 }; // 3 × 21tr, đóng hết trong tháng 8
      expect(computeDebt({ ...base, month: '2026-08', paid }).total).toBe(0);
      expect(computeDebt({ ...base, month: '2026-09', paid }).total).toBe(0);
      expect(computeDebt({ ...base, month: '2026-10', paid }).total).toBe(0);
      // Sang kỳ thứ tư thì hết tiền trả trước, đòi lại bình thường.
      expect(computeDebt({ ...base, month: '2026-11', paid }).total).toBe(21_000_000);
    });

    it('trả trước làm 2-3 lần, cộng lại vẫn đủ thì kết quả y như trả một lần', () => {
      const nhieuLan = { '2026-08': 30_000_000, '2026-09': 33_000_000 }; // tổng 63tr
      const r = computeDebt({ ...base, month: '2026-10', paid: nhieuLan });
      expect(r.total).toBe(0);
      expect(r.carryOver).toBe(0);
      expect(r.unpaidMonths).toEqual([]);
    });

    it('trả trước chưa đủ một kỳ thì chỉ trừ phần đã trả', () => {
      // 50tr cho 21tr/kỳ: đủ tháng 8 và 9, còn 8tr gối sang tháng 10.
      const r = computeDebt({ ...base, month: '2026-10', paid: { '2026-08': 50_000_000 } });
      expect(r.carryOver).toBe(0);
      expect(r.total).toBe(13_000_000);
      expect(r.credit).toBe(0);
    });

    it('tiền vào trả NỢ CŨ trước rồi mới tới kỳ của chính nó', () => {
      // Tháng 8 bỏ trống, tháng 9 đóng bù 42tr → sạch cả hai kỳ.
      const r = computeDebt({ ...base, month: '2026-10', paid: { '2026-09': 42_000_000 } });
      expect(r.carryOver).toBe(0);
      expect(r.unpaidMonths).toEqual([]);
      expect(r.total).toBe(21_000_000); // chỉ còn kỳ tháng 10
    });

    it('trả dư không xoá nợ của kỳ mà khách vẫn thiếu', () => {
      // Tháng 8 đóng 10tr (thiếu 11tr), tháng 9 đóng đúng 21tr → nợ cũ giữ nguyên 11tr.
      const r = computeDebt({ ...base, paid: { '2026-08': 10_000_000, '2026-09': 21_000_000 } });
      expect(r.carryOver).toBe(11_000_000);
      expect(r.unpaidMonths).toEqual(['2026-08']);
    });
  });

  it('bên mới thêm giữa chừng không bị tính nợ các tháng chưa hợp tác', () => {
    const r = computeDebt({ ...base, startMonth: '2026-10', paid: {} });
    expect(r.carryOver).toBe(0);
    expect(r.total).toBe(21_000_000);
  });
});
