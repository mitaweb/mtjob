import { describe, it, expect } from 'vitest';
import { noiDungTin, gioTin, dungDoanChat, denLucRut, type TinZalo } from './zalo.js';

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
