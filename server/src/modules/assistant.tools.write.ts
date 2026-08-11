// Các công cụ GHI của trợ lý: nhắn một câu là dữ liệu vào thẳng hệ thống.
//   "thu 20 triệu của Quốc Phong"  → khoản Thu trong trang Tài chính
//   "chị Hằng hẹn 2h chiều mai"    → lịch hẹn CRM hoặc nhắc hẹn cá nhân
//
// Anh Tâm chốt: GHI LUÔN, không hỏi xác nhận — "sai anh chat lại sửa". Vì vậy mỗi
// nhóm ghi đều đi kèm công cụ liệt kê + xoá tương ứng, nếu không thì lời hứa "sửa
// lại được" là rỗng. Riêng khoản tiền còn có chốt chặn trùng: nhắn lặp một câu
// không được phép cộng doanh thu hai lần.
//
// Phân quyền KHÔNG nằm ở prompt mà ở chỗ gọi: assistant.service chỉ đưa nhóm TIỀN
// cho giám đốc/admin, nhóm KHÁCH cho thêm sale.
import type { ToolDef } from './assistant.service.js';
import {
  getParties,
  getEntries,
  addEntry,
  deleteEntry,
  type FinanceEntry,
} from './finance.repo.js';
import { collectReceivable } from './finance.service.js';
import {
  getCustomers,
  upsertCustomer,
  addAppointment,
  CLOSED_STATUS,
  type Customer,
} from './crm.repo.js';
import { getReminders, setReminderActive } from './reminders.repo.js';
import {
  findDuplicateTasks,
  markDuplicates,
  restoreDuplicates,
  relabelStartNotes,
  countRelabelable,
  inspectTasks,
} from './tasks.dedupe.js';
import { addAdjustment, listAdjustments, deleteAdjustment, describeAdjust } from './scores.adjust.js';
import { getActiveMembers } from './members.repo.js';
import { isStartReport } from '../lib/tasks.js';
import type { Member } from '../types.js';
import { ingestInBackground, markCustomerDirty } from './brain.service.js';
import { describeRule } from '../lib/reminder.js';
import { parseVndAmount, formatVnd } from '../lib/money.js';
import { nowTz, todayIso, toIsoVn, parseVnDate } from '../lib/datetime.js';
import { removeAccents } from '../lib/people.js';
import { newId } from '../util/id.js';

const flat = (s: string) => removeAccents(String(s || '')).toLowerCase().trim();

/**
 * Cờ bật/tắt từ AI. Gemini hay trả chuỗi "true" thay vì boolean — so sánh `=== true`
 * sẽ âm thầm bỏ qua, người dùng bảo "dọn đi" mà không dọn gì.
 */
function isTrue(v: unknown): boolean {
  return v === true || String(v).toLowerCase() === 'true';
}

function currentMonth(): string {
  return nowTz().format('YYYY-MM');
}

/** Tháng dạng YYYY-MM lấy từ tham số AI truyền, sai định dạng thì về tháng này. */
function argYm(v: unknown): string {
  const s = String(v || '');
  return /^\d{4}-\d{2}$/.test(s) ? s : currentMonth();
}

function entryLine(e: FinanceEntry): string {
  return `${e.kind === 'thu' ? 'Thu' : 'Chi'}: ${e.name} — ${formatVnd(e.amount)}${e.date ? ` (${e.date})` : ''}`;
}

// ── Nhóm TIỀN (chỉ giám đốc/admin) ──

