"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — proxy-sw.js
//  Scoped Service Worker — intercepts all external fetches
//  originating from proxied pages (/fetch?url=...)
//  and routes them back through the MOS proxy.
//  Acts as a catch-all when the runtime script misses something.
// ══════════════════════════════════════

const SW_VERSION  = "mos-sw-v4";
const OWN_ORIGIN  = self.location.origin;
const PROXY_PATH  = OWN_ORIGIN + "/fetch?url=";

// Headers that reveal proxy identity — strip before forwarding
const STRIP_REQ = new Set([
  "origin","referer","x-forwarded-for","x-forwarded-host",
  "x-forwarded-proto","x-real-ip","via","forwarded",
]);

// ── install / activate ────────────────────────────────────────────────────────
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SW_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── fetch interception ────────────────────────────────────────────────────────
self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // Fast exits — never touch own-origin, already-proxied, or non-HTTP
  if (url.startsWith(OWN_ORIGIN + "/")) return;
  if (url.includes("/fetch?url="))       return;
  if (!url.startsWith("http"))           return;
  if (url.startsWith("data:") || url.startsWith("blob:")) return;

  // Only intercept if request comes FROM a proxied page
  // (client URL will contain /fetch?url=)
  e.respondWith(
    (e.clientId
      ? self.clients.get(e.clientId)
      : Promise.resolve(null)
    ).then(client => {
      // If we can't identify the client, or it's not a proxied page, pass through
      if (!client || !client.url.includes("/fetch?url=")) {
        return fetch(e.request);
      }
      return proxyFetch(url, e.request);
    }).catch(() => fetch(e.request))
  );
});

// ── proxy the request ─────────────────────────────────────────────────────────
function proxyFetch(url, original) {
  const proxiedUrl = PROXY_PATH + encodeURIComponent(url);

  // Build clean headers
  const headers = {};
  for (const [k, v] of original.headers.entries()) {
    if (!STRIP_REQ.has(k.toLowerCase())) {
      headers[k] = v;
    }
  }

  const method = original.method || "GET";
  const isBodyless = method === "GET" || method === "HEAD";

  return fetch(proxiedUrl, {
    method,
    headers,
    body:        isBodyless ? undefined : original.body,
    mode:        "cors",
    credentials: "omit",
    redirect:    "follow",
  }).catch(err => {
    console.warn("[SW] proxy failed for", url, "—", err.message);
    // Last resort: try direct (will fail for CORS-restricted origins, but worth trying)
    return fetch(original).catch(() =>
      new Response(
        JSON.stringify({ error: "SW proxy failed: " + err.message }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      )
    );
  });
}
