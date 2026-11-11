import { describe, it, expect } from 'vitest';
import { khoangNgay, nhomThoiGian, gopChiTiet } from './khoangNgay.js';

// Anh Tâm 11/11/2026: "Các chỉ số em cho phép xem theo ngày tuần tháng... như fb nhé". Hôm nay = thứ Tư 11/11/2026.
describe('khoangNgay — chọn khoảng như Trình quản lý quảng cáo', () => {
  const h = '2026-11-11';
  it('hôm nay / hôm qua / N ngày (không gồm hôm nay)', () => {
    expect(khoangNgay('hom_nay', h)).toEqual({ tu: '2026-11-11', den: '2026-11-11' });
    expect(khoangNgay('hom_qua', h)).toEqual({ tu: '2026-11-10', den: '2026-11-10' });
    expect(khoangNgay('7', h)).toEqual({ tu: '2026-11-04', den: '2026-11-10' });
    expect(khoangNgay('30', h)).toEqual({ tu: '2026-10-12', den: '2026-11-10' });
  });
  it('tuần (thứ Hai đầu tuần), tháng', () => {
    expect(khoangNgay('tuan_nay', h)).toEqual({ tu: '2026-11-09', den: '2026-11-11' });
    expect(khoangNgay('tuan_truoc', h)).toEqual({ tu: '2026-11-02', den: '2026-11-08' });
    expect(khoangNgay('thang_nay', h)).toEqual({ tu: '2026-11-01', den: '2026-11-11' });
    expect(khoangNgay('thang_truoc', h)).toEqual({ tu: '2026-10-01', den: '2026-10-31' });
  });
  it('tuỳ chọn: đúng định dạng, đảo nếu ngược, tối đa 400 ngày; sai thì về 7 ngày', () => {
    expect(khoangNgay('tuy_chon', h, '2026-10-05', '2026-10-01')).toEqual({ tu: '2026-10-01', den: '2026-10-05' });
    expect(khoangNgay('tuy_chon', h, 'x', '')).toEqual({ tu: '2026-11-04', den: '2026-11-10' });
    expect(khoangNgay('tuy_chon', h, '2020-01-01', '2026-11-10').tu).toBe('2025-10-07');
  });
});

describe('nhomThoiGian — chia theo ngày / tuần / tháng', () => {
  const ds = [
    { ngay: '2026-11-01', chiSo: { chi: 100, click: 10, hienThi: 100 } },
    { ngay: '2026-11-02', chiSo: { chi: 200, click: 20, hienThi: 100 } },
    { ngay: '2026-11-09', chiSo: { chi: 50, click: 5, hienThi: 50 } },
  ];
  it('tuần bắt đầu thứ Hai; nhãn khoảng ngày', () => {
    const r = nhomThoiGian(ds, 'tuan');
    expect(r.map((x) => [x.ky, x.nhan, x.chiSo.chi])).toEqual([
      ['2026-10-26', '26/10–01/11', 100],
      ['2026-11-02', '02/11–08/11', 200],
      ['2026-11-09', '09/11–15/11', 50],
    ]);
  });
  it('tháng cộng dồn, tính lại tỷ lệ', () => {
    const r = nhomThoiGian(ds, 'thang');
    expect(r).toHaveLength(1);
    expect(r[0]!.nhan).toBe('11/2026');
    expect(r[0]!.chiSo).toMatchObject({ chi: 350, click: 35, hienThi: 250, ctr: 0.14 });
  });
  it('ngày giữ nguyên, mới nhất trước', () => {
    expect(nhomThoiGian(ds, 'ngay').map((x) => x.nhan)).toEqual(['09/11', '02/11', '01/11']);
  });
});

describe('gopChiTiet — cộng chỉ số, tỷ lệ hiển thị bình quân theo hiển thị', () => {
  it('cộng tiền / click, tính lại CTR, CPC, CPA, ROAS; tỷ lệ hiển thị theo trọng số', () => {
    expect(
      gopChiTiet([
        { chi: 100, click: 10, hienThi: 100, chuyenDoi: 2, giaTriCD: 400, tyLeHienThi: 0.5 },
        { chi: 300, click: 30, hienThi: 300, chuyenDoi: 2, giaTriCD: 0, tyLeHienThi: 0.1 },
      ]),
    ).toMatchObject({ chi: 400, click: 40, hienThi: 400, ctr: 0.1, cpc: 10, chuyenDoi: 4, cpa: 100, roas: 1, tyLeHienThi: 0.2 });
  });
});
