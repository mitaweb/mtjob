import { describe, it, expect } from 'vitest';
import { dayNgay, roiVaoNgay, laSinhNhat, thuVn, trungGio, dipSapToi } from './lich.js';
import type { ReminderRule } from './reminder.js';

const rule = (r: Partial<ReminderRule>): ReminderRule => ({
  atTime: '08:00',
  repeatKind: 'daily',
  ...r,
});

describe('dayNgay', () => {
  it('trả đúng số ngày, gồm cả ngày đầu', () => {
    expect(dayNgay('2026-08-18', 3)).toEqual(['2026-08-18', '2026-08-19', '2026-08-20']);
  });

  it('nhảy qua cuối tháng', () => {
    expect(dayNgay('2026-08-30', 3)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
  });

  it('ngày hỏng hoặc số âm thì trả mảng rỗng', () => {
    expect(dayNgay('bậy', 5)).toEqual([]);
    expect(dayNgay('2026-08-18', 0)).toEqual([]);
  });
});

describe('roiVaoNgay', () => {
  it('hằng ngày thì ngày nào cũng rơi', () => {
    expect(roiVaoNgay(rule({ repeatKind: 'daily' }), '2026-08-18')).toBe(true);
  });

  it('hằng tuần chỉ rơi đúng thứ', () => {
    // 18/8/2026 là thứ Ba → day() = 2.
    expect(roiVaoNgay(rule({ repeatKind: 'weekly', weekday: 2 }), '2026-08-18')).toBe(true);
    expect(roiVaoNgay(rule({ repeatKind: 'weekly', weekday: 3 }), '2026-08-18')).toBe(false);
  });

  it('hằng tháng rơi đúng ngày trong tháng', () => {
    expect(roiVaoNgay(rule({ repeatKind: 'monthly', dayOfMonth: 18 }), '2026-08-18')).toBe(true);
    expect(roiVaoNgay(rule({ repeatKind: 'monthly', dayOfMonth: 17 }), '2026-08-18')).toBe(false);
  });

  it('hẹn ngày 31 thì tháng 30 ngày dồn vào ngày cuối', () => {
    const r = rule({ repeatKind: 'monthly', dayOfMonth: 31 });
    expect(roiVaoNgay(r, '2026-09-30')).toBe(true);
    expect(roiVaoNgay(r, '2026-09-29')).toBe(false);
    // Tháng đủ 31 ngày thì vẫn là 31, không dồn.
    expect(roiVaoNgay(r, '2026-08-30')).toBe(false);
    expect(roiVaoNgay(r, '2026-08-31')).toBe(true);
  });

  it('hẹn một lần chỉ rơi đúng ngày đã chọn', () => {
    const r = rule({ repeatKind: 'once', onDate: '2026-08-21' });
    expect(roiVaoNgay(r, '2026-08-21')).toBe(true);
    expect(roiVaoNgay(r, '2026-08-20')).toBe(false);
  });

  it('không xét lastFired — đã bắn rồi vẫn hiện trên lịch', () => {
    const r = rule({ repeatKind: 'daily', lastFired: '2026-08-18' });
    expect(roiVaoNgay(r, '2026-08-18')).toBe(true);
  });

  it('ngày hỏng thì không rơi', () => {
    expect(roiVaoNgay(rule({ repeatKind: 'daily' }), '')).toBe(false);
  });
});

describe('laSinhNhat', () => {
  it('so ngày-tháng, bỏ qua năm sinh', () => {
    expect(laSinhNhat('1990-08-18', '2026-08-18')).toBe(true);
    expect(laSinhNhat('1990-08-19', '2026-08-18')).toBe(false);
  });

  it('nhận cả dạng MM-DD', () => {
    expect(laSinhNhat('08-18', '2026-08-18')).toBe(true);
  });

  it('rỗng hoặc rác thì không phải sinh nhật', () => {
    expect(laSinhNhat('', '2026-08-18')).toBe(false);
    expect(laSinhNhat('không rõ', '2026-08-18')).toBe(false);
  });
});

describe('dipSapToi', () => {
  it('hẹn một lần trả đúng ngày đã chọn', () => {
    const r = rule({ repeatKind: 'once', onDate: '2026-08-21', atTime: '14:00' });
    expect(dipSapToi(r, '2026-08-18')).toEqual([{ ngay: '2026-08-21', gio: '14:00' }]);
  });

  it('hẹn một lần chưa chọn ngày thì không có dịp nào', () => {
    expect(dipSapToi(rule({ repeatKind: 'once', onDate: '' }), '2026-08-18')).toEqual([]);
  });

  it('hằng ngày rơi ngay hôm nay', () => {
    expect(dipSapToi(rule({ repeatKind: 'daily', atTime: '08:00' }), '2026-08-18')).toEqual([
      { ngay: '2026-08-18', gio: '08:00' },
    ]);
  });

  it('hằng tuần trả lần gần nhất trong 7 ngày tới', () => {
    // 18/8/2026 là thứ Ba; hẹn thứ Sáu (5) → 21/8.
    expect(dipSapToi(rule({ repeatKind: 'weekly', weekday: 5, atTime: '15:00' }), '2026-08-18')).toEqual([
      { ngay: '2026-08-21', gio: '15:00' },
    ]);
  });

  it('hằng tháng trả lần gần nhất, kể cả khi phải sang tháng sau', () => {
    expect(dipSapToi(rule({ repeatKind: 'monthly', dayOfMonth: 5, atTime: '09:00' }), '2026-08-18')).toEqual([
      { ngay: '2026-09-05', gio: '09:00' },
    ]);
  });

  it('chỉ lấy MỘT lần, không trả cả tháng', () => {
    expect(dipSapToi(rule({ repeatKind: 'daily' }), '2026-08-18')).toHaveLength(1);
  });
});

describe('trungGio', () => {
  it('trùng khít thì đụng', () => {
    expect(trungGio('14:00', '14:00')).toBe(true);
  });

  it('cách dưới 30 phút vẫn coi là đụng, đủ 30 phút thì thôi', () => {
    expect(trungGio('14:00', '14:15')).toBe(true);
    expect(trungGio('14:15', '14:00')).toBe(true);
    expect(trungGio('14:00', '14:29')).toBe(true);
    expect(trungGio('14:00', '14:30')).toBe(false);
    expect(trungGio('14:00', '15:00')).toBe(false);
  });

  it('bắc qua đầu giờ vẫn tính đúng', () => {
    expect(trungGio('08:50', '09:10')).toBe(true);
    expect(trungGio('08:50', '09:20')).toBe(false);
  });

  it('giờ hỏng hoặc rỗng thì không đụng', () => {
    expect(trungGio('', '14:00')).toBe(false);
    expect(trungGio('25:00', '14:00')).toBe(false);
    expect(trungGio('14:70', '14:00')).toBe(false);
  });
});

describe('thuVn', () => {
  it('18/8/2026 là thứ Ba', () => {
    expect(thuVn('2026-08-18')).toBe('T3');
  });

  it('23/8/2026 là chủ nhật', () => {
    expect(thuVn('2026-08-23')).toBe('CN');
  });
});
