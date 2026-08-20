import 'dotenv/config';
import { syncCatalogFromSource } from '../src/modules/admin.sync.js';
import { moTaDoiNghia } from '../src/lib/scores.js';
import { closePool } from '../src/db/client.js';

async function main(): Promise<void> {
  console.log('Đồng bộ bảng điểm task từ Google Sheet (CSV công khai)...');
  const r = await syncCatalogFromSource();
  console.log(`✅ Đã cập nhật ${r.updated} đầu việc từ: ${r.tabs.join(', ')}`);

  // Mã đổi nghĩa là dấu hiệu Sheet bị lệch dòng — im lặng bỏ qua thì lần sau vẫn lệch.
  const canh = moTaDoiNghia(r.points.doiNghia);
  if (canh) {
    console.warn(`⚠️  ${canh}`);
    for (const d of r.points.doiNghia) {
      console.warn(`    ${d.code}: việc cũ ghi "${d.tenCu}" — bảng điểm nay là "${d.tenMoi}" (${d.soViec} việc)`);
    }
  }
  console.log('Lưu ý: thêm tab mới bằng cách bổ sung "gid:PREFIX" vào SHEET_TASKS_SOURCE_GIDS.');
  await closePool();
}

main().catch(async (e) => {
  console.error('❌ Lỗi sync:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
