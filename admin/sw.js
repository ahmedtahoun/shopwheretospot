// Team app service worker: only makes the dashboard installable and opens it quickly.
// Orders, leads and payments are never cached — every screen loads live data.
const CACHE = 'wts-team-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/admin/', '/admin/admin.css', '/admin/admin.js', '/images/logo.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('wts-team-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // App shell: always try the network so updates show at once; fall back to the saved copy offline.
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && /\/admin\/(|admin\.css|admin\.js)$/.test(url.pathname)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })));
});
