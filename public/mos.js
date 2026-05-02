"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — mos.js
//  Auth + Desktop + Apps
// ══════════════════════════════════════

const OWNER_USERNAME = "Jay";
const OWNER_PASSWORD = "messi2be";
const USERS_KEY      = "mos_users";
const SESSION_KEY    = "mos_session";

// ─── TMDB API Key ─────────────────────────────────────────────────────────────
// Get your FREE key at: https://www.themoviedb.org/settings/api
const TMDB_KEY = "";

// ── Clock ─────────────────────────────────────────────────────────────────────
function updateClock() {
  const now  = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const t = document.getElementById("clock");
  const k = document.getElementById("taskbar-clock");
  if (t) t.textContent = time;
  if (k) k.textContent = date + "  " + time;
}
setInterval(updateClock, 1000);

// ── User helpers ──────────────────────────────────────────────────────────────
function getUsers()    { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch { return []; } }
function saveUsers(u)  { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }
function getSession()  { return localStorage.getItem(SESSION_KEY) || null; }
function setSession(u) { localStorage.setItem(SESSION_KEY, u); }
function clearSession(){ localStorage.removeItem(SESSION_KEY); }
function isOwner(u)    { return u === OWNER_USERNAME; }
function findUser(u)   { return getUsers().find(x => x.username.toLowerCase() === u.toLowerCase()); }
function escHtml(s)    { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

// ══════════════════════════════════════
//  WINDOW MANAGEMENT
// ══════════════════════════════════════
let zTop = 10;
const openWindows = {};

function bringToFront(id) {
  const w = document.getElementById(id);
  if (w) w.style.zIndex = ++zTop;
  refreshTaskbar();
}

function closeWindow(id) {
  const w = document.getElementById(id);
  if (!w) return;
  w.style.opacity = "0";
  w.style.transform = "scale(0.9)";
  w.style.transition = "opacity 0.2s,transform 0.2s";
  setTimeout(() => { w.remove(); delete openWindows[id]; refreshTaskbar(); }, 200);
}

function minimizeWindow(id) {
  const w = document.getElementById(id);
  if (!w) return;
  w.classList.toggle("minimized");
  refreshTaskbar();
}

function maximizeWindow(id) {
  const w = document.getElementById(id);
  if (!w) return;
  if (w.dataset.maximized) {
    w.style.top    = w.dataset.origTop;
    w.style.left   = w.dataset.origLeft;
    w.style.width  = w.dataset.origW;
    w.style.height = w.dataset.origH;
    delete w.dataset.maximized;
  } else {
    w.dataset.origTop  = w.style.top;
    w.dataset.origLeft = w.style.left;
    w.dataset.origW    = w.style.width;
    w.dataset.origH    = w.style.height;
    w.style.top    = "32px";
    w.style.left   = "0";
    w.style.width  = "100vw";
    w.style.height = "calc(100vh - 32px - 44px)";
    w.dataset.maximized = "1";
  }
}

function makeDraggable(win) {
  const bar = win.querySelector(".window-titlebar");
  if (!bar) return;
  let ox = 0, oy = 0, dragging = false;
  bar.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("wbtn") || win.dataset.maximized) return;
    dragging = true;
    ox = e.clientX - win.offsetLeft;
    oy = e.clientY - win.offsetTop;
    bringToFront(win.id);
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    win.style.left = (e.clientX - ox) + "px";
    win.style.top  = (e.clientY - oy) + "px";
  });
  document.addEventListener("mouseup", () => { dragging = false; });
  win.addEventListener("mousedown", () => bringToFront(win.id));
}

function createWindow(title, content) {
  const id  = "win-" + title.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Date.now();
  const win = document.createElement("div");
  win.className     = "window";
  win.id            = id;
  win.style.cssText = "top:60px;left:130px;width:660px;height:520px";
  win.innerHTML     = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('${id}')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('${id}')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('${id}')"></button>
      </div>
      <span class="window-title">${escHtml(title)}</span>
    </div>
    <div class="window-body" style="overflow:auto">${content}</div>`;
  document.getElementById("windows").appendChild(win);
  makeDraggable(win);
  bringToFront(id);
  openWindows[id] = { title, iconId: "search" };
  refreshTaskbar();
  return win;
}

// ── Taskbar ───────────────────────────────────────────────────────────────────
function refreshTaskbar() {
  const container = document.getElementById("taskbar-apps");
  if (!container) return;
  container.innerHTML = "";
  for (const [id, info] of Object.entries(openWindows)) {
    const win       = document.getElementById(id);
    const isMin     = win && win.classList.contains("minimized");
    const isFocused = win && parseInt(win.style.zIndex || 0) === zTop;
    const btn = document.createElement("button");
    btn.className = "taskbar-btn open" + (isFocused && !isMin ? " active" : "");
    btn.title     = info.title;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24"><use href="#ico-${info.iconId}"/></svg><span>${info.title}</span>`;
    btn.addEventListener("click", () => {
      if (!win) return;
      if (isMin)         { win.classList.remove("minimized"); bringToFront(id); }
      else if (isFocused){ win.classList.add("minimized"); }
      else               { bringToFront(id); }
      refreshTaskbar();
    });
    container.appendChild(btn);
  }
}

// ══════════════════════════════════════
//  AUTH
// ══════════════════════════════════════
function switchAuthTab(tab) {
  const lf = document.getElementById("auth-login-form");
  const sf = document.getElementById("auth-signup-form");
  const tl = document.getElementById("tab-login");
  const ts = document.getElementById("tab-signup");
  if (tab === "login") {
    lf.style.display = "flex"; sf.style.display = "none";
    tl.classList.add("active"); ts.classList.remove("active");
  } else {
    lf.style.display = "none"; sf.style.display = "flex";
    tl.classList.remove("active"); ts.classList.add("active");
  }
}

