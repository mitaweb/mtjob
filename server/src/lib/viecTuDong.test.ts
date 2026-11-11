import { describe, it, expect } from 'vitest';
import { loiRoRang, sauLuot, SAI_TOI_DA } from './viecTuDong.js';

// Javis mục 5 (anh Tâm 11/11/2026): việc lặp tự chạy có bước KIỂM LẠI kết quả, sai 3 lần liền thì tự dừng.
describe('loiRoRang — kết quả hỏng thấy ngay, khỏi nhờ AI kiểm', () => {
  it('bắt câu lỗi / trống / bị chặn', () => {
    expect(loiRoRang('')).toBeTruthy();
    expect(loiRoRang('Xin lỗi, trợ lý đang bận, thử lại sau ít phút nhé.\n\n(Nguyên nhân: 429)')).toBeTruthy();
    expect(loiRoRang('Lỗi: Google báo API chưa bật')).toBeTruthy();
    expect(loiRoRang('⚠️ Em CHƯA ghi được gì vào hệ thống')).toBeTruthy();
  });
  it('báo cáo bình thường thì qua', () => {
    expect(loiRoRang('Chi tiêu Google Ads 7 ngày: 12.500.000đ, 340 click, CPA 85.000đ — tăng 12% so với tuần trước.')).toBeNull();
  });
});

describe('sauLuot — đếm lần sai, tự dừng', () => {
  it('đạt thì xoá đếm sai', () => {
    expect(sauLuot(2, true)).toEqual({ soLanLoi: 0, trangThai: 'chay' });
  });
  it('sai thì cộng dồn; tới ngưỡng thì tự dừng', () => {
    expect(sauLuot(0, false)).toEqual({ soLanLoi: 1, trangThai: 'chay' });
    expect(sauLuot(SAI_TOI_DA - 1, false)).toEqual({ soLanLoi: SAI_TOI_DA, trangThai: 'tu_dung' });
    expect(SAI_TOI_DA).toBe(3);
  });
});
