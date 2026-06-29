import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { interpret } from '../gemini/chatNlu.js';
import { getActiveCatalog, findCatalogItem, sortCatalogForTeam } from './catalog.repo.js';
import { findById, findByLogin } from './members.repo.js';
import { logTask, startTask, assignTask, canAssign } from './tasks.service.js';
import { memberScore } from './scores.service.js';
import { formatVnd } from '../lib/money.js';
import { formatMinutes } from '../lib/worktime.js';
import { fmtHm } from '../lib/datetime.js';

export const chatRouter = Router();
chatRouter.use(requireAuth);

const bodySchema = z.object({
  message: z.string().optional().default(''),
  confirmTaskCode: z.string().optional(),
  confirmStartTaskCode: z.string().optional(),
  confirmAssign: z.boolean().optional(),
  assigneeId: z.string().optional(),
  assignTaskName: z.string().optional(),
});

const ASSIGN_ROLES = new Set(['leader', 'director', 'admin']);

/** Lấy các tên đăng nhập được @tag trong câu (token sau @, không dấu cách). */
function parseMentions(message: string): string[] {
  return [...message.matchAll(/@([a-zA-Z0-9_.]+)/g)].map((m) => m[1]!.toLowerCase());
}

chatRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = bodySchema.parse(req.body);
    const memberId = req.user!.sub;

    // 1a) Người dùng xác nhận HOÀN THÀNH NGAY một task được gợi ý.
    if (b.confirmTaskCode) {
      const { task, points } = await logTask({ memberId, taskCode: b.confirmTaskCode, source: 'chat' });
      res.json({ reply: `Đã ghi nhận "${task.taskName}" (+${points}đ). 💪`, action: 'task_logged', task });
      return;
    }

    // 1b) Người dùng xác nhận BẮT ĐẦU một task.
    if (b.confirmStartTaskCode) {
      const { task } = await startTask({ memberId, taskCode: b.confirmStartTaskCode, source: 'chat' });
      res.json({
        reply: `▶️ Đã bắt đầu "${task.taskName}" lúc ${fmtHm(task.startedAt)}. Xong việc bấm nút "⏳ Đang làm" bên dưới để hoàn thành & nhận +${task.points}đ nhé.`,
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
      res.json({
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
        res.json({ reply: `Không tìm thấy người dùng @${mentions[0]}. Gõ @ rồi chọn tên trong danh sách nhé.`, action: 'help' });
        return;
      }
      if (!canAssign(me, assignee)) {
        res.json({ reply: `Bạn không có quyền giao việc cho ${assignee.fullName}.`, action: 'help' });
        return;
      }
      const taskText = b.message.replace(/@[a-zA-Z0-9_.]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!taskText) {
        res.json({ reply: `Nhập nội dung việc cần giao cho ${assignee.fullName}, vd "@${assignee.username} viết bài SEO sản phẩm A".`, action: 'help' });
        return;
      }
      res.json({
        reply: `Giao việc "${taskText}" cho ${assignee.fullName}? Bấm xác nhận để giao.`,
        action: 'confirm_assign',
        suggestion: { taskName: taskText },
        assignee: { id: assignee.id, fullName: assignee.fullName },
      });
      return;
    }

    const x = await interpret(b.message, catalog, me?.teamId || '');

    // 2) Bắt đầu task → thẻ xác nhận bắt đầu.
    if (x.intent === 'start_task' && x.taskCode) {
      const item = await findCatalogItem(x.taskCode);
      if (item) {
        res.json({
          reply: `Bắt đầu làm "${item.name}" từ bây giờ? (+${item.points}đ khi hoàn thành)`,
          action: 'confirm_start',
          suggestion: { taskCode: item.code, taskName: item.name, points: item.points },
        });
        return;
      }
    }

    // 3) Hoàn thành ngay → thẻ xác nhận ghi điểm.
    if (x.intent === 'log_task' && x.taskCode) {
      const item = await findCatalogItem(x.taskCode);
      if (item) {
        res.json({
          reply: `Bạn vừa hoàn thành "${item.name}" (+${item.points}đ)? Bấm xác nhận để ghi nhận nhé.`,
          action: 'confirm_task',
          suggestion: { taskCode: item.code, taskName: item.name, points: item.points },
        });
        return;
      }
    }

    // 4) Điểm/giờ làm cá nhân.
    if (x.intent === 'query_stats') {
      const s = await memberScore(memberId);
      res.json({
        reply: `Tháng này bạn được ${s.monthPoints}đ (hôm nay +${s.todayPoints}đ). Thưởng hiện tại: ${formatVnd(s.bonus)}. ⏱ Giờ làm hôm nay: ${formatMinutes(s.workMinutesToday)}.`,
        action: 'stats',
        score: s,
      });
      return;
    }

    // 5) Help / fallback.
    res.json({
      reply:
        x.reply ||
        'Mình có thể: bắt đầu task ("bắt đầu lên ads"), ghi nhận task đã xong ("đã đăng bài page"), hoặc xem điểm/thưởng/giờ làm. Bạn cần gì?',
      action: 'help',
      catalog,
    });
  }),
);
