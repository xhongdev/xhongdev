const GAME_NAME = "PhigrosLoader-sample";
const GAME_VERSION = "0.0.0.0";

const CACHE_NAME = JSON.stringify({"name": GAME_NAME, "version": GAME_VERSION});
const CACHE_FILES = ["game.unx",
"PhigrosLoader_sample.data",
"PhigrosLoader_sample.html",
"PhigrosLoader_sample.js",
"PhigrosLoader_sample.wasm",
"resource/audiogroup_hitsounds.dat",
"resource/blockareagroup_0.yytex",
"resource/defaultnotes_0.yytex",
"resource/defaultnotes_1.yytex",
"resource/defaultnotes_2.yytex"
];

self.addEventListener("fetch", (event) => {
  const should_cache = CACHE_FILES.some((f) => {
      return event.request.url.endsWith(f);
  });
  event.respondWith(
    caches.match(event.request).then((resp) => {
      return resp || fetch(event.request).then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          if (should_cache) {
            cache.put(event.request, response.clone());
          }
          return response;
        });
      });
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.allSettled(
      keys.map((key) => {
        try {
          const data = JSON.parse(key);
          if (data && data["name"] && data.name == GAME_NAME &&
              data.version && data.version != GAME_VERSION) {
            return caches.delete(key);
          }
        } catch {
          return;
        }
      })
    )).then(() => {
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
