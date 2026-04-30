"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — games.js  v2
//  Snake, 2048, Tetris
// ══════════════════════════════════════

function openGames() {
  const existing = document.getElementById("win-games");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-games"); return; }

  const win = document.createElement("div");
  win.className = "window"; win.id = "win-games";
  win.style.cssText = "top:70px;left:140px;width:520px;height:460px";

  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-games')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-games')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-games')"></button>
      </div>
      <span class="window-title" id="games-win-title">GAMES</span>
    </div>
    <div class="window-body" style="position:relative;overflow:hidden" id="games-body">
      <div class="games-hub">
        <div class="games-hub-header">
          <div class="games-hub-title">⬡ ARCADE</div>
          <div class="games-hub-sub">Select a game to play</div>
        </div>
        <div class="games-grid">
          <div class="game-card" onclick="launchGame('snake')">
            <div class="game-card-icon">🐍</div>
            <div class="game-card-name">SNAKE</div>
            <div class="game-card-desc">Classic snake</div>
          </div>
          <div class="game-card" onclick="launchGame('2048')">
            <div class="game-card-icon">🔢</div>
            <div class="game-card-name">2048</div>
            <div class="game-card-desc">Merge tiles</div>
          </div>
          <div class="game-card" onclick="launchGame('tetris')">
            <div class="game-card-icon">🧱</div>
            <div class="game-card-name">TETRIS</div>
            <div class="game-card-desc">Stack & clear</div>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById("windows").appendChild(win);
  makeDraggable(win);
  bringToFront("win-games");
  openWindows["win-games"] = { title: "Games", iconId: "games" };
  refreshTaskbar();
}

// ─── Game launcher ────────────────────────────────────────────────────────────
let _activeGame = null;

function launchGame(name) {
  stopActiveGame();
  const body = document.getElementById("games-body");
  if (!body) return;

  const vp = document.createElement("div");
  vp.className = "game-viewport";
  vp.id = "game-viewport";
  body.appendChild(vp);

  const titleEl = document.getElementById("games-win-title");
  if (titleEl) titleEl.textContent = name.toUpperCase();

  if (name === "snake")  initSnake(vp);
  if (name === "2048")   init2048(vp);
  if (name === "tetris") initTetris(vp);
}

function stopActiveGame() {
  if (_activeGame) { clearInterval(_activeGame); _activeGame = null; }
  const vp = document.getElementById("game-viewport");
  if (vp) vp.remove();
  const titleEl = document.getElementById("games-win-title");
  if (titleEl) titleEl.textContent = "GAMES";
}

function closeGameViewport() { stopActiveGame(); }

