import { getActiveMembers, getDirectors } from '../modules/members.repo.js';
import { getTeams } from '../modules/teams.repo.js';
import { getScoringTasks } from '../modules/tasks.repo.js';
import { memberScore, ranking } from '../modules/scores.service.js';
import { taskTitle } from '../lib/tasks.js';
import type { TaskRow } from '../types.js';
import { notify } from '../modules/notifications.service.js';
import { getParties } from '../modules/finance.repo.js';
import { getUpcoming, getCustomers } from '../modules/crm.repo.js';
import { birthdaysInMonth } from '../lib/people.js';
import { formatVnd } from '../lib/money.js';
import { formatMinutes } from '../lib/worktime.js';
import { nextDueDateIso, daysUntil } from '../lib/finance.js';
import { nowTz, todayIso, fmtDate, fmtHm } from '../lib/datetime.js';
import { backfillPage, rebuildDirtyProfiles } from '../modules/brain.service.js';

const DUE_REMINDER_DAYS = 5;

// Mỗi lượt job nạp tối đa ngần này mục vào kho tri thức (tránh chạy quá lâu/tốn quota).
const BRAIN_MAX_PER_RUN = 300;

/** Nạp dần dữ liệu cũ vào kho tri thức cho tới khi hết hoặc chạm hạn mức của lượt này. */
async function sweepBrainBackfill(): Promise<void> {
  let done = 0;
  for (;;) {
    const r = await backfillPage(30);
    done += r.ingested;
    if (r.ingested === 0 || r.remaining === 0 || done >= BRAIN_MAX_PER_RUN) break;
  }
  // Dựng nốt hồ sơ 360° của các khách còn chờ (backfillPage mỗi lượt chỉ dựng 3 hồ sơ).
  let profiles = 0;
  for (let i = 0; i < 20; i++) {
    const n = await rebuildDirtyProfiles(3);
    if (n === 0) break;
    profiles += n;
  }
  if (done > 0 || profiles > 0) console.log(`[brain] job nạp ${done} mục, dựng ${profiles} hồ sơ khách`);
}

// Tối đa số việc liệt kê chi tiết trong báo cáo ngày (tránh body quá dài).
const MAX_TASKS_IN_REPORT = 15;

/** Các việc 1 thành viên ĐÃ HOÀN THÀNH trong ngày `todayIso` (bỏ việc đang làm). */
function tasksDoneToday(tasks: TaskRow[], memberId: string, todayIso: string): TaskRow[] {
  return tasks.filter(
    (t) =>
      t.memberId === memberId &&
      t.status === 'done' &&
      (t.completedAt || t.createdAt || '').slice(0, 10) === todayIso,
  );
}

/** Dòng liệt kê việc hoàn thành hôm nay cho báo cáo cá nhân. */
function doneTasksLine(done: TaskRow[]): string {
  if (done.length === 0) return '\n\n✅ Hôm nay chưa ghi nhận việc hoàn thành.';
  const shown = done.slice(0, MAX_TASKS_IN_REPORT);
  const lines = shown.map((t) => `• ${taskTitle(t)} (+${t.points}đ)`).join('\n');
  const more = done.length > shown.length ? `\n… và ${done.length - shown.length} việc khác.` : '';
  return `\n\n✅ Việc hoàn thành hôm nay (${done.length}):\n${lines}${more}`;
}

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

/**
 * Nhắc sinh nhật KHÁCH HÀNG trong tháng — gửi LIÊN TỤC mỗi ngày để có thời gian
 * chuẩn bị quà/lời chúc. Gửi cho giám đốc + sale phụ trách khách đó.
 */
export async function runCustomerBirthdayReminders(): Promise<void> {
  const now = nowTz();
  const month = now.month() + 1;
  const today = now.date();
  const customers = (await getCustomers()).filter((c) => c.dob);
  const inMonth = birthdaysInMonth(
    customers.map((c) => ({ fullName: c.name, dob: c.dob, id: c.id, assignedTo: c.assignedTo })),
    month,
  );
  if (inMonth.length === 0) return;

  const dayOf = (dob: string) => Number(dob.slice(-2)) || 0;
  const line = (c: { fullName: string; dob: string }) => {
    const d = dayOf(c.dob);
    const when = d === today ? 'HÔM NAY 🎉' : d > today ? `còn ${d - today} ngày` : 'đã qua';
    return `• ${c.fullName} — ngày ${d}/${month} (${when})`;
  };
  const body = `Sinh nhật khách hàng tháng ${month}:\n${inMonth.map(line).join('\n')}\n\nChuẩn bị quà/lời chúc giúp giữ khách nhé.`;

  const directors = await getDirectors();
  for (const d of directors) {
    await notify(d.id, { type: 'customer_birthday', title: 'Sinh nhật khách hàng 🎂', body, url: '/crm' });
  }
  // Sale phụ trách chỉ nhận phần khách của mình.
  const byOwner = new Map<string, typeof inMonth>();
  for (const c of inMonth) {
    if (!c.assignedTo || directors.some((d) => d.id === c.assignedTo)) continue;
    byOwner.set(c.assignedTo, [...(byOwner.get(c.assignedTo) || []), c]);
  }
  for (const [ownerId, list] of byOwner) {
    await notify(ownerId, {
      type: 'customer_birthday',
      title: 'Sinh nhật khách bạn phụ trách 🎂',
      body: `Tháng ${month}:\n${list.map(line).join('\n')}`,
      url: '/crm',
    });
  }
}

/** Nhắc lịch hẹn khách hàng của NGÀY MAI → gửi cho người phụ trách. */
export async function runAppointmentReminders(): Promise<void> {
  const start = nowTz().add(1, 'day').startOf('day').toISOString();
  const end = nowTz().add(1, 'day').endOf('day').toISOString();
  for (const a of await getUpcoming(start, end)) {
    if (!a.ownerId) continue;
    await notify(a.ownerId, {
      type: 'appointment',
      title: 'Nhắc lịch hẹn khách 📅',
      body: `Mai ${fmtHm(a.at)} có hẹn với ${a.customerName}${a.note ? ` — ${a.note}` : ''}.`,
      url: '/crm',
    });
  }
}

/** Daily personal + leader + director reports (birthdays + bonus included). */
export async function runDailyReports(): Promise<void> {
  const now = nowTz();
  const dd = now.format('DD/MM');
  const month = now.month() + 1;

  const today = todayIso();
  const allTasks = await getScoringTasks(today, today, today);
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
    const tasksLine = doneTasksLine(tasksDoneToday(allTasks, m.id, today));
    await notify(m.id, {
      type: 'daily',
      title: `Báo cáo điểm ngày ${dd}`,
      body: `Hôm nay: +${s.todayPoints}đ · ⏱ ${formatMinutes(s.workMinutesToday)} làm việc. Lũy kế tháng: ${s.monthPoints}đ.${bonusLine}${tasksLine}${birthdayLine}`,
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

  // Nhắc thu tiền các bên sắp tới hạn + nhắc lịch hẹn khách ngày mai.
  await runFinanceReminders().catch((e) => console.error('[finance reminders]', e));
  await runAppointmentReminders().catch((e) => console.error('[appointment reminders]', e));
  await runCustomerBirthdayReminders().catch((e) => console.error('[customer birthdays]', e));

  // Lưới an toàn cho kho tri thức: nạp nốt dữ liệu cũ/sót, kể cả khi app ít người dùng.
  await sweepBrainBackfill().catch((e) => console.error('[brain backfill]', e));
}
