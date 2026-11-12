import { describe, expect, it } from 'vitest';
import { cpaMucTieu, locDeXuat, phanLoai } from './adsLuat.js';

const meta = (cpa: number, them: Partial<Parameters<typeof phanLoai>[1]> = {}) => ({ cpaMucTieu: cpa, nen: 'meta' as const, ...them });

describe('phanLoai — thắng / thua / chờ / mỏi', () => {
  it('chi gấp đôi CPA mục tiêu mà 0 kết quả → thua', () => {
    expect(phanLoai({ chi: 210_000, hienThi: 5000, ketQua: 0 }, meta(100_000)).nhan).toBe('thua');
  });

  it('0 kết quả nhưng chi chưa tới 2× CPA mục tiêu → chờ (chưa đủ dữ liệu)', () => {
    expect(phanLoai({ chi: 150_000, hienThi: 5000, ketQua: 0 }, meta(100_000)).nhan).toBe('cho');
  });

  it('CPA vượt 1,5× mục tiêu khi đã chi ≥ 2× → thua', () => {
    expect(phanLoai({ chi: 400_000, hienThi: 8000, ketQua: 2 }, meta(100_000)).nhan).toBe('thua');
  });

  it('CPA đạt mục tiêu với ≥ 3 kết quả → thắng; Meta chưa thoát học (< 50 kết quả) chỉ tăng ≤ 20%', () => {
    const r = phanLoai({ chi: 400_000, hienThi: 8000, ketQua: 5 }, meta(100_000));
    expect(r.nhan).toBe('thang');
    expect(r.tangToiDa).toBe(0.2);
  });

  it('Google thắng được tăng ≤ 30%', () => {
    expect(phanLoai({ chi: 400_000, hienThi: 8000, ketQua: 5 }, { cpaMucTieu: 100_000, nen: 'gads' }).tangToiDa).toBe(0.3);
  });

  it('CPA tốt nhưng mới 2 kết quả → chờ (ngẫu nhiên, chưa kết luận)', () => {
    expect(phanLoai({ chi: 150_000, hienThi: 8000, ketQua: 2 }, meta(100_000)).nhan).toBe('cho');
  });

  it('dưới 1.000 lượt hiển thị → chờ, kể cả 0 kết quả', () => {
    expect(phanLoai({ chi: 500_000, hienThi: 800, ketQua: 0 }, meta(100_000)).nhan).toBe('cho');
  });

  it('vừa sửa dưới 3 ngày → chờ cho nền tảng học lại', () => {
    const r = phanLoai({ chi: 500_000, hienThi: 9000, ketQua: 0 }, meta(100_000, { ngayTuLanSua: 1 }));
    expect(r.nhan).toBe('cho');
    expect(r.lyDo).toMatch(/vừa sửa/);
  });

  it('Meta tần suất ≥ 3 → mỏi (thay nội dung, không tắt)', () => {
    expect(phanLoai({ chi: 500_000, hienThi: 9000, ketQua: 0, tanSuat: 3.4 }, meta(100_000)).nhan).toBe('moi');
  });

  it('chưa có CPA mục tiêu → chờ', () => {
    expect(phanLoai({ chi: 900_000, hienThi: 9000, ketQua: 0 }, meta(0)).nhan).toBe('cho');
  });
});

describe('cpaMucTieu', () => {
  it('anh đặt thì dùng số anh đặt', () => expect(cpaMucTieu(80_000, 3_000_000, 10)).toBe(80_000));
  it('chưa đặt → CPA trung bình 30 ngày của tài khoản', () => expect(cpaMucTieu(0, 3_000_000, 20)).toBe(150_000));
  it('30 ngày không có kết quả → 0 (chưa biết)', () => expect(cpaMucTieu(0, 3_000_000, 0)).toBe(0));
});

describe('locDeXuat — AI phải theo luật', () => {
  const pl = new Map([
    ['campaign:1', phanLoai({ chi: 300_000, hienThi: 9000, ketQua: 0 }, meta(100_000))], // thua
    ['campaign:2', phanLoai({ chi: 400_000, hienThi: 9000, ketQua: 6 }, meta(100_000))], // thắng, ≤ 20%
    ['campaign:3', phanLoai({ chi: 120_000, hienThi: 9000, ketQua: 1 }, meta(100_000))], // chờ
  ]);

  it('tắt đối tượng thua → giữ', () => {
    expect(locDeXuat({ hanhDong: 'tat', cap: 'campaign', doiTuongId: '1' }, pl, 0)).toEqual({});
  });

  it('tắt đối tượng đang chờ / không có số → bỏ', () => {
    expect(locDeXuat({ hanhDong: 'tat', cap: 'campaign', doiTuongId: '3' }, pl, 0).bo).toBeTruthy();
    expect(locDeXuat({ hanhDong: 'tat', cap: 'campaign', doiTuongId: '9' }, pl, 0).bo).toBeTruthy();
  });

  it('tăng ngân sách đối tượng thắng quá mức → hạ về mức tối đa', () => {
    expect(locDeXuat({ hanhDong: 'ngan_sach', cap: 'campaign', doiTuongId: '2', nganSach: 300_000 }, pl, 200_000)).toEqual({ nganSach: 240_000 });
  });

  it('tăng ngân sách đối tượng không thắng → bỏ; giảm ngân sách đối tượng thua → giữ', () => {
    expect(locDeXuat({ hanhDong: 'ngan_sach', cap: 'campaign', doiTuongId: '3', nganSach: 300_000 }, pl, 200_000).bo).toBeTruthy();
    expect(locDeXuat({ hanhDong: 'ngan_sach', cap: 'campaign', doiTuongId: '1', nganSach: 100_000 }, pl, 200_000)).toEqual({});
  });

  it('từ khoá phủ định / thêm từ khoá không theo luật thắng-thua (dựa cụm khách gõ)', () => {
    expect(locDeXuat({ hanhDong: 'tu_khoa_am', cap: 'campaign', doiTuongId: '3' }, pl, 0)).toEqual({});
  });
});
