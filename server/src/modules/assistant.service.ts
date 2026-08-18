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
import { searchKnowledgeText, customerProfileText, importGoogleSheet, ingest } from './brain.service.js';
import { getCustomers } from './crm.repo.js';
import { addReminder } from './reminders.repo.js';
import { previewDirectorReport } from '../jobs/dailyReport.js';
import { describeRule, type RepeatKind } from '../lib/reminder.js';
import { dipSapToi } from '../lib/lich.js';
import { timTrung, loiTrung } from './calendar.service.js';
import { moneyWriteTools, crmWriteTools, reminderManageTools, dedupeTools, pointAdjustTools } from './assistant.tools.write.js';
import { newId } from '../util/id.js';
import type { GeminiContent, GeminiPart } from '../gemini/client.js';
import { todayIso, nowTz, monthRange } from '../lib/datetime.js';
import { formatVnd } from '../lib/money.js';
import { formatMinutes } from '../lib/worktime.js';
import { removeAccents } from '../lib/people.js';
import { directorPrompt, memberPrompt } from './assistant.prompts.js';

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

const FRIENDLY_ERROR = 'Xin lỗi, trợ lý đang bận, thử lại sau ít phút nhé.';
const MAX_ROUNDS = 5; // chặn vòng lặp functionCall vô hạn
const MAX_HISTORY_CHARS = 4000;

// ── Khai báo tool + hàm chạy ──
export interface ToolDef {
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

/**
 * Hồ sơ 360° của khách: bản tổng hợp từ MỌI nguồn (lưu ý, CRM, lịch hẹn, việc đã làm).
 * Hỏi về một khách cụ thể thì dùng hàm này trước — tránh cảnh tìm rời rạc bị sót thông tin.
 */
const PROFILE_TOOL: ToolDef = {
  declaration: {
    name: 'get_customer_profile',
    description:
      'Hồ sơ tổng hợp của MỘT khách hàng: tình trạng, người phụ trách, nhu cầu/ngân sách, ' +
      'diễn biến theo thời gian, công việc đã làm, điểm cần theo dõi. ' +
      'Dùng ĐẦU TIÊN khi câu hỏi nhắc tới tên một khách hàng cụ thể.',
    parameters: {
      type: 'OBJECT',
      properties: { name: { type: 'STRING', description: 'Tên khách hàng.' } },
      required: ['name'],
    },
  },
  run: (a) => customerProfileText(String(a.name || '')),
};

/**
 * Đặt nhắc hẹn ngay trong lúc chat: "nhắc tôi đăng bài X Salon 8h hằng ngày".
 * Nhắc hẹn LUÔN thuộc về người đang chat — không tạo hộ người khác được.
 */
function reminderTool(memberId: string, role: string): ToolDef {
  return {
    declaration: {
      name: 'create_reminder',
      description:
        'Đặt nhắc hẹn cho CHÍNH người đang chat. Dùng khi họ nói "nhắc tôi…", "đặt lịch nhắc…". ' +
        'Chỉ người đặt mới nhận được thông báo.',
      parameters: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: 'Nội dung cần nhắc, vd "Đăng bài X Salon".' },
          atTime: { type: 'STRING', description: 'Giờ nhắc dạng HH:mm (24h), vd "08:00".' },
          repeatKind: {
            type: 'STRING',
            enum: ['once', 'daily', 'weekly', 'monthly'],
            description: 'once = một lần, daily = hằng ngày, weekly = hằng tuần, monthly = hằng tháng.',
          },
          onDate: { type: 'STRING', description: 'Chỉ khi once: ngày YYYY-MM-DD.' },
          weekday: { type: 'NUMBER', description: 'Chỉ khi weekly: 0=CN, 1=T2 … 6=T7.' },
          dayOfMonth: { type: 'NUMBER', description: 'Chỉ khi monthly: ngày trong tháng 1-31.' },
          boQuaTrung: {
            type: 'BOOLEAN',
            description:
              'Chỉ đặt true SAU KHI hàm đã báo trùng giờ và người dùng nói vẫn muốn đặt. Lần gọi đầu luôn để trống.',
          },
        },
        required: ['title', 'atTime', 'repeatKind'],
      },
    },
    run: async (a) => {
      // Mọi đường THẤT BẠI mở đầu bằng "CHƯA ĐẶT ĐƯỢC" — xem ghi chú ở create_appointment.
      const title = String(a.title || '').trim();
      const atTime = String(a.atTime || '').trim();
      const repeatKind = String(a.repeatKind || 'once') as RepeatKind;
      if (!title) return 'CHƯA ĐẶT ĐƯỢC: chưa rõ cần nhắc việc gì.';
      if (!/^\d{1,2}:\d{2}$/.test(atTime)) return 'CHƯA ĐẶT ĐƯỢC: giờ nhắc phải dạng HH:mm, vd 08:00.';
      const onDate = String(a.onDate || '');
      if (repeatKind === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(onDate)) {
        return 'CHƯA ĐẶT ĐƯỢC: nhắc một lần cần biết ngày cụ thể (YYYY-MM-DD). Hỏi lại người dùng ngày nào.';
      }
      const [h, m] = atTime.split(':');
      const rule = {
        atTime: `${String(Number(h)).padStart(2, '0')}:${m}`,
        repeatKind,
        onDate,
        weekday: Number(a.weekday ?? 1),
        dayOfMonth: Number(a.dayOfMonth ?? 1),
      };
      // Trùng giờ thì KHÔNG đặt, báo lại để trợ lý hỏi người dùng. Trợ lý không có nút
      // bấm lần hai như màn hình, nên đường đi tiếp là gọi lại với boQuaTrung = true.
      if (a.boQuaTrung !== true) {
        const ts = await timTrung({ memberId, role, dip: dipSapToi(rule, todayIso()) });
        if (ts.length > 0) {
          return (
            `CHƯA ĐẶT ĐƯỢC: ${loiTrung(ts)} ` +
            'Hỏi người dùng có muốn đặt chồng giờ không. Nếu họ đồng ý thì gọi lại hàm này với boQuaTrung = true.'
          );
        }
      }

      await addReminder({
        id: newId('RM-'),
        memberId,
        title,
        ...rule,
        active: true,
        lastFired: '',
        createdAt: nowTz().toISOString(),
      });
      return `Đã đặt nhắc hẹn "${title}" — ${describeRule(rule)}. Chỉ bạn nhận được thông báo này.`;
    },
  };
}

