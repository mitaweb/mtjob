import { describe, it, expect } from 'vitest';
import { laiLoTheoThang, congNoTheoSaoKe } from './laiLoCongNo.js';
import type { HoaDon } from './keToan.js';
import type { GiaoDich } from './saoKe.js';

// Anh Tâm 8/11/2026: "lãi lỗ sẽ bằng hóa đơn của thuế điện tử đầu ra - đầu vào - chi phí như lương BHXH, thuê nhà, các CP
// khác không xuất hiện trên thuedientu như là CP nhà thầu nước ngoài (FB, Tiktok Ads...)". SỐ GIẢ.

const hd = (huong: 'ra' | 'vao', ngay: string, tienHang: number, o: Partial<HoaDon> = {}): HoaDon => ({
  huong, mauSo: '1', kyHieu: 'C26TAA', soHd: String(Math.round(tienHang / 1000)), ngay, mstDoiTac: '0300000001',
  tenDoiTac: 'CÔNG TY A', dienGiai: '', tienHang, tienThue: Math.round(tienHang * 0.08), tongTien: Math.round(tienHang * 1.08),
  thueSuat: '8%', trangThai: '', kyKeKhai: '', ...o,
});
const gd = (ngay: string, o: Partial<GiaoDich>): GiaoDich => ({
  id: `${ngay}-${o.noiDung}-${o.ghiNo}-${o.ghiCo}`, soTk: '1', nganHang: 'MB', ngay, ghiNo: 0, ghiCo: 0, soDu: 0, noiDung: '', soRef: '', doiTac: '', thuTu: 0, ...o,
});

describe('lãi lỗ theo tháng', () => {
  it('= hoá đơn ra − hoá đơn vào − lương + BHXH công ty; hoá đơn huỷ không tính', () => {
    const r = laiLoTheoThang(2026, {
      hoaDon: [
        hd('ra', '2026-09-05', 100_000_000),
        hd('ra', '2026-09-20', 50_000_000, { trangThai: 'Hóa đơn đã bị hủy' }),
        hd('vao', '2026-09-10', 20_000_000),
      ],
      luong: [{ thang: '2026-09', tongThuNhap: 40_000_000, bhxhCty: 5_000_000 }],
      giaoDich: [],
    });
    expect(r.find((x) => x.thang === '2026-09')).toMatchObject({
      doanhThu: 100_000_000,
      hdVao: 20_000_000,
      luongBhxh: 45_000_000,
      laiLo: 35_000_000,
    });
  });
});

describe('lãi lỗ — chi phí nhà thầu nước ngoài (theo sao kê)', () => {
  it('trả thẻ cho Facebook / Google / TikTok / phần mềm nước ngoài là chi phí; thẻ hoàn về thì trừ lại', () => {
    const r = laiLoTheoThang(2026, {
      hoaDon: [],
      luong: [],
      giaoDich: [
        gd('2026-10-16', { ghiNo: 3_000_000, noiDung: 'RetailVISADN-139398-3000000-VND-628 #-MM GOOGLE ADWS-The 5911 38010 SMEVSHP' }),
        gd('2026-10-16', { ghiNo: 2_000_000, noiDung: 'RetailVISADN-139411-2000000-VND-628 #-FACEBK *ABC123-The 5911 SMEVSHP' }),
        gd('2026-10-17', { ghiNo: 1_500_000, noiDung: 'RetailVISADN-139420-1500000-VND-628 #-TIKTOK ADS-The 5911 SMEVSHP' }),
        gd('2026-10-18', { ghiNo: 2_800_000, noiDung: 'RetailVISADN-139391-111.11-USD-6289 03510499-ANTHROPIC CLAUDE SUB-The # SMEVSHP' }),
        gd('2026-10-20', { ghiCo: 500_000, noiDung: 'RetailVISADN-139137-500000-VND-615 #-MM GOOGLE ADWS-The 5911 38010 SMEVSHP' }),
      ],
    });
    expect(r.find((x) => x.thang === '2026-10')).toMatchObject({ nhaThauNN: 8_800_000, laiLo: -8_800_000 });
  });
});

