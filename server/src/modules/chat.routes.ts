import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { interpret } from '../gemini/chatNlu.js';
import { getActiveCatalog, findCatalogItem, sortCatalogForTeam } from './catalog.repo.js';
import { findById, findByLogin } from './members.repo.js';
import { logTask, startTask, assignTask, canAssign } from './tasks.service.js';
import { answerDataQuestion, answerMemberQuestion, type ChatTurn } from './assistant.service.js';
import { taskTitle } from '../lib/tasks.js';
import { memberScore } from './scores.service.js';
import { formatVnd } from '../lib/money.js';
import { formatMinutes } from '../lib/worktime.js';
import { fmtHm, nowTz } from '../lib/datetime.js';
import { addChatMessages, type ChatMessageRow } from './chat.repo.js';
import { ingest, autoBackfill } from './brain.service.js';
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

/** Payload trả về cho frontend (mọi lối ra của handler). */
interface ChatReply {
  reply: string;
  action: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

// Câu hỏi quá ngắn thì không đáng lưu vào kho tri thức (nhiễu, tốn token).
const MIN_QUESTION_FOR_BRAIN = 30;

/**
 * Lưu 1 lượt hội thoại (câu hỏi + câu trả lời) chạy nền.
 * Riêng hỏi-đáp dữ liệu còn nạp vào kho tri thức để sau này tra lại được;
 * các lượt bấm nút xác nhận chỉ lưu lịch sử, không nạp kho.
 */
function saveChatTurn(memberId: string, userText: string, payload: ChatReply): void {
  const now = nowTz().toISOString();
  const rows: ChatMessageRow[] = [];
  const question = (userText || '').trim();
  if (question) {
    rows.push({ id: newId('CM-'), memberId, role: 'user', text: question, action: '', createdAt: now });
  }
  const msgId = newId('CM-');
  rows.push({
    id: msgId,
    memberId,
    role: 'model',
    text: payload.reply || '',
    action: payload.action || '',
    createdAt: now,
  });

  runInBackground(
    addChatMessages(rows)
      .then(() => {
        if (payload.action !== 'data_answer' || question.length < MIN_QUESTION_FOR_BRAIN) return;
        return ingest({
          sourceType: 'chat',
          sourceId: msgId,
          title: 'Hội thoại với trợ lý',
          text: `Hỏi: ${question}\nĐáp: ${payload.reply || ''}`,
          visibility: memberId, // chat cá nhân — chỉ chính chủ (và giám đốc) tra được
        });
      })
      .catch((e) => console.warn('[chat] lưu lịch sử:', e)),
  );
}

chatRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = bodySchema.parse(req.body);
    const memberId = req.user!.sub;

    // Mọi lối ra của handler đi qua đây: trả response rồi lưu lịch sử chat chạy nền.
    // Câu hỏi-đáp về dữ liệu còn được nạp vào kho tri thức để lần sau tra lại được.
    const send = (payload: ChatReply): void => {
      res.json(payload);
      saveChatTurn(memberId, b.message, payload);
      autoBackfill(); // kho tự đầy dần khi mọi người dùng app — không ai phải bấm nút
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
      const answer = await answerDataQuestion(b.message, b.history as ChatTurn[]);
      send({ reply: answer, action: 'data_answer' });
      return;
    }

    const x = await interpret(b.message, catalog, me?.teamId || '');

    // 2) Bắt đầu task → thẻ xác nhận bắt đầu.
    if (x.intent === 'start_task' && x.taskCode) {
      const item = await findCatalogItem(x.taskCode);
      if (item) {
        send({
          reply: `Bắt đầu làm "${item.name}" từ bây giờ? (+${item.points}đ khi hoàn thành)`,
          action: 'confirm_start',
          suggestion: { taskCode: item.code, taskName: item.name, points: item.points, note: x.note || '' },
        });
        return;
      }
    }

    // 3) Hoàn thành ngay → thẻ xác nhận ghi điểm.
    if (x.intent === 'log_task' && x.taskCode) {
      const item = await findCatalogItem(x.taskCode);
      if (item) {
        send({
          reply: `Bạn vừa hoàn thành "${item.name}" (+${item.points}đ)? Bấm xác nhận để ghi nhận nhé.`,
          action: 'confirm_task',
          suggestion: { taskCode: item.code, taskName: item.name, points: item.points, note: x.note || '' },
        });
        return;
      }
    }

    // 4) Hỏi về dữ liệu cá nhân (điểm/công/việc/đơn từ) → AI tự tra dữ liệu CỦA CHÍNH MÌNH.
    if (x.intent === 'query_stats') {
      const answer = await answerMemberQuestion(memberId, b.message, b.history as ChatTurn[]);
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
      const answer = await answerMemberQuestion(memberId, b.message, b.history as ChatTurn[]);
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
  }),
);
