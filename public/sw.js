// Service Worker básico para Panadería Santa Fé
// Cachea activos estáticos y UI para carga instantánea y funcionamiento con conexión intermitente

const CACHE_NAME = 'santafe-static-v1';

// Activos críticos iniciales a pre-cachear
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/logo.jpg',
  '/logo.png',
  '/panadero-logo.jpg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('Advertencia en precache inicial de activos:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. REGLA CRÍTICA: NUNCA interceptar ni cachear llamadas de red a APIs, cobros o sincronización en la nube
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/.netlify/functions/') ||
    url.pathname.includes('payclip.io') ||
    url.pathname.includes('zettle') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // 2. Navegación HTML (páginas): Network-First con fallback a cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const fallback = await caches.match('/');
          return fallback || new Response('Sin conexión a internet. La interfaz local sigue lista.', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        })
    );
    return;
  }

  // 3. Activos estáticos (JS, CSS, fuentes, imágenes locales): Stale-While-Revalidate
  const isStaticAsset = 
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') ||
     url.pathname.endsWith('.js') ||
     url.pathname.endsWith('.css') ||
     url.pathname.endsWith('.png') ||
     url.pathname.endsWith('.jpg') ||
     url.pathname.endsWith('.svg') ||
     url.pathname.endsWith('.woff2') ||
     url.pathname.endsWith('.ttf'));

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }
});
