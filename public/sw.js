// Keeps the app shell on the device so it opens fast and works when the internet drops.
const CACHE = 'mdq-shifts-v4';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './modaqqeq-logo.png', './icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase handles its own offline data
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req, { cache: 'no-store' }).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return r;
  })));
});

// A click on a notification: bring the app forward and open what it's about.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const note = e.notification.data?.note;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list[0];
    if (c) { c.postMessage({ type: 'mdq-note', note }); return c.focus(); }
    return self.clients.openWindow('./');
  }));
});

// Notification sent by the Modaqqeq script while the app is closed (Firebase Cloud Messaging).
self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = { data: { title: 'مدقق', body: e.data ? e.data.text() : '' } }; }
  const d = p.data || p.notification || p;
  const title = d.title || 'مدقق';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', icon: './icon-192.png', badge: './icon-192.png', tag: d.tag || undefined, dir: 'rtl', lang: 'ar',
    data: { note: { id: d.tag || String(Date.now()), key: d.tag || '', title, body: d.body || '', shiftId: d.shiftId || null, shopId: d.shopId || null, go: d.go || null } },
  }));
});
