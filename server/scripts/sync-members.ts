import 'dotenv/config';
import { syncMembersFromSource } from '../src/modules/admin.sync.js';

async function main(): Promise<void> {
  console.log('Đồng bộ nhân sự từ Google Sheet nguồn...');
  const r = await syncMembersFromSource();
  console.log(`✅ Đã import ${r.imported} thành viên. Teams: ${r.teams.join(', ') || '(none)'}`);
  for (const p of r.people) {
    console.log(`  - ${p.fullName} | team=${p.team || '-'} | role=${p.role} | ${p.email}`);
  }
  console.log('\nLưu ý: đặt mật khẩu cho từng thành viên qua API admin /members/:id/password trước khi họ đăng nhập.');
}

main().catch((e) => {
  console.error('❌ Lỗi sync:', e?.message || e);
  process.exit(1);
});
