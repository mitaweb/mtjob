import 'dotenv/config';
import { q, closePool } from '../src/db/client.js';

// Migration: chốt lương — thêm cột snapshot vào payroll + bảng payroll_locks.
// Chỉ THÊM (IF NOT EXISTS), không đụng dữ liệu hiện có.

async function main(): Promise<void> {
  await q(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS full_name text DEFAULT ''`);
  await q(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS team_id text DEFAULT ''`);
  await q(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS prorated_salary integer DEFAULT 0`);
  await q(`CREATE TABLE IF NOT EXISTS payroll_locks (
    year      integer NOT NULL,
    month     integer NOT NULL,
    locked_at text DEFAULT '',
    locked_by text DEFAULT '',
    PRIMARY KEY (year, month)
  )`);

  const pcols = await q(
    `SELECT column_name FROM information_schema.columns WHERE table_name='payroll' ORDER BY ordinal_position`,
  );
  console.log('✅ payroll:', pcols.map((c) => c.column_name).join(', '));
  const lk = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='payroll_locks'`);
  console.log('✅ payroll_locks:', lk.map((c) => c.column_name).join(', '));
  await closePool();
}

main().catch(async (e) => {
  console.error('❌ Lỗi migration:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
