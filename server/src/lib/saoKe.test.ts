import { describe, it, expect } from 'vitest';
import { laSaoKe, docSaoKe, khopDoiTac, tenRieng } from './saoKe.js';
import { nhanDangBang, tinhCongNo, type SoCongNo } from './keToan.js';

// Anh Tâm 18/10/2026: "1 phần tải sao kê ngân hàng lên nữa là đủ". Số liệu dưới đây là SỐ GIẢ.

// Kiểu 1: hai cột Ghi nợ / Ghi có, song ngữ, xếp mới → cũ (như nhiều ngân hàng).
const SAO_KE_HAI_COT = [
  {
    ten: 'Sheet1',
    rows: [
      ['NGÂN HÀNG TMCP QUÂN ĐỘI - MB BANK'],
      ['SAO KÊ TÀI KHOẢN / ACCOUNT STATEMENT'],
      ['Số tài khoản/Account No: 0123 4567 89012', '', 'Tên tài khoản: CONG TY TNHH DICH VU MT DIGITAL'],
      ['Ngày giao dịch/Transaction date', 'Số bút toán/Reference', 'Ghi nợ/Debit', 'Ghi có/Credit', 'Số dư/Balance', 'Diễn giải/Description'],
      ['Số dư đầu kỳ', '', '', '', '10.000.000', ''],
      ['05/07/2026 10:20:11', 'FT2607', '2.000.000', '', '48.000.000', 'MT DIGITAL TT TIEN QUANG CAO GOOGLE ADS'],
      ['03/07/2026 09:00:00', 'FT2606', '', '40.000.000', '50.000.000', 'THANH DOAN TP HCM CHUYEN TIEN THANH TOAN HD 25'],
      ['02/07/2026 08:00:00', 'FT2605', '', '1.000.000', '10.000.000', 'KHACH LE CK'],
      ['', '', 'Tổng cộng', '', '', ''],
    ],
  },
];

// Kiểu 2: một cột số tiền có dấu (+/-), tiếng Việt, cũ → mới.
const SAO_KE_MOT_COT = [
  {
    ten: 'LichSuGD',
    rows: [
      ['LỊCH SỬ GIAO DỊCH - ACB'],
      ['Tài khoản số: 99887766'],
      ['Ngày hiệu lực', 'Số giao dịch', 'Mô tả', 'Số tiền', 'Số dư'],
      ['01/08/2026', 'A1', 'CTY SKIN JUVIA TT PHI MARKETING T7', '+10,440,000', '10,440,000'],
      ['02/08/2026', 'A2', 'PHI QUAN LY TAI KHOAN', '-11,000', '10,429,000'],
    ],
  },
];

describe('đọc sao kê', () => {
  it('kiểu 2 cột Nợ/Có song ngữ: nhận dạng, ngân hàng, số TK, giao dịch; bỏ dòng số dư đầu kỳ / tổng; thứ tự muộn hơn = lớn hơn', () => {
    expect(nhanDangBang(SAO_KE_HAI_COT)).toBeNull(); // không nhầm thành bảng kê / công nợ
    expect(laSaoKe(SAO_KE_HAI_COT)).toBe(true);
    const r = docSaoKe(SAO_KE_HAI_COT, 'saoke.xlsx')!;
    expect(r).toMatchObject({ nganHang: 'MB', soTk: '0123456789012', boQua: 0 });
    expect(r.giaoDich.map((g) => [g.ngay, g.ghiNo, g.ghiCo, g.soDu, g.soRef])).toEqual([
      ['2026-07-05', 2000000, 0, 48000000, 'FT2607'],
      ['2026-07-03', 0, 40000000, 50000000, 'FT2606'],
      ['2026-07-02', 0, 1000000, 10000000, 'FT2605'],
    ]);
    expect(r.giaoDich.map((g) => g.thuTu)).toEqual([2, 1, 0]);
    // Tải lại cùng file → cùng khoá (không nhân đôi).
    expect(docSaoKe(SAO_KE_HAI_COT)!.giaoDich.map((g) => g.id)).toEqual(r.giaoDich.map((g) => g.id).map((x) => x));
  });
  it('kiểu một cột số tiền có dấu', () => {
    expect(laSaoKe(SAO_KE_MOT_COT)).toBe(true);
    const r = docSaoKe(SAO_KE_MOT_COT)!;
    expect(r).toMatchObject({ nganHang: 'ACB', soTk: '99887766' });
    expect(r.giaoDich.map((g) => [g.ghiNo, g.ghiCo])).toEqual([
      [0, 10440000],
      [11000, 0],
    ]);
  });
  it('bảng không phải sao kê → không nhận', () => {
    expect(laSaoKe([{ ten: 'x', rows: [['Họ tên', 'Ngày sinh'], ['A', '01/01/2000']] }])).toBe(false);
  });
});

