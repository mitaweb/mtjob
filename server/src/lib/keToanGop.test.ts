import { describe, it, expect } from 'vitest';
import { gopChiSo, tinhThangDaLay, quyetDinhCaKhoi, phangCongNo, khoaChiTieu, tomTatGop, ngayLapTrongFile, ngayHopLe } from './keToanGop.js';

// Anh Tâm 11/11/2026: "Phần kế toán thuế anh cần thông minh hơn, đọc và hiểu các báo cáo, ưu tiên báo cáo sau ghi đè báo cáo
// cũ, các chỉ số có ngày cập nhật mới hơn phải được giữ lại, đánh giá giữ lại hay k, k hiểu thì hỏi". Số GIẢ.

describe('gopChiSo — chỉ số nào giữ, chỉ số nào ghi đè', () => {
  const cu = { giaTri: { '01': 1000, '50': 200, cpktd: 30 }, ngay: { '01': '2026-09-05', '50': '2026-09-05', cpktd: '2026-08-10' } };

  it('báo cáo MỚI HƠN ghi đè; chỉ số mới thêm vào; chỉ số báo cáo mới không có thì giữ', () => {
    const r = gopChiSo(cu, { giaTri: { '01': 1100, '50': 200, lntt: 230 }, ngay: '2026-10-01' });
    expect(r.giaTri).toEqual({ '01': 1100, '50': 200, cpktd: 30, lntt: 230 });
    expect(r.ngay).toEqual({ '01': '2026-10-01', '50': '2026-10-01', cpktd: '2026-08-10', lntt: '2026-10-01' });
    expect(r.ghiDe).toEqual([{ khoa: '01', cu: 1000, moi: 1100, ngayCu: '2026-09-05', ngayMoi: '2026-10-01' }]);
    expect(r.giuCu).toEqual([]);
    expect(r.canXet).toEqual([]);
  });

  it('báo cáo CŨ HƠN không đè số mới — chỉ báo lại', () => {
    const r = gopChiSo(cu, { giaTri: { '01': 900, cpktd: 35 }, ngay: '2026-08-31' });
    expect(r.giaTri['01']).toBe(1000);
    expect(r.giuCu).toEqual([{ khoa: '01', cu: 1000, moi: 900, ngayCu: '2026-09-05', ngayMoi: '2026-08-31' }]);
    // cpktd của báo cáo cũ (10/8) cũ hơn báo cáo này (31/8) → ghi đè
    expect(r.giaTri.cpktd).toBe(35);
  });

  it('cùng ngày hoặc không rõ ngày mà số KHÁC → cần xét (AI / hỏi anh), tạm giữ số cũ', () => {
    const r1 = gopChiSo(cu, { giaTri: { '50': 250 }, ngay: '2026-09-05' });
    expect(r1.giaTri['50']).toBe(200);
    expect(r1.canXet).toEqual([{ khoa: '50', cu: 200, moi: 250, ngayCu: '2026-09-05', ngayMoi: '2026-09-05' }]);
    const r2 = gopChiSo(cu, { giaTri: { '50': 250 }, ngay: '' });
    expect(r2.canXet.length).toBe(1);
  });

  it('số GIỐNG nhau → không có gì phải xét, ngày lấy cái mới hơn', () => {
    const r = gopChiSo(cu, { giaTri: { '50': 200 }, ngay: '' });
    expect(r.canXet).toEqual([]);
    expect(r.ngay['50']).toBe('2026-09-05');
  });

  it('chưa có gì → nhận hết', () => {
    const r = gopChiSo(null, { giaTri: { '01': 5 }, ngay: '' });
    expect(r.giaTri).toEqual({ '01': 5 });
    expect(r.canXet).toEqual([]);
  });
});

// Anh Tâm 11/11/2026: "tháng nào mà đã cập nhật từ cổng thuế có trên hệ thống rồi thì note lại, đã cập nhật từ tháng... để
// cập nhật tiếp mà k phải lấy nhiều".
describe('tinhThangDaLay — tháng nào đã lấy đủ từ cổng thuế', () => {
  it('đủ = lấy sau khi tháng kết thúc ≥ 5 ngày; tháng đang chạy / lấy sớm thì cần lấy lại; gợi ý tháng tiếp', () => {
    const r = tinhThangDaLay(
      {
        '2026-08': '2026-09-20T10:00:00.000Z',
        '2026-09': '2026-10-06T10:00:00.000Z',
        '2026-10': '2026-10-28T10:00:00.000Z', // lấy khi tháng 10 chưa hết → cần lấy lại
      },
      '2026-11-11',
    );
    expect(r.duTu).toBe('2026-08');
    expect(r.duDen).toBe('2026-09');
    expect(r.canLayLai).toEqual(['2026-10']);
    expect(r.goiY).toBe('2026-10');
  });
  it('chưa lấy tháng nào → gợi ý tháng trước', () => {
    expect(tinhThangDaLay({}, '2026-11-11')).toEqual({ duTu: '', duDen: '', canLayLai: [], goiY: '2026-10' });
  });
  it('đủ hết tới tháng trước → gợi ý tháng hiện tại', () => {
    const r = tinhThangDaLay({ '2026-10': '2026-11-06T00:00:00.000Z' }, '2026-11-11');
    expect(r.duDen).toBe('2026-10');
    expect(r.goiY).toBe('2026-11');
  });
  it('tháng bị bỏ trống ở giữa → gợi ý tháng trống', () => {
    const r = tinhThangDaLay({ '2026-07': '2026-08-20T00:00:00.000Z', '2026-09': '2026-10-20T00:00:00.000Z' }, '2026-11-11');
    expect(r.goiY).toBe('2026-08');
  });
});