/**
 * Nạp bảng từ Google Sheets vào kho. Sheet được đọc MỘT LẦN rồi lưu thành chữ + vector;
 * các lần hỏi sau chỉ tra kho, không mở lại sheet.
 */
const SHEET_TOOL: ToolDef = {
  declaration: {
    name: 'import_google_sheet',
    description:
      'Nạp nội dung một Google Sheets (kế hoạch content, bảng giá, danh sách…) vào kho tri thức. ' +
      'Dùng khi người dùng dán link docs.google.com/spreadsheets và bảo cập nhật/lưu vào kho. ' +
      'Sheet phải được share ở chế độ ai có link cũng xem được.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Link Google Sheets người dùng đưa.' },
        title: { type: 'STRING', description: 'Tên gợi nhớ, vd "Kế hoạch content Quốc Phong tháng 7".' },
        customer: { type: 'STRING', description: 'Tên khách hàng liên quan (nếu có).' },
      },
      required: ['url'],
    },
  },
  run: async (a) => {
    const r = await importGoogleSheet({
      url: String(a.url || ''),
      title: String(a.title || ''),
      customer: String(a.customer || ''),
    });
    return r.ok ? `${r.message} (${r.rows ?? 0} hàng dữ liệu)` : r.message;
  },
};

/** Cho AI tự lưu kết luận vào kho khi người dùng bảo "ghi lại", "cập nhật vào kho". */
const SAVE_TOOL: ToolDef = {
  declaration: {
    name: 'save_to_knowledge',
    description:
      'Lưu một nội dung vào kho tri thức để lần sau tra lại được. ' +
      'Dùng khi người dùng bảo "ghi lại cái này", "lưu vào kho", hoặc vừa chốt một quy trình/quyết định.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Tiêu đề ngắn gọn.' },
        content: { type: 'STRING', description: 'Nội dung đầy đủ cần nhớ, viết rõ ràng và tự chứa.' },
        customer: { type: 'STRING', description: 'Tên khách hàng liên quan (nếu có).' },
      },
      required: ['title', 'content'],
    },
  },
  run: async (a) => {
    const title = String(a.title || '').trim();
    const content = String(a.content || '').trim();
    if (!title || content.length < 10) return 'Cần tiêu đề và nội dung đủ dài để lưu.';
    const n = await ingest({
      sourceType: 'note',
      sourceId: newId('N-'),
      title,
      text: content,
      visibility: 'all',
      customer: String(a.customer || '').trim(),
    });
    return n > 0 ? `Đã lưu "${title}" vào kho tri thức.` : 'Chưa lưu được (kho tri thức cần API key Gemini).';
  },
};

