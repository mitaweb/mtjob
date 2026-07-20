import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { interpret } from '../gemini/chatNlu.js';
import { getActiveCatalog, findCatalogItem, sortCatalogForTeam } from './catalog.repo.js';
import { findById, findByLogin } from './members.repo.js';
import { logTask, startTask, assignTask, canAssign } from './tasks.service.js';
import {
  answerDataQuestion,
  answerMemberQuestion,
  type ChatTurn,
  type OnAssistantEvent,
} from './assistant.service.js';
import { taskTitle } from '../lib/tasks.js';
import { looksLikeQuestion } from '../lib/question.js';
import { removeAccents } from '../lib/people.js';
import { getCustomers } from './crm.repo.js';
import { memberScore } from './scores.service.js';
import { formatVnd } from '../lib/money.js';
import { formatMinutes } from '../lib/worktime.js';
import { fmtHm, nowTz } from '../lib/datetime.js';
import { addChatMessages, type ChatMessageRow } from './chat.repo.js';
import { autoBackfill } from './brain.service.js';
import { sweepRemindersOpportunistic } from './reminders.service.js';
import { newId } from '../util/id.js';
import { runInBackground } from '../util/background.js';

export const chatRouter = Router();
chatRouter.use(requireAuth);

const bodySchema = z.object({
  message: z.string().optional().default(''),
  confirmTaskCode: z.string().optional(),
  confirmStartTaskCode: z.string().optional(),
  note: z.string().optional(), // mô tả cụ thể của việc (vd "X Salon") — hiện ở báo cáo
  confirmAssign: z.boolean().optional(),
  assigneeId: z.string().optional(),
  assignTaskName: z.string().optional(),
  // Lịch sử hội thoại gần nhất (frontend gửi kèm) — để AI hiểu câu hỏi nối tiếp.
  history: z
    .array(z.object({ role: z.enum(['user', 'model']), text: z.string().max(2000) }))
    .max(10)
    .optional()
    .default([]),
});

const ASSIGN_ROLES = new Set(['leader', 'director', 'admin']);

/** Lấy các tên đăng nhập được @tag trong câu (token sau @, không dấu cách). */
function parseMentions(message: string): string[] {
  return [...message.matchAll(/@([a-zA-Z0-9_.]+)/g)].map((m) => m[1]!.toLowerCase());
}


/** Tên các khách đang hoạt động (dùng cho bước hỏi "việc này cho khách nào"). */
async function customerNames(): Promise<string[]> {
  try {
    return (await getCustomers()).map((c) => c.name).filter(Boolean);
  } catch {
    return [];
  }
}

/** Ghi chú việc đã nhắc tên khách nào chưa? Trả về tên khách khớp, hoặc null. */
async function matchCustomer(note: string): Promise<string | null> {
  const hay = removeAccents(note || '').toLowerCase();
  if (!hay) return null;
  for (const name of await customerNames()) {
    const needle = removeAccents(name).toLowerCase().trim();
    if (needle.length >= 3 && hay.includes(needle)) return name;
  }
  return null;
}