function setMsg(id, text, err = true) {
  const el = document.getElementById(id); if (!el) return;
  el.textContent = text; el.className = "auth-msg " + (err ? "error" : "ok");
}

function shakeInput(id) {
  const el = document.getElementById(id); if (!el) return;
  el.classList.add("error"); setTimeout(() => el.classList.remove("error"), 600);
}

function doLogin() {
  const u = document.getElementById("login-username").value.trim();
  const p = document.getElementById("login-password").value;
  if (!u) { shakeInput("login-username"); setMsg("login-msg", "Enter your username."); return; }
  if (!p) { shakeInput("login-password"); setMsg("login-msg", "Enter your password."); return; }
  if (u === OWNER_USERNAME) {
    if (p !== OWNER_PASSWORD) { shakeInput("login-password"); setMsg("login-msg", "Invalid credentials."); return; }
    setSession(OWNER_USERNAME); proceedAfterAuth(OWNER_USERNAME); return;
  }
  const user = findUser(u);
  if (!user)           { shakeInput("login-username"); setMsg("login-msg", "Account not found."); return; }
  if (user.password !== p) { shakeInput("login-password"); setMsg("login-msg", "Wrong password."); return; }
  if (user.banned)     { setMsg("login-msg", "This account has been banned."); return; }
  setSession(u); proceedAfterAuth(u);
}

function doSignup() {
  const u = document.getElementById("signup-username").value.trim();
  const p = document.getElementById("signup-password").value;
  const c = document.getElementById("signup-confirm").value;
  if (!u || u.length < 2)          { shakeInput("signup-username"); setMsg("signup-msg", "Username too short."); return; }
  if (/[^a-zA-Z0-9_\-]/.test(u))  { shakeInput("signup-username"); setMsg("signup-msg", "Letters, numbers, _ and - only."); return; }
  if (u === OWNER_USERNAME)        { shakeInput("signup-username"); setMsg("signup-msg", "That name is reserved."); return; }
  if (!p || p.length < 4)         { shakeInput("signup-password"); setMsg("signup-msg", "Password too short."); return; }
  if (p !== c)                     { shakeInput("signup-confirm");  setMsg("signup-msg", "Passwords don't match."); return; }
  const users = getUsers();
  if (users.find(x => x.username.toLowerCase() === u.toLowerCase())) {
    shakeInput("signup-username"); setMsg("signup-msg", "Username taken."); return;
  }
  users.push({ username: u, password: p, banned: false, createdAt: Date.now() });
  saveUsers(users); setSession(u);
  setMsg("signup-msg", "Account created!", false);
  setTimeout(() => proceedAfterAuth(u), 600);
}

function doGuest() {
  const g = "Guest_" + Math.floor(Math.random() * 9000 + 1000);
  setSession(g); proceedAfterAuth(g);
}

function doLogout() { clearSession(); location.reload(); }

function proceedAfterAuth(username) {
  document.getElementById("auth-screen").classList.add("hidden");
  runBoot();
}

// ══════════════════════════════════════
//  BOOT
// ══════════════════════════════════════
const BOOT_MESSAGES = [
  { text: "Initializing Matriarchs OS kernel…",  ok: true  },
  { text: "Loading sovereign network stack…",     ok: false },
  { text: "Mounting encrypted filesystem…",       ok: true  },
  { text: "Starting proxy engine…",               ok: true  },
  { text: "Registering service worker…",          ok: true  },
  { text: "Loading desktop environment…",         ok: true  },
  { text: "System ready.",                        ok: true  },
];

function runBoot() {
  const bootEl = document.getElementById("boot-screen");
  const logEl  = document.getElementById("boot-log");
  const barEl  = document.getElementById("boot-bar");
  const deskEl = document.getElementById("desktop");
  bootEl.style.display = "flex"; bootEl.style.opacity = "1";
  logEl.innerHTML = ""; let i = 0;
  function step() {
    if (i >= BOOT_MESSAGES.length) {
      barEl.style.width = "100%";
      setTimeout(() => {
        bootEl.style.transition = "opacity 0.8s ease";
        bootEl.style.opacity    = "0";
        setTimeout(() => { bootEl.style.display = "none"; }, 850);
        deskEl.classList.remove("hidden");
        updateClock(); applyDesktopUI();
      }, 600);
      return;
    }
    const { text, ok } = BOOT_MESSAGES[i];
    const line = document.createElement("div");
    line.className   = "log-line" + (ok ? " log-ok" : "");
    line.textContent = (ok ? "[ OK ] " : "[    ] ") + text;
    logEl.appendChild(line);
    logEl.scrollTop  = logEl.scrollHeight;
    barEl.style.width = ((i + 1) / BOOT_MESSAGES.length * 100) + "%";
    i++;
    setTimeout(step, 240 + Math.random() * 180);
  }
  setTimeout(step, 500);
}

// ── Desktop UI ────────────────────────────────────────────────────────────────
function applyDesktopUI() {
  const username = getSession() || "Guest";
  const owner    = isOwner(username);
  const topEl = document.getElementById("topbar-user");
  if (topEl) { topEl.textContent = username.toUpperCase(); if (owner) topEl.classList.add("is-owner"); }
  const smEl  = document.getElementById("sm-username");
  if (smEl)  { smEl.textContent  = username; if (owner) smEl.classList.add("is-owner"); }
  if (owner) injectOwnerUI();
}

