// Minimal pass-through service worker.
//
// Purpose: satisfy browser installability requirements (Chrome/Edge "Install
// app") without introducing any offline caching surface. The CV Maker is a
// local tool — all data lives in IndexedDB and localStorage in the page's
// origin — so offline support is mostly handled by the browser already, and
// we deliberately avoid pre-caching assets that would go stale on every
// `next build`.

self.addEventListener("install", (event) => {
  // Activate immediately on first install so the app is installable without
  // a page reload dance.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Explicit fetch handler is required for installability. We just forward.
self.addEventListener("fetch", (event) => {
  // No-op — let the network handle it. Registering a listener at all is what
  // trips the install criterion; no caching logic needed.
});
