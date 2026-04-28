const http = require("http");
const net = require("net");
const url = require("url");

const PORT = 65432;

process.env.HTTP_PROXY = "";
process.env.HTTPS_PROXY = "";

// =====================
// UI PAGE
// =====================
function renderHome(res) {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`
    <html>
      <head><title>Proxy UI</title></head>
      <body style="font-family: Arial; padding: 40px;">
        <h1>🚀 Local Proxy</h1>
        <form method="GET" action="/go">
          <input name="url" style="width:400px;padding:10px;" placeholder="http://example.com"/>
          <button type="submit">Go</button>
        </form>
      </body>
    </html>
  `);
}

// =====================
// REWRITE LINKS (basic)
// =====================
function rewriteHTML(html, baseUrl) {
  return html
    .replace(/href="\/(.*?)"/g, `href="${baseUrl}/$1"`)
    .replace(/src="\/(.*?)"/g, `src="${baseUrl}/$1`);
}

// =====================
// HTTP HANDLER
// =====================
const server = http.createServer((req, res) => {
  try {
    const parsed = url.parse(req.url, true);

    // 🟢 Home UI
    if (parsed.pathname === "/") {
      return renderHome(res);
    }

    // 🟢 Proxy via UI
    if (parsed.pathname === "/go") {
      let target = parsed.query.url;

      if (!target) {
        return renderHome(res);
      }

      if (!target.startsWith("http")) {
        target = "http://" + target;
      }

      const targetUrl = url.parse(target);

      console.log(`[UI FETCH] ${target}`);

      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || 80,
        path: targetUrl.path,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      };

      const proxyReq = http.request(options, (proxyRes) => {
        let data = [];

        proxyRes.on("data", (chunk) => data.push(chunk));

        proxyRes.on("end", () => {
          let body = Buffer.concat(data);

          const contentType = proxyRes.headers["content-type"] || "";

          // Only rewrite HTML
          if (contentType.includes("text/html")) {
            let html = body.toString();
            html = rewriteHTML(html, targetUrl.protocol + "//" + targetUrl.host);

            res.writeHead(proxyRes.statusCode, {
              "Content-Type": "text/html",
            });
            return res.end(html);
          }

          // Otherwise return raw
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          res.end(body);
        });
      });

      proxyReq.on("error", (err) => {
        res.writeHead(500);
        res.end("Error: " + err.message);
      });

      proxyReq.end();
      return;
    }

    // =====================
    // NORMAL PROXY MODE
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

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    req.pipe(proxyReq);

    proxyReq.on("error", (err) => {
      res.writeHead(500);
      res.end("Proxy error: " + err.message);
    });

  } catch (err) {
    console.error(err);
    res.end("Fatal error");
  }
});

// =====================
// HTTPS SUPPORT
// =====================
server.on("connect", (req, clientSocket, head) => {
  const [host, port] = req.url.split(":");

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
  console.log(`✅ Proxy UI running at http://localhost:${PORT}`);
});