function injectOwnerUI() {
  const tbl = document.querySelector(".topbar-left");
  if (tbl && !document.getElementById("topbar-admin-btn")) {
    const b = document.createElement("span");
    b.className = "bar-menu owner-menu"; b.id = "topbar-admin-btn";
    b.textContent = "⬡ Admin"; b.onclick = openAdmin;
    tbl.appendChild(b);
  }
  const di = document.getElementById("desktop-icons");
  if (di && !document.getElementById("icon-admin")) {
    const ic = document.createElement("div");
    ic.className = "desktop-icon owner-icon"; ic.id = "icon-admin"; ic.onclick = openAdmin;
    ic.innerHTML = `<div class="icon-img"><svg width="32" height="32" viewBox="0 0 24 24"><use href="#ico-shield"/></svg></div><span>Admin</span>`;
    di.appendChild(ic);
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement("div");
  t.className = "kick-toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity    = "0";
    t.style.transition = "opacity 0.3s";
    setTimeout(() => t.remove(), 350);
  }, 2800);
}

// ══════════════════════════════════════
//  START MENU
// ══════════════════════════════════════
let startMenuOpen = false;
function toggleStartMenu() {
  const menu = document.getElementById("start-menu");
  const btn  = document.querySelector(".taskbar-start");
  startMenuOpen = !startMenuOpen;
  menu.classList.toggle("hidden", !startMenuOpen);
  if (btn) btn.classList.toggle("active", startMenuOpen);
}
document.addEventListener("click", (e) => {
  if (!startMenuOpen) return;
  const menu = document.getElementById("start-menu");
  const btn  = document.querySelector(".taskbar-start");
  if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
    startMenuOpen = false; menu.classList.add("hidden"); if (btn) btn.classList.remove("active");
  }
});

// ══════════════════════════════════════
//  BROWSER
// ══════════════════════════════════════
function openBrowser(initialUrl) {
  const existing = document.getElementById("win-browser");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-browser"); if (initialUrl) sendUrlToBrowser(initialUrl); return; }
  const win = document.createElement("div");
  win.className = "window"; win.id = "win-browser";
  win.style.cssText = "top:48px;left:108px;width:min(900px,calc(100vw - 128px));height:min(580px,calc(100vh - 32px - 44px - 40px))";
  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-browser')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-browser')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-browser')"></button>
      </div>
      <span class="window-title" id="browser-win-title">BROWSER</span>
    </div>
    <div class="window-body" style="padding:0;overflow:hidden">
      <iframe id="galaxy-browser-frame" src="/p.html"
        style="width:100%;height:100%;border:none;display:block"
        allow="autoplay; fullscreen; encrypted-media; clipboard-write"></iframe>
    </div>`;
  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-browser");
  openWindows["win-browser"] = { title:"Browser", iconId:"globe" };
  refreshTaskbar();
  if (initialUrl) { const frame = win.querySelector("#galaxy-browser-frame"); frame.addEventListener("load", () => sendUrlToBrowser(initialUrl), { once:true }); }
}

function sendUrlToBrowser(url) {
  const frame = document.getElementById("galaxy-browser-frame"); if (!frame) return;
  try { frame.contentWindow.postMessage({ type:"mos-navigate", url }, "*"); } catch(e) {}
  try { const input = frame.contentDocument.getElementById("url-bar"); if (input) { input.value = url; input.dispatchEvent(new KeyboardEvent("keydown", { key:"Enter", keyCode:13, bubbles:true })); } } catch(e) {}
}

// ══════════════════════════════════════
//  FILES
// ══════════════════════════════════════
const FILES_KEY = "mos_files";
function getFiles()   { try { return JSON.parse(localStorage.getItem(FILES_KEY)) || getDefaultFiles(); } catch { return getDefaultFiles(); } }
function saveFiles(f) { localStorage.setItem(FILES_KEY, JSON.stringify(f)); }
function getDefaultFiles() {
  return [
    { id:"1", name:"README.txt", type:"txt", content:"Welcome to Matriarchs OS!\n\nThis is your personal file system.", created:Date.now()-86400000, modified:Date.now()-86400000 },
    { id:"2", name:"Notes.txt",  type:"txt", content:"My notes go here…", created:Date.now()-3600000, modified:Date.now()-3600000 },
  ];
}

function openFiles() {
  const existing = document.getElementById("win-files");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-files"); return; }
  const win = document.createElement("div");
  win.className = "window"; win.id = "win-files";
  win.style.cssText = "top:60px;left:130px;width:640px;height:460px";
  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-files')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-files')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-files')"></button>
      </div>
      <span class="window-title">FILES</span>
    </div>
    <div class="window-body" style="flex-direction:row;overflow:hidden">
      <div class="files-sidebar">
        <div class="files-sidebar-section">LOCATIONS</div>
        <div class="files-sidebar-item active"><svg width="13" height="13" viewBox="0 0 24 24"><use href="#ico-files"/></svg><span>Home</span></div>
        <div class="files-sidebar-section" style="margin-top:12px">ACTIONS</div>
        <div class="files-sidebar-item" onclick="filesNewFile()"><svg width="13" height="13" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>New File</span></div>
      </div>
      <div class="files-main">
        <div class="files-toolbar">
          <span class="files-path">~/Home</span>
          <div style="flex:1"></div>
          <button class="files-toolbar-btn" onclick="filesNewFile()">+ New</button>
        </div>
        <div class="files-grid" id="files-grid"></div>
      </div>
    </div>
    <div class="files-editor" id="files-editor" style="display:none">
      <div class="files-editor-bar">
        <span class="files-editor-name" id="files-editor-name">Untitled</span>
        <div style="flex:1"></div>
        <button class="files-toolbar-btn" onclick="filesSave()">Save</button>
        <button class="files-toolbar-btn" style="margin-left:6px" onclick="filesCloseEditor()">✕ Close</button>
      </div>
      <textarea class="files-editor-area" id="files-editor-area" spellcheck="false"></textarea>
    </div>`;
  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-files");
  openWindows["win-files"] = { title:"Files", iconId:"files" };
  refreshTaskbar(); renderFilesGrid();
}

