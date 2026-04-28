const http = require("http");
const net = require("net");
const url = require("url");

const PORT = 65432;

// =====================
// FORCE NODE TO IGNORE SYSTEM PROXY
// =====================
process.env.HTTP_PROXY = "";
process.env.HTTPS_PROXY = "";

// =====================
// HTTP HANDLER
// =====================
const server = http.createServer((req, res) => {
  try {
    const parsed = url.parse(
      req.url.startsWith("http")
        ? req.url
        : `http://${req.headers.host}${req.url}`
    );

    // 🛑 LOOP PROTECTION (critical)
    if (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1"
    ) {
      if (parsed.port == PORT || !parsed.port) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        return res.end("Proxy loop detected (blocked)");
      }
    }

    console.log(`[HTTP] ${req.method} ${parsed.href}`);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.path,
      method: req.method,
      headers: { ...req.headers },
    };

    // Clean headers that break proxies
    delete options.headers["proxy-connection"];
    delete options.headers["proxy-authorization"];

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    req.pipe(proxyReq);

    proxyReq.on("error", (err) => {
      console.error("[HTTP ERROR]", err.message);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Proxy error: " + (err.message || err.toString()));
    });

  } catch (err) {
    console.error("[FATAL ERROR]", err);
    res.writeHead(500);
    res.end("Fatal proxy error");
  }
});

// =====================
// HTTPS (CONNECT)
// =====================
server.on("connect", (req, clientSocket, head) => {
  try {
    const [host, port] = req.url.split(":");

    // 🛑 LOOP PROTECTION (HTTPS)
    if (
      host === "localhost" ||
      host === "127.0.0.1"
    ) {
      if (port == PORT || !port) {
        clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }
    }

    console.log(`[HTTPS] CONNECT ${host}:${port}`);

    const serverSocket = net.connect(port || 443, host, () => {
      clientSocket.write(
        "HTTP/1.1 200 Connection Established\r\n\r\n"
      );

      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on("error", (err) => {
      console.error("[HTTPS ERROR]", err.message);
      clientSocket.end();
    });

  } catch (err) {
    console.error("[CONNECT FATAL ERROR]", err);
    clientSocket.end();
  }
});

// =====================
// START SERVER
// =====================
server.listen(PORT, () => {
  console.log(`\n✅ Proxy running at http://localhost:${PORT}`);
  console.log("👉 DO NOT open http://localhost:65432 in browser");
  console.log("👉 Use it as a proxy instead\n");
});
