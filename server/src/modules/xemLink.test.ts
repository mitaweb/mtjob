import { describe, it, expect } from 'vitest';
import { diaChiAnToan } from './xemLink.js';

// Link trong tin Zalo do người khác gửi — chỉ mở trang công khai, không bao giờ địa chỉ nội bộ.
describe('diaChiAnToan', () => {
  it('chặn IP nội bộ, metadata đám mây, máy nội bộ, giao thức / cổng lạ, link có mật khẩu', async () => {
    for (const u of [
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://10.0.0.5/admin',
      'http://localhost/',
      'http://may-noi-bo.internal/',
      'ftp://example.com/x',
      'file:///etc/passwd',
      'https://example.com:8443/',
      'https://user:pass@example.com/',
      'khong phai url',
    ]) {
      expect(await diaChiAnToan(u), u).toBe(false);
    }
  });
  it('cho qua IP công khai', async () => {
    expect(await diaChiAnToan('https://142.250.66.78/')).toBe(true);
  });
});
