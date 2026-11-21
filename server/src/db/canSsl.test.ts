import { describe, expect, it } from 'vitest';
import { canSsl } from './client.js';

// Chuyển sang máy chủ riêng (Coolify, 21/11/2026): Postgres nội bộ không bật SSL; Supabase vẫn cần SSL.
describe('canSsl', () => {
  it('Supabase / máy ngoài → có SSL', () => {
    expect(canSsl('postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres')).toBe(true);
  });
  it('Postgres nội bộ Coolify (tên container) / localhost / sslmode=disable → không SSL', () => {
    expect(canSsl('postgres://postgres:p@p55w5uwkons99tvstqdpbety:5432/postgres')).toBe(false);
    expect(canSsl('postgres://u:p@localhost:5432/db')).toBe(false);
    expect(canSsl('postgres://u:p@db.example.com:5432/db?sslmode=disable')).toBe(false);
  });
});
