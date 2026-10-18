import { describe, it, expect } from 'vitest';
import { laSaoKe, docSaoKe, khopDoiTac, tenRieng, loaiTienVao, soHoaDonTrongNoiDung, hoaDonCuaGiaoDich, tienMatSauChot, laGdLuong, thangLuong, doiChieuLuong, type GiaoDich } from './saoKe.js';
import { nhanDangBang, tinhCongNo, type SoCongNo, type HoaDon } from './keToan.js';

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
    // Anh Tâm 18/10/2026: "có tên cty mà sao k khớp được" — cụm riêng "tin dat", viết liền "TINDAT" đều nhận.
    expect(khopDoiTac('TIN DAT TT HD 15', ds)?.ma).toBe('KH008');
    expect(khopDoiTac('TINDAT THANH TOAN MKT T6.2026 HD 66', ds)?.ma).toBe('KH008');
    expect(khopDoiTac('CTY TU DONG TIN DAT CK', ds)?.ma).toBe('KH008');
    expect(khopDoiTac('NOP TIEN MST 0318749993', ds)?.ma).toBe('0318749993');
    expect(khopDoiTac('GOOGLE*ADS 12345', ds)?.ma).toBe('0317860332');
    expect(khopDoiTac('KHACH LE CK', ds)).toBeNull();
  });

  // Tên GIẢ, cùng kiểu với sao kê thật.
  const ds2 = [
    { ma: 'KH004', ten: 'CÔNG TY CỔ PHẦN NHÂN LỰC SAPHIRA' },
    { ma: '0300000001', ten: 'CÔNG TY CỔ PHẦN NHÂN LỰC SAPHIRA', mst: '0300000001' }, // cùng công ty, mã khác (sổ + hoá đơn)
    { ma: '0300000002', ten: 'CÔNG TY TNHH MỘT THÀNH VIÊN MỘC LINH ĐƯỜNG', mst: '0300000002' },
    { ma: '0300000003', ten: 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ & GIẢI TRÍ MT GROUP', mst: '0300000003' },
    { ma: '0300000004', ten: 'CÔNG TY TNHH THƯƠNG MẠI QUỐC TẾ MỘC ĐỨC', mst: '0300000004' },
    { ma: '0300000005', ten: 'HỘ KINH DOANH QUỐC PHONG HAIR SALON', mst: '0300000005' },
    { ma: '0300000006', ten: 'CÔNG TY TNHH TMDV MIRAKO VIỆT NAM', mst: '0300000006' },
  ];
  it('tên thương hiệu một từ, chữ bị ngân hàng ngắt dòng, cụm "mt group"; một tiếng Việt đơn không đủ', () => {
    expect(khopDoiTac('Saphira thanh toan chi phi quang cao Google thang 6 theo HD 04 2024', ds2)?.ten).toContain('SAPHIRA');
    expect(khopDoiTac('CONG TY TNHH MOT THANH VIEN MOC LIN H DUONG CK PHI QC GG MAP', ds2)?.ma).toBe('0300000002');
    expect(khopDoiTac('MT GROUP thanh toan lan 1 dich vu S EO theo HD 1508', ds2)?.ma).toBe('0300000003');
    expect(khopDoiTac('IBBIZ.IBPS.CTY MOC DUC TH ANH TOAN PHONG MARKETING THUE NGOAI', ds2)?.ma).toBe('0300000004');
    expect(khopDoiTac('Mirako tt phi chay qc gg', ds2)?.ma).toBe('0300000006');
    // "PHONG MARKETING" không được nhầm thành "Quốc Phong"; "MT DIGITAL" không nhầm "MT GROUP".
    expect(khopDoiTac('THANH TOAN PHONG MARKETING THUE NGOAI CHO CTY MT DIGITAL', ds2)).toBeNull();
    // Cột tên bên chuyển của sao kê ghép vào nội dung.
    expect(khopDoiTac('CONG TY TNHH TMDV MIRAKO VIET NAM Jan ck MT Digital viet phan mem', ds2)?.ma).toBe('0300000006');
  });
  it('tiền vào không phải khách trả; số hoá đơn trong nội dung', () => {
    expect(loaiTienVao({ noiDung: 'Tra lai tien gui, so TK: #-20260718', doiTac: '' })).toBe('lai');
    expect(loaiTienVao({ noiDung: 'RetailVISADN-139137-2500000-VND-615 #-MM GOOGLE ADWS-The 5911', doiTac: '' })).toBe('hoan_the');
    expect(loaiTienVao({ noiDung: 'chuyen tien', doiTac: 'CONG TY TNHH DICH VU MT DIGITAL' })).toBe('noi_bo');
    expect(loaiTienVao({ noiDung: 'MT GROUP thanh toan', doiTac: 'CONG TY TNHH MT GROUP' })).toBe('khach');
    expect(soHoaDonTrongNoiDung('TINDAT THANH TOAN CP HD 115')).toEqual(['115']);
    expect(soHoaDonTrongNoiDung('Thanh toan tien dich vu theo HD85 0 3 1 8')).toEqual(['85']);
    expect(soHoaDonTrongNoiDung('TT PHI DICH VU HĐ SỐ 0121')).toEqual(['121']);
    expect(soHoaDonTrongNoiDung('KHACH LE CK')).toEqual([]);
  });
});

