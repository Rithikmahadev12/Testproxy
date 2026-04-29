"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — src/rewriter.js
//  Rewrites proxied HTML/CSS so all
//  sub-resources route back through /fetch
// ══════════════════════════════════════

function proxyPrefix(proxyBase) {
  return `${proxyBase}/fetch?url=`;
}

/**
 * Resolve any URL (absolute, protocol-relative, root-relative, relative)
 * against the page's URL and return a proxied absolute URL.
 * Returns the original string if it should not be proxied.
 */
function rewriteUrl(rawUrl, targetOrigin, prefix, baseUrl) {
  if (!rawUrl) return rawUrl;
  const u = rawUrl.trim();
  if (
    !u ||
    u.startsWith(prefix) ||
    u.startsWith("data:") ||
    u.startsWith("blob:") ||
    u.startsWith("javascript:") ||
    u.startsWith("mailto:") ||
    u.startsWith("tel:") ||
    u.startsWith("#")
  ) return rawUrl;

  let abs;
  if (u.startsWith("//")) {
    abs = "https:" + u;
  } else if (/^https?:\/\//i.test(u)) {
    abs = u;
  } else if (u.startsWith("/")) {
    abs = targetOrigin + u;
  } else {
    // Relative URL — resolve against baseUrl
    if (!baseUrl) return rawUrl;
    try { abs = new URL(u, baseUrl).href; }
    catch { return rawUrl; }
  }

  return prefix + encodeURIComponent(abs);
}

