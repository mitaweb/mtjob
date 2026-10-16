import { describe, it, expect } from 'vitest';
import { noiDungTin, gioTin, dungDoanChat, denLucRut, maTinLonNhat, viecBanDem, goiYTenKhachTuNhom, gioNhac, noiThongTinKhach, nhacGop, ghiChuViecAi, tachViec, gopThemViec, dangDoc, nhomKhongLienQuan, tepTrongTin, laHostTepZalo, moTaThayTin, type TinZalo } from './zalo.js';

// Anh Tâm 5/10/2026: đọc tin nhắn Zalo giữa anh và khách để đưa vào kho có chọn lọc.

describe('noiDungTin', () => {
  it('chữ giữ nguyên; link/tệp ghi gọn; sticker/rỗng bỏ', () => {
    expect(noiDungTin('  Em gửi báo giá nhé ')).toBe('Em gửi báo giá nhé');
    expect(noiDungTin({ title: 'bao-gia.pdf', href: 'https://f.zdn.vn/x' })).toBe('[Tệp/link: bao-gia.pdf — https://f.zdn.vn/x]');
    expect(noiDungTin({ id: 123, catId: 4 })).toBe('');
    expect(noiDungTin(null)).toBe('');
  });
});

describe('gioTin', () => {
  it('đổi ms sang giờ Việt Nam', () => {
    expect(gioTin(String(Date.UTC(2026, 9, 5, 2, 7)))).toBe('05/10 09:07');
    expect(gioTin('abc')).toBe('');
  });
});

describe('dungDoanChat', () => {
  const t = (ts: number, fromSelf: boolean, content: string, sender = 'Chị Hà'): TinZalo => ({
    msgId: String(ts), threadId: 'T1', fromSelf, sender, content, ts: String(Date.UTC(2026, 9, 5, 2, ts)),
  });

  it('xếp cũ → mới, ghi tên chủ tài khoản và tên khách', () => {
    const s = dungDoanChat([t(5, true, 'Dạ em gửi ạ'), t(1, false, 'Gửi chị báo giá SEO')], 'Anh Tâm', 'Chị Hà');
    expect(s).toBe('[05/10 09:01] Chị Hà: Gửi chị báo giá SEO\n[05/10 09:05] Anh Tâm: Dạ em gửi ạ');
  });

  it('quá dài thì giữ phần MỚI NHẤT', () => {
    const ds = Array.from({ length: 50 }, (_, i) => t(i, false, `tin số ${i} ${'x'.repeat(40)}`));
    const s = dungDoanChat(ds, 'Anh Tâm', 'Chị Hà', 300);
    expect(s.length).toBeLessThanOrEqual(300);
    expect(s).toContain('tin số 49');
    expect(s).not.toContain('tin số 0 ');
  });

  it('bỏ tin rỗng', () => {
    expect(dungDoanChat([t(1, false, '   ')], 'A', 'B')).toBe('');
  });
});

describe('denLucRut', () => {
  const now = Date.parse('2026-10-05T10:00:00Z');
  it('chỉ rút khi có tin mới VÀ cuộc đã lắng', () => {
    expect(denLucRut({ chuaRut: 0, lastMsgAt: '2026-10-05T08:00:00Z', now })).toBe(false);
    expect(denLucRut({ chuaRut: 5, lastMsgAt: '2026-10-05T09:55:00Z', now })).toBe(false); // đang nói dở
    expect(denLucRut({ chuaRut: 5, lastMsgAt: '2026-10-05T09:50:00Z', now })).toBe(true); // lắng 10 phút là đọc
  });
  it('anh bấm tay thì rút luôn', () => {
    expect(denLucRut({ chuaRut: 1, lastMsgAt: '2026-10-05T09:59:00Z', now, epNgay: true })).toBe(true);
  });
});

