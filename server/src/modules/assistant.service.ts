// Trợ lý hỏi-đáp dữ liệu bằng Gemini function-calling:
// - Giám đốc/admin: hỏi toàn bộ dữ liệu (nhân sự, chấm công, điểm, đơn, tài chính) — AI tự
//   gọi đúng hàm cần thiết nên hỏi được cả quá khứ ("hôm qua ai vắng", "điểm tháng trước").
// - Nhân viên: chỉ dữ liệu CỦA CHÍNH MÌNH — giới hạn cứng ở tầng tool, không phụ thuộc prompt.
import { getActiveMembers, findById } from './members.repo.js';
import { getForDate, getForMemberRange } from './attendance.repo.js';
import { ranking, memberScore } from './scores.service.js';
import { getAllRequests } from './requests.repo.js';
import { getParties, getEntries, getPartyRates, paidByPartyMonth } from './finance.repo.js';
import { mucTheoThang, computeOnceDebt, DEBT_TRACK_FROM } from '../lib/finance.js';
import { getDoneTasksForMemberRange } from './tasks.repo.js';
import { getActiveCatalog, locCatalogTheoTeam } from './catalog.repo.js';
import { getProvider, aiAvailable } from '../ai/index.js';
import { customerProfileText, importGoogleSheet } from './brain.service.js';
import {
  xetDuaVaoKho,
  timTriThuc,
  chuyenCauHoi,
  traLoiCauHoi,
  timCauHoiDangMo,
  CHUA_CO,
  type NguoiGui,
} from './brainItems.service.js';
import { listQuestions } from './brainItems.repo.js';
import { NHOM, NHOM_KEYS } from '../lib/brainGate.js';
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
        'Đặt nhắc hẹn / lịch gặp cho CHÍNH người đang chat. Dùng khi họ nói "nhắc tôi…", "đặt lịch…", ' +
        '"gặp chị A sáng thứ 5 10h" — với BẤT KỲ ai, không cần người đó có trong CRM, không cần tra gì trước. ' +
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

/** Người đang chat, theo dạng bộ phân loại kho cần. */
function nguoiCua(m: { id: string; fullName: string; role: string; teamId?: string } | undefined, memberId: string): NguoiGui {
  return { id: m?.id || memberId, name: m?.fullName || '', role: m?.role || '', teamId: m?.teamId || '' };
}

/**
 * Nạp bảng từ Google Sheets vào kho. Sheet được đọc MỘT LẦN rồi lưu thành chữ + vector;
 * các lần hỏi sau chỉ tra kho, không mở lại sheet. Đi qua bộ phân loại như mọi đường khác.
 */
function sheetTool(nguoi: NguoiGui): ToolDef {
  return {
    declaration: {
      name: 'import_google_sheet',
      description:
        'Nạp nội dung một Google Sheets (kế hoạch content, bảng giá, danh sách…) vào kho tri thức. ' +
        'Dùng khi người dùng dán link docs.google.com/spreadsheets và bảo cập nhật/lưu vào kho. ' +
        'Sheet phải được share ở chế độ ai có link cũng xem được. Hệ thống tự phân loại; đọc lại nguyên văn câu hàm trả về.',
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
      const r = await importGoogleSheet(
        { url: String(a.url || ''), title: String(a.title || ''), customer: String(a.customer || '') },
        nguoi,
      );
      return r.ok ? `${r.message} (${r.rows ?? 0} hàng dữ liệu)` : r.message;
    },
  };
}

/**
 * Lưu một nội dung vào kho khi người dùng bảo "ghi lại", "lưu vào kho".
 *
 * Anh Tâm 4/10/2026: "tất cả đều đưa nhưng em phải lựa". Hàm này KHÔNG ghi thẳng nữa — mọi thứ
 * qua xetDuaVaoKho: chặn bí mật, ẩn SĐT khách, AI gắn nhóm/khách/phạm vi, chuyện riêng của giám
 * đốc giữ riêng, nhân viên gửi điều chưa chắc thì vào hàng chờ duyệt.
 */
