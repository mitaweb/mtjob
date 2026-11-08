import { describe, it, expect } from 'vitest';
import { cheSoDai, xemTruoc, hoaDonTheoBanDo, giaoDichTheoBanDo, congNoTheoBanDo, luongTheoBanDo, luongNvTheoBanDo, kqkdTheoBanDo, thangCua, ketHopSaoKe, ketHopHoaDon, type BanDoAi } from './docAi.js';
import { docSaoKe, taiKhoanSaoKe } from './saoKe.js';
import type { HoaDon } from './keToan.js';

// Anh Tâm 18/10/2026: "ở phần upload file này em cho AI vào đọc file luôn đỡ phải setup định dạng". AI chỉ trả bản đồ
// cột; các hàm này đọc toàn bộ file theo bản đồ. Số liệu dưới đây là SỐ GIẢ.

describe('che số trước khi gửi AI', () => {
  it('che CCCD / số tài khoản, giữ số tiền có dấu phân cách', () => {
    expect(cheSoDai('CCCD 079123456789')).toBe('CCCD ############');
    expect(cheSoDai('STK 0071 0012 3456')).toBe('STK ############');
    expect(cheSoDai('Tổng 252,958,000')).toBe('Tổng 252,958,000');
    expect(cheSoDai('1.234.567.890')).toBe('1.234.567.890');
    expect(cheSoDai('T01')).toBe('T01');
  });
  it('xem trước: chỉ số cột, cắt ngắn, không lộ số dài', () => {
    const x = xemTruoc([{ ten: 'S', rows: [['Họ tên', 'CCCD'], ['Nguyễn A', '079123456789']] }]);
    expect(x).toContain('### SHEET "S" (2 dòng)');
    expect(x).toContain('dòng 1: [0]Nguyễn A | [1]############');
    expect(x).not.toMatch(/\d{9,}/);
  });
});

