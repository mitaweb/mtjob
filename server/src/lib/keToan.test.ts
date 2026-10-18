import { describe, it, expect } from 'vitest';
import {
  soTien,
  ngayISO,
  quyCuaNgay,
  nhanDangBang,
  docBangKe,
  docCongNo,
  docKqkd,
  nhanDangXml,
  docHoaDonXml,
  docToKhaiGtgt,
  tinhVatTheoQuy,
  tinhTndn,
  tinhCongNo,
  hanNopVat,
  thueSuatTndn,
  hoaDonHieuLuc,
  type HoaDon,
  type ToKhaiGtgt,
} from './keToan.js';

// Anh Tâm 18/10/2026: "update hóa đơn, update con số để nắm được chỉ số quan trọng: Thuế VAT cần đóng, Thuế TNDN cần
// đóng, 3 năm 2024, 2025, 2026 anh được miễn thuế TNDN. Và công nợ các bên". Số liệu dưới đây là SỐ GIẢ.

describe('chuẩn hoá số / ngày', () => {
  it('đọc số tiền nhiều kiểu', () => {
    expect(soTien('590,637,038.00')).toBe(590637038);
    expect(soTien(' 54,972,000 ')).toBe(54972000);
    expect(soTien('6.000.000')).toBe(6000000);
    expect(soTien('(1,000)')).toBe(-1000);
    expect(soTien(' -   ')).toBe(0);
    expect(soTien('-10214141')).toBe(-10214141);
    expect(soTien(1234.4)).toBe(1234);
  });
  it('ngày và quý', () => {
    expect(ngayISO('01/04/2026')).toBe('2026-04-01');
    expect(ngayISO(' 8/1/2025 ')).toBe('2025-01-08');
    expect(ngayISO('2025-07-01')).toBe('2025-07-01');
    expect(quyCuaNgay('2026-06-30')).toBe('2026-Q2');
    expect(hanNopVat('2026-Q2')).toBe('2026-07-31');
    expect(hanNopVat('2025-Q4')).toBe('2026-01-31');
  });
});

const BANG_KE_MOI = [
  {
    ten: 'BAN RA',
    rows: [
      ['BẢNG KÊ CHI TIẾT HÓA ĐƠN CHỨNG TỪ'],
      ['Năm 2026'],
      ['STT', 'Loại hoá đơn/tờ khai', 'Ký hiệu mẫu số', 'Ký hiệu hoá đơn', 'Số hoá đơn', 'Ngày hóa đơn', 'Mã số thuế', 'Tên Khách hàng', 'Địa chỉ', 'Diễn giải', 'HOÁ ĐƠN', '', '', '', 'Tình trạng hoá đơn', 'KÌ KÊ KHAI THỰC TẾ'],
      ['STT', 'Loại hoá đơn/tờ khai', 'Ký hiệu mẫu số', 'Ký hiệu hoá đơn', 'Số hoá đơn', 'Ngày hóa đơn', 'Mã số thuế', 'Tên Khách hàng', 'Địa chỉ', 'Diễn giải', 'Giá trị HHDV chưa gồm thuế', 'Tiền thuế GTGT', 'Tổng tiền', 'Thuế suất GTGT', 'Tình trạng hoá đơn', 'Năm', 'Tháng/Quý'],
      ['', '', '', '', '', 'TỔNG CỘNG', '', '', '', '', '30,000,000.00', '2,400,000.00', '32,400,000.00', 'x'],
      ['1', 'Hoá đơn GTGT', '1', 'C26TAA', '13', '01/04/2026', '0300000001', 'CÔNG TY A', 'x', 'Quảng cáo', '10,000,000.00', '800,000.00', '10,800,000.00', '8', 'Hóa đơn mới', '2026', 'Quý 2'],
      ['2', 'Hoá đơn GTGT', '1', 'C26TAA', '14', '30/06/2026', '0300000002', 'CÔNG TY B', 'x', 'Website', '20,000,000.00', '1,600,000.00', '21,600,000.00', '8', 'Hóa đơn mới', '2026', 'Quý 3'],
      ['3', 'Hoá đơn GTGT', '1', 'C26TAA', '15', '30/06/2026', '0300000002', 'CÔNG TY B', 'x', 'Huỷ', '5,000,000.00', '400,000.00', '5,400,000.00', '8', 'Hóa đơn bị hủy', '2026', 'Quý 2'],
    ],
  },
  {
    ten: 'MUA VAO',
    rows: [
      ['BẢNG KÊ CHI TIẾT HÓA ĐƠN CHỨNG TỪ'],
      ['STT', 'Loại hoá đơn/tờ khai', 'Ký hiệu mẫu số', 'Ký hiệu hóa đơn', 'Số hóa đơn', 'Ngày hóa đơn', 'MST người bán', 'Tên người bán', 'Địa chỉ', 'Diễn giải', 'Tổng tiền chưa VAT/ Giá trị', 'Tiền thuế GTGT', 'Tổng tiền', 'Thuế suất', 'Tình trạng hoá đơn', 'Năm', 'Tháng/Quý'],
      // Một hoá đơn hai dòng (hai thuế suất) → cộng dồn thành một.
      ['3', 'Hoá đơn GTGT', '1', 'C26TAA', '9406', '06/04/2026', '0111322034-011', 'Đăng kiểm', 'x', 'Kiểm định', '46,000', '3,680', '49,680', '8', 'Hóa đơn mới', '2026', 'Quý 2'],
      ['3', 'Hoá đơn GTGT', '1', 'C26TAA', '9406', '06/04/2026', '0111322034-011', 'Đăng kiểm', 'x', 'Lệ phí', '40,000', '-', '40,000', '0', 'Hóa đơn mới', '2026', 'Quý 2'],
      ['5', 'Hoá đơn GTGT', '1', 'C26TGG', '1001295', '01/04/2026', '0317860332', 'GOOGLE', 'x', 'Ads', '5,555,556', '444,444', '6,000,000', '8', 'Hóa đơn mới', '2026', 'Quý 2'],
    ],
  },
];

