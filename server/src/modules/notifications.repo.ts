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

export async function getNotifications(memberId: string, limit = 50): Promise<NotificationRow[]> {
  const rows = await q(
    'SELECT * FROM notifications WHERE member_id = $1 ORDER BY created_at DESC LIMIT $2',
    [memberId, limit],
  );
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
