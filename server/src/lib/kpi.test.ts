import { describe, it, expect } from 'vitest';
import {
  periodKey,
  periodLabel,
  progressOf,
  seriesFor,
  entryWindowOpen,
  canWriteEntry,
  type KpiEntryLike,
} from './kpi.js';

const e = (date: string, value: number): KpiEntryLike => ({ date, value });

describe('periodKey', () => {
  it('gom theo ngày / tháng / cả dự án', () => {
    expect(periodKey('2026-07-28', 'day')).toBe('2026-07-28');
    expect(periodKey('2026-07-28', 'month')).toBe('2026-07');
    expect(periodKey('2026-07-28', 'total')).toBe('total');
  });

  it('tuần ISO — một tuần vắt qua hai tháng vẫn là MỘT kỳ', () => {
    // 27/7 (thứ 2) đến 2/8 (chủ nhật) là cùng tuần dù khác tháng.
    const k = periodKey('2026-07-27', 'week');
    expect(periodKey('2026-07-31', 'week')).toBe(k);
    expect(periodKey('2026-08-02', 'week')).toBe(k);
    // Thứ 2 kế tiếp phải sang tuần khác.
    expect(periodKey('2026-08-03', 'week')).not.toBe(k);
  });

  it('tuần giao thừa dùng năm ISO, không phải năm lịch', () => {
    // 31/12/2026 là thứ 5, thuộc tuần 53 của năm ISO 2026; 1/1/2027 cùng tuần đó.
    expect(periodKey('2027-01-01', 'week')).toBe(periodKey('2026-12-31', 'week'));
  });

  it('ngày không hợp lệ trả rỗng, không ném lỗi', () => {
    expect(periodKey('', 'week')).toBe('');
    expect(periodKey('linh tinh', 'month')).toBe('');
  });
});

describe('periodLabel', () => {
  it('nhãn tuần kèm khoảng ngày để khỏi phải nhẩm', () => {
    expect(periodLabel('2026-W31')).toBe('Tuần 31 (27/7–2/8)');
  });

  it('nhãn tháng và cả dự án', () => {
    expect(periodLabel('2026-07')).toBe('Tháng 7/2026');
    expect(periodLabel('total')).toBe('Cả dự án');
  });
});

describe('progressOf', () => {
  it('chỉ cộng số trong kỳ đang chạy', () => {
    const entries = [e('2026-07-28', 30), e('2026-07-29', 50), e('2026-06-15', 999)];
    const r = progressOf(entries, { period: 'month', target: 200 }, '2026-07-29');
    expect(r.current).toBe(80); // bỏ qua tháng 6
    expect(r.percent).toBe(40);
    expect(r.periodKey).toBe('2026-07');
  });

  it('kỳ total gom hết mọi ngày từ đầu dự án', () => {
    const entries = [e('2026-05-01', 10), e('2026-07-29', 40)];
    expect(progressOf(entries, { period: 'total', target: 50 }, '2026-07-29').current).toBe(50);
  });

  it('chưa đặt mục tiêu thì phần trăm là 0, không chia cho 0', () => {
    const r = progressOf([e('2026-07-29', 10)], { period: 'day', target: 0 }, '2026-07-29');
    expect(r.percent).toBe(0);
    expect(Number.isFinite(r.percent)).toBe(true);
  });

  it('vượt mục tiêu vẫn trả số thật, không cắt ở 100', () => {
    const r = progressOf([e('2026-07-29', 150)], { period: 'day', target: 100 }, '2026-07-29');
    expect(r.percent).toBe(150);
  });
});

describe('seriesFor', () => {
  it('trả đủ n kỳ, kỳ trống là 0 để đường biểu đồ liền mạch', () => {
    const s = seriesFor([e('2026-07-29', 12)], 'day', 3, '2026-07-29');
    expect(s.map((p) => p.value)).toEqual([0, 0, 12]);
    expect(s.map((p) => p.key)).toEqual(['2026-07-27', '2026-07-28', '2026-07-29']);
  });

  it('cũ trước mới sau', () => {
    const s = seriesFor([], 'month', 3, '2026-07-15');
    expect(s.map((p) => p.key)).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('kỳ total chỉ có một cột tổng', () => {
    const s = seriesFor([e('2026-01-01', 5), e('2026-07-29', 7)], 'total', 8, '2026-07-29');
    expect(s).toEqual([{ key: 'total', label: 'Cả dự án', value: 12 }]);
  });
});

describe('entryWindowOpen', () => {
  it('nhập được trong chính ngày đó và ngày hôm sau', () => {
    expect(entryWindowOpen('2026-07-28', '2026-07-28')).toBe(true);
    expect(entryWindowOpen('2026-07-28', '2026-07-29')).toBe(true);
  });

  it('sang ngày kế nữa là khoá', () => {
    expect(entryWindowOpen('2026-07-28', '2026-07-30')).toBe(false);
    expect(entryWindowOpen('2026-07-28', '2026-08-05')).toBe(false);
  });

  it('ngày tương lai đóng — không ai biết trước số của ngày mai', () => {
    expect(entryWindowOpen('2026-07-30', '2026-07-29')).toBe(false);
  });

  it('cửa sổ vắt qua cuối tháng và cuối năm', () => {
    expect(entryWindowOpen('2026-07-31', '2026-08-01')).toBe(true);
    expect(entryWindowOpen('2026-12-31', '2027-01-01')).toBe(true);
    expect(entryWindowOpen('2026-12-31', '2027-01-02')).toBe(false);
  });

  it('ngày hỏng thì đóng, không ném lỗi', () => {
    expect(entryWindowOpen('', '2026-07-29')).toBe(false);
  });
});

describe('canWriteEntry', () => {
  it('nhân viên và leader theo đúng cửa sổ', () => {
    expect(canWriteEntry('2026-07-28', '2026-07-29', 'member')).toBe(true);
    expect(canWriteEntry('2026-07-28', '2026-07-30', 'member')).toBe(false);
    // Leader không có đặc quyền sửa số — anh Tâm chốt 28/7/2026.
    expect(canWriteEntry('2026-07-28', '2026-07-30', 'leader')).toBe(false);
  });

  it('giám đốc nhập bù được mọi ngày đã qua', () => {
    expect(canWriteEntry('2026-06-01', '2026-07-29', 'director')).toBe(true);
    expect(canWriteEntry('2026-06-01', '2026-07-29', 'admin')).toBe(true);
  });
});