describe('maTinLonNhat', () => {
  it('so bằng số, không so chuỗi; giữ mốc cũ nếu không có tin mới hơn', () => {
    expect(maTinLonNhat(['9', '10', '7'])).toBe('10');
    expect(maTinLonNhat(['7012345678901234567', '7012345678901234600'])).toBe('7012345678901234600');
    expect(maTinLonNhat(['5'], '8')).toBe('8');
    expect(maTinLonNhat([], '')).toBe('');
    expect(maTinLonNhat(['abc'])).toBe('');
  });
});

// Anh Tâm 11/10/2026: đồng bộ 3 tiếng/lần ban ngày; "ban đêm từ 22h đến 6h chỉ đồng bộ 1 lần lúc 5h sáng".
describe('viecBanDem — 3 tiếng ban ngày, đêm chỉ 5h sáng', () => {
  const luc = (gio: string) => Date.parse(`2026-10-11T${gio}:00+07:00`);
  it('ban ngày: quá 3 tiếng thì đồng bộ', () => {
    expect(viecBanDem({ gioVN: 10, lastSync: '', now: luc('10:00') })).toBe('dong_bo');
    expect(viecBanDem({ gioVN: 10, lastSync: new Date(luc('06:50')).toISOString(), now: luc('10:00') })).toBe('dong_bo');
    expect(viecBanDem({ gioVN: 10, lastSync: new Date(luc('08:00')).toISOString(), now: luc('10:00') })).toBe('rut');
  });
  it('ban đêm 22h–6h: không đồng bộ, trừ một lượt lúc 5h', () => {
    const toi = new Date(Date.parse('2026-10-10T19:00:00+07:00')).toISOString();
    expect(viecBanDem({ gioVN: 23, lastSync: toi, now: Date.parse('2026-10-10T23:30:00+07:00') })).toBe('rut');
    expect(viecBanDem({ gioVN: 3, lastSync: toi, now: luc('03:00') })).toBe('rut');
    expect(viecBanDem({ gioVN: 5, lastSync: toi, now: luc('05:02') })).toBe('dong_bo');
    expect(viecBanDem({ gioVN: 5, lastSync: new Date(luc('05:02')).toISOString(), now: luc('05:40') })).toBe('rut');
    expect(viecBanDem({ gioVN: 6, lastSync: new Date(luc('05:02')).toISOString(), now: luc('06:30') })).toBe('rut');
    expect(viecBanDem({ gioVN: 8, lastSync: new Date(luc('05:02')).toISOString(), now: luc('08:10') })).toBe('dong_bo');
  });
  // Anh Tâm 13/10/2026: việc đã xử lý trong chat mà vẫn bị nhắc — tin lúc nhắc cũ tới 3 tiếng.
  it('sắp tới giờ nhắc Zalo: tin cũ hơn 20 phút thì đồng bộ trước (chỉ ban ngày)', () => {
    const luc8 = new Date(luc('08:00')).toISOString();
    expect(viecBanDem({ gioVN: 8, lastSync: luc8, now: luc('08:10'), sapNhac: true })).toBe('rut');
    expect(viecBanDem({ gioVN: 8, lastSync: luc8, now: luc('08:25'), sapNhac: true })).toBe('dong_bo');
    expect(viecBanDem({ gioVN: 8, lastSync: luc8, now: luc('08:25'), sapNhac: false })).toBe('rut');
    const toi = new Date(Date.parse('2026-10-10T21:30:00+07:00')).toISOString();
    expect(viecBanDem({ gioVN: 23, lastSync: toi, now: Date.parse('2026-10-10T23:30:00+07:00'), sapNhac: true })).toBe('rut');
  });
  it('xét nhóm / AI đọc chạy cả ngày lẫn đêm', () => {
    const vua = new Date(luc('09:30')).toISOString();
    expect(viecBanDem({ gioVN: 10, lastSync: vua, now: luc('10:00'), viecNhom: 3 })).toBe('nhom');
    expect(viecBanDem({ gioVN: 23, lastSync: vua, now: luc('10:00') })).toBe('rut');
  });
});

