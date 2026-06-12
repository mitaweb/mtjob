import 'dotenv/config';
import { syncMembersFromSource } from '../src/modules/admin.sync.js';
import { closePool } from '../src/db/client.js';

async function main(): Promise<void> {
  console.log('Đồng bộ nhân sự từ Google Sheet nguồn (CSV công khai)...');
  const r = await syncMembersFromSource();
  console.log(`✅ Đã import ${r.imported} thành viên. Teams: ${r.teams.join(', ') || '(none)'}`);
  for (const p of r.people) {
    console.log(`  - ${p.fullName} | team=${p.team || '-'} | role=${p.role} | ${p.email}`);
  }
  console.log('\nLưu ý: đặt mật khẩu cho từng thành viên trong màn Quản trị trước khi họ đăng nhập.');
  await closePool();
}

main().catch(async (e) => {
  console.error('❌ Lỗi sync:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
