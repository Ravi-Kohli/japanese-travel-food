// Offline helper (service worker). Saves the app, the word list, and every
// picture and sound on the device, and serves them when there is no signal.
// When the app's own code changes, raise this number by one. Every iPhone
// then fetches the new version the next time the app is opened online.
const APP_VERSION = 4;

importScripts('files.js');

const SHELL_CACHE = 'kotoba-shell-v' + APP_VERSION;
const DATA_CACHE = 'kotoba-data';

// Safari refuses pages that came through a redirect, so store a clean copy.
async function clean(response) {
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, { status: 200, statusText: 'OK', headers: response.headers });
}

// Downloads a file and saves it, trying up to three times on a weak connection.
async function fetchAndStore(cacheName, url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error('Could not download ' + url);
      const cache = await caches.open(cacheName);
      await cache.put(url, await clean(response));
      return;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // The app itself must be saved, or installation fails and retries later.
    await Promise.all(self.APP_SHELL.map((url) => fetchAndStore(SHELL_CACHE, url)));
    // Words, pictures and sounds: best effort here; the app re-checks them on every launch.
    try {
      await fetchAndStore(DATA_CACHE, self.WORDS_URL);
      const cached = await caches.match(self.WORDS_URL);
      const data = await cached.json();
      const media = [];
      for (const w of data.words) media.push(w.image, w.audio);
      await Promise.allSettled(media.filter(Boolean).map((u) => fetchAndStore(DATA_CACHE, u)));
    } catch (e) { /* handled by the app's readiness check */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith('kotoba-shell-') && n !== SHELL_CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Opening the app: always answer from the saved copy.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match('./', { ignoreSearch: true });
      return cached || fetch(request);
    })());
    return;
  }

  // Word list: try for the newest version first, fall back to the saved one.
  if (url.pathname.endsWith('/words.json')) {
    event.respondWith((async () => {
      try {
        const fresh = await withTimeout(fetch(request, { cache: 'no-store' }), 4000);
        if (fresh.ok) {
          const cache = await caches.open(DATA_CACHE);
          await cache.put(self.WORDS_URL, fresh.clone());
          return fresh;
        }
      } catch (e) { /* offline: use the saved copy */ }
      const cached = await caches.match(self.WORDS_URL);
      return cached || new Response('{"words":[]}', { headers: { 'Content-Type': 'application/json' } });
    })());
    return;
  }

  // Everything else (app files, pictures, sounds): saved copy first.
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.status === 200) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, (await clean(response.clone())));
    }
    return response;
  })());
});
