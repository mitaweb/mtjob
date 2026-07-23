import { api } from './api';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushStatus = 'on' | 'off' | 'blocked' | 'unsupported';

/** Trạng thái thông báo đẩy trên THIẾT BỊ NÀY — để nút không mời bật lại khi đã bật. */
export async function pushStatus(): Promise<PushStatus> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  try {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

export async function enablePush(): Promise<{ ok: boolean; message: string }> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, message: 'Trình duyệt không hỗ trợ thông báo đẩy.' };
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, message: 'Bạn chưa cho phép gửi thông báo.' };
  }
  const { key } = await api<{ key: string }>('/notifications/vapid-public-key');
  if (!key) return { ok: false, message: 'Máy chủ chưa cấu hình VAPID key.' };

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });
  await api('/notifications/subscribe', { body: sub.toJSON() });
  return { ok: true, message: 'Đã bật thông báo đẩy ✅' };
}