let currentFileId = null;
function renderFilesGrid() {
  const grid = document.getElementById("files-grid"); if (!grid) return;
  const files = getFiles();
  if (!files.length) { grid.innerHTML = `<div style="grid-column:1/-1;padding:40px;text-align:center;font-family:var(--mono);font-size:11px;color:var(--text-dim)">No files yet.</div>`; return; }
  grid.innerHTML = files.map(f => `
    <div class="files-item" ondblclick="filesOpenFile('${f.id}')" onclick="filesSelectItem(this)">
      <div class="files-item-icon"><svg width="28" height="28" viewBox="0 0 24 24"><use href="#ico-files"/></svg></div>
      <div class="files-item-name">${escHtml(f.name)}</div>
      <div class="files-item-meta">${new Date(f.modified).toLocaleDateString()}</div>
      <div class="files-item-actions">
        <button onclick="event.stopPropagation();filesOpenFile('${f.id}')" title="Open">✎</button>
        <button onclick="event.stopPropagation();filesDeleteFile('${f.id}')" title="Delete" style="color:#ff6b6b">✕</button>
      </div>
    </div>`).join("");
}
function filesSelectItem(el) { document.querySelectorAll(".files-item.selected").forEach(e => e.classList.remove("selected")); el.classList.add("selected"); }
function filesOpenFile(id) {
  const file = getFiles().find(f => f.id === id); if (!file) return;
  currentFileId = id;
  const editor = document.getElementById("files-editor"), wb = document.querySelector("#win-files .window-body");
  document.getElementById("files-editor-name").textContent = file.name;
  document.getElementById("files-editor-area").value = file.content || "";
  editor.style.display = "flex"; if (wb) wb.style.display = "none";
}
function filesCloseEditor() {
  const editor = document.getElementById("files-editor"), wb = document.querySelector("#win-files .window-body");
  if (editor) editor.style.display = "none"; if (wb) wb.style.display = "flex";
  currentFileId = null; renderFilesGrid();
}
function filesSave() {
  if (!currentFileId) return;
  const files = getFiles(), file = files.find(f => f.id === currentFileId); if (!file) return;
  file.content = document.getElementById("files-editor-area")?.value || ""; file.modified = Date.now();
  saveFiles(files); showToast(`"${file.name}" saved.`);
}
function filesNewFile() {
  const name = prompt("File name:", "Untitled.txt"); if (!name || !name.trim()) return;
  const files = getFiles();
  const f = { id: Date.now().toString(), name: name.trim(), type:"txt", content:"", created:Date.now(), modified:Date.now() };
  files.push(f); saveFiles(files); renderFilesGrid(); filesOpenFile(f.id);
}
function filesDeleteFile(id) {
  const file = getFiles().find(f => f.id === id); if (!file) return;
  if (!confirm(`Delete "${file.name}"?`)) return;
  saveFiles(getFiles().filter(f => f.id !== id)); renderFilesGrid();
}

