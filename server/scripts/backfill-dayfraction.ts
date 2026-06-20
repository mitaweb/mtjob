import 'dotenv/config';
import { getAllAttendance, saveAttendance } from '../src/modules/attendance.repo.js';
import { dayFractionFromShifts } from '../src/lib/attendance.js';
import { closePool } from '../src/db/client.js';

// Tính lại trạng thái theo công (giữ nguyên "đi trễ" nếu trạng thái cũ đang là late*).
function computeStatus(fraction: number, late: boolean): string {
  if (fraction >= 1) return late ? 'late' : 'present';
  if (fraction > 0) return late ? 'late-half' : 'half';
  return 'absent';
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(
    `Tính lại công theo quy tắc mới (giờ vào sáng + giờ ra chiều = 1 công)${dryRun ? ' [DRY-RUN]' : ''}...`,
  );

  const rows = await getAllAttendance();
  // Chỉ đụng tới chấm công thực tế; bỏ qua nghỉ phép/ngày lễ (công do request quy định).
  const target = rows.filter((r) => r.mode === 'office' || r.mode === 'online');

  let changed = 0;
  for (const r of target) {
    const newFraction = dayFractionFromShifts({
      morningIn: r.morningInAt,
      afternoonIn: r.afternoonInAt,
      afternoonOut: r.afternoonOutAt,
    });
    if (newFraction === r.dayFraction) continue;

    const newStatus = computeStatus(newFraction, /^late/.test(r.status));
    console.log(
      `  ${r.date} | ${r.name}: công ${r.dayFraction} → ${newFraction} | trạng thái ${r.status} → ${newStatus}`,
    );
    changed++;
    if (!dryRun) {
      await saveAttendance({ ...r, dayFraction: newFraction, status: newStatus });
    }
  }

  console.log(
    `\n${dryRun ? 'Sẽ cập nhật' : '✅ Đã cập nhật'} ${changed}/${target.length} dòng chấm công.`,
  );
  if (dryRun && changed > 0) console.log('Chạy lại không kèm --dry-run để ghi vào DB.');
  await closePool();
}

main().catch(async (e) => {
  console.error('❌ Lỗi backfill:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
