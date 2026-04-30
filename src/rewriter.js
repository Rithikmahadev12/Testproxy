"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — src/rewriter.js
//  Rewrites proxied HTML/CSS so all
//  sub-resources route back through /fetch
// ══════════════════════════════════════

function proxyPrefix(proxyBase) {
  return `${proxyBase}/fetch?url=`;
}

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

  html = html.replace(
    /(\s(?:src|href|action|data-src|data-href|data-lazy|data-lazy-src|data-original|data-url|poster|data-background|data-bg))=(["'])(.*?)\2/gi,
    (match, attr, quote, val) => `${attr}=${quote}${rw(val)}${quote}`
  );

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

  html = html.replace(/url\((["']?)([^"')]*)\1\)/gi, (match, quote, u) => {
    if (!u || !u.trim()) return match;
    return `url(${quote}${rw(u.trim())}${quote})`;
  });

  html = html.replace(
    /(<meta[^>]+content=["'][^"']*url=)(https?:\/\/[^"']+)/gi,
    (match, pre, u) => `${pre}${prefix}${encodeURIComponent(u)}`
  );

  return html;
}

// ── CSS rewriter ─────────────────────────────────────────────────────────────
function rewriteCss(css, targetUrl, proxyBase) {
  const prefix = proxyPrefix(proxyBase);

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

// ── Runtime injection ─────────────────────────────────────────────────────────
function injectHelpers(html, targetUrl, proxyBase) {
  const prefix = proxyPrefix(proxyBase);
  const origin = new URL(targetUrl).origin;

  const baseTag = `<base href="${targetUrl}">`;

  // Build the injected script as a plain string (no template-literal nesting issues)
  const helperScript = `<script data-mos-proxy="1">
(function(){
  var _realParent = window.parent;
  var _prefix    = ${JSON.stringify(prefix)};
  var _origin    = ${JSON.stringify(origin)};
  var _targetUrl = ${JSON.stringify(targetUrl)};

  /* ═══════════════════════════════════════════════
     PHASE 1 – ANTI-DETECTION SPOOFS
     Must run before ANY site script.
  ═══════════════════════════════════════════════ */

  /* 1. top / parent / frameElement */
  try { Object.defineProperty(window,'top',   {get:function(){return window.self;},configurable:true}); } catch(e){}
  try { Object.defineProperty(window,'parent',{get:function(){return window.self;},configurable:true}); } catch(e){}
  try { Object.defineProperty(window,'frameElement',{get:function(){return null;},configurable:true}); } catch(e){}

  /* 2. navigator.webdriver */
  try { Object.defineProperty(navigator,'webdriver',{get:function(){return false;},configurable:true}); } catch(e){}

  /* 3. window.chrome — sites check this to confirm real Chrome */
  try {
    if (!window.chrome) {
      window.chrome = {
        app:{ isInstalled:false },
        runtime:{
          id:undefined,
          connect:function(){},
          sendMessage:function(){},
          onMessage:{ addListener:function(){}, removeListener:function(){}, hasListeners:function(){return false;} },
          onConnect:{ addListener:function(){}, removeListener:function(){} }
        },
        loadTimes:function(){
          return {requestTime:Date.now()/1000-0.1,startLoadTime:Date.now()/1000-0.09,
                  commitLoadTime:Date.now()/1000-0.05,finishDocumentLoadTime:Date.now()/1000,
                  finishLoadTime:Date.now()/1000+0.01,firstPaintTime:Date.now()/1000-0.04,
                  firstPaintAfterLoadTime:0,navigationType:'Other',wasFetchedViaSpdy:false,
                  wasNpnNegotiated:true,npnNegotiatedProtocol:'h2',wasAlternateProtocolAvailable:false,connectionInfo:'h2'};
        },
        csi:function(){ return {startE:Date.now(),onloadT:Date.now()+10,pageT:1234.5,tran:15}; }
      };
    }
  } catch(e){}

  /* 4. navigator.plugins — empty = headless */
  try {
    var _fp = [{name:'Chrome PDF Plugin',description:'Portable Document Format',filename:'internal-pdf-viewer'},
               {name:'Chrome PDF Viewer',description:'',filename:'mhjfbmdgcfjbbpaeojofohoefgiehjai'},
               {name:'Native Client',description:'',filename:'internal-nacl-plugin'},
               {name:'WebKit built-in PDF',description:'WebKit built-in PDF',filename:'WebKit built-in PDF'}];
    _fp.item=function(i){return _fp[i]||null;};
    _fp.namedItem=function(n){for(var i=0;i<_fp.length;i++)if(_fp[i].name===n)return _fp[i];return null;};
    _fp.refresh=function(){};
    Object.defineProperty(navigator,'plugins',{get:function(){return _fp;},configurable:true});
    Object.defineProperty(navigator,'mimeTypes',{get:function(){var m={length:2};m.item=function(){return null;};m.namedItem=function(){return null;};return m;},configurable:true});
  } catch(e){}

  /* 5. outerWidth / outerHeight — iframes expose 0 */
  try { Object.defineProperty(window,'outerWidth', {get:function(){return window.screen.width;},configurable:true}); } catch(e){}
  try { Object.defineProperty(window,'outerHeight',{get:function(){return window.screen.height-80;},configurable:true}); } catch(e){}

  /* 6. Permissions API */
  try {
    if (navigator.permissions && navigator.permissions.query) {
      var _pq = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function(d){
        if (d && (d.name==='notifications'||d.name==='push'||d.name==='clipboard-read'||d.name==='clipboard-write'))
          return Promise.resolve({state:'prompt',onchange:null});
        return _pq(d);
      };
    }
  } catch(e){}

  /* 7. Block service workers */
  try {
    if ('serviceWorker' in navigator) {
      Object.defineProperty(navigator,'serviceWorker',{
        get:function(){
          return {
            register:function(){return Promise.resolve({scope:'/',active:null,installing:null,waiting:null,addEventListener:function(){},removeEventListener:function(){},dispatchEvent:function(){return false;}});},
            unregister:function(){return Promise.resolve(true);},
            getRegistration:function(){return Promise.resolve(undefined);},
            getRegistrations:function(){return Promise.resolve([]);},
            ready:Promise.resolve({scope:'/',active:null}),
            controller:null,
            addEventListener:function(){},
            removeEventListener:function(){},
            dispatchEvent:function(){return false;}
          };
        }, configurable:true
      });
    }
  } catch(e){}

  /* 8. document.referrer — look like same-origin */
  try {
    Object.defineProperty(document,'referrer',{get:function(){return _origin+'/';},configurable:true});
  } catch(e){}

  /* 9. performance.navigation.type = 0 (normal navigation) */
  try {
    if (window.performance && window.performance.navigation)
      Object.defineProperty(window.performance.navigation,'type',{get:function(){return 0;},configurable:true});
  } catch(e){}

  /* 10. window.location Proxy — site sees real URL */
  try {
    var _parsed = (function(){ try{return new URL(_targetUrl);}catch(e){return null;} })();
    if (_parsed) {
      Object.defineProperty(window,'location',{
        get:function(){
          return new Proxy(window.location,{
            get:function(t,p){
              if(p==='href')     return _targetUrl;
              if(p==='origin')   return _origin;
              if(p==='host')     return _parsed.host;
              if(p==='hostname') return _parsed.hostname;
              if(p==='pathname') return _parsed.pathname;
              if(p==='search')   return _parsed.search;
              if(p==='hash')     return _parsed.hash;
              if(p==='protocol') return _parsed.protocol;
              if(p==='port')     return _parsed.port;
              if(typeof t[p]==='function') return t[p].bind(t);
              return t[p];
            }
          });
        }, configurable:true
      });
    }
  } catch(e){}

  /* 11. Silence CSP violation events */
  try { window.addEventListener('securitypolicyviolation',function(e){e.stopImmediatePropagation();},true); } catch(e){}

  /* ═══════════════════════════════════════════════
     PHASE 2 – PROXY ROUTING
  ═══════════════════════════════════════════════ */

  function proxify(u) {
    if (!u || typeof u !== 'string') return u;
    var s = u.trim();
    if (!s || s.startsWith(_prefix) ||
        s.startsWith('data:') || s.startsWith('blob:') ||
        s.startsWith('javascript:') || s.startsWith('mailto:') ||
        s.startsWith('tel:') || s.startsWith('#')) return u;
    if (s.startsWith('//'))               return _prefix+encodeURIComponent('https:'+s);
    if (/^https?:\\/\\//i.test(s))        return _prefix+encodeURIComponent(s);
    if (s.startsWith('/'))                return _prefix+encodeURIComponent(_origin+s);
    try { return _prefix+encodeURIComponent(new URL(s,_targetUrl).href); } catch(e) { return u; }
  }

  /* fetch */
  var _origFetch = window.fetch;
  if (_origFetch) {
    window.fetch = function(input, init) {
      try {
        if (typeof input==='string') input=proxify(input);
        else if (input && typeof input==='object' && input.url) input=new Request(proxify(input.url),input);
      } catch(e){}
      return _origFetch.call(this, input, init);
    };
  }

  /* XHR */
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method,url) {
    var args=Array.prototype.slice.call(arguments);
    try{ args[1]=proxify(url); }catch(e){}
    return _xhrOpen.apply(this,args);
  };

  /* location.assign / replace */
  try {
    var _oAssign  = location.assign.bind(location);
    var _oReplace = location.replace.bind(location);
    location.assign  = function(u){ try{u=proxify(u);}catch(e){} _oAssign(u); };
    location.replace = function(u){ try{u=proxify(u);}catch(e){} _oReplace(u); };
  } catch(e){}

  /* history */
  function patchH(orig){
    return function(state,title,url){
      try{ if(url) url=proxify(url); }catch(e){}
      var r=orig.call(this,state,title,url);
      notifyUrl(url||window.location.href);
      return r;
    };
  }
  try {
    history.pushState    = patchH(history.pushState.bind(history));
    history.replaceState = patchH(history.replaceState.bind(history));
  } catch(e){}

  /* Worker / SharedWorker */
  try { var _OW=window.Worker;    if(_OW){ window.Worker=function(u,o){try{u=proxify(u);}catch(e){} return new _OW(u,o);}; window.Worker.prototype=_OW.prototype; } } catch(e){}
  try { var _OS=window.SharedWorker; if(_OS){ window.SharedWorker=function(u,o){try{u=proxify(u);}catch(e){} return new _OS(u,o);}; window.SharedWorker.prototype=_OS.prototype; } } catch(e){}

  /* window.open */
  var _wo=window.open;
  window.open=function(u,t,f){ try{if(u)u=proxify(u);}catch(e){} return _wo?_wo.call(this,u,'_self',f):null; };

  /* ── Notify parent of real URL ─────────────────────────────────────── */
  function notifyUrl(h) {
    try {
      var real = h || _targetUrl;
      if (real.indexOf(_prefix)!==-1) {
        var enc=real.slice(real.indexOf(_prefix)+_prefix.length);
        try{ real=decodeURIComponent(enc); }catch(e){}
      }
      _realParent.postMessage({type:'mos-url-update',url:real},'*');
    } catch(e){}
  }

  /* ── Link click → parent drives navigation ─────────────────────────── */
  document.addEventListener('click',function(e){
    var el=e.target;
    while(el && el.tagName!=='A') el=el.parentElement;
    if(!el) return;
    var href=el.getAttribute('href');
    if(!href||href.startsWith('#')||href.startsWith('javascript:')||href.startsWith('mailto:')||href.startsWith('tel:')) return;
    if(href.startsWith(_prefix)) return;
    var abs;
    try {
      if(href.startsWith('//'))        abs='https:'+href;
      else if(/^https?:\\/\\//i.test(href)) abs=href;
      else abs=new URL(href,_targetUrl).href;
    } catch(e){ return; }
    e.preventDefault();
    e.stopPropagation();
    try{ _realParent.postMessage({type:'mos-navigate-proxy',url:abs},'*'); }catch(err){}
  },true);

  /* ── MutationObserver: fix dynamically injected nodes ──────────────── */
  function fixNode(node) {
    if(!node||node.nodeType!==1) return;
    var tag=(node.tagName||'').toUpperCase();
    if(tag==='IMG'||tag==='SOURCE'){
      var src=node.getAttribute('src');
      if(src){var ps=proxify(src);if(ps!==src)node.setAttribute('src',ps);}
      var ss=node.getAttribute('srcset');
      if(ss){
        var rw=ss.split(',').map(function(p){var t=p.trim();if(!t)return p;var sp=t.split(/\s+/);sp[0]=proxify(sp[0]);return sp.join(' ');}).join(', ');
        if(rw!==ss)node.setAttribute('srcset',rw);
      }
    }
    if(tag==='SCRIPT'){var s2=node.getAttribute('src');if(s2&&!s2.startsWith(_prefix)){var p2=proxify(s2);if(p2!==s2)node.setAttribute('src',p2);}}
    if(tag==='LINK'){var lh=node.getAttribute('href');if(lh){var ph=proxify(lh);if(ph!==lh)node.setAttribute('href',ph);}}
    ['data-src','data-lazy','data-lazy-src','data-original','data-bg','data-background'].forEach(function(a){
      var v=node.getAttribute(a);if(v){var pv=proxify(v);if(pv!==v)node.setAttribute(a,pv);}
    });
    try{
      if(node.style&&node.style.backgroundImage){
        node.style.backgroundImage=node.style.backgroundImage.replace(/url\(["']?([^"')]+)["']?\)/g,function(m,u){return 'url('+proxify(u)+')';});
      }
    }catch(e){}
  }
  try{ document.querySelectorAll('img,source,script[src],link[href],[data-src],[data-lazy],[data-lazy-src],[data-original]').forEach(fixNode); }catch(e){}
  new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      m.addedNodes.forEach(function(node){
        if(node.nodeType!==1) return;
        fixNode(node);
        try{ node.querySelectorAll('img,source,script[src],link[href],[data-src],[data-lazy]').forEach(fixNode); }catch(e){}
      });
      if(m.type==='attributes'&&m.target){
        var a=m.attributeName;
        if(a==='src'||a==='srcset'||a==='href'||a==='data-src'||a==='data-lazy'||a==='data-original') fixNode(m.target);
      }
    });
  }).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset','href','data-src','data-lazy','data-original']});

  notifyUrl(window.location.href);
})();
</script>`;

  html = html.replace(/(<head[^>]*>)/i, `$1\n${baseTag}`);
  html = html.replace(/(<head[^>]*>)/i, `$1\n${helperScript}`);

  return html;
}

module.exports = { rewriteHtml, rewriteCss, rewriteUrl, injectHelpers, proxyPrefix };
