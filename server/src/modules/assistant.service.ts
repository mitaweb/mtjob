// Trợ lý hỏi-đáp dữ liệu bằng Gemini function-calling:
// - Giám đốc/admin: hỏi toàn bộ dữ liệu (nhân sự, chấm công, điểm, đơn, tài chính) — AI tự
//   gọi đúng hàm cần thiết nên hỏi được cả quá khứ ("hôm qua ai vắng", "điểm tháng trước").
// - Nhân viên: chỉ dữ liệu CỦA CHÍNH MÌNH — giới hạn cứng ở tầng tool, không phụ thuộc prompt.
import { getActiveMembers, findById } from './members.repo.js';
import { getForDate, getForMemberRange } from './attendance.repo.js';
import { ranking, memberScore } from './scores.service.js';
import { getAllRequests } from './requests.repo.js';
import { getParties, getEntries } from './finance.repo.js';
import { getDoneTasksForMemberRange } from './tasks.repo.js';
import { getActiveCatalog } from './catalog.repo.js';
import { getProvider, aiAvailable } from '../ai/index.js';
import type { GeminiContent, GeminiPart } from '../gemini/client.js';
import { todayIso, nowTz, monthRange } from '../lib/datetime.js';
import { formatVnd } from '../lib/money.js';
import { formatMinutes } from '../lib/worktime.js';
import { removeAccents } from '../lib/people.js';

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

const FRIENDLY_ERROR = 'Xin lỗi, trợ lý đang bận, thử lại sau ít phút nhé.';
const MAX_ROUNDS = 5; // chặn vòng lặp functionCall vô hạn
const MAX_HISTORY_CHARS = 4000;

// ── Khai báo tool + hàm chạy ──
interface ToolDef {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  declaration: { name: string; description: string; parameters?: any };
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

function currentYm(): { year: number; month: number } {
  const now = nowTz();
  return { year: now.year(), month: now.month() + 1 };
}

function argMonth(args: Record<string, unknown>): { year: number; month: number } {
  const cur = currentYm();
  const year = Number(args.year) || cur.year;
  const month = Number(args.month) || cur.month;
  return { year, month };
}

const MONTH_PARAMS = {
  type: 'OBJECT',
  properties: {
    year: { type: 'NUMBER', description: 'Năm (vd 2026). Bỏ trống = năm hiện tại.' },
    month: { type: 'NUMBER', description: 'Tháng 1-12. Bỏ trống = tháng hiện tại.' },
  },
};

// ── Formatter dùng chung (tool result gọn để tiết kiệm token) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rosterText(): Promise<string> {
  const members = await getActiveMembers();
  const byTeam = new Map<string, string[]>();
  for (const m of members) {
    const key = m.teamId || '—';
    const arr = byTeam.get(key) || [];
    arr.push(`${m.fullName}${m.role !== 'member' ? ` (${m.role})` : ''}`);
    byTeam.set(key, arr);
  }
  const lines = [...byTeam.entries()].map(([t, list]) => `${t}: ${list.join(', ')}`).join('\n');
  return `Nhân sự đang làm (${members.length}) theo team:\n${lines}`;
}

async function attendanceText(date: string): Promise<string> {
  const [members, attendance] = await Promise.all([getActiveMembers(), getForDate(date)]);
  const attByMember = new Map(attendance.map((a) => [a.memberId, a]));
  const lines = members
    .map((m) => {
      const a = attByMember.get(m.id);
      return a
        ? `${m.fullName}: ${a.status} (${a.mode}, công ${a.dayFraction})`
        : `${m.fullName}: chưa chấm công`;
    })
    .join('\n');
  return `Chấm công ngày ${date} (status: present/late/half/absent/leave; mode: office/online/leave):\n${lines}`;
}

