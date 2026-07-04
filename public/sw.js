/* wacrm service worker — offline shell + install support.
 *
 * Deliberately conservative:
 *   - Only same-origin GET requests are touched.
 *   - /api/* and cross-origin (Supabase REST/realtime, media) are never
 *     cached — always hit the network so data is never stale.
 *   - Hashed Next static assets: cache-first (immutable).
 *   - Icons / fonts / public assets: stale-while-revalidate.
 *   - Navigations: network-first, falling back to a cached page (or a
 *     minimal offline response) so the installed app still opens offline.
 */
const VERSION = 'wacrm-v1';
const STATIC_CACHE = VERSION + '-static';
const RUNTIME_CACHE = VERSION + '-runtime';

self.addEventListener('install', () => {
  // Activate this SW immediately on first install / update.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, res.clone());
  }
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || fetch(request);
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Last resort so navigations don't hard-fail offline.
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font-family:system-ui;background:#020617;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center"><div><h1 style="font-size:1.1rem">You’re offline</h1><p style="color:#94a3b8;font-size:.9rem">Reconnect to keep using wacrm.</p></div></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase / media / etc.
  if (url.pathname.startsWith('/api/')) return; // never cache API responses

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (/\.(png|jpg|jpeg|gif|svg|ico|webmanifest|woff2?|ttf)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  }
});
