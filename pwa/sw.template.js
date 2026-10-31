// Service worker of the installed app (generated at build time from pwa/sw.template.js by vite.config.ts).
//
// Keeps one complete, consistent version of the application - page, scripts, styles, icons, manifest and the
// redistributable engine (WebAssembly and its modules) - so that a game stored on the device (storage/gamestore.ts)
// plays with the PC and the network unavailable. Every build has its own cache named after a hash of its files; a new
// version is downloaded completely before it takes over, and older caches are removed only then. The engine files are
// requested with ?v=<hash of the engine>, so a page never mixes an engine from one version with code from another.
//
// Never cached: game data (/gamedata/), the LAN host's endpoints (/lan/), multiplayer (/mp). Player-imported game data
// lives in the origin-private file system, not here, and is never sent anywhere.
const VERSION = '__VERSION__';
const CACHE = `sof-app-${VERSION}`;
const PRECACHE = __PRECACHE__;
/** a navigation waits this long for the network before the cached page is used (an unreachable PC can hang for a minute) */
const NAV_TIMEOUT_MS = 3500;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // all or nothing: a partly downloaded version never replaces a complete one
    await c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && (k.startsWith('sof-app-') || k === 'sof-shell-v1')) await caches.delete(k);
    await self.clients.claim();
  })());
});

const scope = new URL(self.registration.scope);
function rel(url) {
  return url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : null;
}

self.addEventListener('message', (e) => {
  if (e.data === 'version') e.ports[0]?.postMessage({ version: VERSION, files: PRECACHE.length, urls: PRECACHE });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = rel(url);
  if (p === null || /^(gamedata|lan)\//.test(p) || p === 'mp') return;

  if (req.mode === 'navigate') {
    // network first (a reachable host may answer "pair again" or serve a newer version), the cached page otherwise
    e.respondWith((async () => {
      const cached = caches.open(CACHE).then((c) => c.match('./', { ignoreSearch: true, ignoreVary: true }));
      try {
        const res = await Promise.race([fetch(req), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS))]);
        return res;
      } catch (err) {
        const hit = await cached;
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }
  // everything of this version: from the cache (the exact URL, including the engine's ?v=), else the network
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    // by URL alone: the page's module script and stylesheet are requested in CORS mode (with an Origin header), and a
    // server's "Vary: Origin" must not make the copies cached at install time unusable
    const hit = await c.match(req.url, { ignoreVary: true });
    if (hit) return hit;
    return fetch(req);
  })());
});
