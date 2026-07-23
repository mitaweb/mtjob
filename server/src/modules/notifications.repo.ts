import { q } from '../db/client.js';

export interface NotificationRow {
  id: string;
  memberId: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string;
}

export interface PushSubscriptionRow {
  subId: string;
  memberId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  ua: string;
  createdAt: string;
}

export async function addNotification(n: NotificationRow): Promise<void> {
  await q(
    `INSERT INTO notifications (notif_id, member_id, type, title, body, created_at, read_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [n.id, n.memberId, n.type, n.title, n.body, n.createdAt, n.readAt || ''],
  );
}

/**
 * Thông báo của một người, MỚI NHẤT TRƯỚC.
 * `types`: lọc theo loại ngay trong SQL — quan trọng vì mỗi nhóm cần suất riêng.
 * (Lọc phía client sẽ hỏng khi một nhóm ồn chiếm hết `limit`, các nhóm khác thành trống.)
 */
export async function getNotifications(
  memberId: string,
  opts: { types?: string[]; limit?: number } = {},
): Promise<NotificationRow[]> {
  const limit = opts.limit ?? 50;
  const rows = opts.types?.length
    ? await q(
        'SELECT * FROM notifications WHERE member_id = $1 AND type = ANY($2) ORDER BY created_at DESC LIMIT $3',
        [memberId, opts.types, limit],
      )
    : await q('SELECT * FROM notifications WHERE member_id = $1 ORDER BY created_at DESC LIMIT $2', [
        memberId,
        limit,
      ]);
  return rows.map((r) => ({
    id: r.notif_id || '',
    memberId: r.member_id || '',
    type: r.type || '',
    title: r.title || '',
    body: r.body || '',
    createdAt: r.created_at || '',
    readAt: r.read_at || '',
  }));
}

/** Số chưa đọc theo từng loại — đếm trên TOÀN BỘ dữ liệu nên badge không phụ thuộc limit. */
export async function countUnreadByType(memberId: string): Promise<Record<string, number>> {
  const rows = await q(
    "SELECT type, COUNT(*) AS n FROM notifications WHERE member_id = $1 AND read_at = '' GROUP BY type",
    [memberId],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.type || '')] = Number(r.n) || 0;
  return out;
}

/**
 * Đánh dấu đã đọc hàng loạt cho một người. `types` rỗng = tất cả.
 * Dùng cho nút "đánh dấu đã đọc" theo từng nhóm thông báo.
 */
export async function markAllRead(memberId: string, types?: string[]): Promise<number> {
  const now = new Date().toISOString();
  const rows = types?.length
    ? await q(
        "UPDATE notifications SET read_at = $1 WHERE member_id = $2 AND read_at = '' AND type = ANY($3) RETURNING notif_id",
        [now, memberId, types],
      )
    : await q(
        "UPDATE notifications SET read_at = $1 WHERE member_id = $2 AND read_at = '' RETURNING notif_id",
        [now, memberId],
      );
  return rows.length;
}

export async function markRead(notifId: string): Promise<boolean> {
  const rows = await q(
    'UPDATE notifications SET read_at = $1 WHERE notif_id = $2 RETURNING notif_id',
    [new Date().toISOString(), notifId],
  );
  return rows.length > 0;
}

export async function getSubscriptions(memberId?: string): Promise<PushSubscriptionRow[]> {
  const rows = memberId
    ? await q('SELECT * FROM push_subscriptions WHERE member_id = $1', [memberId])
    : await q('SELECT * FROM push_subscriptions');
  return rows.map((r) => ({
    subId: r.sub_id || '',
    memberId: r.member_id || '',
    endpoint: r.endpoint || '',
    p256dh: r.p256dh || '',
    auth: r.auth || '',
    ua: r.ua || '',
    createdAt: r.created_at || '',
  }));
}

/** Remove a dead push subscription (endpoint returned 404/410). */
export async function deleteSubscription(endpoint: string): Promise<void> {
  await q('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

/** Prune notifications created before `cutoffIso`. Returns the number deleted. */
export async function pruneNotificationsBefore(cutoffIso: string): Promise<number> {
  const rows = await q('DELETE FROM notifications WHERE created_at < $1 RETURNING notif_id', [cutoffIso]);
  return rows.length;
}

export async function saveSubscription(sub: PushSubscriptionRow): Promise<void> {
  // Endpoint is unique per browser/device → upsert on it.
  await q(
    `INSERT INTO push_subscriptions (endpoint, sub_id, member_id, p256dh, auth, ua, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (endpoint) DO UPDATE SET
       member_id = EXCLUDED.member_id, p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth, ua = EXCLUDED.ua`,
    [sub.endpoint, sub.subId, sub.memberId, sub.p256dh, sub.auth, sub.ua, sub.createdAt],
  );
}
