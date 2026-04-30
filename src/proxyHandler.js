"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — proxyHandler.js  v5
//  Full-fidelity reverse proxy
//  - Proper streaming for binary/media
//  - YouTube/Google spoofed headers
//  - Robust redirect following
//  - Gzip/brotli/zstd decompression
// ══════════════════════════════════════

const http   = require("http");
const https  = require("https");
const url    = require("url");
const zlib   = require("zlib");

const { isBlocked, cleanResponseHeaders, buildRequestHeaders } = require("./blocklist");
const { rewriteHtml, rewriteCss, injectHelpers }               = require("./rewriter");

const MAX_REDIRECTS  = 15;
const TIMEOUT_MS     = 30_000;
const MAX_BODY_SIZE  = 50 * 1024 * 1024; // 50MB

const httpAgent  = new http.Agent({
  keepAlive: true,
  maxSockets: 256,
  timeout: TIMEOUT_MS,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 256,
  timeout: TIMEOUT_MS,
  rejectUnauthorized: false,
  checkServerIdentity: () => {},
});

// ── Per-site User-Agent / header overrides ────────────────────────────────────
const SITE_OVERRIDES = {
  "youtube.com": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  },
  "google.com": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
  },
  "reddit.com": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
}

function getProxyBase(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"]  || req.headers["host"] || "localhost:3000";
  return `${proto}://${host}`;
}

function parseTarget(rawParam) {
  if (!rawParam) return null;
  let s;
  try { s = decodeURIComponent(rawParam).trim(); }
  catch { s = rawParam.trim(); }
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return u;
  } catch {}
  try { return new URL("https://" + s); }
  catch {}
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
    if (enc === "gzip")    return src.pipe(zlib.createGunzip());
    if (enc === "br")      return src.pipe(zlib.createBrotliDecompress());
    if (enc === "brotli")  return src.pipe(zlib.createBrotliDecompress());
    if (enc === "deflate") return src.pipe(zlib.createInflate());
    if (enc === "zstd" && zlib.createZstdDecompress) return src.pipe(zlib.createZstdDecompress());
  } catch (e) {
    console.warn("[MOS] decompress failed for", enc, e.message);
  }
  return src;
}

function toBuffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    readable.on("data",  (c) => {
      total += c.length;
      if (total < MAX_BODY_SIZE) chunks.push(c);
    });
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

// ── Cookie jar per-session (in-memory, keyed by hostname) ────────────────────
// Simple: store Set-Cookie values and forward them on next request to same host
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

// ══════════════════════════════════════════════════════
//  MAIN ENTRY
// ══════════════════════════════════════════════════════
async function handleFetch(req, res) {
  setCORS(res);

  const qs        = url.parse(req.url, true).query;
  const rawTarget = qs.url;
  const noRewrite = qs.rewrite === "false";

  const targetUrl = parseTarget(rawTarget);
  if (!targetUrl) return sendError(res, 400, "Missing or invalid ?url= parameter");
  if (isBlocked(targetUrl.hostname)) return sendError(res, 403, "Host blocked by MOS policy");

  const proxyBase = getProxyBase(req);
  const bodyBuf   = ["GET","HEAD"].includes((req.method||"GET").toUpperCase())
    ? null
    : await readBody(req);

  try {
    await proxyRequest({ req, res, targetUrl, proxyBase, noRewrite, bodyBuf, hops: 0 });
  } catch (err) {
    console.error("[MOS] handleFetch error:", err.message);
    sendError(res, 502, "Proxy error: " + err.message);
  }
}