// ═══════════════════════════════════════════════════════════════════════════════
//  SNAKE
// ═══════════════════════════════════════════════════════════════════════════════
function initSnake(vp) {
  const CELL = 18, COLS = 22, ROWS = 18;
  const W = CELL * COLS, H = CELL * ROWS;
  let snake, dir, nextDir, food, score, alive, loop;

  vp.innerHTML = `
    <div class="game-viewport-bar">
      <span class="game-viewport-name">🐍 SNAKE</span>
      <span class="game-viewport-score" id="snake-score-bar">Score: 0</span>
      <button class="game-close-btn" onclick="closeGameViewport()">✕ Exit</button>
    </div>
    <div class="game-canvas-wrap">
      <canvas id="snake-canvas" width="${W}" height="${H}"></canvas>
      <div class="game-overlay" id="snake-overlay">
        <div class="game-overlay-title">SNAKE</div>
        <div class="game-overlay-sub">Arrow keys or WASD to move</div>
        <div class="game-overlay-score" id="snake-final"></div>
        <button class="game-start-btn" onclick="snakeStart()">START</button>
      </div>
    </div>`;

  const canvas = vp.querySelector("#snake-canvas");
  const ctx    = canvas.getContext("2d");

  function rnd(n) { return Math.floor(Math.random() * n); }
  function placeFood() {
    let f;
    do { f = { x: rnd(COLS), y: rnd(ROWS) }; }
    while (snake.some(s => s.x === f.x && s.y === f.y));
    food = f;
  }

  function draw() {
    ctx.fillStyle = "#07100a";
    ctx.fillRect(0, 0, W, H);
    // Grid
    ctx.strokeStyle = "rgba(122,158,126,0.05)";
    for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x*CELL,0); ctx.lineTo(x*CELL,H); ctx.stroke(); }
    for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0,y*CELL); ctx.lineTo(W,y*CELL); ctx.stroke(); }
    // Food
    ctx.fillStyle = "#7a9e7e";
    ctx.beginPath();
    ctx.arc(food.x*CELL+CELL/2, food.y*CELL+CELL/2, CELL/2-2, 0, Math.PI*2);
    ctx.fill();
    // Snake
    snake.forEach((s, i) => {
      const alpha = 0.5 + 0.5 * (i / snake.length);
      ctx.fillStyle = i === snake.length-1 ? "#a3c9a8" : `rgba(122,158,126,${alpha})`;
      ctx.fillRect(s.x*CELL+1, s.y*CELL+1, CELL-2, CELL-2);
    });
  }

  window.snakeStart = function() {
    snake   = [{ x: 10, y: 9 }, { x: 9, y: 9 }, { x: 8, y: 9 }];
    dir     = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    score   = 0;
    alive   = true;
    placeFood();
    vp.querySelector("#snake-overlay").style.display = "none";
    clearInterval(loop);
    loop = setInterval(tick, 120);
    _activeGame = loop;
  };

  function tick() {
    dir = { ...nextDir };
    const head = { x: snake[snake.length-1].x + dir.x, y: snake[snake.length-1].y + dir.y };
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS ||
        snake.some(s => s.x === head.x && s.y === head.y)) {
      clearInterval(loop);
      vp.querySelector("#snake-final").textContent = "Score: " + score;
      vp.querySelector("#snake-overlay").style.display = "";
      vp.querySelector("#snake-overlay .game-start-btn").textContent = "PLAY AGAIN";
      return;
    }
    snake.push(head);
    if (head.x === food.x && head.y === food.y) {
      score++;
      vp.querySelector("#snake-score-bar").textContent = "Score: " + score;
      placeFood();
    } else {
      snake.shift();
    }
    draw();
  }

  document.addEventListener("keydown", snakeKey);
  vp.addEventListener("remove", () => document.removeEventListener("keydown", snakeKey));

  function snakeKey(e) {
    const map = {
      ArrowUp:    { x:  0, y: -1 }, w: { x:  0, y: -1 },
      ArrowDown:  { x:  0, y:  1 }, s: { x:  0, y:  1 },
      ArrowLeft:  { x: -1, y:  0 }, a: { x: -1, y:  0 },
      ArrowRight: { x:  1, y:  0 }, d: { x:  1, y:  0 },
    };
    const k = e.key === "ArrowUp" ? "ArrowUp" : e.key === "ArrowDown" ? "ArrowDown" :
              e.key === "ArrowLeft" ? "ArrowLeft" : e.key === "ArrowRight" ? "ArrowRight" : e.key.toLowerCase();
    const nd = map[k];
    if (!nd) return;
    // Prevent 180°
    if (nd.x !== -dir.x || nd.y !== -dir.y) nextDir = nd;
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) e.preventDefault();
  }

  draw();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  2048