describe('lãi lỗ — thuê nhà; tiền rút ra chi khác không tính', () => {
  it('thuê văn phòng / nhà là chi phí (kể cả chữ bị ngân hàng ngắt dòng)', () => {
    const r = laiLoTheoThang(2026, {
      hoaDon: [],
      luong: [],
      giaoDich: [
        gd('2026-09-21', { ghiNo: 12_000_000, noiDung: 'MBCT MT Digital thanh toan tien thu e van phong thang 10 D26VKVQ9/27812 9' }),
        gd('2026-09-25', { ghiNo: 3_000_000, noiDung: 'chuyen tien thue nha kho thang 9' }),
      ],
    });
    expect(r.find((x) => x.thang === '2026-09')).toMatchObject({ thueNha: 15_000_000, laiLo: -15_000_000 });
  });
  it('rút tiền mặt, chuyển tiền chưa rõ, trả lương, đóng BHXH, nộp thuế: KHÔNG tính (lương đã theo bảng lương)', () => {
    const r = laiLoTheoThang(2026, {
      hoaDon: [],
      luong: [],
      giaoDich: [
        gd('2026-08-05', { ghiNo: 70_000_000, noiDung: 'RUT TIEN' }),
        gd('2026-08-06', { ghiNo: 20_000_000, noiDung: 'chuyen tien' }),
        gd('2026-08-05', { ghiNo: 9_202_000, noiDung: 'thanh toan luong thang 7 lan 2' }),
        gd('2026-08-19', { ghiNo: 20_000_000, noiDung: '+BHXH+103+00+TZQ460U+07903+dong BHX H+' }),
        gd('2026-08-27', { ghiNo: 27_636_720, noiDung: 'NTDT+KB:0136-KBNN Khu vuc II +MST:0300000000 +TKNS' }),
      ],
    });
    expect(r.find((x) => x.thang === '2026-08')).toMatchObject({ nhaThauNN: 0, thueNha: 0, laiLo: 0 });
  });
});

describe('công nợ phải thu theo sao kê', () => {
  const kh = (ten: string, mst: string) => ({ tenDoiTac: ten, mstDoiTac: mst });
  it('tiền về có TÊN CÔNG TY trong nội dung → trừ công nợ công ty đó; còn lại = hoá đơn − đã thu', () => {
    const r = congNoTheoSaoKe({
      loai: 'thu',
      hoaDon: [
        hd('ra', '2026-07-01', 30_000_000, { soHd: '101', ...kh('CÔNG TY CỔ PHẦN NHÂN LỰC SAPHIRA', '0300000011') }),
        hd('ra', '2026-07-03', 10_000_000, { soHd: '102', ...kh('CÔNG TY TNHH MIRAKO VIỆT NAM', '0300000012') }),
      ],
      giaoDich: [
        gd('2026-07-01', { ghiCo: 1_000, noiDung: 'mo dau ky sao ke' }),
        gd('2026-07-10', { ghiCo: 20_000_000, noiDung: 'Saphira thanh toan chi phi quang cao thang 6' }),
      ],
    });
    const saphira = r.ds.find((x) => x.mst === '0300000011')!;
    expect(saphira).toMatchObject({ hoaDon: 32_400_000, daTra: 20_000_000, con: 12_400_000 });
    expect(r.ds.find((x) => x.mst === '0300000012')).toMatchObject({ hoaDon: 10_800_000, daTra: 0, con: 10_800_000 });
    expect(r.phai).toBe(23_200_000);
  });
});

