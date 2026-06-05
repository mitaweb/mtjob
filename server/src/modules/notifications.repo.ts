import { readObjects, appendObject, updateWhere, upsertByKey } from '../sheets/repo.js';

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
  await appendObject('Notifications', {
    NotifID: n.id,
    MemberID: n.memberId,
    Type: n.type,
    Title: n.title,
    Body: n.body,
    CreatedAt: n.createdAt,
    ReadAt: n.readAt || '',
  });
}

export async function getNotifications(memberId: string, limit = 50): Promise<NotificationRow[]> {
  const rows = await readObjects('Notifications');
  return rows
    .filter((r) => r['MemberID'] === memberId && (r['NotifID'] || '').trim())
    .map((r) => ({
      id: r['NotifID'] || '',
      memberId: r['MemberID'] || '',
      type: r['Type'] || '',
      title: r['Title'] || '',
      body: r['Body'] || '',
      createdAt: r['CreatedAt'] || '',
      readAt: r['ReadAt'] || '',
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export async function markRead(notifId: string): Promise<boolean> {
  return updateWhere('Notifications', 'NotifID', notifId, { ReadAt: new Date().toISOString() });
}

export async function getSubscriptions(memberId?: string): Promise<PushSubscriptionRow[]> {
  const rows = await readObjects('PushSubscriptions');
  return rows
    .filter((r) => (r['Endpoint'] || '').trim() && (!memberId || r['MemberID'] === memberId))
    .map((r) => ({
      subId: r['SubID'] || '',
      memberId: r['MemberID'] || '',
      endpoint: r['Endpoint'] || '',
      p256dh: r['P256dh'] || '',
      auth: r['Auth'] || '',
      ua: r['UA'] || '',
      createdAt: r['CreatedAt'] || '',
    }));
}

export async function saveSubscription(sub: PushSubscriptionRow): Promise<void> {
  // Endpoint is unique per browser/device → upsert on it.
  await upsertByKey('PushSubscriptions', 'Endpoint', {
    SubID: sub.subId,
    MemberID: sub.memberId,
    Endpoint: sub.endpoint,
    P256dh: sub.p256dh,
    Auth: sub.auth,
    UA: sub.ua,
    CreatedAt: sub.createdAt,
  });
}