describe('quyetDinhCaKhoi — bảng lương một tháng / sổ công nợ một ngày chốt: nhận cả khối hay giữ cả khối', () => {
  it('chưa có → nhận; báo cáo mới hơn → nhận; cũ hơn → giữ; cùng ngày / không rõ mà khác → xét', () => {
    expect(quyetDinhCaKhoi(gopChiSo(null, { giaTri: { a: 1 }, ngay: '' }), false)).toBe('moi');
    const cu = { giaTri: { a: 1, b: 2 }, ngay: { a: '2026-09-01', b: '2026-09-01' } };
    expect(quyetDinhCaKhoi(gopChiSo(cu, { giaTri: { a: 5, b: 2 }, ngay: '2026-10-01' }), true)).toBe('moi');
    expect(quyetDinhCaKhoi(gopChiSo(cu, { giaTri: { a: 5 }, ngay: '2026-08-01' }), true)).toBe('cu');
    expect(quyetDinhCaKhoi(gopChiSo(cu, { giaTri: { a: 5 }, ngay: '2026-09-01' }), true)).toBe('xet');
    expect(quyetDinhCaKhoi(gopChiSo(cu, { giaTri: { a: 1, b: 2 }, ngay: '' }), true)).toBe('moi'); // y hệt — ghi lại không sao
  });
});

describe('phangCongNo — sổ công nợ thành chỉ số để so', () => {
  it('mỗi đối tác hai số dư cuối kỳ', () => {
    expect(
      phangCongNo({
        loai: 'thu',
        tuNgay: '2026-01-01',
        ngayChot: '2026-09-30',
        dong: [{ ma: 'KH1', ten: 'A', duNoDau: 0, duCoDau: 0, psNo: 0, psCo: 0, duNo: 500, duCo: 0 }],
      }),
    ).toEqual({ 'KH1|duNo': 500, 'KH1|duCo': 0 });
  });
});

describe('khoaChiTieu — mã chỉ tiêu báo cáo bất kỳ', () => {
  it('có mã số thì dùng mã; không thì tên bỏ dấu', () => {
    expect(khoaChiTieu('110', 'Tiền và các khoản tương đương tiền')).toBe('110');
    expect(khoaChiTieu('', 'Tiền và các khoản tương đương tiền')).toBe('tien_va_cac_khoan_tuong_duong_tien');
  });
});

describe('tomTatGop — câu báo sau khi tải lên', () => {
  it('nêu số cập nhật / giữ / hỏi', () => {
    expect(tomTatGop({ ghiDe: 3, giuCu: 2, aiMoi: 1, aiCu: 0, hoi: 1 })).toBe(
      ' · cập nhật 3 chỉ số theo báo cáo mới hơn · giữ 2 chỉ số (báo cáo này cũ hơn) · AI chọn số mới cho 1 chỗ · ❓ 1 chỗ cần anh quyết',
    );
    expect(tomTatGop({ ghiDe: 0, giuCu: 0, aiMoi: 0, aiCu: 0, hoi: 0 })).toBe('');
  });
});

describe('ngayLapTrongFile — ngày lập báo cáo ghi ở dòng ký', () => {
  const sh = (rows: string[][]) => [{ ten: 'S1', rows }];
  it('đọc "Lập, ngày 15 tháng 01 năm 2026" ở cuối file', () => {
    expect(ngayLapTrongFile(sh([['BÁO CÁO KẾT QUẢ KINH DOANH'], ['Năm 2025'], ['', 'Hà Nội, ngày 15 tháng 01 năm 2026']]))).toBe('2026-01-15');
  });
  it('nhiều ngày → lấy ngày muộn nhất (ngày ký sau ngày kỳ)', () => {
    expect(ngayLapTrongFile(sh([['Từ ngày 01 tháng 01 năm 2025'], ['Ngày 3 tháng 2 năm 2026']]))).toBe('2026-02-03');
  });
  it('không có / ngày vô lý → rỗng', () => {
    expect(ngayLapTrongFile(sh([['Ngày ... tháng ... năm ...'], ['ngày 40 tháng 13 năm 2026']]))).toBe('');
  });
});

describe('ngayHopLe — ngày lập trước kỳ số liệu là vô lý (mẫu kế toán ghi nhầm năm)', () => {
  it('KQKD 6 tháng 2026 ký "27/10/2025" → coi như không rõ ngày', () => {
    expect(ngayHopLe('2025-10-27', '2026-01-01')).toBe('');
  });
  it('ngày lập từ đầu kỳ trở đi → giữ', () => {
    expect(ngayHopLe('2026-07-15', '2026-01-01')).toBe('2026-07-15');
    expect(ngayHopLe('2026-01-01', '2026-01-01')).toBe('2026-01-01');
  });
  it('không có ngày → rỗng', () => {
    expect(ngayHopLe('', '2026-01-01')).toBe('');
  });
});
