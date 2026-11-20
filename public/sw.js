/*
 * Master Calendar service worker — deliberately tiny.
 * It never caches your data (that always comes fresh from the server).
 * It only shows a friendly offline page if a page can't load at all.
 */
const CACHE = "mc-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE_URL, "/icons/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return; // let everything else go straight to the network
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
