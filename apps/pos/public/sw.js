const CACHE_NAME = "antojit-os-shell-v2";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/antojit-os.svg",
  "/antojit-os-192.png",
  "/antojit-os-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (
    requestUrl.origin === self.location.origin &&
    (requestUrl.pathname.startsWith("/api/") ||
      requestUrl.pathname.startsWith("/socket.io/"))
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse.ok &&
            new URL(event.request.url).origin === self.location.origin
          ) {
            const copy = networkResponse.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }

          return networkResponse;
        })
        .catch(async () => {
          if (event.request.mode === "navigate") {
            const shell = await caches.match("/");
            if (shell) return shell;
          }

          return Response.error();
        });
    }),
  );
});
