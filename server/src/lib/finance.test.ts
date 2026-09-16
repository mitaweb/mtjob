import { describe, it, expect } from 'vitest';
import {
  nextDueDateIso,
  daysUntil,
  debtMonths,
  computeDebt,
  boSungNguon,
  mucTheoThang,
  doanhThuTheoNguon,
  CHUA_RO_NGUON,
} from './finance.js';

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

// Anh Tâm 16/9/2026: chọn nguồn cho bên xong mà bảng doanh thu vẫn "chưa rõ nguồn".
describe('boSungNguon', () => {
  const ben = new Map([['B1', 'BNI']]);
  const khach = new Map([['K1', 'Giới thiệu']]);

  it('khoản thu công nợ chưa có nguồn lấy nguồn hiện tại của bên', () => {
    const r = boSungNguon([{ source: '', partyId: 'B1', customerId: '' }], ben, khach);
    expect(r[0].source).toBe('BNI');
  });

  it('không có bên thì lấy theo khách CRM', () => {
    const r = boSungNguon([{ source: '', partyId: '', customerId: 'K1' }], ben, khach);
    expect(r[0].source).toBe('Giới thiệu');
  });

  it('khoản đã có nguồn riêng thì GIỮ NGUYÊN, không bị bên đè', () => {
    const r = boSungNguon([{ source: 'Facebook', partyId: 'B1', customerId: '' }], ben, khach);
    expect(r[0].source).toBe('Facebook');
  });

  it('bên chưa chọn nguồn thì khoản vẫn rỗng — hiện "chưa rõ nguồn" để nhắc', () => {
    const r = boSungNguon([{ source: '', partyId: 'B-khac', customerId: '' }], ben, khach);
    expect(r[0].source).toBe('');
  });

  it('không sửa mảng gốc', () => {
    const goc = [{ source: '', partyId: 'B1', customerId: '' }];
    boSungNguon(goc, ben, khach);
    expect(goc[0].source).toBe('');
  });
});

