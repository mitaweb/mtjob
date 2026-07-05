import 'dotenv/config';
import { q, closePool } from '../src/db/client.js';

// Gộp 2 bản ghi TRÙNG của cùng 1 người thành 1.
//   KEEP = bản GIỮ (có lịch sử task/điểm), DUP = bản TRÙNG sẽ bị xóa.
// Chuyển hết dữ liệu (chấm công, task, đơn, thông báo, push) về KEEP; lấy thông tin
// HR mới nhất (team/role/lương/bhxh/ngày vào/chức vụ) từ DUP (bản vừa sync từ sheet);
// đổi tên KEEP theo NAME cho khớp sheet; rồi xóa DUP.
// Có --dry-run để xem trước.

const KEEP_USER = 'thuthanh'; // giữ (103 task)
const DUP_USER = 'phamthanh'; // xóa (bản trùng)
const NAME = 'Phạm Thu Thanh';

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry-run');
  console.log(`Gộp @${DUP_USER} → @${KEEP_USER} (tên "${NAME}")${dry ? ' [DRY-RUN]' : ''}\n`);

  const keep = (await q(`SELECT * FROM members WHERE username = $1`, [KEEP_USER]))[0];
  const dup = (await q(`SELECT * FROM members WHERE username = $1`, [DUP_USER]))[0];
  if (!keep || !dup) {
    console.log('Không tìm thấy 1 trong 2 bản ghi — có thể đã gộp rồi.');
    await closePool();
    return;
  }
  const keepId = keep.member_id as string;
  const dupId = dup.member_id as string;
  console.log(`KEEP=${keepId} (@${keep.username})  DUP=${dupId} (@${dup.username})`);

  // Báo cáo số lượng bị ảnh hưởng.
  const c = async (sql: string, p: unknown[]) => (await q(sql, p))[0].n as number;
  const attMove = await c(
    `SELECT count(*)::int n FROM attendance WHERE member_id=$1 AND date NOT IN (SELECT date FROM attendance WHERE member_id=$2)`,
    [dupId, keepId],
  );
  const attDrop = (await c(`SELECT count(*)::int n FROM attendance WHERE member_id=$1`, [dupId])) - attMove;
  const dupTasks = await c(`SELECT count(*)::int n FROM tasks WHERE member_id=$1`, [dupId]);
  const keepTasks = await c(`SELECT count(*)::int n FROM tasks WHERE member_id=$1`, [keepId]);
  const dupReq = await c(`SELECT count(*)::int n FROM requests WHERE member_id=$1`, [dupId]);
  console.log(`  Chấm công: chuyển ${attMove} ngày sang KEEP, bỏ ${attDrop} ngày trùng (giữ bản thật của KEEP).`);
  console.log(`  Task: KEEP giữ ${keepTasks}, chuyển thêm ${dupTasks} từ DUP.`);
  console.log(`  Đơn từ: chuyển ${dupReq}.`);
  console.log(`  HR lấy từ DUP: team=${dup.team_id}, role=${dup.role}, lương=${dup.salary}, bhxh=${dup.bhxh}, vào làm=${dup.join_date}`);

  if (dry) {
    console.log('\n[DRY-RUN] chưa ghi gì. Chạy lại không kèm --dry-run để thực hiện.');
    await closePool();
    return;
  }

  // 1) Chấm công: chuyển ngày KEEP chưa có, xóa phần còn lại của DUP.
  await q(
    `UPDATE attendance SET member_id=$1, name=$2 WHERE member_id=$3 AND date NOT IN (SELECT date FROM attendance WHERE member_id=$1)`,
    [keepId, NAME, dupId],
  );
  await q(`DELETE FROM attendance WHERE member_id=$1`, [dupId]);
  await q(`UPDATE attendance SET name=$1 WHERE member_id=$2`, [NAME, keepId]);

  // 2) Task: chuyển DUP → KEEP, đổi tên hiển thị.
  await q(`UPDATE tasks SET member_id=$1, member_name=$2 WHERE member_id=$3`, [keepId, NAME, dupId]);
  await q(`UPDATE tasks SET member_name=$1 WHERE member_id=$2`, [NAME, keepId]);

  // 3) Đơn từ: chuyển DUP → KEEP, đổi tên.
  await q(`UPDATE requests SET member_id=$1, name=$2 WHERE member_id=$3`, [keepId, NAME, dupId]);
  await q(`UPDATE requests SET name=$1 WHERE member_id=$2`, [NAME, keepId]);

  // 4) Thông báo + push: chuyển DUP → KEEP.
  await q(`UPDATE notifications SET member_id=$1 WHERE member_id=$2`, [keepId, dupId]);
  await q(`UPDATE push_subscriptions SET member_id=$1 WHERE member_id=$2`, [keepId, dupId]);

  // 5) Snapshot điểm/lương của DUP: bỏ (sẽ tự tính lại theo KEEP).
  await q(`DELETE FROM monthly_scores WHERE member_id=$1`, [dupId]);
  await q(`DELETE FROM payroll WHERE member_id=$1`, [dupId]);

  // 6) Cập nhật KEEP: tên + thông tin HR mới nhất từ DUP, mở lại active.
  await q(
    `UPDATE members SET full_name=$1, team_id=$2, role=$3, salary=$4, bhxh=$5, join_date=$6, position=$7, dob=$8, active=true
     WHERE member_id=$9`,
    [NAME, dup.team_id, dup.role, dup.salary, dup.bhxh, dup.join_date, dup.position, dup.dob, keepId],
  );

  // 7) Xóa bản trùng.
  await q(`DELETE FROM members WHERE member_id=$1`, [dupId]);

  console.log('\n✅ Đã gộp xong. Kiểm tra lại:');
  const after = (await q(
    `SELECT full_name, username, team_id, role, active, join_date,
            (SELECT count(*)::int FROM tasks t WHERE t.member_id=m.member_id) tasks,
            (SELECT count(*)::int FROM attendance a WHERE a.member_id=m.member_id AND a.date BETWEEN '2026-06-01' AND '2026-06-14') att_june
     FROM members m WHERE member_id=$1`,
    [keepId],
  ))[0];
  console.log(
    `  ${after.full_name} @${after.username} | ${after.team_id}/${after.role} | active=${after.active} | tasks=${after.tasks} | công 1–14/6=${after.att_june}`,
  );
  const dupLeft = await c(`SELECT count(*)::int n FROM members WHERE member_id=$1`, [dupId]);
  console.log(`  Bản trùng còn lại: ${dupLeft} (kỳ vọng 0)`);
  await closePool();
}

main().catch(async (e) => {
  console.error('❌ Lỗi gộp:', e?.message || e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