// Anh Tâm 11/10/2026: "đỡ tốn token đọc tin".
describe('dangDoc — bỏ tin xác nhận ngắn', () => {
  it('chỉ "ok", "dạ", "cảm ơn", sticker → không gọi AI', () => {
    expect(dangDoc([{ content: 'ok' }, { content: 'Dạ vâng ạ' }, { content: 'cảm ơn anh 🙏' }, { content: '' }])).toBe(false);
    expect(dangDoc([{ content: 'Oke nhé!!' }, { content: '👍' }])).toBe(false);
  });
  it('có nội dung thật → đọc', () => {
    expect(dangDoc([{ content: 'ok' }, { content: 'Mai gửi chị báo giá web nhé' }])).toBe(true);
    expect(dangDoc([{ content: '[Tệp/link: brief.pdf — https://f/x]' }])).toBe(true);
  });
});

// Anh Tâm 8/10/2026: nhóm khách đặt tên "TÊN KH - MT DIGITAL", một số khác.
describe('goiYTenKhachTuNhom', () => {
  it('đúng quy ước → lấy phần tên khách', () => {
    expect(goiYTenKhachTuNhom('SAVAX DOOR - MT DIGITAL')).toEqual({ theoMau: true, ten: 'SAVAX DOOR' });
    expect(goiYTenKhachTuNhom('Quốc Phong Salon – MT Digital')).toEqual({ theoMau: true, ten: 'Quốc Phong Salon' });
    expect(goiYTenKhachTuNhom('Kingpen x MTDigital')).toEqual({ theoMau: true, ten: 'Kingpen' });
    expect(goiYTenKhachTuNhom('MT DIGITAL - TOPAZ')).toEqual({ theoMau: true, ten: 'TOPAZ' });
  });
  it('khác quy ước → để AI tự xét', () => {
    expect(goiYTenKhachTuNhom('Gia đình nhà mình')).toEqual({ theoMau: false, ten: 'Gia đình nhà mình' });
    expect(goiYTenKhachTuNhom('MT DIGITAL').theoMau).toBe(false);
    expect(goiYTenKhachTuNhom('MAX-MT DIGITAL')).toEqual({ theoMau: true, ten: 'MAX' });
  });
});

// Anh Tâm 10/10/2026: "lên lịch nhắc cho anh nếu cần, ví dụ khách hỏi báo giá chưa trả lời".
describe('gioNhac', () => {
  const luc = { ngay: '2026-10-10', gio: '23:10' };
  it('giờ hợp lệ trong tương lai → giữ nguyên', () => {
    expect(gioNhac('2026-10-12 14:00', luc)).toEqual({ onDate: '2026-10-12', atTime: '14:00' });
    expect(gioNhac('2026-10-12T9:05', luc)).toEqual({ onDate: '2026-10-12', atTime: '09:05' });
  });
  it('chỉ có ngày → 8h30 ngày đó', () => {
    expect(gioNhac('2026-10-13', luc)).toEqual({ onDate: '2026-10-13', atTime: '08:30' });
  });
  it('trống / sai / đã qua → 8h30 sáng gần nhất', () => {
    expect(gioNhac('', luc)).toEqual({ onDate: '2026-10-11', atTime: '08:30' });
    expect(gioNhac('mai', luc)).toEqual({ onDate: '2026-10-11', atTime: '08:30' });
    expect(gioNhac('2026-10-09 10:00', luc)).toEqual({ onDate: '2026-10-11', atTime: '08:30' });
    expect(gioNhac('', { ngay: '2026-10-11', gio: '02:00' })).toEqual({ onDate: '2026-10-11', atTime: '08:30' });
    // 23h59 → dời 8h30 cùng ngày, nhưng 8h30 hôm nay đã qua → 8h30 sáng mai (qua năm mới)
    expect(gioNhac('2026-12-31 23:59', { ngay: '2026-12-31', gio: '10:00' })).toEqual({ onDate: '2027-01-01', atTime: '08:30' });
  });
  it('giữa đêm → dời 8h30', () => {
    expect(gioNhac('2026-10-12 02:00', luc)).toEqual({ onDate: '2026-10-12', atTime: '08:30' });
  });
});

