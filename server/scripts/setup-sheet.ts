import 'dotenv/config';
import { sheetsClient, dbId } from '../src/sheets/client.js';
import { TABS, CONFIG_SEED, TASK_CATALOG_SEED, HOLIDAYS_2026_SEED } from '../src/sheets/schema.js';
import { hashPassword } from '../src/auth/password.js';
import { newId } from '../src/util/id.js';

async function valuesOf(tab: string): Promise<unknown[][]> {
  const res = await sheetsClient().spreadsheets.values.get({ spreadsheetId: dbId(), range: tab });
  return (res.data.values as unknown[][]) ?? [];
}

async function seedIfEmpty(tab: string, rows: string[][]): Promise<void> {
  const cur = await valuesOf(tab);
  if (cur.length > 1) {
    console.log(`  - ${tab}: đã có dữ liệu, bỏ qua seed.`);
    return;
  }
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId: dbId(),
    range: tab,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
  console.log(`  - ${tab}: seed ${rows.length} dòng.`);
}

async function ensureAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL || 'admin@mtjob.local';
  const password = process.env.ADMIN_PASSWORD || 'Admin@2026';
  const rows = await valuesOf('Members');
  const header = (rows[0] ?? []).map(String);
  const emailIdx = header.indexOf('Email');
  const exists = rows.slice(1).some((r) => emailIdx >= 0 && String(r[emailIdx] ?? '').toLowerCase() === email.toLowerCase());
  if (exists) {
    console.log(`  - Admin (${email}) đã tồn tại.`);
    return;
  }
  const hash = await hashPassword(password);
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId: dbId(),
    range: 'Members',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[newId('M-'), 'Quản trị viên', '', 'Admin', '', 'admin', 0, 0, '', email, hash, 'TRUE']],
    },
  });
  console.log(`  - Tạo admin: ${email} / ${password}  (ĐỔI MẬT KHẨU sau khi đăng nhập!)`);
}

async function main(): Promise<void> {
  const id = dbId();
  const sheets = sheetsClient();
  console.log(`Thiết lập Google Sheet: ${id}`);

  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title || ''));

  const addRequests = Object.keys(TABS)
    .filter((t) => !existing.has(t))
    .map((title) => ({ addSheet: { properties: { title } } }));
  if (addRequests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: addRequests } });
    console.log(`Đã tạo ${addRequests.length} tab mới.`);
  }

  console.log('Ghi tiêu đề cột...');
  for (const [tab, header] of Object.entries(TABS)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[...header]] },
    });
  }

  console.log('Seed dữ liệu mẫu...');
  await seedIfEmpty('Config', CONFIG_SEED.map(([k, v]) => [k, v]));
  await seedIfEmpty('TaskCatalog', TASK_CATALOG_SEED.map(([code, name, pts]) => [code, name, String(pts), 'TRUE', '']));
  await seedIfEmpty('Holidays', HOLIDAYS_2026_SEED.map(([d, n]) => [d, n, d.slice(0, 4)]));

  await ensureAdmin();
  console.log('✅ Thiết lập hoàn tất.');
}

main().catch((e) => {
  console.error('❌ Lỗi setup:', e?.message || e);
  process.exit(1);
});
