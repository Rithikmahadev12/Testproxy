"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — blocklist.js  v3
// ══════════════════════════════════════

// ── Patterns that are always blocked ─────────────────────────────────────────
const BLOCKED = [
  /malware/i,
  /phish/i,
  /ransomware/i,
];

// ── Response headers to nuke (anti-framing / security headers) ────────────────
const STRIP_RES = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "feature-policy",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "report-to",
  "nel",
  "expect-ct",
  "public-key-pins",
  "public-key-pins-report-only",
  "x-permitted-cross-domain-policies",
  "x-xss-protection",
  "origin-agent-cluster",
]);

// ── Request headers to strip (reveal proxy identity) ─────────────────────────
const STRIP_REQ = new Set([
  "host",
  "origin",
  "referer",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "via",
  "forwarded",
  "x-cluster-client-ip",
  "x-client-ip",
  "true-client-ip",
]);

function isBlocked(host) {
  if (!host) return true;
  return BLOCKED.some(p => p.test(host));
}

function cleanResponseHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!STRIP_RES.has(k.toLowerCase())) {
      out[k] = v;
    }
  }
  return out;
}

function buildRequestHeaders(incoming = {}, overrides = {}) {
  // Start from a clean object — drop all proxy-revealing headers
  const base = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (!STRIP_REQ.has(k.toLowerCase())) {
      base[k.toLowerCase()] = v;
    }
  }

  return {
    ...base,
    // Mandatory browser spoofs
    "user-agent":         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept-language":    "en-US,en;q=0.9",
    "accept-encoding":    "gzip, deflate, br",
    "sec-fetch-mode":     "navigate",
    "sec-fetch-dest":     "document",
    "sec-fetch-site":     "same-origin",
    "sec-fetch-user":     "?1",
    "sec-ch-ua":          '"Chromium";v="124","Google Chrome";v="124","Not-A.Brand";v="99"',
    "sec-ch-ua-mobile":   "?0",
    "sec-ch-ua-platform": '"Windows"',
    "dnt":                "1",
    // Caller overrides always win
    ...overrides,
  };
}

module.exports = { isBlocked, cleanResponseHeaders, buildRequestHeaders };