describe('noiThongTinKhach', () => {
  it('chỉ thêm dòng mới, không sửa cái cũ, không lặp', () => {
    expect(noiThongTinKhach('', 'Bán cửa nhôm cao cấp', '2026-10-10')).toBe('• 10/10 (Zalo): Bán cửa nhôm cao cấp');
    const a = noiThongTinKhach('Khách VIP', 'Muốn chạy Ads Tết', '2026-10-10');
    expect(a).toBe('Khách VIP\n• 10/10 (Zalo): Muốn chạy Ads Tết');
    expect(noiThongTinKhach(a, 'Muốn chạy Ads Tết', '2026-10-11')).toBe(a);
    expect(noiThongTinKhach('x', '  ', '2026-10-11')).toBe('x');
  });
});

// Anh Tâm 11/10/2026: "1 khách hàng 1 thông báo sau khi tổng hợp thông tin".
describe('nhacGop / ghiChuViecAi', () => {
  const luc = { ngay: '2026-10-11', gio: '12:00' };
  it('gộp mọi việc của một khách thành một nhắc, giờ = sớm nhất', () => {
    expect(
      nhacGop('Tín Đạt Controls', [
        { viec: 'Theo dõi xin kho tư liệu', han: '2026-10-13 10:00' },
        { viec: 'Gửi báo giá video', han: '2026-10-12 15:00' },
      ], luc),
    ).toEqual({ title: 'Tín Đạt Controls: 1) Theo dõi xin kho tư liệu; 2) Gửi báo giá video', onDate: '2026-10-12', atTime: '15:00' });
    expect(nhacGop('Maple', [{ viec: 'Theo dõi bản sửa video', han: '' }], luc)).toEqual({
      title: 'Maple: Theo dõi bản sửa video',
      onDate: '2026-10-12',
      atTime: '08:30',
    });
    expect(nhacGop('X', [{ viec: '  ', han: '' }], luc)).toBeNull();
  });
  it('ghi chú: thay đúng dòng của AI, giữ dòng anh ghi', () => {
    const a = ghiChuViecAi('Khách khó tính', ['Gửi báo giá'], '2026-10-11');
    expect(a).toBe('Khách khó tính\n📌 Việc cần theo dõi (AI 11/10): Gửi báo giá');
    const b = ghiChuViecAi(a, ['Gửi hợp đồng', 'Hẹn quay'], '2026-10-12');
    expect(b).toBe('Khách khó tính\n📌 Việc cần theo dõi (AI 12/10): Gửi hợp đồng; Hẹn quay');
    expect(ghiChuViecAi(b, [], '2026-10-13')).toBe('Khách khó tính');
  });
});

// Anh Tâm 11/10/2026: "nhân viên nói về Tín Đạt thì cũng đưa thông tin đó vào khách hàng Tín Đạt".
describe('tachViec / gopThemViec', () => {
  const luc = { ngay: '2026-10-11', gio: '12:00' };
  it('đọc lại danh sách từ tiêu đề nhắc gộp', () => {
    expect(tachViec('Tín Đạt: 1) Xin kho tư liệu; 2) Gửi báo giá video')).toEqual(['Xin kho tư liệu', 'Gửi báo giá video']);
    expect(tachViec('Maple: Theo dõi bản sửa video')).toEqual(['Theo dõi bản sửa video']);
    expect(tachViec('')).toEqual([]);
  });
  it('thêm việc mới vào nhắc của khách khác, bỏ trùng', () => {
    expect(
      gopThemViec('Tín Đạt: Xin kho tư liệu', 'Tín Đạt', [
        { viec: 'xin kho tư liệu', han: '' },
        { viec: 'Gửi bản dựng thử', han: '2026-10-12 10:00' },
      ], luc),
    ).toEqual({ title: 'Tín Đạt: 1) Xin kho tư liệu; 2) Gửi bản dựng thử', onDate: '2026-10-12', atTime: '08:30' });
    expect(gopThemViec('', 'Welllife', [{ viec: 'Nhắc cấp quyền Google Map', han: '' }], luc)!.title).toBe('Welllife: Nhắc cấp quyền Google Map');
  });
});

