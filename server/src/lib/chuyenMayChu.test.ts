import { describe, expect, it } from 'vitest';
import { bienCanChuyen } from './chuyenMayChu.js';

// Chuyển Vercel → Coolify (21/11/2026): Vercel giấu giá trị biến "Sensitive" nên bản trên Vercel tự gửi sang Coolify.
describe('bienCanChuyen', () => {
  it('chỉ lấy biến trong danh sách và có giá trị; DATABASE_URL đổi tên để không đè DB mới', () => {
    const ra = bienCanChuyen({ ZALO_SESSION_KEY: 'k', DATABASE_URL: 'postgres://sb', JWT_SECRET: '', PATH: '/bin', CHUYEN_COOLIFY_TOKEN: 't' });
    expect(ra).toEqual([
      { key: 'SUPABASE_DATABASE_URL', value: 'postgres://sb' },
      { key: 'ZALO_SESSION_KEY', value: 'k' },
    ]);
  });
});
