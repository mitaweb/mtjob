import { describe, it, expect } from 'vitest';
import { noiDungTin, gioTin, dungDoanChat, denLucRut, maTinLonNhat, viecBanDem, goiYTenKhachTuNhom, type TinZalo } from './zalo.js';

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

describe('viecBanDem — đồng bộ 3 tiếng/lần, việc AI chỉ ban đêm', () => {
  const now = Date.parse('2026-10-08T16:00:00Z'); // 23h giờ VN
  it('ban ngày: quá 3 tiếng thì vẫn đồng bộ, mới đồng bộ thì nghỉ (không rút, không xét nhóm)', () => {
    expect(viecBanDem({ gioVN: 9, lastSync: '', now })).toBe('dong_bo');
    expect(viecBanDem({ gioVN: 14, lastSync: '2026-10-08T03:00:00Z', now: Date.parse('2026-10-08T07:00:00Z') })).toBe('dong_bo');
    expect(viecBanDem({ gioVN: 14, lastSync: '2026-10-08T06:00:00Z', now: Date.parse('2026-10-08T07:00:00Z'), viecNhom: 5 })).toBe('nghi');
  });
  it('lỗi cũ: bấm đồng bộ tay buổi chiều thì đêm đó vẫn phải tự đồng bộ', () => {
    // đồng bộ tay 16h (09:00Z) → 23h tối (16:00Z) cách 7 tiếng → đồng bộ
    expect(viecBanDem({ gioVN: 23, lastSync: '2026-10-08T09:00:00Z', now })).toBe('dong_bo');
  });
  it('ban đêm vừa đồng bộ → rút tri thức', () => {
    expect(viecBanDem({ gioVN: 23, lastSync: '', now })).toBe('dong_bo');
    expect(viecBanDem({ gioVN: 23, lastSync: '2026-10-08T15:10:00Z', now })).toBe('rut'); // 22h10 đêm nay
    expect(viecBanDem({ gioVN: 1, lastSync: '2026-10-08T17:30:00Z', now: now + 2 * 3600_000 })).toBe('rut');
    expect(viecBanDem({ gioVN: 2, lastSync: '2026-10-08T15:10:00Z', now: now + 3 * 3600_000 })).toBe('dong_bo'); // 3h50 sau
  });
});

describe('viecBanDem — bước nhóm', () => {
  const now = Date.parse('2026-10-08T16:00:00Z');
  it('đã đồng bộ mà còn việc nhóm → làm nhóm trước khi rút', () => {
    expect(viecBanDem({ gioVN: 23, lastSync: '2026-10-08T15:10:00Z', now, viecNhom: 4 })).toBe('nhom');
    expect(viecBanDem({ gioVN: 23, lastSync: '2026-10-08T15:10:00Z', now, viecNhom: 0 })).toBe('rut');
    expect(viecBanDem({ gioVN: 23, lastSync: '', now, viecNhom: 4 })).toBe('dong_bo');
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
