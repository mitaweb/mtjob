import 'dotenv/config';
import { getActiveMembers } from '../src/modules/members.repo.js';
import { getAllAttendance } from '../src/modules/attendance.repo.js';
import { q, closePool } from '../src/db/client.js';

// Dọn công backfill bị tạo NHẦM cho ngày TRƯỚC ngày vào làm của nhân sự
// (vd bạn mới vào giữa tháng). Chỉ xóa dòng do backfill tạo, không đụng dữ liệu thật.

const NOTE = 'Backfill công đầu tháng (chưa dùng phần mềm)';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Dọn công backfill trước ngày vào làm${dryRun ? ' [DRY-RUN]' : ''}...\n`);

  const [members, allAtt] = await Promise.all([getActiveMembers(), getAllAttendance()]);
  const joinById = new Map(members.map((m) => [m.id, { name: m.fullName, join: m.joinDate || '' }]));

  const toDelete = allAtt.filter((a) => {
    if (a.note !== NOTE) return false;
    const info = joinById.get(a.memberId);
    if (!info || !info.join) return false;
    return a.date < info.join; // ngày công < ngày vào làm → sai
  });

  if (toDelete.length === 0) {
    console.log('Không có dòng công backfill nào trước ngày vào làm. Không cần xóa.');
    await closePool();
    return;
  }

  const byName = new Map<string, string[]>();
  for (const a of toDelete) {
    const name = joinById.get(a.memberId)?.name || a.memberId;
    const arr = byName.get(name) || [];
    arr.push(a.date);
    byName.set(name, arr);
  }
  for (const [name, dates] of byName) {
    const join = joinById.get([...joinById].find(([, v]) => v.name === name)?.[0] || '')?.join || '';
    console.log(`  ${name} (vào làm ${join}): xóa ${dates.length} ngày — ${dates.sort().join(', ')}`);
  }

  if (!dryRun) {
    for (const a of toDelete) {
      await q('DELETE FROM attendance WHERE member_id = $1 AND date = $2 AND note = $3', [a.memberId, a.date, NOTE]);
    }
  }

  console.log(`\nTổng: ${dryRun ? 'sẽ xóa' : 'đã xóa'} ${toDelete.length} dòng công backfill sai.`);
  if (dryRun) console.log('Chạy lại không kèm --dry-run để ghi vào DB.');
  await closePool();
}

main().catch(async (e) => {
  console.error('Lỗi:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
