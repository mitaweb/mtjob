// Trợ lý hỏi-đáp dữ liệu cho giám đốc/admin: gom snapshot hệ thống rồi nhờ Gemini trả lời.
import { getActiveMembers } from './members.repo.js';
import { getForDate } from './attendance.repo.js';
import { ranking } from './scores.service.js';
import { getAllRequests } from './requests.repo.js';
import { getParties } from './finance.repo.js';
import { generateText, geminiAvailable } from '../gemini/client.js';
import { todayIso } from '../lib/datetime.js';
import { formatVnd } from '../lib/money.js';

/** Trả lời câu hỏi của giám đốc/admin dựa trên dữ liệu hệ thống (chấm công, điểm, đơn, tài chính). */
export async function answerDataQuestion(question: string): Promise<string> {
  if (!(await geminiAvailable())) {
    return 'Tính năng hỏi dữ liệu cần bật Trợ lý AI (Gemini). Vào Quản trị → dán API key Gemini là dùng được ngay.';
  }

  const today = todayIso();
  const [members, attendance, rank, requests, parties] = await Promise.all([
    getActiveMembers(),
    getForDate(today),
    ranking(),
    getAllRequests(),
    getParties().catch(() => []),
  ]);

  // Nhân sự theo team.
  const byTeam = new Map<string, string[]>();
  for (const m of members) {
    const key = m.teamId || '—';
    const arr = byTeam.get(key) || [];
    arr.push(`${m.fullName}${m.role !== 'member' ? ` (${m.role})` : ''}`);
    byTeam.set(key, arr);
  }
  const rosterLines = [...byTeam.entries()].map(([t, list]) => `  ${t}: ${list.join(', ')}`).join('\n');

  // Chấm công hôm nay (kể cả người chưa chấm).
  const attByMember = new Map(attendance.map((a) => [a.memberId, a]));
  const attLines = members
    .map((m) => {
      const a = attByMember.get(m.id);
      return a
        ? `  ${m.fullName}: ${a.status} (${a.mode}, công ${a.dayFraction})`
        : `  ${m.fullName}: chưa chấm công`;
    })
    .join('\n');

  // Bảng điểm tháng.
  const rankLines =
    rank.map((r) => `  #${r.rank} ${r.fullName} [${r.teamId}]: ${r.monthPoints}đ (hôm nay +${r.todayPoints})`).join('\n') ||
    '  (chưa có)';

  // Đơn chờ duyệt.
  const pending = requests.filter((r) => r.finalStatus === 'pending');
  const pendLines = pending.length
    ? pending.map((r) => `  ${r.name}: ${r.kind} ${r.dates.join(', ')}${r.reason ? ` — ${r.reason}` : ''}`).join('\n')
    : '  (không có)';

  // Tài chính.
  const receivable = parties.filter((p) => p.active).reduce((s, p) => s + (Number(p.receivable) || 0), 0);

  const prompt = [
    'Bạn là trợ lý dữ liệu nội bộ của agency marketing MT Digital. Trả lời NGẮN GỌN, chính xác bằng tiếng Việt,',
    'CHỈ dựa vào dữ liệu dưới đây. Nếu dữ liệu chưa đủ để trả lời, nói rõ "dữ liệu hiện có chưa đủ".',
    `Hôm nay: ${today}.`,
    '',
    `NHÂN SỰ ĐANG LÀM (${members.length}) theo team:`,
    rosterLines,
    '',
    'CHẤM CÔNG HÔM NAY (status: present/late/half/absent; mode: office/online/leave):',
    attLines,
    '',
    'BẢNG ĐIỂM THÁNG NÀY (xếp hạng theo điểm):',
    rankLines,
    '',
    'ĐƠN TỪ CHỜ DUYỆT:',
    pendLines,
    '',
    `TÀI CHÍNH: tổng phải thu hiện tại ${formatVnd(receivable)}.`,
    '',
    `Câu hỏi của giám đốc: "${question}"`,
    'Trả lời:',
  ].join('\n');

  try {
    const answer = await generateText(prompt);
    return answer || 'Mình chưa tạo được câu trả lời, thử hỏi lại cụ thể hơn nhé.';
  } catch (e) {
    return `Xin lỗi, chưa truy vấn được dữ liệu lúc này: ${(e as Error).message}`;
  }
}