// ── HTML rewriter ─────────────────────────────────────────────────────────────
function rewriteHtml(html, targetUrl, proxyBase) {
  const origin = new URL(targetUrl).origin;
  const prefix = proxyPrefix(proxyBase);
  const rw = (val) => rewriteUrl(val, origin, prefix, targetUrl);

  // Standard resource attributes
  html = html.replace(
    /(\s(?:src|href|action|data-src|data-href|data-lazy|data-lazy-src|data-original|data-url|poster|data-background|data-bg))=(["'])(.*?)\2/gi,
    (match, attr, quote, val) => `${attr}=${quote}${rw(val)}${quote}`
  );

  // srcset (comma-separated list of url [descriptor])
  html = html.replace(
    /(\ssrcset=)(["'])(.*?)\2/gi,
    (match, attr, quote, val) => {
      const rewritten = val.split(",").map(part => {
        const trimmed = part.trim();
        if (!trimmed) return part;
        const [u, ...rest] = trimmed.split(/\s+/);
        const rwu = rw(u);
        return rest.length ? `${rwu} ${rest.join(" ")}` : rwu;
      }).join(", ");
      return `${attr}${quote}${rewritten}${quote}`;
    }
  );

  // CSS url() inside <style> blocks and style="" attributes
  html = html.replace(/url\((["']?)([^"')]*)\1\)/gi, (match, quote, u) => {
    if (!u || !u.trim()) return match;
    return `url(${quote}${rw(u.trim())}${quote})`;
  });

  // Meta refresh redirect
  html = html.replace(
    /(<meta[^>]+content=["'][^"']*url=)(https?:\/\/[^"']+)/gi,
    (match, pre, u) => `${pre}${prefix}${encodeURIComponent(u)}`
  );

  return html;
}

// ── CSS rewriter ─────────────────────────────────────────────────────────────
function rewriteCss(css, targetUrl, proxyBase) {
  const prefix = proxyPrefix(proxyBase);

  // @import "url" and @import url("url") — MUST come before url() rewrite
  css = css.replace(
    /@import\s+(?:url\(["']?([^"')]+)["']?\)|["']([^"']+)["'])/gi,
    (match, u1, u2) => {
      const u = (u1 || u2 || "").trim();
      if (!u) return match;
      try {
        const abs = new URL(u, targetUrl).href;
        return `@import url("${prefix}${encodeURIComponent(abs)}")`;
      } catch { return match; }
    }
  );

  // url() — resolve ALL URLs including relative ones
  css = css.replace(/url\((["']?)([^"')]*)\1\)/gi, (match, quote, u) => {
    if (!u || !u.trim()) return match;
    u = u.trim();
    if (u.startsWith("data:") || u.startsWith("#") || u.startsWith(prefix)) return match;
    try {
      const abs = new URL(u, targetUrl).href;
      return `url(${quote}${prefix}${encodeURIComponent(abs)}${quote})`;
    } catch { return match; }
  });

  return css;
}

// ── Runtime helper injected into every proxied HTML page ──────────────────────
function injectHelpers(html, targetUrl, proxyBase) {
  const prefix = proxyPrefix(proxyBase);
  const origin = new URL(targetUrl).origin;

  // Point <base> at the original URL so relative paths in dynamic HTML resolve correctly
  const baseTag = `<base href="${targetUrl}">`;

  const helperScript = `
<script data-mos-proxy="1">
(function(){
  // Store real top/parent refs BEFORE any spoofing
  var _realParent = window.parent;
  var _realTop    = window.top;

  var _prefix    = ${JSON.stringify(prefix)};
  var _origin    = ${JSON.stringify(origin)};
  var _targetUrl = ${JSON.stringify(targetUrl)};

  /* ── proxify ──────────────────────────────────────────────────────────── */
  function proxify(u) {
    if (!u || typeof u !== 'string') return u;
    var s = u.trim();
    if (!s || s.startsWith(_prefix) ||
        s.startsWith('data:') || s.startsWith('blob:') ||
        s.startsWith('javascript:') || s.startsWith('mailto:') ||
        s.startsWith('tel:') || s.startsWith('#')) return u;
    if (s.startsWith('//'))                        return _prefix + encodeURIComponent('https:' + s);
    if (/^https?:\\/\\//i.test(s))                 return _prefix + encodeURIComponent(s);
    if (s.startsWith('/'))                         return _prefix + encodeURIComponent(_origin + s);
    try { return _prefix + encodeURIComponent(new URL(s, _targetUrl).href); } catch(e) { return u; }
  }

  /* ── Spoof window.top / window.parent so iframe-detector scripts pass ── */
  try {
    Object.defineProperty(window, 'top',    { get: function(){ return window.self; }, configurable: true });
    Object.defineProperty(window, 'parent', { get: function(){ return window.self; }, configurable: true });
  } catch(e) {}

  /* ── Block service workers (they'd register on the proxy origin) ──────── */
  try {
    if ('serviceWorker' in navigator) {
      Object.defineProperty(navigator, 'serviceWorker', {
        get: function() {
          return {
            register:           function() { return Promise.resolve({ scope: '/' }); },
            unregister:         function() { return Promise.resolve(true); },
            getRegistration:    function() { return Promise.resolve(undefined); },
            getRegistrations:   function() { return Promise.resolve([]); },
            ready:              Promise.resolve({ scope: '/', active: null }),
            addEventListener:   function() {},
            removeEventListener:function() {},
          };
        },
        configurable: true
      });
    }
  } catch(e) {}

  /* ── fetch() ──────────────────────────────────────────────────────────── */
  var _origFetch = window.fetch;
  if (_origFetch) {
    window.fetch = function(input, init) {
      try {
        if (typeof input === 'string') input = proxify(input);
        else if (input && typeof input === 'object' && input.url)
          input = new Request(proxify(input.url), input);
      } catch(e) {}
      return _origFetch.call(this, input, init);
    };
  }

  /* ── XMLHttpRequest ───────────────────────────────────────────────────── */
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var args = Array.prototype.slice.call(arguments);
    try { args[1] = proxify(url); } catch(e) {}
    return _xhrOpen.apply(this, args);
  };

  /* ── location.href / assign / replace ────────────────────────────────── */
  try {
    var _locDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (_locDesc && _locDesc.set) {
      Object.defineProperty(Location.prototype, 'href', {
        get: _locDesc.get,
        set: function(v) {
          try { v = proxify(v); } catch(e) {}
          _locDesc.set.call(this, v);
        },
        configurable: true
      });
    }
    var _origAssign  = location.assign.bind(location);
    var _origReplace = location.replace.bind(location);
    location.assign  = function(u) { try { u = proxify(u); } catch(e) {} _origAssign(u); };
    location.replace = function(u) { try { u = proxify(u); } catch(e) {} _origReplace(u); };
  } catch(e) {}

  /* ── history ──────────────────────────────────────────────────────────── */
  function patchHistory(orig) {
    return function(state, title, url) {
      try { if (url) url = proxify(url); } catch(e) {}
      var r = orig.call(this, state, title, url);
      notifyUrl(url || window.location.href);
      return r;
    };
  }
  try {
    history.pushState    = patchHistory(history.pushState.bind(history));
    history.replaceState = patchHistory(history.replaceState.bind(history));
  } catch(e) {}

  /* ── Notify parent p.html of current real URL ─────────────────────────── */
  function notifyUrl(proxyHref) {
    try {
      var real = proxyHref || window.location.href;
      // Strip proxy prefix to recover real URL
      if (real.indexOf(_prefix) !== -1) {
        var encoded = real.slice(real.indexOf(_prefix) + _prefix.length);
        try { real = decodeURIComponent(encoded); } catch(e) {}
      }
      _realParent.postMessage({ type: 'mos-url-update', url: real }, '*');
    } catch(e) {}
  }

  /* ── Worker proxy ─────────────────────────────────────────────────────── */
  try {
    var _OrigWorker = window.Worker;
    if (_OrigWorker) {
      window.Worker = function(url, opts) {
        try { url = proxify(url); } catch(e) {}
        return new _OrigWorker(url, opts);
      };
      window.Worker.prototype = _OrigWorker.prototype;
    }
  } catch(e) {}

  /* ── SharedWorker proxy ───────────────────────────────────────────────── */
  try {
    var _OrigSW = window.SharedWorker;
    if (_OrigSW) {
      window.SharedWorker = function(url, opts) {
        try { url = proxify(url); } catch(e) {}
        return new _OrigSW(url, opts);
      };
      window.SharedWorker.prototype = _OrigSW.prototype;
    }
  } catch(e) {}

  /* ── window.open ──────────────────────────────────────────────────────── */
  var _winOpen = window.open;
  window.open = function(url, target, features) {
    try { if (url) url = proxify(url); } catch(e) {}
    return _winOpen ? _winOpen.call(this, url, '_self', features) : null;
  };

  /* ── Link click interception ──────────────────────────────────────────────
     Strategy: always delegate navigation to the PARENT (p.html) via postMessage.
     The parent owns frame.src and is the single source of truth for history.
     We do NOT change window.location.href here — that caused double-navigation.
  ── */
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (!el) return;

    var href = el.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') ||
        href.startsWith('mailto:') || href.startsWith('tel:')) return;

    // Already a proxy URL → let the iframe navigate itself normally
    if (href.startsWith(_prefix)) return;

    // Resolve to absolute URL
    var abs;
    try {
      if      (href.startsWith('//'))          abs = 'https:' + href;
      else if (/^https?:\\/\\//i.test(href))   abs = href;
      else                                      abs = new URL(href, _targetUrl).href;
    } catch(e) { return; }

    e.preventDefault();
    e.stopPropagation();

    // Tell the parent to navigate — it will update frame.src, history, and URL bar
    try {
      _realParent.postMessage({ type: 'mos-navigate-proxy', url: abs }, '*');
    } catch(err) {}
  }, true);

  /* ── MutationObserver: fix dynamically injected nodes ────────────────── */
  function fixNode(node) {
    if (!node || node.nodeType !== 1) return;
    var tag = (node.tagName || '').toUpperCase();

    // img / source srcset
    if (tag === 'IMG' || tag === 'SOURCE') {
      var src = node.getAttribute('src');
      if (src) { var ps = proxify(src); if (ps !== src) node.setAttribute('src', ps); }
      var ss = node.getAttribute('srcset');
      if (ss) {
        var rw = ss.split(',').map(function(p) {
          var t = p.trim(); if (!t) return p;
          var sp = t.split(/\\s+/); sp[0] = proxify(sp[0]); return sp.join(' ');
        }).join(', ');
        if (rw !== ss) node.setAttribute('srcset', rw);
      }
    }
    // script[src]
    if (tag === 'SCRIPT') {
      var ssrc = node.getAttribute('src');
      if (ssrc) { var ps2 = proxify(ssrc); if (ps2 !== ssrc) node.setAttribute('src', ps2); }
    }
    // link[href]
    if (tag === 'LINK') {
      var lhref = node.getAttribute('href');
      if (lhref) { var ph = proxify(lhref); if (ph !== lhref) node.setAttribute('href', ph); }
    }
    // data-* lazy load attributes
    ['data-src','data-lazy','data-lazy-src','data-original','data-bg','data-background'].forEach(function(attr) {
      var v = node.getAttribute(attr);
      if (v) { var pv = proxify(v); if (pv !== v) node.setAttribute(attr, pv); }
    });
    // inline style background-image
    try {
      if (node.style && node.style.backgroundImage) {
        node.style.backgroundImage = node.style.backgroundImage.replace(
          /url\\(["']?([^"')]+)["']?\\)/g,
          function(m, u) { return 'url(' + proxify(u) + ')'; }
        );
      }
    } catch(e) {}
  }

  // Fix nodes already in DOM
  try {
    document.querySelectorAll('img,source,script[src],link[href],[data-src],[data-lazy],[data-lazy-src],[data-original]').forEach(fixNode);
  } catch(e) {}

  // Watch for new nodes
  new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType !== 1) return;
        fixNode(node);
        try {
          node.querySelectorAll('img,source,script[src],link[href],[data-src],[data-lazy]').forEach(fixNode);
        } catch(e) {}
      });
      if (m.type === 'attributes' && m.target) {
        var a = m.attributeName;
        if (a === 'src' || a === 'srcset' || a === 'href' || a === 'data-src' || a === 'data-lazy' || a === 'data-original') {
          fixNode(m.target);
        }
      }
    });
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['src','srcset','href','data-src','data-lazy','data-original']
  });

  // Announce initial URL to parent
  notifyUrl(window.location.href);

})();
</script>`;

  // Inject <base> right after <head> opening tag
  html = html.replace(/(<head[^>]*>)/i, `$1\n${baseTag}`);

  // Inject helper script as FIRST thing in <head> so it runs before any site scripts
  html = html.replace(/(<head[^>]*>)/i, `$1\n${helperScript}`);

  return html;
}

module.exports = { rewriteHtml, rewriteCss, rewriteUrl, injectHelpers, proxyPrefix };
