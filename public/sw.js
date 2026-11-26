/**
 * The app is fully client-side, so a small cache-first service worker is enough
 * to make the installed app open without a network. The registration URL
 * carries a per-build version; using it in the cache name lets activate() drop
 * every older build's hashed assets.
 */
const version = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `latex-soreau-${version}`;
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch('/');
    const html = await response.clone().text();
    await cache.put('/', response);

    const assets = new Set(SHELL);
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = match[1];
      if (url.startsWith('/') && !url.startsWith('//')) assets.add(url);
    }
    try {
      const manifestResponse = await fetch('/.vite/manifest.json');
      if (manifestResponse.ok) {
        const manifest = await manifestResponse.json();
        for (const entry of Object.values(manifest)) {
          if (!entry || typeof entry !== 'object') continue;
          if (entry.file) assets.add(`/${entry.file}`);
          for (const key of ['css', 'assets']) {
            for (const file of entry[key] || []) {
              // Fonts are cached on first use; pre-caching every unicode subset
              // would make installation download megabytes of unused glyphs.
              if (!/\.(?:woff2?|ttf|otf)$/i.test(file)) assets.add(`/${file}`);
            }
          }
        }
      }
    } catch {
      // The HTML references are enough for the shell; runtime caching fills in
      // anything the build manifest cannot provide.
    }
    await Promise.allSettled([...assets].map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('latex-soreau-') && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE);
        await cache.put('/', response.clone());
        return response;
      } catch {
        const cached = await caches.match('/');
        if (cached) return cached;
        throw new Error('Offline');
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
