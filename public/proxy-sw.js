"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — proxy-sw.js  v5
//  • Cache API for static assets
//  • Scoped to proxied pages only
//  • Strips identity-revealing headers
//  • Falls back gracefully on errors
// ══════════════════════════════════════

const SW_VERSION = "mos-sw-v5";
const OWN_ORIGIN = self.location.origin;
const PROXY_PATH = OWN_ORIGIN + "/fetch?url=";

// Cache these content-types at the SW layer
const CACHEABLE_CT = [
  "text/css",
  "application/javascript",
  "application/wasm",
  "font/",
  "image/",
];

// Strip headers that leak proxy identity
const STRIP_REQ = new Set([
  "origin", "referer", "x-forwarded-for", "x-forwarded-host",
  "x-forwarded-proto", "x-real-ip", "via", "forwarded",
  "cf-connecting-ip", "cf-ipcountry", "cf-ray",
]);

// ── Install: skip waiting immediately ────────────────────────────────────────
self.addEventListener("install", () => self.skipWaiting());

// ── Activate: purge old caches, claim clients ─────────────────────────────────
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SW_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch interception ────────────────────────────────────────────────────────
self.addEventListener("fetch", (e) => {
  const reqUrl = e.request.url;

  // Fast exits — never intercept own-origin assets, already-proxied paths, or non-HTTP
  if (reqUrl.startsWith(OWN_ORIGIN + "/")) return;
  if (reqUrl.includes("/fetch?url="))       return;
  if (!reqUrl.startsWith("http"))           return;
  if (reqUrl.startsWith("data:") || reqUrl.startsWith("blob:")) return;

  e.respondWith(handleRequest(e));
});

async function handleRequest(e) {
  const reqUrl = e.request.url;

  // Only intercept requests coming FROM a proxied page
  let client = null;
  try {
    if (e.clientId) client = await self.clients.get(e.clientId);
  } catch (_) {}

  if (!client || !client.url.includes("/fetch?url=")) {
    // Not from a proxied page — pass through directly
    return fetch(e.request).catch(() =>
      new Response("SW: direct fetch failed", { status: 502 })
    );
  }

  // Check SW Cache first for GET requests
  if (e.request.method === "GET") {
    try {
      const cached = await caches.match(reqUrl);
      if (cached) return cached;
    } catch (_) {}
  }

  return proxyFetch(reqUrl, e.request);
}

async function proxyFetch(targetUrl, original) {
  const proxiedUrl = PROXY_PATH + encodeURIComponent(targetUrl);

  // Build clean headers — drop anything that reveals proxy identity
  const headers = {};
  try {
    for (const [k, v] of original.headers.entries()) {
      if (!STRIP_REQ.has(k.toLowerCase())) {
        headers[k] = v;
      }
    }
  } catch (_) {}

  const method     = original.method || "GET";
  const isBodyless = method === "GET" || method === "HEAD";

  let response;
  try {
    response = await fetch(proxiedUrl, {
      method,
      headers,
      body:        isBodyless ? undefined : original.body,
      mode:        "cors",
      credentials: "omit",
      redirect:    "follow",
    });
  } catch (err) {
    console.warn("[SW] proxy failed for", targetUrl, "—", err.message);
    // Last resort: try direct (may fail due to CORS but worth trying)
    try {
      return await fetch(original);
    } catch (e2) {
      return new Response(
        JSON.stringify({ error: "SW proxy failed: " + err.message }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Cache successful GET responses for static assets
  if (method === "GET" && response.ok) {
    const ct = response.headers.get("content-type") || "";
    if (CACHEABLE_CT.some(t => ct.includes(t))) {
      try {
        const cache = await caches.open(SW_VERSION);
        await cache.put(targetUrl, response.clone());
      } catch (_) {}
    }
  }

  return response;
}