const ADD_ENTRY: ToolDef = {
  declaration: {
    name: 'add_finance_entry',
    description:
      'GHI một khoản thu hoặc chi vào sổ tài chính. Dùng khi giám đốc nói "thu X của khách A", ' +
      '"chi Y tiền quảng cáo", "khách B chuyển Z". Ghi ngay, không cần hỏi lại.',
    parameters: {
      type: 'OBJECT',
      properties: {
        kind: { type: 'STRING', enum: ['thu', 'chi'], description: 'thu = tiền vào, chi = tiền ra.' },
        name: { type: 'STRING', description: 'Nội dung khoản, vd "Quốc Phong - gói content tháng 7".' },
        amount: {
          type: 'STRING',
          description: 'Số tiền. Viết được kiểu "20tr", "1,5 triệu", "500k" hoặc số đầy đủ "20000000".',
        },
        date: { type: 'STRING', description: 'Ngày YYYY-MM-DD. Bỏ trống = hôm nay.' },
        month: { type: 'STRING', description: 'Tháng ghi sổ YYYY-MM. Bỏ trống = suy từ ngày.' },
        force: {
          type: 'BOOLEAN',
          description: 'Chỉ đặt true khi đã báo trùng và người dùng xác nhận vẫn muốn ghi thêm.',
        },
      },
      required: ['kind', 'name', 'amount'],
    },
  },
  run: async (a) => {
    const kind = String(a.kind) === 'chi' ? 'chi' : 'thu';
    const name = String(a.name || '').trim();
    const amount = parseVndAmount(a.amount as string);
    if (!name) return 'Chưa rõ khoản này là gì — hỏi lại nội dung khoản thu/chi.';
    if (!Number.isFinite(amount) || amount <= 0) {
      return `Không hiểu số tiền "${a.amount}". Hỏi lại số tiền cụ thể.`;
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || '')) ? String(a.date) : todayIso();
    const month = /^\d{4}-\d{2}$/.test(String(a.month || '')) ? String(a.month) : date.slice(0, 7);

    // Chốt chặn trùng: nhắn lặp một câu KHÔNG được cộng doanh thu hai lần.
    if (!isTrue(a.force)) {
      const dup = (await getEntries(month)).find(
        (e) => e.kind === kind && e.amount === amount && flat(e.name) === flat(name),
      );
      if (dup) {
        return (
          `CHƯA GHI — tháng ${month} đã có khoản y hệt: ${entryLine(dup)}. ` +
          'Hỏi người dùng đây có phải khoản MỚI không; nếu đúng thì gọi lại hàm này với force=true.'
        );
      }
    }

    await addEntry({ id: newId('F-'), month, kind, name, amount, date, recurring: false, partyId: '' });
    return `Đã ghi ${kind === 'thu' ? 'khoản THU' : 'khoản CHI'} "${name}" ${formatVnd(amount)} ngày ${date} (sổ tháng ${month}).`;
  },
};

const COLLECT: ToolDef = {
  declaration: {
    name: 'collect_receivable',
    description:
      'Đánh dấu ĐÃ THU công nợ của một bên đang có hợp đồng định kỳ (tương đương tick "đã thu" ở trang Tài chính). ' +
      'Dùng khi giám đốc nói "khách A đã trả tiền tháng này". Nếu bên đó không có trong danh sách công nợ ' +
      'thì dùng add_finance_entry thay thế.',
    parameters: {
      type: 'OBJECT',
      properties: {
        partyName: { type: 'STRING', description: 'Tên bên/khách hàng đã trả tiền.' },
        amount: {
          type: 'STRING',
          description: 'Số thực thu nếu chỉ thu một phần. Bỏ trống = thu đủ số phải thu của kỳ.',
        },
        month: { type: 'STRING', description: 'Tháng ghi nhận YYYY-MM. Bỏ trống = tháng này.' },
      },
      required: ['partyName'],
    },
  },
  run: async (a) => {
    const needle = flat(a.partyName as string);
    if (!needle) return 'Chưa rõ thu tiền của bên nào.';
    const parties = (await getParties()).filter((p) => p.active);
    const hits = parties.filter((p) => flat(p.name).includes(needle));
    if (hits.length === 0) {
      return (
        `Không có bên công nợ nào tên "${a.partyName}". ` +
        'Đây là khoản thu lẻ — dùng add_finance_entry để ghi thẳng vào sổ.'
      );
    }
    if (hits.length > 1) {
      return `Có ${hits.length} bên khớp: ${hits.map((p) => p.name).join(', ')}. Hỏi lại là bên nào.`;
    }
    const party = hits[0];
    const month = argYm(a.month);
    const raw = a.amount === undefined || a.amount === null || a.amount === '' ? undefined : parseVndAmount(a.amount as string);
    if (raw !== undefined && (!Number.isFinite(raw) || raw < 0)) {
      return `Không hiểu số tiền "${a.amount}". Hỏi lại số thực thu.`;
    }
    const r = await collectReceivable({ partyId: party.id, month, collected: true, amount: raw });
    if (!r.ok) return r.message || 'Chưa ghi nhận được.';
    const remain = party.receivable - r.amount;
    return (
      `Đã ghi nhận thu ${formatVnd(r.amount)} của ${party.name} (tháng ${month}).` +
      (remain > 0 ? ` Còn nợ ${formatVnd(remain)}.` : '')
    );
  },
};

