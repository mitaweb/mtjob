// Postgres client (works with Neon/Supabase/local Postgres via DATABASE_URL).
// Trên Neon (serverless): dùng driver HTTP @neondatabase/serverless — mỗi query là 1 fetch,
// không bắt tay TCP+TLS mỗi invocation như pg.Pool. Local/Postgres thường: vẫn dùng pg.
import 'dotenv/config';
import pg from 'pg';
import { neon } from '@neondatabase/serverless';

let _pool: pg.Pool | undefined;
let _neonSql: ReturnType<typeof neon> | undefined;

export function dbUrl(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (!url) throw new Error('DATABASE_URL chưa được cấu hình');
  return url;
}

// DB_DRIVER=pg là lối thoát khẩn cấp: ép quay về pg.Pool mà không cần sửa code.
function useNeonHttp(url: string): boolean {
  return /\.neon\.tech/.test(url) && process.env.DB_DRIVER !== 'pg';
}

function neonSql() {
  if (!_neonSql) _neonSql = neon(dbUrl());
  return _neonSql;
}

/**
 * Bỏ `sslmode=…` khỏi chuỗi kết nối. SSL do code đặt (`ssl: { rejectUnauthorized: false }`),
 * nhưng `pg` ≥ 8.12 đọc `sslmode=require` trong URL thành "xác thực đầy đủ chứng chỉ" và
 * ĐÈ lên cài đặt đó → Supabase pooler (chứng chỉ tự ký) văng SELF_SIGNED_CERT_IN_CHAIN.
 * Neon may mắn có chứng chỉ công cộng nên trước giờ không lộ.
 */
export function stripSslMode(url: string): string {
  return url.replace(/([?&])sslmode=[^&]*(&|$)/, (_m, dau: string, sau: string) => (sau ? dau : '')).replace(/[?&]$/, '');
}

/**
 * pg.Pool — dùng cho mọi Postgres không phải Neon (Supabase, máy chủ riêng, local) và cho
 * scripts chạy tay (setup-db, migrate…): driver HTTP của Neon không chạy được DDL nhiều
 * câu lệnh trong một query.
 */
export function pool(): pg.Pool {
  if (!_pool) {
    const url = stripSslMode(dbUrl());
    _pool = new pg.Pool({
      connectionString: url,
      max: 3, // serverless-friendly: vài kết nối mỗi instance là đủ
      ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
    });
  }
  return _pool;
}

/** Run a parameterized query and return rows. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function q(text: string, params: unknown[] = []): Promise<any[]> {
  const url = dbUrl();
  if (useNeonHttp(url)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await neonSql().query(text, params as any[]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any[];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await pool().query(text, params as any[]);
  return r.rows;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
  }
}