describe('sao kê MB có cột tên đơn vị chuyển / thụ hưởng', () => {
  const MB = [
    {
      ten: 'Sheet1',
      rows: [
        ['Tài khoản', '/Account No:', '0123456789'],
        ['STT', 'NGÀY GIAO DỊCH', 'NGÀY HẠCH TOÁN', 'PHÁT SINH NỢ', 'PHÁT SINH CÓ', 'SỐ DƯ', 'ĐƠN VỊ THỤ HƯỞNG/ĐƠN VỊ CHUYỂN', 'NỘI DUNG', 'BÚT TOÁN'],
        ['1', '17/10/2026 09:11:28', '17/10/2026', '', '7,560,000', '57,560,000', 'CONG TY TNHH MIRAKO', 'CHUYEN TIEN QUANG CAO THANG 10', 'FT1'],
      ],
    },
  ];
  it('đọc tên bên chuyển; khoá giao dịch không đổi so với khi chưa đọc cột này (tải lại không nhân đôi)', () => {
    const r = docSaoKe(MB, 'Bang ket qua giao dich - 0123456789.xlsx')!;
    expect(r.giaoDich[0]).toMatchObject({ ghiCo: 7_560_000, doiTac: 'CONG TY TNHH MIRAKO', noiDung: 'CHUYEN TIEN QUANG CAO THANG 10' });
    const khongCot = docSaoKe([{ ten: 'Sheet1', rows: MB[0]!.rows.map((x) => x.map((o, j) => (j === 6 ? (o.startsWith('ĐƠN') ? 'GHI CHÚ' : '') : o))) }], 'Bang ket qua giao dich - 0123456789.xlsx')!;
    expect(khongCot.giaoDich[0]!.id).toBe(r.giaoDich[0]!.id);
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

describe('khớp tiền theo số hoá đơn; hoá đơn trả tiền mặt', () => {
  const hd = (soHd: string, ngay: string, tongTien: number, mst: string, huong: 'ra' | 'vao' = 'ra', thanhToan = ''): HoaDon => ({
    huong, mauSo: '1', kyHieu: 'C26TAA', soHd, ngay, mstDoiTac: mst, tenDoiTac: `CÔNG TY ${mst}`, dienGiai: '',
    tienHang: tongTien, tienThue: 0, tongTien, thueSuat: '', trangThai: '', kyKeKhai: '', thanhToan,
  });
  const ra = [hd('115', '2026-09-20', 12_960_000, '0300000011'), hd('116', '2026-09-25', 10_000_000, '0300000012'), hd('0121', '2026-10-01', 5_400_000, '0300000013')];
  it('số hoá đơn trong nội dung + đúng tiền; trả một phần; chỉ khớp theo tiền khi hoá đơn trong 10 ngày', () => {
    expect(hoaDonCuaGiaoDich({ ngay: '2026-10-05', noiDung: 'TT CP HD 115' }, 12_960_000, ra)?.soHd).toBe('115');
    expect(hoaDonCuaGiaoDich({ ngay: '2026-10-05', noiDung: 'TT PHI DICH VU HD SO 121' }, 2_000_000, ra)?.soHd).toBe('0121'); // trả một phần
    expect(hoaDonCuaGiaoDich({ ngay: '2026-10-05', noiDung: 'thanh toan' }, 5_400_000, ra)?.soHd).toBe('0121');
    expect(hoaDonCuaGiaoDich({ ngay: '2026-10-20', noiDung: 'thanh toan' }, 10_000_000, ra)).toBeNull(); // hoá đơn quá 10 ngày
    expect(hoaDonCuaGiaoDich({ ngay: '2026-09-10', noiDung: 'TT CP HD 115' }, 12_960_000, ra)).toBeNull(); // hoá đơn lập SAU ngày tiền về
  });
  it('dưới 5 triệu không thấy chuyển khoản → coi là tiền mặt; anh đánh dấu thì theo anh', () => {
    const vao = [
      hd('1', '2026-07-05', 1_200_000, '0300000021', 'vao'),
      hd('2', '2026-07-06', 3_000_000, '0300000022', 'vao'), // nhà cung cấp này có chuyển khoản sau chốt → để sao kê trừ
      hd('3', '2026-07-07', 8_000_000, '0300000023', 'vao', 'tien_mat'),
      hd('4', '2026-07-08', 900_000, '0300000024', 'vao', 'ngan_hang'),
      hd('5', '2026-07-09', 7_000_000, '0300000025', 'vao'),
      hd('6', '2026-06-01', 1_000_000, '0300000026', 'vao'), // trước ngày chốt — đã có trong sổ
    ];
    const tm = tienMatSauChot(vao, '2026-06-30', [{ mst: '0300000022', ten: 'X', soTien: 3_000_000 }]);
    expect(tm.map((t) => [t.mst, t.soTien, t.tienMat])).toEqual([
      ['0300000021', 1_200_000, true],
      ['0300000023', 8_000_000, true],
    ]);
    // Công nợ phải trả: hoá đơn sau chốt − tiền mặt.
    const r = tinhCongNo(null, vao, 'tra', tm);
    expect(r.ds).toEqual([]); // chưa có sổ → không có ngày chốt → không tính phát sinh sau chốt
    const so: SoCongNo = { loai: 'tra', tuNgay: '2026-01-01', ngayChot: '2026-06-30', dong: [] };
    const r2 = tinhCongNo(so, vao, 'tra', tm);
    expect(r2.ds.find((x) => x.ma === '0300000021')).toBeUndefined(); // trả đủ tiền mặt → hết nợ
    expect(r2.ds.find((x) => x.ma === '0300000025')).toMatchObject({ hoaDonSau: 7_000_000, tienMatSau: 0, tong: 7_000_000 });
  });
});

describe('đối chiếu chuyển khoản lương với bảng lương', () => {
  const g = (ngay: string, ghiNo: number, noiDung: string, doiTac = ''): GiaoDich => ({ id: `${ngay}${ghiNo}${doiTac}`, soTk: '', nganHang: '', ngay, ghiNo, ghiCo: 0, soDu: 0, noiDung, soRef: '', doiTac, thuTu: 0 });
  it('nhận khoản trả lương và tháng lương (kể cả chữ bị ngắt dòng, không ghi tháng)', () => {
    expect(laGdLuong(g('2026-10-05', 9_000_000, 'MT Digital thanh toan luong la n 2 thang 9 nam 2026'))).toBe(true);
    expect(laGdLuong(g('2026-09-05', 1_285_714, 'MT digital thanh toan luong thuc ta p sinh'))).toBe(true);
    expect(laGdLuong(g('2026-09-05', 5_000_000, 'Thanh toan tien quang cao Google'))).toBe(false);
    expect(thangLuong(g('2026-02-05', 1, 'thanh toan luong dot 2 t hang 1 nam 2026'))).toEqual({ thang: '2026-01', ro: true });
    expect(thangLuong(g('2026-03-05', 1, 'MBCT thanh toan luong th ang 2 dot 2 D2LCV9KL/122240'))).toEqual({ thang: '2026-02', ro: true });
    expect(thangLuong(g('2026-09-05', 1, 'thanh toan luong thuc tap sinh'))).toEqual({ thang: '2026-08', ro: false }); // trả ngày 5 → tháng trước
    expect(thangLuong(g('2026-01-05', 1, 'thanh toan luong thang 12'))).toEqual({ thang: '2025-12', ro: true });
  });
  it('khớp theo tên người nhận, theo số tiền; báo lệch / thiếu / thừa', () => {
    const nv = [
      { thang: '2026-09', ten: 'Nguyễn Văn An', chuyenKhoan: 9_170_000, tongThuNhap: 13_000_000, thucNhan: 12_370_000, tienMat: 3_200_000 },
      { thang: '2026-09', ten: 'Trần Thị Bình', chuyenKhoan: 8_000_000, tongThuNhap: 12_000_000, thucNhan: 11_000_000, tienMat: 3_000_000 },
      { thang: '2026-09', ten: 'Lê Văn Cường', chuyenKhoan: 7_000_000, tongThuNhap: 10_000_000, thucNhan: 10_000_000, tienMat: 3_000_000 },
      { thang: '2026-09', ten: 'Phạm Dũng', chuyenKhoan: 0, tongThuNhap: 5_000_000, thucNhan: 5_000_000, tienMat: 5_000_000 }, // trả hết tiền mặt
    ];
    const gd = [
      g('2026-10-05', 9_233_000, 'thanh toan luong lan 2 thang 9 nam 2026', 'NGUYEN VAN AN'), // dư 63.000
      g('2026-10-05', 8_000_000, 'thanh toan luong lan 2 thang 9 nam 2026'), // không có tên → khớp theo số tiền
      g('2026-10-05', 2_000_000, 'thanh toan luong lan 2 thang 9 nam 2026', 'HOANG THI E'), // không có trong file
      g('2026-09-05', 7_000_000, 'thanh toan luong thang 8 lan 2', 'LE VAN CUONG'), // lương tháng 8 — không ghép sang tháng 9
    ];
    const [k] = doiChieuLuong(nv, gd);
    expect(k).toMatchObject({ thang: '2026-09', ckFile: 24_170_000, tienMat: 14_200_000, soKhop: 1, ckNganHang: 19_233_000 });
    expect(k!.lech).toEqual([expect.objectContaining({ ten: 'Nguyễn Văn An', file: 9_170_000, nganHang: 9_233_000 })]);
    expect(k!.thieu).toEqual([{ ten: 'Lê Văn Cường', soTien: 7_000_000 }]);
    expect(k!.thua.map((x) => x.soTien)).toEqual([2_000_000]);
  });
});
