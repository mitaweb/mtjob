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
      // Ở lại tới khi người dùng tự đóng. Không có cờ này thì Windows cho hiện vài giây
      // rồi cất vào Trung tâm thông báo — nhìn không kịp là tưởng không có gì.
      requireInteraction: true,
    });

    // Phép kiểm quyết định: hỏi ngược trình duyệt xem thông báo có THẬT SỰ tồn tại không.
    // Có mà không thấy trên màn hình = Windows đang chặn phần hiện, không phải app hỏng.
    const live = await reg.getNotifications({ tag: 'test' });
    return live.length > 0
      ? {
          ok: true,
          message:
            'Trình duyệt ĐÃ tạo thông báo (kiểm chứng được). Không thấy trên màn hình thì Windows đang chặn phần hiển thị — xem hướng dẫn bên dưới.',
        }
      : {
          ok: false,
          message: 'Trình duyệt nhận lệnh nhưng KHÔNG tạo được thông báo. Quyền đang bị chặn ở tầng trình duyệt.',
        };
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

/**
 * Mỗi lần mở app: đã cho phép thông báo thì báo lại cho máy chủ ĐÚNG địa chỉ nhận đẩy hiện tại của máy này.
 *
 * Anh Tâm 4/11/2026: "hiện tại anh k nhận được thông báo luôn" — máy chủ vẫn gửi thành công, nhưng tới địa chỉ đăng ký
 * từ tháng 6–7. Điện thoại / trình duyệt có thể tự đổi địa chỉ nhận (cập nhật iOS, cài lại app ra màn hình chính, xoá
 * dữ liệu trình duyệt) mà trước đây app chỉ đăng ký MỘT lần lúc bấm "Bật thông báo" → máy chủ gửi vào địa chỉ cũ.
 * Gửi lại tối đa 12 giờ một lần (hoặc ngay khi địa chỉ đổi); không bao giờ tự hỏi quyền.
 */
export async function dongBoDangKyDay(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api<{ key: string }>('/notifications/vapid-public-key');
    if (!key) return;
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
  }
  const KHOA = 'mtjob_push_dong_bo';
  let cu: { endpoint?: string; luc?: number } = {};
  try {
    cu = JSON.parse(localStorage.getItem(KHOA) || '{}');
  } catch {
    /* bỏ qua */
  }
  if (cu.endpoint === sub.endpoint && Date.now() - (cu.luc || 0) < 12 * 3600 * 1000) return;
  await api('/notifications/subscribe', { body: sub.toJSON() });
  try {
    localStorage.setItem(KHOA, JSON.stringify({ endpoint: sub.endpoint, luc: Date.now() }));
  } catch {
    /* bỏ qua */
  }
}