const LIST_ENTRIES: ToolDef = {
  declaration: {
    name: 'list_finance_entries',
    description:
      'Liệt kê các khoản thu/chi đã ghi trong tháng, để soát lại trước khi sửa hoặc xoá.',
    parameters: {
      type: 'OBJECT',
      properties: { month: { type: 'STRING', description: 'Tháng YYYY-MM. Bỏ trống = tháng này.' } },
    },
  },
  run: async (a) => {
    const month = argYm(a.month);
    const entries = await getEntries(month);
    if (entries.length === 0) return `Tháng ${month} chưa có khoản thu/chi nào.`;
    const income = entries.filter((e) => e.kind === 'thu').reduce((s, e) => s + e.amount, 0);
    const expense = entries.filter((e) => e.kind === 'chi').reduce((s, e) => s + e.amount, 0);
    return [
      `Sổ thu/chi tháng ${month} — Thu ${formatVnd(income)}, Chi ${formatVnd(expense)}, Lãi/Lỗ ${formatVnd(income - expense)}:`,
      ...entries.slice(0, 60).map(entryLine),
    ].join('\n');
  },
};

const DELETE_ENTRY: ToolDef = {
  declaration: {
    name: 'delete_finance_entry',
    description:
      'XOÁ một khoản thu/chi đã ghi nhầm. Dùng khi người dùng nói "xoá khoản…", "ghi sai rồi", "bỏ khoản…". ' +
      'Chỉ xoá khi khớp đúng MỘT khoản; khớp nhiều thì hàm trả về danh sách để hỏi lại.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Một phần tên khoản cần xoá.' },
        amount: { type: 'STRING', description: 'Số tiền của khoản (giúp khớp chính xác hơn).' },
        month: { type: 'STRING', description: 'Tháng YYYY-MM. Bỏ trống = tháng này.' },
      },
      required: ['name'],
    },
  },
  run: async (a) => {
    const needle = flat(a.name as string);
    if (!needle) return 'Chưa rõ cần xoá khoản nào.';
    const month = argYm(a.month);
    const amount = a.amount ? parseVndAmount(a.amount as string) : NaN;
    const hits = (await getEntries(month)).filter(
      (e) => flat(e.name).includes(needle) && (!Number.isFinite(amount) || e.amount === amount),
    );
    if (hits.length === 0) return `Tháng ${month} không có khoản nào khớp "${a.name}".`;
    if (hits.length > 1) {
      return [
        `Có ${hits.length} khoản khớp — hỏi lại người dùng là khoản nào rồi gọi lại kèm số tiền:`,
        ...hits.map(entryLine),
      ].join('\n');
    }
    await deleteEntry(hits[0].id);
    return `Đã xoá — ${entryLine(hits[0])}`;
  },
};

/** Nhóm công cụ ghi TIỀN. Chỉ cấp cho giám đốc/admin. */
export function moneyWriteTools(): ToolDef[] {
  return [ADD_ENTRY, COLLECT, LIST_ENTRIES, DELETE_ENTRY];
}

// ── Nhóm KHÁCH HÀNG (giám đốc/admin + sale) ──

/**
 * Nhóm công cụ ghi KHÁCH HÀNG. Cấp cho giám đốc/admin và sale.
 * `memberId` = người đang chat, dùng làm người phụ trách mặc định cho khách mới.
 */
