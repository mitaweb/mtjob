import { addNotification, getSubscriptions, deleteSubscription } from './notifications.repo.js';
import { sendPush } from '../push/webpush.js';
import { newId } from '../util/id.js';
import { runInBackground } from '../util/background.js';
import { nowTz } from '../lib/datetime.js';

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  url?: string;
}

/** Fan-out một notification tới mọi push subscription của thành viên. */
async function pushToMember(memberId: string, n: NotifyInput): Promise<void> {
  const subs = await getSubscriptions(memberId);
  await Promise.all(
    subs.map(async (s) => {
      const r = await sendPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        { title: n.title, body: n.body, url: n.url, tag: n.type },
      );
      // Trình duyệt đã huỷ đăng ký → dọn luôn cho gọn DB.
      if (r.gone) await deleteSubscription(s.endpoint).catch(() => undefined);
    }),
  );
}

/**
 * Store an in-app notification and fan it out to the member's push subscriptions.
 * `background: true` — dành cho đường request (chấm công, giao việc…): chỉ chờ INSERT,
 * còn web-push HTTP chạy nền để response trả ngay. Jobs (process.exit sau khi xong)
 * PHẢI để mặc định (await) kẻo push bị cắt giữa chừng.
 */
export async function notify(
  memberId: string,
  n: NotifyInput,
  opts?: { background?: boolean },
): Promise<void> {
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
  const fanout = pushToMember(memberId, n).catch((e) => console.error('[push]', memberId, e));
  if (opts?.background) runInBackground(fanout);
  else await fanout;
}

export async function notifyMany(
  memberIds: string[],
  n: NotifyInput,
  opts?: { background?: boolean },
): Promise<void> {
  await Promise.allSettled(memberIds.map((id) => notify(id, n, opts)));
}
