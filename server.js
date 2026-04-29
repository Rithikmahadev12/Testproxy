"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — server.js
//  Entry point — HTTP + CONNECT tunnel
// ══════════════════════════════════════

const http = require("http");
const net  = require("net");
const url  = require("url");

const { handleFetch }  = require("./src/proxyHandler");
const { serveStatic }  = require("./src/staticHandler");
const { isBlocked }    = require("./src/blocklist");

const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════
//  HTTP SERVER
// ══════════════════════════════════════

const server = http.createServer(async (req, res) => {
  const pathname = url.parse(req.url).pathname;

  // ── CORS preflight ─────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin",  "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS,HEAD");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Health check ────────────────────────────────────────────────────────────
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", name: "Matriarchs OS", version: "1.0.0" }));
    return;
  }

  // ── Proxy endpoint ──────────────────────────────────────────────────────────
  if (pathname === "/fetch") {
    try {
      await handleFetch(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal proxy error", message: err.message }));
      }
    }
    return;
  }

  // ── Static files ────────────────────────────────────────────────────────────
  serveStatic(req, res);
});

// ══════════════════════════════════════
//  HTTP CONNECT TUNNEL
//  Allows HTTPS passthrough for direct proxy usage
// ══════════════════════════════════════

server.on("connect", (req, clientSocket, head) => {
  const [hostname, portStr] = req.url.split(":");
  const port = parseInt(portStr, 10) || 443;

  if (isBlocked(hostname)) {
    clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const remote = net.connect(port, hostname, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) remote.write(head);
    remote.pipe(clientSocket);
    clientSocket.pipe(remote);
  });

  remote.on("error", (err) => {
    console.error(`[CONNECT] tunnel error → ${hostname}:${port} — ${err.message}`);
    if (!clientSocket.destroyed) {
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      clientSocket.destroy();
    }
  });

  clientSocket.on("error", () => { if (!remote.destroyed) remote.destroy(); });
  remote.on("close",       () => { if (!clientSocket.destroyed) clientSocket.destroy(); });
  clientSocket.on("close", () => { if (!remote.destroyed) remote.destroy(); });
});

// ══════════════════════════════════════
//  START
// ══════════════════════════════════════

server.listen(PORT, () => {
  console.log(`[Matriarchs OS] Server running on port ${PORT}`);
  console.log(`[Matriarchs OS] Proxy endpoint → /fetch?url=<encoded-url>`);
});

server.on("error", (err) => {
  console.error("[Matriarchs OS] Server error:", err.message);
  process.exit(1);
});
