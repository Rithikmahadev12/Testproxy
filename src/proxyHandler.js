"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — proxyHandler.js  v3
//  Full-fidelity reverse proxy
// ══════════════════════════════════════

const http   = require("http");
const https  = require("https");
const url    = require("url");
const zlib   = require("zlib");
const stream = require("stream");

const { isBlocked, cleanResponseHeaders, buildRequestHeaders } = require("./blocklist");
const { rewriteHtml, rewriteCss, injectHelpers }               = require("./rewriter");

const MAX_REDIRECTS = 15;
const TIMEOUT_MS    = 30_000;
const MAX_BODY_SIZE = 50 * 1024 * 1024; // 50 MB cap

// ── Persistent connection pools ───────────────────────────────────────────────
const httpAgent  = new http.Agent({
  keepAlive:   true,
  maxSockets:  64,
  timeout:     TIMEOUT_MS,
});
const httpsAgent = new https.Agent({
  keepAlive:            true,
  maxSockets:           64,
  timeout:              TIMEOUT_MS,
  rejectUnauthorized:   false,   // self-signed certs on some sites
  checkServerIdentity: () => {}, // skip hostname check
});

// ── CORS headers ──────────────────────────────────────────────────────────────
function setCORS(res) {
  if (res.headersSent) return;
  res.setHeader("Access-Control-Allow-Origin",      "*");
  res.setHeader("Access-Control-Allow-Methods",     "GET,POST,PUT,DELETE,PATCH,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers",     "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Expose-Headers",    "*");
}

// ── Detect proxy base URL ─────────────────────────────────────────────────────
function getProxyBase(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"]  || req.headers["host"] || "localhost:3000";
  return `${proto}://${host}`;
}

// ── Parse & normalise the target URL ─────────────────────────────────────────
function parseTarget(rawParam) {
  if (!rawParam) return null;
  let s;
  try { s = decodeURIComponent(rawParam).trim(); }
  catch { s = rawParam.trim(); }
  if (!s) return null;
  // Already absolute
  try { const u = new URL(s); if (u.protocol === "http:" || u.protocol === "https:") return u; }
  catch {}
  // Try prepending https
  try { const u = new URL("https://" + s); return u; }
  catch {}
  return null;
}

// ── Collect request body ──────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => { total += c.length; if (total < MAX_BODY_SIZE) chunks.push(c); });
    req.on("end",  () => resolve(chunks.length ? Buffer.concat(chunks) : null));
    req.on("error",() => resolve(null));
  });
}

// ── Decompress a response stream ──────────────────────────────────────────────
function decompress(src, encoding) {
  const enc = (encoding || "").toLowerCase();
  if (enc === "gzip")              return src.pipe(zlib.createGunzip());
  if (enc === "br" || enc === "brotli") return src.pipe(zlib.createBrotliDecompress());
  if (enc === "deflate")           return src.pipe(zlib.createInflate());
  if (enc === "zstd") {
    // Node 21+ has zstd; fall back to pass-through on older versions
    if (zlib.createZstdDecompress) return src.pipe(zlib.createZstdDecompress());
  }
  return src; // identity / unknown → pass through
}

// ── Collect a readable stream into a Buffer ───────────────────────────────────
function toBuffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    readable.on("data",  (c) => { total += c.length; if (total < MAX_BODY_SIZE) chunks.push(c); });
    readable.on("end",   ()  => resolve(Buffer.concat(chunks)));
    readable.on("error", (e) => reject(e));
  });
}

