const CACHE_NAME = "zplit-static-v1";
const PRECACHE_URLS = [
  "/offline",
  "/icons/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
];
const ICON_PATHS = new Set(PRECACHE_URLS.filter((path) => path.startsWith("/icons/")));
const PRIVATE_PATHS = [
  /^\/app(?:\/|$)/,
  /^\/api(?:\/|$)/,
  /^\/join(?:\/|$)/,
  /^\/share(?:\/|$)/,
  /\/receipts(?:\/|$)/,
  /\/exports(?:\/|$)/,
];

function isPrivatePath(pathname) {
  return PRIVATE_PATHS.some((pattern) => pattern.test(pathname));
}

function isCacheableResponse(request, response) {
  if (!response.ok || request.headers.has("authorization") || request.headers.has("cookie") || response.headers.has("set-cookie") || response.headers.has("authorization")) return false;
  const cacheControl = response.headers.get("cache-control") || "";
  return !/\b(?:private|no-store)\b/i.test(cacheControl);
}

function isStaticAsset(request, url) {
  if (request.method !== "GET" || isPrivatePath(url.pathname)) return false;
  return ICON_PATHS.has(url.pathname) || url.pathname.startsWith("/_next/static/") || request.destination === "font" || request.destination === "style";
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("zplit-") && key !== CACHE_NAME).map((key) => caches.delete(key)),
  )));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline")));
    return;
  }

  if (!isStaticAsset(request, url)) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (isCacheableResponse(request, response)) {
      void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
    }
    return response;
  })));
});
