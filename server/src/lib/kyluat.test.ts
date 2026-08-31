import { describe, it, expect } from 'vitest';
import { DEFAULT_SHIFTS } from './attendance.js';
import { phutTrongNgay, soatNgay, tongKetKyLuat, cauCanhBao } from './kyluat.js';

// Giờ lưu ở UTC, công ty ở UTC+7 → 08:45 VN là 01:45Z. Viết thẳng mốc UTC trong test để
// khỏi phụ thuộc giờ máy chạy test.
const vn = (hhmm: string) => `2026-08-05T${String(Number(hhmm.slice(0, 2)) - 7).padStart(2, '0')}:${hhmm.slice(3)}:00.000Z`;

describe('phutTrongNgay', () => {
  it('đọc đúng phút theo giờ VN', () => {
    expect(phutTrongNgay(vn('08:45'))).toBe(8 * 60 + 45);
  });

  it('trả null cho cờ chứ không phải mốc giờ', () => {
    // requests.service ghi 'online' / 'quencham' vào ô giờ vào để tính công.
    expect(phutTrongNgay('online')).toBeNull();
    expect(phutTrongNgay('quencham')).toBeNull();
    expect(phutTrongNgay('')).toBeNull();
    expect(phutTrongNgay(undefined)).toBeNull();
  });
});

describe('soatNgay', () => {
  const D = '2026-08-05';

  it('vào sau giờ bắt đầu ca là trễ, kèm số phút và giờ vào', () => {
    const v = soatNgay({ date: D, morningInAt: vn('08:45') }, DEFAULT_SHIFTS);
    expect(v).toMatchObject({ tre: true, treMin: 15, gioVao: '08:45', som: false });
  });

  it('vào đúng giờ hoặc sớm hơn thì sạch', () => {
    expect(soatNgay({ date: D, morningInAt: vn('08:30') }, DEFAULT_SHIFTS)).toBeNull();
    expect(soatNgay({ date: D, morningInAt: vn('08:05') }, DEFAULT_SHIFTS)).toBeNull();
  });

  it('ra trước giờ tan làm là về sớm', () => {
    const v = soatNgay({ date: D, morningInAt: vn('08:00'), afternoonOutAt: vn('16:30') }, DEFAULT_SHIFTS);
    expect(v).toMatchObject({ tre: false, som: true, somMin: 30, gioRa: '16:30' });
  });

  it('ra đúng giờ tan làm hoặc muộn hơn thì sạch', () => {
    expect(soatNgay({ date: D, afternoonOutAt: vn('17:00') }, DEFAULT_SHIFTS)).toBeNull();
    expect(soatNgay({ date: D, afternoonOutAt: vn('18:20') }, DEFAULT_SHIFTS)).toBeNull();
  });

  it('trễ cả hai buổi vẫn tính MỘT lần, lấy buổi trễ nhiều nhất', () => {
    const v = soatNgay(
      { date: D, morningInAt: vn('08:40'), afternoonInAt: vn('14:00') },
      DEFAULT_SHIFTS,
    );
    expect(v).toMatchObject({ tre: true, treMin: 30, gioVao: '14:00' });
  });

  it('ngày chỉ làm buổi sáng không bị tính về sớm', () => {
    // Về lúc 11:30 rồi nghỉ chiều: công đã trừ một nửa, đếm thêm là phạt hai lần.
    const v = soatNgay({ date: D, morningInAt: vn('08:00'), afternoonOutAt: '' }, DEFAULT_SHIFTS);
    expect(v).toBeNull();
  });

  it('cờ online / quên chấm công không bị kết luận là trễ', () => {
    expect(soatNgay({ date: D, morningInAt: 'online', afternoonInAt: 'online' }, DEFAULT_SHIFTS)).toBeNull();
    expect(soatNgay({ date: D, morningInAt: 'quencham' }, DEFAULT_SHIFTS)).toBeNull();
  });

  it('ngày nghỉ phép / nghỉ lễ bỏ qua hết', () => {
    const row = { date: D, morningInAt: vn('10:00'), afternoonOutAt: vn('15:00'), mode: 'leave' };
    expect(soatNgay(row, DEFAULT_SHIFTS)).toBeNull();
    expect(soatNgay({ ...row, mode: 'holiday' }, DEFAULT_SHIFTS)).toBeNull();
  });

  it('đơn đã duyệt không xoá vi phạm, chỉ đánh dấu có xin phép', () => {
    const v = soatNgay({ date: D, morningInAt: vn('09:10') }, DEFAULT_SHIFTS, { tre: true });
    expect(v).toMatchObject({ tre: true, treMin: 40, donTre: true });
  });

  it('có đơn mà không có mốc giờ nào vẫn bị đếm', () => {
    // Quên chấm hẳn rồi nộp đơn đi trễ — bỏ qua thì nộp đơn hoá ra là cách né.
    const v = soatNgay({ date: D }, DEFAULT_SHIFTS, { tre: true });
    expect(v).toMatchObject({ tre: true, treMin: 0, gioVao: '', donTre: true });
  });
});

