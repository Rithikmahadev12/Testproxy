"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — rewriter.js  v3
//  Rewrites HTML/CSS + injects runtime
// ══════════════════════════════════════

function prefix(proxyBase) {
  return `${proxyBase}/fetch?url=`;
}

// ── Convert any URL to a proxied URL ─────────────────────────────────────────
function toProxy(raw, baseUrl, pfx) {
  if (!raw) return raw;
  const s = raw.trim();
  if (!s) return raw;
  // Already proxied or special scheme — leave alone
  if (
    s.startsWith(pfx) ||
    s.startsWith("data:") ||
    s.startsWith("blob:") ||
    s.startsWith("javascript:") ||
    s.startsWith("mailto:") ||
    s.startsWith("tel:") ||
    s.startsWith("about:") ||
    s.startsWith("#")
  ) return raw;

  let abs;
  if (s.startsWith("//"))                       abs = "https:" + s;
  else if (/^https?:\/\//i.test(s))             abs = s;
  else if (s.startsWith("/"))                   abs = new URL(baseUrl).origin + s;
  else {
    try { abs = new URL(s, baseUrl).href; }
    catch { return raw; }
  }
  return pfx + encodeURIComponent(abs);
}

// ── REWRITE HTML ──────────────────────────────────────────────────────────────
function rewriteHtml(html, targetUrl, proxyBase) {
  const pfx = prefix(proxyBase);
  const rw  = (val) => { try { return toProxy(val, targetUrl, pfx); } catch { return val; } };

  // ── src / href / action / data-* / poster ─────────────────────────────────
  html = html.replace(
    /(\s(?:src|href|action|data-src|data-href|data-lazy|data-lazy-src|data-original|data-url|data-image|poster|data-background|data-bg|data-thumb|data-full|data-link|data-path))=(["'])(.*?)\2/gi,
    (_, attr, q, val) => `${attr}=${q}${rw(val)}${q}`
  );

  // ── srcset ────────────────────────────────────────────────────────────────
  html = html.replace(
    /(\ssrcset=)(["'])(.*?)\2/gi,
    (_, attr, q, val) => {
      const rewritten = val.split(",").map(part => {
        const t = part.trim();
        if (!t) return part;
        const sp = t.split(/\s+/);
        sp[0] = rw(sp[0]);
        return sp.join(" ");
      }).join(", ");
      return `${attr}${q}${rewritten}${q}`;
    }
  );

  // ── url() in style attrs / inline CSS ────────────────────────────────────
  html = html.replace(
    /url\((["']?)([^"')]+)\1\)/gi,
    (_, q, u) => `url(${q}${rw(u.trim())}${q})`
  );

  // ── <meta http-equiv=refresh content="0;url=..."> ────────────────────────
  html = html.replace(
    /(<meta[^>]+content=["'][^"']*url=)(https?:\/\/[^"']+)/gi,
    (_, pre, u) => `${pre}${pfx}${encodeURIComponent(u)}`
  );

  // ── <script type=module src=...> already covered above ───────────────────

  // ── Remove integrity attributes (hashes won't match after rewrite) ────────
  html = html.replace(/\s+integrity=["'][^"']*["']/gi, "");
  html = html.replace(/\s+crossorigin=["'][^"']*["']/gi, "");

  return html;
}

// ── REWRITE CSS ───────────────────────────────────────────────────────────────
function rewriteCss(css, targetUrl, proxyBase) {
  const pfx = prefix(proxyBase);

  // @import "url" or @import url("url")
  css = css.replace(
    /@import\s+(?:url\(["']?([^"')]+)["']?\)|["']([^"']+)["'])/gi,
    (_, u1, u2) => {
      const u = (u1 || u2 || "").trim();
      if (!u) return _;
      try { return `@import url("${pfx}${encodeURIComponent(new URL(u, targetUrl).href)}")`; }
      catch { return _; }
    }
  );

  // url(...)
  css = css.replace(
    /url\((["']?)([^"')]*)\1\)/gi,
    (match, q, u) => {
      u = (u || "").trim();
      if (!u || u.startsWith("data:") || u.startsWith("#") || u.startsWith(pfx)) return match;
      try { return `url(${q}${pfx}${encodeURIComponent(new URL(u, targetUrl).href)}${q})`; }
      catch { return match; }
    }
  );

  return css;
}

// ── INJECT RUNTIME HELPERS ───────────────────────────────────────────────────
function injectHelpers(html, targetUrl, proxyBase) {
  const pfx    = prefix(proxyBase);
  const origin = (() => { try { return new URL(targetUrl).origin; } catch { return ""; } })();

  // A <base> tag ensures relative URLs in the document resolve correctly
  const baseTag = `<base href="${escAttr(targetUrl)}">`;

  const script = buildRuntimeScript(pfx, origin, targetUrl);

  // Inject at very start of <head> so our script runs before ANY site code
  if (/<head(\s[^>]*)?>/i.test(html)) {
    html = html.replace(/(<head(\s[^>]*)?>)/i, `$1\n${baseTag}\n${script}\n`);
  } else if (/<html(\s[^>]*)?>/i.test(html)) {
    html = html.replace(/(<html(\s[^>]*)?>)/i, `$1\n${baseTag}\n${script}\n`);
  } else {
    html = baseTag + "\n" + script + "\n" + html;
  }

  return html;
}

function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ════════════════════════════════════════════════════════════════════════════════
//  RUNTIME SCRIPT — injected into every proxied HTML page
//  • Anti-detection spoofs (top, parent, frameElement, webdriver, chrome, etc.)
//  • Proxifies fetch / XHR / open / Worker / history
//  • Sends mos-navigate-proxy to parent when a link is clicked
//  • MutationObserver patches newly-inserted nodes
// ════════════════════════════════════════════════════════════════════════════════
function buildRuntimeScript(pfx, origin, targetUrl) {
  // We stringify these so they embed as JS string literals
  const _pfx    = JSON.stringify(pfx);
  const _origin = JSON.stringify(origin);
  const _target = JSON.stringify(targetUrl);

  return `<script data-mos="1">
(function(){
"use strict";
var __P = ${_pfx};
var __O = ${_origin};
var __T = ${_target};
var __PAR;
try { __PAR = window.parent; } catch(e) { __PAR = null; }

/* ─── URL proxifier ─────────────────────────────────────────────────────── */
function proxify(u) {
  if (!u || typeof u !== "string") return u;
  var s = u.trim();
  if (!s) return u;
  if (s.startsWith(__P) || s.startsWith("data:") || s.startsWith("blob:") ||
      s.startsWith("javascript:") || s.startsWith("mailto:") ||
      s.startsWith("tel:") || s.startsWith("about:") || s.startsWith("#")) return u;
  if (s.startsWith("//"))            return __P + encodeURIComponent("https:" + s);
  if (/^https?:\\/\\//i.test(s))     return __P + encodeURIComponent(s);
  if (s.startsWith("/"))             return __P + encodeURIComponent(__O + s);
  try { return __P + encodeURIComponent(new URL(s, __T).href); } catch(e) { return u; }
}

/* ─── Notify parent of current real URL ─────────────────────────────────── */
function notifyUrl(href) {
  try {
    var real = href || __T;
    if (real && real.indexOf(__P) !== -1) {
      var idx = real.indexOf(__P);
      try { real = decodeURIComponent(real.slice(idx + __P.length)); } catch(e) {}
    }
    if (__PAR && __PAR !== window) {
      __PAR.postMessage({ type: "mos-url-update", url: real }, "*");
    }
  } catch(e) {}
}

/* ─── Anti-detection Phase 1: Identity spoofs ───────────────────────────── */
/* top / parent / frameElement — we are NOT in an iframe as far as the page knows */
try { Object.defineProperty(window, "top",          { get: function(){ return window; }, configurable: true }); } catch(e){}
try { Object.defineProperty(window, "parent",       { get: function(){ return window; }, configurable: true }); } catch(e){}
try { Object.defineProperty(window, "frameElement", { get: function(){ return null;   }, configurable: true }); } catch(e){}

/* navigator.webdriver = false */
try { Object.defineProperty(navigator, "webdriver", { get: function(){ return false; }, configurable: true }); } catch(e){}

/* window.chrome — needed by many sites to confirm a real Chrome */
try {
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      id: undefined,
      connect: function(){},
      sendMessage: function(){},
      onMessage:  { addListener: function(){}, removeListener: function(){}, hasListeners: function(){ return false; } },
      onConnect:  { addListener: function(){}, removeListener: function(){} }
    };
  }
  if (!window.chrome.app) window.chrome.app = { isInstalled: false, InstallState: {}, RunningState: {} };
  if (!window.chrome.loadTimes) window.chrome.loadTimes = function(){ return { requestTime: (Date.now()/1000)-0.1 }; };
  if (!window.chrome.csi) window.chrome.csi = function(){ return { startE: Date.now(), onloadT: Date.now()+5 }; };
} catch(e){}

/* navigator.plugins — empty list = headless = blocked */
try {
  var fakePlugins = [
    { name:"Chrome PDF Plugin",  description:"Portable Document Format", filename:"internal-pdf-viewer"           },
    { name:"Chrome PDF Viewer",  description:"",                          filename:"mhjfbmdgcfjbbpaeojofohoefgiehjai"},
    { name:"Native Client",      description:"",                          filename:"internal-nacl-plugin"           }
  ];
  fakePlugins.item       = function(i){ return fakePlugins[i] || null; };
  fakePlugins.namedItem  = function(n){ for(var i=0;i<fakePlugins.length;i++) if(fakePlugins[i].name===n) return fakePlugins[i]; return null; };
  fakePlugins.refresh    = function(){};
  Object.defineProperty(navigator, "plugins",   { get: function(){ return fakePlugins; }, configurable: true });
  Object.defineProperty(navigator, "mimeTypes", { get: function(){
    var m = []; m.length=0; m.item=function(){return null;}; m.namedItem=function(){return null;}; return m;
  }, configurable: true });
} catch(e){}

/* screen dimensions */
try { Object.defineProperty(window, "outerWidth",  { get: function(){ return window.screen.width;       }, configurable: true }); } catch(e){}
try { Object.defineProperty(window, "outerHeight", { get: function(){ return window.screen.height - 80; }, configurable: true }); } catch(e){}

/* window.name — clear it (fingerprinting vector) */
try { Object.defineProperty(window, "name", { get: function(){ return ""; }, set: function(){}, configurable: true }); } catch(e){}

/* document.referrer */
try { Object.defineProperty(document, "referrer", { get: function(){ return __O + "/"; }, configurable: true }); } catch(e){}

/* performance.navigation.type = 0 */
try {
  if (window.performance && window.performance.navigation)
    Object.defineProperty(window.performance.navigation, "type", { get: function(){ return 0; }, configurable: true });
} catch(e){}

/* Permissions API */
try {
  if (navigator.permissions && navigator.permissions.query) {
    var _pq = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function(d){
      var n = d && d.name;
      if (n === "notifications" || n === "push" || n === "clipboard-read" || n === "clipboard-write" || n === "midi")
        return Promise.resolve({ state: "prompt", onchange: null });
      return _pq(d);
    };
  }
} catch(e){}

/* Block service workers (they break proxy routing) */
try {
  if ("serviceWorker" in navigator) {
    Object.defineProperty(navigator, "serviceWorker", {
      get: function(){
        return {
          register:         function(){ return Promise.resolve({ scope: "/", active: null, installing: null, waiting: null, addEventListener: function(){}, removeEventListener: function(){} }); },
          unregister:       function(){ return Promise.resolve(true); },
          getRegistration:  function(){ return Promise.resolve(undefined); },
          getRegistrations: function(){ return Promise.resolve([]); },
          ready:            Promise.resolve({ scope: "/", active: null }),
          controller:       null,
          addEventListener: function(){},
          removeEventListener: function(){}
        };
      }, configurable: true
    });
  }
} catch(e){}

/* window.location proxy — site sees its real URL, not the proxied URL */
try {
  var _loc = new URL(__T);
  Object.defineProperty(window, "location", {
    get: function(){
      return new Proxy(location, {
        get: function(t, p){
          if (p === "href")     return __T;
          if (p === "origin")   return __O;
          if (p === "host")     return _loc.host;
          if (p === "hostname") return _loc.hostname;
          if (p === "pathname") return _loc.pathname;
          if (p === "search")   return _loc.search;
          if (p === "hash")     return _loc.hash;
          if (p === "protocol") return _loc.protocol;
          if (p === "port")     return _loc.port;
          if (p === "assign")   return function(u){ try{ u=proxify(u); }catch(e){} location.assign(u); };
          if (p === "replace")  return function(u){ try{ u=proxify(u); }catch(e){} location.replace(u); };
          if (p === "reload")   return function(){ location.reload(); };
          if (p === "toString") return function(){ return __T; };
          var v = t[p];
          return typeof v === "function" ? v.bind(t) : v;
        }
      });
    }, configurable: true
  });
} catch(e){}

/* Silence CSP violation reports */
try { window.addEventListener("securitypolicyviolation", function(e){ e.stopImmediatePropagation(); e.preventDefault(); }, true); } catch(e){}

/* ─── Phase 2: Proxy routing ────────────────────────────────────────────── */

/* fetch */
try {
  var _oFetch = window.fetch;
  if (_oFetch) {
    window.fetch = function(input, init) {
      try {
        if (typeof input === "string")                           input = proxify(input);
        else if (input && typeof input === "object" && input.url) input = new Request(proxify(input.url || ""), input);
      } catch(e){}
      return _oFetch.call(this, input, init);
    };
    window.fetch.toString = function(){ return _oFetch.toString(); };
  }
} catch(e){}

/* XMLHttpRequest */
try {
  var _oXHR = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url2) {
    var args = Array.prototype.slice.call(arguments);
    try { args[1] = proxify(url2); } catch(e){}
    return _oXHR.apply(this, args);
  };
} catch(e){}

/* location.assign / replace */
try {
  var _oAssign  = location.assign.bind(location);
  var _oReplace = location.replace.bind(location);
  location.assign  = function(u){ try{u=proxify(u);}catch(e){} _oAssign(u); };
  location.replace = function(u){ try{u=proxify(u);}catch(e){} _oReplace(u); };
} catch(e){}

/* history.pushState / replaceState */
try {
  function wrapHistory(orig){
    return function(state, title, url2){
      try { if (url2) url2 = proxify(url2); } catch(e){}
      var r = orig.call(this, state, title, url2);
      notifyUrl(url2 || window.location.href);
      return r;
    };
  }
  history.pushState    = wrapHistory(history.pushState.bind(history));
  history.replaceState = wrapHistory(history.replaceState.bind(history));
} catch(e){}

/* Worker / SharedWorker */
try { var _OW = window.Worker;       if(_OW){ window.Worker       = function(u,o){ try{u=proxify(u);}catch(e){} return new _OW(u,o); }; window.Worker.prototype       = _OW.prototype; } } catch(e){}
try { var _OS = window.SharedWorker; if(_OS){ window.SharedWorker = function(u,o){ try{u=proxify(u);}catch(e){} return new _OS(u,o); }; window.SharedWorker.prototype = _OS.prototype; } } catch(e){}

/* WebSocket */
try {
  var _oWS = window.WebSocket;
  if (_oWS) {
    window.WebSocket = function(url2, protocols){
      /* convert ws:// → wss:// and don't proxy (can't route WS through HTTP proxy easily) */
      try { if (url2 && url2.startsWith("ws://")) url2 = url2.replace("ws://", "wss://"); } catch(e){}
      return new _oWS(url2, protocols);
    };
    window.WebSocket.prototype = _oWS.prototype;
    window.WebSocket.CONNECTING = _oWS.CONNECTING;
    window.WebSocket.OPEN       = _oWS.OPEN;
    window.WebSocket.CLOSING    = _oWS.CLOSING;
    window.WebSocket.CLOSED     = _oWS.CLOSED;
  }
} catch(e){}

/* window.open — open in same frame via proxy */
try {
  var _oOpen = window.open;
  window.open = function(u, t, f){
    try { if (u) u = proxify(u); } catch(e){}
    return _oOpen ? _oOpen.call(this, u, "_self", f) : null;
  };
} catch(e){}

/* Broadcast / send real URL to parent */
notifyUrl(__T);
window.addEventListener("popstate", function(){ notifyUrl(window.location.href); });

/* ─── Phase 3: DOM link interception ────────────────────────────────────── */
document.addEventListener("click", function(e){
  var el = e.target;
  while (el && el.tagName !== "A") el = el.parentElement;
  if (!el) return;

  var href = el.getAttribute("href");
  if (!href) return;
  href = href.trim();
  if (href.startsWith("#") || href.startsWith("javascript:") ||
      href.startsWith("mailto:") || href.startsWith("tel:")) return;

  /* already proxied link — let it navigate normally inside the frame */
  if (href.startsWith(__P)) return;

  var abs;
  try {
    if (href.startsWith("//"))          abs = "https:" + href;
    else if (/^https?:\\/\\//i.test(href)) abs = href;
    else                                abs = new URL(href, __T).href;
  } catch(e){ return; }

  e.preventDefault();
  e.stopPropagation();

  try {
    if (__PAR && __PAR !== window) {
      __PAR.postMessage({ type: "mos-navigate-proxy", url: abs }, "*");
    } else {
      window.location.href = proxify(abs);
    }
  } catch(e){ window.location.href = proxify(abs); }
}, true);

/* ─── Phase 4: MutationObserver — patch dynamically-added nodes ─────────── */
function fixAttr(node, attr) {
  try {
    var v = node.getAttribute(attr);
    if (!v) return;
    var p = proxify(v);
    if (p !== v) node.setAttribute(attr, p);
  } catch(e){}
}
function fixSrcset(node) {
  try {
    var ss = node.getAttribute("srcset");
    if (!ss) return;
    var rw = ss.split(",").map(function(p){
      var t = p.trim(); if (!t) return p;
      var sp = t.split(/\s+/); sp[0] = proxify(sp[0]); return sp.join(" ");
    }).join(", ");
    if (rw !== ss) node.setAttribute("srcset", rw);
  } catch(e){}
}
function fixNode(node) {
  if (!node || node.nodeType !== 1) return;
  var tag = (node.tagName || "").toUpperCase();
  if (tag === "IMG" || tag === "SOURCE" || tag === "VIDEO" || tag === "AUDIO") {
    fixAttr(node, "src"); fixSrcset(node); fixAttr(node, "poster");
  }
  if (tag === "SCRIPT") fixAttr(node, "src");
  if (tag === "LINK")   fixAttr(node, "href");
  if (tag === "IFRAME" || tag === "FRAME") fixAttr(node, "src");
  if (tag === "FORM")   fixAttr(node, "action");
  ["data-src","data-lazy","data-lazy-src","data-original","data-bg","data-background","data-image","data-url"].forEach(function(a){
    fixAttr(node, a);
  });
  try {
    if (node.style && node.style.backgroundImage) {
      node.style.backgroundImage = node.style.backgroundImage.replace(
        /url\(["']?([^"')]+)["']?\)/g,
        function(m, u){ return "url(" + proxify(u) + ")"; }
      );
    }
  } catch(e){}
}

/* Initial sweep */
try {
  document.querySelectorAll("img,source,video,audio,script[src],link[href],iframe,frame,[data-src],[data-lazy],[data-lazy-src],[data-original]").forEach(fixNode);
} catch(e){}

/* Watch for additions */
try {
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(node){
        if (node.nodeType !== 1) return;
        fixNode(node);
        try { node.querySelectorAll("img,source,script[src],link[href],iframe,[data-src],[data-lazy]").forEach(fixNode); } catch(e){}
      });
      if (m.type === "attributes" && m.target) {
        var a = m.attributeName;
        if (["src","srcset","href","data-src","data-lazy","data-original","action","poster"].indexOf(a) !== -1) fixNode(m.target);
      }
    });
  }).observe(document.documentElement, {
    childList: true, subtree: true,
    attributes: true,
    attributeFilter: ["src","srcset","href","data-src","data-lazy","data-original","action","poster"]
  });
} catch(e){}

})();
</script>`;
}

module.exports = { rewriteHtml, rewriteCss, injectHelpers, prefix };