// Anh Tâm 12/10/2026: "lọc bỏ các nhóm không liên quan sẽ tiết kiệm được rất nhiều".
describe('nhomKhongLienQuan — lọc rẻ trước khi gọi AI', () => {
  it('loại nhóm chợ / chung cư / hội nhóm / nhóm đông người', () => {
    expect(nhomKhongLienQuan('Chợ sỉ Quảng Châu')).toContain('chợ');
    expect(nhomKhongLienQuan('RICCA - BQT & Tổ tư vấn')).toContain('bqt');
    expect(nhomKhongLienQuan('Cư dân Lakeview City')).toContain('cư dân');
    expect(nhomKhongLienQuan('Pickleball Q7 sáng CN')).toContain('pickleball');
    expect(nhomKhongLienQuan('Kết nối doanh nhân', '320 thành viên · giao lưu')).toContain('320 thành viên');
  });
  it('không loại nhầm nhóm làm việc', () => {
    expect(nhomKhongLienQuan('TÍN ĐẠT - MT DIGITAL MARKETING')).toBe('');
    expect(nhomKhongLienQuan('Chợ Tốt - MT DIGITAL')).toBe(''); // khách đúng quy ước
    expect(nhomKhongLienQuan('MT DIGITAL - SEO', '8 thành viên')).toBe('');
    expect(nhomKhongLienQuan('WEB TOPAZ')).toBe('');
    expect(nhomKhongLienQuan('Ads Nam Long')).toBe('');
    expect(nhomKhongLienQuan('Kịch bản Luxury', '12 thành viên')).toBe('');
  });
});

describe('tệp trong tin Zalo — chỉ máy chủ tệp Zalo, chỉ loại AI đọc được', () => {
  it('nhận ảnh, PDF, ghi âm', () => {
    expect(tepTrongTin('[Tệp/link: https://photo-stal-24.zdn.vn/gr/jpg/a/b.jpg]')).toMatchObject({ loai: 'anh' });
    expect(tepTrongTin('[Tệp/link: Bao_gia_9tr.pdf — https://file-stal-14.dlfl.vn/no/abc/xyz]')).toEqual({
      loai: 'pdf',
      url: 'https://file-stal-14.dlfl.vn/no/abc/xyz',
      ten: 'Bao_gia_9tr.pdf',
    });
    expect(tepTrongTin('[Tệp/link: https://voice-aac-dl.zdn.vn/abc/x]')).toMatchObject({ loai: 'ghi_am' });
  });
  it('bỏ: docx, link web, máy chủ giả mạo, tin chữ', () => {
    expect(tepTrongTin('[Tệp/link: Tieu_luan.docx — https://file-stal-1.dlfl.vn/abc]')).toBeNull();
    expect(tepTrongTin('[Tệp/link: https://www.facebook.com/x.jpg]')).toBeNull();
    expect(tepTrongTin('[Tệp/link: https://photo.zdn.vn.evil.com/a.jpg]')).toBeNull();
    expect(tepTrongTin('Em gửi anh ảnh nhé')).toBeNull();
    expect(laHostTepZalo('http://photo-stal-1.zdn.vn/a.jpg')).toBe(false);
    expect(laHostTepZalo('https://file-stal-13-te-vnso-pt-64.flchat.vn/x')).toBe(true);
  });
  it('mô tả thay link: che chuỗi số dài (số tài khoản)', () => {
    expect(moTaThayTin({ loai: 'pdf', ten: 'bg.pdf' }, 'Báo giá 9.000.000đ, STK 0071001234567')).toBe('[Tệp bg.pdf: Báo giá 9.000.000đ, STK [đã ẩn số]]');
    expect(moTaThayTin({ loai: 'ghi_am', ten: '' }, 'Anh dặn gửi file trước 5h')).toBe('[Ghi âm: Anh dặn gửi file trước 5h]');
  });
});
