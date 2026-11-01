// Nexa Team App service worker: lets the app open with no signal (shows the last saved version).
const CACHE = "nexa-team-v1";
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "index.html", "app.css?v=1", "app.js?v=1", "manifest.webmanifest", "icon-192.png", "../nexa-logo-header.svg"]).catch(() => {}))); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // only the app's own files and the Firebase library files; never the live database traffic
  const mine = u.origin === location.origin || u.hostname === "www.gstatic.com";
  if (!mine) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