/** Tool tra kho tri thức — dùng chung cho cả hai vai, khác nhau ở phạm vi quyền xem. */
function knowledgeTool(scope: { directorScope: boolean; memberId?: string }): ToolDef {
  return {
    declaration: {
      name: 'search_knowledge',
      description:
        'Tìm trong kho tri thức nội bộ: lưu ý khách hàng, hồ sơ CRM, lịch hẹn, ghi chú công việc, tài liệu, hội thoại cũ. ' +
        'Dùng khi câu hỏi liên quan tới khách hàng, dự án, hoặc thông tin không có trong các hàm khác.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Câu tìm kiếm bằng tiếng Việt tự nhiên.' },
          customer: { type: 'STRING', description: 'Lọc theo tên khách hàng (tuỳ chọn).' },
        },
        required: ['query'],
      },
    },
    run: (a) =>
      searchKnowledgeText(String(a.query || ''), {
        directorScope: scope.directorScope,
        memberId: scope.memberId,
        customer: String(a.customer || ''),
      }),
  };
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

/** Sự kiện phát ra trong lúc trợ lý làm việc — để màn hình hiện tiến trình và chữ dần. */
export type AssistantEvent =
  | { type: 'tool'; name: string } // đang chạy hàm nào
  | { type: 'text'; delta: string }; // một mẩu chữ AI vừa viết

export type OnAssistantEvent = (ev: AssistantEvent) => void;

/**
 * Tìm hàm theo tên, chịu được tên bị hỏng khi truyền qua stream
 * (từng gặp: "get_customer_profile" biến thành "..._ide_ide").
 * Khớp chính xác trước; không có thì lấy hàm có tiền tố chung dài nhất và DUY NHẤT.
 */
export function resolveToolName(name: string, known: string[]): string | null {
  const raw = String(name || '').trim();
  if (known.includes(raw)) return raw;
  if (raw.length < 6) return null;

  let best: { name: string; len: number } | null = null;
  let tie = false;
  for (const k of known) {
    let i = 0;
    while (i < raw.length && i < k.length && raw[i] === k[i]) i++;
    if (i < 8) continue; // tiền tố quá ngắn thì không đủ chắc chắn
    if (!best || i > best.len) {
      best = { name: k, len: i };
      tie = false;
    } else if (i === best.len) {
      tie = true;
    }
  }
  return best && !tie ? best.name : null;
}

function resolveTool(name: string, byName: Map<string, ToolDef>): ToolDef | null {
  const hit = resolveToolName(name, [...byName.keys()]);
  return hit ? byName.get(hit) || null : null;
}

async function runToolLoop(opts: {
  system: string;
  question: string;
  history: ChatTurn[];
  tools: ToolDef[];
  onEvent?: OnAssistantEvent;
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

  // Chỉ stream khi caller cần và nhà cung cấp hỗ trợ; không thì gọi thường như cũ.
  const wantStream = !!opts.onEvent && !!provider.generateContentStream;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = (req: any): Promise<GeminiPart[]> =>
    wantStream
      ? provider.generateContentStream!(req, (d) => opts.onEvent!({ type: 'text', delta: d }))
      : provider.generateContent(req);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const parts = await call({ contents, tools, systemInstruction });
    const calls = parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      return parts.map((p) => p.text || '').join('').trim();
    }
    contents.push({ role: 'model', parts });
    const responses: GeminiPart[] = await Promise.all(
      calls.map(async (p) => {
        const fc = p.functionCall!;
        const tool = resolveTool(fc.name, byName);
        // Báo tiến trình bằng tên đã nhận diện được, để nhãn chờ hiện đúng việc.
        opts.onEvent?.({ type: 'tool', name: tool?.declaration.name || fc.name });
        let result: unknown;
        try {
          result = tool
            ? await tool.run(fc.args || {})
            : // Liệt kê tên hợp lệ để AI tự sửa ngay ở lượt sau, khỏi mò.
              `Không có hàm "${fc.name}". Các hàm dùng được: ${[...byName.keys()].join(', ')}.`;
        } catch (e) {
          result = `Lỗi khi truy vấn: ${(e as Error).message}`;
        }
        // Trả về đúng tên AI đã gọi, nếu không Claude/Gemini không ghép được với lệnh gọi.
        return { functionResponse: { name: fc.name, response: { result } } };
      }),
    );
    contents.push({ role: 'user', parts: responses });
  }

  // Chạm giới hạn vòng gọi hàm → yêu cầu trả lời ngay với dữ liệu đã có.
  //
  // VẪN phải gửi kèm `tools`: lịch sử lúc này đầy tool_use/tool_result, mà Claude từ chối
  // request có mấy khối đó nhưng không khai tools — bỏ tools đi là ăn 400, đúng cái vẻ
  // "trợ lý đang bận" mà thật ra là hỏng. Câu nhắc ở trên đủ để nó dừng gọi hàm.
  contents.push({ role: 'user', parts: [{ text: 'Hãy trả lời ngay dựa trên dữ liệu đã truy vấn được, KHÔNG gọi thêm hàm nào.' }] });
  const parts = await call({ contents, tools, systemInstruction });
  return parts.map((p) => p.text || '').join('').trim();
}

