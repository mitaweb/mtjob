import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import {
  addReminder,
  getReminders,
  setReminderActive,
  deleteReminder,
  type Reminder,
} from './reminders.repo.js';
import { describeRule, isExpiredOnce } from '../lib/reminder.js';
import { newId } from '../util/id.js';
import { nowTz, todayIso } from '../lib/datetime.js';

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

const createSchema = z.object({
  title: z.string().min(1).max(200),
  atTime: z.string().regex(/^\d{1,2}:\d{2}$/, 'Giờ phải dạng HH:mm'),
  repeatKind: z.enum(['once', 'daily', 'weekly', 'monthly']),
  onDate: z.string().optional().default(''),
  weekday: z.number().int().min(0).max(6).optional().default(1),
  dayOfMonth: z.number().int().min(1).max(31).optional().default(1),
});

/** Nhắc hẹn của chính mình — không ai xem được của người khác. */
remindersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // Nhắc một lần đã qua ngày = việc xong rồi. Anh Tâm 2/8/2026: gom vào mục "Đã xong",
    // đừng để lẫn trong danh sách đang theo dõi — nhìn mãi thành quen mắt, bỏ sót cái thật.
    const today = todayIso();
    const reminders = (await getReminders(req.user!.sub)).map((r) => ({
      ...r,
      done: isExpiredOnce(
        {
          atTime: r.atTime,
          repeatKind: r.repeatKind,
          onDate: r.onDate,
          weekday: r.weekday,
          dayOfMonth: r.dayOfMonth,
          lastFired: r.lastFired,
        },
        today,
      ),
    }));
    res.json({ reminders });
  }),
);

remindersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = createSchema.parse(req.body);
    if (b.repeatKind === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(b.onDate)) {
      throw new ApiError(400, 'Nhắc một lần cần chọn ngày cụ thể');
    }
    // Chuẩn hoá "8:00" → "08:00" để hiển thị và so sánh nhất quán.
    const [h, m] = b.atTime.split(':');
    const atTime = `${String(Number(h)).padStart(2, '0')}:${m}`;

    const r: Reminder = {
      id: newId('RM-'),
      memberId: req.user!.sub, // luôn là người đang đăng nhập — không cho tạo hộ ai khác
      title: b.title.trim(),
      atTime,
      repeatKind: b.repeatKind,
      onDate: b.onDate,
      weekday: b.weekday,
      dayOfMonth: b.dayOfMonth,
      active: true,
      lastFired: '',
      createdAt: nowTz().toISOString(),
    };
    await addReminder(r);
    res.json({ ok: true, id: r.id, describe: describeRule(r) });
  }),
);

remindersRouter.post(
  '/:id/toggle',
  asyncHandler(async (req, res) => {
    const active = req.body?.active !== false;
    const ok = await setReminderActive(String(req.params.id), req.user!.sub, active);
    if (!ok) throw new ApiError(404, 'Không tìm thấy nhắc hẹn');
    res.json({ ok: true, active });
  }),
);

remindersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await deleteReminder(String(req.params.id), req.user!.sub);
    res.json({ ok: true });
  }),
);
