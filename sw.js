const CACHE_NAME = 'presupuesto-app-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
  // Si agregas íconos, puedes sumar las rutas aquí: './icon-192.png', './icon-512.png'
];

// Instalación del Service Worker y guardado en caché
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Archivos guardados en caché correctamente');
      return cache.addAll(ASSETS);
    })
  );
});

// Intercepción de peticiones para que funcione offline
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      // Devuelve la versión guardada en caché si existe, de lo contrario busca en la red
      return response || fetch(e.request);
    })
  );
});

// Limpieza de cachés antiguas cuando actualizas la versión (CACHE_NAME)
self.addEventListener('activate', (e) => {
  const cacheWhitelist = [CACHE_NAME];
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