describe('doanhThuTheoNguon', () => {
  const e = (kind: string, amount: number, source?: string) => ({ kind, amount, source });

  it('gom theo nguồn, xếp tiền nhiều nhất lên đầu', () => {
    const r = doanhThuTheoNguon([
      e('thu', 10_000_000, 'BNI'),
      e('thu', 30_000_000, 'Giới thiệu'),
      e('thu', 10_000_000, 'BNI'),
    ]);
    expect(r.map((x) => x.nguon)).toEqual(['Giới thiệu', 'BNI']);
    expect(r[0]).toEqual({ nguon: 'Giới thiệu', tien: 30_000_000, soKhoan: 1, tyLe: 60 });
    expect(r[1]).toEqual({ nguon: 'BNI', tien: 20_000_000, soKhoan: 2, tyLe: 40 });
  });

  it('BỎ QUA khoản chi — chi không có nguồn khách', () => {
    const r = doanhThuTheoNguon([e('thu', 10_000_000, 'BNI'), e('chi', 90_000_000, 'BNI')]);
    expect(r).toEqual([{ nguon: 'BNI', tien: 10_000_000, soKhoan: 1, tyLe: 100 }]);
  });

  it('khoản chưa gắn nguồn vẫn hiện, gom vào "Chưa rõ nguồn"', () => {
    const r = doanhThuTheoNguon([e('thu', 10_000_000, 'BNI'), e('thu', 40_000_000), e('thu', 50_000_000, '  ')]);
    const chuaRo = r.find((x) => x.nguon === CHUA_RO_NGUON);
    expect(chuaRo).toEqual({ nguon: CHUA_RO_NGUON, tien: 90_000_000, soKhoan: 2, tyLe: 90 });
  });

  it('tổng các dòng luôn bằng tổng doanh thu — không được rơi mất khoản nào', () => {
    const list = [e('thu', 11_111_111, 'BNI'), e('thu', 22_222_222), e('thu', 3_333_333, 'Zalo')];
    const r = doanhThuTheoNguon(list);
    expect(r.reduce((s, x) => s + x.tien, 0)).toBe(36_666_666);
    expect(r.reduce((s, x) => s + x.soKhoan, 0)).toBe(3);
  });

  it('tháng chưa có khoản thu nào thì trả rỗng, không chia cho 0', () => {
    expect(doanhThuTheoNguon([])).toEqual([]);
    expect(doanhThuTheoNguon([e('chi', 5_000_000)])).toEqual([]);
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
    // FIFO: 21tr tháng 9 bù nốt 11tr tháng 8 trước, nên phần thiếu dồn về tháng 9.
    expect(r.unpaidMonths).toEqual(['2026-09']);
  });

  // Anh Tâm 16/9/2026: "khi anh thu ở tháng sau thì tự trừ, không phải quay lại tháng cũ".
  describe('thu ở tháng sau tự trừ nợ tháng trước', () => {
    const xemT9 = { ...base, month: '2026-09' };

    it('khách trả tiền tháng 8 vào tháng 9 → tháng 8 sạch, kỳ tháng 9 còn nguyên', () => {
      const r = computeDebt({ ...xemT9, paid: { '2026-09': 21_000_000 } });
      expect(r.carryOver).toBe(0);
      expect(r.unpaidMonths).toEqual([]);
      expect(r.paidToOld).toBe(21_000_000);
      expect(r.thisMonthRemaining).toBe(21_000_000);
      expect(r.total).toBe(21_000_000);
    });

    it('trả 42tr trong tháng 9 → sạch cả hai kỳ, không phải quay về tháng 8', () => {
      const r = computeDebt({ ...xemT9, paid: { '2026-09': 42_000_000 } });
      expect(r.total).toBe(0);
      expect(r.paidToOld).toBe(21_000_000);
      expect(r.thisMonthRemaining).toBe(0);
      expect(r.credit).toBe(0);
    });

    it('trả một phần trong tháng 9 → trừ nợ cũ trước, kỳ này chưa đụng', () => {
      const r = computeDebt({ ...xemT9, paid: { '2026-09': 10_000_000 } });
      expect(r.carryOver).toBe(11_000_000);
      expect(r.unpaidMonths).toEqual(['2026-08']);
      expect(r.paidToOld).toBe(10_000_000);
      expect(r.thisMonthRemaining).toBe(21_000_000);
      expect(r.total).toBe(32_000_000);
    });

    it('không có nợ cũ thì tiền tháng này trả kỳ này, paidToOld = 0', () => {
      const r = computeDebt({ ...xemT9, paid: { '2026-08': 21_000_000, '2026-09': 21_000_000 } });
      expect(r.paidToOld).toBe(0);
      expect(r.total).toBe(0);
    });
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

    it('thiếu bao nhiêu vẫn thiếu bấy nhiêu, chỉ dồn về kỳ mới nhất', () => {
      // Tháng 8 đóng 10tr (thiếu 11tr), tháng 9 đóng đúng 21tr → tổng thiếu vẫn 11tr;
      // FIFO đem 11tr của tháng 9 bù tháng 8, nên kỳ còn treo là tháng 9.
      const r = computeDebt({ ...base, paid: { '2026-08': 10_000_000, '2026-09': 21_000_000 } });
      expect(r.carryOver).toBe(11_000_000);
      expect(r.unpaidMonths).toEqual(['2026-09']);
    });
  });

  // Anh Tâm 16/9/2026: tăng từ 3tr lên 6tr "kể từ tháng này", tháng trước vẫn 3tr.
  describe('đổi mức phải thu từ một tháng', () => {
    const rates = [
      { fromMonth: '0000-00', receivable: 3_000_000 },
      { fromMonth: '2026-09', receivable: 6_000_000 },
    ];

    it('mucTheoThang: trước tháng đổi là mức cũ, từ tháng đổi là mức mới', () => {
      expect(mucTheoThang(rates, 6_000_000, '2026-08')).toBe(3_000_000);
      expect(mucTheoThang(rates, 6_000_000, '2026-09')).toBe(6_000_000);
      expect(mucTheoThang(rates, 6_000_000, '2026-12')).toBe(6_000_000);
    });

    it('mucTheoThang: không có lịch sử thì dùng mức hiện tại cho mọi tháng', () => {
      expect(mucTheoThang([], 3_000_000, '2026-01')).toBe(3_000_000);
    });

    it('tháng 8 chưa thu vẫn chỉ nợ 3tr dù mức hiện tại là 6tr', () => {
      const r = computeDebt({ receivable: 6_000_000, rates, startMonth: '', month: '2026-09', paid: {} });
      expect(r.carryOver).toBe(3_000_000);
      expect(r.thisMonth).toBe(6_000_000);
      expect(r.total).toBe(9_000_000);
    });

    it('đã thu 3tr tháng 8 thì tháng 8 sạch — không bị đòi thêm 3tr vì mức mới', () => {
      const r = computeDebt({
        receivable: 6_000_000,
        rates,
        startMonth: '',
        month: '2026-09',
        paid: { '2026-08': 3_000_000 },
      });
      expect(r.carryOver).toBe(0);
      expect(r.unpaidMonths).toEqual([]);
      expect(r.total).toBe(6_000_000);
    });

    it('đổi mức nhiều lần: mỗi tháng theo đúng mức của nó', () => {
      const nhieu = [
        { fromMonth: '0000-00', receivable: 3_000_000 },
        { fromMonth: '2026-09', receivable: 6_000_000 },
        { fromMonth: '2026-10', receivable: 4_000_000 },
      ];
      const r = computeDebt({ receivable: 4_000_000, rates: nhieu, startMonth: '', month: '2026-10', paid: {} });
      expect(r.carryOver).toBe(9_000_000); // 3 + 6
      expect(r.thisMonth).toBe(4_000_000);
    });
  });

  it('bên mới thêm giữa chừng không bị tính nợ các tháng chưa hợp tác', () => {
    const r = computeDebt({ ...base, startMonth: '2026-10', paid: {} });
    expect(r.carryOver).toBe(0);
    expect(r.total).toBe(21_000_000);
  });
});