// Mẫu cũ: tiêu đề 2 dòng, "Column1" thay ký hiệu, mẫu số dính ký hiệu, có cột "Tiền thuế xuất khẩu" trước VAT.
const BANG_KE_CU = [
  {
    ten: 'BR',
    rows: [
      ['BẢNG KÊ CHI TIẾT HÓA ĐƠN CHỨNG TỪ'],
      ['Quý 03/2025'],
      ['STT', 'Loại hoá đơn/tờ khai', 'Ký hiệu hoá đơn', 'Số hoá đơn', 'Ngày hóa đơn', 'Mã số thuế', 'Tên Khách hàng', 'Địa chỉ', 'Diễn giải', 'HOÁ ĐƠN', '', '', '', '', '', 'Tình trạng hoá đơn', 'KÌ KÊ KHAI THỰC TẾ', ''],
      ['STT', 'Loại hoá đơn/tờ khai', 'Column1', 'Số hoá đơn', 'Ngày hóa đơn', 'Mã số thuế', 'Tên Khách hàng', 'Địa chỉ', 'Diễn giải', ' Giá trị HHDV chưa gồm thuế ', ' Tiền thuế xuất khẩu ', ' Tiền thuế GTGT ', ' Tổng tiền ', 'Thuế suất GTGT', 'Ghi chú', 'Tình trạng hoá đơn', 'Năm', 'Tháng/Quý'],
      ['', '', '', '', 'TỔNG CỘNG', '', '', '', '', ' 5,000,000.00 ', ' -   ', ' 400,000.00 ', ' 5,400,000.00 ', 'x'],
      ['1', 'Hoá đơn GTGT', '1C25TMD', '1', '07/01/2025', '0300000001', 'CÔNG TY A', 'x', 'QC', ' 5,000,000.00 ', ' -   ', ' 400,000.00 ', ' 5,400,000.00 ', '8', '', 'Hóa đơn mới', '2025', 'Quý 1'],
    ],
  },
];

