"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — rewriter.js  v8
//  Server-side HTML/CSS/JS URL rewriting
//  + WASM-aware injected runtime sandbox
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

  // <meta http-equiv="refresh" content="0; url=...">
  html = html.replace(
    /(<meta\b[^>]*?\scontent=["'][^"']*?url=)([^"'\s;>]+)/gi,
    (_, pre, val) => `${pre}${rw(val)}`
  );

  // <link rel="preload|modulepreload" href>
  html = html.replace(
    /(<link\b[^>]*?\srel=["'](?:preload|modulepreload|prefetch)["'][^>]*?\shref=)(["'])([^"']+)\2/gi,
    (_, pre, q, val) => `${pre}${q}${rw(val)}${q}`
  );

  // <script type="module" src>  — already handled by src= above

  // <import-map> / <script type="importmap"> — rewrite JSON URLs
  html = html.replace(
    /(<script\b[^>]*?\stype=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/gi,
    (_, open, json, close) => {
      try {
        const obj = JSON.parse(json);
        const rewriteMap = (map) => {
          if (!map || typeof map !== 'object') return map;
          const out = {};
          for (const [k, v] of Object.entries(map)) {
            out[k] = typeof v === 'string' ? rw(v) : rewriteMap(v);
          }
          return out;
        };
        if (obj.imports) obj.imports = rewriteMap(obj.imports);
        if (obj.scopes)  obj.scopes  = rewriteMap(obj.scopes);
        return open + JSON.stringify(obj, null, 2) + close;
      } catch { return _ ; }
    }
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

  // @import url(...) and @import "..."
  css = css.replace(
    /@import\s+(?:url\(["']?([^"')]+)["']?\)|["']([^"']+)["'])([^;]*;?)/gi,
    (_, u1, u2, rest) => {
      const u = (u1 || u2 || "").trim();
      if (!u) return _;
      try {
        const abs = /^https?:\/\//i.test(u) ? u :
                    u.startsWith("//") ? "https:" + u :
                    u.startsWith("/") ? new URL(targetUrl).origin + u :
                    new URL(u, targetUrl).href;
        return `@import url("${pfx}${encodeURIComponent(abs)}")${rest}`;
      } catch { return _; }
    }
  );

  // url() references
  css = css.replace(
    /url\((["']?)([^"')]*)\1\)/gi,
    (match, q, u) => {
      u = (u || "").trim();
      if (!u || u.startsWith("data:") || u.startsWith("#") || u.startsWith(pfx)) return match;
      try {
        const abs = /^https?:\/\//i.test(u) ? u :
                    u.startsWith("//") ? "https:" + u :
                    u.startsWith("/") ? new URL(targetUrl).origin + u :
                    new URL(u, targetUrl).href;
        return `url(${q}${pfx}${encodeURIComponent(abs)}${q})`;
      } catch { return match; }
    }
  );

  return css;
}

// ── REWRITE JS (safe ES module rewriting) ─────────────────────────────────────
function rewriteJs(code, targetUrl, proxyBase) {
  const pfx = prefix(proxyBase);

  function rwImport(u) {
    if (!u) return u;
    const s = u.trim();
    if (!s || s.startsWith(pfx) || s.startsWith("data:") || s.startsWith("blob:") ||
        s.startsWith("#") || s.startsWith("chrome-extension:")) return u;
    try {
      let abs;
      if (/^https?:\/\//i.test(s)) abs = s;
      else if (s.startsWith("//"))  abs = "https:" + s;
      else if (s.startsWith("/"))   abs = new URL(targetUrl).origin + s;
      else                          abs = new URL(s, targetUrl).href;
      return pfx + encodeURIComponent(abs);
    } catch { return u; }
  }

  // static: import "url" and import ... from "url"
  code = code.replace(
    /\bimport\s+((?:[\w*{},\s]+\s+from\s+)?)(["'])((?!data:|blob:)[^"']+)\2/g,
    (_, pre, q, u) => `import ${pre}${q}${rwImport(u)}${q}`
  );

  // dynamic: import("url") with literal string
  code = code.replace(
    /\bimport\s*\(\s*(["'])((?!data:|blob:)[^"']+)\1\s*\)/g,
    (_, q, u) => `import(${q}${rwImport(u)}${q})`
  );

  // export ... from "url"
  code = code.replace(
    /\bexport\s+(\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+(["'])((?!data:|blob:)[^"']+)\2/g,
    (_, exp, q, u) => `export ${exp} from ${q}${rwImport(u)}${q}`
  );

  return code;
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
//  RUNTIME SANDBOX SCRIPT — v8
//  Injected into every proxied page.
//  Covers: fetch, XHR, WebSocket, EventSource, Worker,
//          WASM streaming APIs, CSSStyleSheet.insertRule,
//          dynamic createElement, setAttribute, MutationObserver,
//          history API, link click interception, location spoofing,
//          anti-detection (top/parent/frameElement/webdriver),
//          import.meta.url spoofing for module scripts
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

// ═══════════════════════════════
//  CORE: proxify(url) → proxy url
// ═══════════════════════════════
function proxify(u){
  if(!u || typeof u !== 'string') return u;
  var s = u.trim();
  if(!s) return u;
  if(s.startsWith(__P)) return u;
  if(s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('javascript:') ||
     s.startsWith('mailto:') || s.startsWith('tel:') || s.startsWith('about:') ||
     s.startsWith('#') || s.startsWith('chrome-extension:')) return u;
  // Strip already-proxied inner URLs
  var fi = s.indexOf('/fetch?url=');
  if(fi !== -1){
    try{
      var inner = decodeURIComponent(s.slice(fi + '/fetch?url='.length).split('&')[0]);
      return __P + encodeURIComponent(inner);
    }catch(e){}
  }
  if(/^https?:\\/\\//i.test(s)) return __P + encodeURIComponent(s);
  if(s.startsWith('//'))         return __P + encodeURIComponent('https:' + s);
  if(s.startsWith('/'))          return __P + encodeURIComponent(__O + s);
  try { return __P + encodeURIComponent(new URL(s, __T).href); }
  catch(e) { return u; }
}

// ══════════════════════
//  PARENT COMMUNICATION
// ══════════════════════
function notifyParent(href){
  if(!__PAR) return;
  try{
    var real = href || __T;
    var fi2 = real.indexOf('/fetch?url=');
    if(fi2 !== -1){ try{ real = decodeURIComponent(real.slice(fi2 + '/fetch?url='.length).split('&')[0]); }catch(e){} }
    __PAR.postMessage({type:'mos-url-update', url: real}, '*');
  }catch(e){}
}

function navigateParent(realUrl){
  if(__PAR){
    try{ __PAR.postMessage({type:'mos-navigate-proxy', url: realUrl}, '*'); return; }catch(e){}
  }
  try{ window.location.href = proxify(realUrl); }catch(e){}
}

// ════════════════════════════
//  ANTI-DETECTION & SPOOFING
// ════════════════════════════
try{ Object.defineProperty(window,'top',{get:function(){return window;},configurable:true}); }catch(e){}
try{ Object.defineProperty(window,'parent',{get:function(){return window;},configurable:true}); }catch(e){}
try{ Object.defineProperty(window,'frameElement',{get:function(){return null;},configurable:true}); }catch(e){}
try{ Object.defineProperty(navigator,'webdriver',{get:function(){return false;},configurable:true}); }catch(e){}
try{ Object.defineProperty(document,'referrer',{get:function(){return __O+'/';},configurable:true}); }catch(e){}

// chrome stub
try{
  if(!window.chrome) window.chrome={};
  if(!window.chrome.runtime) window.chrome.runtime={
    id:undefined,connect:function(){},sendMessage:function(){},
    onMessage:{addListener:function(){},removeListener:function(){},hasListeners:function(){return false;}},
    onConnect:{addListener:function(){},removeListener:function(){}}
  };
  if(!window.chrome.app) window.chrome.app={isInstalled:false};
}catch(e){}

// Block proxied page's own SW registration (they'd fight ours)
try{
  if('serviceWorker' in navigator){
    Object.defineProperty(navigator,'serviceWorker',{get:function(){
      return {
        register:function(){ return Promise.resolve({scope:'/',active:null,installing:null,waiting:null,addEventListener:function(){},removeEventListener:function(){}}); },
        unregister:function(){ return Promise.resolve(true); },
        getRegistration:function(){ return Promise.resolve(undefined); },
        getRegistrations:function(){ return Promise.resolve([]); },
        ready:Promise.resolve({scope:'/',active:null}),
        controller:null,
        addEventListener:function(){},
        removeEventListener:function(){}
      };
    },configurable:true});
  }
}catch(e){}

// Location spoofing
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
        var v=t[p]; return typeof v==='function'?v.bind(t):v;
      }
    });
  },configurable:true});
}catch(e){}

// CSP violation suppressor
try{ window.addEventListener('securitypolicyviolation',function(e){e.stopImmediatePropagation();e.preventDefault();},true); }catch(e){}

// ═══════════════════
//  FETCH INTERCEPTION
// ═══════════════════
try{
  var _origFetch = window.fetch;
  if(_origFetch){
    window.fetch = function(input, init){
      try{
        if(typeof input === 'string') input = proxify(input);
        else if(input instanceof Request){ input = new Request(proxify(input.url), input); }
      }catch(e){}
      return _origFetch.call(this, input, init);
    };
    try{ Object.defineProperty(window.fetch,'toString',{value:function(){return _origFetch.toString();}}); }catch(e){}
  }
}catch(e){}

// ═══════════════════
//  XHR INTERCEPTION
// ═══════════════════
try{
  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url2){
    var args = Array.prototype.slice.call(arguments);
    try{ args[1] = proxify(url2); }catch(e){}
    return _origOpen.apply(this, args);
  };
}catch(e){}

// sendBeacon
try{
  if(navigator.sendBeacon){
    var _origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(u, d){
      try{ u = proxify(u); }catch(e){}
      return _origBeacon(u, d);
    };
  }
}catch(e){}

// ═══════════════════════════════
//  WEBSOCKET INTERCEPTION
// ═══════════════════════════════
try{
  var _origWS = window.WebSocket;
  if(_origWS){
    window.WebSocket = function(url2, protocols){
      try{
        var wsUrl = url2.replace(/^wss:\\/\\//, 'https://').replace(/^ws:\\/\\//, 'http://');
        var proxied = proxify(wsUrl);
        url2 = proxied.replace(/^https?:\\/\\//, function(m){ return url2.startsWith('wss://') ? 'wss://' : 'ws://'; });
      }catch(e){}
      return protocols ? new _origWS(url2, protocols) : new _origWS(url2);
    };
    window.WebSocket.prototype = _origWS.prototype;
    Object.assign(window.WebSocket, {CONNECTING:0, OPEN:1, CLOSING:2, CLOSED:3});
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

// ════════════════════════════════
//  WEBASSEMBLY STREAMING PATCHING
//  Intercept WASM fetch sources so
//  they route through the proxy
// ════════════════════════════════
try{
  var _WA = window.WebAssembly;
  if(_WA){
    // wrapSource: ensures the source Response/Promise uses proxified fetch
    function _waWrap(src){
      if(!src) return src;
      // Already a Promise<Response> from our patched fetch — leave alone
      if(src && typeof src.then === 'function') return src;
      // String URL (non-standard but some libs do it)
      if(typeof src === 'string') return fetch(proxify(src));
      // Request object
      if(typeof Request !== 'undefined' && src instanceof Request){
        return fetch(new Request(proxify(src.url), src));
      }
      return src;
    }

    var _origInstStream = _WA.instantiateStreaming;
    if(_origInstStream){
      _WA.instantiateStreaming = function(source, importObj){
        return _origInstStream.call(_WA, _waWrap(source), importObj);
      };
    }

    var _origCompStream = _WA.compileStreaming;
    if(_origCompStream){
      _WA.compileStreaming = function(source){
        return _origCompStream.call(_WA, _waWrap(source));
      };
    }

    // instantiate with URL string (rare but possible)
    var _origInst = _WA.instantiate;
    if(_origInst){
      _WA.instantiate = function(bufOrMod, importObj){
        if(typeof bufOrMod === 'string'){
          return fetch(proxify(bufOrMod))
            .then(function(r){ return r.arrayBuffer(); })
            .then(function(buf){ return _origInst.call(_WA, buf, importObj); });
        }
        return _origInst.call(_WA, bufOrMod, importObj);
      };
    }
  }
}catch(e){}

// ══════════════════════════════════════
//  CSS DYNAMIC INJECTION PATCHING
//  Covers: insertRule, addRule, @import
//  so CSS-in-JS libraries work correctly
// ══════════════════════════════════════
try{
  function _patchCssText(text){
    if(!text || typeof text !== 'string') return text;
    return text.replace(/url\((['"]?)([^'")\s]+)\1\)/g, function(m, q, u){
      try{ return 'url(' + q + proxify(u) + q + ')'; }catch(e){ return m; }
    });
  }

  if(window.CSSStyleSheet && CSSStyleSheet.prototype.insertRule){
    var _origInsertRule = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function(rule, idx){
      try{ rule = _patchCssText(rule); }catch(e){}
      return _origInsertRule.call(this, rule, idx);
    };
  }

  if(window.CSSStyleSheet && CSSStyleSheet.prototype.addRule){
    var _origAddRule = CSSStyleSheet.prototype.addRule;
    CSSStyleSheet.prototype.addRule = function(sel, style, idx){
      try{ style = _patchCssText(style); }catch(e){}
      return _origAddRule.call(this, sel, style, idx);
    };
  }

  // CSS.replace (Constructable Stylesheets)
  if(window.CSSStyleSheet && CSSStyleSheet.prototype.replace){
    var _origReplace = CSSStyleSheet.prototype.replace;
    CSSStyleSheet.prototype.replace = function(text){
      try{ text = _patchCssText(text); }catch(e){}
      return _origReplace.call(this, text);
    };
  }
  if(window.CSSStyleSheet && CSSStyleSheet.prototype.replaceSync){
    var _origReplaceSync = CSSStyleSheet.prototype.replaceSync;
    CSSStyleSheet.prototype.replaceSync = function(text){
      try{ text = _patchCssText(text); }catch(e){}
      return _origReplaceSync.call(this, text);
    };
  }

  // style.setProperty for background-image etc.
  if(window.CSSStyleDeclaration && CSSStyleDeclaration.prototype.setProperty){
    var _origSetProp = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function(prop, val, priority){
      try{
        if(prop && /background|src|image|url/i.test(prop) && val){
          val = _patchCssText(val);
        }
      }catch(e){}
      return _origSetProp.call(this, prop, val, priority);
    };
  }
}catch(e){}

// ════════════════════════════
//  WINDOW.OPEN + ASSIGNMENT
// ════════════════════════════
try{
  var _oOpen = window.open;
  window.open = function(u, t, f){
    try{ if(u) u = proxify(u); }catch(e){}
    return _oOpen ? _oOpen.call(this, u, '_self', f) : null;
  };
}catch(e){}

// location.assign / replace
try{
  var _oAssign  = location.assign.bind(location);
  var _oReplace = location.replace.bind(location);
  location.assign  = function(u){ try{u=proxify(u);}catch(e){} _oAssign(u); };
  location.replace = function(u){ try{u=proxify(u);}catch(e){} _oReplace(u); };
}catch(e){}

// ════════════════════════════════
//  ELEMENT PROPERTY INTERCEPTORS
// ════════════════════════════════
function _defSrcProp(proto, prop){
  try{
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if(d && d.set){
      var orig = d.set;
      Object.defineProperty(proto, prop, {
        get: d.get,
        set: function(v){ try{v=proxify(v);}catch(e){} orig.call(this,v); },
        configurable:true
      });
    }
  }catch(e){}
}
_defSrcProp(HTMLImageElement.prototype, 'src');
_defSrcProp(HTMLScriptElement.prototype, 'src');
_defSrcProp(HTMLLinkElement.prototype, 'href');
_defSrcProp(HTMLIFrameElement.prototype, 'src');
_defSrcProp(HTMLVideoElement.prototype, 'src');
_defSrcProp(HTMLAudioElement.prototype, 'src');
_defSrcProp(HTMLSourceElement.prototype, 'src');
_defSrcProp(HTMLTrackElement.prototype, 'src');

// setAttribute interception
try{
  var _origSetAttr = Element.prototype.setAttribute;
  var _proxyAttrs = new Set(['src','href','action','poster','data-src','data-href',
                              'data-lazy','data-original','srcset']);
  Element.prototype.setAttribute = function(name, value){
    try{
      var n = name.toLowerCase();
      if(_proxyAttrs.has(n) && typeof value === 'string'){
        if(n === 'srcset'){
          value = value.split(',').map(function(p){
            var t=p.trim(); if(!t) return p;
            var sp=t.split(/\s+/); sp[0]=proxify(sp[0]); return sp.join(' ');
          }).join(', ');
        } else {
          value = proxify(value);
        }
      }
    }catch(e){}
    return _origSetAttr.call(this, name, value);
  };
}catch(e){}

// innerHTML / outerHTML setter — rewrite injected markup
try{
  function _rewriteMarkup(html){
    if(!html || typeof html !== 'string') return html;
    return html
      .replace(/(src|href|action|poster|data-src)=(["'])([^"']+)\2/gi, function(m, a, q, v){
        try{ return a+'='+q+proxify(v)+q; }catch(e){ return m; }
      })
      .replace(/url\((['"]?)([^'")\s]+)\1\)/g, function(m, q, u){
        try{ return 'url('+q+proxify(u)+q+')'; }catch(e){ return m; }
      });
  }
  var _patchInnerHTML = function(proto, prop){
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if(!d || !d.set) return;
    var origSet = d.set;
    Object.defineProperty(proto, prop, {
      get: d.get,
      set: function(v){ try{v=_rewriteMarkup(v);}catch(e){} origSet.call(this,v); },
      configurable: true
    });
  };
  _patchInnerHTML(Element.prototype, 'innerHTML');
  _patchInnerHTML(Element.prototype, 'outerHTML');
  if(window.ShadowRoot) _patchInnerHTML(ShadowRoot.prototype, 'innerHTML');
}catch(e){}

// history API
try{
  function _wrapHistory(orig){
    return function(state, title, url2){
      try{ if(url2) url2 = proxify(url2); }catch(e){}
      var r = orig.call(this, state, title, url2);
      notifyParent(url2 || window.location.href);
      return r;
    };
  }
  history.pushState    = _wrapHistory(history.pushState.bind(history));
  history.replaceState = _wrapHistory(history.replaceState.bind(history));
}catch(e){}

// ════════════════════════════════════════
//  LINK CLICK INTERCEPTION — NAVIGATION
// ════════════════════════════════════════
document.addEventListener('click', function(e){
  var el = e.target;
  while(el && el.tagName !== 'A') el = el.parentElement;
  if(!el) return;
  var href = el.getAttribute('href');
  if(!href) return;
  href = href.trim();
  if(href.startsWith('#') || href.startsWith('javascript:') ||
     href.startsWith('mailto:') || href.startsWith('tel:')) return;

  var realUrl;
  var fetchIdx = href.indexOf('/fetch?url=');
  if(fetchIdx !== -1){
    var encoded = href.slice(fetchIdx + '/fetch?url='.length).split('&')[0];
    try{ realUrl = decodeURIComponent(encoded); }catch(e){ realUrl = encoded; }
  } else {
    try{
      if(href.startsWith('//'))            realUrl = 'https:' + href;
      else if(/^https?:\\/\\//i.test(href)) realUrl = href;
      else                                 realUrl = new URL(href, __T).href;
    }catch(e){ return; }
  }

  e.preventDefault();
  e.stopPropagation();
  navigateParent(realUrl);
}, true);

// ═══════════════════════════════════════
//  MUTATIONOBSERVER — patch dynamic nodes
// ═══════════════════════════════════════
function _fixNode(node){
  if(!node || node.nodeType !== 1) return;
  var ATTRS = ['src','href','poster','action','data-src','data-lazy','data-lazy-src',
               'data-original','data-bg','data-background','data-image','data-url'];
  ATTRS.forEach(function(attr){
    try{
      var v = node.getAttribute && node.getAttribute(attr);
      if(!v) return;
      var p = proxify(v);
      if(p !== v) node.setAttribute(attr, p);
    }catch(e){}
  });
  // srcset
  try{
    var ss = node.getAttribute && node.getAttribute('srcset');
    if(ss){
      var rw = ss.split(',').map(function(part){
        var t=part.trim(); if(!t) return part;
        var sp=t.split(/\s+/); sp[0]=proxify(sp[0]); return sp.join(' ');
      }).join(', ');
      if(rw !== ss) node.setAttribute('srcset', rw);
    }
  }catch(e){}
  // inline style background
  try{
    if(node.style && node.style.backgroundImage){
      node.style.backgroundImage = node.style.backgroundImage.replace(
        /url\(["']?([^"')]+)["']?\)/g,
        function(m, u){ try{ return 'url(' + proxify(u) + ')'; }catch(e){ return m; } }
      );
    }
  }catch(e){}
}

// Patch existing DOM
try{ document.querySelectorAll('*').forEach(function(n){ try{_fixNode(n);}catch(e){}; }); }catch(e){}

// Patch future DOM mutations
try{
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(node){
        if(node.nodeType !== 1) return;
        try{ _fixNode(node); }catch(e){}
        try{ node.querySelectorAll('*').forEach(function(n){ try{_fixNode(n);}catch(e){}; }); }catch(e){}
      });
      if(m.type === 'attributes' && m.target){ try{ _fixNode(m.target); }catch(e){} }
    });
  }).observe(document.documentElement, {
    childList:true, subtree:true, attributes:true,
    attributeFilter:['src','srcset','href','data-src','data-lazy','data-original',
                     'action','poster','style','data-bg','data-background']
  });
}catch(e){}

// Initial notify + popstate tracking
notifyParent(__T);
window.addEventListener('popstate', function(){ notifyParent(window.location.href); });

// Module script import.meta.url spoofing
// We inject a global __mos_meta_url that module scripts can reference
try{ window.__mos_meta_url = __T; }catch(e){}

})();
</script>`;
}

module.exports = { rewriteHtml, rewriteCss, rewriteJs, injectHelpers, prefix };
