import { describe, it, expect } from 'vitest';
import { traiNoiDung, tenGoi, trongGioGui, choGiuaTin, uocTinhNgay, CACH_TIN_MS, GIOI_HAN_NGAY } from './zaloGui.js';

describe('gửi Zalo hàng loạt — nội dung từng người', () => {
  it('thay {ten}, chọn một phương án trong {a|b}', () => {
    expect(traiNoiDung('{Chào|Xin chào} {ten}, MT Digital gửi ưu đãi tháng 11.', 'Anh Tuấn', () => 0)).toBe('Chào Anh Tuấn, MT Digital gửi ưu đãi tháng 11.');
    expect(traiNoiDung('{Chào|Xin chào} {ten}, MT Digital gửi ưu đãi tháng 11.', 'Anh Tuấn', () => 0.99)).toBe('Xin chào Anh Tuấn, MT Digital gửi ưu đãi tháng 11.');
    expect(traiNoiDung('Dạ {TEN} ơi', 'Chị Lan', () => 0)).toBe('Dạ Chị Lan ơi');
  });
  it('không có tên thì dọn dấu thừa; giữ xuống dòng', () => {
    expect(traiNoiDung('Chào {ten}, em gửi bảng giá.\nCảm ơn {ten} !', '', () => 0)).toBe('Chào, em gửi bảng giá.\nCảm ơn!');
  });
  it('tên gọi bỏ phần ghi chú', () => {
    expect(tenGoi('Anh Tuấn - Gara 911')).toBe('Anh Tuấn');
    expect(tenGoi('Chị Hoa (kế toán)')).toBe('Chị Hoa');
    expect(tenGoi('NHÓM KHÁCH | MT DIGITAL')).toBe('NHÓM KHÁCH');
  });
  it('giờ gửi, nhịp gửi, ước tính số ngày', () => {
    expect(trongGioGui(7)).toBe(false);
    expect(trongGioGui(8)).toBe(true);
    expect(trongGioGui(20)).toBe(true);
    expect(trongGioGui(21)).toBe(false);
    expect(choGiuaTin(() => 0)).toBe(CACH_TIN_MS[0]);
    expect(choGiuaTin(() => 1)).toBe(CACH_TIN_MS[1]);
    expect(uocTinhNgay(50)).toBe(0);
    expect(uocTinhNgay(GIOI_HAN_NGAY + 1)).toBe(1);
    expect(uocTinhNgay(80, 60)).toBe(1);
  });
});

describe('ảnh kèm', () => {
  it('chỉ nhận ảnh trong kho Vercel Blob của app', async () => {
    const { laAnhHopLe } = await import('./zaloGui.js');
    expect(laAnhHopLe({ url: 'https://abc123.public.blob.vercel-storage.com/uu-dai-xyz.jpg', ten: 'uu-dai.jpg' })).toBe(true);
    expect(laAnhHopLe({ url: 'http://abc123.public.blob.vercel-storage.com/a.jpg', ten: 'a.jpg' })).toBe(false);
    expect(laAnhHopLe({ url: 'https://169.254.169.254/latest/meta-data', ten: 'a.jpg' })).toBe(false);
    expect(laAnhHopLe({ url: 'https://evil.com/x.public.blob.vercel-storage.com.jpg', ten: 'a.jpg' })).toBe(false);
    expect(laAnhHopLe({ url: 'https://abc.public.blob.vercel-storage.com/a.pdf', ten: 'a.pdf' })).toBe(false);
  });
});