describe('bảng kê MV-BR', () => {
  it('mẫu mới: nhận dạng, đọc đúng hướng / kỳ kê khai thực tế, cộng dồn hoá đơn nhiều dòng, giữ HĐ huỷ nhưng không tính', () => {
    expect(nhanDangBang(BANG_KE_MOI)).toBe('bang_ke');
    const { hoaDon, boQua } = docBangKe(BANG_KE_MOI);
    expect(boQua).toBe(0);
    const ra = hoaDon.filter((h) => h.huong === 'ra');
    expect(ra.map((h) => [h.soHd, h.kyKeKhai, h.tienThue])).toEqual([
      ['13', '2026-Q2', 800000],
      ['14', '2026-Q3', 1600000], // kế toán kê sang quý 3
      ['15', '2026-Q2', 400000],
    ]);
    expect(hoaDonHieuLuc(ra[2]!.trangThai)).toBe(false);
    const dk = hoaDon.find((h) => h.soHd === '9406')!;
    expect(dk).toMatchObject({ huong: 'vao', tienHang: 86000, tienThue: 3680, tongTien: 89680, thueSuat: '8,0', mstDoiTac: '0111322034-011' });
    expect(hoaDon.filter((h) => h.huong === 'vao')).toHaveLength(2);
  });
  it('mẫu cũ: tiêu đề 2 dòng, tách mẫu số khỏi ký hiệu, lấy đúng cột thuế GTGT (không phải thuế xuất khẩu)', () => {
    const { hoaDon } = docBangKe(BANG_KE_CU);
    expect(hoaDon).toEqual([
      expect.objectContaining({ huong: 'ra', mauSo: '1', kyHieu: 'C25TMD', soHd: '1', ngay: '2025-01-07', tienHang: 5000000, tienThue: 400000, kyKeKhai: '2025-Q1' }),
    ]);
  });
});

describe('công nợ & báo cáo KQKD', () => {
  const CONG_NO = [
    {
      ten: 'Báo cáo',
      rows: [
        ['TỔNG HỢP CÔNG NỢ PHẢI THU'],
        ['Tài khoản: 131; Loại tiền: Tổng hợp; Từ ngày 01/01/2026 đến ngày 30/6/2026'],
        ['Mã khách hàng', 'Tên khách hàng', 'TK công nợ', 'Số dư đầu kỳ', '', 'Số phát sinh', '', 'Số dư cuối kỳ'],
        ['', '', '', 'Nợ', 'Có', 'Nợ', 'Có', 'Nợ', 'Có'],
        ['0300000001', 'CÔNG TY A', '131', '0 ', '0 ', '40,000,000 ', '0 ', '40,000,000 ', '0 '],
        ['KH002', 'CÔNG TY B', '131', '0', '0', '0', '2,200,000', '0', '2,200,000'],
        ['Số dòng = 2', '40,000,000', '2,200,000'],
      ],
    },
  ];
  it('tổng hợp công nợ 131: ngày chốt, số dư từng bên, bỏ dòng tổng', () => {
    expect(nhanDangBang(CONG_NO)).toBe('cong_no_thu');
    const so = docCongNo(CONG_NO, 'thu')!;
    expect(so).toMatchObject({ tuNgay: '2026-01-01', ngayChot: '2026-06-30' });
    expect(so.dong.map((d) => [d.ma, d.duNo, d.duCo])).toEqual([
      ['0300000001', 40000000, 0],
      ['KH002', 0, 2200000],
    ]);
  });
  it('công nợ = số dư sổ + hoá đơn sau ngày chốt (khớp MST, hoặc tên khi sổ dùng mã nội bộ)', () => {
    const so = docCongNo(CONG_NO, 'thu')!;
    const hd = (o: Partial<HoaDon>): HoaDon => ({
      huong: 'ra', mauSo: '1', kyHieu: 'C26TAA', soHd: '1', ngay: '2026-07-05', mstDoiTac: '', tenDoiTac: '', dienGiai: '',
      tienHang: 0, tienThue: 0, tongTien: 0, thueSuat: '8', trangThai: 'Hóa đơn mới', kyKeKhai: '2026-Q3', ...o,
    });
    const r = tinhCongNo(so, [
      hd({ mstDoiTac: '0300000001', tenDoiTac: 'CÔNG TY A', tongTien: 10_800_000 }),
      hd({ soHd: '2', mstDoiTac: '0399999999', tenDoiTac: 'Công ty B', tongTien: 5_400_000 }),
      hd({ soHd: '3', ngay: '2026-06-01', mstDoiTac: '0300000001', tongTien: 999 }), // trước ngày chốt — đã có trong sổ
      hd({ soHd: '4', huong: 'vao', mstDoiTac: '0300000001', tongTien: 777 }), // mua vào — không phải phải thu
    ], 'thu');
    expect(r.ngayChot).toBe('2026-06-30');
    expect(r.ds.map((x) => [x.ma, x.soDu, x.hoaDonSau, x.tong])).toEqual([
      ['0300000001', 40000000, 10800000, 50800000],
      ['KH002', -2200000, 5400000, 3200000],
    ]);
    expect(r).toMatchObject({ tong: 54000000, phai: 54000000, truoc: 0 });
    // Chỉ số dư sổ: khách B đang trả trước 2,2 triệu.
    expect(tinhCongNo(so, [], 'thu')).toMatchObject({ phai: 40000000, truoc: 2200000, tong: 37800000 });
  });
  it('KQKD: kỳ theo "Kỳ kế toán", không dính ngày của dòng Thông tư; lấy cột Kỳ này theo mã số', () => {
    const sh = [
      {
        ten: 'Page 1',
        rows: [
          ['Mẫu số: B02-DN'],
          ['(Kèm theo Thông tư số 99/2025/TT-BTC ngày 27 tháng 10 năm 2025 của Bộ trưởng Bộ Tài chính)'],
          ['BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH'],
          ['Kỳ kế toán Tháng 6 năm 2026'],
          ['Chỉ tiêu', '', 'Mã số', 'Thuyết minh', 'Kỳ này', 'Kỳ trước'],
          ['1. Doanh thu bán hàng', '', '01', 'VII.1', '140,300,000', '100'],
          ['14. Tổng lợi nhuận kế toán trước thuế', '', '50', '', '(63,050,068)', '5'],
        ],
      },
    ];
    expect(nhanDangBang(sh)).toBe('kqkd');
    expect(docKqkd(sh)).toEqual({ tuNgay: '2026-06-01', denNgay: '2026-06-30', chiTieu: { '01': 140300000, '50': -63050068 } });
  });
});

