import { describe, it, expect } from 'vitest';
import { tuDongCongThue, urlTraCuu } from './congThue.js';

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

// Anh Tâm 8/11/2026: cổng báo "Required request parameter 'ckey'…" — từ nay tra hoá đơn MÁY TÍNH TIỀN (sco-query) phải kèm
// captcha (ckey + cvalue trên đường dẫn, như trang cổng gửi); hoá đơn thường (query) không cần.
describe('urlTraCuu', () => {
  it('hoá đơn thường: không kèm captcha; khoảng ngày cả tháng, trang tiếp theo state', () => {
    const u = urlTraCuu('query', 'vao', '2026-02', 'abc');
    expect(u).toBe('https://hoadondientu.gdt.gov.vn/api/query/invoices/purchase?sort=tdlap:desc&size=50&state=abc&search=tdlap=ge=01/02/2026T00:00:00;tdlap=le=28/02/2026T23:59:59');
  });
  it('máy tính tiền: kèm ckey + cvalue (mã hoá đường dẫn)', () => {
    const u = urlTraCuu('sco-query', 'ra', '2026-10', '', { ckey: 'k/1+', cvalue: 'aB3d' });
    expect(u).toContain('/api/sco-query/invoices/sold?');
    expect(u).toContain('&ckey=k%2F1%2B&cvalue=aB3d');
  });
});