describe('khớp đối tác theo nội dung chuyển khoản', () => {
  const ds = [
    { ma: '0307414272', ten: 'Thành Đoàn TP.HCM' },
    { ma: '0318749993', ten: 'CÔNG TY TNHH SKIN JUVIA' },
    { ma: 'KH008', ten: 'CÔNG TY TNHH KỸ THUẬT TỰ ĐỘNG TÍN ĐẠT' },
    { ma: '0317860332', ten: 'CÔNG TY TNHH GOOGLE VIỆT NAM' },
  ];
  it('bỏ phần chung "Công ty TNHH…" khi so tên', () => {
    expect(tenRieng('CÔNG TY TNHH KỸ THUẬT TỰ ĐỘNG TÍN ĐẠT')).toBe('tu dong tin dat');
    expect(tenRieng('CÔNG TY TNHH GOOGLE VIỆT NAM')).toBe('google');
  });
  it('khớp theo tên riêng, theo MST trong nội dung; không khớp thì null', () => {
    expect(khopDoiTac('THANH DOAN TP HCM CHUYEN TIEN THANH TOAN', ds)?.ma).toBe('0307414272');
    expect(khopDoiTac('CTY SKIN JUVIA TT PHI MARKETING T7', ds)?.ma).toBe('0318749993');
    expect(khopDoiTac('TIN DAT TT HD 15', ds)).toBeNull(); // "tin dat" chỉ là một phần, chưa đủ chắc
    expect(khopDoiTac('CTY TU DONG TIN DAT CK', ds)?.ma).toBe('KH008');
    expect(khopDoiTac('NOP TIEN MST 0318749993', ds)?.ma).toBe('0318749993');
    expect(khopDoiTac('GOOGLE*ADS 12345', ds)?.ma).toBe('0317860332');
    expect(khopDoiTac('KHACH LE CK', ds)).toBeNull();
  });
});

describe('công nợ trừ tiền đã thu sau ngày chốt', () => {
  it('số dư sổ + hoá đơn sau chốt − tiền đã thu sau chốt', () => {
    const so: SoCongNo = {
      loai: 'thu',
      tuNgay: '2026-01-01',
      ngayChot: '2026-06-30',
      dong: [{ ma: '0307414272', ten: 'Thành Đoàn TP.HCM', duNoDau: 0, duCoDau: 0, psNo: 40_000_000, psCo: 0, duNo: 40_000_000, duCo: 0 }],
    };
    const r = tinhCongNo(so, [], 'thu', [{ mst: '0307414272', ten: 'Thành Đoàn TP.HCM', soTien: 40_000_000 }]);
    expect(r.ds).toEqual([]); // đã thu đủ → hết nợ
    expect(r.tong).toBe(0);
    const r2 = tinhCongNo(so, [], 'thu', [{ mst: '', ten: 'THÀNH ĐOÀN TP.HCM', soTien: 15_000_000 }]);
    expect(r2.ds[0]).toMatchObject({ ma: '0307414272', soDu: 40_000_000, thanhToanSau: 15_000_000, tong: 25_000_000 });
  });
});
