"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — src/proxyHandler.js
//  Handles GET /fetch?url= requests
// ══════════════════════════════════════

const http    = require("http");
const https   = require("https");
const url     = require("url");

const { isBlocked, cleanResponseHeaders, buildRequestHeaders } = require("./blocklist");
const { rewriteHtml, rewriteCss, injectHelpers }               = require("./rewriter");
const { decompress, collectBuffer }                            = require("./decompress");

// Max redirects to follow before giving up
const MAX_REDIRECTS = 8;
// Request timeout in ms
const TIMEOUT_MS    = 20_000;

/**
 * Sets standard CORS headers so the browser iframe can load the response.
 */
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin",   "*");
  res.setHeader("Access-Control-Allow-Methods",  "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers",  "*");
  res.setHeader("Access-Control-Expose-Headers", "*");
}

/**
 * Determine the "proxy base" URL (scheme + host) from an incoming request.
 * Used to build rewritten URLs like https://myapp.onrender.com/fetch?url=...
 */
function getProxyBase(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers["host"] || "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * Parse and validate the target URL from the query string.
 * Returns a URL object or null on failure.
 */
function parseTargetUrl(rawParam) {
  if (!rawParam) return null;
  let decoded;
  try { decoded = decodeURIComponent(rawParam); } catch { decoded = rawParam; }

  // Try as-is first
  try { return new URL(decoded); } catch { /* fall through */ }

  // Try prepending https://
  try { return new URL("https://" + decoded); } catch { /* fall through */ }

  return null;
}

/**
 * Collect the request body (for POST/PUT etc.)
 */
function collectRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data",  c => chunks.push(c));
    req.on("end",   ()  => resolve(chunks.length ? Buffer.concat(chunks) : null));
    req.on("error", ()  => resolve(null));
  });
}

/**
 * Main proxy fetch handler.
 * Called by server.js for GET/POST /fetch?url= requests.
 */
async function handleFetch(req, res) {
  setCORS(res);

  // Parse query
  const parsed    = url.parse(req.url, true);
  const rawTarget = parsed.query.url;
  const noRewrite = parsed.query.rewrite === "false";

  // Validate URL
  const targetUrl = parseTargetUrl(rawTarget);
  if (!targetUrl) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing or invalid url parameter" }));
    return;
  }

  // Block check
  if (isBlocked(targetUrl.hostname)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Host blocked by Matriarchs OS policy" }));
    return;
  }

  const proxyBase  = getProxyBase(req);
  const requestBody = await collectRequestBody(req);

  try {
    await fetchAndRespond({
      req,
      res,
      targetUrl,
      proxyBase,
      noRewrite,
      requestBody,
      redirectCount: 0,
    });
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Proxy error", message: err.message }));
    }
  }
}

/**
 * Internal: fire the upstream request, handle redirects, decompress, rewrite.
 */
async function fetchAndRespond({ req, res, targetUrl, proxyBase, noRewrite, requestBody, redirectCount }) {
  if (redirectCount > MAX_REDIRECTS) {
    res.writeHead(310, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too many redirects" }));
    return;
  }

  const lib        = targetUrl.protocol === "https:" ? https : http;
  const isHttps    = targetUrl.protocol === "https:";
  const targetOrigin = targetUrl.origin;

  const outHeaders = buildRequestHeaders(req.headers, {
    "Host":    targetUrl.hostname,
    "Referer": targetOrigin + "/",
    "Origin":  targetOrigin,
    ...(requestBody
      ? {
          "Content-Length": String(requestBody.length),
          "Content-Type":   req.headers["content-type"] || "application/octet-stream",
        }
      : {}),
  });

  const options = {
    hostname: targetUrl.hostname,
    port:     targetUrl.port || (isHttps ? 443 : 80),
    path:     targetUrl.pathname + targetUrl.search,
    method:   req.method === "HEAD" ? "HEAD" : req.method,
    headers:  outHeaders,
    timeout:  TIMEOUT_MS,
  };

  return new Promise((resolve, reject) => {
    const proxyReq = lib.request(options, async (proxyRes) => {
      try {
        // ── Redirect handling ────────────────────────────────────────────────
        if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
          const location = proxyRes.headers["location"];
          if (location) {
            let redirectTarget;
            try {
              redirectTarget = new URL(location, targetUrl.href);
            } catch {
              // bad location header — just 502
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Bad redirect location" }));
              return resolve();
            }

            // Consume response body to free socket
            proxyRes.resume();

            // If blocked destination, stop
            if (isBlocked(redirectTarget.hostname)) {
              res.writeHead(403, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Redirect target blocked" }));
              return resolve();
            }

            setCORS(res);
            return resolve(
              fetchAndRespond({
                req, res,
                targetUrl:    redirectTarget,
                proxyBase,
                noRewrite,
                requestBody:  null, // GET redirects don't resend body
                redirectCount: redirectCount + 1,
              })
            );
          }
        }

        const contentType = (proxyRes.headers["content-type"] || "").toLowerCase();
        const encoding    = proxyRes.headers["content-encoding"] || "";
        const isHtml      = contentType.includes("html");
        const isCss       = contentType.includes("css");
        const isJs        = contentType.includes("javascript") || contentType.includes("ecmascript");
        const shouldRewrite = !noRewrite && (isHtml || isCss || isJs);

        const cleanedHeaders = cleanResponseHeaders(proxyRes.headers);
        setCORS(res);

        // ── Pass-through (binary, images, fonts, etc.) ───────────────────────
        if (!shouldRewrite) {
          res.writeHead(proxyRes.statusCode, cleanedHeaders);
          proxyRes.pipe(res);
          proxyRes.on("end", resolve);
          proxyRes.on("error", reject);
          return;
        }

        // ── Text rewriting ───────────────────────────────────────────────────
        delete cleanedHeaders["content-encoding"];  // we'll decompress
        delete cleanedHeaders["content-length"];    // length changes after rewrite

        const decompressed = decompress(proxyRes, encoding);
        let bodyBuffer;
        try {
          bodyBuffer = await collectBuffer(decompressed);
        } catch (e) {
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Decompression failed" }));
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
        // JS: minimal rewrite — let runtime interception (injected script) handle it

        res.writeHead(proxyRes.statusCode, {
          ...cleanedHeaders,
          "Content-Type":   contentType,
          "Content-Length": Buffer.byteLength(bodyText, "utf8"),
        });
        res.end(bodyText);
        resolve();

      } catch (innerErr) {
        reject(innerErr);
      }
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy(new Error("Upstream request timed out"));
    });

    proxyReq.on("error", reject);

    if (requestBody) proxyReq.write(requestBody);
    proxyReq.end();
  });
}

module.exports = { handleFetch };
