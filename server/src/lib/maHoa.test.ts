import { describe, it, expect } from 'vitest';
import { maHoa, giaiMa } from './maHoa.js';

const K = 'khoa-bi-mat-rat-dai-it-nhat-32-ky-tu-0123456789';

describe('maHoa / giaiMa', () => {
  it('giải mã ra đúng bản rõ, kể cả tiếng Việt và JSON dài', () => {
    const s = JSON.stringify({ imei: 'abc', cookie: [{ key: 'zpsid', value: 'x'.repeat(500) }], ghiChu: 'phiên Zalo' });
    expect(giaiMa(maHoa(s, K), K)).toBe(s);
  });

  it('mỗi lần mã hoá ra chuỗi khác, không lộ bản rõ', () => {
    const a = maHoa('zpsid=abc', K);
    expect(a).not.toBe(maHoa('zpsid=abc', K));
    expect(a).not.toContain('zpsid');
  });

  it('sai khoá hoặc bị sửa → ném lỗi', () => {
    const m = maHoa('bí mật', K);
    expect(() => giaiMa(m, K + 'x')).toThrow();
    const sua = m.slice(0, -2) + (m.endsWith('A') ? 'B' : 'A') + m.slice(-1);
    expect(() => giaiMa(sua, K)).toThrow();
    expect(() => giaiMa('rác', K)).toThrow('định dạng');
  });

  it('khoá ngắn bị từ chối', () => {
    expect(() => maHoa('x', 'ngan')).toThrow('32');
  });
});
