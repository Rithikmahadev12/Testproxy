"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — proxyHandler.js  v7
//  • LRU in-memory cache (static assets)
//  • Range request forwarding (video seek)
//  • WASM binary streaming
//  • ES module JS rewriting
//  • Better error recovery
// ══════════════════════════════════════

const http   = require("http");
const https  = require("https");
const url    = require("url");
const zlib   = require("zlib");

const { isBlocked, cleanResponseHeaders, buildRequestHeaders } = require("./blocklist");
const { rewriteHtml, rewriteCss, rewriteJs, injectHelpers }    = require("./rewriter");

const MAX_REDIRECTS  = 15;
const TIMEOUT_MS     = 30_000;
const MAX_BODY_SIZE  = 60 * 1024 * 1024; // 60MB

// ── Connection pools ──────────────────────────────────────────────────────────
const httpAgent  = new http.Agent({
  keepAlive: true, maxSockets: 256, timeout: TIMEOUT_MS,
});
const httpsAgent = new https.Agent({
  keepAlive: true, maxSockets: 256, timeout: TIMEOUT_MS,
  rejectUnauthorized: false, checkServerIdentity: () => {},
});

// ── LRU Cache ─────────────────────────────────────────────────────────────────
// Only caches static / cacheable content-types
const CACHE_MAX = 200;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

class LRUCache {
  constructor(max, ttl) {
    this.max  = max;
    this.ttl  = ttl;
    this.map  = new Map();
  }
  _evict() {
    let oldest = null, oldestTs = Infinity;
    for (const [k, v] of this.map) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldest = k; }
    }
    if (oldest) this.map.delete(oldest);
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return null;
    if (Date.now() - e.ts > this.ttl) { this.map.delete(key); return null; }
    // Move to end (LRU touch)
    this.map.delete(key);
    this.map.set(key, e);
    return e;
  }
  set(key, value) {
    if (this.map.size >= this.max) this._evict();
    this.map.set(key, { ...value, ts: Date.now() });
  }
}

const CACHE = new LRUCache(CACHE_MAX, CACHE_TTL);

// Content types we cache
function isCacheable(ct, method) {
  if (method !== "GET") return false;
  const c = (ct || "").toLowerCase();
  return c.includes("text/css") ||
         c.includes("javascript") ||
         c.includes("application/wasm") ||
         c.includes("font/") ||
         c.includes("image/") ||
         c.includes("application/json");
}

// ── Per-site User-Agent / header overrides ────────────────────────────────────
const SITE_OVERRIDES = {
  "youtube.com": {
    "user-agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "sec-fetch-mode":  "navigate",
    "sec-fetch-dest":  "document",
    "sec-fetch-site":  "none",
    "sec-fetch-user":  "?1",
    "upgrade-insecure-requests": "1",
  },
  "google.com": {
    "user-agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
  },
  "reddit.com": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
};

function getSiteOverrides(hostname) {
  const h = hostname.replace(/^www\./, "");
  for (const [key, val] of Object.entries(SITE_OVERRIDES)) {
    if (h === key || h.endsWith("." + key)) return val;
  }
  return {};
}

function setCORS(res) {
  if (res.headersSent) return;
  res.setHeader("Access-Control-Allow-Origin",      "*");
  res.setHeader("Access-Control-Allow-Methods",     "GET,POST,PUT,DELETE,PATCH,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers",     "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Expose-Headers",    "*");
  // Required for WASM threads / SharedArrayBuffer
  res.setHeader("Cross-Origin-Opener-Policy",   "unsafe-none");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
}

function getProxyBase(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"]  || req.headers["host"] || "localhost:3000";
  return `${proto}://${host}`;
}

function parseTarget(rawParam) {
  if (!rawParam) return null;
  let s;
  try { s = decodeURIComponent(rawParam).trim(); } catch { s = rawParam.trim(); }
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return u;
  } catch {}
  try { return new URL("https://" + s); } catch {}
  return null;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []; let total = 0;
    req.on("data", (c) => { total += c.length; if (total < MAX_BODY_SIZE) chunks.push(c); });
    req.on("end",  () => resolve(chunks.length ? Buffer.concat(chunks) : null));
    req.on("error",() => resolve(null));
  });
}

