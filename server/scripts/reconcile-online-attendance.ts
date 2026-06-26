import 'dotenv/config';
import { getAllRequests } from '../src/modules/requests.repo.js';
import { getMemberDate, saveAttendance } from '../src/modules/attendance.repo.js';
import { findById } from '../src/modules/members.repo.js';
import { dayFractionFromShifts } from '../src/lib/attendance.js';
import { closePool } from '../src/db/client.js';
import type { AttendanceRow } from '../src/types.js';

// Đối chiếu các đơn ONLINE đã duyệt với bảng chấm công và bù công còn THIẾU
// (do bug cũ ghi đè / đơn duyệt trước khi có tính năng tự ghi công).
// GỘP theo buổi, chỉ TĂNG công, không bao giờ làm tụt. Có --dry-run để xem trước.

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Reconcile công online theo đơn đã duyệt${dryRun ? ' [DRY-RUN]' : ''}...\n`);

  const approved = (await getAllRequests()).filter(
    (r) => r.kind === 'online' && r.finalStatus === 'approved',
  );

  // Gộp các đơn online cùng (member|date): union buổi sáng/chiều được phủ.
  const map = new Map<string, { memberId: string; date: string; morning: boolean; afternoon: boolean; reqId: string }>();
  for (const r of approved) {
    const scope = r.scope || 'full';
    for (const date of r.dates) {
      const key = `${r.memberId}|${date}`;
      const cur = map.get(key) ?? { memberId: r.memberId, date, morning: false, afternoon: false, reqId: r.id };
      if (scope !== 'half_pm') cur.morning = true;
      if (scope !== 'half_am') cur.afternoon = true;
      map.set(key, cur);
    }
  }

  let changed = 0;
  for (const v of map.values()) {
    const existing = await getMemberDate(v.memberId, v.date);
    const member = existing ? null : await findById(v.memberId);
    const name = existing?.name || member?.fullName || '';

    const morningIn = existing?.morningInAt || (v.morning ? 'online' : '');
    const afternoonIn = existing?.afternoonInAt || (v.afternoon ? 'online' : '');
    const afternoonOut = existing?.afternoonOutAt || '';
    const newFraction = dayFractionFromShifts({ morningIn, afternoonIn, afternoonOut });
    const oldFraction = existing ? Number(existing.dayFraction) : 0;

    if (newFraction <= oldFraction && existing) continue; // không tụt, không đụng dòng đã đủ

    const row: AttendanceRow = existing ?? {
      date: v.date,
      memberId: v.memberId,
      name,
      morningInAt: '',
      morningOutAt: '',
      afternoonInAt: '',
      afternoonOutAt: '',
      dayFraction: 0,
      mode: 'online',
      status: 'absent',
    };
    row.name = name;
    row.morningInAt = morningIn;
    row.afternoonInAt = afternoonIn;
    row.dayFraction = newFraction;
    row.mode = 'online';
    row.status = newFraction >= 1 ? 'present' : 'half';
    if (!row.note) row.note = `Làm online (đơn ${v.reqId})`;

    console.log(`  ${v.date} | ${name}: công ${existing ? oldFraction : 'KHÔNG CÓ DÒNG'} → ${newFraction}`);
    changed++;
    if (!dryRun) await saveAttendance(row);
  }

  console.log(`\n${dryRun ? 'Sẽ cập nhật' : '✅ Đã cập nhật'} ${changed} dòng.`);
  if (dryRun && changed > 0) console.log('Chạy lại không kèm --dry-run để ghi vào DB.');
  await closePool();
}

main().catch(async (e) => {
  console.error('Lỗi reconcile:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