export function crmWriteTools(memberId: string): ToolDef[] {
  return [
    {
      declaration: {
        name: 'add_customer',
        description:
          'Thêm khách hàng mới vào CRM, hoặc cập nhật khách đã có (trùng tên thì cập nhật, không tạo bản sao). ' +
          'Dùng khi người dùng nói "thêm khách…", "khách X đã chốt", "lưu số của khách…".',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Tên khách hàng / tên thương hiệu.' },
            phone: { type: 'STRING', description: 'Số điện thoại (nếu có).' },
            status: {
              type: 'STRING',
              description: `Tình trạng: "Mới", "Đang chăm", "${CLOSED_STATUS}"… Bỏ trống = "Mới".`,
            },
            note: { type: 'STRING', description: 'Ghi chú về khách: nhu cầu, ngân sách, bối cảnh.' },
            dob: { type: 'STRING', description: 'Ngày sinh khách YYYY-MM-DD (để nhắc sinh nhật).' },
          },
          required: ['name'],
        },
      },
      run: async (a) => {
        const name = String(a.name || '').trim();
        if (!name) return 'Chưa rõ tên khách hàng.';
        const existing = (await getCustomers()).find((c) => flat(c.name) === flat(name));
        const status = String(a.status || '').trim() || existing?.status || 'Mới';
        const c: Customer = {
          id: existing?.id || newId('C-'),
          name: existing?.name || name,
          phone: String(a.phone || '').trim() || existing?.phone || '',
          status,
          note: String(a.note || '').trim() || existing?.note || '',
          info: existing?.info || '',
          // Nguon khach chi dat tay trong CRM — AI khong doan bua tu mot cau chat.
          source: existing?.source || '',
          assignedTo: existing?.assignedTo || memberId,
          dob: String(a.dob || '').trim() || existing?.dob || '',
          // Mốc chốt hợp đồng chỉ ghi lần ĐẦU chuyển sang "Đã chốt" — mốc tính tái tục.
          closedAt: existing?.closedAt || (status === CLOSED_STATUS ? nowTz().format('YYYY-MM-DD') : ''),
          createdAt: existing?.createdAt || nowTz().toISOString(),
        };
        await upsertCustomer(c);
        // Kho tri thức KHÔNG chứa số điện thoại — nhân viên tra được kho, SĐT chỉ giám đốc xem.
        ingestInBackground({
          sourceType: 'customer',
          sourceId: c.id,
          title: `Hồ sơ khách hàng: ${c.name}`,
          text: [`Khách hàng: ${c.name}`, `Tình trạng: ${c.status}`, c.note ? `Ghi chú: ${c.note}` : '']
            .filter(Boolean)
            .join('\n'),
          visibility: 'all',
          customer: c.name,
        });
        markCustomerDirty(c.name);
        const what = existing ? 'Đã cập nhật khách' : 'Đã thêm khách mới';
        return `${what} "${c.name}" — ${c.status}${c.phone ? `, SĐT ${c.phone}` : ''}${c.note ? `. Ghi chú: ${c.note}` : ''}`;
      },
    },
    {
      declaration: {
        name: 'create_appointment',
        description:
          'Đặt lịch hẹn với một khách hàng ĐÃ CÓ trong CRM (hiện ở mục Lịch hẹn sắp tới). ' +
          'Nếu người được hẹn không phải khách hàng trong hệ thống thì hàm sẽ báo lại — khi đó dùng create_reminder.',
        parameters: {
          type: 'OBJECT',
          properties: {
            customerName: { type: 'STRING', description: 'Tên khách hàng.' },
            at: { type: 'STRING', description: 'Thời điểm hẹn, giờ Việt Nam, dạng YYYY-MM-DDTHH:mm (24h).' },
            note: { type: 'STRING', description: 'Nội dung buổi hẹn.' },
          },
          required: ['customerName', 'at'],
        },
      },
      // Mọi đường THẤT BẠI đều mở đầu bằng "CHƯA ĐẶT ĐƯỢC" — anh Tâm 4/8/2026 gặp cảnh trợ lý
      // đọc câu "không có khách hàng nào tên..." rồi vẫn báo "Đã đặt lịch hẹn ✅". Câu báo hỏng
      // viết như văn xuôi thì AI dễ lướt qua; mở đầu bằng chữ in hoa dứt khoát thì khó lờ hơn.
      run: async (a) => {
        const needle = flat(a.customerName as string);
        if (!needle) return 'CHƯA ĐẶT ĐƯỢC: chưa rõ hẹn với ai. Hỏi lại tên người hẹn.';
        const at = String(a.at || '').trim().slice(0, 16);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) {
          return 'CHƯA ĐẶT ĐƯỢC: thời điểm hẹn phải dạng YYYY-MM-DDTHH:mm giờ Việt Nam, vd "2026-07-24T14:00".';
        }
        const hits = (await getCustomers()).filter((c) => flat(c.name).includes(needle));
        // KHÔNG tự tạo khách mới từ một câu hẹn gặp — "chị Hằng" thường là người quen,
        // tạo bừa sẽ làm bẩn danh sách khách hàng.
        if (hits.length === 0) {
          return (
            `CHƯA ĐẶT ĐƯỢC: không có khách hàng nào tên "${a.customerName}" trong CRM, nên KHÔNG có lịch hẹn nào được tạo. ` +
            'Gọi tiếp create_reminder (repeatKind="once", onDate là ngày hẹn) để đặt nhắc hẹn cá nhân, ' +
            'rồi mới báo lại cho người dùng. Đừng tạo khách mới.'
          );
        }
        if (hits.length > 1) {
          return `CHƯA ĐẶT ĐƯỢC: có ${hits.length} khách khớp: ${hits.map((c) => c.name).join(', ')}. Hỏi lại là khách nào.`;
        }
        const customer = hits[0];
        const note = String(a.note || '').trim();
        const id = newId('A-');
        await addAppointment({
          id,
          customerId: customer.id,
          customerName: customer.name,
          at: toIsoVn(at),
          note,
          ownerId: customer.assignedTo || memberId,
          done: false,
        });
        if (note) {
          ingestInBackground({
            sourceType: 'appointment',
            sourceId: id,
            title: `Lịch hẹn: ${customer.name}`,
            text: `Hẹn ${customer.name} lúc ${at.replace('T', ' ')}: ${note}`,
            visibility: 'all',
            customer: customer.name,
          });
        }
        return `Đã đặt lịch hẹn với ${customer.name} lúc ${at.slice(11)} ngày ${at.slice(0, 10)}${note ? ` — ${note}` : ''}.`;
      },
    },
  ];
}

