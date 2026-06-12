// Postgres client (works with Neon/Supabase/local Postgres via DATABASE_URL).
import 'dotenv/config';
import pg from 'pg';

let _pool: pg.Pool | undefined;

export function dbUrl(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (!url) throw new Error('DATABASE_URL chưa được cấu hình');
  return url;
}

export function pool(): pg.Pool {
  if (!_pool) {
    const url = dbUrl();
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