function decompress(src, encoding) {
  const enc = (encoding || "").toLowerCase().trim();
  try {
    if (enc === "gzip")   return src.pipe(zlib.createGunzip());
    if (enc === "br")     return src.pipe(zlib.createBrotliDecompress());
    if (enc === "brotli") return src.pipe(zlib.createBrotliDecompress());
    if (enc === "deflate")return src.pipe(zlib.createInflate());
    if (enc === "zstd" && zlib.createZstdDecompress) return src.pipe(zlib.createZstdDecompress());
  } catch (e) { console.warn("[MOS] decompress failed:", enc, e.message); }
  return src;
}

function toBuffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    readable.on("data",  (c) => { total += c.length; if (total < MAX_BODY_SIZE) chunks.push(c); });
    readable.on("end",   ()  => resolve(Buffer.concat(chunks)));
    readable.on("error", (e) => reject(e));
  });
}

function sendError(res, code, msg) {
  if (res.headersSent) return;
  setCORS(res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: msg }));
}

// ── Cookie jar ────────────────────────────────────────────────────────────────
const cookieJar = new Map();

function storeCookies(hostname, setCookieHeaders) {
  if (!setCookieHeaders) return;
  const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  if (!cookieJar.has(hostname)) cookieJar.set(hostname, {});
  const jar = cookieJar.get(hostname);
  for (const c of arr) {
    const [pair] = c.split(";");
    if (!pair) continue;
    const [k, ...rest] = pair.split("=");
    if (k) jar[k.trim()] = rest.join("=").trim();
  }
}

function getCookieHeader(hostname) {
  const jar = cookieJar.get(hostname);
  if (!jar) return null;
  const pairs = Object.entries(jar).map(([k, v]) => `${k}=${v}`);
  return pairs.length ? pairs.join("; ") : null;
}

// ════════════════════════════
//  MAIN ENTRY
// ════════════════════════════
async function handleFetch(req, res) {
  setCORS(res);

  const qs        = url.parse(req.url, true).query;
  const rawTarget = qs.url;
  const noRewrite = qs.rewrite === "false";

  const targetUrl = parseTarget(rawTarget);
  if (!targetUrl) return sendError(res, 400, "Missing or invalid ?url= parameter");
  if (isBlocked(targetUrl.hostname)) return sendError(res, 403, "Host blocked by MOS policy");

  const proxyBase = getProxyBase(req);
  const method    = (req.method || "GET").toUpperCase();
  const bodyBuf   = ["GET","HEAD"].includes(method) ? null : await readBody(req);

  // ── Cache hit for GET requests ──────────────────────────────────────────────
  if (method === "GET") {
    const cacheKey = targetUrl.href;
    const cached   = CACHE.get(cacheKey);
    if (cached) {
      setCORS(res);
      res.writeHead(cached.status, {
        ...cached.headers,
        "x-mos-cache": "HIT",
      });
      res.end(cached.body);
      return;
    }
  }

  try {
    await proxyRequest({ req, res, targetUrl, proxyBase, noRewrite, bodyBuf, hops: 0 });
  } catch (err) {
    console.error("[MOS] handleFetch error:", err.message);
    sendError(res, 502, "Proxy error: " + err.message);
  }
}

