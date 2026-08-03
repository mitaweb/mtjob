import { describe, it, expect } from 'vitest';
import {
  periodKey,
  periodLabel,
  progressOf,
  seriesFor,
  entryWindowOpen,
  canWriteEntry,
  openEntryDates,
  projectProgress,
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

// Anh Tâm 3/8/2026: "nếu rơi vào T7 CN thì sẽ nhập bù vào thứ 2, số T6 cũng nhập vào
// ngày T2 là tối đa". Luật cũ cho đúng một ngày lịch nên số thứ Sáu hết hạn vào thứ Bảy —
// ngày không ai đi làm. Cứ cuối tuần là mất số.
//
// Mốc: 2026-08-03 là thứ Hai. 07-31 = T6, 08-01 = T7, 08-02 = CN.

describe('entryWindowOpen — bỏ qua ngày nghỉ', () => {
  const T2 = '2026-08-03';

  it('thứ Hai vẫn nhập được cho chính thứ Hai', () => {
    expect(entryWindowOpen(T2, T2)).toBe(true);
  });

  it('thứ Hai nhập bù được cho thứ Sáu, thứ Bảy và Chủ nhật', () => {
    expect(entryWindowOpen('2026-07-31', T2)).toBe(true); // T6
    expect(entryWindowOpen('2026-08-01', T2)).toBe(true); // T7
    expect(entryWindowOpen('2026-08-02', T2)).toBe(true); // CN
  });

  it('nhưng KHÔNG lùi xa hơn — thứ Năm tuần trước đã khoá', () => {
    expect(entryWindowOpen('2026-07-30', T2)).toBe(false);
  });

  it('giữa tuần vẫn là hôm nay + hôm qua như cũ', () => {
    expect(entryWindowOpen('2026-08-04', '2026-08-05')).toBe(true);
    expect(entryWindowOpen('2026-08-03', '2026-08-05')).toBe(false);
  });

  it('ai vào app cuối tuần vẫn nhập được số thứ Sáu — mở liên tục tới hạn chót', () => {
    expect(entryWindowOpen('2026-07-31', '2026-08-01')).toBe(true); // xem vào T7
    expect(entryWindowOpen('2026-07-31', '2026-08-02')).toBe(true); // xem vào CN
    expect(entryWindowOpen('2026-07-31', '2026-08-03')).toBe(true); // T2 — hạn chót
    expect(entryWindowOpen('2026-07-31', '2026-08-04')).toBe(false); // T3 đã muộn
  });

  it('ngày chưa tới thì không mở', () => {
    expect(entryWindowOpen('2026-08-04', T2)).toBe(false);
  });

  it('nghỉ lễ cũng được bỏ qua', () => {
    // 2026-09-02 (T4) là lễ → số ngày 01/9 nhập bù được tới 03/9.
    const le = new Set(['2026-09-02']);
    expect(entryWindowOpen('2026-09-01', '2026-09-03', le)).toBe(true);
    expect(entryWindowOpen('2026-09-01', '2026-09-03')).toBe(false); // không khai lễ thì đóng
  });
});

describe('openEntryDates', () => {
  it('thứ Hai mở bốn ngày: T6, T7, CN, T2', () => {
    expect(openEntryDates('2026-08-03')).toEqual([
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('giữa tuần chỉ mở hai ngày', () => {
    expect(openEntryDates('2026-08-05')).toEqual(['2026-08-04', '2026-08-05']);
  });

  it('ngày cuối cùng luôn là hôm nay', () => {
    const d = openEntryDates('2026-08-06');
    expect(d[d.length - 1]).toBe('2026-08-06');
  });
});

// Anh Tâm 3/8/2026: "nhập chỉ số xong thì tiến độ dự án chưa cập nhật". Gốc là chỉ số
// để trống mục tiêu luôn ra 0% mà vẫn bị gộp vào trung bình, kéo con số đứng yên.

describe('projectProgress', () => {
  it('bỏ qua chỉ số CHƯA đặt mục tiêu — đúng ca anh Tâm gặp', () => {
    const r = projectProgress([
      { percent: 100, target: 500 },
      { percent: 0, target: 0 }, // chưa đặt mục tiêu
    ]);
    expect(r.percent).toBe(100); // trước đây ra 50 — nhập bao nhiêu cũng gần như đứng im
    expect(r.counted).toBe(1);
    expect(r.noTarget).toBe(1);
  });

  it('trung bình các chỉ số có mục tiêu', () => {
    expect(projectProgress([{ percent: 80, target: 10 }, { percent: 40, target: 20 }]).percent).toBe(60);
  });

  it('chưa chỉ số nào có mục tiêu thì báo rõ, không phải 0% vì kém', () => {
    const r = projectProgress([{ percent: 0, target: 0 }, { percent: 0, target: 0 }]);
    expect(r).toEqual({ percent: 0, counted: 0, noTarget: 2 });
  });

  it('dự án chưa có chỉ số nào', () => {
    expect(projectProgress([])).toEqual({ percent: 0, counted: 0, noTarget: 0 });
  });

  it('vượt mục tiêu vẫn giữ số thật, không cắt về 100', () => {
    expect(projectProgress([{ percent: 140, target: 10 }]).percent).toBe(140);
  });
});
