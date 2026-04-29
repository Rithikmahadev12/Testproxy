"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — src/proxyHandler.js
//  Handles GET /fetch?url= requests
// ══════════════════════════════════════

const http  = require("http");
const https = require("https");
const url   = require("url");

const { isBlocked, cleanResponseHeaders, buildRequestHeaders } = require("./blocklist");
const { rewriteHtml, rewriteCss, injectHelpers }               = require("./rewriter");
const { decompress, collectBuffer }                            = require("./decompress");

const MAX_REDIRECTS = 10;
const TIMEOUT_MS    = 25_000;

// Keep-alive agents for connection reuse
const httpAgent  = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  rejectUnauthorized: false, // allow self-signed certs on proxied sites
});

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin",   "*");
  res.setHeader("Access-Control-Allow-Methods",  "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers",  "*");
  res.setHeader("Access-Control-Expose-Headers", "*");
}

function getProxyBase(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers["host"] || "localhost:3000";
  return `${proto}://${host}`;
}

function parseTargetUrl(rawParam) {
  if (!rawParam) return null;
  let decoded;
  try { decoded = decodeURIComponent(rawParam); } catch { decoded = rawParam; }
  try { return new URL(decoded); } catch {}
  try { return new URL("https://" + decoded); } catch {}
  return null;
}

function collectRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data",  c => chunks.push(c));
    req.on("end",   ()  => resolve(chunks.length ? Buffer.concat(chunks) : null));
    req.on("error", ()  => resolve(null));
  });
}

async function handleFetch(req, res) {
  setCORS(res);

  const parsed    = url.parse(req.url, true);
  const rawTarget = parsed.query.url;
  const noRewrite = parsed.query.rewrite === "false";

  const targetUrl = parseTargetUrl(rawTarget);
  if (!targetUrl) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing or invalid url parameter" }));
    return;
  }

  if (isBlocked(targetUrl.hostname)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Host blocked by Matriarchs OS policy" }));
    return;
  }

  const proxyBase   = getProxyBase(req);
  const requestBody = await collectRequestBody(req);

  try {
    await fetchAndRespond({ req, res, targetUrl, proxyBase, noRewrite, requestBody, redirectCount: 0 });
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Proxy error", message: err.message }));
    }
  }
}

async function fetchAndRespond({ req, res, targetUrl, proxyBase, noRewrite, requestBody, redirectCount }) {
  if (redirectCount > MAX_REDIRECTS) {
    res.writeHead(310, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too many redirects" }));
    return;
  }

  const isHttps      = targetUrl.protocol === "https:";
  const lib          = isHttps ? https : http;
  const agent        = isHttps ? httpsAgent : httpAgent;
  const targetOrigin = targetUrl.origin;

  // Build realistic browser headers
  const outHeaders = buildRequestHeaders(req.headers, {
    "Host":             targetUrl.hostname,
    "Referer":          targetOrigin + "/",
    "Origin":           targetOrigin,
    "Accept":           req.headers["accept"] || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language":  "en-US,en;q=0.9",
    ...(requestBody ? {
      "Content-Length": String(requestBody.length),
      "Content-Type":   req.headers["content-type"] || "application/octet-stream",
    } : {}),
  });

  // Pass cookies through if present
  if (req.headers["cookie"]) {
    outHeaders["Cookie"] = req.headers["cookie"];
  }

  const options = {
    hostname: targetUrl.hostname,
    port:     targetUrl.port || (isHttps ? 443 : 80),
    path:     (targetUrl.pathname || "/") + (targetUrl.search || ""),
    method:   req.method === "HEAD" ? "HEAD" : req.method,
    headers:  outHeaders,
    timeout:  TIMEOUT_MS,
    agent,
  };

  return new Promise((resolve, reject) => {
    const proxyReq = lib.request(options, async (proxyRes) => {
      try {
        // ── Redirects ──────────────────────────────────────────────────────
        if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
          const location = proxyRes.headers["location"];
          proxyRes.resume();
          if (!location) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Empty redirect location" }));
            return resolve();
          }
          let redirectTarget;
          try { redirectTarget = new URL(location, targetUrl.href); }
          catch {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Bad redirect location" }));
            return resolve();
          }
          if (isBlocked(redirectTarget.hostname)) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Redirect target blocked" }));
            return resolve();
          }
          setCORS(res);
          return resolve(fetchAndRespond({
            req, res,
            targetUrl:     redirectTarget,
            proxyBase,
            noRewrite,
            requestBody:   null,
            redirectCount: redirectCount + 1,
          }));
        }

        const contentType = (proxyRes.headers["content-type"] || "").toLowerCase();
        const encoding    = proxyRes.headers["content-encoding"] || "";
        const isHtml      = contentType.includes("text/html");
        const isCss       = contentType.includes("text/css");
        const isJs        = contentType.includes("javascript") || contentType.includes("ecmascript");
        const isJson      = contentType.includes("application/json");

        // Only rewrite HTML and CSS — JS rewriting via injected runtime is safer
        const shouldRewrite = !noRewrite && (isHtml || isCss);

        const cleanedHeaders = cleanResponseHeaders(proxyRes.headers);

        // Forward Set-Cookie headers (rewrite domain)
        if (proxyRes.headers["set-cookie"]) {
          const cookies = proxyRes.headers["set-cookie"].map(c =>
            c.replace(/;\s*domain=[^;]*/gi, "")
             .replace(/;\s*secure/gi, "")
             .replace(/;\s*samesite=[^;]*/gi, "")
          );
          cleanedHeaders["set-cookie"] = cookies;
        }

        setCORS(res);

        // ── Pass-through (images, fonts, binary, JSON, JS, etc.) ──────────
        if (!shouldRewrite) {
          res.writeHead(proxyRes.statusCode, cleanedHeaders);
          proxyRes.pipe(res);
          proxyRes.on("end",   resolve);
          proxyRes.on("error", reject);
          return;
        }

        // ── Text rewriting (HTML, CSS) ─────────────────────────────────────
        delete cleanedHeaders["content-encoding"];
        delete cleanedHeaders["content-length"];
        delete cleanedHeaders["transfer-encoding"];

        const decompressed = decompress(proxyRes, encoding);
        let bodyBuffer;
        try {
          bodyBuffer = await collectBuffer(decompressed);
        } catch (e) {
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Decompression failed", message: e.message }));
          }
          return resolve();
        }

        let bodyText = bodyBuffer.toString("utf8");

        if (isHtml) {
          bodyText = rewriteHtml(bodyText, targetUrl.href, proxyBase);
          bodyText = injectHelpers(bodyText, targetUrl.href, proxyBase);
        } else if (isCss) {
          bodyText = rewriteCss(bodyText, targetUrl.href, proxyBase);
        }

        const outBuf = Buffer.from(bodyText, "utf8");
        res.writeHead(proxyRes.statusCode, {
          ...cleanedHeaders,
          "Content-Type":   contentType,
          "Content-Length": outBuf.length,
        });
        res.end(outBuf);
        resolve();

      } catch (innerErr) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal rewrite error", message: innerErr.message }));
        }
        resolve();
      }
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy(new Error("Upstream request timed out after " + TIMEOUT_MS + "ms"));
    });

    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        setCORS(res);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Upstream connection failed", message: err.message }));
      }
      resolve();
    });

    if (requestBody) proxyReq.write(requestBody);
    proxyReq.end();
  });
}

module.exports = { handleFetch };
