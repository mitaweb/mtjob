import 'dotenv/config';
import { getAllRequests } from '../src/modules/requests.repo.js';
import { getMemberDate } from '../src/modules/attendance.repo.js';
import { closePool } from '../src/db/client.js';

// CHỈ ĐỌC — soi đơn online đã duyệt và đối chiếu với công thực tế.
// GỘP các đơn cùng (member|date): công online đáng lẽ = union buổi được phủ.
// Chỉ CẢNH BÁO khi công thực tế THIẾU so với quyền online (công dư là do chấm
// thêm ở văn phòng — hợp lệ, không báo).

async function main(): Promise<void> {
  const all = await getAllRequests();
  const onlineApproved = all.filter((r) => r.kind === 'online' && r.finalStatus === 'approved');
  console.log(`Đơn online đã duyệt: ${onlineApproved.length} (tổng ${all.length})\n`);

  // Union buổi sáng/chiều theo (member|date).
  const map = new Map<string, { date: string; name: string; morning: boolean; afternoon: boolean }>();
  for (const r of onlineApproved) {
    const scope = r.scope || 'full';
    for (const date of r.dates) {
      const key = `${r.memberId}|${date}`;
      const cur = map.get(key) ?? { date, name: r.name, morning: false, afternoon: false };
      if (scope !== 'half_pm') cur.morning = true;
      if (scope !== 'half_am') cur.afternoon = true;
      map.set(key, cur);
    }
  }

  let under = 0;
  for (const [key, v] of map) {
    const memberId = key.split('|')[0]!;
    const want = (v.morning ? 0.5 : 0) + (v.afternoon ? 0.5 : 0);
    const att = await getMemberDate(memberId, v.date);
    const have = att ? Number(att.dayFraction) : 0;
    const ok = have >= want;
    if (!ok) under++;
    console.log(
      `${ok ? 'OK ' : '⚠️ '}${v.date} | ${v.name} | online phủ ${v.morning ? 'S' : '-'}${v.afternoon ? 'C' : '-'} | tối thiểu ${want} | thực tế ${att ? have : 'KHÔNG CÓ DÒNG'}`,
    );
  }

  console.log(`\nSố ngày bị THIẾU công online: ${under}`);
  console.log('— Hết. Script chỉ đọc, không thay đổi DB. —');
  await closePool();
}

main().catch(async (e) => {
  console.error('Lỗi audit:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