describe('công nợ — thứ tự khớp: tên công ty trong nội dung → tên người / đơn vị chuyển', () => {
  const HD = [
    hd('ra', '2026-07-05', 10_000_000, { soHd: '201', tenDoiTac: 'CÔNG TY CỔ PHẦN NHÂN LỰC SAPHIRA', mstDoiTac: '0300000011' }),
    hd('ra', '2026-07-05', 10_000_000, { soHd: '202', tenDoiTac: 'CÔNG TY TNHH MIRAKO VIỆT NAM', mstDoiTac: '0300000012' }),
  ];
  it('nội dung không có tên → dùng cột tên người / đơn vị chuyển', () => {
    const r = congNoTheoSaoKe({
      loai: 'thu',
      hoaDon: HD,
      giaoDich: [gd('2026-07-05', { ghiCo: 5_000_000, noiDung: 'CHUYEN TIEN QUANG CAO THANG 7', doiTac: 'CONG TY TNHH MIRAKO VIET NAM' })],
    });
    expect(r.ds.find((x) => x.mst === '0300000012')).toMatchObject({ daTra: 5_000_000 });
  });
  it('nội dung có tên công ty khác người chuyển (người khác trả hộ) → tính cho công ty trong nội dung', () => {
    const r = congNoTheoSaoKe({
      loai: 'thu',
      hoaDon: HD,
      giaoDich: [gd('2026-07-05', { ghiCo: 5_000_000, noiDung: 'Saphira thanh toan phi quang cao', doiTac: 'CONG TY TNHH MIRAKO VIET NAM' })],
    });
    expect(r.ds.find((x) => x.mst === '0300000011')).toMatchObject({ daTra: 5_000_000 });
    expect(r.ds.find((x) => x.mst === '0300000012')).toMatchObject({ daTra: 0 });
  });
});

describe('công nợ — không có tên: khớp theo số tiền trùng hoá đơn', () => {
  it('số tiền đúng bằng MỘT hoá đơn còn nợ → khớp; trùng với hoá đơn của 2 công ty → không đoán, vào "chưa khớp"', () => {
    const r = congNoTheoSaoKe({
      loai: 'thu',
      hoaDon: [
        hd('ra', '2026-07-05', 12_000_000, { soHd: '301', tenDoiTac: 'CÔNG TY TNHH KIENZO', mstDoiTac: '0300000021' }), // tổng 12.960.000
        hd('ra', '2026-07-05', 5_000_000, { soHd: '302', tenDoiTac: 'CÔNG TY TNHH SAO MAI', mstDoiTac: '0300000022' }), // 5.400.000
        hd('ra', '2026-07-06', 5_000_000, { soHd: '303', tenDoiTac: 'CÔNG TY TNHH HOÀNG HÔN', mstDoiTac: '0300000023' }), // 5.400.000
      ],
      giaoDich: [
        gd('2026-07-05', { ghiCo: 12_960_000, noiDung: 'Thanh toan tien dich vu theo hop dong' }),
        gd('2026-07-08', { ghiCo: 5_400_000, noiDung: 'chuyen khoan' }),
      ],
    });
    expect(r.ds.find((x) => x.mst === '0300000021')).toMatchObject({ daTra: 12_960_000, con: 0 });
    expect(r.ds.find((x) => x.mst === '0300000022')).toMatchObject({ daTra: 0 });
    expect(r.chuaKhop.map((g) => g.ghiCo)).toEqual([5_400_000]);
  });
});

describe('công nợ — hoá đơn còn nợ (trừ hoá đơn cũ trước)', () => {
  it('trả 15tr cho 3 hoá đơn 10tr → hoá đơn đầu đủ, hoá đơn 2 còn 5tr, hoá đơn 3 còn nguyên', () => {
    const k = { tenDoiTac: 'CÔNG TY CỔ PHẦN NHÂN LỰC SAPHIRA', mstDoiTac: '0300000011' };
    const r = congNoTheoSaoKe({
      loai: 'thu',
      hoaDon: [
        hd('ra', '2026-09-01', 10_000_000, { soHd: '503', tongTien: 10_000_000, ...k }),
        hd('ra', '2026-07-01', 10_000_000, { soHd: '501', tongTien: 10_000_000, ...k }),
        hd('ra', '2026-08-01', 10_000_000, { soHd: '502', tongTien: 10_000_000, ...k }),
      ],
      giaoDich: [gd('2026-07-01', { ghiCo: 15_000_000, noiDung: 'Saphira thanh toan' })],
    });
    expect(r.ds[0]!.hdChuaTra).toEqual([
      { soHd: '502', ngay: '2026-08-01', tongTien: 10_000_000, conLai: 5_000_000 },
      { soHd: '503', ngay: '2026-09-01', tongTien: 10_000_000, conLai: 10_000_000 },
    ]);
  });
});

