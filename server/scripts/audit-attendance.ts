import 'dotenv/config';
import { getAllAttendance } from '../src/modules/attendance.repo.js';
import { getConfig } from '../src/config.js';
import { dayFractionFromShifts } from '../src/lib/attendance.js';
import { closePool } from '../src/db/client.js';

// CHỈ ĐỌC — soi toàn bộ bảng attendance, không ghi gì vào DB.
// Liệt kê mọi dòng bất thường theo từng nhóm để rà soát trước khi quyết định sửa.

function recompute(r: { morningInAt?: string; afternoonInAt?: string; afternoonOutAt?: string }): number {
  return dayFractionFromShifts({
    morningIn: r.morningInAt,
    afternoonIn: r.afternoonInAt,
    afternoonOut: r.afternoonOutAt,
  });
}

async function main(): Promise<void> {
  const cfg = await getConfig();
  const radius = cfg.checkinRadiusM;
  const rows = await getAllAttendance();
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));

  console.log(`Tổng số dòng chấm công: ${rows.length}`);
  console.log(`Bán kính cho phép hiện tại (checkinRadiusM): ${radius}m\n`);

  // 1) office/online: day_fraction lưu KHÁC với công thức tính lại.
  const mismatch = rows
    .filter((r) => r.mode === 'office' || r.mode === 'online')
    .map((r) => ({ r, expect: recompute(r) }))
    .filter((x) => x.expect !== x.r.dayFraction);

  console.log(`[1] office/online công lưu ≠ tính lại: ${mismatch.length} dòng`);
  for (const { r, expect } of mismatch) {
    console.log(`    ${r.date} | ${r.name} | ${r.mode} | lưu ${r.dayFraction} → đúng ${expect}` +
      ` | S(${r.morningInAt ? 'in' : '-'}/${r.morningOutAt ? 'out' : '-'}) C(${r.afternoonInAt ? 'in' : '-'}/${r.afternoonOutAt ? 'out' : '-'})`);
  }

  // 2) day_fraction lạ (không thuộc {0, 0.5, 1}).
  const weird = rows.filter((r) => ![0, 0.5, 1].includes(Number(r.dayFraction)));
  console.log(`\n[2] day_fraction không thuộc {0, 0.5, 1}: ${weird.length} dòng`);
  for (const r of weird) console.log(`    ${r.date} | ${r.name} | ${r.mode} | ${r.dayFraction}`);

  // 3) leave nhưng công ≠ 0.
  const badLeave = rows.filter((r) => r.mode === 'leave' && Number(r.dayFraction) !== 0);
  console.log(`\n[3] nghỉ phép (leave) mà công ≠ 0: ${badLeave.length} dòng`);
  for (const r of badLeave) console.log(`    ${r.date} | ${r.name} | ${r.dayFraction}`);

  // 4) office tính công > 0 nhưng KHÔNG có dấu chấm nào (dữ liệu rỗng vẫn được công).
  const ghost = rows.filter(
    (r) => (r.mode === 'office' || r.mode === 'online') && Number(r.dayFraction) > 0 &&
      !r.morningInAt && !r.afternoonInAt && !r.afternoonOutAt,
  );
  console.log(`\n[4] office/online có công nhưng không có mốc giờ nào: ${ghost.length} dòng`);
  for (const r of ghost) console.log(`    ${r.date} | ${r.name} | ${r.mode} | ${r.dayFraction}`);

  // 5) office chấm NGOÀI bán kính (dấu vết bug giờ ra không kiểm tra khoảng cách).
  const farOffice = rows.filter(
    (r) => r.mode === 'office' && r.distM != null && Number(r.distM) > radius,
  );
  console.log(`\n[5] office có dist_m > ${radius}m (chấm ngoài vùng): ${farOffice.length} dòng`);
  for (const r of farOffice) console.log(`    ${r.date} | ${r.name} | ${r.distM}m`);

  // 6) status không khớp công (present cần =1; half cần >0 <1; absent cần =0).
  const statusBad = rows.filter((r) => {
    const f = Number(r.dayFraction);
    const s = r.status;
    if (s === 'present' || s === 'late') return f < 1;
    if (s === 'half' || s === 'late-half') return !(f > 0 && f < 1);
    if (s === 'absent') return f !== 0;
    return false; // leave/holiday/khác: bỏ qua
  });
  console.log(`\n[6] status lệch với công: ${statusBad.length} dòng`);
  for (const r of statusBad) console.log(`    ${r.date} | ${r.name} | ${r.mode} | công ${r.dayFraction} | status ${r.status}`);

  // 7) có giờ ra chiều nhưng KHÔNG có giờ vào nào (ra mà chưa từng vào).
  const outNoIn = rows.filter(
    (r) => (r.mode === 'office') && (r.afternoonOutAt || r.morningOutAt) && !r.morningInAt && !r.afternoonInAt,
  );
  console.log(`\n[7] office có giờ ra nhưng không có giờ vào: ${outNoIn.length} dòng`);
  for (const r of outNoIn) console.log(`    ${r.date} | ${r.name} | công ${r.dayFraction}`);

  console.log('\n— Hết. Script chỉ đọc, không thay đổi DB. —');
  await closePool();
}

main().catch(async (e) => {
  console.error('Lỗi audit:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