async function rankingText(year: number, month: number, teamId?: string): Promise<string> {
  const rank = await ranking(year, month, teamId || undefined);
  const lines =
    rank
      .map(
        (r) =>
          `#${r.rank} ${r.fullName} [${r.teamId}]: ${r.monthPoints}đ (hôm nay +${r.todayPoints}), thưởng ${formatVnd(r.bonus)}`,
      )
      .join('\n') || '(chưa có dữ liệu)';
  return `Bảng điểm tháng ${month}/${year}${teamId ? ` — team ${teamId}` : ''}:\n${lines}`;
}

async function pendingRequestsText(): Promise<string> {
  const requests = await getAllRequests();
  const pending = requests.filter((r) => r.finalStatus === 'pending');
  if (pending.length === 0) return 'Không có đơn nào chờ duyệt.';
  const lines = pending
    .map(
      (r) =>
        `${r.name}: ${r.kind} ${r.dates.join(', ')}${r.reason ? ` — ${r.reason}` : ''} (leader: ${r.leaderStatus}, giám đốc: ${r.directorStatus})`,
    )
    .join('\n');
  return `Đơn chờ duyệt (${pending.length}):\n${lines}`;
}

async function financeText(monthYm: string): Promise<string> {
  const [parties, entries] = await Promise.all([getParties().catch(() => []), getEntries(monthYm).catch(() => [])]);
  const receivable = parties.filter((p) => p.active).reduce((s, p) => s + (Number(p.receivable) || 0), 0);
  const income = entries.filter((e) => e.kind === 'thu').reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter((e) => e.kind === 'chi').reduce((s, e) => s + e.amount, 0);
  const entryLines = entries
    .slice(0, 30)
    .map((e) => `${e.kind === 'thu' ? 'Thu' : 'Chi'}: ${e.name} ${formatVnd(e.amount)}${e.date ? ` (${e.date})` : ''}`)
    .join('\n');
  return [
    `Tài chính tháng ${monthYm}: Thu ${formatVnd(income)}, Chi ${formatVnd(expense)}, Lãi/Lỗ ${formatVnd(income - expense)}.`,
    `Tổng công nợ phải thu mỗi kỳ: ${formatVnd(receivable)} (${parties.filter((p) => p.active).length} bên).`,
    entries.length ? `Các khoản:\n${entryLines}` : 'Chưa có khoản thu/chi nào trong tháng.',
  ].join('\n');
}

async function memberTasksText(memberId: string, year: number, month: number): Promise<string> {
  const { start, end } = monthRange(year, month);
  const tasks = await getDoneTasksForMemberRange(memberId, start, end);
  if (tasks.length === 0) return `Tháng ${month}/${year}: chưa có việc hoàn thành nào.`;
  const total = tasks.reduce((s, t) => s + (Number(t.points) || 0), 0);
  const lines = tasks
    .slice(0, 40)
    .map((t) => `${(t.completedAt || t.createdAt).slice(0, 10)}: ${t.taskName}${t.note ? ` (${t.note})` : ''} +${t.points}đ`)
    .join('\n');
  return `Việc hoàn thành tháng ${month}/${year} (${tasks.length} việc, tổng ${total}đ):\n${lines}`;
}