// ═══════════════════════════════════════════════════════════════════════════════
function init2048(vp) {
  let board, score, best;

  vp.innerHTML = `
    <div class="game-viewport-bar">
      <span class="game-viewport-name">🔢 2048</span>
      <span class="game-viewport-score" id="t2048-score-bar">0</span>
      <button class="game-close-btn" onclick="closeGameViewport()">✕ Exit</button>
    </div>
    <div class="game-canvas-wrap">
      <div class="t2048-wrap">
        <div class="t2048-info">
          <div class="t2048-stat"><div class="t2048-stat-label">SCORE</div><div class="t2048-stat-val" id="t2048-score">0</div></div>
          <div class="t2048-stat"><div class="t2048-stat-label">BEST</div><div class="t2048-stat-val" id="t2048-best">0</div></div>
          <button class="game-start-btn" onclick="t2048New()" style="margin:0;padding:6px 16px;font-size:10px">NEW</button>
        </div>
        <div class="t2048-board" id="t2048-board"></div>
        <div class="t2048-hint">Arrow keys or swipe to play</div>
      </div>
    </div>`;

  best = 0;

  function newGame() {
    board = Array.from({length:4}, ()=>Array(4).fill(0));
    score = 0;
    addTile(); addTile();
    render();
  }

  function addTile() {
    const empty = [];
    for (let r=0;r<4;r++) for (let c=0;c<4;c++) if (!board[r][c]) empty.push([r,c]);
    if (!empty.length) return;
    const [r,c] = empty[Math.floor(Math.random()*empty.length)];
    board[r][c] = Math.random() < 0.9 ? 2 : 4;
  }

  function render() {
    const el = document.getElementById("t2048-board");
    if (!el) return;
    el.innerHTML = "";
    board.forEach(row => row.forEach(v => {
      const cell = document.createElement("div");
      cell.className = "t2048-cell";
      cell.dataset.v = v;
      cell.textContent = v || "";
      el.appendChild(cell);
    }));
    const scoreEl = document.getElementById("t2048-score");
    const bestEl  = document.getElementById("t2048-best");
    if (scoreEl) scoreEl.textContent = score;
    if (bestEl)  bestEl.textContent  = best;
  }

  function slide(row) {
    let arr = row.filter(v => v);
    let gained = 0;
    for (let i=0; i<arr.length-1; i++) {
      if (arr[i] === arr[i+1]) { arr[i] *= 2; gained += arr[i]; arr.splice(i+1,1); }
    }
    score += gained; if (score > best) best = score;
    while (arr.length < 4) arr.push(0);
    return arr;
  }

  function move(dir) {
    let moved = false;
    const prev = JSON.stringify(board);
    if (dir === "left")  board = board.map(r => slide(r));
    if (dir === "right") board = board.map(r => slide([...r].reverse()).reverse());
    if (dir === "up")    { board = transpose(board).map(r=>slide(r)); board = transpose(board); }
    if (dir === "down")  { board = transpose(board).map(r=>slide([...r].reverse()).reverse()); board = transpose(board); }
    if (JSON.stringify(board) !== prev) { moved = true; addTile(); render(); }
    return moved;
  }

  function transpose(b) { return b[0].map((_,i) => b.map(r=>r[i])); }

  window.t2048New = newGame;

  document.addEventListener("keydown", t2048Key);

  function t2048Key(e) {
    const map = { ArrowLeft:"left", ArrowRight:"right", ArrowUp:"up", ArrowDown:"down" };
    if (!map[e.key]) return;
    e.preventDefault();
    move(map[e.key]);
  }

  // Touch support
  let tx=0,ty=0;
  vp.addEventListener("touchstart", e => { tx=e.touches[0].clientX; ty=e.touches[0].clientY; });
  vp.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? "right" : "left");
    else move(dy > 0 ? "down" : "up");
  });

  newGame();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TETRIS
