import 'dotenv/config';
import { pool, closePool, q } from '../src/db/client.js';
import { DDL, CONFIG_SEED, TASK_CATALOG_SEED, HOLIDAYS_2026_SEED } from '../src/db/schema.js';
import { HR_SEED_ROWS } from '../src/db/seedMembers.js';
import { parseHrRow, type HrPerson } from '../src/lib/people.js';
import { upsertHrPeople, syncMembersFromSource } from '../src/modules/admin.sync.js';
import { findByEmail, upsertMember } from '../src/modules/members.repo.js';
import { hashPassword } from '../src/auth/password.js';
import { newId } from '../src/util/id.js';

async function main(): Promise<void> {
  console.log('Khởi tạo CSDL Postgres...');
  await pool().query(DDL);
  console.log('  - Đã tạo bảng (nếu chưa có).');

  for (const [key, value] of CONFIG_SEED) {
    await q('INSERT INTO config (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
  for (const [code, name, points] of TASK_CATALOG_SEED) {
    await q(
      'INSERT INTO task_catalog (task_code, task_name, points, active) VALUES ($1,$2,$3,true) ON CONFLICT (task_code) DO NOTHING',
      [code, name, points],
    );
  }
  for (const [date, name] of HOLIDAYS_2026_SEED) {
    await q('INSERT INTO holidays (date, name, year) VALUES ($1,$2,$3) ON CONFLICT (date) DO NOTHING', [
      date, name, Number(date.slice(0, 4)),
    ]);
  }
  console.log('  - Đã seed config + danh mục task + ngày lễ.');

  // Members: try the live sheet CSV first, fall back to the embedded snapshot.
  try {
    const r = await syncMembersFromSource();
    console.log(`  - Đồng bộ ${r.imported} thành viên từ Google Sheet nguồn. Teams: ${r.teams.join(', ')}`);
  } catch (e) {
    console.warn(`  - Không đọc được sheet nguồn (${(e as Error).message})`);
    const people = HR_SEED_ROWS.map((row) => parseHrRow(row)).filter((p): p is HrPerson => p !== null);
    const r = await upsertHrPeople(people);
    console.log(`  - Đã seed ${r.imported} thành viên từ snapshot nhúng sẵn. Teams: ${r.teams.join(', ')}`);
  }

  // Admin account.
  const email = process.env.ADMIN_EMAIL || 'admin@mtjob.local';
  const password = process.env.ADMIN_PASSWORD || 'Admin@2026';
  if (await findByEmail(email)) {
    console.log(`  - Admin (${email}) đã tồn tại.`);
  } else {
    await upsertMember({
      id: newId('M-'),
      fullName: 'Quản trị viên',
      dob: null,
      position: 'Admin',
      teamId: '' as never,
      role: 'admin',
      salary: 0,
      bhxh: 0,
      joinDate: null,
      email,
      passwordHash: await hashPassword(password),
      active: true,
    });
    console.log(`  - Tạo admin: ${email} / ${password}  (ĐỔI MẬT KHẨU sau khi đăng nhập!)`);
  }

  console.log('✅ Thiết lập hoàn tất.');
  await closePool();
}

main().catch(async (e) => {
  console.error('❌ Lỗi setup:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
