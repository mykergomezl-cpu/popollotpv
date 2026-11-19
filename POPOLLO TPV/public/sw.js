// Service worker mínimo: permite instalar la app en Windows/Mac (Chrome/Edge)
// y guarda en caché las pantallas para que carguen aunque la red vaya lenta.
const CACHE = 'popollo-v2';
const FILES = ['/', '/index.html', '/tpv.html', '/admin.html', '/base.css', '/tpv.css', '/admin.css', '/common.js', '/qr.js', '/tpv.js', '/admin.js', '/logo.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(FILES.map((f) => c.add(f)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/') || e.request.method !== 'GET') return;
  // Red primero; si no hay conexión, la copia guardada
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
