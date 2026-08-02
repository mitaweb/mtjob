import { describe, it, expect } from 'vitest';
import { normalizeSubject } from './webpush.js';

// Anh Tâm 1/8/2026: iPhone lỗi 403 còn máy Windows gửi được. Gốc là VAPID subject
// `mailto:admin@mtjob.local` — Apple bắt buộc địa chỉ liên hệ có thật, Google thì bỏ qua.

describe('normalizeSubject', () => {
  it('giữ nguyên https với tên miền thật', () => {
    expect(normalizeSubject('https://job.mtdigital.vn')).toBe('https://job.mtdigital.vn');
  });

  it('giữ nguyên mailto với tên miền thật', () => {
    expect(normalizeSubject('mailto:hotam50@gmail.com')).toBe('mailto:hotam50@gmail.com');
  });

  it('THAY tên miền .local — đây là ca làm iPhone lỗi 403', () => {
    expect(normalizeSubject('mailto:admin@mtjob.local')).toBe('https://job.mtdigital.vn');
  });

  it('thay các tên miền chỉ dùng nội bộ khác', () => {
    for (const d of ['test', 'localhost', 'invalid', 'example']) {
      expect(normalizeSubject(`mailto:a@b.${d}`)).toBe('https://job.mtdigital.vn');
    }
  });

  it('thay khi bỏ trống hoặc viết sai', () => {
    expect(normalizeSubject(undefined)).toBe('https://job.mtdigital.vn');
    expect(normalizeSubject('')).toBe('https://job.mtdigital.vn');
    expect(normalizeSubject('admin@mtjob.vn')).toBe('https://job.mtdigital.vn'); // thiếu mailto:
    expect(normalizeSubject('http://job.mtdigital.vn')).toBe('https://job.mtdigital.vn'); // http không được
  });

  it('bỏ khoảng trắng thừa', () => {
    expect(normalizeSubject('  mailto:hotam50@gmail.com  ')).toBe('mailto:hotam50@gmail.com');
  });
});
