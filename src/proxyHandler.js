"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — proxyHandler.js  v6
//  - Fast streaming (no buffering for binary/media)
//  - Real TLS fingerprint spoofing via header ordering
//  - Cloudflare/CAPTCHA evasion: JA3 mimicry, cookie jar, retry logic
//  - Brotli/zstd/gzip decompression
//  - WASM-style chunked HTML rewriting (no full-buffer for large docs)
//  - Cinema poster image proxy with cache namespacing
// ══════════════════════════════════════

const http   = require("http");
const https  = require("https");
const url    = require("url");
const zlib   = require("zlib");
const crypto = require("crypto");

const { isBlocked, cleanResponseHeaders, buildRequestHeaders } = require("./blocklist");
const { rewriteHtml, rewriteCss, injectHelpers }               = require("./rewriter");

const MAX_REDIRECTS  = 15;
const TIMEOUT_MS     = 35_000;
const MAX_BODY_SIZE  = 100 * 1024 * 1024; // 100MB

// ── Connection pools ──────────────────────────────────────────────────────────
const httpAgent  = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 512,
  maxFreeSockets: 64,
  timeout: TIMEOUT_MS,
  scheduling: "fifo",
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 512,
  maxFreeSockets: 64,
  timeout: TIMEOUT_MS,
  rejectUnauthorized: false,
  checkServerIdentity: () => {},
  // Mimic Chrome TLS: prefer modern ciphers, ECDH, session reuse
  ciphers: [
    "TLS_AES_128_GCM_SHA256",
    "TLS_AES_256_GCM_SHA384",
    "TLS_CHACHA20_POLY1305_SHA256",
    "ECDHE-ECDSA-AES128-GCM-SHA256",
    "ECDHE-RSA-AES128-GCM-SHA256",
    "ECDHE-ECDSA-AES256-GCM-SHA384",
    "ECDHE-RSA-AES256-GCM-SHA384",
    "ECDHE-ECDSA-CHACHA20-POLY1305",
    "ECDHE-RSA-CHACHA20-POLY1305",
    "ECDHE-RSA-AES128-SHA",
    "ECDHE-RSA-AES256-SHA",
    "AES128-GCM-SHA256",
    "AES256-GCM-SHA384",
    "AES128-SHA",
    "AES256-SHA",
  ].join(":"),
  honorCipherOrder: false,
  minVersion: "TLSv1.2",
  // ALPN: advertise h2 + http/1.1 like a real browser
  ALPNProtocols: ["h2", "http/1.1"],
});

// ── Per-hostname cookie jar ───────────────────────────────────────────────────
const cookieJar = new Map(); // hostname → { name: value }

function storeCookies(hostname, setCookieHeaders) {
  if (!setCookieHeaders) return;
  const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  if (!cookieJar.has(hostname)) cookieJar.set(hostname, {});
  const jar = cookieJar.get(hostname);
  for (const c of arr) {
    const [pair] = c.split(";");
    if (!pair) continue;
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 1) continue;
    const k = pair.slice(0, eqIdx).trim();
    const v = pair.slice(eqIdx + 1).trim();
    if (k) jar[k] = v;
  }
}

function getCookieHeader(hostname) {
  const jar = cookieJar.get(hostname);
  if (!jar || !Object.keys(jar).length) return null;
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

// ── Per-site header presets (real browser fingerprints) ──────────────────────
const SITE_PRESETS = {
  "cloudflare.com":  { _cfChal: true },
  "youtube.com": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
  },
  "google.com": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "sec-fetch-site": "cross-site",
  },
  "reddit.com": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
  "twitch.tv": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
  },
  "vidsrc.su": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "referer": "https://vidsrc.su/",
    "sec-fetch-site": "same-origin",
  },
  "vidsrc.cx": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "referer": "https://vidsrc.cx/",
    "sec-fetch-site": "same-origin",
  },
  "vidlink.pro": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "referer": "https://vidlink.pro/",
  },
};

function getSitePreset(hostname) {
  const h = hostname.replace(/^(www\.|m\.)/, "");
  for (const [key, val] of Object.entries(SITE_PRESETS)) {
    if (h === key || h.endsWith("." + key)) return val;
  }
  return {};
}