// ═══════════════════════════════════════════════════════════════════════════════
function initTetris(vp) {
  const COLS=10, ROWS=20, CELL=22;
  const W=COLS*CELL, H=ROWS*CELL, NW=4*CELL, NH=4*CELL;

  const PIECES = [
    [[1,1,1,1]],
    [[1,1],[1,1]],
    [[0,1,0],[1,1,1]],
    [[1,0],[1,0],[1,1]],
    [[0,1],[0,1],[1,1]],
    [[1,1,0],[0,1,1]],
    [[0,1,1],[1,1,0]],
  ];
  const COLORS = ["#a3c9a8","#7a9e7e","#5a8060","#3a6040","#1a4a2a","#4ade80","#22c55e"];

  let grid, piece, pieceX, pieceY, pieceColor, next, nextColor, score, lines, level, loop, alive;

  vp.innerHTML = `
    <div class="game-viewport-bar">
      <span class="game-viewport-name">🧱 TETRIS</span>
      <span class="game-viewport-score" id="tet-score-bar">0</span>
      <button class="game-close-btn" onclick="closeGameViewport()">✕ Exit</button>
    </div>
    <div class="game-canvas-wrap">
      <div class="tetris-wrap">
        <canvas id="tetris-canvas" width="${W}" height="${H}"></canvas>
        <div class="tetris-side">
          <div class="tetris-panel">
            <div class="tetris-panel-label">NEXT</div>
            <canvas id="tetris-next-canvas" width="${NW}" height="${NH}"></canvas>
          </div>
          <div class="tetris-panel">
            <div class="tetris-panel-label">SCORE</div>
            <div class="tetris-panel-val" id="tet-score">0</div>
          </div>
          <div class="tetris-panel">
            <div class="tetris-panel-label">LINES</div>
            <div class="tetris-panel-val" id="tet-lines">0</div>
          </div>
          <div class="tetris-panel">
            <div class="tetris-panel-label">LEVEL</div>
            <div class="tetris-panel-val" id="tet-level">1</div>
          </div>
          <div class="tetris-controls">
            ← → Move<br>↑ Rotate<br>↓ Soft drop<br>Space Hard drop<br>P Pause
          </div>
        </div>
      </div>
      <div class="game-overlay" id="tet-overlay">
        <div class="game-overlay-title">TETRIS</div>
        <div class="game-overlay-sub">← → move  ↑ rotate  ↓ drop</div>
        <div class="game-overlay-score" id="tet-final"></div>
        <button class="game-start-btn" onclick="tetStart()">START</button>
      </div>
    </div>`;

  const canvas  = vp.querySelector("#tetris-canvas");
  const ctx     = canvas.getContext("2d");
  const ncanvas = vp.querySelector("#tetris-next-canvas");
  const nctx    = ncanvas.getContext("2d");
  let paused = false;

  function rndPiece() {
    const i = Math.floor(Math.random() * PIECES.length);
    return { shape: PIECES[i].map(r=>[...r]), color: COLORS[i] };
  }

  function newGrid() { return Array.from({length:ROWS},()=>Array(COLS).fill(0)); }

  function valid(sh, px, py) {
    for (let r=0;r<sh.length;r++) for (let c=0;c<sh[r].length;c++) {
      if (!sh[r][c]) continue;
      const x=px+c, y=py+r;
      if (x<0||x>=COLS||y>=ROWS) return false;
      if (y>=0&&grid[y][x]) return false;
    }
    return true;
  }

  function place() {
    piece.shape.forEach((row,r)=>row.forEach((v,c)=>{ if(v&&pieceY+r>=0) grid[pieceY+r][pieceX+c]=piece.color; }));
    // Clear lines
    let cleared = 0;
    for (let r=ROWS-1; r>=0; r--) {
      if (grid[r].every(v=>v)) { grid.splice(r,1); grid.unshift(Array(COLS).fill(0)); cleared++; r++; }
    }
    if (cleared) {
      const pts = [0,100,300,500,800];
      score += (pts[cleared]||800) * level;
      lines += cleared;
      level = Math.floor(lines/10)+1;
    }
    vp.querySelector("#tet-score").textContent = score;
    vp.querySelector("#tet-lines").textContent = lines;
    vp.querySelector("#tet-level").textContent = level;
    vp.querySelector("#tet-score-bar").textContent = score;

    piece = next; pieceX = 3; pieceY = -2; pieceColor = nextColor;
    const np = rndPiece(); next=np; nextColor=np.color;
    if (!valid(piece.shape,pieceX,pieceY)) gameOver();
    drawNext();
  }

  function rotate(sh) {
    const R=sh[0].length, C=sh.length;
    return Array.from({length:R},(_,r)=>Array.from({length:C},(_,c)=>sh[C-1-c][r]));
  }

  function draw() {
    ctx.fillStyle="#07100a"; ctx.fillRect(0,0,W,H);
    // Grid lines
    ctx.strokeStyle="rgba(122,158,126,0.07)";
    for(let x=0;x<=COLS;x++){ctx.beginPath();ctx.moveTo(x*CELL,0);ctx.lineTo(x*CELL,H);ctx.stroke();}
    for(let y=0;y<=ROWS;y++){ctx.beginPath();ctx.moveTo(0,y*CELL);ctx.lineTo(W,y*CELL);ctx.stroke();}
    // Placed cells
    grid.forEach((row,r)=>row.forEach((v,c)=>{
      if(!v)return;
      ctx.fillStyle=v; ctx.fillRect(c*CELL+1,r*CELL+1,CELL-2,CELL-2);
    }));
    // Ghost piece
    let gy=pieceY;
    while(valid(piece.shape,pieceX,gy+1)) gy++;
    piece.shape.forEach((row,r)=>row.forEach((v,c)=>{
      if(!v)return;
      ctx.fillStyle="rgba(122,158,126,0.15)";
      ctx.fillRect((pieceX+c)*CELL+1,(gy+r)*CELL+1,CELL-2,CELL-2);
    }));
    // Current piece
    piece.shape.forEach((row,r)=>row.forEach((v,c)=>{
      if(!v)return;
      ctx.fillStyle=piece.color;
      ctx.fillRect((pieceX+c)*CELL+1,(pieceY+r)*CELL+1,CELL-2,CELL-2);
    }));
  }

  function drawNext() {
    nctx.fillStyle="#07100a"; nctx.fillRect(0,0,NW,NH);
    next.shape.forEach((row,r)=>row.forEach((v,c)=>{
      if(!v)return;
      nctx.fillStyle=next.color;
      nctx.fillRect(c*CELL+4,r*CELL+4,CELL-2,CELL-2);
    }));
  }

  function tick() {
    if(!alive||paused)return;
    if(valid(piece.shape,pieceX,pieceY+1)) pieceY++;
    else place();
    draw();
  }

  function gameOver() {
    alive=false; clearInterval(loop);
    vp.querySelector("#tet-final").textContent="Score: "+score;
    vp.querySelector("#tet-overlay").style.display="";
    vp.querySelector("#tet-overlay .game-start-btn").textContent="PLAY AGAIN";
  }

  window.tetStart = function() {
    grid=newGrid(); score=0; lines=0; level=1; alive=true; paused=false;
    const p=rndPiece(); piece=p; pieceX=3; pieceY=-2; pieceColor=p.color;
    const n=rndPiece(); next=n; nextColor=n.color;
    vp.querySelector("#tet-overlay").style.display="none";
    clearInterval(loop);
    loop=setInterval(tick, Math.max(80,500-level*40));
    _activeGame=loop;
    drawNext(); draw();
  };

  document.addEventListener("keydown",tetKey);

  function tetKey(e){
    if(!alive)return;
    if(e.key==="p"||e.key==="P"){paused=!paused;return;}
    if(paused)return;
    if(e.key==="ArrowLeft"  &&valid(piece.shape,pieceX-1,pieceY)){pieceX--;draw();e.preventDefault();}
    if(e.key==="ArrowRight" &&valid(piece.shape,pieceX+1,pieceY)){pieceX++;draw();e.preventDefault();}
    if(e.key==="ArrowDown"  &&valid(piece.shape,pieceX,pieceY+1)){pieceY++;draw();e.preventDefault();}
    if(e.key==="ArrowUp"){
      const rot=rotate(piece.shape);
      if(valid(rot,pieceX,pieceY)){piece.shape=rot;draw();}
      e.preventDefault();
    }
    if(e.key===" "){
      while(valid(piece.shape,pieceX,pieceY+1)) pieceY++;
      place(); draw(); e.preventDefault();
    }
  }

  draw(); drawNext();
}
