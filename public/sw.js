/* CourseMateAI's service worker (Phase 3 Stage 4d; docs/security.md, "Installable app").
 *
 * Kept deliberately small: the app works online, this makes it installable, fast on repeat visits and polite
 * offline. Never touches /api (answers, documents and your account always come live from the server).
 *   - pages: the network first; offline, the cached /offline page
 *   - /_next/static, /icons, /sprites: cache first (their names change when their content does)
 * A new version (CACHE below) replaces the old caches when it activates.
 */
const CACHE = "cmai-v1";
const OFFLINE = "/offline";
const PRECACHE = [OFFLINE, "/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const STATIC = /^\/(?:_next\/static\/|icons\/|sprites\/)/;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())));
    return;
  }
  if (STATIC.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })),
    );
  }
});