// ── Nhóm NHẮC HẸN: xem lại và huỷ (bổ sung cho create_reminder đã có) ──

/** Nhắc hẹn luôn thuộc về người đang chat — không xem/huỷ hộ người khác được. */
export function reminderManageTools(memberId: string): ToolDef[] {
  return [
    {
      declaration: {
        name: 'list_reminders',
        description: 'Liệt kê các nhắc hẹn của CHÍNH người đang chat, kèm quy tắc lặp.',
      },
      run: async () => {
        const list = await getReminders(memberId);
        if (list.length === 0) return 'Bạn chưa đặt nhắc hẹn nào.';
        return list
          .map((r) => `${r.active ? '•' : '(đã tắt)'} ${r.title} — ${describeRule(r)}`)
          .join('\n');
      },
    },
    {
      declaration: {
        name: 'cancel_reminder',
        description:
          'Tắt một nhắc hẹn của chính người đang chat. Dùng khi họ nói "bỏ nhắc…", "huỷ lịch nhắc…".',
        parameters: {
          type: 'OBJECT',
          properties: { title: { type: 'STRING', description: 'Một phần nội dung nhắc hẹn cần tắt.' } },
          required: ['title'],
        },
      },
      run: async (a) => {
        const needle = flat(a.title as string);
        if (!needle) return 'Chưa rõ cần huỷ nhắc hẹn nào.';
        const hits = (await getReminders(memberId)).filter(
          (r) => r.active && flat(r.title).includes(needle),
        );
        if (hits.length === 0) return `Không có nhắc hẹn đang bật nào khớp "${a.title}".`;
        if (hits.length > 1) {
          return `Có ${hits.length} nhắc hẹn khớp: ${hits.map((r) => r.title).join(' | ')}. Hỏi lại là cái nào.`;
        }
        await setReminderActive(hits[0].id, memberId, false);
        return `Đã tắt nhắc hẹn "${hits[0].title}".`;
      },
    },
  ];
}

// ── Dọn việc bị tính điểm hai lần (thay cho nút cũ ở trang Quản trị) ──
//
// Đi thành cặp soát/khôi phục: dọn điểm là đụng thẳng vào thưởng và lương, nên
// đường lui phải luôn ở ngay cạnh, không để nằm sau một endpoint không ai gọi.