function saveTool(nguoi: NguoiGui): ToolDef {
  return {
    declaration: {
      name: 'save_to_knowledge',
      description:
        'Gửi một nội dung vào kho tri thức để lần sau tra lại được. ' +
        'Dùng khi người dùng bảo "ghi lại cái này", "lưu vào kho", hoặc vừa chốt một quy trình/quyết định. ' +
        'Hệ thống tự phân loại (vào kho / chỉ giám đốc xem / chờ duyệt / không lưu) — đọc lại NGUYÊN VĂN câu hàm trả về, đừng tự nói khác.',
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
      if (!title || content.length < 10) return 'CHƯA LƯU: cần tiêu đề và nội dung đủ dài.';
      const r = await xetDuaVaoKho({ title, body: content, customer: String(a.customer || '').trim(), source: 'chat' }, nguoi);
      return r.message || 'CHƯA LƯU được.';
    },
  };
}

/**
 * Tra kho tri thức THEO NHÃN — dùng chung cho cả hai vai, khác nhau ở phạm vi quyền xem.
 * Hỏi về một khách thì truyền `customer` để chỉ lấy đúng khách đó; hỏi quy định thì truyền `category`.
 */
function knowledgeTool(scope: { directorScope: boolean; memberId?: string; teamId?: string }): ToolDef {
  const nhom = NHOM_KEYS.filter((k) => scope.directorScope || k !== 'rieng')
    .map((k) => `${k} = ${NHOM[k]}`)
    .join('; ');
  return {
    declaration: {
      name: 'search_knowledge',
      description:
        'Tra KHO TRI THỨC của công ty: tri thức về khách hàng, quy trình, tiêu chuẩn thiết kế & nội dung, ' +
        'dịch vụ & bảng giá, chính sách nhân sự, cách xử lý tình huống, mẫu dùng sẵn, công cụ, quyết định đã chốt, ' +
        'cùng hồ sơ khách và tài liệu đã tải lên. Dùng TRƯỚC KHI trả lời mọi câu hỏi về cách làm / quy định / khách hàng của công ty. ' +
        'Kết quả trả theo từng mục kèm nhóm và ngày cập nhật — trích nguồn khi trả lời.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Câu tìm kiếm bằng tiếng Việt tự nhiên.' },
          customer: { type: 'STRING', description: 'Tên khách hàng nếu câu hỏi nói về một khách cụ thể — chỉ lấy tri thức của đúng khách đó.' },
          category: { type: 'STRING', enum: ['', ...NHOM_KEYS.filter((k) => scope.directorScope || k !== 'rieng')], description: `Nhóm nếu biết chắc (bỏ trống nếu không chắc): ${nhom}.` },
        },
        required: ['query'],
      },
    },
    run: async (a) => {
      const kq = await timTriThuc(String(a.query || ''), {
        directorScope: scope.directorScope,
        memberId: scope.memberId,
        teamId: scope.teamId,
        customer: String(a.customer || ''),
        category: String(a.category || ''),
      });
      // Nhân viên hỏi điều kho chưa có → chỉ đường cho trợ lý, không để nó tự bịa quy định.
      if (!scope.directorScope && kq.startsWith(CHUA_CO)) {
        return (
          `${kq}\nNếu đây là câu hỏi về quy định / cách làm / khách hàng của công ty: KHÔNG tự đặt ra câu trả lời. ` +
          'Nói với người hỏi là kho chưa có, rồi gọi chuyen_cau_hoi_cho_giam_doc với đúng câu hỏi của họ. ' +
          'Nếu chỉ là kiến thức marketing chung thì cứ trả lời, nhưng ghi rõ "kinh nghiệm chung, chưa phải quy định công ty".'
        );
      }
      return kq;
    },
  };
}

/** Nhân viên: chuyển câu hỏi kho chưa có lời giải cho giám đốc (anh Tâm 4/10/2026). */
function askDirectorTool(nguoi: NguoiGui): ToolDef {
  return {
    declaration: {
      name: 'chuyen_cau_hoi_cho_giam_doc',
      description:
        'Chuyển câu hỏi cho giám đốc khi search_knowledge báo CHƯA CÓ TRONG KHO và câu hỏi là về quy định / cách làm / ' +
        'khách hàng của công ty. Giám đốc trả lời một lần thì câu trả lời vào kho, người hỏi được báo lại.',
      parameters: {
        type: 'OBJECT',
        properties: { question: { type: 'STRING', description: 'Câu hỏi của nhân viên, viết lại cho rõ, tự hiểu được.' } },
        required: ['question'],
      },
    },
    run: (a) => chuyenCauHoi(String(a.question || ''), nguoi),
  };
}

