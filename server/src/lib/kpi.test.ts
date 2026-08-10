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
  timeProgress,
  projectAlert,
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

// Anh Tâm 4/8/2026: tuần/tháng của dự án đếm từ NGÀY BẮT ĐẦU, không theo lịch.
// Ví dụ gốc của anh: dự án bắt đầu 31/7 thì tuần 1 là 31/7 → 6/8.
describe('periodKey — kỳ đếm từ ngày bắt đầu dự án', () => {
  const MOC = '2026-07-31';

  it('tuần 1 là đúng 7 ngày kể từ mốc', () => {
    expect(periodKey('2026-07-31', 'week', MOC)).toBe('W1');
    expect(periodKey('2026-08-06', 'week', MOC)).toBe('W1');
    expect(periodKey('2026-08-07', 'week', MOC)).toBe('W2');
    expect(periodKey('2026-08-13', 'week', MOC)).toBe('W2');
  });

  it('gom được số cuối tuần mà lịch ISO xé làm đôi', () => {
    // Đây chính là lỗi anh Tâm gặp: T6 31/7 và T3 4/8 nằm ở HAI tuần lịch khác nhau
    // nên nhập bù sáng thứ Hai xong tiến độ vẫn 0. Đếm từ mốc thì chúng cùng một kỳ.
    expect(periodKey('2026-07-31', 'week')).not.toBe(periodKey('2026-08-04', 'week'));
    expect(periodKey('2026-07-31', 'week', MOC)).toBe(periodKey('2026-08-04', 'week', MOC));
  });

  it('tháng là khối 30 ngày, không phải tháng lịch', () => {
    expect(periodKey('2026-07-31', 'month', MOC)).toBe('M1');
    expect(periodKey('2026-08-29', 'month', MOC)).toBe('M1'); // ngày thứ 30
    expect(periodKey('2026-08-30', 'month', MOC)).toBe('M2');
    // Sang tháng lịch mới vẫn là kỳ 1 — đây là điểm khác hẳn cách cũ.
    expect(periodKey('2026-08-01', 'month')).toBe('2026-08');
  });

  it('ngày trước lúc dự án bắt đầu ra kỳ 0 trở xuống', () => {
    expect(periodKey('2026-07-30', 'week', MOC)).toBe('W0');
    expect(periodKey('2026-07-24', 'week', MOC)).toBe('W0');
    expect(periodKey('2026-07-23', 'week', MOC)).toBe('W-1');
  });

  it('mốc rỗng hoặc hỏng thì quay về kỳ theo lịch, không ném lỗi', () => {
    expect(periodKey('2026-07-31', 'week', '')).toBe(periodKey('2026-07-31', 'week'));
    expect(periodKey('2026-07-31', 'week', 'linh tinh')).toBe(periodKey('2026-07-31', 'week'));
  });

  it('ngày là kỳ theo ngày, mốc không đổi gì', () => {
    expect(periodKey('2026-08-04', 'day', MOC)).toBe('2026-08-04');
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

  it('kỳ đếm từ mốc ghi rõ khoảng ngày của chính dự án đó', () => {
    expect(periodLabel('W1', '2026-07-31')).toBe('Tuần 1 (31/7–6/8)');
    expect(periodLabel('W2', '2026-07-31')).toBe('Tuần 2 (7/8–13/8)');
    expect(periodLabel('M1', '2026-07-31')).toBe('Tháng 1 (31/7–29/8)');
  });

  it('thiếu mốc thì vẫn đọc được, chỉ mất khoảng ngày', () => {
    expect(periodLabel('W3')).toBe('Tuần 3');
  });

  it('số nhập trước ngày bắt đầu nói thẳng ra', () => {
    expect(periodLabel('W0', '2026-07-31')).toBe('Trước khi bắt đầu');
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

  it('đếm từ ngày bắt đầu: số T6 31/7 vẫn tính cho tuần đang chạy hôm T3 4/8', () => {
    // Đúng tình huống Savax Door: nhập bù cuối tuần xong tiến độ đứng im vì lịch ISO
    // xé 31/7 sang tuần trước.
    const entries = [e('2026-07-31', 20), e('2026-08-04', 15)];
    const theoLich = progressOf(entries, { period: 'week', target: 68 }, '2026-08-04');
    expect(theoLich.current).toBe(15); // mất 20 của thứ Sáu

    const theoMoc = progressOf(entries, { period: 'week', target: 68 }, '2026-08-04', '2026-07-31');
    expect(theoMoc.current).toBe(35);
    expect(theoMoc.periodKey).toBe('W1');
    expect(theoMoc.periodLabel).toBe('Tuần 1 (31/7–6/8)');
  });

  // Hai cách nhập (anh Tâm 4/8/2026). SAVAX DOOR từng ra 250/120 vì cộng dồn một chỉ số
  // đo TRẠNG THÁI — nhập 45 rồi 46 thành 91, trong khi thực tế vẫn chỉ có 46.
  it('cumulative: lấy số nhập gần nhất, KHÔNG cộng', () => {
    const entries = [e('2026-08-01', 45), e('2026-08-03', 46), e('2026-08-05', 50)];
    const cong = progressOf(entries, { period: 'month', target: 120 }, '2026-08-06');
    expect(cong.current).toBe(141); // cách cũ: cộng hết

    const luyKe = progressOf(
      entries,
      { period: 'month', target: 120, inputMode: 'cumulative' },
      '2026-08-06',
    );
    expect(luyKe.current).toBe(50);
    expect(luyKe.percent).toBe(42);
    expect(luyKe.periodLabel).toBe('Tổng đến hôm nay');
  });

  it('cumulative: bỏ qua số của ngày mai — hôm nay chưa biết được', () => {
    const entries = [e('2026-08-03', 46), e('2026-08-09', 99)];
    const r = progressOf(entries, { period: 'month', target: 120, inputMode: 'cumulative' }, '2026-08-06');
    expect(r.current).toBe(46);
  });

  it('cumulative: sang kỳ mới KHÔNG về 0 — 100 keyword vẫn còn đó', () => {
    const entries = [e('2026-07-20', 100)];
    // Kiểu cộng dồn thì tháng 8 không có số nào → 0.
    expect(progressOf(entries, { period: 'month', target: 120 }, '2026-08-06').current).toBe(0);
    // Kiểu luỹ kế thì vẫn là 100.
    expect(
      progressOf(entries, { period: 'month', target: 120, inputMode: 'cumulative' }, '2026-08-06').current,
    ).toBe(100);
  });

  it('thiếu inputMode thì vẫn cộng dồn như cũ — chỉ số cũ không bị đổi cách tính', () => {
    const entries = [e('2026-08-01', 10), e('2026-08-02', 20)];
    expect(progressOf(entries, { period: 'month', target: 100 }, '2026-08-06').current).toBe(30);
    expect(
      progressOf(entries, { period: 'month', target: 100, inputMode: 'daily' }, '2026-08-06').current,
    ).toBe(30);
  });

  it('sang kỳ sau thì số kỳ trước không theo qua', () => {
    const entries = [e('2026-08-04', 35), e('2026-08-08', 10)];
    const r = progressOf(entries, { period: 'week', target: 68 }, '2026-08-08', '2026-07-31');
    expect(r.periodKey).toBe('W2');
    expect(r.current).toBe(10);
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

  it('đếm từ mốc: nhãn là kỳ của dự án, không phải tuần trên lịch', () => {
    const s = seriesFor([e('2026-08-04', 35)], 'week', 8, '2026-08-12', '2026-07-31');
    expect(s.map((p) => p.key)).toEqual(['W1', 'W2']);
    expect(s[0]!.label).toBe('Tuần 1 (31/7–6/8)');
    expect(s.map((p) => p.value)).toEqual([35, 0]);
  });

  it('không vẽ lùi quá kỳ 1 — trước đó dự án chưa tồn tại', () => {
    const s = seriesFor([], 'week', 8, '2026-08-04', '2026-07-31');
    expect(s).toHaveLength(1);
    expect(s[0]!.key).toBe('W1');
  });

  it('cumulative: kỳ không nhập thì kéo số kỳ trước sang, không rơi về 0', () => {
    // Nhập 40 ở tháng 6, im lặng tháng 7, nhập 55 ở tháng 8.
    const entries = [e('2026-06-10', 40), e('2026-08-02', 55)];
    const s = seriesFor(entries, 'month', 3, '2026-08-06', undefined, 'cumulative');
    expect(s.map((p) => p.key)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(s.map((p) => p.value)).toEqual([40, 40, 55]);
  });

  it('cumulative: số nhập TRƯỚC cửa sổ vẫn được dùng làm mốc mở đầu', () => {
    const entries = [e('2026-01-05', 30)];
    const s = seriesFor(entries, 'month', 3, '2026-08-06', undefined, 'cumulative');
    // Ba tháng gần đây không ai nhập, nhưng 30 keyword đó vẫn còn — không được vẽ thành 0.
    expect(s.map((p) => p.value)).toEqual([30, 30, 30]);
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

// Anh Tâm 3/8/2026: "dự án nào quá 50% thời gian mà chưa đạt 50% KPI thì tô đỏ hoặc vàng,
// nếu thời gian vượt thì tô đỏ".

describe('timeProgress', () => {
  it('tính phần trăm thời gian đã trôi', () => {
    expect(timeProgress('2026-08-01', '2026-08-31', '2026-08-16')).toBe(50);
    expect(timeProgress('2026-08-01', '2026-08-31', '2026-08-01')).toBe(0);
    expect(timeProgress('2026-08-01', '2026-08-31', '2026-08-31')).toBe(100);
  });

  it('quá hạn thì vượt 100', () => {
    expect(timeProgress('2026-08-01', '2026-08-31', '2026-09-15')).toBeGreaterThan(100);
  });

  it('chưa tới ngày bắt đầu thì là 0, không âm', () => {
    expect(timeProgress('2026-09-01', '2026-09-30', '2026-08-15')).toBe(0);
  });

  it('THIẾU ngày thì trả null — không có mốc thì mọi kết luận chậm đều là bịa', () => {
    expect(timeProgress('', '2026-08-31', '2026-08-16')).toBeNull();
    expect(timeProgress('2026-08-01', '', '2026-08-16')).toBeNull();
  });

  it('ngày kết thúc không sau ngày bắt đầu thì coi như dữ liệu hỏng', () => {
    expect(timeProgress('2026-08-31', '2026-08-01', '2026-08-16')).toBeNull();
    expect(timeProgress('2026-08-01', '2026-08-01', '2026-08-01')).toBeNull();
  });
});

describe('projectAlert', () => {
  it('quá nửa thời gian mà KPI dưới 50% → VÀNG', () => {
    const a = projectAlert(60, 40, 2);
    expect(a.level).toBe('warn');
    expect(a.reason).toContain('60%');
  });

  it('quá 75% thời gian mà KPI dưới 50% → ĐỎ', () => {
    expect(projectAlert(80, 40, 2).level).toBe('danger');
  });

  it('QUÁ HẠN mà chưa đạt mục tiêu → ĐỎ', () => {
    expect(projectAlert(130, 90, 2).level).toBe('danger');
  });

  it('quá hạn nhưng ĐÃ đạt mục tiêu thì không báo động', () => {
    expect(projectAlert(130, 100, 2).level).toBe('none');
  });

  it('đi đúng nhịp thì không cảnh báo', () => {
    expect(projectAlert(60, 65, 2).level).toBe('none');
    expect(projectAlert(40, 10, 2).level).toBe('none'); // mới 40% thời gian, chưa tới mốc
  });

  it('KHÔNG cảnh báo khi chưa chỉ số nào đặt mục tiêu — 0% lúc đó không phải làm kém', () => {
    expect(projectAlert(90, 0, 0).level).toBe('none');
  });

  it('thiếu ngày bắt đầu/kết thúc thì không cảnh báo', () => {
    expect(projectAlert(null, 0, 3).level).toBe('none');
  });
});
