const http = require("http");
const net = require("net");
const url = require("url");

const PORT = 65432;

// Handle normal HTTP requests
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || 80,
    path: parsed.path,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  req.pipe(proxyReq);

  proxyReq.on("error", (err) => {
    res.writeHead(500);
    res.end("Proxy error: " + err.message);
  });
});

// Handle HTTPS (CONNECT method)
server.on("connect", (req, clientSocket, head) => {
  const [host, port] = req.url.split(":");

  const serverSocket = net.connect(port || 443, host, () => {
    clientSocket.write(
      "HTTP/1.1 200 Connection Established\r\n\r\n"
    );
    serverSocket.write(head);

    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on("error", () => {
    clientSocket.end();
  });
});

server.listen(PORT, () => {
  console.log(`Proxy running on http://localhost:${PORT}`);
});