// ══════════════════════════════════════
//  CALCULATOR
// ══════════════════════════════════════
function openCalculator() {
  const existing = document.getElementById("win-calc");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-calc"); return; }
  const win = document.createElement("div");
  win.className = "window"; win.id = "win-calc";
  win.style.cssText = "top:80px;left:200px;width:280px;height:420px;min-width:280px;min-height:420px";
  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-calc')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-calc')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-calc')"></button>
      </div>
      <span class="window-title">CALCULATOR</span>
    </div>
    <div class="window-body" style="overflow:hidden">
      <div class="calc-wrap">
        <div class="calc-display">
          <div class="calc-expr" id="calc-expr"></div>
          <div class="calc-val"  id="calc-val">0</div>
        </div>
        <div class="calc-grid">
          <button class="calc-btn calc-span2 calc-fn" onclick="calcClear()">AC</button>
          <button class="calc-btn calc-fn" onclick="calcToggleSign()">+/−</button>
          <button class="calc-btn calc-op" onclick="calcOp('/')">÷</button>
          <button class="calc-btn" onclick="calcNum('7')">7</button>
          <button class="calc-btn" onclick="calcNum('8')">8</button>
          <button class="calc-btn" onclick="calcNum('9')">9</button>
          <button class="calc-btn calc-op" onclick="calcOp('*')">×</button>
          <button class="calc-btn" onclick="calcNum('4')">4</button>
          <button class="calc-btn" onclick="calcNum('5')">5</button>
          <button class="calc-btn" onclick="calcNum('6')">6</button>
          <button class="calc-btn calc-op" onclick="calcOp('-')">−</button>
          <button class="calc-btn" onclick="calcNum('1')">1</button>
          <button class="calc-btn" onclick="calcNum('2')">2</button>
          <button class="calc-btn" onclick="calcNum('3')">3</button>
          <button class="calc-btn calc-op" onclick="calcOp('+')">+</button>
          <button class="calc-btn calc-span2" onclick="calcNum('0')">0</button>
          <button class="calc-btn" onclick="calcDot()">.</button>
          <button class="calc-btn calc-eq" onclick="calcEquals()">=</button>
        </div>
      </div>
    </div>`;
  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-calc");
  openWindows["win-calc"] = { title:"Calculator", iconId:"cog" };
  refreshTaskbar();
}
let calcCurrent="0", calcPrev=null, calcOperator=null, calcNewInput=true, calcExprStr="";
const calcSymbols={"+":"+","-":"−","*":"×","/":"÷"};
function calcUpdateDisplay(){const v=document.getElementById("calc-val"),e=document.getElementById("calc-expr");if(v)v.textContent=calcCurrent.length>12?parseFloat(calcCurrent).toExponential(4):calcCurrent;if(e)e.textContent=calcExprStr;}
function calcNum(n){if(calcNewInput){calcCurrent=n==="0"?"0":n;calcNewInput=false;}else{if(calcCurrent==="0"&&n!==".")calcCurrent=n;else if(calcCurrent.length<14)calcCurrent+=n;}calcUpdateDisplay();}
function calcDot(){if(calcNewInput){calcCurrent="0.";calcNewInput=false;}else if(!calcCurrent.includes("."))calcCurrent+=".";calcUpdateDisplay();}
function calcOp(op){if(calcOperator&&!calcNewInput)calcEquals(true);calcPrev=parseFloat(calcCurrent);calcOperator=op;calcNewInput=true;calcExprStr=calcCurrent+" "+(calcSymbols[op]||op);calcUpdateDisplay();}
function calcEquals(chaining=false){if(calcPrev===null||calcOperator===null)return;const c=parseFloat(calcCurrent);let r;switch(calcOperator){case"+":r=calcPrev+c;break;case"-":r=calcPrev-c;break;case"*":r=calcPrev*c;break;case"/":r=c===0?"Error":calcPrev/c;break;default:r=c;}if(!chaining){calcExprStr=calcPrev+" "+(calcSymbols[calcOperator]||calcOperator)+" "+c+" =";calcOperator=null;calcPrev=null;}calcCurrent=r==="Error"?"Error":String(parseFloat(r.toFixed(10)));calcNewInput=true;calcUpdateDisplay();}
function calcClear(){calcCurrent="0";calcPrev=null;calcOperator=null;calcNewInput=true;calcExprStr="";calcUpdateDisplay();}
function calcToggleSign(){if(calcCurrent==="0"||calcCurrent==="Error")return;calcCurrent=calcCurrent.startsWith("-")?calcCurrent.slice(1):"-"+calcCurrent;calcUpdateDisplay();}

// ══════════════════════════════════════
//  TERMINAL
// ══════════════════════════════════════
function openTerminal() {
  const existing = document.getElementById("win-terminal");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-terminal"); return; }
  const win = document.createElement("div");
  win.className = "window"; win.id = "win-terminal";
  win.style.cssText = "top:100px;left:150px;width:560px;height:340px";
  const username = getSession() || "user";
  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-terminal')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-terminal')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-terminal')"></button>
      </div>
      <span class="window-title">TERMINAL</span>
    </div>
    <div class="window-body" style="background:#050d07">
      <div class="term-body" id="term-body">
        <div class="term-line"><span class="term-prompt">system</span> <span style="color:var(--text-dim)">Matriarchs OS v1.0.0 — type "help"</span></div>
      </div>
      <div class="term-input-row">
        <span class="term-prompt">${escHtml(username)}@mos</span>
        <span style="color:var(--text-dim);margin:0 4px">$</span>
        <input class="term-input" id="term-input" type="text" autocomplete="off" spellcheck="false"/>
      </div>
    </div>`;
  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-terminal");
  openWindows["win-terminal"] = { title:"Terminal", iconId:"term" };
  refreshTaskbar();
  const input = win.querySelector("#term-input");
  const body  = win.querySelector("#term-body");
  const CMDS  = {
    help:    () => ["Available commands:", "  help, whoami, ls, clear, date, version, echo"],
    whoami:  () => [username],
    date:    () => [new Date().toString()],
    version: () => ["Matriarchs OS v1.0.0"],
    clear:   () => { body.innerHTML = ""; return []; },
    ls:      () => { const f = getFiles(); return f.length ? f.map(x => "  " + x.name) : ["(no files)"]; },
  };
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const raw = input.value.trim(); input.value = ""; if (!raw) return;
    const cl = document.createElement("div"); cl.className = "term-line";
    cl.innerHTML = `<span class="term-prompt">${escHtml(username)}@mos</span> <span style="color:var(--text-dim)">$</span> <span>${escHtml(raw)}</span>`;
    body.appendChild(cl);
    const parts = raw.split(" "), cmd = parts[0].toLowerCase(), args = parts.slice(1).join(" ");
    const lines = cmd === "echo" ? [args] : CMDS[cmd] ? CMDS[cmd]() || [] : ["bash: " + cmd + ": command not found"];
    lines.forEach(l => { const le = document.createElement("div"); le.className = "term-line"; le.textContent = l; body.appendChild(le); });
    body.scrollTop = body.scrollHeight;
  });
  input.focus();
  win.addEventListener("click", () => input.focus());
}