// ── Trợ lý GIÁM ĐỐC/ADMIN: toàn bộ dữ liệu ──

/**
 * Trả lời câu hỏi của giám đốc/admin dựa trên dữ liệu hệ thống (chấm công, điểm, đơn, tài chính).
 * `memberId` = người đang hỏi — cần để đặt nhắc hẹn đúng chủ.
 */
export async function answerDataQuestion(
  memberId: string,
  question: string,
  history: ChatTurn[] = [],
  onEvent?: OnAssistantEvent,
): Promise<string> {
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
    // Số điện thoại khách KHÔNG nằm trong kho tri thức (nhân viên tra được kho) —
    // chỉ giám đốc/admin lấy được qua hàm riêng này.
    {
      declaration: {
        name: 'get_customer_contact',
        description: 'Số điện thoại và người phụ trách của một khách hàng.',
        parameters: {
          type: 'OBJECT',
          properties: { name: { type: 'STRING', description: 'Tên (hoặc một phần tên) khách hàng.' } },
          required: ['name'],
        },
      },
      run: async (a) => {
        const needle = removeAccents(String(a.name || '')).toLowerCase();
        if (!needle) return 'Chưa cho biết tên khách hàng.';
        const hits = (await getCustomers()).filter((c) =>
          removeAccents(c.name).toLowerCase().includes(needle),
        );
        if (hits.length === 0) return `Không tìm thấy khách hàng tên "${a.name}".`;
        return hits
          .slice(0, 5)
          .map((c) => {
            const owner = members.find((m) => m.id === c.assignedTo)?.fullName || 'chưa gán';
            return `${c.name}: ${c.phone || 'chưa có SĐT'} · phụ trách: ${owner} · ${c.status}`;
          })
          .join('\n');
      },
    },
    {
      declaration: {
        name: 'get_today_work_report',
        description:
          'Báo cáo công việc HÔM NAY của toàn công ty: từng người đã hoàn thành việc gì (kèm tên khách), ' +
          'ai chưa ghi nhận việc nào. Dùng khi hỏi "hôm nay ai làm gì", "tình hình công việc hôm nay".',
      },
      run: () => previewDirectorReport(),
    },
    PROFILE_TOOL,
    knowledgeTool({ directorScope: true }),
    reminderTool(memberId, members.find((m) => m.id === memberId)?.role || 'director'),
    SHEET_TOOL,
    SAVE_TOOL,
    // Nhóm GHI: giám đốc nhắn một câu là dữ liệu vào thẳng sổ sách.
    ...moneyWriteTools(),
    ...crmWriteTools(memberId),
    ...reminderManageTools(memberId),
    ...dedupeTools(),
    ...pointAdjustTools(members.find((m) => m.id === memberId)?.fullName || ''),
  ];

  const system = directorPrompt({ today, names });

  try {
    const answer = await runToolLoop({ system, question, history, tools, onEvent });
    return answer || 'Mình chưa tạo được câu trả lời, thử hỏi lại cụ thể hơn nhé.';
  } catch (e) {
    console.error('[assistant] director Q&A:', e);
    // Giám đốc/admin là người cấu hình hệ thống → cho xem luôn nguyên nhân để tự xử lý,
    // thay vì chỉ báo chung chung rồi phải đi mò log.
    return `${FRIENDLY_ERROR}\n\n(Nguyên nhân: ${(e as Error).message.slice(0, 300)})`;
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
  onEvent?: OnAssistantEvent,
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
    PROFILE_TOOL,
    // Quyền xem chặn cứng ở tầng SQL: chỉ thấy đoạn 'all' + đoạn riêng của chính mình.
    knowledgeTool({ directorScope: false, memberId }),
    reminderTool(memberId, me.role),
    ...reminderManageTools(memberId),
    SHEET_TOOL,
    SAVE_TOOL,
    // Chỉ sale mới ghi được khách/lịch hẹn. Nhân viên khác KHÔNG có công cụ ghi nào —
    // chặn ở đây chứ không nhờ prompt, để không "dụ" được.
    ...(me.role === 'sale' ? crmWriteTools(memberId) : []),
  ];

  const system = memberPrompt({ today, fullName: me.fullName, teamId: me.teamId || '', isSale: me.role === 'sale' });

  try {
    const answer = await runToolLoop({ system, question, history, tools, onEvent });
    return answer || 'Mình chưa tạo được câu trả lời, thử hỏi lại cụ thể hơn nhé.';
  } catch (e) {
    console.error('[assistant] member Q&A:', e);
    return FRIENDLY_ERROR;
  }
}
