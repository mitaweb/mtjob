import 'dotenv/config';
import { pool, closePool, q } from '../src/db/client.js';

// Tạo bảng customer_notes (Lưu ý khách hàng) trên DB hiện có. An toàn chạy lại nhiều lần.
const DDL = `
CREATE TABLE IF NOT EXISTS customer_notes (
  note_id      text PRIMARY KEY,
  customer     text NOT NULL DEFAULT '',
  content      text DEFAULT '',
  color        text DEFAULT '',
  attachments  text DEFAULT '[]',
  created_by   text DEFAULT '',
  created_name text DEFAULT '',
  created_at   text DEFAULT '',
  updated_at   text DEFAULT ''
);
CREATE INDEX IF NOT EXISTS customer_notes_updated_idx ON customer_notes (updated_at);
`;

async function main(): Promise<void> {
  console.log('Tạo bảng customer_notes (nếu chưa có)...');
  await pool().query(DDL);
  const cols = await q(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'customer_notes' ORDER BY ordinal_position`,
  );
  console.log('✅ Bảng customer_notes sẵn sàng. Cột:');
  for (const c of cols) console.log(`  - ${c.column_name} (${c.data_type})`);
  await closePool();
}

main().catch(async (e) => {
  console.error('❌ Lỗi migrate:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
