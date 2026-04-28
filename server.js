"use strict";

// ══════════════════════════════════════
//  MATRIARCHS PROXY SERVER
//  Node.js — Deployable to Render
//  Web Proxy + HTTP Tunnel + SOCKS5
// ══════════════════════════════════════

const http        = require("http");
const https       = require("https");
const net         = require("net");
const url         = require("url");
const path        = require("path");
const fs          = require("fs");
const zlib        = require("zlib");

const PORT        = process.env.PORT || 3000;
const PROXY_KEY   = process.env.PROXY_KEY || "matriarchs";  // Secret key for auth
const SOCKS_PORT  = process.env.SOCKS_PORT || 1080;

// ── Blocked hosts (basic filter) ──────────────────────────────────────────────
const BLOCKED = [
  /malware/i, /phishing/i,
];
function isBlocked(host) {
  return BLOCKED.some(r => r.test(host));
}

// ── CORS headers ──────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers","*");
}

// ── Strip security headers that break embedding ───────────────────────────────
const STRIP_HEADERS = [
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
];

function cleanHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!STRIP_HEADERS.includes(k.toLowerCase())) {
      out[k] = v;
    }
  }
  return out;
}

// ── Rewrite URLs in HTML/CSS/JS to route through proxy ───────────────────────
function rewriteBody(body, baseUrl, proxyBase) {
  const base = new URL(baseUrl);
  const origin = base.origin;
  const proxyPrefix = `${proxyBase}/fetch?url=`;

  // Rewrite absolute URLs
  body = body.replace(
    /(href|src|action|data-src|srcset)=["'](?!data:|javascript:|#|mailto:)(https?:\/\/[^"'>\s]+)["']/gi,
    (m, attr, u) => `${attr}="${proxyPrefix}${encodeURIComponent(u)}"`
  );

  // Rewrite root-relative URLs
  body = body.replace(
    /(href|src|action|data-src)=["'](\/[^"'>\s][^"'>]*)["']/gi,
    (m, attr, u) => `${attr}="${proxyPrefix}${encodeURIComponent(origin + u)}"`
  );

  // Rewrite CSS url()
  body = body.replace(
    /url\(["']?(https?:\/\/[^"')]+)["']?\)/gi,
    (m, u) => `url("${proxyPrefix}${encodeURIComponent(u)}")`
  );

  // Rewrite fetch/XHR calls (best-effort)
  body = body.replace(
    /fetch\(["'](https?:\/\/[^"']+)["']/gi,
    (m, u) => `fetch("${proxyPrefix}${encodeURIComponent(u)}"`
  );

  return body;
}

// ══════════════════════════════════════
//  HTTP SERVER (Web Proxy + Static)
// ══════════════════════════════════════

const server = http.createServer((req, res) => {
  const parsedReq = url.parse(req.url, true);
  const pathname  = parsedReq.pathname;

  // ── OPTIONS preflight ──────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    setCORS(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // ── /health ────────────────────────────────────────────────────────────────
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: "1.0.0", name: "Matriarchs Proxy" }));
    return;
  }

  // ── /fetch?url= (Web Proxy endpoint) ──────────────────────────────────────
  if (pathname === "/fetch") {
    const target = parsedReq.query.url;
    const rewrite = parsedReq.query.rewrite !== "false";

    if (!target) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing url parameter" }));
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(decodeURIComponent(target));
    } catch (e) {
      // Try adding https://
      try {
        targetUrl = new URL("https://" + decodeURIComponent(target));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid URL" }));
        return;
      }
    }

    if (isBlocked(targetUrl.hostname)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Blocked" }));
      return;
    }

    const lib = targetUrl.protocol === "https:" ? https : http;
    const proxyBase = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;

    // Forward request body for POST etc
    let bodyChunks = [];
    req.on("data", c => bodyChunks.push(c));
    req.on("end", () => {
      const body = bodyChunks.length ? Buffer.concat(bodyChunks) : null;

      const options = {
        hostname: targetUrl.hostname,
        port:     targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
        path:     targetUrl.pathname + targetUrl.search,
        method:   req.method,
        headers: {
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept":          req.headers["accept"] || "*/*",
          "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Referer":         targetUrl.origin,
          "Origin":          targetUrl.origin,
          ...(body ? { "Content-Length": body.length, "Content-Type": req.headers["content-type"] || "application/octet-stream" } : {}),
        },
        timeout: 20000,
      };

      const proxyReq = lib.request(options, (proxyRes) => {
        // Handle redirects
        if ([301,302,303,307,308].includes(proxyRes.statusCode)) {
          const loc = proxyRes.headers["location"];
          if (loc) {
            const redirectUrl = loc.startsWith("http") ? loc : targetUrl.origin + loc;
            setCORS(res);
            res.writeHead(302, { "Location": `/fetch?url=${encodeURIComponent(redirectUrl)}` });
            res.end();
            return;
          }
        }

        const contentType = proxyRes.headers["content-type"] || "";
        const isHtml = contentType.includes("html");
        const isCss  = contentType.includes("css");
        const isJs   = contentType.includes("javascript");
        const shouldRewrite = rewrite && (isHtml || isCss || isJs);

        const respHeaders = cleanHeaders(proxyRes.headers);
        setCORS(res);

        if (!shouldRewrite) {
          res.writeHead(proxyRes.statusCode, respHeaders);
          proxyRes.pipe(res);
          return;
        }

        // Decompress for rewriting
        let stream = proxyRes;
        const encoding = proxyRes.headers["content-encoding"];
        if (encoding === "gzip") {
          stream = proxyRes.pipe(zlib.createGunzip());
        } else if (encoding === "br") {
          stream = proxyRes.pipe(zlib.createBrotliDecompress());
        } else if (encoding === "deflate") {
          stream = proxyRes.pipe(zlib.createInflate());
        }

        delete respHeaders["content-encoding"];
        delete respHeaders["content-length"];

        const chunks = [];
        stream.on("data", c => chunks.push(c));
        stream.on("end", () => {
          let text = Buffer.concat(chunks).toString("utf8");
          if (shouldRewrite) text = rewriteBody(text, targetUrl.href, proxyBase);

          // Inject base tag for HTML
          if (isHtml) {
            const baseTag = `<base href="${targetUrl.origin}/">`;
            text = text.replace(/<head[^>]*>/i, m => m + baseTag);

            // Inject proxy helper script
            const helperScript = `<script>
(function(){
  var _pBase = "${proxyBase}/fetch?url=";
  var _orig = window.fetch;
  window.fetch = function(input, init) {
    try {
      var u = (typeof input === "string") ? input : input.url;
      if (u && u.startsWith("http") && !u.startsWith(location.origin)) {
        if (typeof input === "string") input = _pBase + encodeURIComponent(input);
        else input = new Request(_pBase + encodeURIComponent(input.url), input);
      }
    } catch(e) {}
    return _orig.apply(this, [input, init]);
  };
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    try {
      if (url && url.startsWith("http") && !url.startsWith(location.origin)) {
        url = _pBase + encodeURIComponent(url);
      }
    } catch(e) {}
    return _xhrOpen.apply(this, arguments);
  };
  // Handle navigation clicks
  document.addEventListener("click", function(e) {
    var a = e.target.closest("a");
    if (!a || !a.href) return;
    if (a.href.startsWith(_pBase)) return;
    if (a.href.startsWith("javascript:") || a.href.startsWith("mailto:") || a.href.startsWith("#")) return;
    if (a.href.startsWith("http")) {
      e.preventDefault();
      window.parent.postMessage({ type: "mos-navigate-proxy", url: a.href }, "*");
      window.location.href = _pBase + encodeURIComponent(a.href);
    }
  }, true);
})();
</script>`;
            text = text.replace("</head>", helperScript + "</head>");
          }

          res.writeHead(proxyRes.statusCode, { ...respHeaders, "Content-Type": contentType });
          res.end(text);
        });
        stream.on("error", () => {
          if (!res.headersSent) res.writeHead(502);
          res.end("Stream error");
        });
      });

      proxyReq.on("error", (err) => {
        setCORS(res);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Upstream error", message: err.message }));
      });

      proxyReq.on("timeout", () => {
        proxyReq.destroy();
        setCORS(res);
        res.writeHead(504, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Gateway timeout" }));
      });

      if (body) proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // ── Static files (serves /public) ─────────────────────────────────────────
  let filePath = path.join(__dirname, "public", pathname === "/" ? "index.html" : pathname);
  const ext = path.extname(filePath);
  const mimeTypes = {
    ".html": "text/html",
    ".css":  "text/css",
    ".js":   "application/javascript",
    ".json": "application/json",
    ".png":  "image/png",
    ".ico":  "image/x-icon",
    ".webp": "image/webp",
    ".svg":  "image/svg+xml",
    ".woff2":"font/woff2",
  };

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // Fallback to index.html for SPA routing
      filePath = path.join(__dirname, "public", "index.html");
      fs.stat(filePath, (e2) => {
        if (e2) {
          res.writeHead(404);
          res.end("Not found");
        } else {
          res.writeHead(200, { "Content-Type": "text/html" });
          fs.createReadStream(filePath).pipe(res);
        }
      });
      return;
    }
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
});

// ══════════════════════════════════════
//  HTTP CONNECT TUNNEL (HTTPS Proxy)
//  Used when browser sends CONNECT host:port
// ══════════════════════════════════════

server.on("connect", (req, clientSocket, head) => {
  const [hostname, portStr] = req.url.split(":");
  const port = parseInt(portStr) || 443;

  if (isBlocked(hostname)) {
    clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const serverSocket = net.connect(port, hostname, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on("error", () => {
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.destroy();
  });

  clientSocket.on("error", () => serverSocket.destroy());
});

server.listen(PORT, () => {
  console.log(`[Matriarchs Proxy] HTTP server listening on port ${PORT}`);
});

// ══════════════════════════════════════
//  SOCKS5 PROXY SERVER
// ══════════════════════════════════════

const SOCKS5_VERSION = 0x05;
const NO_AUTH        = 0x00;
const CMD_CONNECT    = 0x01;
const ATYP_IPV4     = 0x01;
const ATYP_DOMAIN   = 0x03;
const ATYP_IPV6     = 0x04;

const socks5Server = net.createServer((socket) => {
  socket.once("data", (data) => {
    // SOCKS5 greeting
    if (data[0] !== SOCKS5_VERSION) { socket.destroy(); return; }
    // Respond: version 5, no auth
    socket.write(Buffer.from([SOCKS5_VERSION, NO_AUTH]));

    socket.once("data", (req) => {
      if (req[0] !== SOCKS5_VERSION || req[1] !== CMD_CONNECT) {
        socket.write(Buffer.from([SOCKS5_VERSION, 0x07, 0x00, 0x01, 0,0,0,0, 0,0]));
        socket.destroy();
        return;
      }

      const atyp = req[3];
      let host, port, offset;

      if (atyp === ATYP_IPV4) {
        host   = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`;
        offset = 8;
      } else if (atyp === ATYP_DOMAIN) {
        const len = req[4];
        host   = req.slice(5, 5 + len).toString("utf8");
        offset = 5 + len;
      } else if (atyp === ATYP_IPV6) {
        const parts = [];
        for (let i = 0; i < 8; i++) parts.push(req.readUInt16BE(4 + i * 2).toString(16));
        host   = parts.join(":");
        offset = 20;
      } else {
        socket.destroy();
        return;
      }

      port = req.readUInt16BE(offset);

      if (isBlocked(host)) {
        socket.write(Buffer.from([SOCKS5_VERSION, 0x02, 0x00, 0x01, 0,0,0,0, 0,0]));
        socket.destroy();
        return;
      }

      const remote = net.connect(port, host, () => {
        // Success response
        const resp = Buffer.alloc(10);
        resp[0] = SOCKS5_VERSION;
        resp[1] = 0x00; // succeeded
        resp[2] = 0x00;
        resp[3] = ATYP_IPV4;
        const addr = remote.localAddress.split(".").map(Number);
        resp[4] = addr[0]; resp[5] = addr[1]; resp[6] = addr[2]; resp[7] = addr[3];
        resp.writeUInt16BE(remote.localPort, 8);
        socket.write(resp);
        remote.pipe(socket);
        socket.pipe(remote);
      });

      remote.on("error", () => {
        const resp = Buffer.from([SOCKS5_VERSION, 0x05, 0x00, 0x01, 0,0,0,0, 0,0]);
        socket.write(resp);
        socket.destroy();
      });

      socket.on("error", () => remote.destroy());
      socket.on("close", () => remote.destroy());
      remote.on("close", () => socket.destroy());
    });
  });

  socket.on("error", () => {});
});

socks5Server.listen(SOCKS_PORT, () => {
  console.log(`[Matriarchs Proxy] SOCKS5 server listening on port ${SOCKS_PORT}`);
});