describe('tongKetKyLuat', () => {
  const rows = [
    { date: '2026-08-03', morningInAt: vn('08:45') }, // trễ 15, không đơn
    { date: '2026-08-04', morningInAt: vn('08:10'), afternoonOutAt: vn('17:05') }, // sạch
    { date: '2026-08-05', morningInAt: vn('09:00'), afternoonOutAt: vn('16:00') }, // trễ + sớm
    { date: '2026-08-06', morningInAt: 'online', afternoonInAt: 'online', mode: 'online' }, // sạch
  ];

  it('đếm theo ngày và tách số lần chưa có đơn', () => {
    const t = tongKetKyLuat(rows, DEFAULT_SHIFTS, new Set(['2026-08-05']), new Set());
    expect(t.soLanTre).toBe(2);
    expect(t.soLanSom).toBe(1);
    // 3/8 trễ không đơn + 5/8 về sớm không đơn = 2 (5/8 trễ đã có đơn)
    expect(t.soLanKhongDon).toBe(2);
    expect(t.ngay.map((n) => n.date)).toEqual(['2026-08-03', '2026-08-05']);
  });

  it('gộp cả ngày chỉ có đơn mà không có dòng chấm công', () => {
    const t = tongKetKyLuat(rows, DEFAULT_SHIFTS, new Set(['2026-08-20']), new Set());
    expect(t.soLanTre).toBe(3);
    expect(t.ngay.map((n) => n.date)).toEqual(['2026-08-03', '2026-08-05', '2026-08-20']);
  });

  it('tháng sạch trả về số 0 và danh sách rỗng', () => {
    const t = tongKetKyLuat([rows[1], rows[3]], DEFAULT_SHIFTS, new Set(), new Set());
    expect(t).toEqual({ soLanTre: 0, soLanSom: 0, soLanKhongDon: 0, ngay: [] });
  });
});

describe('cauCanhBao', () => {
  const t = (tre: number, som: number, khongDon = 0) => ({
    soLanTre: tre,
    soLanSom: som,
    soLanKhongDon: khongDon,
    ngay: [],
  });

  it('nói cả hai khi có cả hai', () => {
    expect(cauCanhBao(t(3, 1), '8/2026')).toBe(
      'Tháng 8/2026 bạn đi trễ 3 lần, về sớm 1 lần. Nếu không cải thiện, bạn sẽ bị phạt.',
    );
  });

  it('bỏ vế không có', () => {
    expect(cauCanhBao(t(2, 0), '8/2026')).toBe(
      'Tháng 8/2026 bạn đi trễ 2 lần. Nếu không cải thiện, bạn sẽ bị phạt.',
    );
    expect(cauCanhBao(t(0, 1), '8/2026')).toBe(
      'Tháng 8/2026 bạn về sớm 1 lần. Nếu không cải thiện, bạn sẽ bị phạt.',
    );
  });

  it('nói thêm số lần chưa có đơn', () => {
    expect(cauCanhBao(t(3, 1, 2), '8/2026')).toContain('Trong đó 2 lần chưa có đơn giải trình.');
  });

  it('tháng sạch thì im lặng', () => {
    expect(cauCanhBao(t(0, 0), '8/2026')).toBe('');
  });
});