// ══════════════════════════════════════
//  ABOUT
// ══════════════════════════════════════
function openAbout() {
  const existing = document.getElementById("win-about");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-about"); return; }
  const win = document.createElement("div");
  win.className = "window"; win.id = "win-about";
  win.style.cssText = "top:80px;left:160px;width:360px;height:280px";
  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-about')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-about')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-about')"></button>
      </div>
      <span class="window-title">ABOUT</span>
    </div>
    <div class="window-body">
      <div class="about-body">
        <div class="about-sigil"><svg width="40" height="40" viewBox="0 0 24 24" style="color:var(--gold)"><use href="#ico-hex"/></svg></div>
        <div class="about-name">MATRIARCHS OS</div>
        <div class="about-sub">SOVEREIGN EDITION — v1.0.0</div>
        <div class="about-divider"></div>
        <div class="about-info">Built on sovereign proxy infrastructure.</div>
      </div>
    </div>`;
  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-about");
  openWindows["win-about"] = { title:"About", iconId:"hex" };
  refreshTaskbar();
}

// ══════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════
function openAdmin() {
  const session = getSession(); if (!isOwner(session)) return;
  const existing = document.getElementById("win-admin");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-admin"); return; }
  const win = document.createElement("div");
  win.className = "window"; win.id = "win-admin";
  win.style.cssText = "top:60px;left:140px;width:520px;height:480px";
  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-admin')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-admin')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-admin')"></button>
      </div>
      <span class="window-title">ADMIN PANEL</span>
    </div>
    <div class="window-body">
      <div class="admin-body">
        <div class="admin-header">
          <div class="admin-title">⬡ OWNER CONTROL PANEL</div>
          <div class="admin-sub">Sovereign Access</div>
        </div>
        <div class="admin-stats" id="admin-stats"></div>
        <div class="admin-section-title">Registered Users</div>
        <div class="admin-users-list" id="admin-users-list"></div>
      </div>
    </div>`;
  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-admin");
  openWindows["win-admin"] = { title:"Admin", iconId:"shield" };
  refreshTaskbar(); renderAdminPanel();
}
function renderAdminPanel() {
  const users   = getUsers();
  const statsEl = document.getElementById("admin-stats");
  const listEl  = document.getElementById("admin-users-list");
  if (!statsEl || !listEl) return;
  const banned = users.filter(u => u.banned).length;
  statsEl.innerHTML = `<div class="admin-stat"><div class="admin-stat-num">${users.length}</div><div class="admin-stat-label">TOTAL</div></div><div class="admin-stat"><div class="admin-stat-num">${users.length-banned}</div><div class="admin-stat-label">ACTIVE</div></div><div class="admin-stat"><div class="admin-stat-num">${banned}</div><div class="admin-stat-label">BANNED</div></div>`;
  if (!users.length) { listEl.innerHTML = `<div class="admin-empty">No registered accounts yet.</div>`; return; }
  listEl.innerHTML = users.map(user => {
    const initials = user.username.slice(0,2).toUpperCase();
    const isBanned = user.banned;
    return `<div class="admin-user-row">
      <div class="admin-user-avatar">${initials}</div>
      <div class="admin-user-info">
        <div class="admin-user-name">${escHtml(user.username)}</div>
        <div class="admin-user-status ${isBanned?"banned":"online"}">${isBanned?"Banned":"Active"}</div>
      </div>
      <div class="admin-actions">
        ${isBanned
          ? `<button class="admin-action-btn unban-btn" onclick="adminUnban('${escHtml(user.username)}')">UNBAN</button>`
          : `<button class="admin-action-btn ban-btn"   onclick="adminBan('${escHtml(user.username)}')">BAN</button>`}
        <button class="admin-action-btn" style="border-color:rgba(255,107,107,0.3);color:#ff6b6b" onclick="adminDelete('${escHtml(user.username)}')">DEL</button>
      </div>
    </div>`;
  }).join("");
}
function adminBan(u)    { const users=getUsers(),user=users.find(x=>x.username===u);if(!user)return;user.banned=true; saveUsers(users);showToast(u+" banned.");   renderAdminPanel(); }
function adminUnban(u)  { const users=getUsers(),user=users.find(x=>x.username===u);if(!user)return;user.banned=false;saveUsers(users);showToast(u+" unbanned.");renderAdminPanel(); }
function adminDelete(u) { if(!confirm(`Delete "${u}"?`))return;saveUsers(getUsers().filter(x=>x.username!==u));showToast(u+" deleted.");renderAdminPanel(); }

// ══════════════════════════════════════
//  CINEMA
// ══════════════════════════════════════
const PROVIDERS = [
  { id:"vidsrcsu", name:"VidSrc.SU",   urls:{ movie:"https://vidsrc.su/embed/movie/{id}",              tv:"https://vidsrc.su/embed/tv/{id}/{season}/{episode}" }},
  { id:"vidsrccx", name:"VidSrc.CX",   urls:{ movie:"https://vidsrc.cx/embed/movie/{id}",              tv:"https://vidsrc.cx/embed/tv/{id}/{season}/{episode}" }},
  { id:"vidlink",  name:"VidLink",     urls:{ movie:"https://vidlink.pro/movie/{id}",                   tv:"https://vidlink.pro/tv/{id}/{season}/{episode}" }},
  { id:"rive",     name:"RiveStream",  urls:{ movie:"https://rivestream.org/embed?type=movie&id={id}", tv:"https://rivestream.org/embed?type=tv&id={id}&season={season}&episode={episode}" }},
  { id:"mapple",   name:"MappleTv",    urls:{ movie:"https://mappletv.uk/watch/movie/{id}",             tv:"https://mappletv.uk/watch/tv/{id}-{season}-{episode}" }},
  { id:"frembed",  name:"Frembed(FR)", urls:{ movie:"https://frembed.icu/api/film.php?id={id}",         tv:"https://frembed.icu/api/serie.php?id={id}&sa={season}&epi={episode}" }},
];

// ── Cinema state ───────────────────────────────────────────────────────────────
let _cinemaType = "movie";

