import { describe, it, expect } from 'vitest';
import { tuDongCongThue } from './congThue.js';

// Dòng danh sách hoá đơn của cổng hoadondientu.gdt.gov.vn → hoá đơn (số giả).
describe('tuDongCongThue', () => {
  it('mua vào: đối tác là người bán; ngày lập giờ UTC đổi sang ngày VN; trạng thái theo mã tthai', () => {
    const h = tuDongCongThue(
      { khmshdon: 1, khhdon: 'C26TGG', shdon: 1001295, tdlap: '2026-03-31T17:00:00Z', nbmst: '0317860332', nbten: 'GOOGLE', tgtcthue: 5555556, tgtthue: 444444, tgtttbso: 6000000, tthai: 1 },
      'vao',
    );
    expect(h).toEqual(expect.objectContaining({ huong: 'vao', mauSo: '1', kyHieu: 'C26TGG', soHd: '1001295', ngay: '2026-04-01', mstDoiTac: '0317860332', tenDoiTac: 'GOOGLE', tienHang: 5555556, tienThue: 444444, tongTien: 6000000, trangThai: 'Hóa đơn mới', kyKeKhai: '2026-Q2' }));
  });
  it('bán ra: đối tác là người mua; thiếu tiền trước thuế thì lấy tổng − thuế; hoá đơn huỷ', () => {
    const h = tuDongCongThue({ khmshdon: '1', khhdon: 'C26TAA', shdon: '13', tdlap: '2026-04-01T00:00:00', nmmst: '0300000001', nmten: 'CÔNG TY A', tgtthue: 800000, tgtttbso: 10800000, tthai: 6 }, 'ra');
    expect(h).toEqual(expect.objectContaining({ huong: 'ra', mstDoiTac: '0300000001', tienHang: 10000000, trangThai: 'Hóa đơn đã bị hủy' }));
  });
  it('thiếu ký hiệu / số → bỏ', () => {
    expect(tuDongCongThue({ khhdon: '', shdon: 1, tdlap: '2026-04-01T00:00:00Z' }, 'vao')).toBeNull();
  });
});
