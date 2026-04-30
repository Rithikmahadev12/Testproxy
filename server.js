"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — server.js  v3
// ══════════════════════════════════════

const http = require("http");
const net  = require("net");
const url  = require("url");

const { handleFetch } = require("./src/proxyHandler");
const { serveStatic } = require("./src/staticHandler");
const { isBlocked }   = require("./src/blocklist");

const PORT = Number(process.env.PORT) || 3000;

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const pathname = url.parse(req.url || "").pathname || "/";

  // Global CORS for every response
  res.setHeader("Access-Control-Allow-Origin",      "*");
  res.setHeader("Access-Control-Allow-Methods",     "GET,POST,PUT,DELETE,PATCH,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers",     "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Expose-Headers",    "*");

  // Pre-flight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", name: "Matriarchs OS", version: "3.0.0", ts: Date.now() }));
    return;
  }

  // Main proxy endpoint
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

  // Static files
  serveStatic(req, res);
});

// ── CONNECT tunnel (HTTPS pass-through) ───────────────────────────────────────
server.on("connect", (req, clientSocket, head) => {
  const [hostname, portStr] = (req.url || "").split(":");
  const port = parseInt(portStr, 10) || 443;

  if (isBlocked(hostname)) {
    clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const remote = net.connect(port, hostname, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-agent: MOS/3\r\n\r\n");
    if (head && head.length) remote.write(head);
    remote.pipe(clientSocket);
    clientSocket.pipe(remote);
  });

  const cleanup = (label) => (err) => {
    if (err) console.error(`[CONNECT] ${label} err → ${hostname}:${port} — ${(err.message||err)}`);
    if (!clientSocket.destroyed) clientSocket.destroy();
    if (!remote.destroyed)       remote.destroy();
  };

  remote.on("error",       cleanup("remote"));
  clientSocket.on("error", cleanup("client"));
  remote.on("close",       cleanup("remote-close"));
  clientSocket.on("close", cleanup("client-close"));
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[MOS] Matriarchs OS v3 running on port ${PORT}`);
  console.log(`[MOS] Proxy → /fetch?url=<encoded-url>`);
});

server.on("error", (err) => {
  console.error("[MOS] Fatal server error:", err.message);
  process.exit(1);
});

// Prevent uncaught errors from crashing the server
process.on("uncaughtException",  (e) => console.error("[MOS] uncaughtException:", e.message));
process.on("unhandledRejection", (e) => console.error("[MOS] unhandledRejection:", e));
