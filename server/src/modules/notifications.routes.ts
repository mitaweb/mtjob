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
  getSubscriptions,
  deleteSubscription,
} from './notifications.repo.js';
import { vapidPublicKey, sendPush } from '../push/webpush.js';
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

/**
 * Chẩn đoán thông báo đẩy CỦA CHÍNH MÌNH.
 *
 * Anh Tâm 1/8/2026: "vẫn chưa nhận được thông báo nào". Trước đây `sendPush` nuốt sạch
 * lỗi nên không có cách nào biết hỏng ở khâu nào — máy chủ chưa cấu hình, thiết bị chưa
 * đăng ký, hay dịch vụ đẩy từ chối. Endpoint này trả lời đúng ba câu đó.
 *
 * Chỉ đụng dữ liệu của người đang đăng nhập; không xem được đăng ký của ai khác.
 */
notificationsRouter.get(
  '/diag',
  asyncHandler(async (req, res) => {
    const subs = await getSubscriptions(req.user!.sub);
    res.json({
      serverReady: !!vapidPublicKey(),
      deviceCount: subs.length,
      devices: subs.map((s) => ({
        // Cắt endpoint: đủ để phân biệt máy, không lộ nguyên khoá đẩy.
        host: (() => {
          try {
            return new URL(s.endpoint).host;
          } catch {
            return '(không đọc được)';
          }
        })(),
        tail: s.endpoint.slice(-8),
        ua: (s.ua || '').slice(0, 60),
        createdAt: s.createdAt,
      })),
    });
  }),
);

/** Gửi thử một thông báo về CHÍNH MÌNH, trả kết quả từng thiết bị. */
notificationsRouter.post(
  '/test',
  asyncHandler(async (req, res) => {
    const subs = await getSubscriptions(req.user!.sub);
    if (subs.length === 0) {
      res.json({
        ok: false,
        deviceCount: 0,
        message: 'Máy này chưa đăng ký nhận thông báo. Bấm nút 🔔 Bật đẩy trước đã.',
        results: [],
      });
      return;
    }

    const results = await Promise.all(
      subs.map(async (s) => {
        const r = await sendPush(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          {
            title: 'MTJOB — gửi thử 🔔',
            body: `Nếu thấy dòng này thì thông báo đẩy đang chạy tốt (${nowTz().format('HH:mm DD/MM')}).`,
            url: '/inbox',
            tag: 'test',
          },
        );
        // Đăng ký chết thì dọn luôn, để lần sau không báo lỗi lặp lại.
        if (r.gone) await deleteSubscription(s.endpoint).catch(() => undefined);
        return { tail: s.endpoint.slice(-8), ok: r.ok, status: r.status ?? 0, error: r.error || '' };
      }),
    );

    const sent = results.filter((r) => r.ok).length;
    res.json({
      ok: sent > 0,
      deviceCount: subs.length,
      message: sent > 0 ? `Đã gửi tới ${sent}/${subs.length} thiết bị.` : 'Không gửi được tới thiết bị nào.',
      results,
    });
  }),
);
