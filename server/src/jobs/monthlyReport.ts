import { ranking, memberScore } from '../modules/scores.service.js';
import { savePayrollSnapshot } from '../modules/payroll.service.js';
import { q } from '../db/client.js';
import { notify } from '../modules/notifications.service.js';
import { getActiveMembers, getDirectors } from '../modules/members.repo.js';
import { pruneNotificationsBefore } from '../modules/notifications.repo.js';
import { formatVnd } from '../lib/money.js';
import { nowTz } from '../lib/datetime.js';

const NOTIFICATION_RETENTION_DAYS = 90;

const MEDAL = ['🥇', '🥈', '🥉'];

/** First-of-month job: previous-month ranking (top 1-2-3) + công & payroll. */
export async function runMonthlyReport(): Promise<void> {
  const prev = nowTz().subtract(1, 'month');
  const year = prev.year();
  const month = prev.month() + 1;

  // 1) Ranking snapshot.
  const ranked = await ranking(year, month);
  for (const r of ranked) {
    await q(
      `INSERT INTO monthly_scores (year, month, member_id, total_points, rank, bonus_vnd)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (year, month, member_id) DO UPDATE SET
         total_points = EXCLUDED.total_points, rank = EXCLUDED.rank, bonus_vnd = EXCLUDED.bonus_vnd`,
      [year, month, r.memberId, r.monthPoints, r.rank, r.bonus],
    );
  }
  const top3 = ranked.filter((r) => r.rank <= 3 && r.monthPoints > 0);
  const top3Line = top3.map((r) => `${MEDAL[r.rank - 1] || ''} #${r.rank} ${r.fullName} — ${r.monthPoints}đ`).join('\n');

  // 2) Payroll snapshot.
  const payroll = await savePayrollSnapshot(year, month);
  const payByMember = new Map(payroll.map((p) => [p.memberId, p]));

  // 3) Personal monthly notification: điểm + thưởng cho TẤT CẢ (kể cả leader/GĐ
  //    — họ không vào bảng xếp hạng nhưng vẫn có điểm/thưởng cá nhân).
  const members = await getActiveMembers();
  for (const m of members) {
    const s = await memberScore(m.id, year, month);
    const r = ranked.find((x) => x.memberId === m.id);
    const p = payByMember.get(m.id);
    const parts = [`Tổng điểm tháng ${month}/${year}: ${s.monthPoints}đ${r ? ` (hạng ${r.rank})` : ''}.`];
    if (s.bonus > 0) parts.push(`💰 Thưởng: ${formatVnd(s.bonus)}.`);
    if (p) parts.push(`🗓️ Công làm: ${p.actualDays}/${p.standardDays} ngày. Lương thực lãnh: ${formatVnd(p.netSalary)}.`);
    await notify(m.id, {
      type: 'monthly',
      title: `Tổng kết tháng ${month}/${year}`,
      body: parts.join('\n'),
      url: '/payroll',
    });
  }

  // 4) Broadcast Top 1-2-3 to everyone.
  if (top3Line) {
    for (const m of members) {
      await notify(m.id, {
        type: 'ranking',
        title: `🏆 Bảng xếp hạng tháng ${month}/${year}`,
        body: `Chúc mừng Top 3 xuất sắc:\n${top3Line}`,
        url: '/dashboard',
      });
    }
  }

  // 5) Retention: prune notifications older than 90 days so the DB stays tiny.
  const cutoff = nowTz().subtract(NOTIFICATION_RETENTION_DAYS, 'day').toISOString();
  const pruned = await pruneNotificationsBefore(cutoff).catch(() => 0);
  if (pruned > 0) console.log(`[monthly] đã dọn ${pruned} thông báo cũ (>${NOTIFICATION_RETENTION_DAYS} ngày)`);

  // 6) Director: full công/lương table.
  const dirBody =
    payroll.map((p) => `${p.fullName}: ${p.actualDays}/${p.standardDays} ngày → ${formatVnd(p.netSalary)}`).join('\n') ||
    '—';
  for (const d of await getDirectors()) {
    await notify(d.id, {
      type: 'monthly_payroll',
      title: `Bảng công/lương tháng ${month}/${year}`,
      body: dirBody,
      url: '/dashboard',
    });
  }
}
