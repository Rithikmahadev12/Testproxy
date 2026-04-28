const http = require("http");
const net = require("net");
const url = require("url");

const PORT = 65432;

// =====================
// HTTP REQUEST HANDLER
// =====================
const server = http.createServer((req, res) => {
  try {
    // Fix URL parsing (important for browsers)
    const parsed = url.parse(
      req.url.startsWith("http")
        ? req.url
        : `http://${req.headers.host}${req.url}`
    );

    console.log(`[HTTP] ${req.method} ${parsed.href}`);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.path,
      method: req.method,
      headers: { ...req.headers },
    };

    // Clean problematic headers
    delete options.headers["proxy-connection"];
    delete options.headers["proxy-authorization"];

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    req.pipe(proxyReq);

    proxyReq.on("error", (err) => {
      console.error("[HTTP ERROR]", err);
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
// HTTPS (CONNECT TUNNEL)
// =====================
server.on("connect", (req, clientSocket, head) => {
  try {
    const [host, port] = req.url.split(":");

    console.log(`[HTTPS CONNECT] ${host}:${port}`);

    const serverSocket = net.connect(port || 443, host, () => {
      clientSocket.write(
        "HTTP/1.1 200 Connection Established\r\n\r\n"
      );

      // Pipe data both ways
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on("error", (err) => {
      console.error("[HTTPS ERROR]", err);
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
  console.log(`\n✅ Proxy running at http://localhost:${PORT}\n`);
});
