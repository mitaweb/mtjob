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
  /** Mã của thứ được nhắc tới (vd mã đơn) — để xử lý xong thì tự đánh dấu đã đọc. */
  refId?: string;
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
  try {
    await addNotification({
      id: newId('N-'),
      memberId,
      type: n.type,
      title: n.title,
      body: n.body,
      createdAt: nowTz().toISOString(),
      readAt: '',
      refId: n.refId || '',
    });
  } catch (e) {
    // Thông báo là việc PHỤ — hỏng thì thôi, TUYỆT ĐỐI không kéo đổ việc chính.
    //
    // Anh Tâm 3/8/2026: sau khi thêm cột ref_id mà chưa bấm cập nhật cấu trúc DB, câu
    // INSERT hỏng và ném ngược lên route chấm công. Kết quả: công ĐÃ ghi vào database
    // nhưng màn hình báo lỗi đỏ "column ref_id does not exist" — nhân sự tưởng chưa
    // chấm được, bấm lại mấy lần.
    //
    // Ghi log rõ chứ không nuốt im: hỏng thông báo vẫn là chuyện cần biết.
    console.error(`[notify] không lưu được thông báo cho ${memberId}:`, (e as Error).message);
    return;
  }
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