describe('công nợ phải trả theo sao kê', () => {
  it('chi khớp nhà cung cấp theo tên; hoá đơn dưới 5 triệu coi như trả tiền mặt; lương / thẻ / rút tiền không gán nhầm', () => {
    const r = congNoTheoSaoKe({
      loai: 'tra',
      hoaDon: [
        hd('vao', '2026-08-02', 20_000_000, { soHd: '11', tongTien: 21_600_000, tenDoiTac: 'CÔNG TY TNHH THIẾT BỊ VĂN PHÒNG LYVYSTAR', mstDoiTac: '0300000031' }),
        hd('vao', '2026-08-03', 1_000_000, { soHd: '12', tongTien: 1_080_000, tenDoiTac: 'HỘ KINH DOANH TẠP HOÁ BÌNH AN', mstDoiTac: '0300000032' }),
        hd('vao', '2026-08-04', 9_000_000, { soHd: '13', tongTien: 9_720_000, tenDoiTac: 'CÔNG TY TNHH IN ẤN HƯNG THỊNH', mstDoiTac: '0300000033' }),
      ],
      giaoDich: [
        gd('2026-08-01', { ghiNo: 1, noiDung: 'phi' }),
        gd('2026-08-10', { ghiNo: 21_600_000, noiDung: 'MT Digital thanh toan HD 11 Lyvystar' }),
        gd('2026-08-05', { ghiNo: 9_720_000, noiDung: 'thanh toan luong thang 7 lan 2' }),
        gd('2026-08-06', { ghiNo: 9_720_000, noiDung: 'RetailVISADN-1-9720000-VND-1 #-GOOGLE ADWS-The 5911 SMEVSHP' }),
        gd('2026-08-07', { ghiNo: 9_720_000, noiDung: 'RUT TIEN' }),
      ],
    });
    expect(r.ds.find((x) => x.mst === '0300000031')).toMatchObject({ daTra: 21_600_000, con: 0 });
    expect(r.ds.find((x) => x.mst === '0300000032')).toMatchObject({ con: 0 }); // < 5tr → tiền mặt
    expect(r.ds.find((x) => x.mst === '0300000033')).toMatchObject({ daTra: 0, con: 9_720_000 });
    expect(r.phai).toBe(9_720_000);
  });
});

describe('nhà thầu nước ngoài ĐÃ có hoá đơn đầu vào (Google, Meta) — không tính hai lần', () => {
  const ggHd = hd('vao', '2026-10-15', 5_000_000, { soHd: '9001', tongTien: 5_000_000, tenDoiTac: 'CÔNG TY TNHH GOOGLE VIỆT NAM', mstDoiTac: '0309684511' });
  const the = [
    gd('2026-10-01', { ghiNo: 5_000_000, noiDung: 'RetailVISADN-139398-5000000-VND-628 #-MM GOOGLE ADWS-The 5911 SMEVSHP' }),
    gd('2026-10-02', { ghiNo: 1_500_000, noiDung: 'RetailVISADN-139420-1500000-VND-628 #-TIKTOK ADS-The 5911 SMEVSHP' }),
  ];
  it('lãi lỗ: tiền thẻ Google đã có hoá đơn → chỉ tính theo hoá đơn; TikTok không hoá đơn → tính theo thẻ', () => {
    const t = laiLoTheoThang(2026, { hoaDon: [ggHd], luong: [], giaoDich: the }).find((x) => x.thang === '2026-10')!;
    expect(t).toMatchObject({ hdVao: 5_000_000, nhaThauNN: 1_500_000, laiLo: -6_500_000 });
  });
  it('công nợ phải trả: tiền thẻ Google trả cho hoá đơn Google', () => {
    const r = congNoTheoSaoKe({ loai: 'tra', hoaDon: [ggHd], giaoDich: the });
    expect(r.ds.find((x) => x.mst === '0309684511')).toMatchObject({ daTra: 5_000_000, con: 0 });
  });
});