// ══════════════════════════════════════════════════════
//  PROXY LOOP
// ══════════════════════════════════════════════════════
async function proxyRequest({ req, res, targetUrl, proxyBase, noRewrite, bodyBuf, hops }) {
  if (hops > MAX_REDIRECTS) return sendError(res, 310, "Too many redirects");

  const isHttps = targetUrl.protocol === "https:";
  const lib     = isHttps ? https : http;
  const agent   = isHttps ? httpsAgent : httpAgent;

  const siteOverrides = getSiteOverrides(targetUrl.hostname);

  // Build the stored cookie string for this host
  const storedCookie = getCookieHeader(targetUrl.hostname);

  const outHeaders = buildRequestHeaders(req.headers, {
    "host":            targetUrl.host,
    "referer":         targetUrl.origin + "/",
    "origin":          targetUrl.origin,
    "accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
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
    // Merge cookies: incoming + stored
    "cookie": [
      storedCookie,
      req.headers["cookie"] || ""
    ].filter(Boolean).join("; ") || undefined,
    ...(bodyBuf ? {
      "content-length": String(bodyBuf.length),
      "content-type":   req.headers["content-type"] || "application/x-www-form-urlencoded",
    } : {}),
  });

  // Remove undefined values
  for (const k of Object.keys(outHeaders)) {
    if (outHeaders[k] === undefined) delete outHeaders[k];
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

        // Store cookies from this response
        if (pheads["set-cookie"]) {
          storeCookies(targetUrl.hostname, pheads["set-cookie"]);
        }

        // ── REDIRECTS ────────────────────────────────────────────────────
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
            hops: hops + 1,
          }));
        }

        const rawCT = pheads["content-type"] || "";
        const ct    = rawCT.toLowerCase();
        const enc   = (pheads["content-encoding"] || "").toLowerCase().trim();

        const isHtml   = ct.includes("text/html");
        const isCss    = ct.includes("text/css");
        const isJs     = ct.includes("javascript") || ct.includes("ecmascript");
        const isJson   = ct.includes("application/json");
        const isSvg    = ct.includes("image/svg");
        const isXml    = ct.includes("xml") && !isHtml;
        const isText   = ct.startsWith("text/") && !isHtml && !isCss;
        const isMedia  = ct.startsWith("video/") || ct.startsWith("audio/");
        const isBinary = !isHtml && !isCss && !isJs && !isJson && !isSvg && !isXml && !isText;

        // Only rewrite HTML, CSS, SVG — NOT JS (shim broke ES modules)
        const shouldRewrite = !noRewrite && (isHtml || isCss || isSvg);

        const cleanH = cleanResponseHeaders(pheads);

        // Rewrite Set-Cookie to work cross-origin
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

        // ── STREAMING PASS-THROUGH: JS, binary, media, images ──────────
        // JS must stream unchanged — prepending anything breaks ES modules
        if (isJs || isBinary || isMedia) {
          const passH = {
            ...cleanH,
            "content-type": rawCT,
          };
          if (enc) passH["content-encoding"] = enc;
          res.writeHead(status, passH);
          pres.pipe(res);
          pres.on("end",   resolve);
          pres.on("error", resolve);
          return;
        }

        // ── TEXT / REWRITABLE: decompress + rewrite + send ──────────────
        delete cleanH["content-encoding"];
        delete cleanH["content-length"];
        delete cleanH["transfer-encoding"];

        let bodyStream;
        try { bodyStream = decompress(pres, enc); }
        catch { bodyStream = pres; }

        let rawBody;
        try { rawBody = await toBuffer(bodyStream); }
        catch (e) {
          return sendError(res, 502, "Failed to read upstream: " + e.message);
        }

        let body = rawBody.toString("utf8");

        if (isHtml) {
          try { body = rewriteHtml(body, targetUrl.href, proxyBase); } catch(e) {
            console.warn("[MOS] rewriteHtml error:", e.message);
          }
          try { body = injectHelpers(body, targetUrl.href, proxyBase); } catch(e) {
            console.warn("[MOS] injectHelpers error:", e.message);
          }
        } else if (isCss) {
          try { body = rewriteCss(body, targetUrl.href, proxyBase); } catch(e) {
            console.warn("[MOS] rewriteCss error:", e.message);
          }
        } else if (isJs) {
          // DO NOT prepend shim — it breaks ES modules (import/export must be at top)
          // The HTML runtime script already proxies fetch/XHR for the whole page
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

// ── JS shim prepended to every JS file ───────────────────────────────────────
function buildJsShim(proxyBase, origin, targetHref) {
  const prefix = `${proxyBase}/fetch?url=`;
  return `/* MOS-PROXY-SHIM */
(function(){
  var __PFX=${JSON.stringify(prefix)};
  var __OR=${JSON.stringify(origin)};
  var __TG=${JSON.stringify(targetHref)};
  function _p(u){
    if(!u||typeof u!=='string')return u;
    var s=u.trim();
    if(!s||s.startsWith(__PFX)||s.startsWith('data:')||s.startsWith('blob:')||s.startsWith('javascript:')||s.startsWith('#'))return u;
    if(s.startsWith('//'))return __PFX+encodeURIComponent('https:'+s);
    if(/^https?:\\/\\//i.test(s))return __PFX+encodeURIComponent(s);
    if(s.startsWith('/'))return __PFX+encodeURIComponent(__OR+s);
    try{return __PFX+encodeURIComponent(new URL(s,__TG).href);}catch(e){return u;}
  }
  try{var _f=window.fetch;if(_f)window.fetch=function(i,o){try{i=typeof i==='string'?_p(i):i;}catch(e){}return _f.call(this,i,o)};}catch(e){}
  try{var _x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){var a=[].slice.call(arguments);try{a[1]=_p(u);}catch(e){}return _x.apply(this,a)};}catch(e){}
})();
`;
}

module.exports = { handleFetch };
