"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — src/rewriter.js
//  Rewrites proxied HTML/CSS/JS so all
//  sub-resources route back through /fetch
// ══════════════════════════════════════

/**
 * Returns the proxy prefix string for a given server base URL.
 * e.g. "https://myapp.onrender.com/fetch?url="
 */
function proxyPrefix(proxyBase) {
  return `${proxyBase}/fetch?url=`;
}

/**
 * Rewrite a single URL so it routes through the proxy.
 * Handles absolute, protocol-relative, and root-relative URLs.
 */
function rewriteUrl(rawUrl, targetOrigin, prefix) {
  if (!rawUrl) return rawUrl;
  const u = rawUrl.trim();
  if (
    u.startsWith("data:") ||
    u.startsWith("javascript:") ||
    u.startsWith("mailto:") ||
    u.startsWith("blob:") ||
    u.startsWith("#") ||
    u.startsWith(prefix)          // already proxied
  ) {
    return u;
  }
  if (u.startsWith("//")) {
    return prefix + encodeURIComponent("https:" + u);
  }
  if (u.startsWith("http://") || u.startsWith("https://")) {
    return prefix + encodeURIComponent(u);
  }
  if (u.startsWith("/")) {
    return prefix + encodeURIComponent(targetOrigin + u);
  }
  // Relative — leave as-is (base tag handles it)
  return u;
}

/**
 * Rewrite HTML: src/href/action/srcset attributes, CSS url(), inline styles,
 * meta refresh, and form actions.
 */
function rewriteHtml(html, targetUrl, proxyBase) {
  const origin = new URL(targetUrl).origin;
  const prefix = proxyPrefix(proxyBase);

  // Attribute rewrites (src, href, action, data-src, poster, data-href)
  html = html.replace(
    /(\s(?:src|href|action|data-src|data-href|poster|data-lazy-src|data-original))=(['"])(.*?)\2/gi,
    (match, attr, quote, val) => {
      const rewritten = rewriteUrl(val, origin, prefix);
      return `${attr}=${quote}${rewritten}${quote}`;
    }
  );

  // srcset (comma-separated list of "url size" pairs)
  html = html.replace(
    /(\ssrcset=)(['"])(.*?)\2/gi,
    (match, attr, quote, val) => {
      const rewritten = val
        .split(",")
        .map(part => {
          const [u, ...rest] = part.trim().split(/\s+/);
          const rw = rewriteUrl(u, origin, prefix);
          return rest.length ? `${rw} ${rest.join(" ")}` : rw;
        })
        .join(", ");
      return `${attr}${quote}${rewritten}${quote}`;
    }
  );

  // CSS url() inside style attributes / <style> blocks
  html = html.replace(
    /url\((['"]?)(https?:\/\/[^'")\s]+|\/[^'")\s]+)\1\)/gi,
    (match, quote, u) => {
      return `url(${quote}${rewriteUrl(u, origin, prefix)}${quote})`;
    }
  );

  // Meta refresh redirect
  html = html.replace(
    /(<meta[^>]+content=["'][^"']*url=)(https?:\/\/[^"']+)/gi,
    (match, pre, u) => `${pre}${prefix}${encodeURIComponent(u)}`
  );

  // <form action>
  html = html.replace(
    /(<form[^>]+action=["'])(https?:\/\/[^"']+)/gi,
    (match, pre, u) => `${pre}${prefix}${encodeURIComponent(u)}`
  );

  return html;
}

/**
 * Rewrite CSS: all url() references.
 */
function rewriteCss(css, targetUrl, proxyBase) {
  const origin = new URL(targetUrl).origin;
  const prefix = proxyPrefix(proxyBase);
  return css.replace(
    /url\((['"]?)((?:https?:)?\/\/[^'")\s]+|\/[^'")\s]+)\1\)/gi,
    (match, quote, u) => `url(${quote}${rewriteUrl(u, origin, prefix)}${quote})`
  );
}

/**
 * Inject a <base> tag and the proxy helper script into an HTML document.
 * The helper intercepts fetch(), XHR, and link clicks at runtime.
 */
function injectHelpers(html, targetUrl, proxyBase) {
  const prefix = proxyPrefix(proxyBase);

  const baseTag = `<base href="${new URL(targetUrl).origin}/">`;

  const helperScript = `
<script data-mos-proxy="1">
(function(){
  'use strict';
  var _prefix = ${JSON.stringify(prefix)};

  function proxify(u) {
    if (!u) return u;
    if (u.startsWith(_prefix)) return u;
    if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('javascript:') || u.startsWith('#')) return u;
    if (u.startsWith('//')) return _prefix + encodeURIComponent('https:' + u);
    if (u.startsWith('http://') || u.startsWith('https://')) return _prefix + encodeURIComponent(u);
    return u;
  }

  /* ── fetch() override ──────────────────────────────────────────── */
  var _origFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      if (typeof input === 'string') {
        input = proxify(input);
      } else if (input && input.url) {
        input = new Request(proxify(input.url), input);
      }
    } catch(e) {}
    return _origFetch.call(this, input, init);
  };

  /* ── XMLHttpRequest override ────────────────────────────────────── */
  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    try { url = proxify(url); } catch(e) {}
    var args = Array.prototype.slice.call(arguments);
    args[1] = url;
    return _origOpen.apply(this, args);
  };

  /* ── history.pushState / replaceState ───────────────────────────── */
  var _origPush    = history.pushState.bind(history);
  var _origReplace = history.replaceState.bind(history);
  function patchHistoryFn(orig) {
    return function(state, title, url) {
      if (url) {
        try { url = proxify(url); } catch(e) {}
      }
      return orig(state, title, url);
    };
  }
  history.pushState    = patchHistoryFn(_origPush);
  history.replaceState = patchHistoryFn(_origReplace);

  /* ── Link-click interception ────────────────────────────────────── */
  document.addEventListener('click', function(e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || !a.href) return;
    var href = a.getAttribute('href');
    if (!href) return;
    if (
      href.startsWith('javascript:') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('#') ||
      href.startsWith(_prefix)
    ) return;
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
      e.preventDefault();
      var abs = href.startsWith('//') ? 'https:' + href : href;
      // Notify parent OS frame of navigation
      try { window.top.postMessage({ type: 'mos-navigate-proxy', url: abs }, '*'); } catch(err) {}
      window.location.href = _prefix + encodeURIComponent(abs);
    }
  }, true);

  /* ── window.open override ───────────────────────────────────────── */
  var _origOpen2 = window.open;
  window.open = function(url, target, features) {
    if (url) {
      try { url = proxify(url); } catch(e) {}
    }
    return _origOpen2.call(this, url, '_self', features);
  };

})();
</script>`;

  // Inject base tag right after <head>
  html = html.replace(/(<head[^>]*>)/i, `$1\n${baseTag}`);

  // Inject helper script before </head> (so it runs early)
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${helperScript}\n</head>`);
  } else {
    // Fallback: prepend
    html = helperScript + html;
  }

  return html;
}

module.exports = { rewriteHtml, rewriteCss, rewriteUrl, injectHelpers, proxyPrefix };