/** Payload trả về cho frontend (mọi lối ra của handler). */
interface ChatReply {
  reply: string;
  action: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

/**
 * Lưu 1 lượt hội thoại (câu hỏi + câu trả lời) chạy nền — chỉ vào LỊCH SỬ chat.
 * KHÔNG tự nạp vào kho tri thức: trước đây vơ vét mọi cặp hỏi-đáp nên kho bị nhiễu.
 * Giờ người dùng chủ động bấm "Lưu vào kho" khi chốt được điều đáng nhớ (POST /brain/notes).
 */
function saveChatTurn(memberId: string, userText: string, payload: ChatReply): void {
  const now = nowTz().toISOString();
  const rows: ChatMessageRow[] = [];
  const question = (userText || '').trim();
  if (question) {
    rows.push({ id: newId('CM-'), memberId, role: 'user', text: question, action: '', createdAt: now });
  }
  rows.push({
    id: newId('CM-'),
    memberId,
    role: 'model',
    text: payload.reply || '',
    action: payload.action || '',
    createdAt: now,
  });

  runInBackground(addChatMessages(rows).catch((e) => console.warn('[chat] lưu lịch sử:', e)));
}

type ChatBody = z.infer<typeof bodySchema>;

/**
 * Toàn bộ logic chat, dùng chung cho cả hai đường:
 *  - POST /api/chat        → gom lại rồi trả JSON một lần
 *  - POST /api/chat/stream → phát sự kiện SSE, chữ hiện dần
 * `emit` nhận payload cuối cùng; `onEvent` (nếu có) nhận tiến trình + từng mẩu chữ.
 */
async function runChat(
  memberId: string,
  b: ChatBody,
  emit: (payload: ChatReply) => void,
  onEvent?: OnAssistantEvent,
): Promise<void> {
  {
    // Mọi lối ra đi qua đây: trả kết quả rồi lưu lịch sử chat chạy nền.
    const send = (payload: ChatReply): void => {
      emit(payload);
      saveChatTurn(memberId, b.message, payload);
      autoBackfill(); // kho tự đầy dần khi mọi người dùng app — không ai phải bấm nút
      sweepRemindersOpportunistic(); // lối lui khi chưa gắn cron ngoài cho nhắc hẹn
    };

    // 1a) Người dùng xác nhận HOÀN THÀNH NGAY một task được gợi ý.
    if (b.confirmTaskCode) {
      const { task, points } = await logTask({ memberId, taskCode: b.confirmTaskCode, note: b.note, source: 'chat' });
      send({ reply: `Đã ghi nhận "${taskTitle(task)}" (+${points}đ). 💪`, action: 'task_logged', task });
      return;
    }

    // 1b) Người dùng xác nhận BẮT ĐẦU một task.
    if (b.confirmStartTaskCode) {
      const { task } = await startTask({ memberId, taskCode: b.confirmStartTaskCode, note: b.note, source: 'chat' });
      send({
        reply: `▶️ Đã bắt đầu "${taskTitle(task)}" lúc ${fmtHm(task.startedAt)}. Xong việc bấm nút "⏳ Đang làm" bên dưới để hoàn thành & nhận +${task.points}đ nhé.`,
        action: 'task_started',
        task,
      });
      return;
    }

    // 1c) Xác nhận GIAO VIỆC cho thành viên (leader/giám đốc).
    if (b.confirmAssign && b.assigneeId && b.assignTaskName) {
      const { task } = await assignTask({
        assignerId: memberId,
        assigneeId: b.assigneeId,
        taskName: b.assignTaskName,
      });
      send({
        reply: `📌 Đã giao "${task.taskName}" cho ${task.memberName}. Họ sẽ thấy ở mục "Cần làm", chọn loại việc rồi bắt đầu.`,
        action: 'task_assigned',
        task,
      });
      return;
    }

    // Ưu tiên task thuộc team của nhân sự (Ads/Content/SEO) khi gợi ý.
    const me = await findById(memberId);
    const fullCatalog = await getActiveCatalog();
    const catalog = sortCatalogForTeam(fullCatalog, me?.teamId || '');

    // 1d) GIAO VIỆC qua @tag: leader/giám đốc gõ "@username + mô tả việc".
    // Việc giao là mô tả tự do; người nhận sẽ tự chọn loại task (Ads/Content/SEO) khi Bắt đầu.
    const mentions = parseMentions(b.message);
    if (me && ASSIGN_ROLES.has(me.role) && mentions.length > 0) {
      const assignee = await findByLogin(mentions[0]!);
      if (!assignee || !assignee.active) {
        send({ reply: `Không tìm thấy người dùng @${mentions[0]}. Gõ @ rồi chọn tên trong danh sách nhé.`, action: 'help' });
        return;
      }
      if (!canAssign(me, assignee)) {
        send({ reply: `Bạn không có quyền giao việc cho ${assignee.fullName}.`, action: 'help' });
        return;
      }
      const taskText = b.message.replace(/@[a-zA-Z0-9_.]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!taskText) {
        send({ reply: `Nhập nội dung việc cần giao cho ${assignee.fullName}, vd "@${assignee.username} viết bài SEO sản phẩm A".`, action: 'help' });
        return;
      }
      send({
        reply: `Giao việc "${taskText}" cho ${assignee.fullName}? Bấm xác nhận để giao.`,
        action: 'confirm_assign',
        suggestion: { taskName: taskText },
        assignee: { id: assignee.id, fullName: assignee.fullName },
      });
      return;
    }

    // 1e) Giám đốc/Admin (không @tag ai) → hỏi-đáp dữ liệu hệ thống bằng AI.
    if (me && (me.role === 'director' || me.role === 'admin') && b.message.trim()) {
      const answer = await answerDataQuestion(memberId, b.message, b.history as ChatTurn[], onEvent);
      send({ reply: answer, action: 'data_answer' });
      return;
    }

    // 1f) Nhân viên ĐẶT CÂU HỎI → trả lời thẳng bằng AI, KHÔNG đưa qua bộ nhận diện ghi việc
    // (nếu không, "đã đăng bài page chưa?" sẽ bị hiểu thành báo đã đăng bài).
    if (b.message.trim() && looksLikeQuestion(b.message)) {
      const answer = await answerMemberQuestion(memberId, b.message, b.history as ChatTurn[], onEvent);
      if (answer) {
        send({ reply: answer, action: 'data_answer' });
        return;
      }
    }

    const x = await interpret(b.message, catalog, me?.teamId || '');

    // 2+3) Ghi việc (bắt đầu / đã xong) — phải rõ việc này làm cho KHÁCH NÀO.
    if ((x.intent === 'start_task' || x.intent === 'log_task') && x.taskCode) {
      const item = await findCatalogItem(x.taskCode);
      if (item) {
        const starting = x.intent === 'start_task';
        const note = (x.note || '').trim();
        const known = await matchCustomer(note);

        // Chưa biết khách nào → hỏi lại trước, đừng ghi nhận việc mơ hồ.
        // (Chọn xong, frontend tự dựng thẻ xác nhận nên không quay lại nhánh này.)
        if (!known) {
          send({
            reply: `"${item.name}" — việc này cho khách nào vậy?`,
            action: 'ask_customer',
            suggestion: { taskCode: item.code, taskName: item.name, points: item.points, note },
            starting,
            customers: await customerNames(),
          });
          return;
        }

        send({
          reply: starting
            ? `Bắt đầu làm "${item.name}"${known ? ` cho ${known}` : ''} từ bây giờ? (+${item.points}đ khi hoàn thành)`
            : `Bạn vừa hoàn thành "${item.name}"${known ? ` cho ${known}` : ''} (+${item.points}đ)? Bấm xác nhận để ghi nhận nhé.`,
          action: starting ? 'confirm_start' : 'confirm_task',
          suggestion: { taskCode: item.code, taskName: item.name, points: item.points, note },
        });
        return;
      }
    }

    // 4) Hỏi về dữ liệu cá nhân (điểm/công/việc/đơn từ) → AI tự tra dữ liệu CỦA CHÍNH MÌNH.
    if (x.intent === 'query_stats') {
      const answer = await answerMemberQuestion(memberId, b.message, b.history as ChatTurn[], onEvent);
      if (answer) {
        send({ reply: answer, action: 'data_answer' });
        return;
      }
      // AI chưa cấu hình → trả con số cố định như cũ.
      const s = await memberScore(memberId);
      send({
        reply: `Tháng này bạn được ${s.monthPoints}đ (hôm nay +${s.todayPoints}đ). Thưởng hiện tại: ${formatVnd(s.bonus)}. ⏱ Giờ làm hôm nay: ${formatMinutes(s.workMinutesToday)}.`,
        action: 'stats',
        score: s,
      });
      return;
    }

    // 5) Câu hỏi tự do → trợ lý cá nhân (AI); chưa cấu hình AI thì trả hướng dẫn như cũ.
    if (b.message.trim()) {
      const answer = await answerMemberQuestion(memberId, b.message, b.history as ChatTurn[], onEvent);
      if (answer) {
        send({ reply: answer, action: 'data_answer' });
        return;
      }
    }
    send({
      reply:
        x.reply ||
        'Mình có thể: bắt đầu task ("bắt đầu lên ads"), ghi nhận task đã xong ("đã đăng bài page"), hoặc xem điểm/thưởng/giờ làm. Bạn cần gì?',
      action: 'help',
      catalog,
    });
  }
}

// Đường thường: trả JSON một lần. Dùng cho các nút xác nhận và làm lối lui khi stream hỏng.
chatRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = bodySchema.parse(req.body);
    await runChat(req.user!.sub, b, (payload) => res.json(payload));
  }),
);

/**
 * Đường stream (SSE): chữ hiện dần + báo đang tra hàm nào.
 * Sự kiện: {type:'tool'|'text'|'done'|'error'}. Frontend tự rơi về POST /api/chat nếu hỏng.
 */
chatRouter.post(
  '/stream',
  asyncHandler(async (req, res) => {
    const b = bodySchema.parse(req.body);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // chặn proxy gom buffer làm mất tác dụng stream
    res.flushHeaders?.();

    const write = (ev: Record<string, unknown>): void => {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    };

    try {
      await runChat(
        req.user!.sub,
        b,
        (payload) => write({ type: 'done', payload }),
        (ev) => write(ev),
      );
    } catch (e) {
      console.error('[chat stream]', e);
      write({ type: 'error', message: (e as Error).message });
    } finally {
      res.end();
    }
  }),
);
