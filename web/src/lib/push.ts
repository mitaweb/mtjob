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

/**
 * Endpoint đăng ký của CHÍNH máy đang mở app.
 *
 * Màn chẩn đoán gửi thử tới mọi thiết bị đã đăng ký, nên phải chỉ rõ dòng nào là máy
 * đang cầm — không thì "gửi được" mà máy này im vẫn không biết là đúng hay sai.
 */
export async function currentEndpoint(): Promise<string> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return '';
  try {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription())?.endpoint || '';
  } catch {
    return '';
  }
}

/**
 * Hiện một thông báo NGAY tại máy này, KHÔNG đi qua máy chủ.
 *
 * Đây là phép thử tách bạch: nếu cách này hiện được mà "gửi thử" từ máy chủ lại im, thì
 * hỏng ở đường đẩy. Nếu ngay cả cách này cũng im thì hỏng ở quyền thông báo hoặc ở cài
 * đặt của hệ điều hành — không phải lỗi máy chủ.
 */
export async function showLocalTest(): Promise<{ ok: boolean; message: string }> {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    return { ok: false, message: 'Trình duyệt không hỗ trợ thông báo.' };
  }
  if (Notification.permission !== 'granted') {
    return { ok: false, message: `Trình duyệt chưa cho phép hiện thông báo (${Notification.permission}).` };
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    // Lấy bản service worker mới nhất trước khi thử — máy có thể còn giữ bản cũ.
    await reg.update().catch(() => undefined);
    await reg.showNotification('MTJOB — thử tại chỗ 🔔', {
      body: 'Thông báo này hiện thẳng từ máy bạn, không qua máy chủ.',
      icon: '/icon.svg',
      tag: 'test',
      data: { url: '/inbox' },
    });
    return { ok: true, message: 'Đã yêu cầu hiện thông báo. Nhìn góc màn hình xem có không.' };
  } catch (e) {
    return { ok: false, message: `Không hiện được: ${(e as Error).message}` };
  }
}

/** Trạng thái service worker — bản cũ còn chạy thì thông báo có thể thiếu tính năng mới. */
export async function swStatus(): Promise<string> {
  if (!('serviceWorker' in navigator)) return 'trình duyệt không hỗ trợ';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'chưa đăng ký';
  if (reg.waiting) return 'có bản mới đang chờ — tải lại trang để dùng';
  if (reg.active) return 'đang chạy';
  return 'đang cài';
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
