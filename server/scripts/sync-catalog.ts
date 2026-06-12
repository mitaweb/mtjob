import 'dotenv/config';
import { syncCatalogFromSource } from '../src/modules/admin.sync.js';
import { closePool } from '../src/db/client.js';

async function main(): Promise<void> {
  console.log('Đồng bộ bảng điểm task từ Google Sheet (CSV công khai)...');
  const r = await syncCatalogFromSource();
  console.log(`✅ Đã cập nhật ${r.updated} đầu việc từ: ${r.tabs.join(', ')}`);
  console.log('Lưu ý: thêm tab mới bằng cách bổ sung "gid:PREFIX" vào SHEET_TASKS_SOURCE_GIDS.');
  await closePool();
}

main().catch(async (e) => {
  console.error('❌ Lỗi sync:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
