import { describe, it, expect } from 'vitest';
import { overlappingIds } from './worktime.js';

describe('overlappingIds', () => {
  const t = (id: string, from: string, to: string) => ({
    id,
    startedAt: `2026-07-15T${from}:00.000Z`,
    completedAt: `2026-07-15T${to}:00.000Z`,
  });

  it('việc làm nối tiếp nhau thì không chồng', () => {
    expect(overlappingIds([t('A', '06:36', '08:55'), t('B', '08:55', '09:37')])).toEqual([]);
  });

  it('bắt cả cụm mở hàng loạt rồi đóng hàng loạt — ca thật ngày 15/07', () => {
    const ids = overlappingIds([
      t('A', '01:35', '03:32'),
      t('B', '01:35', '03:32'),
      t('C', '01:35', '03:31'),
    ]).sort();
    expect(ids).toEqual(['A', 'B', 'C']);
  });

  it('việc lồng hoàn toàn trong việc khác cũng bị bắt', () => {
    expect(overlappingIds([t('A', '08:00', '12:00'), t('B', '09:00', '10:00')]).sort()).toEqual(['A', 'B']);
  });

  it('bỏ qua việc thiếu giờ — không đủ dữ liệu để kết luận', () => {
    expect(overlappingIds([{ id: 'A' }, { id: 'B', completedAt: '2026-07-15T09:00:00.000Z' }])).toEqual([]);
    // Việc có giờ nằm cạnh việc thiếu giờ vẫn không bị gắn cờ oan.
    expect(overlappingIds([t('A', '08:00', '09:00'), { id: 'B' }])).toEqual([]);
  });
});
import { unionMinutes, taskIntervalsForDay, formatMinutes } from './worktime.js';

const T = (h: number, m = 0) => Date.UTC(2026, 5, 12, h, m); // 2026-06-12 UTC

describe('unionMinutes', () => {
  it('sums disjoint intervals', () => {
    expect(
      unionMinutes([
        { start: T(9), end: T(10) },
        { start: T(11), end: T(11, 30) },
      ]),
    ).toBe(90);
  });

  it('merges overlapping (parallel) intervals: earliest start → latest end', () => {
    // 9:00–11:00 song song 10:00–12:00 → tính 9:00–12:00 = 180p (không phải 240p)
    expect(
      unionMinutes([
        { start: T(9), end: T(11) },
        { start: T(10), end: T(12) },
      ]),
    ).toBe(180);
  });

  it('handles contained intervals', () => {
    expect(
      unionMinutes([
        { start: T(9), end: T(12) },
        { start: T(10), end: T(11) },
      ]),
    ).toBe(180);
  });

  it('handles touching intervals as continuous', () => {
    expect(
      unionMinutes([
        { start: T(9), end: T(10) },
        { start: T(10), end: T(11) },
      ]),
    ).toBe(120);
  });

  it('ignores invalid/empty intervals', () => {
    expect(unionMinutes([{ start: T(10), end: T(9) }])).toBe(0);
    expect(unionMinutes([])).toBe(0);
  });
});

describe('taskIntervalsForDay', () => {
  const dayStart = T(0);
  const dayEnd = T(24);
  const now = T(15);
  const iso = (ms: number) => new Date(ms).toISOString();

  it('uses completedAt for done tasks and now for doing tasks', () => {
    const tasks = [
      { startedAt: iso(T(8)), completedAt: iso(T(9, 30)), status: 'done' },
      { startedAt: iso(T(14)), status: 'doing' }, // → 14:00–15:00 (now)
    ];
    const ints = taskIntervalsForDay(tasks, dayStart, dayEnd, now);
    expect(unionMinutes(ints)).toBe(90 + 60);
  });

  it('skips tasks logged without a start time', () => {
    const ints = taskIntervalsForDay([{ completedAt: iso(T(9)), status: 'done' }], dayStart, dayEnd, now);
    expect(ints).toHaveLength(0);
  });

  it('clips intervals to the day window', () => {
    // bắt đầu 22:00 hôm trước, xong 02:00 hôm nay → chỉ tính 00:00–02:00
    const tasks = [{ startedAt: iso(T(-2)), completedAt: iso(T(2)), status: 'done' }];
    expect(unionMinutes(taskIntervalsForDay(tasks, dayStart, dayEnd, now))).toBe(120);
  });
});

describe('formatMinutes', () => {
  it('formats minutes and hours', () => {
    expect(formatMinutes(45)).toBe('45p');
    expect(formatMinutes(60)).toBe('1g');
    expect(formatMinutes(195)).toBe('3g15p');
    expect(formatMinutes(0)).toBe('0p');
  });
});
