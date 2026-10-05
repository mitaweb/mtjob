import { describe, it, expect } from 'vitest';
import { amSangDuong, congNgay, leLonVietNam } from './amLich.js';

// Đối chiếu với lịch Việt Nam đã công bố.
describe('amSangDuong', () => {
  it('mùng 1 Tết các năm', () => {
    expect(amSangDuong(1, 1, 2024)).toBe('2024-02-10'); // Giáp Thìn
    expect(amSangDuong(1, 1, 2025)).toBe('2025-01-29'); // Ất Tỵ
    expect(amSangDuong(1, 1, 2026)).toBe('2026-02-17'); // Bính Ngọ
    expect(amSangDuong(1, 1, 2027)).toBe('2027-02-06'); // Đinh Mùi
    expect(amSangDuong(1, 1, 2023)).toBe('2023-01-22'); // Quý Mão
  });

  it('Giỗ Tổ Hùng Vương 10/3 âm', () => {
    expect(amSangDuong(10, 3, 2024)).toBe('2024-04-18');
    expect(amSangDuong(10, 3, 2025)).toBe('2025-04-07');
    expect(amSangDuong(10, 3, 2026)).toBe('2026-04-26');
    expect(amSangDuong(10, 3, 2023)).toBe('2023-04-29');
  });

  it('Trung thu 15/8 âm (kiểm thêm tháng giữa năm, năm có nhuận)', () => {
    expect(amSangDuong(15, 8, 2025)).toBe('2025-10-06'); // 2025 nhuận tháng 6
    expect(amSangDuong(15, 8, 2023)).toBe('2023-09-29'); // 2023 nhuận tháng 2
  });

  it('tháng nhuận: có thì ra ngày, không có thì rỗng', () => {
    expect(amSangDuong(1, 6, 2025, true)).toBe('2025-07-25'); // mùng 1 tháng 6 nhuận Ất Tỵ
    expect(amSangDuong(1, 5, 2025, true)).toBe('');
    expect(amSangDuong(1, 6, 2026, true)).toBe(''); // 2026 không nhuận
  });
});

describe('congNgay', () => {
  it('qua tháng, qua năm', () => {
    expect(congNgay('2026-02-17', -1)).toBe('2026-02-16');
    expect(congNgay('2026-12-31', 1)).toBe('2027-01-01');
    expect(congNgay('2024-03-01', -1)).toBe('2024-02-29');
  });
});

describe('leLonVietNam', () => {
  it('năm 2026: 11 ngày theo luật, đúng ngày, xếp theo thời gian', () => {
    const ds = leLonVietNam(2026);
    expect(ds.map((x) => x.date)).toEqual([
      '2026-01-01',
      '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
      '2026-04-26',
      '2026-04-30', '2026-05-01',
      '2026-09-01', '2026-09-02',
    ]);
    expect(ds.find((x) => x.date === '2026-09-01')!.name).toBe('Quốc khánh');
  });

  it('Tết rơi vào tháng 1 dương (2025) vẫn đúng', () => {
    const tet = leLonVietNam(2025).filter((x) => x.name.startsWith('Tết Nguyên Đán')).map((x) => x.date);
    expect(tet).toEqual(['2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01']);
  });
});