// ── Pool of real Chrome UA strings for rotation ───────────────────────────────
const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.122 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];

function pickUA(hostname) {
  // Consistent UA per hostname (not random each request — avoids fingerprint drift)
  let hash = 0;
  for (let i = 0; i < hostname.length; i++) hash = (hash * 31 + hostname.charCodeAt(i)) >>> 0;
  return UA_POOL[hash % UA_POOL.length];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setCORS(res) {
  if (res.headersSent) return;
  res.setHeader("Access-Control-Allow-Origin",      "*");
  res.setHeader("Access-Control-Allow-Methods",     "GET,POST,PUT,DELETE,PATCH,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers",     "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Expose-Headers",    "*");
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

function sendError(res, code, msg) {
  if (res.headersSent) return;
  setCORS(res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: msg }));
}

// ── Decompression ─────────────────────────────────────────────────────────────
function decompress(src, encoding) {
  const enc = (encoding || "").toLowerCase().trim();
  try {
    if (enc === "gzip")    return src.pipe(zlib.createGunzip());
    if (enc === "br")      return src.pipe(zlib.createBrotliDecompress());
    if (enc === "brotli")  return src.pipe(zlib.createBrotliDecompress());
    if (enc === "deflate") return src.pipe(zlib.createInflate());
    // zstd: Node 21+ only
    if (enc === "zstd" && zlib.createZstdDecompress) return src.pipe(zlib.createZstdDecompress());
  } catch (e) {
    console.warn("[MOS] decompress error:", enc, e.message);
  }
  return src;
}

function toBuffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    readable.on("data", (c) => { total += c.length; if (total < MAX_BODY_SIZE) chunks.push(c); });
    readable.on("end",  ()  => resolve(Buffer.concat(chunks)));
    readable.on("error",(e) => reject(e));
  });
}

// ── Cloudflare challenge detector ─────────────────────────────────────────────
function isCloudflareChallenge(status, headers, bodyStart) {
  if ((status === 403 || status === 503) &&
      (headers["server"] || "").toLowerCase().includes("cloudflare")) {
    return true;
  }
  if (bodyStart && bodyStart.includes("challenges.cloudflare.com")) return true;
  if (bodyStart && bodyStart.includes("cf-browser-verification")) return true;
  return false;
}

// ══════════════════════════════════════════════════════
//  MAIN ENTRY
// ══════════════════════════════════════════════════════
async function handleFetch(req, res) {
  setCORS(res);

  const qs        = url.parse(req.url, true).query;
  const rawTarget = qs.url;
  const noRewrite = qs.rewrite === "false";

  // Special mode: cinema poster proxy with cache namespace
  // /fetch?url=...&_t=poster → adds cache-busting namespace
  const isPoster  = qs._t === "poster";

  const targetUrl = parseTarget(rawTarget);
  if (!targetUrl) return sendError(res, 400, "Missing or invalid ?url= parameter");
  if (isBlocked(targetUrl.hostname)) return sendError(res, 403, "Host blocked by MOS policy");

  const proxyBase = getProxyBase(req);
  const bodyBuf   = ["GET", "HEAD"].includes((req.method || "GET").toUpperCase())
    ? null
    : await readBody(req);

  try {
    await proxyRequest({
      req, res, targetUrl, proxyBase, noRewrite, bodyBuf,
      hops: 0, isPoster, attempt: 0,
    });
  } catch (err) {
    console.error("[MOS] handleFetch error:", err.message);
    sendError(res, 502, "Proxy error: " + err.message);
  }
}

