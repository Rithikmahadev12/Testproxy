"use strict";

const fs   = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".txt":  "text/plain; charset=utf-8",
  ".map":  "application/json",
};

function serveStatic(req, res) {
  const rawPath  = (req.url || "/").split("?")[0];
  const safePath = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath === "/" ? "index.html" : safePath);
  const ext      = path.extname(filePath).toLowerCase();

  fs.stat(filePath, (err, stat) => {
    if (err || !stat || !stat.isFile()) {
      // SPA fallback → index.html
      const idx = path.join(PUBLIC_DIR, "index.html");
      fs.stat(idx, (e2) => {
        if (e2) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("404 Not Found"); return; }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        fs.createReadStream(idx).pipe(res);
      });
      return;
    }

    const mime = MIME[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type":  mime,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
      "Content-Length": stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

module.exports = { serveStatic };
