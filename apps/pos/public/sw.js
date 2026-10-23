const CACHE_NAME = "antojit-os-shell-v3";
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
    caches.keys().then(async (keys) => {
      await Promise.all(keys.filter((key) => key.startsWith("antojit-os-shell-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key)));
      await self.clients.claim();
    }),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (
    requestUrl.origin === self.location.origin &&
    (requestUrl.pathname.startsWith("/api/") ||
      requestUrl.pathname.startsWith("/socket.io/"))
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // A navigation must discover the current entry point after a deployment.
  // Keep a cached shell only as a fallback when the server is unreachable.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).then(async (response) => {
        if (response.ok) {
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put("/", response.clone());
          } catch {
            // A full/disabled cache must not hide a successful server response.
          }
        }
        return response;
      }).catch(async () => (await caches.match("/")) ?? Response.error()),
    );
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