describe('XML hoá đơn & tờ khai', () => {
  const HD = `<?xml version="1.0"?><HDon><DLHDon><TTChung><KHMSHDon>1</KHMSHDon><KHHDon>C25TMD</KHHDon><SHDon>48</SHDon><NLap>2025-07-01</NLap></TTChung>
    <NDHDon><NBan><Ten>CÔNG TY MÌNH</Ten><MST>0311111111</MST></NBan><NMua><Ten>KHÁCH X</Ten><MST>0322222222</MST></NMua>
    <DSHHDVu><HHDVu><THHDVu>Quản lý quảng cáo</THHDVu><TSuat>8%</TSuat></HHDVu></DSHHDVu>
    <TToan><TgTCThue>72000000</TgTCThue><TgTThue>5760000</TgTThue><TgTTTBSo>77760000</TgTTTBSo></TToan></NDHDon></DLHDon></HDon>`;
  it('hoá đơn TT78: mình là người bán → bán ra, đối tác là người mua', () => {
    expect(nhanDangXml(HD)).toBe('hoa_don');
    expect(docHoaDonXml(HD, '0311111111')).toEqual(
      expect.objectContaining({ huong: 'ra', kyHieu: 'C25TMD', soHd: '48', mstDoiTac: '0322222222', tenDoiTac: 'KHÁCH X', tienThue: 5760000, thueSuat: '8', kyKeKhai: '2025-Q3' }),
    );
    expect(docHoaDonXml(HD, '0322222222')).toEqual(expect.objectContaining({ huong: 'vao', mstDoiTac: '0311111111' }));
  });
  it('tờ khai 01/GTGT: kỳ, bổ sung lần mấy, các chỉ tiêu', () => {
    const tk = `<HSoThueDTu><HSoKhaiThue><TTinChung><TTinTKhaiThue><TKhaiThue><maTKhai>842</maTKhai><loaiTKhai>B</loaiTKhai><soLan>1</soLan>
      <KyKKhaiThue><kieuKy>Q</kieuKy><kyKKhai>2/2025</kyKKhai></KyKKhaiThue><ngayLapTKhai>2025-10-29</ngayLapTKhai></TKhaiThue>
      <NNT><mst>0311111111</mst></NNT></TTinTKhaiThue></TTinChung><CTieuTKhaiChinh><ct22>0</ct22><ct25>26427657</ct25><ct35>28937600</ct35><ct40>2509943</ct40><ct43>0</ct43></CTieuTKhaiChinh></HSoKhaiThue></HSoThueDTu>`;
    expect(nhanDangXml(tk)).toBe('to_khai_gtgt');
    expect(docToKhaiGtgt(tk)).toEqual({ ky: '2025-Q2', loai: 'B', soLan: 1, ngayLap: '2025-10-29', mst: '0311111111', ct: { ct22: 0, ct25: 26427657, ct35: 28937600, ct40: 2509943, ct43: 0 } });
    expect(nhanDangXml('<TBaoThueDTu></TBaoThueDTu>')).toBe('khac');
  });
});

