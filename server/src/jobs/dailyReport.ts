import { getActiveMembers, getDirectors } from '../modules/members.repo.js';
import { getTeams } from '../modules/teams.repo.js';
import { memberScore, ranking } from '../modules/scores.service.js';
import { notify } from '../modules/notifications.service.js';
import { getParties } from '../modules/finance.repo.js';
import { birthdaysInMonth } from '../lib/people.js';
import { formatVnd } from '../lib/money.js';
import { formatMinutes } from '../lib/worktime.js';
import { nextDueDateIso, daysUntil } from '../lib/finance.js';
import { nowTz, todayIso, fmtDate } from '../lib/datetime.js';

const DUE_REMINDER_DAYS = 5;

/** Nhắc thu tiền: 5 ngày trước hạn thu của từng bên → gửi cho người được chọn (mặc định giám đốc). */
export async function runFinanceReminders(): Promise<void> {
  const today = todayIso();
  const parties = (await getParties()).filter((p) => p.active && p.receivable > 0);
  if (parties.length === 0) return;
  let directorIds: string[] | null = null;
  for (const p of parties) {
    const due = nextDueDateIso(p.dueDay, today);
    if (daysUntil(due, today) !== DUE_REMINDER_DAYS) continue;
    let recipients = p.notifyMemberIds;
    if (recipients.length === 0) {
      if (!directorIds) directorIds = (await getDirectors()).map((d) => d.id);
      recipients = directorIds;
    }
    for (const id of recipients) {
      await notify(id, {
        type: 'finance_due',
        title: 'Sắp tới hạn thu tiền 💰',
        body: `${p.name}: ${formatVnd(p.receivable)} — hạn ${fmtDate(due)} (còn ${DUE_REMINDER_DAYS} ngày).`,
        url: '/finance',
      });
    }
  }
}

/** Daily personal + leader + director reports (birthdays + bonus included). */
export async function runDailyReports(): Promise<void> {
  const now = nowTz();
  const dd = now.format('DD/MM');
  const month = now.month() + 1;

  const members = await getActiveMembers();
  const birthdays = birthdaysInMonth(
    members.map((m) => ({ fullName: m.fullName, dob: m.dob })),
    month,
  );
  const birthdayLine = birthdays.length
    ? `\n🎂 Sinh nhật tháng này: ${birthdays.map((b) => b.fullName).join(', ')}. Chúc mừng sinh nhật! 🎉`
    : '';

  // Personal report (giám đốc không làm task → không gửi báo cáo điểm cá nhân).
  for (const m of members) {
    if (m.role === 'director') continue;
    const s = await memberScore(m.id);
    const bonusLine = s.bonus > 0 ? `\n💰 Thưởng hiện tại: ${formatVnd(s.bonus)}.` : '';
    await notify(m.id, {
      type: 'daily',
      title: `Báo cáo điểm ngày ${dd}`,
      body: `Hôm nay: +${s.todayPoints}đ · ⏱ ${formatMinutes(s.workMinutesToday)} làm việc. Lũy kế tháng: ${s.monthPoints}đ.${bonusLine}${birthdayLine}`,
      url: '/scores',
    });
  }

  // Leader: team report.
  const teams = await getTeams();
  for (const t of teams) {
    if (!t.leaderMemberId) continue;
    const lines = await ranking(undefined, undefined, t.id);
    const body =
      lines.map((l, i) => `${i + 1}. ${l.fullName}: ${l.monthPoints}đ (+${l.todayPoints} hôm nay)`).join('\n') ||
      'Chưa có dữ liệu.';
    await notify(t.leaderMemberId, {
      type: 'daily_team',
      title: `Báo cáo team ${t.name} — ${dd}`,
      body,
      url: '/dashboard',
    });
  }

  // Director: whole-company report.
  const all = await ranking();
  const dirBody =
    all.slice(0, 30).map((l) => `#${l.rank} ${l.fullName}: ${l.monthPoints}đ`).join('\n') || 'Chưa có dữ liệu.';
  for (const d of await getDirectors()) {
    await notify(d.id, {
      type: 'daily_all',
      title: `Báo cáo toàn công ty — ${dd}`,
      body: dirBody,
      url: '/dashboard',
    });
  }

  // Nhắc thu tiền các bên sắp tới hạn.
  await runFinanceReminders().catch((e) => console.error('[finance reminders]', e));
}
