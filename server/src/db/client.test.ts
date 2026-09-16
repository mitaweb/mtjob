import { describe, it, expect } from 'vitest';
import { stripSslMode } from './client.js';

// Chuyển sang Supabase 16/9/2026: `sslmode=require` trong URL làm pg đòi chứng chỉ công
// cộng, đè lên `rejectUnauthorized: false` → SELF_SIGNED_CERT_IN_CHAIN với pooler Supabase.
describe('stripSslMode', () => {
  it('bỏ sslmode khi là tham số duy nhất', () => {
    expect(stripSslMode('postgresql://u:p@h:5432/db?sslmode=require')).toBe('postgresql://u:p@h:5432/db');
  });

  it('bỏ sslmode ở đầu, giữ tham số sau', () => {
    expect(stripSslMode('postgresql://u:p@h/db?sslmode=require&application_name=x')).toBe(
      'postgresql://u:p@h/db?application_name=x',
    );
  });

  it('bỏ sslmode ở cuối, giữ tham số trước', () => {
    expect(stripSslMode('postgresql://u:p@h/db?application_name=x&sslmode=verify-full')).toBe(
      'postgresql://u:p@h/db?application_name=x',
    );
  });

  it('không có sslmode thì giữ nguyên', () => {
    expect(stripSslMode('postgresql://u:p@h/db?channel_binding=require')).toBe(
      'postgresql://u:p@h/db?channel_binding=require',
    );
    expect(stripSslMode('postgresql://u:p@h/db')).toBe('postgresql://u:p@h/db');
  });

  it('mật khẩu có chữ sslmode không bị đụng', () => {
    expect(stripSslMode('postgresql://u:sslmode=abc@h/db')).toBe('postgresql://u:sslmode=abc@h/db');
  });
});
