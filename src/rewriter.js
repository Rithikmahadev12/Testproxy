"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — rewriter.js  v9
//  Fix: \\1 / \\2 inside template literal (Node v25 strict octal ban)
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

  html = html.replace(
    /(\s)(src)=(["'])(.*?)\3/gi,
    (_, sp, attr, q, val) => `${sp}${attr}=${q}${rw(val)}${q}`
  );

  html = html.replace(
    /(<link\b[^>]*?\s)(href)=(["'])(.*?)\3/gi,
    (_, pre, attr, q, val) => `${pre}${attr}=${q}${rw(val)}${q}`
  );

  html = html.replace(
    /(<form\b[^>]*?\s)(action)=(["'])(.*?)\3/gi,
    (_, pre, attr, q, val) => `${pre}${attr}=${q}${rw(val)}${q}`
  );

  html = html.replace(
    /(\s)(data-src|data-href|data-lazy|data-lazy-src|data-original|data-url|data-image|data-background|data-bg|data-thumb|data-full|data-link|data-path|data-poster)=(["'])(.*?)\3/gi,
    (_, sp, attr, q, val) => `${sp}${attr}=${q}${rw(val)}${q}`
  );

  html = html.replace(
    /(\s)(poster)=(["'])(.*?)\3/gi,
    (_, sp, attr, q, val) => `${sp}${attr}=${q}${rw(val)}${q}`
  );

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

  html = html.replace(
    /(style=["'][^"']*?)url\((["']?)([^"')]+)\2\)/gi,
    (_, pre, q, u) => `${pre}url(${q}${rw(u.trim())}${q})`
  );

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

  html = html.replace(
    /(<a\b[^>]*?\s)(href)=(["'])((?!#|javascript:|mailto:|tel:)[^"']+)\3/gi,
    (_, pre, attr, q, val) => `${pre}${attr}=${q}${rw(val)}${q}`
  );

  html = html.replace(
    /(<meta\b[^>]*?\scontent=["'][^"']*?url=)([^"'\s;>]+)/gi,
    (_, pre, val) => `${pre}${rw(val)}`
  );

  html = html.replace(
    /(<link\b[^>]*?\srel=["'](?:preload|modulepreload|prefetch)["'][^>]*?\shref=)(["'])([^"']+)\2/gi,
    (_, pre, q, val) => `${pre}${q}${rw(val)}${q}`
  );

  html = html.replace(
    /(<script\b[^>]*?\stype=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/gi,
    (_, open, json, close) => {
      try {
        const obj = JSON.parse(json);
        const rewriteMap = (map) => {
          if (!map || typeof map !== "object") return map;
          const out = {};
          for (const [k, v] of Object.entries(map)) {
            out[k] = typeof v === "string" ? rw(v) : rewriteMap(v);
          }
          return out;
        };
        if (obj.imports) obj.imports = rewriteMap(obj.imports);
        if (obj.scopes)  obj.scopes  = rewriteMap(obj.scopes);
        return open + JSON.stringify(obj, null, 2) + close;
      } catch { return _; }
    }
  );

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

  code = code.replace(
    /\bimport\s+((?:[\w*{},\s]+\s+from\s+)?)(["'])((?!data:|blob:)[^"']+)\2/g,
    (_, pre, q, u) => `import ${pre}${q}${rwImport(u)}${q}`
  );

  code = code.replace(
    /\bimport\s*\(\s*(["'])((?!data:|blob:)[^"']+)\1\s*\)/g,
    (_, q, u) => `import(${q}${rwImport(u)}${q})`
  );

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
//  RUNTIME SANDBOX — v9
//  KEY FIX: regex backreferences inside this template literal
//  must use \\1 / \\2 (not \1 / \2) because Node.js v25 treats
//  \1 as an octal escape sequence in template strings (strict mode).
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

var __PAR = null;
try{
  if(window.parent && window.parent !== window) __PAR = window.parent;
}catch(e){}

// ── proxify ──────────────────────────────────────────────────────────────────
function proxify(u){
  if(!u || typeof u !== 'string') return u;
  var s = u.trim();
  if(!s) return u;
  if(s.startsWith(__P)) return u;
  if(s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('javascript:') ||
     s.startsWith('mailto:') || s.startsWith('tel:') || s.startsWith('about:') ||
     s.startsWith('#') || s.startsWith('chrome-extension:')) return u;
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

// ── parent comms ──────────────────────────────────────────────────────────────
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

// ── anti-detection ────────────────────────────────────────────────────────────
try{ Object.defineProperty(window,'top',{get:function(){return window;},configurable:true}); }catch(e){}
try{ Object.defineProperty(window,'parent',{get:function(){return window;},configurable:true}); }catch(e){}
try{ Object.defineProperty(window,'frameElement',{get:function(){return null;},configurable:true}); }catch(e){}
try{ Object.defineProperty(navigator,'webdriver',{get:function(){return false;},configurable:true}); }catch(e){}
try{ Object.defineProperty(document,'referrer',{get:function(){return __O+'/';},configurable:true}); }catch(e){}

try{
  if(!window.chrome) window.chrome={};
  if(!window.chrome.runtime) window.chrome.runtime={
    id:undefined,connect:function(){},sendMessage:function(){},
    onMessage:{addListener:function(){},removeListener:function(){},hasListeners:function(){return false;}},
    onConnect:{addListener:function(){},removeListener:function(){}}
  };
  if(!window.chrome.app) window.chrome.app={isInstalled:false};
}catch(e){}

// Block inner SW registration
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

// Location spoof
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

try{ window.addEventListener('securitypolicyviolation',function(e){e.stopImmediatePropagation();e.preventDefault();},true); }catch(e){}

// ── fetch ─────────────────────────────────────────────────────────────────────
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
  }
}catch(e){}

// ── XHR ──────────────────────────────────────────────────────────────────────
try{
  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url2){
    var args = Array.prototype.slice.call(arguments);
    try{ args[1] = proxify(url2); }catch(e){}
    return _origOpen.apply(this, args);
  };
}catch(e){}

try{
  if(navigator.sendBeacon){
    var _origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(u, d){
      try{ u = proxify(u); }catch(e){}
      return _origBeacon(u, d);
    };
  }
}catch(e){}

// ── WebSocket ─────────────────────────────────────────────────────────────────
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

// ── EventSource / Worker ──────────────────────────────────────────────────────
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

// ── WASM streaming ────────────────────────────────────────────────────────────
try{
  var _WA = window.WebAssembly;
  if(_WA){
    function _waWrap(src){
      if(!src) return src;
      if(src && typeof src.then === 'function') return src;
      if(typeof src === 'string') return fetch(proxify(src));
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

// ── CSS dynamic injection ─────────────────────────────────────────────────────
// NOTE: \\1 is used here (not \1) because this is inside a JS template literal.
// The double-backslash produces a literal \1 in the injected script,
// which is a valid regex backreference inside the proxied page's runtime.
try{
  function _patchCssText(text){
    if(!text || typeof text !== 'string') return text;
    return text.replace(/url\\((['"]?)([^'")\s]+)\\1\\)/g, function(m, q, u){
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

// ── window.open / location ────────────────────────────────────────────────────
try{
  var _oOpen = window.open;
  window.open = function(u, t, f){
    try{ if(u) u = proxify(u); }catch(e){}
    return _oOpen ? _oOpen.call(this, u, '_self', f) : null;
  };
}catch(e){}

try{
  var _oAssign  = location.assign.bind(location);
  var _oReplace = location.replace.bind(location);
  location.assign  = function(u){ try{u=proxify(u);}catch(e){} _oAssign(u); };
  location.replace = function(u){ try{u=proxify(u);}catch(e){} _oReplace(u); };
}catch(e){}

// ── element property interceptors ─────────────────────────────────────────────
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
_defSrcProp(HTMLImageElement.prototype,  'src');
_defSrcProp(HTMLScriptElement.prototype, 'src');
_defSrcProp(HTMLLinkElement.prototype,   'href');
_defSrcProp(HTMLIFrameElement.prototype, 'src');
_defSrcProp(HTMLVideoElement.prototype,  'src');
_defSrcProp(HTMLAudioElement.prototype,  'src');
_defSrcProp(HTMLSourceElement.prototype, 'src');
_defSrcProp(HTMLTrackElement.prototype,  'src');

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
            var sp=t.split(/\\s+/); sp[0]=proxify(sp[0]); return sp.join(' ');
          }).join(', ');
        } else {
          value = proxify(value);
        }
      }
    }catch(e){}
    return _origSetAttr.call(this, name, value);
  };
}catch(e){}

// innerHTML / outerHTML — NOTE: \\2 and \\1 (not \2/\1) for same reason as above
try{
  function _rewriteMarkup(html){
    if(!html || typeof html !== 'string') return html;
    return html
      .replace(/(src|href|action|poster|data-src)=(["'])([^"']+)\\2/gi, function(m, a, q, v){
        try{ return a+'='+q+proxify(v)+q; }catch(e){ return m; }
      })
      .replace(/url\\((['"]?)([^'")\s]+)\\1\\)/g, function(m, q, u){
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

// ── history API ───────────────────────────────────────────────────────────────
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

// ── link click interception ───────────────────────────────────────────────────
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

// ── MutationObserver ──────────────────────────────────────────────────────────
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
  try{
    var ss = node.getAttribute && node.getAttribute('srcset');
    if(ss){
      var rw = ss.split(',').map(function(part){
        var t=part.trim(); if(!t) return part;
        var sp=t.split(/\\s+/); sp[0]=proxify(sp[0]); return sp.join(' ');
      }).join(', ');
      if(rw !== ss) node.setAttribute('srcset', rw);
    }
  }catch(e){}
  try{
    if(node.style && node.style.backgroundImage){
      node.style.backgroundImage = node.style.backgroundImage.replace(
        /url\\(["']?([^"')]+)["']?\\)/g,
        function(m, u){ try{ return 'url(' + proxify(u) + ')'; }catch(e){ return m; } }
      );
    }
  }catch(e){}
}

try{ document.querySelectorAll('*').forEach(function(n){ try{_fixNode(n);}catch(e){}; }); }catch(e){}

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

notifyParent(__T);
window.addEventListener('popstate', function(){ notifyParent(window.location.href); });
try{ window.__mos_meta_url = __T; }catch(e){}

})();
</script>`;
}

module.exports = { rewriteHtml, rewriteCss, rewriteJs, injectHelpers, prefix };
