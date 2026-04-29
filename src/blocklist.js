"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — src/blocklist.js
//  Centralized host/content filtering
// ══════════════════════════════════════

// Hosts and patterns that are always blocked
const BLOCKED_PATTERNS = [
  // Malware / phishing
  /malware/i,
  /phish/i,
  /ransomware/i,

  // Tracking & analytics that break proxy flow
  /doubleclick\.net$/i,
  /googlesyndication\.com$/i,
  /adservice\.google\./i,
  /pagead2\.googlesyndication/i,
  /amazon-adsystem\.com$/i,
  /ads\.yahoo\.com$/i,
  /scorecardresearch\.com$/i,
  /quantserve\.com$/i,
  /moatads\.com$/i,

  // Telemetry / fingerprinting that interferes with proxy
  /browser-intake-datadoghq\.com$/i,
  /sentry\.io$/i,
  /bugsnag\.com$/i,
  /newrelic\.com$/i,
  /nr-data\.net$/i,
  /elastic\.co\/telemetry/i,

  // CAPTCHA / bot-detection (commonly breaks proxied pages)
  /challenges\.cloudflare\.com$/i,
  /hcaptcha\.com$/i,
];

// Headers we always strip from proxied responses
const STRIP_RESPONSE_HEADERS = [
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "report-to",
  "nel",
  "expect-ct",
];

// Headers we strip from outgoing (forwarded) requests
const STRIP_REQUEST_HEADERS = [
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
];

/**
 * Returns true if the hostname should be blocked.
 * @param {string} host
 * @returns {boolean}
 */
function isBlocked(host) {
  if (!host) return true;
  return BLOCKED_PATTERNS.some(pattern => pattern.test(host));
}

/**
 * Remove security / framing headers from a proxied response header object.
 * @param {object} headers
 * @returns {object}
 */
function cleanResponseHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!STRIP_RESPONSE_HEADERS.includes(k.toLowerCase())) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Build clean outgoing request headers.
 * Spoofs a real browser UA; removes proxy-reveal headers.
 * @param {object} incomingHeaders - original request headers from client
 * @param {object} overrides       - extra headers to set/override
 * @returns {object}
 */
function buildRequestHeaders(incomingHeaders = {}, overrides = {}) {
  const base = { ...incomingHeaders };

  // Strip headers that reveal proxy or cause server rejections
  for (const h of STRIP_REQUEST_HEADERS) {
    delete base[h];
    delete base[h.toLowerCase()];
  }

  return {
    ...base,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": base["accept-language"] || "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
    "Sec-Ch-Ua":
      '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    ...overrides,
  };
}

module.exports = { isBlocked, cleanResponseHeaders, buildRequestHeaders, STRIP_RESPONSE_HEADERS };