function openCinemaSearch() {
  const existing = document.getElementById("win-cinema");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-cinema"); return; }

  const noKeyMsg = !TMDB_KEY ? `
    <div style="grid-column:1/-1;text-align:center;padding:36px 24px;font-family:var(--mono);font-size:11px;color:var(--text-dim);background:var(--surface2);border-radius:8px;border:1px solid var(--border);line-height:2.4;margin:4px;">
      <div style="font-size:30px;margin-bottom:10px;">🔑</div>
      <div style="color:var(--gold);font-weight:700;letter-spacing:0.12em;margin-bottom:10px;">TMDB API KEY REQUIRED</div>
      Open <code style="color:var(--gold2)">public/mos.js</code> and set:<br>
      <code style="color:var(--text-mid);background:var(--surface3);padding:2px 8px;border-radius:4px;">const TMDB_KEY = "your_key_here";</code><br><br>
      Get a <strong style="color:var(--gold2)">free</strong> key at:<br>
      <span style="color:var(--gold)">themoviedb.org/settings/api</span>
    </div>` : `
    <div style="grid-column:1/-1;text-align:center;padding:60px 20px;font-family:var(--mono);font-size:11px;color:var(--text-dim);">
      Search for a movie or TV show above.
    </div>`;

  const win = document.createElement("div");
  win.className = "window"; win.id = "win-cinema";
  win.style.cssText = "top:60px;left:140px;width:720px;height:540px";
  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-cinema')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-cinema')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-cinema')"></button>
      </div>
      <span class="window-title">🎬 CINEMA</span>
    </div>
    <div class="window-body" style="flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--surface2);border-bottom:1px solid var(--border);flex-shrink:0;">
        <input id="cinema-q" type="text" placeholder="Search movies & TV shows…"
          style="flex:1;background:var(--surface3);border:1px solid var(--border-hi);color:var(--text);padding:9px 13px;border-radius:6px;font-family:var(--mono);font-size:12px;outline:none;user-select:text;"
          onkeydown="if(event.key==='Enter')doCinemaSearch()"/>
        <button id="ctype-movie" onclick="setCinemaType('movie')"
          style="background:var(--gold);color:#000;border:none;border-radius:5px;padding:8px 14px;font-family:var(--mono);font-size:10px;font-weight:700;cursor:pointer;letter-spacing:0.08em;flex-shrink:0;">MOVIE</button>
        <button id="ctype-tv" onclick="setCinemaType('tv')"
          style="background:var(--surface3);color:var(--text-dim);border:1px solid var(--border);border-radius:5px;padding:8px 14px;font-family:var(--mono);font-size:10px;cursor:pointer;letter-spacing:0.08em;flex-shrink:0;">TV</button>
        <button onclick="doCinemaSearch()"
          style="background:var(--gold);color:#000;border:none;border-radius:6px;padding:9px 20px;font-family:var(--mono);font-size:11px;font-weight:700;cursor:pointer;letter-spacing:0.1em;flex-shrink:0;">▶ SEARCH</button>
      </div>
      <div id="cinema-results"
        style="flex:1;overflow-y:auto;padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;align-content:start;">
        ${noKeyMsg}
      </div>
    </div>`;

  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-cinema");
  openWindows["win-cinema"] = { title:"Cinema", iconId:"search" };
  refreshTaskbar();
}

function setCinemaType(type) {
  _cinemaType = type;
  const mb = document.getElementById("ctype-movie");
  const tb = document.getElementById("ctype-tv");
  if (!mb || !tb) return;
  const activeStyle  = "background:var(--gold);color:#000;border:none;border-radius:5px;padding:8px 14px;font-family:var(--mono);font-size:10px;font-weight:700;cursor:pointer;letter-spacing:0.08em;flex-shrink:0;";
  const inactiveStyle = "background:var(--surface3);color:var(--text-dim);border:1px solid var(--border);border-radius:5px;padding:8px 14px;font-family:var(--mono);font-size:10px;cursor:pointer;letter-spacing:0.08em;flex-shrink:0;";
  if (type === "movie") { mb.style.cssText = activeStyle; tb.style.cssText = inactiveStyle; }
  else                  { tb.style.cssText = activeStyle; mb.style.cssText = inactiveStyle; }
}

async function doCinemaSearch() {
  const resultsEl = document.getElementById("cinema-results");
  if (!resultsEl) return;

  if (!TMDB_KEY) {
    resultsEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:36px;font-family:var(--mono);font-size:11px;color:#ff6b6b;">Add your TMDB_KEY to mos.js first.</div>`;
    return;
  }

  const q = (document.getElementById("cinema-q")?.value || "").trim();
  if (!q) return;

  resultsEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;font-family:var(--mono);font-size:11px;color:var(--text-dim);">Searching…</div>`;

  try {
    const apiUrl = `https://api.themoviedb.org/3/search/${_cinemaType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}&include_adult=false&page=1&language=en-US`;
    const resp = await fetch(`/fetch?url=${encodeURIComponent(apiUrl)}`);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("Invalid API response — check your TMDB_KEY"); }

    if (data.status_message) throw new Error(data.status_message);
    if (!data.results?.length) {
      resultsEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;font-family:var(--mono);font-size:11px;color:var(--text-dim);">No results for &ldquo;${escHtml(q)}&rdquo;</div>`;
      return;
    }

    resultsEl.innerHTML = data.results.slice(0, 24).map(item => {
      const title  = escHtml(item.title || item.name || "Unknown");
      const year   = (item.release_date || item.first_air_date || "").slice(0, 4) || "—";
      const rating = item.vote_average ? item.vote_average.toFixed(1) : "";
      const poster = item.poster_path
        ? `/fetch?url=${encodeURIComponent("https://image.tmdb.org/t/p/w185" + item.poster_path)}`
        : "";
      return `
        <div onclick="openCinemaFromSearch(${item.id},'${_cinemaType}')"
          style="cursor:pointer;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--surface2);transition:all 0.15s;"
          onmouseover="this.style.transform='translateY(-3px)';this.style.borderColor='var(--border-hi)';"
          onmouseout="this.style.transform='';this.style.borderColor='var(--border)';">
          ${poster
            ? `<img src="${poster}" alt="${title}" style="width:100%;aspect-ratio:2/3;object-fit:cover;display:block;" loading="lazy"/>`
            : `<div style="width:100%;aspect-ratio:2/3;background:var(--surface3);display:flex;align-items:center;justify-content:center;font-size:40px;">🎬</div>`}
          <div style="padding:7px 8px;">
            <div style="font-family:var(--mono);font-size:10px;color:var(--text);letter-spacing:0.03em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${title}">${title}</div>
            <div style="display:flex;justify-content:space-between;margin-top:3px;align-items:center;">
              <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${year}</span>
              ${rating ? `<span style="font-family:var(--mono);font-size:9px;color:var(--gold);">★ ${rating}</span>` : ""}
            </div>
          </div>
        </div>`;
    }).join("");

  } catch (err) {
    resultsEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;font-family:var(--mono);font-size:11px;color:#ff6b6b;">Error: ${escHtml(err.message)}</div>`;
  }
}