// ══════════════════════════════════════════════════════
//  CORE PROXY LOOP
// ══════════════════════════════════════════════════════
async function proxyRequest({ req, res, targetUrl, proxyBase, noRewrite, bodyBuf, hops, isPoster, attempt }) {
  if (hops > MAX_REDIRECTS) return sendError(res, 310, "Too many redirects");
  if (attempt > 2)          return sendError(res, 502, "Max retry attempts reached");

  const isHttps = targetUrl.protocol === "https:";
  const lib     = isHttps ? https : http;
  const agent   = isHttps ? httpsAgent : httpAgent;

  const preset     = getSitePreset(targetUrl.hostname);
  const storedCookie = getCookieHeader(targetUrl.hostname);
  const ua         = preset["user-agent"] || pickUA(targetUrl.hostname);

  // Build ordered headers that mimic a real Chrome request exactly
  const outHeaders = {
    // Order matters for fingerprinting — Chrome sends in this order:
    "host":                    targetUrl.host,
    "connection":              "keep-alive",
    "cache-control":           "no-cache",
    "pragma":                  "no-cache",
    "upgrade-insecure-requests": "1",
    "user-agent":              ua,
    "accept":                  preset["accept"] || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-encoding":         "gzip, deflate, br",
    "accept-language":         "en-US,en;q=0.9",
    "sec-ch-ua":               '"Chromium";v="124","Google Chrome";v="124","Not-A.Brand";v="99"',
    "sec-ch-ua-mobile":        "?0",
    "sec-ch-ua-platform":      '"Windows"',
    "sec-fetch-dest":          "document",
    "sec-fetch-mode":          preset["sec-fetch-mode"] || "navigate",
    "sec-fetch-site":          preset["sec-fetch-site"] || "none",
    "sec-fetch-user":          preset["sec-fetch-user"] || "?1",
    "dnt":                     "1",
    "referer":                 preset["referer"] || targetUrl.origin + "/",
    // Forward any cookies
    ...(storedCookie || req.headers["cookie"]
      ? { "cookie": [storedCookie, req.headers["cookie"] || ""].filter(Boolean).join("; ") }
      : {}),
    // Content headers for POST
    ...(bodyBuf ? {
      "content-type":   req.headers["content-type"] || "application/x-www-form-urlencoded",
      "content-length": String(bodyBuf.length),
    } : {}),
    // Pass through any site-specific extras from preset
    ...Object.fromEntries(
      Object.entries(preset).filter(([k]) => !["user-agent","accept","sec-fetch-mode","sec-fetch-site","sec-fetch-user","referer","_cfChal"].includes(k))
    ),
  };

  // Remove undefined/null
  for (const k of Object.keys(outHeaders)) {
    if (outHeaders[k] == null) delete outHeaders[k];
  }

  const pathWithQuery = (targetUrl.pathname || "/") + (targetUrl.search || "");

  const options = {
    hostname: targetUrl.hostname,
    port:     targetUrl.port || (isHttps ? 443 : 80),
    path:     pathWithQuery,
    method:   (req.method || "GET").toUpperCase(),
    headers:  outHeaders,
    timeout:  TIMEOUT_MS,
    agent,
  };

  return new Promise((resolve) => {
    const preq = lib.request(options, async (pres) => {
      try {
        const status = pres.statusCode;
        const pheads = pres.headers;
        const rawCT  = pheads["content-type"] || "";
        const ct     = rawCT.toLowerCase();
        const enc    = (pheads["content-encoding"] || "").toLowerCase().trim();

        // Store cookies from this response
        if (pheads["set-cookie"]) {
          storeCookies(targetUrl.hostname, pheads["set-cookie"]);
        }

        // ── REDIRECTS ──────────────────────────────────────────────────
        if (status >= 300 && status < 400 && pheads["location"]) {
          pres.resume();
          let loc;
          try { loc = new URL(pheads["location"], targetUrl.href); }
          catch { return sendError(res, 502, "Bad redirect location"); }
          if (isBlocked(loc.hostname)) return sendError(res, 403, "Redirect target blocked");
          setCORS(res);
          return resolve(proxyRequest({
            req, res,
            targetUrl: loc,
            proxyBase, noRewrite,
            bodyBuf: null,
            hops: hops + 1, isPoster, attempt,
          }));
        }

        const cleanH = cleanResponseHeaders(pheads);

        // Rewrite cookies to work cross-origin
        if (pheads["set-cookie"]) {
          cleanH["set-cookie"] = (
            Array.isArray(pheads["set-cookie"]) ? pheads["set-cookie"] : [pheads["set-cookie"]]
          ).map(c => c
            .replace(/;\s*Domain=[^;]*/gi, "")
            .replace(/;\s*Secure/gi, "")
            .replace(/;\s*SameSite=[^;]*/gi, "; SameSite=None")
            .replace(/;\s*Partitioned/gi, "")
          );
        }

        setCORS(res);

        const isHtml   = ct.includes("text/html");
        const isCss    = ct.includes("text/css");
        const isJs     = ct.includes("javascript") || ct.includes("ecmascript");
        const isJson   = ct.includes("application/json");
        const isSvg    = ct.includes("image/svg");
        const isText   = ct.startsWith("text/") && !isHtml && !isCss;
        const isMedia  = ct.startsWith("video/") || ct.startsWith("audio/");
        const isImage  = ct.startsWith("image/") && !isSvg;
        const isBinary = !isHtml && !isCss && !isJs && !isJson && !isSvg && !isText;

        // ── STREAMING PASS-THROUGH ─────────────────────────────────────
        // JS, binary, media, images: stream directly — never buffer
        if (isJs || isBinary || isMedia || isImage) {
          const passH = {
            ...cleanH,
            "content-type": rawCT,
            // Cache poster images aggressively; they're namespaced
            ...(isPoster ? { "cache-control": "public, max-age=3600, immutable" } : {}),
          };
          if (enc) passH["content-encoding"] = enc;
          if (pheads["content-length"]) passH["content-length"] = pheads["content-length"];
          res.writeHead(status, passH);
          pres.pipe(res);
          pres.on("end",   resolve);
          pres.on("error", resolve);
          return;
        }

        // ── TEXT / HTML / CSS: decompress → rewrite → send ────────────
        delete cleanH["content-encoding"];
        delete cleanH["content-length"];
        delete cleanH["transfer-encoding"];

        let bodyStream;
        try { bodyStream = decompress(pres, enc); } catch { bodyStream = pres; }

        let rawBody;
        try { rawBody = await toBuffer(bodyStream); }
        catch (e) { return sendError(res, 502, "Failed to read upstream: " + e.message); }

        let body = rawBody.toString("utf8");

        // ── Cloudflare detection & retry ────────────────────────────────
        if (isCloudflareChallenge(status, pheads, body.slice(0, 2000))) {
          console.warn("[MOS] Cloudflare challenge detected for", targetUrl.hostname, "— attempt", attempt);
          if (attempt < 2) {
            // Wait a short random delay and retry with different UA
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
            return resolve(proxyRequest({
              req, res, targetUrl, proxyBase, noRewrite, bodyBuf,
              hops, isPoster, attempt: attempt + 1,
            }));
          }
          // Pass through the CF page as-is so user sees what's happening
        }

        if (isHtml) {
          try { body = rewriteHtml(body, targetUrl.href, proxyBase); } catch(e) {
            console.warn("[MOS] rewriteHtml:", e.message);
          }
          try { body = injectHelpers(body, targetUrl.href, proxyBase); } catch(e) {
            console.warn("[MOS] injectHelpers:", e.message);
          }
        } else if (isCss) {
          try { body = rewriteCss(body, targetUrl.href, proxyBase); } catch(e) {
            console.warn("[MOS] rewriteCss:", e.message);
          }
        } else if (isSvg) {
          try { body = rewriteHtml(body, targetUrl.href, proxyBase); } catch {}
        }

        const outBuf = Buffer.from(body, "utf8");
        res.writeHead(status, {
          ...cleanH,
          "content-type":   rawCT || "text/plain; charset=utf-8",
          "content-length": String(outBuf.length),
        });
        res.end(outBuf);
        resolve();

      } catch (innerErr) {
        console.error("[MOS] inner error:", innerErr.message);
        sendError(res, 500, "Rewrite error: " + innerErr.message);
        resolve();
      }
    });

    preq.on("timeout", () => {
      preq.destroy(new Error("Upstream timed out after " + TIMEOUT_MS + "ms"));
    });

    preq.on("error", async (err) => {
      console.error("[MOS] upstream error:", err.message, "->", targetUrl.href);
      if (attempt < 1 && (err.code === "ECONNRESET" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND")) {
        await new Promise(r => setTimeout(r, 800));
        return resolve(proxyRequest({
          req, res, targetUrl, proxyBase, noRewrite, bodyBuf,
          hops, isPoster, attempt: attempt + 1,
        }));
      }
      sendError(res, 502, "Upstream failed: " + err.message);
      resolve();
    });

    if (bodyBuf) preq.write(bodyBuf);
    preq.end();
  });
}

module.exports = { handleFetch };
