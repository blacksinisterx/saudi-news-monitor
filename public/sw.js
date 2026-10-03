// Service worker: offline shell + Web Push. No authenticated page or API response is ever cached.
const CACHE = "snm-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/offline.html", "/icons/192"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })));
    return;
  }
  if (req.mode === "navigate") e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Saudi News Monitor", body: e.data ? e.data.text() : "" }; }
  // Always show a notification (required by iOS / userVisibleOnly).
  e.waitUntil(self.registration.showNotification(d.title || "Saudi News Monitor", {
    body: d.body || "",
    icon: "/icons/192",
    badge: "/icons/96",
    tag: d.tag || "snm",
    renotify: true,
    requireInteraction: Boolean(d.critical), // critical alerts stay on screen until dismissed
    silent: false,
    vibrate: d.critical ? [300, 120, 300, 120, 300, 120, 600] : [200, 100, 200],
    data: { url: d.url || "/" },
  }).then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true })).then((wins) => {
    // App is open: let the page play an alarm beep too.
    for (const w of wins) w.postMessage({ type: "alert", critical: Boolean(d.critical) });
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if ("focus" in w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