function openCinemaFromSearch(tmdbId, type) {
  if (type === "tv") {
    const s  = prompt("Season:", "1");  if (!s) return;
    const ep = prompt("Episode:", "1"); if (!ep) return;
    openCinemaPlayer(String(tmdbId), type, s, ep);
  } else {
    openCinemaPlayer(String(tmdbId), type, "1", "1");
  }
}

function openCinemaPlayer(tmdbId, type, season, episode) {
  const winId = "win-cinema-player";
  const existing = document.getElementById(winId);
  if (existing) existing.remove();

  const optionsHtml = PROVIDERS.map(p =>
    `<option value="${p.id}">${p.name.toUpperCase()}</option>`
  ).join("");

  const label = type === "tv" ? `ID:${tmdbId} // S${season}:E${episode}` : `ID:${tmdbId}`;

  const win = document.createElement("div");
  win.className = "window"; win.id = winId;
  win.style.cssText = "top:40px;left:80px;width:860px;height:580px";
  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('${winId}')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('${winId}')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('${winId}')"></button>
      </div>
      <span class="window-title">🎬 NEURAL_STREAM</span>
    </div>
    <div class="window-body" style="flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;gap:12px;padding:7px 12px;background:var(--surface2);border-bottom:1px solid var(--border);flex-shrink:0;">
        <select id="provider-select"
          style="background:var(--surface3);color:var(--gold2);border:1px solid var(--border-hi);border-radius:5px;font-family:var(--mono);font-size:11px;padding:4px 10px;outline:none;cursor:pointer;">
          ${optionsHtml}
        </select>
        <span style="font-family:var(--mono);font-size:10px;color:var(--text-mid);text-transform:uppercase;flex:1;">${label}</span>
        ${type === "tv" ? `
        <button onclick="cinemaChangeEp()" style="background:var(--surface3);border:1px solid var(--border);border-radius:5px;color:var(--text-mid);font-family:var(--mono);font-size:10px;padding:4px 10px;cursor:pointer;letter-spacing:0.06em;">S/E ▸</button>
        ` : ""}
      </div>
      <iframe id="cinema-frame" style="flex:1;border:none;width:100%;background:#000;"
        allowfullscreen src="about:blank"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>
    </div>`;

  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront(winId);
  openWindows[winId] = { title:"Cinema Player", iconId:"search" };
  refreshTaskbar();

  const select = win.querySelector("#provider-select");
  const iframe = win.querySelector("#cinema-frame");

  // Store for S/E change
  win._cinemaState = { tmdbId, type, season, episode };

  function buildUrl(pId) {
    const p = PROVIDERS.find(x => x.id === pId); if (!p) return null;
    return (type === "tv" ? p.urls.tv : p.urls.movie)
      .replace("{id}", tmdbId)
      .replace("{season}", win._cinemaState.season)
      .replace("{episode}", win._cinemaState.episode);
  }

  function loadStream(pId) {
    const url = buildUrl(pId);
    if (!url) return;
    // Route through proxy — strips CSP, X-Frame-Options, loads in iframe
    iframe.src = `/fetch?url=${encodeURIComponent(url)}`;
  }

  select.onchange = (e) => loadStream(e.target.value);
  loadStream(PROVIDERS[0].id);

  win.cinemaChangeEp = function() {
    const s  = prompt("Season:", win._cinemaState.season);  if (!s) return;
    const ep = prompt("Episode:", win._cinemaState.episode); if (!ep) return;
    win._cinemaState.season = s;
    win._cinemaState.episode = ep;
    loadStream(select.value);
  };
}

// Expose for TV S/E button onclick
function cinemaChangeEp() {
  const win = document.getElementById("win-cinema-player");
  if (win && win.cinemaChangeEp) win.cinemaChangeEp();
}

// ══════════════════════════════════════
//  PROXY MESSAGE HANDLER
// ══════════════════════════════════════
window.addEventListener("message", (e) => {
  if (!e.data || typeof e.data !== "object") return;
  if (e.data.type === "mos-navigate-proxy" && e.data.url) {
    const frame = document.getElementById("galaxy-browser-frame");
    if (frame) {
      try { frame.contentWindow.postMessage({ type:"mos-navigate", url:e.data.url }, "*"); } catch(err) {}
    } else {
      openBrowser(e.data.url);
    }
  }
});

// ══════════════════════════════════════
//  INIT
// ══════════════════════════════════════
window.addEventListener("DOMContentLoaded", () => {
  const session = getSession();
  if (session) {
    const user = findUser(session);
    if (user && user.banned) { clearSession(); location.reload(); return; }
    document.getElementById("auth-screen").classList.add("hidden");
    runBoot();
  }
  document.getElementById("login-password")?.addEventListener("keydown", e => { if (e.key==="Enter") doLogin(); });
  document.getElementById("login-username")?.addEventListener("keydown", e => { if (e.key==="Enter") doLogin(); });
  document.getElementById("signup-confirm")?.addEventListener("keydown", e => { if (e.key==="Enter") doSignup(); });
});