const DEDUPE_TOOL: ToolDef = {
  declaration: {
    name: 'dedupe_tasks',
    description:
      'Dọn bảng điểm: (1) bỏ điểm việc bị TÍNH HAI LẦN, (2) sửa nhãn việc THẬT còn chữ "bắt đầu" ' +
      'cho hiện đúng tên việc (không đụng điểm). Mặc định chỉ xem trước; đặt apply=true khi người dùng bảo dọn. ' +
      'Dùng cả khi người dùng nói "sao vẫn còn bắt đầu lên ads", "dọn nhãn", "dọn đi".',
    parameters: {
      type: 'OBJECT',
      properties: {
        month: { type: 'STRING', description: 'Chỉ soát 1 tháng, dạng YYYY-MM. Bỏ trống = toàn bộ.' },
        apply: { type: 'BOOLEAN', description: 'true = đánh dấu trùng thật (vẫn khôi phục được).' },
      },
    },
  },
  run: async (a) => {
    const month = /^\d{4}-\d{2}$/.test(String(a.month || '')) ? String(a.month) : undefined;
    const report = await findDuplicateTasks(month);
    const scope = month ? `tháng ${month}` : 'toàn bộ dữ liệu';

    const summary = (rows: Array<{ memberName: string; tasks: number; points: number }>) =>
      rows.map((m) => `${m.memberName}: bỏ ${m.tasks} việc, trừ ${m.points}đ`).join('\n');

    // XEM TRƯỚC — chưa đụng gì. Báo cả hai việc sẽ làm: bỏ điểm dòng trùng, và sửa nhãn
    // việc thật. Đừng thoát sớm khi 0 dòng trùng — có thể vẫn còn hàng chục nhãn cần sửa.
    if (!isTrue(a.apply)) {
      const toRelabel = await countRelabelable(month);
      const out: string[] = [];
      if (report.totalTasks > 0) {
        const byReason = new Map<string, number>();
        for (const it of report.items) byReason.set(it.reason, (byReason.get(it.reason) || 0) + 1);
        out.push(
          `Rà soát ${scope}: ${report.totalTasks} việc bị tính điểm hai lần, tổng ${report.totalPoints}đ tính dư.`,
          summary(report.byMember),
          `Lý do: ${[...byReason].map(([r, n]) => `${n} dòng ${r}`).join('; ')}.`,
        );
      } else {
        out.push(`Rà soát ${scope}: không có việc nào bị tính điểm hai lần.`);
      }
      if (toRelabel > 0) {
        out.push(
          `Ngoài ra có ${toRelabel} việc THẬT (đã bấm nút Bắt đầu rồi Kết thúc) mà nhãn còn chữ "bắt đầu" — ` +
            'điểm ĐÚNG, chỉ xấu chữ; sẽ đổi cho hiện đúng tên việc.',
        );
      }
      if (report.totalTasks === 0 && toRelabel === 0) return `${scope}: sạch hoàn toàn, không có gì để dọn.`;
      out.push('CHƯA đụng gì vào dữ liệu. Người dùng đồng ý thì gọi lại với apply=true để dọn.');
      return out.join('\n');
    }

    // DỌN THẬT. Chạy CẢ HAI bất kể bên nào bằng 0 — đây là chỗ lỗi cũ thoát sớm khi
    // không có dòng trùng, khiến hàng chục nhãn "bắt đầu…" không bao giờ được sửa.
    const markedIds = new Set(await markDuplicates(report.items.map((i) => i.id)));
    const done = report.items.filter((i) => markedIds.has(i.id));
    const relabelled = await relabelStartNotes(month);

    const points = done.reduce((s, i) => s + i.points, 0);
    const byMember = new Map<string, { tasks: number; points: number }>();
    for (const it of done) {
      const cur = byMember.get(it.memberName) || { tasks: 0, points: 0 };
      byMember.set(it.memberName, { tasks: cur.tasks + 1, points: cur.points + it.points });
    }

    const out: string[] = [];
    if (done.length > 0) {
      out.push(
        `Đã bỏ điểm ${done.length} việc trùng, trừ ${points}đ:`,
        summary([...byMember].map(([memberName, v]) => ({ memberName, ...v }))),
      );
    }
    if (relabelled > 0) {
      out.push(`Đã sửa nhãn ${relabelled} việc THẬT cho hết chữ "bắt đầu" — điểm và giờ làm GIỮ NGUYÊN.`);
    }
    if (out.length === 0) return `${scope}: không có gì để dọn, bảng điểm giữ nguyên.`;
    out.push('Việc bỏ điểm chỉ đánh dấu chứ chưa xoá — bảo "khôi phục điểm trùng" là lấy lại được.');
    return out.join('\n');
  },
};

const RESTORE_TOOL: ToolDef = {
  declaration: {
    name: 'restore_duplicate_tasks',
    description:
      'Khôi phục TẤT CẢ việc đã bị đánh dấu trùng, trả lại điểm như cũ. ' +
      'Dùng khi người dùng nói dọn nhầm, "khôi phục điểm", "trả lại điểm vừa trừ".',
  },
  run: async () => {
    const n = await restoreDuplicates();
    return n === 0
      ? 'Không có việc nào đang bị đánh dấu trùng để khôi phục.'
      : `Đã khôi phục ${n} việc — điểm trở lại như trước khi dọn.`;
  },
};

