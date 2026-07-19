const CACHE = 'bhishi-shell-v2';
const SHELL = ['/', '/dashboard', '/offline'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Navigation requests: network-first, fall back to cache, then the offline page.
// Everything else (API calls, chain reads) is left to the network untouched.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept RPC/API cross-origin
  if (req.mode !== 'navigate') return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/offline'))),
  );
});

self.addEventListener('push', (e) => {
  const data = (() => { try { return e.data.json(); } catch { return { title: 'Bhishi', body: e.data?.text() ?? '' }; } })();
  e.waitUntil(
    self.registration.showNotification(data.title || 'Bhishi', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/dashboard' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/dashboard';
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((cs) => {
      const hit = cs.find((c) => c.url.includes(url));
      return hit ? hit.focus() : self.clients.openWindow(url);
    }),
  );
});
