import 'dotenv/config';
import { syncCatalogFromSource } from '../src/modules/admin.sync.js';
import { moTaNgoaiBang } from '../src/lib/scores.js';
import { closePool } from '../src/db/client.js';

async function main(): Promise<void> {
  console.log('Đồng bộ bảng điểm task từ Google Sheet (CSV công khai)...');
  const r = await syncCatalogFromSource();
  console.log(`✅ Đã cập nhật ${r.updated} đầu việc từ: ${r.tabs.join(', ')}`);

  // Tên việc rơi ra ngoài bảng điểm — im lặng thì mấy trăm việc đứng yên mà không ai biết.
  const canh = moTaNgoaiBang(r.points.ngoaiBang);
  if (canh) {
    console.warn(`⚠️  ${canh}`);
    for (const d of r.points.ngoaiBang) {
      console.warn(`    "${d.ten}" — ${d.soViec} việc, giữ ${d.diem}đ`);
    }
  }
  for (const t of r.points.tenTrung) {
    console.warn(`⚠️  "${t.ten}" bị ghi nhiều mức điểm (${t.diems}) — bỏ qua tên này.`);
  }
  console.log('Lưu ý: thêm tab mới bằng cách bổ sung "gid:PREFIX" vào SHEET_TASKS_SOURCE_GIDS.');
  await closePool();
}

main().catch(async (e) => {
  console.error('❌ Lỗi sync:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