describe('đọc theo bản đồ AI', () => {
  it('hoá đơn: hướng theo sheet, tách mẫu số khỏi ký hiệu, cộng dồn hoá đơn nhiều dòng', () => {
    const sh = [{ ten: 'Mua', rows: [['Ngày', 'KH', 'Số', 'MST', 'Tên', 'Tiền', 'Thuế'], ['01/04/2026', '1C26TAA', '9', '0300000001', 'A', '100', '8'], ['01/04/2026', '1C26TAA', '9', '0300000001', 'A', '50', '0']] }];
    const bd: BanDoAi = { loai: 'hoa_don', moTa: '', bang: [{ sheet: 'Mua', dongDuLieu: 1, huong: 'vao', cot: { ngay: 0, kyHieu: 1, soHd: 2, mst: 3, ten: 4, tienHang: 5, tienThue: 6 } }] };
    expect(hoaDonTheoBanDo(sh, bd)).toEqual([
      expect.objectContaining({ huong: 'vao', mauSo: '1', kyHieu: 'C26TAA', soHd: '9', tienHang: 150, tienThue: 8, tongTien: 158, kyKeKhai: '2026-Q2' }),
    ]);
    // Sheet không ghi hướng → bỏ (không đoán bừa ra / vào).
    expect(hoaDonTheoBanDo(sh, { ...bd, bang: [{ ...bd.bang[0]!, huong: '' }] })).toEqual([]);
  });
  it('sao kê: hai cột nợ/có, bỏ dòng không có ngày', () => {
    const sh = [{ ten: 'SK', rows: [['Ngày', 'ND', 'Nợ', 'Có', 'Dư'], ['02/07/2026', 'KHACH A CK', '', '1.000.000', '5.000.000'], ['Tổng', '', '', '', '']] }];
    const gd = giaoDichTheoBanDo(sh, { loai: 'sao_ke', moTa: '', nganHang: 'MB', soTk: '123', bang: [{ sheet: 'SK', dongDuLieu: 1, cot: { ngay: 0, noiDung: 1, no: 2, co: 3, soDu: 4 } }] });
    expect(gd).toEqual([expect.objectContaining({ ngay: '2026-07-02', ghiCo: 1000000, ghiNo: 0, soDu: 5000000, nganHang: 'MB', soTk: '123' })]);
  });
  it('công nợ: cần loại + ngày chốt; bỏ dòng tổng', () => {
    const sh = [{ ten: 'CN', rows: [['Mã', 'Tên', 'Nợ', 'Có'], ['KH1', 'Khách 1', '40,000,000', '0'], ['Tổng cộng', 'x', '40,000,000', '0']] }];
    const bd: BanDoAi = { loai: 'cong_no', moTa: '', loaiCongNo: 'thu', ngayChot: '2026-06-30', bang: [{ sheet: 'CN', dongDuLieu: 1, cot: { ma: 0, ten: 1, duNo: 2, duCo: 3 } }] };
    expect(congNoTheoBanDo(sh, bd)).toMatchObject({ loai: 'thu', ngayChot: '2026-06-30', tuNgay: '2026-01-01', dong: [{ ma: 'KH1', duNo: 40000000 }] });
    expect(congNoTheoBanDo(sh, { ...bd, ngayChot: '' })).toBeNull();
  });
  it('bảng lương: cộng theo tháng, BHXH công ty nhiều cột; bỏ dòng không có tháng / tên', () => {
    const sh = [
      {
        ten: 'BHXH 2026',
        rows: [
          ['Tháng', 'Họ tên', 'Tổng lương', 'BHXH 17%', 'BHYT 3%', 'BHXH 8%'],
          ['T01', 'A', '10,000,000', '850,000', '150,000', '400,000'],
          ['T01', 'B', '8,000,000', '850,000', '150,000', '400,000'],
          ['T02', 'A', '9,000,000', '850,000', '150,000', '400,000'],
          ['', '', '27,000,000', '2,550,000', '450,000', ''],
        ],
      },
    ];
    const bd: BanDoAi = { loai: 'bang_luong', moTa: '', nam: 2026, bang: [{ sheet: 'BHXH 2026', dongDuLieu: 1, cot: { thang: 0, ten: 1, tongThuNhap: 2, bhxhCty: [3, 4], bhxhNld: [5] } }] };
    expect(luongTheoBanDo(sh, bd)).toEqual([
      { thang: '2026-01', soNguoi: 2, tongThuNhap: 18000000, bhxhCty: 2000000, bhxhNld: 800000, tncn: 0, thucNhan: 0, tienMat: 0, chuyenKhoan: 0 },
      { thang: '2026-02', soNguoi: 1, tongThuNhap: 9000000, bhxhCty: 1000000, bhxhNld: 400000, tncn: 0, thucNhan: 0, tienMat: 0, chuyenKhoan: 0 },
    ]);
  });
  it('bảng lương trả 2 đợt: nhận cột "Bằng TM" / "Bằng CK" / "Tổng thực lãnh" từ tiêu đề dù AI không chỉ', () => {
    const sh = [
      {
        ten: 'BHXH 2026',
        rows: [
          ['STT', 'THÁNG', 'HỌ VÀ TÊN', 'TỔNG LƯƠNG', 'THỰC LÃNH', 'THỰC LÃNH', 'TỔNG THỰC LÃNH'],
          ['', '', '', '', 'Bằng TM', 'Bằng CK cty', ''],
          ['', '', '', '', 'ĐỢT 1: 15 tây tháng n', 'ĐỢT 2: 5 tây tháng n+1', ''],
          ['1', 'T09', 'Nguyễn Văn An', '13,000,000', '3,200,000', '9,170,000', '12,370,000'],
          ['2', 'T09', 'Thực tập A', '1,090,909', '', '1,090,909', '1,090,909'],
        ],
      },
    ];
    const bd: BanDoAi = { loai: 'bang_luong', moTa: '', nam: 2026, bang: [{ sheet: 'BHXH 2026', dongDuLieu: 3, cot: { thang: 1, ten: 2, tongThuNhap: 3 } }] };
    expect(luongNvTheoBanDo(sh, bd).map((x) => [x.ten, x.tienMat, x.chuyenKhoan, x.thucNhan])).toEqual([
      ['Nguyễn Văn An', 3_200_000, 9_170_000, 12_370_000],
      ['Thực tập A', 0, 1_090_909, 1_090_909],
    ]);
    expect(luongTheoBanDo(sh, bd)[0]).toMatchObject({ thang: '2026-09', soNguoi: 2, tienMat: 3_200_000, chuyenKhoan: 10_260_909 });
  });
  it('tháng: nhiều cách ghi', () => {
    expect(thangCua('T01', 2026)).toBe('2026-01');
    expect(thangCua('Tháng 12', 2025)).toBe('2025-12');
    expect(thangCua('03/2026')).toBe('2026-03');
    expect(thangCua('T01')).toBe(''); // không biết năm thì không đoán
  });
  it('báo cáo KQKD: cần kỳ + lợi nhuận', () => {
    expect(kqkdTheoBanDo({ loai: 'kqkd', moTa: '', bang: [], tuNgay: '2026-01-01', denNgay: '2026-06-30', doanhThu: 100, loiNhuanTruocThue: -5 })).toEqual({
      tuNgay: '2026-01-01',
      denNgay: '2026-06-30',
      chiTieu: { '01': 100, '50': -5 },
    });
    expect(kqkdTheoBanDo({ loai: 'kqkd', moTa: '', bang: [] })).toBeNull();
  });
});

