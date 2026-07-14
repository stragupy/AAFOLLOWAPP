self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = { body: event.data?.text() || '' };
  }
  const title = data.title || 'AA Follow';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Tienes un recordatorio pendiente.',
    icon: './icon-192.png',
    badge: './favicon-32.png',
    tag: data.tag || 'aa-follow-reminder',
    renotify: true,
    data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('navigate' in client) await client.navigate(targetUrl);
      if ('focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    return null;
  })());
});
