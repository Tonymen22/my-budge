const cacheName = 'gestion-riesgos-shell-v5';
const assets = ['./index.html', './style.css?v=5', './app.js?v=5', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key =>
    key.startsWith('gestion-riesgos-shell-') && key !== cacheName).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (new URL(request.url).pathname.endsWith('/supabase-config.js')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html', { cacheName })));
    return;
  }
  event.respondWith(caches.match(request, { cacheName }).then(response => response || fetch(request)));
});
