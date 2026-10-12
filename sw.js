// Shop service worker: makes the site installable and keeps the last-seen pages and images
// available offline. Pages and data always come fresh from the network first; nothing from
// the API or checkout is ever cached.
const CACHE = 'wts-shop-v1';
const OFFLINE = ['/index.html', '/site.css', '/images/logo.png', '/images/app/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('wts-shop-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/img.php')) return; // live data only
  if (url.pathname.startsWith('/admin/')) return; // the team app has its own worker
  const isImage = /\.(png|jpe?g|webp|svg|woff2?)$/i.test(url.pathname) || url.pathname.startsWith('/api/img.php');
  if (isImage) {
    // Images and fonts: serve from cache, refresh in the background.
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (req.mode === 'navigate' || /\.(css|js)$/i.test(url.pathname)) {
    // Pages, scripts and styles: network first (so updates show at once), last copy when offline.
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
      .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())));
  }
});