// ════════════════════════════
//  PROXY LOOP
// ════════════════════════════
async function proxyRequest({ req, res, targetUrl, proxyBase, noRewrite, bodyBuf, hops }) {
  if (hops > MAX_REDIRECTS) return sendError(res, 310, "Too many redirects");

  const isHttps = targetUrl.protocol === "https:";
  const lib     = isHttps ? https : http;
  const agent   = isHttps ? httpsAgent : httpAgent;
  const method  = (req.method || "GET").toUpperCase();

  const siteOverrides = getSiteOverrides(targetUrl.hostname);
  const storedCookie  = getCookieHeader(targetUrl.hostname);

  // Build outgoing headers
  const outHeaders = buildRequestHeaders(req.headers, {
    "host":            targetUrl.host,
    "referer":         targetUrl.origin + "/",
    "origin":          targetUrl.origin,
    "accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "gzip, deflate, br",
    "cache-control":   "no-cache",
    "pragma":          "no-cache",
    "upgrade-insecure-requests": "1",
    "sec-fetch-mode":  "navigate",
    "sec-fetch-dest":  "document",
    "sec-fetch-site":  "none",
    "sec-fetch-user":  "?1",
    "dnt":             "1",
    ...siteOverrides,
    "cookie": [storedCookie, req.headers["cookie"] || ""].filter(Boolean).join("; ") || undefined,
    ...(bodyBuf ? {
      "content-length": String(bodyBuf.length),
      "content-type":   req.headers["content-type"] || "application/x-www-form-urlencoded",
    } : {}),
  });

  // ── Forward Range header (crucial for video seeking) ──────────────────────
  const rangeHdr = req.headers["range"];
  if (rangeHdr) outHeaders["range"] = rangeHdr;

  // Clean undefined values
  for (const k of Object.keys(outHeaders)) {
    if (outHeaders[k] === undefined) delete outHeaders[k];
  }

  const pathWithQuery = (targetUrl.pathname || "/") + (targetUrl.search || "");

  const options = {
    hostname: targetUrl.hostname,
    port:     targetUrl.port || (isHttps ? 443 : 80),
    path:     pathWithQuery,
    method,
    headers:  outHeaders,
    timeout:  TIMEOUT_MS,
    agent,
  };

  return new Promise((resolve) => {
    const preq = lib.request(options, async (pres) => {
      try {
        const status = pres.statusCode;
        const pheads = pres.headers;

        // Store cookies
        if (pheads["set-cookie"]) {
          storeCookies(targetUrl.hostname, pheads["set-cookie"]);
        }

        // ── REDIRECTS ─────────────────────────────────────────────────────
        if (status >= 300 && status < 400 && pheads["location"]) {
          pres.resume();
          let loc;
          try { loc = new URL(pheads["location"], targetUrl.href); }
          catch { return sendError(res, 502, "Bad redirect location"); }
          if (isBlocked(loc.hostname)) return sendError(res, 403, "Redirect target blocked");
          setCORS(res);
          return resolve(proxyRequest({
            req, res, targetUrl: loc, proxyBase, noRewrite, bodyBuf: null, hops: hops + 1,
          }));
        }

        const rawCT   = pheads["content-type"] || "";
        const ct      = rawCT.toLowerCase();
        const enc     = (pheads["content-encoding"] || "").toLowerCase().trim();
        const isRange = status === 206;

        const isHtml  = ct.includes("text/html");
        const isCss   = ct.includes("text/css");
        const isJs    = ct.includes("javascript") || ct.includes("ecmascript");
        const isJson  = ct.includes("application/json");
        const isSvg   = ct.includes("image/svg");
        const isWasm  = ct.includes("application/wasm") || targetUrl.pathname.endsWith(".wasm");
        const isMedia = ct.startsWith("video/") || ct.startsWith("audio/");
        const isFont  = ct.startsWith("font/") || ct.includes("font");
        const isImage = ct.startsWith("image/") && !isSvg;
        const isBinary = isWasm || isMedia || isFont || isImage ||
                         (!isHtml && !isCss && !isJs && !isJson && !isSvg);

        const cleanH = cleanResponseHeaders(pheads);

        // Rewrite Set-Cookie for cross-origin
        if (pheads["set-cookie"]) {
          cleanH["set-cookie"] = (
            Array.isArray(pheads["set-cookie"]) ? pheads["set-cookie"] : [pheads["set-cookie"]]
          ).map(c =>
            c
              .replace(/;\s*Domain=[^;]*/gi, "")
              .replace(/;\s*Secure/gi, "")
              .replace(/;\s*SameSite=[^;]*/gi, "; SameSite=None")
              .replace(/;\s*Partitioned/gi, "")
          );
        }

        setCORS(res);

        // ── STREAMING PASS-THROUGH: binary, media, WASM, images, fonts ─────
        // Range responses (video seeking) ALWAYS stream through unchanged
        if (isBinary || isRange) {
          const passH = { ...cleanH, "content-type": rawCT };
          if (enc) passH["content-encoding"] = enc;
          if (pheads["content-range"])  passH["content-range"]  = pheads["content-range"];
          if (pheads["accept-ranges"])  passH["accept-ranges"]  = pheads["accept-ranges"];
          if (pheads["content-length"]) passH["content-length"] = pheads["content-length"];

          // For WASM, ensure proper MIME type
          if (isWasm) passH["content-type"] = "application/wasm";

          res.writeHead(status, passH);
          pres.pipe(res);
          pres.on("end",   resolve);
          pres.on("error", resolve);
          return;
        }

        // ── JS: decompress, rewrite ES module imports, send ──────────────
        if (isJs) {
          delete cleanH["content-encoding"];
          delete cleanH["content-length"];
          delete cleanH["transfer-encoding"];
          if (pheads["accept-ranges"]) cleanH["accept-ranges"] = pheads["accept-ranges"];

          let bodyStream;
          try { bodyStream = decompress(pres, enc); } catch { bodyStream = pres; }

          let rawBody;
          try { rawBody = await toBuffer(bodyStream); } catch (e) {
            return sendError(res, 502, "Failed to read JS: " + e.message);
          }

          let body = rawBody.toString("utf8");
          // Safe ES module URL rewriting
          try { body = rewriteJs(body, targetUrl.href, proxyBase); } catch (e) {
            console.warn("[MOS] rewriteJs error:", e.message);
          }

          const outBuf = Buffer.from(body, "utf8");

          // Cache JS
          if (method === "GET") {
            CACHE.set(targetUrl.href, {
              status, body: outBuf,
              headers: { ...cleanH, "content-type": rawCT, "content-length": String(outBuf.length) }
            });
          }

          res.writeHead(status, {
            ...cleanH,
            "content-type":   rawCT || "application/javascript; charset=utf-8",
            "content-length": String(outBuf.length),
          });
          res.end(outBuf);
          resolve();
          return;
        }

        // ── TEXT/HTML/CSS: decompress, rewrite, send ──────────────────────
        delete cleanH["content-encoding"];
        delete cleanH["content-length"];
        delete cleanH["transfer-encoding"];
        if (pheads["accept-ranges"]) cleanH["accept-ranges"] = pheads["accept-ranges"];

        let bodyStream;
        try { bodyStream = decompress(pres, enc); } catch { bodyStream = pres; }

        let rawBody;
        try { rawBody = await toBuffer(bodyStream); } catch (e) {
          return sendError(res, 502, "Failed to read upstream: " + e.message);
        }

        let body = rawBody.toString("utf8");

        if (isHtml) {
          try { body = rewriteHtml(body, targetUrl.href, proxyBase); } catch (e) {
            console.warn("[MOS] rewriteHtml error:", e.message);
          }
          try { body = injectHelpers(body, targetUrl.href, proxyBase); } catch (e) {
            console.warn("[MOS] injectHelpers error:", e.message);
          }
        } else if (isCss) {
          try { body = rewriteCss(body, targetUrl.href, proxyBase); } catch (e) {
            console.warn("[MOS] rewriteCss error:", e.message);
          }
        } else if (isSvg) {
          try { body = rewriteHtml(body, targetUrl.href, proxyBase); } catch {}
        }

        const outBuf = Buffer.from(body, "utf8");

        // Cache CSS/JSON
        if (method === "GET" && isCacheable(ct, method) && !isHtml) {
          CACHE.set(targetUrl.href, {
            status, body: outBuf,
            headers: { ...cleanH, "content-type": rawCT, "content-length": String(outBuf.length) }
          });
        }

        res.writeHead(status, {
          ...cleanH,
          "content-type":   rawCT || "text/plain; charset=utf-8",
          "content-length": String(outBuf.length),
        });
        res.end(outBuf);
        resolve();

      } catch (innerErr) {
        console.error("[MOS] inner proxy error:", innerErr.message);
        sendError(res, 500, "Rewrite error: " + innerErr.message);
        resolve();
      }
    });

    preq.on("timeout", () => {
      preq.destroy(new Error("Upstream timed out after " + TIMEOUT_MS + "ms"));
    });

    preq.on("error", (err) => {
      console.error("[MOS] upstream error:", err.message, "->", targetUrl.href);
      sendError(res, 502, "Upstream failed: " + err.message);
      resolve();
    });

    if (bodyBuf) preq.write(bodyBuf);
    preq.end();
  });
}

module.exports = { handleFetch };
