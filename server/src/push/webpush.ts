import webpush from 'web-push';

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@mtjob.local';
  if (!pub || !priv) {
    console.warn('[push] VAPID keys chưa cấu hình — Web Push bị tắt.');
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
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
}

export async function sendPush(sub: PushSub, payload: PushPayload): Promise<PushResult> {
  if (!ensureConfigured()) return { ok: false, gone: false };
  try {
    await webpush.sendNotification(sub as webpush.PushSubscription, JSON.stringify(payload));
    return { ok: true, gone: false };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return { ok: false, gone: status === 404 || status === 410 };
  }
}

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || '';
}
