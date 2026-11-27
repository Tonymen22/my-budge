const CACHE_NAME = 'presupuesto-app-v5';
const ASSETS = [
  './', './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './budget.css', './budget-data.js', './budget.js', './budget-cloud.js', './supabase-config.js',
];
const shellUrls = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names
    .filter(name => name.startsWith('presupuesto-app-') && name !== CACHE_NAME)
    .map(name => caches.delete(name)))));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !shellUrls.has(event.request.url)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    // Keep the shell together. Fetch the deploy-specific settings fresh when online.
    if (!event.request.url.endsWith('/supabase-config.js')) {
      return (await cache.match(event.request)) || fetch(event.request);
    }
    try {
      const response = await fetch(event.request, { cache: 'no-cache' });
      if (!response.ok) throw new Error('Configuración no disponible');
      await cache.put(event.request, response.clone());
      return response;
    } catch {
      return (await cache.match(event.request)) || Response.error();
    }
  }));
});
