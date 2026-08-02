import webpush from 'web-push';

let configured: boolean | null = null;

/** Mặc định an toàn: tên miền thật của app, dùng khi env chưa khai hoặc khai sai. */
const FALLBACK_SUBJECT = 'https://job.mtdigital.vn';

/**
 * VAPID subject phải là địa chỉ liên hệ THẬT — `https://<tên miền>` hoặc `mailto:` với
 * tên miền có thật.
 *
 * Apple (web.push.apple.com) kiểm chặt chỗ này và trả **403** nếu sai; Google (FCM) thì
 * bỏ qua. Đó đúng là triệu chứng anh Tâm gặp 1/8/2026: máy Windows qua FCM gửi được,
 * iPhone qua Apple lỗi 403 — trong khi mặc định cũ là `mailto:admin@mtjob.local`, mà
 * `.local` không phải tên miền có thật.
 */
export function normalizeSubject(raw: string | undefined): string {
  const s = (raw || '').trim();
  if (/^https:\/\/[^\s/]+\.[^\s/]+/i.test(s)) return s;
  if (/^mailto:[^\s@]+@[^\s@.]+\.[a-z]{2,}$/i.test(s)) {
    // Loại các tên miền chỉ dùng nội bộ — Apple không chấp nhận.
    const domain = s.split('@')[1]!.toLowerCase();
    if (!/\.(local|localhost|test|invalid|example)$/.test(domain)) return s;
  }
  return FALLBACK_SUBJECT;
}

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    console.warn('[push] VAPID keys chưa cấu hình — Web Push bị tắt.');
    configured = false;
    return false;
  }
  const subject = normalizeSubject(process.env.VAPID_SUBJECT);
  if (subject !== (process.env.VAPID_SUBJECT || '').trim()) {
    console.warn(`[push] VAPID_SUBJECT không hợp lệ với Apple — dùng thay bằng ${subject}`);
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

/** Subject đang thực sự dùng — hiện ở màn hình chẩn đoán. */
export function vapidSubject(): string {
  return normalizeSubject(process.env.VAPID_SUBJECT);
}

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface PushResult {
  ok: boolean;
  gone: boolean; // 404/410 → subscription should be pruned
  /** Mã HTTP dịch vụ đẩy trả về — 0 khi chưa gửi được. */
  status?: number;
  /** Lý do đọc được, để hiện lên màn hình chẩn đoán. */
  error?: string;
}

/** Dịch mã lỗi của dịch vụ đẩy sang câu người dùng hiểu được. */
function explain(status: number | undefined, raw: string): string {
  if (status === 401 || status === 403) {
    return 'Khoá VAPID không khớp với đăng ký cũ — máy chủ đã đổi khoá. Người dùng cần tắt rồi bật lại thông báo.';
  }
  if (status === 404 || status === 410) return 'Đăng ký đã hết hiệu lực (gỡ app hoặc xoá dữ liệu trình duyệt).';
  if (status === 413) return 'Nội dung thông báo quá dài.';
  if (status === 429) return 'Dịch vụ đẩy đang chặn vì gửi quá dày.';
  return raw || 'Không rõ lý do';
}

export async function sendPush(sub: PushSub, payload: PushPayload): Promise<PushResult> {
  if (!ensureConfigured()) {
    return { ok: false, gone: false, status: 0, error: 'Máy chủ chưa cấu hình VAPID.' };
  }
  try {
    await webpush.sendNotification(sub as webpush.PushSubscription, JSON.stringify(payload));
    return { ok: true, gone: false, status: 201 };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    const raw = (e as { body?: string; message?: string }).body || (e as Error).message || '';
    const error = explain(status, String(raw).slice(0, 200));
    // GHI LOG. Trước đây lỗi bị nuốt sạch nên đẩy hỏng hàng tháng cũng không ai biết.
    console.error(`[push] gửi thất bại (${status ?? 'không có mã'}): ${error}`);
    return { ok: false, gone: status === 404 || status === 410, status: status ?? 0, error };
  }
}

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || '';
}
