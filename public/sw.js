"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — Service Worker Proxy
//  Intercepts ALL fetch requests and
//  routes them through the MOS proxy
// ══════════════════════════════════════

const PROXY_PREFIX = "/fetch?url=";
const CACHE_NAME   = "mos-proxy-v1";

// These are our own assets — never proxy them
const OWN_ORIGINS = new Set([
  self.location.origin,
]);

function shouldProxy(url) {
  try {
    const u = new URL(url);
    // Don't proxy our own origin, data URIs, blobs, chrome-extension etc
    if (OWN_ORIGINS.has(u.origin)) return false;
    if (u.protocol === "data:")        return false;
    if (u.protocol === "blob:")        return false;
    if (u.protocol === "chrome-extension:") return false;
    if (u.pathname.startsWith("/fetch")) return false;
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function toProxied(url) {
  return self.location.origin + PROXY_PREFIX + encodeURIComponent(url);
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = req.url;

  // Skip non-http(s) and already-proxied requests
  if (!url.startsWith("http")) return;
  if (url.includes("/fetch?url=")) return;
  if (url.startsWith(self.location.origin + "/")) return;

  if (!shouldProxy(url)) return;

  e.respondWith(
    fetch(toProxied(url), {
      method:  req.method,
      headers: req.headers,
      body:    req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      redirect: "follow",
    }).catch((err) => {
      return new Response("Proxy error: " + err.message, { status: 502 });
    })
  );
});