/** Giám đốc: xem và trả lời câu hỏi nhân viên đang chờ ngay trong chat. */
function questionTools(nguoi: NguoiGui): ToolDef[] {
  return [
    {
      declaration: {
        name: 'list_open_questions',
        description: 'Các câu hỏi nhân viên đã hỏi mà kho tri thức chưa có lời giải, đang chờ giám đốc trả lời.',
      },
      run: async () => {
        const ds = await listQuestions('open', 30);
        if (ds.length === 0) return 'Không có câu hỏi nào đang chờ.';
        return ds
          .map((x, i) => `${i + 1}. ${x.question} — ${x.askedName || '?'}${x.times > 1 ? ` (${x.times} lần hỏi)` : ''}, ${x.createdAt.slice(0, 10)}`)
          .join('\n');
      },
    },
    {
      declaration: {
        name: 'answer_open_question',
        description:
          'Giám đốc trả lời một câu hỏi đang chờ (vd "trả lời câu hỏi về màu thương hiệu: dùng xanh #0B5FD9"). ' +
          'Câu trả lời thành mục trong kho và người hỏi được báo lại.',
        parameters: {
          type: 'OBJECT',
          properties: {
            question: { type: 'STRING', description: 'Câu hỏi đang chờ, hoặc vài từ để nhận ra nó.' },
            answer: { type: 'STRING', description: 'Câu trả lời đầy đủ của giám đốc, viết tự hiểu được.' },
          },
          required: ['question', 'answer'],
        },
      },
      run: async (a) => {
        const x = await timCauHoiDangMo(String(a.question || ''));
        if (!x) return 'CHƯA TRẢ LỜI ĐƯỢC: không thấy câu hỏi đang chờ nào khớp. Gọi list_open_questions để xem danh sách.';
        try {
          const r = await traLoiCauHoi(x.id, String(a.answer || ''), nguoi);
          return `Đã trả lời câu hỏi "${x.question}". ${r.ketQua.message}`;
        } catch (e) {
          return `CHƯA TRẢ LỜI ĐƯỢC: ${(e as Error).message}`;
        }
      },
    },
  ];
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
  const [parties, entries, rates, paid] = await Promise.all([
    getParties().catch(() => []),
    getEntries(monthYm).catch(() => []),
    getPartyRates().catch(() => new Map()),
    paidByPartyMonth(DEBT_TRACK_FROM).catch((): Record<string, Record<string, number>> => ({})),
  ]);
  // Mức của đúng tháng đang hỏi — bên đổi mức giữa chừng thì tháng cũ vẫn theo mức cũ.
  const receivable = parties
    .filter((p) => p.active && p.kind !== 'once' && !(p.endMonth && monthYm > p.endMonth))
    .reduce((s, p) => s + mucTheoThang(rates.get(p.id) || [], p.receivable, monthYm), 0);
  // Khoản một lần trả nhiều đợt: liệt kê còn nợ bao nhiêu trên tổng.
  const motLan = parties
    .filter((p) => p.active && p.kind === 'once')
    .map((p) => ({ p, d: computeOnceDebt({ total: p.receivable, startMonth: (p.startDate || '').slice(0, 7), month: monthYm, paid: paid[p.id] || {} }) }))
    .filter(({ d }) => d.active)
    .map(({ p, d }) => `${p.name}: còn nợ ${formatVnd(d.remaining)} / tổng ${formatVnd(d.total)} (đã trả ${formatVnd(d.paidTotal)})`);
  const income = entries.filter((e) => e.kind === 'thu').reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter((e) => e.kind === 'chi').reduce((s, e) => s + e.amount, 0);
  const entryLines = entries
    .slice(0, 30)
    .map((e) => `${e.kind === 'thu' ? 'Thu' : 'Chi'}: ${e.name} ${formatVnd(e.amount)}${e.date ? ` (${e.date})` : ''}`)
    .join('\n');
  return [
    `Tài chính tháng ${monthYm}: Thu ${formatVnd(income)}, Chi ${formatVnd(expense)}, Lãi/Lỗ ${formatVnd(income - expense)}.`,
    `Tổng công nợ phải thu mỗi kỳ: ${formatVnd(receivable)} (${parties.filter((p) => p.active && p.kind !== 'once').length} bên thu hàng tháng).`,
    motLan.length ? `Khoản một lần trả nhiều đợt:\n${motLan.join('\n')}` : '',
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

/** `teamId` rỗng (giám đốc) = thấy hết; nhân viên chỉ thấy việc team mình — gợi ý việc nào thì ghi được việc đó. */
async function catalogText(teamId = ''): Promise<string> {
  const catalog = locCatalogTheoTeam(await getActiveCatalog(), teamId);
  return `Danh mục loại việc (điểm):\n${catalog.map((c) => `${c.code}: ${c.name} (${c.points}đ)`).join('\n')}`;
}

// ── Vòng lặp function-calling ──

/** Sự kiện phát ra trong lúc trợ lý làm việc — để màn hình hiện tiến trình và chữ dần. */
export type AssistantEvent =
  | { type: 'tool'; name: string } // đang chạy hàm nào
  | { type: 'text'; delta: string } // một mẩu chữ AI vừa viết
  // Chữ vừa gửi chỉ là LỜI DẪN giữa chừng, không phải câu trả lời — màn hình phải xoá đi.
  | { type: 'reset' };

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

export interface ToolLoopOpts {
  system: string;
  question: string;
  history: ChatTurn[];
  tools: ToolDef[];
  onEvent?: OnAssistantEvent;
  /** Tên các hàm ĐÃ CHẠY trong lượt — vòng lặp đẩy vào để chốt chặn bên ngoài kiểm. */
  goiHam?: string[];
}

/** Hàm GHI = hàm làm đổi dữ liệu. Nói "đã ghi" mà không có hàm nào nhóm này chạy là bịa. */
export function laHamGhi(name: string): boolean {
  return /^(add|create|collect|adjust|delete|cancel|save|import|dedupe|restore|answer|chuyen)_/.test(name);
}

/**
 * Câu trả lời có NHẬN là đã làm gì đó vào hệ thống không.
 *
 * Dùng lookbehind \p{L} chứ không dùng \b: "đ" không phải ký tự ASCII nên \b đứng trước "đã"
 * không khớp — regex trông đúng mà không bắt được gì.
 */
export function nhanLaDaGhi(text: string): boolean {
  const s = String(text || '');
  return (
    /(?<!\p{L})(đã|vừa)\s*(đặt|ghi|thêm|tắt|xo[áa]|hu[ỷy]|cập nhật|lưu|tạo|chốt|gỡ|đổi)(?!\p{L})/iu.test(s) ||
    /(?<!\p{L})(em|mình|tôi)\s+(đặt|ghi|tạo|tắt|xo[áa])\s+(ngay|luôn)(?!\p{L})/iu.test(s)
  );
}

// Từ hay gặp trong câu nhắn việc — không dùng để nhận diện "cùng một việc".
const TU_THUONG = new Set([
  'sang', 'chieu', 'toi', 'trua', 'chot', 'nhac', 'hen', 'gap', 'goi', 'lich', 'ngay', 'thang', 'tuan', 'luc',
  'nay', 'mai', 'kia', 'voi', 'anh', 'chi', 'tai', 'dat', 'viec', 'cua', 'cho', 'nha', 'ong', 'thu', 'hom',
  'gio', 'phut', 'lai', 'them', 'moi', 'once', 'daily', 'weekly', 'monthly', 'nhe', 'sua', 'khong', 'phai',
]);

/** Từ khoá nhận diện một việc: bỏ dấu, chỉ giữ chữ cái, bỏ từ thường. Số và ngày giờ không tính. */
function tuKhoa(s: string): Set<string> {
  const flat = String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
  return new Set((flat.match(/[a-z]+/g) || []).filter((w) => w.length >= 3 && !TU_THUONG.has(w)));
}

function coChung(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (b.has(w)) return true;
  return false;
}

/**
 * Lệnh ghi này là VIỆC CŨ (của lượt trước) chứ không phải việc vừa nhắn?
 *
 * Anh Tâm 22/9/2026: nhắn "T6 15:30 gặp anh Nguyên Gateway", trợ lý đặt Gateway xong còn đặt
 * LẠI "Gọi chốt với chị Hiền Viettiles" của lượt trước. Lời dặn "mỗi lượt chỉ làm việc vừa
 * nhắn" đã có mà mô hình vẫn lôi lịch sử ra làm lại, nên phải chặn ở đây.
 *
 * Việc = các chuỗi trong tham số hàm. Có từ khoá trùng với câu vừa nhắn → việc mới. Không trùng
 * câu mới mà trùng một câu nhắn cũ → việc cũ. Không trùng gì cả thì không kết luận (không chặn).
 */
export function laViecCu(args: Record<string, unknown> | undefined, question: string, cauCu: string[]): boolean {
  const tk = tuKhoa(
    Object.values(args || {})
      .filter((v): v is string => typeof v === 'string')
      .join(' '),
  );
  if (tk.size === 0) return false;
  if (coChung(tk, tuKhoa(question))) return false;
  return cauCu.some((c) => coChung(tk, tuKhoa(c)));
}

const KHONG_CHAY_VIEC_CU =
  'KHÔNG CHẠY: đây là việc của lượt TRƯỚC, đã xử lý xong rồi. Lượt này chỉ làm đúng việc vừa nhắn; ' +
  'không đặt lại, kiểm tra lại hay tắt/bật lại lịch cũ. Trả lời về việc vừa nhắn thôi.';

const CANH_BAO_CHUA_GHI =
  '⚠️ Em CHƯA ghi được gì vào hệ thống — trợ lý trả lời mà không gọi hàm nào. ' +
  'Anh nhắn lại một việc một lần, ví dụ: "nhắc gặp anh Bằng 18/09 lúc 14:00".';

/**
 * Vòng lặp gọi hàm + CHỐT CHẶN "nói đã làm mà không làm".
 *
 * Anh Tâm 17/9/2026: trợ lý báo "đã đặt" lịch chị Hàn Duyên, chị Hồng Thanh, "đã tắt" hai
 * lịch khác, đọc cả bảng 60 task Quốc Phong — rồi lượt sau tự thú là chưa gọi hàm nào, toàn
 * bộ là bịa. Lời dặn đã cấm từ lâu mà mô hình vẫn làm, nên phải kiểm ở đây, không tin chữ:
 *
 *   Trả lời có "đã đặt / đã ghi / đã tắt…" mà KHÔNG có hàm ghi nào chạy trong lượt
 *   → bảo làm lại (kèm lý do), xoá phần chữ đã stream ra màn hình.
 *   → vẫn vậy lần hai → thay bằng câu nói thật, không để câu bịa tới người dùng.
 */
export async function runToolLoopChan(opts: ToolLoopOpts): Promise<string> {
  const goiHam: string[] = [];
  let answer = await runToolLoop({ ...opts, goiHam });
  if (!nhanLaDaGhi(answer) || goiHam.some(laHamGhi)) return answer;

  console.warn('[assistant] nhận "đã ghi" mà không gọi hàm ghi nào — bắt làm lại');
  opts.onEvent?.({ type: 'reset' });
  const nhac =
    '\n\n[HỆ THỐNG] Câu trả lời trước của bạn nói "đã đặt/đã ghi" nhưng bạn KHÔNG gọi hàm nào, ' +
    'nên chưa có gì được ghi. Làm lại: nếu người dùng yêu cầu đặt/ghi/tắt gì, hãy GỌI HÀM tương ' +
    'ứng ngay; thiếu thông tin thì hỏi đúng thứ còn thiếu. Nếu bạn chỉ thuật lại dữ liệu có sẵn, ' +
    'trả lời lại mà không dùng chữ "đã ghi/đã đặt".';
  answer = await runToolLoop({ ...opts, question: opts.question + nhac, goiHam });
  if (!nhanLaDaGhi(answer) || goiHam.some(laHamGhi)) return answer;

  console.warn('[assistant] lần hai vẫn bịa — trả câu cảnh báo');
  opts.onEvent?.({ type: 'reset' });
  return CANH_BAO_CHUA_GHI;
}

export async function runToolLoop(opts: ToolLoopOpts): Promise<string> {
  const byName = new Map(opts.tools.map((t) => [t.declaration.name, t]));

  // Giới hạn history: 10 lượt gần nhất + tổng ký tự.
  let chars = 0;
  const trimmed: ChatTurn[] = [];
  for (const h of opts.history.slice(-10).reverse()) {
    chars += h.text.length;
    if (chars > MAX_HISTORY_CHARS) break;
    trimmed.unshift(h);
  }

  // Câu nhắn cũ đánh dấu rõ là ĐÃ XONG — mô hình hay đọc lịch sử rồi làm lại việc của lượt trước.
  const contents: GeminiContent[] = [
    ...trimmed.map(
      (h): GeminiContent => ({
        role: h.role,
        parts: [{ text: h.role === 'user' ? `[Lượt trước — đã xử lý xong, không làm lại] ${h.text}` : h.text }],
      }),
    ),
    { role: 'user', parts: [{ text: opts.question }] },
  ];
  const tools = [{ functionDeclarations: opts.tools.map((t) => t.declaration) }];
  const systemInstruction = { parts: [{ text: opts.system }] };

  const provider = await getProvider();
  if (!provider) throw new Error('Chưa cấu hình trợ lý AI.');

  const cauCu = opts.history.filter((h) => h.role === 'user').map((h) => h.text);
  let daGhiViecMoi = false;

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
    // Lượt này CÒN gọi hàm → chữ vừa stream chỉ là lời AI tự nói trong lúc tra cứu
    // ("để em kiểm tra trong CRM…"), không phải câu trả lời. Bảo màn hình xoá đi, nếu
    // không nó dính vào đầu câu trả lời thật và lượt sau còn bị gửi lại làm lịch sử.
    if (parts.some((p) => p.text)) opts.onEvent?.({ type: 'reset' });
    contents.push({ role: 'model', parts });

    // Chặn lệnh ghi lôi việc của lượt trước ra làm lại — CHỈ khi lượt này đã có lệnh ghi cho việc
    // mới (xem laViecCu). Anh nhắn "ừ" để xác nhận việc cũ thì không có lệnh ghi việc mới, vẫn qua.
    const xet = calls.map((p) => {
      const tool = resolveTool(p.functionCall!.name, byName);
      const ghi = !!tool && laHamGhi(tool.declaration.name);
      return { tool, ghi, cu: ghi && laViecCu(p.functionCall!.args, opts.question, cauCu) };
    });
    if (xet.some((x) => x.ghi && !x.cu)) daGhiViecMoi = true;

    const responses: GeminiPart[] = await Promise.all(
      calls.map(async (p, i) => {
        const fc = p.functionCall!;
        const { tool, cu } = xet[i];
        if (cu && daGhiViecMoi) {
          console.warn(`[assistant] chặn ${tool!.declaration.name} — việc của lượt trước`);
          return { functionResponse: { name: fc.name, response: { result: KHONG_CHAY_VIEC_CU } } };
        }
        // Báo tiến trình bằng tên đã nhận diện được, để nhãn chờ hiện đúng việc.
        opts.onEvent?.({ type: 'tool', name: tool?.declaration.name || fc.name });
        if (tool) opts.goiHam?.push(tool.declaration.name);
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
    sheetTool(nguoiCua(members.find((m) => m.id === memberId), memberId)),
    saveTool(nguoiCua(members.find((m) => m.id === memberId), memberId)),
    ...questionTools(nguoiCua(members.find((m) => m.id === memberId), memberId)),
    // Nhóm GHI: giám đốc nhắn một câu là dữ liệu vào thẳng sổ sách.
    ...moneyWriteTools(),
    ...crmWriteTools(memberId),
    ...reminderManageTools(memberId),
    ...dedupeTools(),
    ...pointAdjustTools(members.find((m) => m.id === memberId)?.fullName || ''),
  ];

  const system = directorPrompt({ today, names });

  try {
    const answer = await runToolLoopChan({ system, question, history, tools, onEvent });
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
      run: () => catalogText(me.teamId || ''),
    },
    PROFILE_TOOL,
    // Quyền xem chặn cứng ở tầng SQL: chỉ thấy mục 'all' + mục của phòng mình + đoạn riêng của mình.
    knowledgeTool({ directorScope: false, memberId, teamId: me.teamId || '' }),
    reminderTool(memberId, me.role),
    ...reminderManageTools(memberId),
    // Lưu / nạp sheet vẫn được, nhưng đi qua bộ phân loại — không còn ghi thẳng vào kho chung.
    sheetTool(nguoiCua(me, memberId)),
    saveTool(nguoiCua(me, memberId)),
    askDirectorTool(nguoiCua(me, memberId)),
    // Chỉ sale mới ghi được khách/lịch hẹn. Nhân viên khác KHÔNG có công cụ ghi nào —
    // chặn ở đây chứ không nhờ prompt, để không "dụ" được.
    ...(me.role === 'sale' ? crmWriteTools(memberId) : []),
  ];

  const system = memberPrompt({ today, fullName: me.fullName, teamId: me.teamId || '', isSale: me.role === 'sale' });

  try {
    const answer = await runToolLoopChan({ system, question, history, tools, onEvent });
    return answer || 'Mình chưa tạo được câu trả lời, thử hỏi lại cụ thể hơn nhé.';
  } catch (e) {
    console.error('[assistant] member Q&A:', e);
    return FRIENDLY_ERROR;
  }
}
