import 'dotenv/config';
import { q, closePool } from '../src/db/client.js';

// Migration: lịch sử lưu ý KH — thêm bảng customer_note_history + 2 cột người sửa
// vào customer_notes. Chỉ THÊM (ADD IF NOT EXISTS), không đụng dữ liệu hiện có.

async function main(): Promise<void> {
  await q(`ALTER TABLE customer_notes ADD COLUMN IF NOT EXISTS updated_by text DEFAULT ''`);
  await q(`ALTER TABLE customer_notes ADD COLUMN IF NOT EXISTS updated_name text DEFAULT ''`);
  await q(`CREATE TABLE IF NOT EXISTS customer_note_history (
    hist_id    text PRIMARY KEY,
    note_id    text NOT NULL,
    customer   text DEFAULT '',
    content    text DEFAULT '',
    color      text DEFAULT '',
    saved_at   text DEFAULT '',
    saved_name text DEFAULT ''
  )`);
  await q(`CREATE INDEX IF NOT EXISTS customer_note_history_note_idx ON customer_note_history (note_id, saved_at)`);

  const cols = await q(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'customer_note_history' ORDER BY ordinal_position`,
  );
  console.log('✅ customer_note_history:', cols.map((c) => c.column_name).join(', '));
  const noteCols = await q(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'customer_notes' AND column_name IN ('updated_by','updated_name')`,
  );
  console.log('✅ customer_notes có thêm:', noteCols.map((c) => c.column_name).join(', '));
  await closePool();
}

main().catch(async (e) => {
  console.error('❌ Lỗi migration:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