async function myScoreText(memberId: string, year: number, month: number): Promise<string> {
  const s = await memberScore(memberId, year, month);
  const rank = (await ranking(year, month)).find((r) => r.memberId === memberId);
  return [
    `Điểm tháng ${month}/${year}: ${s.monthPoints}đ (hôm nay +${s.todayPoints}đ).`,
    `Thưởng theo điểm: ${formatVnd(s.bonus)}.`,
    `Giờ làm hôm nay: ${formatMinutes(s.workMinutesToday)}.`,
    rank ? `Xếp hạng tháng: #${rank.rank}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function myAttendanceText(memberId: string, year: number, month: number): Promise<string> {
  const { start, end } = monthRange(year, month);
  const records = await getForMemberRange(memberId, start, end);
  const total = records.reduce((s, r) => s + (Number(r.dayFraction) || 0), 0);
  const lines = records
    .map((r) => `${r.date}: ${r.status || '—'} (${r.mode}, công ${r.dayFraction})`)
    .join('\n');
  return `Chấm công tháng ${month}/${year}: tổng ${total} công.\n${lines || '(chưa có ngày nào)'}`;
}

async function myRequestsText(memberId: string): Promise<string> {
  const requests = (await getAllRequests()).filter((r) => r.memberId === memberId);
  if (requests.length === 0) return 'Bạn chưa có đơn từ nào.';
  const viStatus = (s: string) => (s === 'approved' ? 'đã duyệt' : s === 'rejected' ? 'bị từ chối' : 'chờ duyệt');
  const lines = requests
    .slice(0, 10)
    .map((r) => `${r.kind} ${r.dates.join(', ')}${r.reason ? ` — ${r.reason}` : ''}: ${viStatus(r.finalStatus)}`)
    .join('\n');
  return `Đơn từ của bạn (mới nhất trước):\n${lines}`;
}

async function catalogText(): Promise<string> {
  const catalog = await getActiveCatalog();
  return `Danh mục loại việc (điểm):\n${catalog.map((c) => `${c.code}: ${c.name} (${c.points}đ)`).join('\n')}`;
}

// ── Vòng lặp function-calling ──

async function runToolLoop(opts: {
  system: string;
  question: string;
  history: ChatTurn[];
  tools: ToolDef[];
}): Promise<string> {
  const byName = new Map(opts.tools.map((t) => [t.declaration.name, t]));

  // Giới hạn history: 10 lượt gần nhất + tổng ký tự.
  let chars = 0;
  const trimmed: ChatTurn[] = [];
  for (const h of opts.history.slice(-10).reverse()) {
    chars += h.text.length;
    if (chars > MAX_HISTORY_CHARS) break;
    trimmed.unshift(h);
  }

  const contents: GeminiContent[] = [
    ...trimmed.map((h): GeminiContent => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: opts.question }] },
  ];
  const tools = [{ functionDeclarations: opts.tools.map((t) => t.declaration) }];
  const systemInstruction = { parts: [{ text: opts.system }] };

  const provider = await getProvider();
  if (!provider) throw new Error('Chưa cấu hình trợ lý AI.');

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const parts = await provider.generateContent({ contents, tools, systemInstruction });
    const calls = parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      return parts.map((p) => p.text || '').join('').trim();
    }
    contents.push({ role: 'model', parts });
    const responses: GeminiPart[] = await Promise.all(
      calls.map(async (p) => {
        const fc = p.functionCall!;
        const tool = byName.get(fc.name);
        let result: unknown;
        try {
          result = tool ? await tool.run(fc.args || {}) : `Không có hàm ${fc.name}.`;
        } catch (e) {
          result = `Lỗi khi truy vấn: ${(e as Error).message}`;
        }
        return { functionResponse: { name: fc.name, response: { result } } };
      }),
    );
    contents.push({ role: 'user', parts: responses });
  }

  // Chạm giới hạn vòng gọi hàm → yêu cầu trả lời với dữ liệu đã có (không đưa tools nữa).
  contents.push({ role: 'user', parts: [{ text: 'Hãy trả lời ngay dựa trên dữ liệu đã truy vấn được.' }] });
  const parts = await provider.generateContent({ contents, systemInstruction });
  return parts.map((p) => p.text || '').join('').trim();
}

// ── Trợ lý GIÁM ĐỐC/ADMIN: toàn bộ dữ liệu ──

/** Trả lời câu hỏi của giám đốc/admin dựa trên dữ liệu hệ thống (chấm công, điểm, đơn, tài chính). */
export async function answerDataQuestion(question: string, history: ChatTurn[] = []): Promise<string> {
  if (!(await aiAvailable())) {
    return 'Tính năng hỏi dữ liệu cần bật Trợ lý AI. Vào Quản trị → chọn nhà cung cấp và dán API key là dùng được ngay.';
  }

  const today = todayIso();
  const members = await getActiveMembers();
  const names = members.map((m) => `${m.fullName} [${m.teamId || '—'}]`).join(', ');

  const tools: ToolDef[] = [
    {
      declaration: { name: 'get_roster', description: 'Danh sách nhân sự đang làm việc, nhóm theo team, kèm vai trò.' },
      run: () => rosterText(),
    },
    {
      declaration: {
        name: 'get_attendance',
        description: 'Chấm công của TẤT CẢ nhân sự trong 1 ngày (kể cả người chưa chấm).',
        parameters: {
          type: 'OBJECT',
          properties: { date: { type: 'STRING', description: 'Ngày YYYY-MM-DD. Bỏ trống = hôm nay.' } },
        },
      },
      run: (a) => attendanceText(String(a.date || today)),
    },
    {
      declaration: {
        name: 'get_ranking',
        description: 'Bảng điểm + xếp hạng + thưởng của nhân viên theo tháng (lọc được theo team).',
        parameters: {
          type: 'OBJECT',
          properties: {
            ...MONTH_PARAMS.properties,
            teamId: { type: 'STRING', description: 'Mã team (vd ADS/CONTENT/SEO). Bỏ trống = tất cả.' },
          },
        },
      },
      run: (a) => {
        const { year, month } = argMonth(a);
        return rankingText(year, month, a.teamId ? String(a.teamId) : undefined);
      },
    },
    {
      declaration: { name: 'get_pending_requests', description: 'Các đơn xin nghỉ/làm online đang chờ duyệt.' },
      run: () => pendingRequestsText(),
    },
    {
      declaration: {
        name: 'get_finance_summary',
        description: 'Tài chính 1 tháng: tổng thu, tổng chi, lãi/lỗ, công nợ phải thu và danh sách khoản thu/chi.',
        parameters: {
          type: 'OBJECT',
          properties: { month: { type: 'STRING', description: 'Tháng dạng YYYY-MM. Bỏ trống = tháng hiện tại.' } },
        },
      },
      run: (a) => {
        const cur = currentYm();
        const ym = /^\d{4}-\d{2}$/.test(String(a.month || ''))
          ? String(a.month)
          : `${cur.year}-${String(cur.month).padStart(2, '0')}`;
        return financeText(ym);
      },
    },
    {
      declaration: {
        name: 'get_member_tasks',
        description: 'Danh sách việc đã hoàn thành (kèm điểm) của MỘT nhân sự trong 1 tháng.',
        parameters: {
          type: 'OBJECT',
          properties: {
            memberName: { type: 'STRING', description: 'Tên (hoặc một phần tên) nhân sự.' },
            ...MONTH_PARAMS.properties,
          },
          required: ['memberName'],
        },
      },
      run: async (a) => {
        const needle = removeAccents(String(a.memberName || '')).toLowerCase();
        const hit = members.find((m) => removeAccents(m.fullName).toLowerCase().includes(needle));
        if (!hit) return `Không tìm thấy nhân sự tên "${a.memberName}".`;
        const { year, month } = argMonth(a);
        return `${hit.fullName}:\n${await memberTasksText(hit.id, year, month)}`;
      },
    },
  ];

  const system = [
    'Bạn là trợ lý dữ liệu nội bộ của agency marketing MT Digital, trả lời cho GIÁM ĐỐC.',
    `Hôm nay là ${today}.`,
    'Dùng các hàm được cấp để lấy đúng dữ liệu cần thiết rồi trả lời NGẮN GỌN, chính xác, bằng tiếng Việt.',
    'CHỈ trả lời dựa trên dữ liệu lấy được từ hàm; thiếu dữ liệu thì nói rõ "dữ liệu hiện có chưa đủ".',
    'Câu hỏi về quá khứ (hôm qua, tháng trước…): tự quy đổi ra ngày/tháng cụ thể rồi truyền vào hàm.',
    `Danh sách nhân sự (để nhận diện tên trong câu hỏi): ${names}.`,
  ].join('\n');

  try {
    const answer = await runToolLoop({ system, question, history, tools });
    return answer || 'Mình chưa tạo được câu trả lời, thử hỏi lại cụ thể hơn nhé.';
  } catch (e) {
    console.error('[assistant] director Q&A:', e);
    return FRIENDLY_ERROR;
  }
}

// ── Trợ lý NHÂN VIÊN: chỉ dữ liệu của chính mình ──

/**
 * Trả lời câu hỏi của một thành viên về dữ liệu CỦA CHÍNH HỌ (điểm, công, việc, đơn từ).
 * Trả về null khi Gemini chưa cấu hình — caller tự rơi về trả lời cố định.
 */
export async function answerMemberQuestion(
  memberId: string,
  question: string,
  history: ChatTurn[] = [],
): Promise<string | null> {
  if (!(await aiAvailable())) return null;
  const me = await findById(memberId);
  if (!me) return null;

  const today = todayIso();
  // Mọi tool đều bind sẵn memberId của người đang đăng nhập — không có đường nào
  // truy vấn dữ liệu người khác hay tài chính, kể cả khi prompt bị "dụ".
  const tools: ToolDef[] = [
    {
      declaration: {
        name: 'get_my_score',
        description: 'Điểm, thưởng, giờ làm hôm nay và xếp hạng của TÔI trong 1 tháng.',
        parameters: MONTH_PARAMS,
      },
      run: (a) => {
        const { year, month } = argMonth(a);
        return myScoreText(memberId, year, month);
      },
    },
    {
      declaration: {
        name: 'get_my_attendance',
        description: 'Chấm công (ngày công) của TÔI trong 1 tháng, kèm tổng công.',
        parameters: MONTH_PARAMS,
      },
      run: (a) => {
        const { year, month } = argMonth(a);
        return myAttendanceText(memberId, year, month);
      },
    },
    {
      declaration: {
        name: 'get_my_tasks',
        description: 'Các việc TÔI đã hoàn thành (kèm điểm) trong 1 tháng.',
        parameters: MONTH_PARAMS,
      },
      run: (a) => {
        const { year, month } = argMonth(a);
        return memberTasksText(memberId, year, month);
      },
    },
    {
      declaration: { name: 'get_my_requests', description: 'Đơn xin nghỉ/làm online của TÔI và trạng thái duyệt.' },
      run: () => myRequestsText(memberId),
    },
    {
      declaration: { name: 'get_task_catalog', description: 'Danh mục loại việc và điểm tương ứng.' },
      run: () => catalogText(),
    },
  ];

  const system = [
    'Bạn là trợ lý cá nhân trong app MTJOB của agency marketing MT Digital.',
    `Người hỏi: ${me.fullName} (team ${me.teamId || '—'}). Hôm nay là ${today}.`,
    'Dùng các hàm được cấp để lấy dữ liệu rồi trả lời NGẮN GỌN, thân thiện, bằng tiếng Việt.',
    'Bạn CHỈ có dữ liệu của chính người hỏi. Nếu họ hỏi về người khác, lương người khác hay tài chính công ty,',
    'từ chối khéo: "Mình chỉ xem được dữ liệu của bạn thôi nhé."',
    'Câu hỏi về quá khứ (tháng trước…): tự quy đổi ra tháng cụ thể rồi truyền vào hàm.',
  ].join('\n');

  try {
    const answer = await runToolLoop({ system, question, history, tools });
    return answer || 'Mình chưa tạo được câu trả lời, thử hỏi lại cụ thể hơn nhé.';
  } catch (e) {
    console.error('[assistant] member Q&A:', e);
    return FRIENDLY_ERROR;
  }
}
