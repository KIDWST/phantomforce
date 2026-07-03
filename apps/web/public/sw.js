const OLD_CACHES = [
  "phantomforce-ai-shell-v1",
];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();

      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await Promise.all(
        windows.map((client) => {
          try {
            const url = new URL(client.url);
            if (url.hostname === "admin.phantomforce.online" && url.pathname === "/") {
              return client.navigate("/app/index.html");
            }
          } catch {}
          return undefined;
        }),
      );

      await self.registration.unregister();
    })(),
  );
});

self.addEventListener("fetch", () => {
  return;
});
