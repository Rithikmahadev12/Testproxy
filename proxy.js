const http = require("http");
const net = require("net");
const url = require("url");

const PORT = 65432;

// Ignore system proxy env
process.env.HTTP_PROXY = "";
process.env.HTTPS_PROXY = "";

// =====================
// SIMPLE UI PAGE
// =====================
function renderHome(res) {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`
    <html>
      <head>
        <title>Proxy UI</title>
      </head>
      <body style="font-family: Arial; padding: 40px;">
        <h1>🚀 Local Proxy</h1>
        <form method="GET" action="/go">
          <input 
            type="text" 
            name="url" 
            placeholder="Enter URL (http://example.com)" 
            style="width:400px; padding:10px;"
          />
          <button type="submit">Go</button>
        </form>
        <p>Example: http://example.com</p>
      </body>
    </html>
  `);
}

// =====================
// HTTP HANDLER
// =====================
const server = http.createServer((req, res) => {
  try {
    const parsed = url.parse(req.url, true);

    // 🟢 HOMEPAGE
    if (req.url === "/" || req.url === "/favicon.ico") {
      return renderHome(res);
    }

    // 🟢 FORM HANDLER
    if (parsed.pathname === "/go") {
      let target = parsed.query.url;

      if (!target.startsWith("http")) {
        target = "http://" + target;
      }

      res.writeHead(302, { Location: target });
      return res.end();
    }

    // =====================
    // NORMAL PROXY FLOW
    // =====================
    const fullUrl = req.url.startsWith("http")
      ? req.url
      : `http://${req.headers.host}${req.url}`;

    const target = url.parse(fullUrl);

    // 🛑 LOOP PROTECTION
    if (
      (target.hostname === "localhost" ||
        target.hostname === "127.0.0.1") &&
      target.port == PORT
    ) {
      res.writeHead(400);
      return res.end("Proxy loop detected");
    }

    console.log(`[HTTP] ${req.method} ${target.href}`);

    const options = {
      hostname: target.hostname,
      port: target.port || 80,
      path: target.path,
      method: req.method,
      headers: { ...req.headers },
    };

    delete options.headers["proxy-connection"];
    delete options.headers["proxy-authorization"];

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    req.pipe(proxyReq);

    proxyReq.on("error", (err) => {
      console.error("[HTTP ERROR]", err.message);
      res.writeHead(500);
      res.end("Proxy error: " + err.message);
    });

  } catch (err) {
    console.error("[FATAL]", err);
    res.end("Fatal error");
  }
});

// =====================
// HTTPS SUPPORT
// =====================
server.on("connect", (req, clientSocket, head) => {
  const [host, port] = req.url.split(":");

  // loop protection
  if (
    (host === "localhost" || host === "127.0.0.1") &&
    port == PORT
  ) {
    clientSocket.end();
    return;
  }

  console.log(`[HTTPS] CONNECT ${host}:${port}`);

  const serverSocket = net.connect(port || 443, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on("error", () => clientSocket.end());
});

// =====================
// START
// =====================
server.listen(PORT, () => {
  console.log(`✅ Proxy with UI running at http://localhost:${PORT}`);
});