const INSPECT_TOOL: ToolDef = {
  declaration: {
    name: 'inspect_tasks',
    description:
      'Xem DỮ LIỆU THÔ của bảng công việc: từng dòng có giờ bắt đầu hay không, trạng thái, điểm, ghi chú. ' +
      'Dùng khi người dùng thắc mắc "vì sao dòng này còn điểm", "sao dọn rồi vẫn còn", ' +
      'hoặc muốn kiểm chứng trước khi dọn. Chỉ đọc, không sửa gì.',
    parameters: {
      type: 'OBJECT',
      properties: {
        keyword: { type: 'STRING', description: 'Lọc theo chữ trong ghi chú hoặc tên việc, vd "bắt đầu lên ads".' },
        month: { type: 'STRING', description: 'Tháng YYYY-MM.' },
        member: { type: 'STRING', description: 'Tên (một phần) nhân sự.' },
      },
    },
  },
  run: async (a) => {
    const rows = await inspectTasks({
      keyword: String(a.keyword || '').trim() || undefined,
      month: /^\d{4}-\d{2}$/.test(String(a.month || '')) ? String(a.month) : undefined,
      member: String(a.member || '').trim() || undefined,
    });
    if (rows.length === 0) return 'Không có dòng nào khớp.';

    let bogus = 0;
    let real = 0;
    const lines = rows.map((r) => {
      const hasStart = (r.started_at || '').trim() !== '';
      const start = isStartReport(r.note || '');
      if (start && !hasStart) bogus += 1;
      if (start && hasStart) real += 1;
      const day = String(r.completed_at || r.created_at || '').slice(0, 10);
      const mark = hasStart ? 'CÓ giờ bắt đầu' : 'KHÔNG có giờ bắt đầu';
      return `${day} · ${r.member_name} · ${r.task_name} · ghi chú: "${r.note || '(trống)'}" · ${r.points}đ · ${mark} · ${r.status}`;
    });
    return [
      `${rows.length} dòng:`,
      ...lines,
      '',
      `Trong đó ghi chú là câu báo bắt đầu: ${bogus} dòng KHÔNG có giờ bắt đầu (sẽ bị bỏ điểm khi dọn), ` +
        `${real} dòng CÓ giờ bắt đầu (việc thật, chỉ sửa lại nhãn, giữ nguyên điểm).`,
    ].join('\n');
  },
};

/** Bộ công cụ soi/dọn/khôi phục điểm tính hai lần. Chỉ cấp cho giám đốc/admin. */
export function dedupeTools(): ToolDef[] {
  return [INSPECT_TOOL, DEDUPE_TOOL, RESTORE_TOOL];
}

// ── Bù điểm cho ngày nhân sự quên ghi việc ──
//
// Anh Tâm 29/7/2026 nhắn "ngày 1 tháng 7 em nhập cho An Thùy 300 điểm" và trợ lý phải
// trả lời là không có công cụ nào làm được. Đây là công cụ đó.
//
// Đi thành bộ ba ghi/liệt kê/gỡ như các nhóm ghi khác: bù điểm ăn thẳng vào thưởng nên
// đường lui phải nằm ngay cạnh.

/** Tìm nhân sự theo tên gõ tự nhiên. Trả về người, hoặc câu hỏi lại khi chưa chắc. */
async function resolveMember(nameRaw: string): Promise<{ member?: Member; error?: string }> {
  const key = flat(nameRaw);
  if (!key) return { error: 'Chưa rõ bù điểm cho ai.' };

  const members = await getActiveMembers();
  const exact = members.filter((m) => flat(m.fullName) === key);
  const hits = exact.length > 0 ? exact : members.filter((m) => flat(m.fullName).includes(key));

  if (hits.length === 0) return { error: `Không tìm thấy nhân sự nào tên "${nameRaw}".` };
  // Trùng tên thì HỎI LẠI chứ không đoán — cộng nhầm điểm sang người khác rất khó phát hiện.
  if (hits.length > 1) {
    return { error: `Có ${hits.length} người khớp "${nameRaw}": ${hits.map((m) => m.fullName).join(', ')}. Nhắn rõ tên đầy đủ giúp em.` };
  }
  return { member: hits[0]! };
}

/** Ngày AI truyền vào: nhận cả 2026-07-01 lẫn 1/7/2026. */
function argDate(v: unknown): string {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return parseVnDate(s) || '';
}

/**
 * Tháng để LỌC — khác `argYm`: không truyền thì trả undefined (xem tất cả), chứ không
 * âm thầm rơi về tháng này rồi báo "chưa có dòng nào" trong khi tháng trước đầy dòng.
 */
