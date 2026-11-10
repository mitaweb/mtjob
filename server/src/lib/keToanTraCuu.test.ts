import { describe, it, expect } from 'vitest';
import { locGiaoDich, locHoaDon, vanBanGiaoDich } from './keToanTraCuu.js';
import type { GiaoDich } from './saoKe.js';
import type { HoaDon } from './keToan.js';

// Anh Tâm 10/11/2026: "Anh cần bộ não nắm, hiểu toàn bộ phần mềm" — trợ lý của giám đốc tra được sao kê / hoá đơn của
// mục Kế toán thuế (hỏi "Sagotool chuyển tiền chưa"). Số liệu GIẢ.

const gd = (id: string, o: Partial<GiaoDich>): GiaoDich => ({
  id, soTk: '123', nganHang: 'MB', ngay: '2026-11-01', ghiNo: 0, ghiCo: 0, soDu: 0, noiDung: '', soRef: '', doiTac: '', thuTu: 0, ...o,
});
const DS = [
  gd('1', { ngay: '2026-10-05', ghiCo: 11_000_000, noiDung: 'CONG TY TNHH TM DAU TU GIAI PHAP MOI TT HD 12', doiTac: 'GIAI PHAP MOI' }),
  gd('2', { ngay: '2026-11-03', ghiCo: 5_500_000, noiDung: 'SAGOTOOL CK phi thang 11' }),
  gd('3', { ngay: '2026-11-04', ghiNo: 2_000_000, noiDung: 'RetailVISA FACEBK ads' }),
];

describe('locGiaoDich', () => {
  it('tìm theo chữ trong nội dung / tên người chuyển, không phân biệt dấu, hoa thường', () => {
    expect(locGiaoDich(DS, { tim: 'giải pháp mới' }).map((g) => g.id)).toEqual(['1']);
    expect(locGiaoDich(DS, { tim: 'sagotool' }).map((g) => g.id)).toEqual(['2']);
  });
  it('tìm theo số tiền (±1.000đ), lọc tiền vào / ra và khoảng ngày; mới nhất trước', () => {
    expect(locGiaoDich(DS, { tim: '5.500.000' }).map((g) => g.id)).toEqual(['2']);
    expect(locGiaoDich(DS, { loai: 'vao', tuNgay: '2026-10-01' }).map((g) => g.id)).toEqual(['2', '1']);
    expect(locGiaoDich(DS, { loai: 'ra' }).map((g) => g.id)).toEqual(['3']);
    expect(locGiaoDich(DS, { denNgay: '2026-10-31' }).map((g) => g.id)).toEqual(['1']);
  });
  it('văn bản: tổng vào / ra + từng dòng', () => {
    const t = vanBanGiaoDich(locGiaoDich(DS, {}), 10);
    expect(t).toContain('3 giao dịch');
    expect(t).toContain('vào 16.500.000đ');
    expect(t).toContain('2026-11-03 · VÀO 5.500.000đ · SAGOTOOL CK phi thang 11');
  });
});

const hd = (soHd: string, o: Partial<HoaDon>): HoaDon => ({
  huong: 'ra', mauSo: '1', kyHieu: 'C26TAA', soHd, ngay: '2026-10-01', mstDoiTac: '0300000001', tenDoiTac: '', dienGiai: '',
  tienHang: 0, tienThue: 0, tongTien: 0, thueSuat: '', trangThai: 'Hóa đơn mới', kyKeKhai: '2026-Q4', ...o,
});

describe('locHoaDon', () => {
  it('tìm theo tên / MST / số hoá đơn; lọc hướng', () => {
    const ds = [hd('12', { tenDoiTac: 'CÔNG TY TNHH TM ĐẦU TƯ GIẢI PHÁP MỚI', tongTien: 11_000_000 }), hd('7', { huong: 'vao', tenDoiTac: 'GOOGLE ASIA', mstDoiTac: '0317860332' })];
    expect(locHoaDon(ds, { tim: 'giai phap moi' }).map((h) => h.soHd)).toEqual(['12']);
    expect(locHoaDon(ds, { tim: '0317860332' }).map((h) => h.soHd)).toEqual(['7']);
    expect(locHoaDon(ds, { huong: 'vao' }).map((h) => h.soHd)).toEqual(['7']);
  });
});
