"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — src/decompress.js
//  Decompresses proxied response streams
// ══════════════════════════════════════

const zlib = require("zlib");

/**
 * Wraps a response stream with the appropriate decompressor
 * based on the Content-Encoding header.
 *
 * @param {IncomingMessage} stream   - Node HTTP response stream
 * @param {string}          encoding - value of Content-Encoding header
 * @returns {stream.Readable}        - decompressed stream
 */
function decompress(stream, encoding) {
  if (!encoding) return stream;

  switch (encoding.toLowerCase()) {
    case "gzip":
      return stream.pipe(zlib.createGunzip());
    case "br":
    case "brotli":
      return stream.pipe(zlib.createBrotliDecompress());
    case "deflate":
      return stream.pipe(zlib.createInflate());
    default:
      return stream;
  }
}

/**
 * Collects all chunks from a readable stream into a single Buffer.
 * @param {stream.Readable} readable
 * @returns {Promise<Buffer>}
 */
function collectBuffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on("data",  chunk => chunks.push(chunk));
    readable.on("end",   ()    => resolve(Buffer.concat(chunks)));
    readable.on("error", err   => reject(err));
  });
}

module.exports = { decompress, collectBuffer };