function argYmOptional(v: unknown): string | undefined {
  const s = String(v || '');
  return /^\d{4}-\d{2}$/.test(s) ? s : undefined;
}

const adjustPointsTool = (actorName: string): ToolDef => ({
  declaration: {
    name: 'adjust_points',
    description:
      'Cộng hoặc trừ điểm bù cho một nhân sự vào một NGÀY CỤ THỂ đã qua. Dùng khi người dùng nói ' +
      '"nhập bù 300 điểm cho An Thùy ngày 1/7", "bạn ấy quên ghi việc hôm qua, cộng thêm điểm", ' +
      '"trừ bớt điểm ghi dư". Điểm âm = trừ. Ghi thẳng, không cần hỏi xác nhận.',
    parameters: {
      type: 'OBJECT',
      properties: {
        member: { type: 'STRING', description: 'Tên nhân sự, vd "An Thùy".' },
        date: { type: 'STRING', description: 'Ngày cần bù, dạng YYYY-MM-DD.' },
        points: { type: 'NUMBER', description: 'Số điểm; số âm là trừ bớt.' },
        reason: { type: 'STRING', description: 'Lý do, vd "nhập bổ sung". Bắt buộc.' },
      },
      required: ['member', 'date', 'points', 'reason'],
    },
  },
  run: async (a) => {
    const { member, error } = await resolveMember(String(a.member || ''));
    if (error) return error;

    const date = argDate(a.date);
    if (!date) return `Chưa hiểu ngày "${a.date}". Nhắn lại dạng ngày/tháng/năm giúp em.`;

    const row = await addAdjustment({
      memberId: member!.id,
      date,
      points: Math.trunc(Number(a.points)),
      reason: String(a.reason || '').trim(),
      byName: actorName,
    });
    return (
      `Đã ghi: ${describeAdjust(row)}.\n` +
      'Dòng này hiện trong bảng điểm của bạn ấy như một việc thường. Muốn bỏ thì bảo "gỡ dòng bù điểm".'
    );
  },
});

const LIST_ADJUST_TOOL: ToolDef = {
  declaration: {
    name: 'list_point_adjustments',
    description:
      'Liệt kê các dòng ĐIỂM BÙ đã nhập tay (không phải việc nhân sự tự ghi). ' +
      'Dùng khi người dùng hỏi "đã bù điểm cho ai", "xem lại các dòng nhập bù", hoặc trước khi gỡ.',
    parameters: {
      type: 'OBJECT',
      properties: {
        member: { type: 'STRING', description: 'Lọc theo tên nhân sự.' },
        month: { type: 'STRING', description: 'Lọc theo tháng, dạng YYYY-MM.' },
      },
    },
  },
  run: async (a) => {
    let memberId: string | undefined;
    if (String(a.member || '').trim()) {
      const { member, error } = await resolveMember(String(a.member));
      if (error) return error;
      memberId = member!.id;
    }
    const rows = await listAdjustments({ memberId, month: argYmOptional(a.month) });
    if (rows.length === 0) return 'Chưa có dòng điểm bù nào khớp.';
    return [
      `${rows.length} dòng điểm bù:`,
      ...rows.map((r) => `${r.id} · ${describeAdjust(r)}`),
      'Muốn bỏ dòng nào thì đọc mã T-… của dòng đó.',
    ].join('\n');
  },
};

const DELETE_ADJUST_TOOL: ToolDef = {
  declaration: {
    name: 'delete_point_adjustment',
    description:
      'Gỡ một dòng điểm bù đã nhập tay, trả điểm về như trước. Cần mã dòng lấy từ list_point_adjustments. ' +
      'Chỉ gỡ được dòng nhập tay, không đụng được vào việc nhân sự tự ghi.',
    parameters: {
      type: 'OBJECT',
      properties: { id: { type: 'STRING', description: 'Mã dòng, dạng T-xxxxxxxxxx.' } },
      required: ['id'],
    },
  },
  run: async (a) => {
    const row = await deleteAdjustment(String(a.id || '').trim());
    return `Đã gỡ: ${describeAdjust(row)}. Điểm trở lại như trước khi bù.`;
  },
};

/** Bộ công cụ bù điểm. Chỉ cấp cho giám đốc/admin — leader không tự cộng điểm cho team mình. */
export function pointAdjustTools(actorName: string): ToolDef[] {
  return [adjustPointsTool(actorName), LIST_ADJUST_TOOL, DELETE_ADJUST_TOOL];
}
