import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { interpret } from '../gemini/chatNlu.js';
import { getActiveCatalog, findCatalogItem } from './catalog.repo.js';
import { logTask } from './tasks.service.js';
import { memberScore } from './scores.service.js';
import { formatVnd } from '../lib/money.js';

export const chatRouter = Router();
chatRouter.use(requireAuth);

const bodySchema = z.object({
  message: z.string().optional().default(''),
  confirmTaskCode: z.string().optional(),
});

chatRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = bodySchema.parse(req.body);
    const memberId = req.user!.sub;

    // 1) User confirmed a previously-suggested task → record it.
    if (b.confirmTaskCode) {
      const { task, points } = await logTask({ memberId, taskCode: b.confirmTaskCode, source: 'chat' });
      res.json({ reply: `Đã ghi nhận "${task.taskName}" (+${points}đ). 💪`, action: 'task_logged', task });
      return;
    }

    const catalog = await getActiveCatalog();
    const x = await interpret(b.message, catalog);

    // 2) Log task → confirmation card.
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

    // 3) Personal stats.
    if (x.intent === 'query_stats') {
      const s = await memberScore(memberId);
      res.json({
        reply: `Tháng này bạn được ${s.monthPoints}đ (hôm nay +${s.todayPoints}đ). Thưởng hiện tại: ${formatVnd(s.bonus)}.`,
        action: 'stats',
        score: s,
      });
      return;
    }

    // 4) Help / fallback.
    res.json({
      reply:
        x.reply ||
        'Mình có thể ghi nhận task (vd "đã đăng 1 bài post") hoặc cho biết điểm/thưởng của bạn. Bạn cần gì?',
      action: 'help',
      catalog,
    });
  }),
);
