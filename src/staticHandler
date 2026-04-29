"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — src/staticHandler.js
//  Serves files from the /public folder
// ══════════════════════════════════════

const fs   = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

const MIME = {
  ".html":  "text/html; charset=utf-8",
  ".css":   "text/css; charset=utf-8",
  ".js":    "application/javascript; charset=utf-8",
  ".json":  "application/json",
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".jpeg":  "image/jpeg",
  ".webp":  "image/webp",
  ".svg":   "image/svg+xml",
  ".ico":   "image/x-icon",
  ".woff":  "font/woff",
  ".woff2": "font/woff2",
  ".ttf":   "font/ttf",
  ".txt":   "text/plain; charset=utf-8",
};

/**
 * Serve a static file from public/.
 * Falls back to index.html for SPA-style routing.
 */
function serveStatic(req, res) {
  const rawPath  = req.url.split("?")[0]; // strip query string
  const safePath = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  let   filePath = path.join(PUBLIC_DIR, safePath === "/" ? "index.html" : safePath);
  const ext      = path.extname(filePath).toLowerCase();

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback
      filePath = path.join(PUBLIC_DIR, "index.html");
      fs.stat(filePath, (e2) => {
        if (e2) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("404 Not Found");
        } else {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          fs.createReadStream(filePath).pipe(res);
        }
      });
      return;
    }

    const mime = MIME[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type":  mime,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

module.exports = { serveStatic };
