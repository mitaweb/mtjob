import 'dotenv/config';
import { getAllRequests } from '../src/modules/requests.repo.js';
import { getMemberDate } from '../src/modules/attendance.repo.js';
import { fractionForScope } from '../src/lib/attendance.js';
import { closePool } from '../src/db/client.js';

// CHỈ ĐỌC — soi đơn online/nghỉ phép đã duyệt và đối chiếu với công thực tế.

async function main(): Promise<void> {
  const all = await getAllRequests();
  const approved = all.filter((r) => r.finalStatus === 'approved');
  console.log(`Đơn đã duyệt: ${approved.length} (tổng ${all.length})\n`);

  let mismatch = 0;
  for (const r of approved) {
    for (const date of r.dates) {
      const att = await getMemberDate(r.memberId, date);
      const fHave = att ? Number(att.dayFraction) : null;
      const fWant = r.kind === 'online' ? fractionForScope(r.scope || 'full') : 0;
      const flag = fHave === fWant ? 'OK ' : '⚠️ ';
      if (fHave !== fWant) mismatch++;
      console.log(
        `${flag}${r.kind} | ${date} | ${r.name} | scope=${r.scope ?? '(none)'} | đáng lẽ ${fWant} | thực tế ${fHave ?? 'KHÔNG CÓ DÒNG'} | mode=${att?.mode ?? '-'} | status=${att?.status ?? '-'}`,
      );
    }
  }

  console.log(`\nSố dòng lệch: ${mismatch}`);
  console.log('— Hết. Script chỉ đọc, không thay đổi DB. —');
  await closePool();
}

main().catch(async (e) => {
  console.error('Lỗi audit:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
