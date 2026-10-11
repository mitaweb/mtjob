import { describe, it, expect } from 'vitest';
import { noiDungTin, gioTin, dungDoanChat, denLucRut, maTinLonNhat, viecBanDem, goiYTenKhachTuNhom, gioNhac, noiThongTinKhach, nhacGop, ghiChuViecAi, tachViec, gopThemViec, dangDoc, type TinZalo } from './zalo.js';

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
    expect(denLucRut({ chuaRut: 5, lastMsgAt: '2026-10-05T09:50:00Z', now })).toBe(false); // đang nói dở
    expect(denLucRut({ chuaRut: 5, lastMsgAt: '2026-10-05T09:20:00Z', now })).toBe(true);
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

// Anh Tâm 11/10/2026: "AI cập nhật chat 1 tiếng 1 lần" — cả ngày, không chỉ ban đêm.
describe('viecBanDem — đồng bộ 1 tiếng/lần, AI đọc cả ngày', () => {
  const now = Date.parse('2026-10-11T03:00:00Z'); // 10h sáng giờ VN
  it('quá 1 tiếng chưa đồng bộ → đồng bộ', () => {
    expect(viecBanDem({ gioVN: 10, lastSync: '', now })).toBe('dong_bo');
    expect(viecBanDem({ gioVN: 10, lastSync: '2026-10-11T01:50:00Z', now })).toBe('dong_bo');
  });
  it('vừa đồng bộ → ban ngày vẫn xét nhóm / AI đọc', () => {
    expect(viecBanDem({ gioVN: 10, lastSync: '2026-10-11T02:30:00Z', now, viecNhom: 3 })).toBe('nhom');
    expect(viecBanDem({ gioVN: 10, lastSync: '2026-10-11T02:30:00Z', now })).toBe('rut');
    expect(viecBanDem({ gioVN: 23, lastSync: '2026-10-11T02:30:00Z', now })).toBe('rut');
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
