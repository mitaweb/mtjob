import { ranking } from '../modules/scores.service.js';
import { savePayrollSnapshot } from '../modules/payroll.service.js';
import { appendObjects } from '../sheets/repo.js';
import { notify } from '../modules/notifications.service.js';
import { getActiveMembers, getDirectors } from '../modules/members.repo.js';
import { formatVnd } from '../lib/money.js';
import { nowTz } from '../lib/datetime.js';

const MEDAL = ['🥇', '🥈', '🥉'];

/** First-of-month job: previous-month ranking (top 1-2-3) + công & payroll. */
export async function runMonthlyReport(): Promise<void> {
  const prev = nowTz().subtract(1, 'month');
  const year = prev.year();
  const month = prev.month() + 1;

  // 1) Ranking snapshot.
  const ranked = await ranking(year, month);
  await appendObjects(
    'MonthlyScores',
    ranked.map((r) => ({
      Year: year,
      Month: month,
      MemberID: r.memberId,
      TotalPoints: r.monthPoints,
      Rank: r.rank,
      BonusVND: r.bonus,
    })),
  );
  const top3 = ranked.filter((r) => r.rank <= 3 && r.monthPoints > 0);
  const top3Line = top3.map((r) => `${MEDAL[r.rank - 1] || ''} #${r.rank} ${r.fullName} — ${r.monthPoints}đ`).join('\n');

  // 2) Payroll snapshot.
  const payroll = await savePayrollSnapshot(year, month);
  const payByMember = new Map(payroll.map((p) => [p.memberId, p]));

  // 3) Personal monthly notification: ranking + bonus + công + lương.
  const members = await getActiveMembers();
  for (const m of members) {
    const r = ranked.find((x) => x.memberId === m.id);
    const p = payByMember.get(m.id);
    const parts = [`Tổng điểm tháng ${month}/${year}: ${r?.monthPoints || 0}đ (hạng ${r?.rank || '-'}).`];
    if (r && r.bonus > 0) parts.push(`💰 Thưởng: ${formatVnd(r.bonus)}.`);
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

  // 5) Director: full công/lương table.
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
