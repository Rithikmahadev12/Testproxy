"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — rewriter.js  v6
//  Server-side HTML/CSS URL rewriting
//  + injected runtime sandbox script
// ══════════════════════════════════════

function prefix(proxyBase) {
  return `${proxyBase}/fetch?url=`;
}

function toProxy(raw, baseUrl, pfx) {
  if (!raw) return raw;
  const s = raw.trim();
  if (!s) return raw;
  if (
    s.startsWith(pfx) ||
    s.startsWith("data:") ||
    s.startsWith("blob:") ||
    s.startsWith("javascript:") ||
    s.startsWith("mailto:") ||
    s.startsWith("tel:") ||
    s.startsWith("about:") ||
    s.startsWith("#") ||
    s.startsWith("chrome-extension:")
  ) return raw;

  let abs;
  try {
    if (s.startsWith("//"))           abs = "https:" + s;
    else if (/^https?:\/\//i.test(s)) abs = s;
    else if (s.startsWith("/"))       abs = new URL(baseUrl).origin + s;
    else                              abs = new URL(s, baseUrl).href;
  } catch { return raw; }

  return pfx + encodeURIComponent(abs);
}

// ── REWRITE HTML ──────────────────────────────────────────────────────────────
function rewriteHtml(html, targetUrl, proxyBase) {
  const pfx = prefix(proxyBase);
  const rw  = (val) => { try { return toProxy(val, targetUrl, pfx); } catch { return val; } };

  // src= on all elements
  html = html.replace(
    /(\s)(src)=(["'])(.*?)\3/gi,
    (_, sp, attr, q, val) => `${sp}${attr}=${q}${rw(val)}${q}`
  );

  // href= on <link> tags
  html = html.replace(
    /(<link\b[^>]*?\s)(href)=(["'])(.*?)\3/gi,
    (_, pre, attr, q, val) => `${pre}${attr}=${q}${rw(val)}${q}`
  );

  // action= on <form>
  html = html.replace(
    /(<form\b[^>]*?\s)(action)=(["'])(.*?)\3/gi,
    (_, pre, attr, q, val) => `${pre}${attr}=${q}${rw(val)}${q}`
  );

  // data-* resource attributes
  html = html.replace(
    /(\s)(data-src|data-href|data-lazy|data-lazy-src|data-original|data-url|data-image|data-background|data-bg|data-thumb|data-full|data-link|data-path|data-poster)=(["'])(.*?)\3/gi,
    (_, sp, attr, q, val) => `${sp}${attr}=${q}${rw(val)}${q}`
  );

  // poster=
  html = html.replace(
    /(\s)(poster)=(["'])(.*?)\3/gi,
    (_, sp, attr, q, val) => `${sp}${attr}=${q}${rw(val)}${q}`
  );

  // srcset=
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

  // url() in inline style= attributes
  html = html.replace(
    /(style=["'][^"']*?)url\((["']?)([^"')]+)\2\)/gi,
    (_, pre, q, u) => `${pre}url(${q}${rw(u.trim())}${q})`
  );

  // url() inside <style> blocks
  html = html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_, open, content, close) => {
      const rewritten = content.replace(
        /url\((["']?)([^"')]+)\1\)/gi,
        (m, q, u) => `url(${q}${rw(u.trim())}${q})`
      );
      return open + rewritten + close;
    }
  );

  // <a href=> — rewrite for navigation through proxy
  html = html.replace(
    /(<a\b[^>]*?\s)(href)=(["'])((?!#|javascript:|mailto:|tel:)[^"']+)\3/gi,
    (_, pre, attr, q, val) => `${pre}${attr}=${q}${rw(val)}${q}`
  );

  // Remove integrity / crossorigin / nonce so rewritten assets load
  html = html.replace(/\s+integrity=(["'])[^"']*\1/gi, "");
  html = html.replace(/\s+crossorigin=(["'])[^"']*\1/gi, "");
  html = html.replace(/\scrossorigin(?=[\s>])/gi, "");
  html = html.replace(/\s+nonce=(["'])[^"']*\1/gi, "");

  return html;
}

// ── REWRITE CSS ───────────────────────────────────────────────────────────────
function rewriteCss(css, targetUrl, proxyBase) {
  const pfx = prefix(proxyBase);

  css = css.replace(
    /@import\s+(?:url\(["']?([^"')]+)["']?\)|["']([^"']+)["'])/gi,
    (_, u1, u2) => {
      const u = (u1 || u2 || "").trim();
      if (!u) return _;
      try { return `@import url("${pfx}${encodeURIComponent(new URL(u, targetUrl).href)}")`; }
      catch { return _; }
    }
  );

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

// ── INJECT RUNTIME ────────────────────────────────────────────────────────────
function injectHelpers(html, targetUrl, proxyBase) {
  const pfx    = prefix(proxyBase);
  const origin = (() => { try { return new URL(targetUrl).origin; } catch { return ""; } })();

  const baseTag = `<base href="${escAttr(targetUrl)}">`;
  const script  = buildRuntimeScript(pfx, origin, targetUrl, proxyBase);

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

// ═══════════════════════════════════════════════════════════════
//  RUNTIME SANDBOX SCRIPT — injected into every proxied page
//  Patches ALL browser APIs that could leak real URLs
//  Fixes: double-wrap, missed dynamic elements, WebSocket, etc.
// ═══════════════════════════════════════════════════════════════
function buildRuntimeScript(pfx, origin, targetUrl, proxyBase) {
  const _pfx    = JSON.stringify(pfx);
  const _origin = JSON.stringify(origin);
  const _target = JSON.stringify(targetUrl);

  return `<script data-mos="1">
(function(){
"use strict";

var __P   = ${_pfx};
var __O   = ${_origin};
var __T   = ${_target};

// Capture real parent BEFORE any overrides
var __PAR = null;
try{
  if(window.parent && window.parent !== window) __PAR = window.parent;
}catch(e){}

// ── proxify: turn any URL into a proxy URL ───────────────────────────────────
function proxify(u){
  if(!u || typeof u !== 'string') return u;
  var s = u.trim();
  if(!s) return u;

  // Already proxied — return as-is
  if(s.startsWith(__P)) return u;

  // Non-proxiable schemes
  if(s.startsWith('data:') || s.startsWith('blob:') ||
     s.startsWith('javascript:') || s.startsWith('mailto:') ||
     s.startsWith('tel:') || s.startsWith('about:') ||
     s.startsWith('#') || s.startsWith('chrome-extension:')) return u;

  // Contains /fetch?url= somewhere (already routed, but not fully formed)
  var fi = s.indexOf('/fetch?url=');
  if(fi !== -1){
    try{
      var inner = decodeURIComponent(s.slice(fi + '/fetch?url='.length));
      // Re-proxify only the inner URL (prevents double-wrapping)
      return __P + encodeURIComponent(inner);
    }catch(e){}
  }

  // Absolute URLs
  if(/^https?:\/\//i.test(s)) return __P + encodeURIComponent(s);
  if(s.startsWith('//'))       return __P + encodeURIComponent('https:' + s);
  // Root-relative
  if(s.startsWith('/'))        return __P + encodeURIComponent(__O + s);
  // Relative
  try { return __P + encodeURIComponent(new URL(s, __T).href); }
  catch(e) { return u; }
}

// ── notifyParent: tell the browser shell the current real URL ────────────────
function notifyParent(href){
  if(!__PAR) return;
  try{
    var real = href || __T;
    // Unwrap if it's a proxy URL
    var fi2 = real.indexOf('/fetch?url=');
    if(fi2 !== -1){
      try{ real = decodeURIComponent(real.slice(fi2 + '/fetch?url='.length)); }catch(e){}
    }
    __PAR.postMessage({type:'mos-url-update', url: real}, '*');
  }catch(e){}
}

// ── navigateParent: tell the browser shell to navigate to a URL ──────────────
function navigateParent(realUrl){
  if(__PAR){
    try{
      __PAR.postMessage({type:'mos-navigate-proxy', url: realUrl}, '*');
      return;
    }catch(e){}
  }
  // Fallback: navigate ourselves
  try{ window.location.href = proxify(realUrl); }catch(e){}
}

// ══════════════════════════
//  ANTI-DETECTION OVERRIDES
// ══════════════════════════

try{ Object.defineProperty(window,'top',{get:function(){return window;},configurable:true}); }catch(e){}
try{ Object.defineProperty(window,'parent',{get:function(){return window;},configurable:true}); }catch(e){}
try{ Object.defineProperty(window,'frameElement',{get:function(){return null;},configurable:true}); }catch(e){}
try{ Object.defineProperty(navigator,'webdriver',{get:function(){return false;},configurable:true}); }catch(e){}

// window.chrome stub
try{
  if(!window.chrome) window.chrome = {};
  if(!window.chrome.runtime) window.chrome.runtime = {
    id: undefined,
    connect: function(){},
    sendMessage: function(){},
    onMessage:  {addListener:function(){},removeListener:function(){},hasListeners:function(){return false;}},
    onConnect:  {addListener:function(){},removeListener:function(){}}
  };
  if(!window.chrome.app) window.chrome.app = {isInstalled:false};
}catch(e){}

// Block service workers from the proxied page (they'd fight our SW)
try{
  if('serviceWorker' in navigator){
    Object.defineProperty(navigator,'serviceWorker',{get:function(){
      return {
        register:           function(){ return Promise.resolve({scope:'/',active:null,installing:null,waiting:null,addEventListener:function(){},removeEventListener:function(){}}); },
        unregister:         function(){ return Promise.resolve(true); },
        getRegistration:    function(){ return Promise.resolve(undefined); },
        getRegistrations:   function(){ return Promise.resolve([]); },
        ready:              Promise.resolve({scope:'/',active:null}),
        controller:         null,
        addEventListener:   function(){},
        removeEventListener:function(){}
      };
    },configurable:true});
  }
}catch(e){}

// Spoof location
try{
  var _locObj = new URL(__T);
  Object.defineProperty(window,'location',{get:function(){
    return new Proxy(location,{
      get:function(t,p){
        if(p==='href')     return __T;
        if(p==='origin')   return __O;
        if(p==='host')     return _locObj.host;
        if(p==='hostname') return _locObj.hostname;
        if(p==='pathname') return _locObj.pathname;
        if(p==='search')   return _locObj.search;
        if(p==='hash')     return _locObj.hash;
        if(p==='protocol') return _locObj.protocol;
        if(p==='port')     return _locObj.port;
        if(p==='assign')   return function(u){ try{u=proxify(u);}catch(e){} location.assign(u); };
        if(p==='replace')  return function(u){ try{u=proxify(u);}catch(e){} location.replace(u); };
        if(p==='reload')   return function(){ location.reload(); };
        if(p==='toString') return function(){ return __T; };
        var v=t[p]; return typeof v==='function' ? v.bind(t) : v;
      }
    });
  },configurable:true});
}catch(e){}

try{ Object.defineProperty(document,'referrer',{get:function(){return __O+'/';},configurable:true}); }catch(e){}
try{ window.addEventListener('securitypolicyviolation',function(e){e.stopImmediatePropagation();e.preventDefault();},true); }catch(e){}

// ══════════════
//  API PATCHING
// ══════════════

// fetch
try{
  var _origFetch = window.fetch;
  if(_origFetch){
    window.fetch = function(input, init){
      try{
        if(typeof input === 'string') input = proxify(input);
        else if(input && typeof input === 'object' && input.url){
          input = new Request(proxify(input.url || ''), input);
        }
      }catch(e){}
      return _origFetch.call(this, input, init);
    };
    try{ window.fetch.toString = function(){ return _origFetch.toString(); }; }catch(e){}
  }
}catch(e){}

// XMLHttpRequest
try{
  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url2){
    var args = Array.prototype.slice.call(arguments);
    try{ args[1] = proxify(url2); }catch(e){}
    return _origOpen.apply(this, args);
  };
}catch(e){}

// navigator.sendBeacon
try{
  if(navigator.sendBeacon){
    var _origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(u, d){
      try{ u = proxify(u); }catch(e){}
      return _origBeacon(u, d);
    };
  }
}catch(e){}

// WebSocket
try{
  var _origWS = window.WebSocket;
  if(_origWS){
    window.WebSocket = function(url2, protocols){
      try{ url2 = url2.replace(/^wss?:\\/\\//, function(m){ return m; }); }catch(e){}
      // Route WS through proxy as HTTPS (proxy handles upgrade)
      try{
        var wsUrl = url2.replace(/^wss:\\/\\//, 'https://').replace(/^ws:\\/\\//, 'http://');
        url2 = proxify(wsUrl).replace(/^https?:\\/\\//, function(m){ return url2.startsWith('wss://') ? 'wss://' : 'ws://'; });
      }catch(e){}
      return protocols ? new _origWS(url2, protocols) : new _origWS(url2);
    };
    window.WebSocket.prototype = _origWS.prototype;
    window.WebSocket.CONNECTING = _origWS.CONNECTING;
    window.WebSocket.OPEN       = _origWS.OPEN;
    window.WebSocket.CLOSING    = _origWS.CLOSING;
    window.WebSocket.CLOSED     = _origWS.CLOSED;
  }
}catch(e){}

// EventSource
try{
  var _origES = window.EventSource;
  if(_origES){
    window.EventSource = function(url2, init){
      try{ url2 = proxify(url2); }catch(e){}
      return init ? new _origES(url2, init) : new _origES(url2);
    };
    window.EventSource.prototype = _origES.prototype;
  }
}catch(e){}

// Worker / SharedWorker
try{
  var _OW = window.Worker;
  if(_OW){
    window.Worker = function(u, o){
      try{ u = proxify(u); }catch(e){}
      return o ? new _OW(u, o) : new _OW(u);
    };
    window.Worker.prototype = _OW.prototype;
  }
}catch(e){}
try{
  var _OS = window.SharedWorker;
  if(_OS){
    window.SharedWorker = function(u, o){
      try{ u = proxify(u); }catch(e){}
      return o ? new _OS(u, o) : new _OS(u);
    };
    window.SharedWorker.prototype = _OS.prototype;
  }
}catch(e){}

// window.open
try{
  var _oOpen = window.open;
  window.open = function(u, t, f){
    try{ if(u) u = proxify(u); }catch(e){}
    return _oOpen ? _oOpen.call(this, u, '_self', f) : null;
  };
}catch(e){}

// HTMLImageElement.src
try{
  var _imgD = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if(_imgD && _imgD.set){
    var _imgSet = _imgD.set;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      get: _imgD.get,
      set: function(v){ try{v=proxify(v);}catch(e){} _imgSet.call(this, v); },
      configurable: true
    });
  }
}catch(e){}

// HTMLScriptElement.src
try{
  var _scrD = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  if(_scrD && _scrD.set){
    var _scrSet = _scrD.set;
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
      get: _scrD.get,
      set: function(v){ try{v=proxify(v);}catch(e){} _scrSet.call(this, v); },
      configurable: true
    });
  }
}catch(e){}

// HTMLLinkElement.href
try{
  var _lnkD = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
  if(_lnkD && _lnkD.set){
    var _lnkSet = _lnkD.set;
    Object.defineProperty(HTMLLinkElement.prototype, 'href', {
      get: _lnkD.get,
      set: function(v){ try{v=proxify(v);}catch(e){} _lnkSet.call(this, v); },
      configurable: true
    });
  }
}catch(e){}

// setAttribute interception for all elements
try{
  var _origSetAttr = Element.prototype.setAttribute;
  var _attrProxyMap = new Set(['src','href','action','poster','data-src','data-href','data-lazy','data-original']);
  Element.prototype.setAttribute = function(name, value){
    try{
      if(_attrProxyMap.has(name.toLowerCase()) && typeof value === 'string'){
        value = proxify(value);
      }
    }catch(e){}
    return _origSetAttr.call(this, name, value);
  };
}catch(e){}

// document.createElement interception — catch dynamically created elements
try{
  var _origCreate = document.createElement.bind(document);
  document.createElement = function(tag){
    var el = _origCreate(tag);
    var t = (tag||'').toLowerCase();
    if(t === 'script' || t === 'img' || t === 'link' || t === 'iframe' || t === 'video' || t === 'audio' || t === 'source'){
      // Wrap setAttribute on this element specifically for 'src' and 'href'
      // (already covered by Element.prototype.setAttribute override above)
    }
    return el;
  };
}catch(e){}

// location.assign / replace
try{
  var _oAssign  = location.assign.bind(location);
  var _oReplace = location.replace.bind(location);
  location.assign  = function(u){ try{u=proxify(u);}catch(e){} _oAssign(u); };
  location.replace = function(u){ try{u=proxify(u);}catch(e){} _oReplace(u); };
}catch(e){}

// history.pushState / replaceState — keep URL bar in sync
try{
  function wrapHistory(orig){
    return function(state, title, url2){
      try{ if(url2) url2 = proxify(url2); }catch(e){}
      var r = orig.call(this, state, title, url2);
      notifyParent(url2 || window.location.href);
      return r;
    };
  }
  history.pushState    = wrapHistory(history.pushState.bind(history));
  history.replaceState = wrapHistory(history.replaceState.bind(history));
}catch(e){}

// ══════════════════════════════════════
//  LINK CLICK INTERCEPTION — THE BIG FIX
//  Handles: relative, absolute, already-proxied hrefs
// ══════════════════════════════════════
document.addEventListener('click', function(e){
  var el = e.target;
  while(el && el.tagName !== 'A') el = el.parentElement;
  if(!el) return;

  var href = el.getAttribute('href');
  if(!href) return;
  href = href.trim();

  // Ignore non-navigating hrefs
  if(href.startsWith('#') || href.startsWith('javascript:') ||
     href.startsWith('mailto:') || href.startsWith('tel:')) return;

  var realUrl;

  // Case 1: already-proxied href (server-side rewritten)
  // e.g. href="/fetch?url=https%3A%2F%2Fexample.com%2Fpage"
  // or   href="https://myserver.com/fetch?url=..."
  var fetchIdx = href.indexOf('/fetch?url=');
  if(fetchIdx !== -1){
    var encoded = href.slice(fetchIdx + '/fetch?url='.length);
    try{ realUrl = decodeURIComponent(encoded); }
    catch(e){ realUrl = encoded; }
  } else {
    // Case 2: plain URL (relative or absolute)
    try{
      if(href.startsWith('//'))            realUrl = 'https:' + href;
      else if(/^https?:\\/\\//i.test(href)) realUrl = href;
      else                                 realUrl = new URL(href, __T).href;
    }catch(e){ return; }
  }

  // Now realUrl is the actual destination URL (not proxy-wrapped)
  e.preventDefault();
  e.stopPropagation();
  navigateParent(realUrl);
}, true);

// ── MutationObserver: patch dynamically inserted nodes ───────────────────────
function fixNode(node){
  if(!node || node.nodeType !== 1) return;
  var ATTRS = ['src','href','poster','action','data-src','data-lazy','data-lazy-src',
               'data-original','data-bg','data-background','data-image','data-url'];
  ATTRS.forEach(function(attr){
    try{
      var v = node.getAttribute(attr);
      if(!v) return;
      var p = proxify(v);
      if(p !== v) node.setAttribute(attr, p);
    }catch(e){}
  });

  // srcset
  try{
    var ss = node.getAttribute('srcset');
    if(ss){
      var rw = ss.split(',').map(function(part){
        var t = part.trim(); if(!t) return part;
        var sp = t.split(/\s+/); sp[0] = proxify(sp[0]); return sp.join(' ');
      }).join(', ');
      if(rw !== ss) node.setAttribute('srcset', rw);
    }
  }catch(e){}

  // inline style background-image
  try{
    if(node.style && node.style.backgroundImage){
      node.style.backgroundImage = node.style.backgroundImage.replace(
        /url\(["']?([^"')]+)["']?\)/g,
        function(m, u){ return 'url(' + proxify(u) + ')'; }
      );
    }
  }catch(e){}
}

// Fix existing nodes
try{ document.querySelectorAll('*').forEach(function(n){ try{fixNode(n);}catch(e){} }); }catch(e){}

// Fix future nodes
try{
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(node){
        if(node.nodeType !== 1) return;
        try{ fixNode(node); }catch(e){}
        try{ node.querySelectorAll('*').forEach(function(n){ try{fixNode(n);}catch(e){}; }); }catch(e){}
      });
      if(m.type === 'attributes' && m.target){
        try{ fixNode(m.target); }catch(e){}
      }
    });
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['src','srcset','href','data-src','data-lazy','data-original',
                      'action','poster','style','data-bg','data-background']
  });
}catch(e){}

// Notify parent of initial URL and track popstate
notifyParent(__T);
window.addEventListener('popstate', function(){ notifyParent(window.location.href); });

})();
</script>`;
}

module.exports = { rewriteHtml, rewriteCss, injectHelpers, prefix };
