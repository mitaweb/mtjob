/* MTJOB service worker — Web Push + click routing. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/* Kiểu rung theo loại thông báo. Số là mili-giây, xen kẽ RUNG / NGHỈ.
   Việc gấp thì rung ba nhịp cho khác hẳn tin thường — nghe là biết có nên rút máy ra xem
   ngay không. Android nghe theo mẫu này; iPhone thì bỏ qua, rung hay không do phần Cài đặt
   → Thông báo của máy quyết định (Safari không cho web điều khiển). */
const VIBRATE = {
  reminder: [300, 150, 300, 150, 300], // nhắc hẹn — tới giờ rồi
  request: [300, 150, 300], // đơn chờ duyệt
  task_assigned: [300, 150, 300], // được giao việc
  test: [300, 150, 300, 150, 300], // gửi thử — rung rõ để người dùng cảm nhận được
};
const VIBRATE_MAC_DINH = [200, 100, 200];

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'MTJOB', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'MTJOB';
  const options = {
    body: data.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: data.url || '/' },
    tag: data.tag,
    renotify: !!data.tag,
    vibrate: VIBRATE[data.tag] || VIBRATE_MAC_DINH,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