describe('VAT theo quý', () => {
  const hd = (huong: 'ra' | 'vao', ky: string, thue: number, trangThai = 'Hóa đơn mới'): HoaDon => ({
    huong, mauSo: '1', kyHieu: 'X', soHd: String(Math.random()), ngay: '2026-01-01', mstDoiTac: '', tenDoiTac: '', dienGiai: '',
    tienHang: thue * 12, tienThue: thue, tongTien: thue * 13, thueSuat: '8', trangThai, kyKeKhai: ky,
  });
  it('quý có tờ khai → số chính thức (bản bổ sung mới nhất); quý chưa khai → ước tính, xâu chuỗi số chuyển kỳ', () => {
    const tk = (ky: string, soLan: number, ct: Record<string, number>): ToKhaiGtgt => ({ ky, loai: soLan ? 'B' : 'C', soLan, ngayLap: '', mst: '', ct });
    const r = tinhVatTheoQuy(
      [hd('ra', '2026-Q2', 43_000_000), hd('vao', '2026-Q2', 31_000_000), hd('ra', '2026-Q3', 50_000_000), hd('vao', '2026-Q3', 10_000_000), hd('ra', '2026-Q3', 9_000_000, 'Hóa đơn bị hủy')],
      [tk('2026-Q2', 0, { ct22: 54_000_000, ct25: 18_000_000, ct35: 43_000_000, ct40: 0, ct43: 29_000_000 }), tk('2026-Q2', 1, { ct22: 54_000_000, ct25: 18_000_000, ct35: 43_000_000, ct40: 0, ct43: 28_000_000 })],
      '2026-Q2',
      '2026-Q4',
    );
    expect(r.map((v) => [v.ky, v.nguon, v.dauRa, v.dauVao, v.kyTruoc, v.phaiNop, v.chuyenKySau])).toEqual([
      ['2026-Q2', 'to_khai', 43_000_000, 18_000_000, 54_000_000, 0, 28_000_000],
      ['2026-Q3', 'uoc_tinh', 50_000_000, 10_000_000, 28_000_000, 12_000_000, 0],
      ['2026-Q4', 'uoc_tinh', 0, 0, 0, 0, 0],
    ]);
    expect(r[1]!.hanNop).toBe('2026-10-31');
  });
});

describe('TNDN', () => {
  it('thuế suất: trước 2025 20%; từ 2025 theo doanh thu năm 15% / 17% / 20%', () => {
    expect(thueSuatTndn(2024, 1e9)).toBe(0.2);
    expect(thueSuatTndn(2025, 2.5e9)).toBe(0.15);
    expect(thueSuatTndn(2026, 10e9)).toBe(0.17);
    expect(thueSuatTndn(2026, 60e9)).toBe(0.2);
  });
  it('năm miễn → phải nộp 0 nhưng vẫn cho biết số nếu không miễn; ưu tiên báo cáo KQKD, không có thì ước tính từ hoá đơn', () => {
    const bc = [{ tuNgay: '2026-01-01', denNgay: '2026-06-30', chiTieu: { '01': 1_000_000_000, '50': 200_000_000 } }];
    expect(tinhTndn(2026, bc, [], [2024, 2025, 2026])).toMatchObject({
      nguon: 'bao_cao_luy_ke', denNgay: '2026-06-30', loiNhuan: 200_000_000, thueSuat: 0.15, thueNeuKhongMien: 30_000_000, mien: true, phaiNop: 0,
    });
    expect(tinhTndn(2027, [], [
      { huong: 'ra', mauSo: '1', kyHieu: 'X', soHd: '1', ngay: '2027-02-01', mstDoiTac: '', tenDoiTac: '', dienGiai: '', tienHang: 100_000_000, tienThue: 0, tongTien: 0, thueSuat: '', trangThai: 'Hóa đơn mới', kyKeKhai: '2027-Q1' },
      { huong: 'vao', mauSo: '1', kyHieu: 'Y', soHd: '1', ngay: '2027-02-01', mstDoiTac: '', tenDoiTac: '', dienGiai: '', tienHang: 60_000_000, tienThue: 0, tongTien: 0, thueSuat: '', trangThai: 'Hóa đơn mới', kyKeKhai: '2027-Q1' },
    ], [2024, 2025, 2026])).toMatchObject({ nguon: 'uoc_tinh', loiNhuan: 40_000_000, mien: false, phaiNop: 6_000_000 });
    // Lỗ → không có thuế.
    expect(tinhTndn(2027, [{ tuNgay: '2027-01-01', denNgay: '2027-12-31', chiTieu: { '50': -5 } }], [], []).phaiNop).toBe(0);
  });
});
