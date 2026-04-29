"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — src/rewriter.js
//  Rewrites proxied HTML/CSS/JS so all
//  sub-resources route back through /fetch
// ══════════════════════════════════════

function proxyPrefix(proxyBase) {
  return `${proxyBase}/fetch?url=`;
}

function rewriteUrl(rawUrl, targetOrigin, prefix) {
  if (!rawUrl) return rawUrl;
  const u = rawUrl.trim();
  if (
    u === "" ||
    u.startsWith("data:") ||
    u.startsWith("javascript:") ||
    u.startsWith("mailto:") ||
    u.startsWith("tel:") ||
    u.startsWith("blob:") ||
    u.startsWith("#") ||
    u.startsWith(prefix)
  ) return u;

  if (u.startsWith("//")) {
    return prefix + encodeURIComponent("https:" + u);
  }
  if (u.startsWith("https://") || u.startsWith("http://")) {
    return prefix + encodeURIComponent(u);
  }
  if (u.startsWith("/")) {
    return prefix + encodeURIComponent(targetOrigin + u);
  }
  // relative — leave alone, base tag handles it
  return u;
}

function rewriteHtml(html, targetUrl, proxyBase) {
  const origin = new URL(targetUrl).origin;
  const prefix = proxyPrefix(proxyBase);

  // ── Standard attributes ────────────────────────────────────────────────────
  // src, href, action, data-src, poster, data-href, data-lazy-src, data-original, data-url
  html = html.replace(
    /(\s(?:src|href|action|data-src|data-href|data-lazy|data-lazy-src|data-original|data-url|poster|data-background|data-bg|content))=(["'])(.*?)\2/gi,
    (match, attr, quote, val) => {
      // Don't rewrite meta tags unless they're refresh
      if (attr.toLowerCase() === "content") return match;
      const rw = rewriteUrl(val, origin, prefix);
      return `${attr}=${quote}${rw}${quote}`;
    }
  );

  // ── srcset ─────────────────────────────────────────────────────────────────
  html = html.replace(
    /(\ssrcset=)(["'])(.*?)\2/gi,
    (match, attr, quote, val) => {
      const rw = val.split(",").map(part => {
        const trimmed = part.trim();
        if (!trimmed) return part;
        const [u, ...rest] = trimmed.split(/\s+/);
        const rwu = rewriteUrl(u, origin, prefix);
        return rest.length ? `${rwu} ${rest.join(" ")}` : rwu;
      }).join(", ");
      return `${attr}${quote}${rw}${quote}`;
    }
  );

  // ── CSS url() inside style attributes and <style> blocks ──────────────────
  html = html.replace(
    /url\((["']?)((?:https?:\/\/|\/\/|\/)[^"')\\s]+)\1\)/gi,
    (match, quote, u) => `url(${quote}${rewriteUrl(u, origin, prefix)}${quote})`
  );

  // ── Meta refresh ───────────────────────────────────────────────────────────
  html = html.replace(
    /(<meta[^>]+content=["'][^"']*url=)(https?:\/\/[^"']+)/gi,
    (match, pre, u) => `${pre}${prefix}${encodeURIComponent(u)}`
  );

  // ── <form action> ──────────────────────────────────────────────────────────
  html = html.replace(
    /(<form[^>]+action=)(["'])(https?:\/\/[^"']+)\2/gi,
    (match, pre, quote, u) => `${pre}${quote}${prefix}${encodeURIComponent(u)}${quote}`
  );

  // ── Inline style background-image ─────────────────────────────────────────
  html = html.replace(
    /(style=["'][^"']*background(?:-image)?:\s*url\()(["']?)((?:https?:\/\/|\/\/|\/)[^"')]+)\2(\))/gi,
    (match, pre, quote, u, post) => `${pre}${quote}${rewriteUrl(u, origin, prefix)}${quote}${post}`
  );

  return html;
}

function rewriteCss(css, targetUrl, proxyBase) {
  const origin = new URL(targetUrl).origin;
  const prefix = proxyPrefix(proxyBase);
  return css.replace(
    /url\((["']?)((?:https?:)?\/\/[^"')\\s]+|\/[^"')\\s]+)\1\)/gi,
    (match, quote, u) => `url(${quote}${rewriteUrl(u, origin, prefix)}${quote})`
  );
}

function injectHelpers(html, targetUrl, proxyBase) {
  const prefix = proxyPrefix(proxyBase);
  const origin = new URL(targetUrl).origin;

  const baseTag = `<base href="${origin}/">`;

  const helperScript = `
<script data-mos-proxy="1">
(function(){
  'use strict';
  var _prefix = ${JSON.stringify(prefix)};
  var _origin = ${JSON.stringify(origin)};

  function proxify(u) {
    if (!u || typeof u !== 'string') return u;
    var s = u.trim();
    if (!s) return u;
    if (s.startsWith(_prefix)) return s;
    if (
      s.startsWith('data:') || s.startsWith('blob:') ||
      s.startsWith('javascript:') || s.startsWith('mailto:') ||
      s.startsWith('tel:') || s.startsWith('#')
    ) return s;
    if (s.startsWith('//')) return _prefix + encodeURIComponent('https:' + s);
    if (s.startsWith('https://') || s.startsWith('http://')) return _prefix + encodeURIComponent(s);
    if (s.startsWith('/')) return _prefix + encodeURIComponent(_origin + s);
    return s;
  }

  /* ── fetch() ─────────────────────────────────────────────────────────── */
  var _origFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      if (typeof input === 'string') input = proxify(input);
      else if (input && input.url) input = new Request(proxify(input.url), input);
    } catch(e) {}
    return _origFetch.call(this, input, init);
  };

  /* ── XMLHttpRequest ──────────────────────────────────────────────────── */
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var args = Array.prototype.slice.call(arguments);
    try { args[1] = proxify(url); } catch(e) {}
    return _xhrOpen.apply(this, args);
  };

  /* ── history ─────────────────────────────────────────────────────────── */
  function patchHistory(orig) {
    return function(state, title, url) {
      try { if (url) url = proxify(url); } catch(e) {}
      return orig.call(this, state, title, url);
    };
  }
  history.pushState    = patchHistory(history.pushState.bind(history));
  history.replaceState = patchHistory(history.replaceState.bind(history));

  /* ── Link clicks ─────────────────────────────────────────────────────── */
  document.addEventListener('click', function(e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href) return;
    if (
      href.startsWith('javascript:') || href.startsWith('mailto:') ||
      href.startsWith('tel:') || href.startsWith('#') ||
      href.startsWith(_prefix)
    ) return;
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
      e.preventDefault();
      var abs = href.startsWith('//') ? 'https:' + href : href;
      try { window.top.postMessage({ type: 'mos-navigate-proxy', url: abs }, '*'); } catch(err) {}
      window.location.href = _prefix + encodeURIComponent(abs);
    }
  }, true);

  /* ── window.open ─────────────────────────────────────────────────────── */
  var _winOpen = window.open;
  window.open = function(url, target, features) {
    try { if (url) url = proxify(url); } catch(e) {}
    return _winOpen.call(this, url, '_self', features);
  };

  /* ── Image src interception via MutationObserver ─────────────────────── */
  function fixNode(node) {
    if (!node || node.nodeType !== 1) return;
    // img src / srcset
    if (node.tagName === 'IMG') {
      var src = node.getAttribute('src');
      if (src) { var ps = proxify(src); if (ps !== src) node.setAttribute('src', ps); }
      var ss = node.getAttribute('srcset');
      if (ss) {
        var rw = ss.split(',').map(function(part) {
          var t = part.trim(); if (!t) return part;
          var sp = t.split(/\s+/); sp[0] = proxify(sp[0]); return sp.join(' ');
        }).join(', ');
        if (rw !== ss) node.setAttribute('srcset', rw);
      }
    }
    // source srcset (picture element)
    if (node.tagName === 'SOURCE') {
      var ss2 = node.getAttribute('srcset');
      if (ss2) {
        var rw2 = ss2.split(',').map(function(part) {
          var t = part.trim(); if (!t) return part;
          var sp = t.split(/\s+/); sp[0] = proxify(sp[0]); return sp.join(' ');
        }).join(', ');
        if (rw2 !== ss2) node.setAttribute('srcset', rw2);
      }
    }
    // background-image inline style
    if (node.style && node.style.backgroundImage) {
      node.style.backgroundImage = node.style.backgroundImage.replace(
        /url\(["']?(https?:\/\/[^"')]+|\/\/[^"')]+)["']?\)/g,
        function(m, u) { return 'url(' + proxify(u) + ')'; }
      );
    }
    // data-src / data-lazy etc.
    ['data-src','data-lazy','data-lazy-src','data-original','data-bg','data-background'].forEach(function(attr) {
      var v = node.getAttribute(attr);
      if (v) { var pv = proxify(v); if (pv !== v) node.setAttribute(attr, pv); }
    });
  }

  // Fix all existing nodes
  document.querySelectorAll('img, source, [data-src], [data-lazy], [data-lazy-src], [data-original], [data-bg]').forEach(fixNode);

  // Watch for new nodes
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) {
          fixNode(node);
          node.querySelectorAll && node.querySelectorAll('img, source, [data-src], [data-lazy]').forEach(fixNode);
        }
      });
      // Watch attribute changes on existing nodes
      if (m.type === 'attributes' && m.target) {
        var attr = m.attributeName;
        if (attr === 'src' || attr === 'srcset' || attr === 'data-src') {
          fixNode(m.target);
        }
      }
    });
  });
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['src', 'srcset', 'data-src', 'data-lazy', 'data-original']
  });

})();
</script>`;

  html = html.replace(/(<head[^>]*>)/i, `$1\n${baseTag}`);
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${helperScript}\n</head>`);
  } else {
    html = helperScript + html;
  }

  return html;
}

module.exports = { rewriteHtml, rewriteCss, rewriteUrl, injectHelpers, proxyPrefix };