// Anh Tâm 8/11/2026: "sử dụng AI để đọc luôn các tài liệu gửi lên" — AI đọc mọi file trước; bộ đọc mẫu (nếu đọc được)
// dùng để kiểm chéo: cùng giao dịch / hoá đơn thì giữ khoá cũ (tải lại không nhân đôi), AI bổ sung phần mẫu thiếu.
describe('kết hợp AI + bộ đọc mẫu', () => {
  const SK = [
    {
      ten: 'Sheet1',
      rows: [
        ['NGÂN HÀNG TMCP QUÂN ĐỘI - MB BANK'],
        ['SAO KÊ TÀI KHOẢN'],
        ['Số tài khoản: 0123 4567 89012'],
        ['Ngày giao dịch', 'Số bút toán', 'Ghi nợ', 'Ghi có', 'Số dư', 'Diễn giải', 'Bên liên quan'],
        ['02/07/2026', 'FT1', '', '1.000.000', '11.000.000', 'CK TIEN HANG', 'CONG TY SON HA'],
        ['03/07/2026', 'FT2', '', '40.000.000', '51.000.000', 'THANH TOAN HD 25', 'NGUYEN VAN SANG'],
        ['05/07/2026', 'FT3', '2.000.000', '', '49.000.000', 'PHI DICH VU', ''],
      ],
    },
  ];
  const bd = (cot: Record<string, number>): BanDoAi => ({ loai: 'sao_ke', moTa: '', nganHang: 'MB', soTk: '', bang: [{ sheet: 'Sheet1', dongDuLieu: 4, cot }] });
  const DUNG = { ngay: 0, soRef: 1, no: 2, co: 3, soDu: 4, noiDung: 5, doiTac: 6 };

  it('tên đối tác giữ nguyên chữ "s"', () => {
    expect(giaoDichTheoBanDo(SK, bd(DUNG)).map((g) => g.doiTac)).toEqual(['CONG TY SON HA', 'NGUYEN VAN SANG', '']);
  });
  it('sao kê cả hai cùng đọc: giữ khoá của bộ đọc mẫu, lấy thêm tên đối tác AI đọc được', () => {
    const mau = docSaoKe(SK, 'sk.xlsx')!.giaoDich;
    const r = ketHopSaoKe(giaoDichTheoBanDo(SK, bd(DUNG)), mau);
    expect(r.ds.map((g) => g.id)).toEqual(mau.map((g) => g.id));
    expect(r.ds.map((g) => g.doiTac)).toEqual(['CONG TY SON HA', 'NGUYEN VAN SANG', '']);
    expect(r).toMatchObject({ them: 0, bo: 0 });
  });
  it('AI chọn nhầm cột tiền (số dư không khớp) → bỏ phần AI, giữ bộ đọc mẫu', () => {
    const mau = docSaoKe(SK, 'sk.xlsx')!.giaoDich;
    const r = ketHopSaoKe(giaoDichTheoBanDo(SK, bd({ ...DUNG, co: 4, no: 1 })), mau);
    expect(r.ds).toEqual(mau);
    expect(r.bo).toBeGreaterThan(0);
  });
  it('chỉ AI đọc được: số TK lấy từ đầu file (AI không thấy số TK) → khoá trùng khoá bộ đọc mẫu', () => {
    const mau = docSaoKe(SK, 'sk.xlsx')!;
    const r = ketHopSaoKe(giaoDichTheoBanDo(SK, bd(DUNG)), null, taiKhoanSaoKe(SK[0]!.rows.slice(0, 4), 'sk.xlsx'));
    expect(r.ds.map((g) => [g.soTk, g.nganHang, g.id])).toEqual(mau.giaoDich.map((g) => [mau.soTk, 'MB', g.id]));
  });
  it('giao dịch AI đọc trước đây (khoá chưa có số TK) đã lưu → giữ khoá cũ, không ghi thêm bản mới', () => {
    const ai = giaoDichTheoBanDo(SK, bd(DUNG));
    const r = ketHopSaoKe(ai, null, { nganHang: 'MB', soTk: '0123456789012' }, new Set([ai[0]!.id]));
    expect(r.ds[0]!.id).toBe(ai[0]!.id);
    expect(r.ds[1]!.id).not.toBe(ai[1]!.id);
  });

  const hd = (soHd: string, o: Partial<HoaDon> = {}): HoaDon => ({
    huong: 'vao', mauSo: '1', kyHieu: 'C26TAA', soHd, ngay: '2026-04-01', mstDoiTac: '0300000001', tenDoiTac: '', dienGiai: '',
    tienHang: 100, tienThue: 8, tongTien: 108, thueSuat: '8%', trangThai: 'Hóa đơn mới', kyKeKhai: '2026-Q2', ...o,
  });
  it('hoá đơn: giữ số tiền bộ đọc mẫu, điền chỗ trống từ AI, thêm hoá đơn mẫu bỏ sót', () => {
    const r = ketHopHoaDon([hd('1', { tenDoiTac: 'CTY A', tienHang: 999, tongTien: 1007 }), hd('2', { tenDoiTac: 'CTY B' })], [hd('1')]);
    expect(r.ds).toEqual([hd('1', { tenDoiTac: 'CTY A' }), hd('2', { tenDoiTac: 'CTY B' })]);
    expect(r).toMatchObject({ them: 1, bo: 0 });
  });
  it('hoá đơn AI đọc tiền hàng + thuế ≠ tổng tiền → không thêm hoá đơn chỉ AI thấy', () => {
    const r = ketHopHoaDon([hd('1'), hd('2', { tongTien: 500_000 }), hd('3', { tongTien: 700_000 })], [hd('1')]);
    expect(r.ds).toEqual([hd('1')]);
    expect(r.bo).toBe(2);
  });
});
