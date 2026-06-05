import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { getNotifications, markRead, saveSubscription } from './notifications.repo.js';
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
    res.json({ notifications: await getNotifications(req.user!.sub) });
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

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await markRead(req.params.id);
    res.json({ ok: true });
  }),
);
