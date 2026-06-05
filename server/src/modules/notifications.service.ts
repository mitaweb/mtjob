import { addNotification, getSubscriptions } from './notifications.repo.js';
import { sendPush } from '../push/webpush.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  url?: string;
}

/** Store an in-app notification and fan it out to the member's push subscriptions. */
export async function notify(memberId: string, n: NotifyInput): Promise<void> {
  if (!memberId) return;
  await addNotification({
    id: newId('N-'),
    memberId,
    type: n.type,
    title: n.title,
    body: n.body,
    createdAt: nowTz().toISOString(),
    readAt: '',
  });
  const subs = await getSubscriptions(memberId);
  await Promise.all(
    subs.map((s) =>
      sendPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        { title: n.title, body: n.body, url: n.url, tag: n.type },
      ),
    ),
  );
}

export async function notifyMany(memberIds: string[], n: NotifyInput): Promise<void> {
  for (const id of memberIds) await notify(id, n);
}
