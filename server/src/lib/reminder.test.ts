import { describe, it, expect } from 'vitest';
import { hhmmToMinutes, isDue, isExpiredOnce, describeRule, type ReminderRule } from './reminder.js';

/** Thứ 2, 20/07/2026, 08:05 giờ máy. */
const mon0805 = new Date(2026, 6, 20, 8, 5);
const TODAY = '2026-07-20';

describe('hhmmToMinutes', () => {
  it('đọc đúng giờ hợp lệ', () => {
    expect(hhmmToMinutes('08:00')).toBe(480);
    expect(hhmmToMinutes('8:30')).toBe(510);
    expect(hhmmToMinutes('00:00')).toBe(0);
    expect(hhmmToMinutes('23:59')).toBe(1439);
  });
  it('trả NaN với chuỗi hỏng', () => {
    expect(Number.isNaN(hhmmToMinutes('25:00'))).toBe(true);
    expect(Number.isNaN(hhmmToMinutes('08:70'))).toBe(true);
    expect(Number.isNaN(hhmmToMinutes('abc'))).toBe(true);
    expect(Number.isNaN(hhmmToMinutes(''))).toBe(true);
  });
});

describe('isDue — hằng ngày', () => {
  const daily = (over: Partial<ReminderRule> = {}): ReminderRule => ({
    atTime: '08:00',
    repeatKind: 'daily',
    ...over,
  });

  it('tới giờ thì bắn', () => {
    expect(isDue(daily(), mon0805, TODAY)).toBe(true);
  });
  it('chưa tới giờ thì thôi', () => {
    expect(isDue(daily({ atTime: '09:00' }), mon0805, TODAY)).toBe(false);
  });
  it('đã bắn hôm nay thì không bắn lại', () => {
    expect(isDue(daily({ lastFired: TODAY }), mon0805, TODAY)).toBe(false);
  });
  it('lỡ giờ trong hạn châm chước vẫn bắn', () => {
    // hẹn 6:00, giờ đã 8:05 → trễ 125 phút, còn trong hạn 180 phút
    expect(isDue(daily({ atTime: '06:00' }), mon0805, TODAY)).toBe(true);
  });
  it('lỡ giờ quá lâu thì bỏ qua, không bắn muộn', () => {
    // hẹn 0:00, giờ đã 8:05 → trễ 485 phút
    expect(isDue(daily({ atTime: '00:00' }), mon0805, TODAY)).toBe(false);
  });
});

describe('isDue — hằng tuần', () => {
  it('đúng thứ thì bắn', () => {
    expect(isDue({ atTime: '08:00', repeatKind: 'weekly', weekday: 1 }, mon0805, TODAY)).toBe(true);
  });
  it('sai thứ thì thôi', () => {
    expect(isDue({ atTime: '08:00', repeatKind: 'weekly', weekday: 3 }, mon0805, TODAY)).toBe(false);
  });
});

describe('isDue — hằng tháng', () => {
  it('đúng ngày thì bắn', () => {
    expect(isDue({ atTime: '08:00', repeatKind: 'monthly', dayOfMonth: 20 }, mon0805, TODAY)).toBe(true);
  });
  it('sai ngày thì thôi', () => {
    expect(isDue({ atTime: '08:00', repeatKind: 'monthly', dayOfMonth: 15 }, mon0805, TODAY)).toBe(false);
  });
  it('chọn ngày 31 mà tháng chỉ có 30 thì bắn ngày cuối tháng', () => {
    const jun30 = new Date(2026, 5, 30, 8, 5); // 30/06/2026
    expect(isDue({ atTime: '08:00', repeatKind: 'monthly', dayOfMonth: 31 }, jun30, '2026-06-30')).toBe(true);
  });
});

describe('isDue — một lần', () => {
  it('đúng ngày hẹn thì bắn', () => {
    expect(isDue({ atTime: '08:00', repeatKind: 'once', onDate: TODAY }, mon0805, TODAY)).toBe(true);
  });
  it('khác ngày hẹn thì thôi', () => {
    expect(isDue({ atTime: '08:00', repeatKind: 'once', onDate: '2026-07-25' }, mon0805, TODAY)).toBe(false);
  });
});

describe('isExpiredOnce', () => {
  it('nhắc 1 lần đã qua ngày → hết hạn', () => {
    expect(isExpiredOnce({ atTime: '08:00', repeatKind: 'once', onDate: '2026-07-01' }, TODAY)).toBe(true);
  });
  it('nhắc lặp không bao giờ hết hạn', () => {
    expect(isExpiredOnce({ atTime: '08:00', repeatKind: 'daily' }, TODAY)).toBe(false);
  });
});

describe('describeRule', () => {
  it('mô tả tiếng Việt dễ đọc', () => {
    expect(describeRule({ atTime: '08:00', repeatKind: 'daily' })).toBe('hằng ngày lúc 08:00');
    expect(describeRule({ atTime: '09:30', repeatKind: 'weekly', weekday: 2 })).toBe('hằng tuần vào Thứ 3 lúc 09:30');
    expect(describeRule({ atTime: '08:00', repeatKind: 'monthly', dayOfMonth: 5 })).toBe('hằng tháng vào ngày 5 lúc 08:00');
  });
});
