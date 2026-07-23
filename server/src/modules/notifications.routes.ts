import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import {
  getNotifications,
  countUnreadByType,
  markRead,
  markAllRead,
  saveSubscription,
} from './notifications.repo.js';
import { vapidPublicKey } from '../push/webpush.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';

export const notificationsRouter = Router();

// Public: the frontend needs the VAPID key before the user subscribes.
notificationsRouter.get('/vapid-public-key', (_req, res) => {
  res.json({ key: vapidPublicKey() });
});

notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // ?types=request,daily — mỗi nhóm tải riêng nên nhóm ồn không lấn chỗ nhóm khác.
    const types = String(req.query.types || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json({ notifications: await getNotifications(req.user!.sub, { types, limit }) });
  }),
);

/** Số chưa đọc theo loại — cho badge từng nhóm và chuông trên thanh trên. */
notificationsRouter.get(
  '/unread-counts',
  asyncHandler(async (req, res) => {
    const counts = await countUnreadByType(req.user!.sub);
    res.json({ counts, total: Object.values(counts).reduce((s, n) => s + n, 0) });
  }),
);

const subSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

notificationsRouter.post(
  '/subscribe',
  asyncHandler(async (req, res) => {
    const sub = subSchema.parse(req.body);
    await saveSubscription({
      subId: newId('S-'),
      memberId: req.user!.sub,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      ua: String(req.headers['user-agent'] || ''),
      createdAt: nowTz().toISOString(),
    });
    res.json({ ok: true });
  }),
);

/** Đánh dấu đã đọc cả nhóm (hoặc tất cả nếu không truyền types). */
notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const { types } = z.object({ types: z.array(z.string()).optional() }).parse(req.body ?? {});
    res.json({ ok: true, marked: await markAllRead(req.user!.sub, types) });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await markRead(req.params.id);
    res.json({ ok: true });
  }),
);
