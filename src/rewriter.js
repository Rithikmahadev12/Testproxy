"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — rewriter.js  v4
//  Aggressive HTML/CSS URL rewriting
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

  // ── src= on ANY tag ───────────────────────────────────────────────────────
  html = html.replace(
    /(\s)(src)=(["'])(.*?)\3/gi,
    (_, sp, attr, q, val) => `${sp}${attr}=${q}${rw(val)}${q}`
  );

  // ── href= on <link> tags only (NOT <a>) ──────────────────────────────────
  html = html.replace(
    /(<link\b[^>]*?\s)(href)=(["'])(.*?)\3/gi,
    (_, pre, attr, q, val) => `${pre}${attr}=${q}${rw(val)}${q}`
  );

  // ── action= on <form> ─────────────────────────────────────────────────────
  html = html.replace(
    /(<form\b[^>]*?\s)(action)=(["'])(.*?)\3/gi,
    (_, pre, attr, q, val) => `${pre}${attr}=${q}${rw(val)}${q}`
  );

  // ── data-* resource attributes ────────────────────────────────────────────
  html = html.replace(
    /(\s)(data-src|data-href|data-lazy|data-lazy-src|data-original|data-url|data-image|data-background|data-bg|data-thumb|data-full|data-link|data-path|data-poster)=(["'])(.*?)\3/gi,
    (_, sp, attr, q, val) => `${sp}${attr}=${q}${rw(val)}${q}`
  );

  // ── poster= ───────────────────────────────────────────────────────────────
  html = html.replace(
    /(\s)(poster)=(["'])(.*?)\3/gi,
    (_, sp, attr, q, val) => `${sp}${attr}=${q}${rw(val)}${q}`
  );

  // ── srcset= ───────────────────────────────────────────────────────────────
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

  // ── url() in inline style= and <style> blocks ────────────────────────────
  html = html.replace(
    /url\((["']?)([^"')]+)\1\)/gi,
    (_, q, u) => `url(${q}${rw(u.trim())}${q})`
  );

  // ── content= on meta with url ────────────────────────────────────────────
  html = html.replace(
    /(<meta[^>]+content=["'][^"']*url=)(https?:\/\/[^"']+)/gi,
    (_, pre, u) => `${pre}${pfx}${encodeURIComponent(u)}`
  );

  // ── <a href=> — rewrite for navigation through proxy ─────────────────────
  // We DO rewrite these so clicking links navigates through proxy
  html = html.replace(
    /(<a\b[^>]*?\s)(href)=(["'])((?!#|javascript:|mailto:|tel:)[^"']+)\3/gi,
    (_, pre, attr, q, val) => `${pre}${attr}=${q}${rw(val)}${q}`
  );

  // ── Remove integrity + crossorigin so rewritten assets load ──────────────
  html = html.replace(/\s+integrity=(["'])[^"']*\1/gi, "");
  html = html.replace(/\s+crossorigin=(["'])[^"']*\1/gi, "");
  html = html.replace(/\scrossorigin(?=[\s>])/gi, "");

  // ── Remove nonce from scripts/styles ────────────────────────────────────
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
  const script  = buildRuntimeScript(pfx, origin, targetUrl);

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

// ── RUNTIME SCRIPT ────────────────────────────────────────────────────────────
function buildRuntimeScript(pfx, origin, targetUrl) {
  const _pfx    = JSON.stringify(pfx);
  const _origin = JSON.stringify(origin);
  const _target = JSON.stringify(targetUrl);

  return `<script data-mos="1">
(function(){
"use strict";
var __P=${_pfx};
var __O=${_origin};
var __T=${_target};
var __PAR;
try{__PAR=window.parent;}catch(e){__PAR=null;}

function proxify(u){
  if(!u||typeof u!=='string')return u;
  var s=u.trim();
  if(!s)return u;
  if(s.startsWith(__P)||s.startsWith('data:')||s.startsWith('blob:')||
     s.startsWith('javascript:')||s.startsWith('mailto:')||
     s.startsWith('tel:')||s.startsWith('about:')||s.startsWith('#'))return u;
  if(s.startsWith('//'))return __P+encodeURIComponent('https:'+s);
  if(/^https?:\\/\\//i.test(s))return __P+encodeURIComponent(s);
  if(s.startsWith('/'))return __P+encodeURIComponent(__O+s);
  try{return __P+encodeURIComponent(new URL(s,__T).href);}catch(e){return u;}
}

function notifyUrl(href){
  try{
    var real=href||__T;
    if(real&&real.indexOf(__P)!==-1){
      try{real=decodeURIComponent(real.slice(real.indexOf(__P)+__P.length));}catch(e){}
    }
    if(__PAR&&__PAR!==window){
      __PAR.postMessage({type:'mos-url-update',url:real},'*');
    }
  }catch(e){}
}

/* ── Anti-detection ────────────────────────────────────────────────────── */
try{Object.defineProperty(window,'top',         {get:function(){return window;},configurable:true});}catch(e){}
try{Object.defineProperty(window,'parent',      {get:function(){return window;},configurable:true});}catch(e){}
try{Object.defineProperty(window,'frameElement',{get:function(){return null;  },configurable:true});}catch(e){}
try{Object.defineProperty(navigator,'webdriver',{get:function(){return false; },configurable:true});}catch(e){}

/* window.chrome */
try{
  if(!window.chrome)window.chrome={};
  if(!window.chrome.runtime)window.chrome.runtime={
    id:undefined,connect:function(){},sendMessage:function(){},
    onMessage:{addListener:function(){},removeListener:function(){},hasListeners:function(){return false;}},
    onConnect:{addListener:function(){},removeListener:function(){}}
  };
  if(!window.chrome.app)window.chrome.app={isInstalled:false};
}catch(e){}

/* Block service workers — they break proxy routing */
try{
  if('serviceWorker' in navigator){
    Object.defineProperty(navigator,'serviceWorker',{get:function(){
      return{
        register:function(){return Promise.resolve({scope:'/',active:null,installing:null,waiting:null,addEventListener:function(){},removeEventListener:function(){}});},
        unregister:function(){return Promise.resolve(true);},
        getRegistration:function(){return Promise.resolve(undefined);},
        getRegistrations:function(){return Promise.resolve([]);},
        ready:Promise.resolve({scope:'/',active:null}),
        controller:null,
        addEventListener:function(){},
        removeEventListener:function(){}
      };
    },configurable:true});
  }
}catch(e){}

/* location spoof */
try{
  var _loc=new URL(__T);
  Object.defineProperty(window,'location',{get:function(){
    return new Proxy(location,{
      get:function(t,p){
        if(p==='href')    return __T;
        if(p==='origin')  return __O;
        if(p==='host')    return _loc.host;
        if(p==='hostname')return _loc.hostname;
        if(p==='pathname')return _loc.pathname;
        if(p==='search')  return _loc.search;
        if(p==='hash')    return _loc.hash;
        if(p==='protocol')return _loc.protocol;
        if(p==='port')    return _loc.port;
        if(p==='assign')  return function(u){try{u=proxify(u);}catch(e){}location.assign(u);};
        if(p==='replace') return function(u){try{u=proxify(u);}catch(e){}location.replace(u);};
        if(p==='reload')  return function(){location.reload();};
        if(p==='toString')return function(){return __T;};
        var v=t[p];return typeof v==='function'?v.bind(t):v;
      }
    });
  },configurable:true});
}catch(e){}

try{window.addEventListener('securitypolicyviolation',function(e){e.stopImmediatePropagation();e.preventDefault();},true);}catch(e){}

/* ── Proxy fetch ───────────────────────────────────────────────────────── */
try{
  var _oFetch=window.fetch;
  if(_oFetch){
    window.fetch=function(input,init){
      try{
        if(typeof input==='string')input=proxify(input);
        else if(input&&typeof input==='object'&&input.url)input=new Request(proxify(input.url||''),input);
      }catch(e){}
      return _oFetch.call(this,input,init);
    };
    window.fetch.toString=function(){return _oFetch.toString();};
  }
}catch(e){}

/* ── Proxy XHR ─────────────────────────────────────────────────────────── */
try{
  var _oXHR=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url2){
    var args=Array.prototype.slice.call(arguments);
    try{args[1]=proxify(url2);}catch(e){}
    return _oXHR.apply(this,args);
  };
}catch(e){}

/* ── Proxy image src ───────────────────────────────────────────────────── */
try{
  var _oImage=window.Image;
  window.Image=function(w,h){
    var img=new _oImage(w,h);
    var _oSrc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    if(_oSrc&&_oSrc.set){
      Object.defineProperty(img,'src',{
        get:function(){return _oSrc.get.call(this);},
        set:function(v){_oSrc.set.call(this,proxify(v));},
        configurable:true
      });
    }
    return img;
  };
}catch(e){}

/* ── Proxy HTMLImageElement.src globally ────────────────────────────────── */
try{
  var _imgDesc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
  if(_imgDesc&&_imgDesc.set){
    var _origImgSet=_imgDesc.set;
    Object.defineProperty(HTMLImageElement.prototype,'src',{
      get:_imgDesc.get,
      set:function(v){_origImgSet.call(this,proxify(v));},
      configurable:true
    });
  }
}catch(e){}

/* ── Proxy HTMLScriptElement.src ────────────────────────────────────────── */
try{
  var _scrDesc=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src');
  if(_scrDesc&&_scrDesc.set){
    var _origScrSet=_scrDesc.set;
    Object.defineProperty(HTMLScriptElement.prototype,'src',{
      get:_scrDesc.get,
      set:function(v){_origScrSet.call(this,proxify(v));},
      configurable:true
    });
  }
}catch(e){}

/* ── location.assign/replace ────────────────────────────────────────────── */
try{
  var _oAssign=location.assign.bind(location);
  var _oReplace=location.replace.bind(location);
  location.assign=function(u){try{u=proxify(u);}catch(e){}  _oAssign(u);};
  location.replace=function(u){try{u=proxify(u);}catch(e){} _oReplace(u);};
}catch(e){}

/* ── history ────────────────────────────────────────────────────────────── */
try{
  function wrapHistory(orig){
    return function(state,title,url2){
      try{if(url2)url2=proxify(url2);}catch(e){}
      var r=orig.call(this,state,title,url2);
      notifyUrl(url2||window.location.href);
      return r;
    };
  }
  history.pushState=wrapHistory(history.pushState.bind(history));
  history.replaceState=wrapHistory(history.replaceState.bind(history));
}catch(e){}

/* ── Worker / SharedWorker ──────────────────────────────────────────────── */
try{var _OW=window.Worker;       if(_OW){window.Worker=function(u,o){try{u=proxify(u);}catch(e){}return new _OW(u,o);};window.Worker.prototype=_OW.prototype;}}catch(e){}
try{var _OS=window.SharedWorker; if(_OS){window.SharedWorker=function(u,o){try{u=proxify(u);}catch(e){}return new _OS(u,o);};window.SharedWorker.prototype=_OS.prototype;}}catch(e){}

/* ── window.open ────────────────────────────────────────────────────────── */
try{
  var _oOpen=window.open;
  window.open=function(u,t,f){
    try{if(u)u=proxify(u);}catch(e){}
    return _oOpen?_oOpen.call(this,u,'_self',f):null;
  };
}catch(e){}

/* ── document.referrer ──────────────────────────────────────────────────── */
try{Object.defineProperty(document,'referrer',{get:function(){return __O+'/';},configurable:true});}catch(e){}

notifyUrl(__T);
window.addEventListener('popstate',function(){notifyUrl(window.location.href);});

/* ── DOM link interception ──────────────────────────────────────────────── */
document.addEventListener('click',function(e){
  var el=e.target;
  while(el&&el.tagName!=='A')el=el.parentElement;
  if(!el)return;
  var href=el.getAttribute('href');
  if(!href)return;
  href=href.trim();
  if(href.startsWith('#')||href.startsWith('javascript:')||href.startsWith('mailto:')||href.startsWith('tel:'))return;
  if(href.startsWith(__P))return;
  var abs;
  try{
    if(href.startsWith('//'))          abs='https:'+href;
    else if(/^https?:\\/\\//i.test(href))abs=href;
    else                               abs=new URL(href,__T).href;
  }catch(e){return;}
  e.preventDefault();e.stopPropagation();
  try{
    if(__PAR&&__PAR!==window){__PAR.postMessage({type:'mos-navigate-proxy',url:abs},'*');}
    else{window.location.href=proxify(abs);}
  }catch(e){window.location.href=proxify(abs);}
},true);

/* ── MutationObserver — patch dynamic nodes ─────────────────────────────── */
function fixNode(node){
  if(!node||node.nodeType!==1)return;
  var tag=(node.tagName||'').toUpperCase();

  function fixA(attr){
    try{
      var v=node.getAttribute(attr);
      if(!v)return;
      var p=proxify(v);
      if(p!==v)node.setAttribute(attr,p);
    }catch(e){}
  }

  ['src','href','poster','action','data-src','data-lazy','data-lazy-src',
   'data-original','data-bg','data-background','data-image','data-url'].forEach(fixA);

  /* srcset */
  try{
    var ss=node.getAttribute('srcset');
    if(ss){
      var rw=ss.split(',').map(function(p){
        var t=p.trim();if(!t)return p;
        var sp=t.split(/\s+/);sp[0]=proxify(sp[0]);return sp.join(' ');
      }).join(', ');
      if(rw!==ss)node.setAttribute('srcset',rw);
    }
  }catch(e){}

  /* inline style backgroundImage */
  try{
    if(node.style&&node.style.backgroundImage){
      node.style.backgroundImage=node.style.backgroundImage.replace(
        /url\(["']?([^"')]+)["']?\)/g,
        function(m,u){return 'url('+proxify(u)+')';}
      );
    }
  }catch(e){}
}

/* Initial sweep */
try{
  document.querySelectorAll('*').forEach(function(node){
    try{fixNode(node);}catch(e){}
  });
}catch(e){}

/* Watch for additions */
try{
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(node){
        if(node.nodeType!==1)return;
        try{fixNode(node);}catch(e){}
        try{node.querySelectorAll('*').forEach(function(n){try{fixNode(n);}catch(e){}});}catch(e){}
      });
      if(m.type==='attributes'&&m.target){
        try{fixNode(m.target);}catch(e){}
      }
    });
  }).observe(document.documentElement,{
    childList:true,subtree:true,attributes:true,
    attributeFilter:['src','srcset','href','data-src','data-lazy','data-original','action','poster','style']
  });
}catch(e){}

})();
</script>`;
}

module.exports = { rewriteHtml, rewriteCss, injectHelpers, prefix };