// ── JSON error helper ─────────────────────────────────────────────────────────
function sendError(res, code, msg) {
  if (res.headersSent) return;
  setCORS(res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: msg }));
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN ENTRY
// ══════════════════════════════════════════════════════════════════════════════
async function handleFetch(req, res) {
  setCORS(res);

  const qs        = url.parse(req.url, true).query;
  const rawTarget = qs.url;
  const noRewrite = qs.rewrite === "false";

  const targetUrl = parseTarget(rawTarget);
  if (!targetUrl) return sendError(res, 400, "Missing or invalid ?url= parameter");

  if (isBlocked(targetUrl.hostname)) return sendError(res, 403, "Host is blocked by MOS policy");

  const proxyBase  = getProxyBase(req);
  const bodyBuf    = await readBody(req);

  try {
    await proxy({ req, res, targetUrl, proxyBase, noRewrite, bodyBuf, hops: 0 });
  } catch (err) {
    sendError(res, 502, "Proxy error: " + err.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  CORE PROXY LOOP
// ══════════════════════════════════════════════════════════════════════════════
async function proxy({ req, res, targetUrl, proxyBase, noRewrite, bodyBuf, hops }) {
  if (hops > MAX_REDIRECTS) return sendError(res, 310, "Too many redirects");

  const isHttps = targetUrl.protocol === "https:";
  const lib     = isHttps ? https : http;
  const agent   = isHttps ? httpsAgent : httpAgent;

  // Build outgoing headers — look like a real browser
  const outHeaders = buildRequestHeaders(req.headers, {
    "host":            targetUrl.host,
    "referer":         targetUrl.origin + "/",
    "origin":          targetUrl.origin,
    "accept":          req.headers["accept"] || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": req.headers["accept-language"] || "en-US,en;q=0.9",
    "accept-encoding": "gzip, deflate, br",
    "cache-control":   "no-cache",
    "pragma":          "no-cache",
    "upgrade-insecure-requests": "1",
    ...(bodyBuf ? {
      "content-length": String(bodyBuf.length),
      "content-type":   req.headers["content-type"] || "application/x-www-form-urlencoded",
    } : {}),
  });

  // Forward cookies
  if (req.headers["cookie"]) outHeaders["cookie"] = req.headers["cookie"];

  const options = {
    hostname: targetUrl.hostname,
    port:     targetUrl.port || (isHttps ? 443 : 80),
    path:     (targetUrl.pathname || "/") + (targetUrl.search || ""),
    method:   req.method || "GET",
    headers:  outHeaders,
    timeout:  TIMEOUT_MS,
    agent,
  };

  return new Promise((resolve) => {
    const preq = lib.request(options, async (pres) => {
      try {
        const status  = pres.statusCode;
        const pheads  = pres.headers;

        // ── HANDLE REDIRECTS ────────────────────────────────────────────────
        if (status >= 300 && status < 400 && pheads["location"]) {
          pres.resume(); // drain
          let loc;
          try { loc = new URL(pheads["location"], targetUrl.href); }
          catch { return sendError(res, 502, "Bad redirect location"); }

          if (isBlocked(loc.hostname)) return sendError(res, 403, "Redirect target blocked");

          setCORS(res);
          return resolve(
            proxy({ req, res, targetUrl: loc, proxyBase, noRewrite, bodyBuf: null, hops: hops + 1 })
          );
        }

        // ── CLASSIFY CONTENT ────────────────────────────────────────────────
        const rawCT   = pheads["content-type"] || "";
        const ct      = rawCT.toLowerCase();
        const enc     = (pheads["content-encoding"] || "").toLowerCase();

        const isHtml     = ct.includes("text/html");
        const isCss      = ct.includes("text/css");
        const isJs       = ct.includes("javascript") || ct.includes("ecmascript");
        const isJson     = ct.includes("application/json");
        const isSvg      = ct.includes("image/svg");
        const isText     = ct.startsWith("text/") && !isHtml && !isCss;
        const isBinary   = !isHtml && !isCss && !isJs && !isJson && !isSvg && !isText;

        const shouldRewrite = !noRewrite && (isHtml || isCss || isJs || isSvg);

        // Build clean response headers
        const cleanH = cleanResponseHeaders(pheads);

        // Rewrite Set-Cookie to work cross-origin
        if (pheads["set-cookie"]) {
          cleanH["set-cookie"] = (Array.isArray(pheads["set-cookie"]) ? pheads["set-cookie"] : [pheads["set-cookie"]]).map(c =>
            c
              .replace(/;\s*Domain=[^;]*/gi, "")
              .replace(/;\s*Secure/gi, "")
              .replace(/;\s*SameSite=[^;]*/gi, "; SameSite=None")
          );
        }

        setCORS(res);

        // ── BINARY PASS-THROUGH (images, fonts, video, etc.) ────────────────
        if (isBinary && !shouldRewrite) {
          const passH = {
            ...cleanH,
            "content-type": rawCT,
          };
          // Keep content-encoding for binary (we don't touch it)
          if (enc) passH["content-encoding"] = enc;

          res.writeHead(status, passH);
          pres.pipe(res);
          pres.on("end",   resolve);
          pres.on("error", resolve);
          return;
        }

        // ── TEXT / REWRITEABLE CONTENT ───────────────────────────────────────
        // Strip encoding headers — we decompress and re-serve uncompressed
        delete cleanH["content-encoding"];
        delete cleanH["content-length"];
        delete cleanH["transfer-encoding"];

        let bodyStream;
        try {
          bodyStream = decompress(pres, enc);
        } catch (e) {
          // Decompress unsupported — just use raw stream
          bodyStream = pres;
        }

        let bodyBuf2;
        try {
          bodyBuf2 = await toBuffer(bodyStream);
        } catch (e) {
          return sendError(res, 502, "Failed to read upstream body: " + e.message);
        }

        let body = bodyBuf2.toString("utf8");

        // ── REWRITE ──────────────────────────────────────────────────────────
        if (isHtml) {
          try { body = rewriteHtml(body, targetUrl.href, proxyBase); } catch (e) { /* non-fatal */ }
          try { body = injectHelpers(body, targetUrl.href, proxyBase); } catch (e) { /* non-fatal */ }
        } else if (isCss) {
          try { body = rewriteCss(body, targetUrl.href, proxyBase); } catch (e) { /* non-fatal */ }
        } else if (isJs) {
          try { body = buildJsShim(proxyBase, targetUrl.origin, targetUrl.href) + body; } catch (e) { /* non-fatal */ }
        } else if (isSvg) {
          try { body = rewriteHtml(body, targetUrl.href, proxyBase); } catch (e) { /* non-fatal */ }
        }

        const outBuf = Buffer.from(body, "utf8");
        res.writeHead(status, {
          ...cleanH,
          "content-type":   rawCT || "text/plain; charset=utf-8",
          "content-length": outBuf.length,
        });
        res.end(outBuf);
        resolve();

      } catch (innerErr) {
        sendError(res, 500, "Rewrite error: " + innerErr.message);
        resolve();
      }
    });

    preq.on("timeout", () => {
      preq.destroy(new Error("Upstream timed out"));
    });

    preq.on("error", (err) => {
      sendError(res, 502, "Upstream connection failed: " + err.message);
      resolve();
    });

    if (bodyBuf) preq.write(bodyBuf);
    preq.end();
  });
}

// ── Minimal JS shim injected at top of JS files ───────────────────────────────
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
