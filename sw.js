/* Simple app-shell service worker for offline support */

const CACHE_VERSION = 'v6';
const CACHE_NAME = `stookwijzer-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './style.css',
  './stookwijzer.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('stookwijzer-') && k != CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Only handle same-origin requests (app shell). Network calls to RIVM should stay online.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // For navigations (and the bare site root), always serve the app shell.
      // On workers.dev, /index.html redirects (307) to /, and returning a redirected response
      // for a navigation can fail when the request redirect mode isn't "follow".
      const isRootPath = url.pathname === '/' || url.pathname === '';
      if (req.mode === 'navigate' || isRootPath) {
        const cachedShell =
          (await cache.match('./', { ignoreSearch: true })) ||
          (await cache.match('/', { ignoreSearch: true }));
        if (cachedShell) return cachedShell;

        try {
          const candidates = ['./', '/'];
          for (const candidate of candidates) {
            const res = await fetch(new Request(candidate, { cache: 'reload' }));
            if (res && res.ok && !res.redirected) {
              // Store under both keys so future matches work regardless of how the browser asks.
              await cache.put('./', res.clone());
              await cache.put('/', res.clone());
              return res;
            }
          }

          // Last fallback: return whatever we got for '/', even if it was redirected.
          // (Better than hard failing offline; some hosts may still behave oddly.)
          return await fetch(new Request('/', { cache: 'reload' }));
        } catch (e) {
          const anyShell = (await cache.match('./')) || (await cache.match('/'));
          if (anyShell) return anyShell;
          throw e;
        }
      }

      const path = url.pathname;
      const isAsset =
        path.endsWith('.js') ||
        path.endsWith('.css') ||
        path.endsWith('.webmanifest') ||
        path.endsWith('.png') ||
        path.endsWith('.svg') ||
        path.endsWith('.ico');

      // Network-first for assets so updates show up immediately.
      if (isAsset) {
        try {
          // Some hosts may redirect asset URLs; force redirect-follow.
          const fetchReq = req.redirect === 'follow' ? req : new Request(req.url, { redirect: 'follow' });
          const res = await fetch(fetchReq);
          if (res && res.ok) cache.put(fetchReq, res.clone());
          return res;
        } catch (e) {
          const cached = await cache.match(req);
          if (cached) return cached;
          const cachedFollow = await cache.match(new Request(req.url, { redirect: 'follow' }));
          if (cachedFollow) return cachedFollow;
          throw e;
        }
      }

      // Cache-first for everything else.
      const cached = await cache.match(req);
      if (cached) return cached;

      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })()
  );
});
