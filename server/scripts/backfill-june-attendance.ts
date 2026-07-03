import 'dotenv/config';
import { getActiveMembers } from '../src/modules/members.repo.js';
import { getAllAttendance, saveAttendance } from '../src/modules/attendance.repo.js';
import { getAllRequests } from '../src/modules/requests.repo.js';
import { getHolidaySet } from '../src/modules/holidays.repo.js';
import { isWorkday } from '../src/lib/workdays.js';
import { dayjs, TZ } from '../src/lib/datetime.js';
import { closePool } from '../src/db/client.js';

// Backfill chấm công đầu tháng 6/2026 (ngày 1–14, giai đoạn chưa dùng phần mềm).
// Quy tắc mỗi (thành viên × ngày làm việc T2–T6):
//   - Đã có dòng chấm công        → GIỮ NGUYÊN (không đè online/nghỉ/office đã có).
//   - Có đơn NGHỈ PHÉP đã duyệt     → bỏ qua (hôm đó nghỉ, không chấm công).
//   - Còn lại                      → chấm ĐỦ 1 công (office, present, 08:30–17:00).
// Chỉ áp cho role member/leader (giám đốc/admin không tính công).

const YEAR = 2026;
const MONTH = 6;
const FROM_DAY = 1;
const TO_DAY = 14;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Backfill chấm công ${String(MONTH).padStart(2, '0')}/${YEAR} ngày ${FROM_DAY}–${TO_DAY}${dryRun ? ' [DRY-RUN]' : ''}...\n`);

  const [members, allAtt, allReq, holidays] = await Promise.all([
    getActiveMembers(),
    getAllAttendance(),
    getAllRequests(),
    getHolidaySet(),
  ]);

  const staff = members.filter((m) => m.role === 'member' || m.role === 'leader');

  // Dòng chấm công đã có: memberId|date
  const hasRow = new Set(allAtt.map((a) => `${a.memberId}|${a.date}`));
  // Ngày nghỉ phép đã duyệt: memberId|date
  const leaveDay = new Set<string>();
  for (const r of allReq) {
    if (r.kind === 'leave' && r.finalStatus === 'approved') {
      for (const d of r.dates) leaveDay.add(`${r.memberId}|${d}`);
    }
  }

  // Ngày làm việc trong khoảng.
  const workdays: string[] = [];
  const base = dayjs(`${YEAR}-${String(MONTH).padStart(2, '0')}-01`);
  for (let d = FROM_DAY; d <= TO_DAY; d++) {
    const iso = base.date(d).format('YYYY-MM-DD');
    if (isWorkday(iso, holidays)) workdays.push(iso);
  }
  console.log(`Ngày làm việc (${workdays.length}): ${workdays.join(', ')}\n`);

  let created = 0;
  let skipLeave = 0;
  let skipExisting = 0;
  const perMember = new Map<string, number>();

  for (const m of staff) {
    for (const iso of workdays) {
      const key = `${m.id}|${iso}`;
      if (hasRow.has(key)) {
        skipExisting++;
        continue;
      }
      if (leaveDay.has(key)) {
        skipLeave++;
        continue;
      }
      const morningInAt = dayjs.tz(`${iso} 08:30`, TZ).toISOString();
      const afternoonOutAt = dayjs.tz(`${iso} 17:00`, TZ).toISOString();
      if (!dryRun) {
        await saveAttendance({
          date: iso,
          memberId: m.id,
          name: m.fullName,
          morningInAt,
          morningOutAt: '',
          afternoonInAt: '',
          afternoonOutAt,
          dayFraction: 1,
          mode: 'office',
          status: 'present',
          note: 'Backfill công đầu tháng (chưa dùng phần mềm)',
        });
      }
      created++;
      perMember.set(m.fullName, (perMember.get(m.fullName) || 0) + 1);
    }
  }

  console.log('Số công tạo mới theo người:');
  for (const [name, n] of [...perMember.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${name}: ${n} công`);
  }
  console.log(`\nTổng: ${dryRun ? 'sẽ tạo' : 'đã tạo'} ${created} dòng công | bỏ qua ${skipLeave} ngày nghỉ phép | giữ ${skipExisting} dòng đã có.`);
  if (dryRun && created > 0) console.log('Chạy lại không kèm --dry-run để ghi vào DB.');
  await closePool();
}

main().catch(async (e) => {
  console.error('Lỗi backfill:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
