"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — games.js
//  Games Hub: Snake · 2048 · Tetris
// ══════════════════════════════════════

function openGames() {
  const existing = document.getElementById("win-games");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-games"); return; }

  const win = document.createElement("div");
  win.className = "window"; win.id = "win-games";
  win.style.cssText = "top:70px;left:160px;width:520px;height:440px";

  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-games')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-games')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-games')"></button>
      </div>
      <span class="window-title">GAMES</span>
    </div>
    <div class="window-body" style="overflow:hidden">
      <div class="games-hub" id="games-hub">
        <div class="games-hub-header">
          <div class="games-hub-title">⬡ ARCADE</div>
          <div class="games-hub-sub">SELECT A GAME TO PLAY</div>
        </div>
        <div class="games-grid">
          <div class="game-card" onclick="launchSnake()">
            <div class="game-card-icon">🐍</div>
            <div class="game-card-name">SNAKE</div>
            <div class="game-card-desc">Classic arcade</div>
          </div>
          <div class="game-card" onclick="launch2048()">
            <div class="game-card-icon">🔢</div>
            <div class="game-card-name">2048</div>
            <div class="game-card-desc">Slide & merge</div>
          </div>
          <div class="game-card" onclick="launchTetris()">
            <div class="game-card-icon">🟩</div>
            <div class="game-card-name">TETRIS</div>
            <div class="game-card-desc">Stack the blocks</div>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-games");
  openWindows["win-games"] = { title: "Games", iconId: "games" };
  refreshTaskbar();
}

// ── Viewport helper ───────────────────────────────────────────────────────────
function openGameViewport(title, scoreLabel, renderFn) {
  const hub = document.getElementById("games-hub");
  const wb  = document.querySelector("#win-games .window-body");
  if (!hub || !wb) return;

  // Remove any existing viewport
  const old = document.getElementById("game-viewport");
  if (old) old.remove();

  const vp = document.createElement("div");
  vp.className = "game-viewport"; vp.id = "game-viewport";
  vp.innerHTML = `
    <div class="game-viewport-bar">
      <span class="game-viewport-name">${title}</span>
      <span class="game-viewport-score" id="game-score">${scoreLabel}</span>
      <button class="game-close-btn" onclick="closeGameViewport()">✕ BACK</button>
    </div>
    <div class="game-canvas-wrap" id="game-canvas-wrap"></div>`;

  wb.appendChild(vp);
  renderFn(document.getElementById("game-canvas-wrap"));
}

function closeGameViewport() {
  const vp = document.getElementById("game-viewport");
  if (vp) { vp.remove(); stopAllGames(); }
}

function stopAllGames() {
  snakeStop(); tetrisStop();
}

// ══════════════════════════════════════
//  SNAKE
// ══════════════════════════════════════

let snakeLoop = null;

function snakeStop() {
  if (snakeLoop) { clearInterval(snakeLoop); snakeLoop = null; }
}

function launchSnake() {
  openGameViewport("🐍 SNAKE", "SCORE: 0", (wrap) => {
    const CELL = 18, COLS = 22, ROWS = 18;
    const W = CELL * COLS, H = CELL * ROWS;

    const canvas = document.createElement("canvas");
    canvas.id = "snake-canvas"; canvas.width = W; canvas.height = H;
    wrap.appendChild(canvas);

    const overlay = document.createElement("div");
    overlay.className = "game-overlay"; overlay.id = "snake-overlay";
    overlay.innerHTML = `
      <div class="game-overlay-title">SNAKE</div>
      <div class="game-overlay-sub">USE ARROW KEYS OR WASD</div>
      <button class="game-start-btn" onclick="snakeStart()">START GAME</button>`;
    wrap.appendChild(overlay);

    const ctx = canvas.getContext("2d");
    // Draw empty grid
    snakeDrawGrid(ctx, COLS, ROWS, CELL);
  });
}

function snakeStart() {
  const canvas = document.getElementById("snake-canvas");
  const overlay = document.getElementById("snake-overlay");
  if (!canvas) return;
  if (overlay) overlay.style.display = "none";

  const CELL = 18, COLS = 22, ROWS = 18;
  const ctx = canvas.getContext("2d");

  let snake = [{ x: 10, y: 9 }, { x: 9, y: 9 }, { x: 8, y: 9 }];
  let dir = { x: 1, y: 0 }, nextDir = { x: 1, y: 0 };
  let food = snakeRandomFood(snake, COLS, ROWS);
  let score = 0, alive = true;

  function keyHandler(e) {
    const map = {
      ArrowUp:    { x: 0,  y: -1 }, w: { x: 0,  y: -1 },
      ArrowDown:  { x: 0,  y:  1 }, s: { x: 0,  y:  1 },
      ArrowLeft:  { x: -1, y:  0 }, a: { x: -1, y:  0 },
      ArrowRight: { x: 1,  y:  0 }, d: { x: 1,  y:  0 },
    };
    const nd = map[e.key] || map[e.key.toLowerCase()];
    if (!nd) return;
    // Prevent reversing
    if (nd.x !== -dir.x || nd.y !== -dir.y) nextDir = nd;
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) e.preventDefault();
  }
  document.addEventListener("keydown", keyHandler);

  snakeStop();
  snakeLoop = setInterval(() => {
    if (!alive) return;
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // Wall collision
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      alive = false; snakeGameOver(ctx, COLS, ROWS, CELL, score, keyHandler); return;
    }
    // Self collision
    if (snake.some(s => s.x === head.x && s.y === head.y)) {
      alive = false; snakeGameOver(ctx, COLS, ROWS, CELL, score, keyHandler); return;
    }

    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score++; food = snakeRandomFood(snake, COLS, ROWS);
      const scoreEl = document.getElementById("game-score");
      if (scoreEl) scoreEl.textContent = "SCORE: " + score;
    } else { snake.pop(); }

    snakeDraw(ctx, snake, food, COLS, ROWS, CELL);
  }, 130);

  // Cleanup on viewport close
  canvas.dataset.cleanup = "snake";
  canvas._cleanupFn = () => { document.removeEventListener("keydown", keyHandler); };
}

function snakeGameOver(ctx, COLS, ROWS, CELL, score, keyHandler) {
  snakeStop();
  document.removeEventListener("keydown", keyHandler);
  const scoreEl = document.getElementById("game-score");
  if (scoreEl) scoreEl.textContent = "SCORE: " + score;

  const wrap = document.getElementById("game-canvas-wrap");
  if (!wrap) return;
  const old = document.getElementById("snake-overlay");
  if (old) old.remove();
  const overlay = document.createElement("div");
  overlay.className = "game-overlay"; overlay.id = "snake-overlay";
  overlay.innerHTML = `
    <div class="game-overlay-title">GAME OVER</div>
    <div class="game-overlay-score">SCORE: ${score}</div>
    <button class="game-start-btn" onclick="snakeStart()">PLAY AGAIN</button>`;
  wrap.appendChild(overlay);
}

function snakeRandomFood(snake, COLS, ROWS) {
  let f;
  do { f = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }; }
  while (snake.some(s => s.x === f.x && s.y === f.y));
  return f;
}

function snakeDrawGrid(ctx, COLS, ROWS, CELL) {
  ctx.fillStyle = "#050d07";
  ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
  ctx.strokeStyle = "rgba(122,158,126,0.06)";
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, ROWS * CELL); ctx.stroke(); }
  for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(COLS * CELL, y * CELL); ctx.stroke(); }
}

function snakeDraw(ctx, snake, food, COLS, ROWS, CELL) {
  snakeDrawGrid(ctx, COLS, ROWS, CELL);
  // Food
  ctx.fillStyle = "#ff6b6b";
  ctx.beginPath();
  ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  // Snake
  snake.forEach((seg, i) => {
    ctx.fillStyle = i === 0 ? "#a3c9a8" : `rgba(122,158,126,${1 - i / (snake.length + 4)})`;
    const pad = i === 0 ? 1 : 2;
    ctx.beginPath();
    ctx.roundRect(seg.x * CELL + pad, seg.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 3);
    ctx.fill();
  });
}

// ══════════════════════════════════════
//  2048
// ══════════════════════════════════════

function launch2048() {
  openGameViewport("🔢 2048", "SCORE: 0", (wrap) => {
    wrap.style.overflow = "auto";
    const div = document.createElement("div");
    div.className = "t2048-wrap"; div.id = "t2048-wrap";
    div.innerHTML = `
      <div class="t2048-info">
        <div class="t2048-stat"><div class="t2048-stat-label">SCORE</div><div class="t2048-stat-val" id="t2048-score">0</div></div>
        <div class="t2048-stat"><div class="t2048-stat-label">BEST</div><div class="t2048-stat-val" id="t2048-best">0</div></div>
      </div>
      <div class="t2048-board" id="t2048-board"></div>
      <div class="t2048-hint">ARROW KEYS OR WASD TO SLIDE</div>`;
    wrap.appendChild(div);
    t2048Init();
  });
}

let t2048Grid = [], t2048Score = 0, t2048Best = parseInt(localStorage.getItem("mos_2048_best") || "0");

function t2048Init() {
  t2048Grid = Array.from({ length: 4 }, () => Array(4).fill(0));
  t2048Score = 0;
  t2048AddTile(); t2048AddTile();
  t2048Render();
  document.addEventListener("keydown", t2048KeyHandler);
}

function t2048KeyHandler(e) {
  const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
                w: "up", s: "down", a: "left", d: "right" };
  const dir = map[e.key] || map[e.key.toLowerCase()];
  if (!dir) return;
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) e.preventDefault();

  const prev = JSON.stringify(t2048Grid);
  t2048Slide(dir);
  if (JSON.stringify(t2048Grid) !== prev) {
    t2048AddTile();
    t2048Render();
    if (t2048CheckLose()) {
      setTimeout(() => alert("No more moves! Score: " + t2048Score), 50);
      document.removeEventListener("keydown", t2048KeyHandler);
    }
  }
}

function t2048Slide(dir) {
  const rotations = { up: 1, right: 2, down: 3, left: 0 };
  const n = rotations[dir];
  for (let i = 0; i < n; i++) t2048Grid = t2048RotateCW(t2048Grid);
  t2048Grid = t2048Grid.map(row => t2048SlideRow(row));
  const back = (4 - n) % 4;
  for (let i = 0; i < back; i++) t2048Grid = t2048RotateCW(t2048Grid);
}

function t2048SlideRow(row) {
  let filtered = row.filter(v => v !== 0);
  for (let i = 0; i < filtered.length - 1; i++) {
    if (filtered[i] === filtered[i + 1]) {
      filtered[i] *= 2; t2048Score += filtered[i]; filtered.splice(i + 1, 1);
    }
  }
  while (filtered.length < 4) filtered.push(0);
  return filtered;
}

function t2048RotateCW(grid) {
  return grid[0].map((_, c) => grid.map(row => row[c]).reverse());
}

function t2048AddTile() {
  const empty = [];
  t2048Grid.forEach((row, r) => row.forEach((v, c) => { if (!v) empty.push([r, c]); }));
  if (!empty.length) return;
  const [r, c] = empty[Math.floor(Math.random() * empty.length)];
  t2048Grid[r][c] = Math.random() < 0.9 ? 2 : 4;
}

function t2048CheckLose() {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    if (!t2048Grid[r][c]) return false;
    if (c < 3 && t2048Grid[r][c] === t2048Grid[r][c + 1]) return false;
    if (r < 3 && t2048Grid[r][c] === t2048Grid[r + 1][c]) return false;
  }
  return true;
}

function t2048Render() {
  const board = document.getElementById("t2048-board");
  if (!board) return;
  board.innerHTML = "";
  t2048Grid.forEach(row => row.forEach(v => {
    const cell = document.createElement("div");
    cell.className = "t2048-cell";
    cell.dataset.v = Math.min(v, 2048);
    cell.textContent = v || "";
    board.appendChild(cell);
  }));
  const scoreEl = document.getElementById("t2048-score");
  const bestEl  = document.getElementById("t2048-best");
  const gameScoreEl = document.getElementById("game-score");
  if (t2048Score > t2048Best) { t2048Best = t2048Score; localStorage.setItem("mos_2048_best", t2048Best); }
  if (scoreEl) scoreEl.textContent = t2048Score;
  if (bestEl)  bestEl.textContent  = t2048Best;
  if (gameScoreEl) gameScoreEl.textContent = "SCORE: " + t2048Score;
}

// Clean up 2048 listener when closing
const _closeGameViewportOrig = window.closeGameViewport;
window.closeGameViewport = function() {
  document.removeEventListener("keydown", t2048KeyHandler);
  document.removeEventListener("keydown", tetrisKeyHandler);
  const vp = document.getElementById("game-viewport");
  if (vp) { vp.remove(); stopAllGames(); }
};

// ══════════════════════════════════════
//  TETRIS
// ══════════════════════════════════════

let tetrisLoop = null, tetrisState = null;

function tetrisStop() {
  if (tetrisLoop) { clearInterval(tetrisLoop); tetrisLoop = null; }
  document.removeEventListener("keydown", tetrisKeyHandler);
}

const TETROMINOS = {
  I: { cells: [[0,1],[1,1],[2,1],[3,1]], color: "#4ade80" },
  O: { cells: [[0,0],[1,0],[0,1],[1,1]], color: "#a3c9a8" },
  T: { cells: [[1,0],[0,1],[1,1],[2,1]], color: "#7a9e7e" },
  S: { cells: [[1,0],[2,0],[0,1],[1,1]], color: "#86efac" },
  Z: { cells: [[0,0],[1,0],[1,1],[2,1]], color: "#4ade80" },
  J: { cells: [[0,0],[0,1],[1,1],[2,1]], color: "#a3c9a8" },
  L: { cells: [[2,0],[0,1],[1,1],[2,1]], color: "#6ee7b7" },
};
const TETRO_KEYS = Object.keys(TETROMINOS);

function launchTetris() {
  openGameViewport("🟩 TETRIS", "SCORE: 0", (wrap) => {
    const CELL = 24, COLS = 10, ROWS = 18;
    const div = document.createElement("div");
    div.className = "tetris-wrap";
    div.innerHTML = `
      <canvas id="tetris-canvas" width="${COLS * CELL}" height="${ROWS * CELL}"></canvas>
      <div class="tetris-side">
        <div class="tetris-panel">
          <div class="tetris-panel-label">SCORE</div>
          <div class="tetris-panel-val" id="tet-score">0</div>
        </div>
        <div class="tetris-panel">
          <div class="tetris-panel-label">LEVEL</div>
          <div class="tetris-panel-val" id="tet-level">1</div>
        </div>
        <div class="tetris-panel">
          <div class="tetris-panel-label">LINES</div>
          <div class="tetris-panel-val" id="tet-lines">0</div>
        </div>
        <div class="tetris-panel">
          <div class="tetris-panel-label">NEXT</div>
          <canvas id="tetris-next-canvas" width="72" height="72"></canvas>
        </div>
        <div class="tetris-controls">← → move<br>↑ rotate<br>↓ soft drop<br>Space drop</div>
      </div>`;
    wrap.appendChild(div);

    const canvas = document.getElementById("tetris-canvas");
    const ctx    = canvas.getContext("2d");
    tetrisInitState(COLS, ROWS, CELL, ctx);

    const overlay = document.createElement("div");
    overlay.className = "game-overlay"; overlay.id = "tetris-overlay";
    overlay.innerHTML = `
      <div class="game-overlay-title">TETRIS</div>
      <div class="game-overlay-sub">ARROW KEYS · SPACE TO DROP</div>
      <button class="game-start-btn" onclick="tetrisBegin()">START GAME</button>`;
    wrap.appendChild(overlay);
  });
}

function tetrisInitState(COLS, ROWS, CELL, ctx) {
  tetrisState = {
    COLS, ROWS, CELL, ctx,
    board: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
    piece: null, nextPiece: null,
    score: 0, lines: 0, level: 1,
    alive: true, started: false,
  };
  tetrisState.nextPiece = tetrisRandomPiece(COLS);
  tetrisDrawBoard();
}

function tetrisBegin() {
  const overlay = document.getElementById("tetris-overlay");
  if (overlay) overlay.style.display = "none";
  if (!tetrisState) return;
  tetrisState.alive   = true;
  tetrisState.started = true;
  tetrisState.score   = 0;
  tetrisState.lines   = 0;
  tetrisState.level   = 1;
  tetrisState.board   = Array.from({ length: tetrisState.ROWS }, () => Array(tetrisState.COLS).fill(null));
  tetrisState.nextPiece = tetrisRandomPiece(tetrisState.COLS);
  tetrisSpawnPiece();
  document.addEventListener("keydown", tetrisKeyHandler);
  tetrisStop(); // clear any existing loop
  tetrisLoop = setInterval(tetrisTick, 500);
}

function tetrisRandomPiece(COLS) {
  const key = TETRO_KEYS[Math.floor(Math.random() * TETRO_KEYS.length)];
  const t   = TETROMINOS[key];
  return { cells: t.cells.map(c => [...c]), color: t.color, key };
}

function tetrisSpawnPiece() {
  if (!tetrisState) return;
  tetrisState.piece    = tetrisState.nextPiece;
  tetrisState.piece.x  = Math.floor(tetrisState.COLS / 2) - 2;
  tetrisState.piece.y  = 0;
  tetrisState.nextPiece = tetrisRandomPiece(tetrisState.COLS);
  tetrisDrawNext();
  if (tetrisCollides(tetrisState.piece, 0, 0)) {
    tetrisState.alive = false; tetrisStop(); tetrisGameOver();
  }
  tetrisDrawBoard();
}

function tetrisCollides(piece, dx, dy, rotated) {
  const { board, COLS, ROWS } = tetrisState;
  const cells = rotated || piece.cells;
  return cells.some(([cx, cy]) => {
    const nx = piece.x + cx + dx, ny = piece.y + cy + dy;
    return nx < 0 || nx >= COLS || ny >= ROWS || (ny >= 0 && board[ny][nx]);
  });
}

function tetrisTick() {
  if (!tetrisState || !tetrisState.alive) return;
  if (!tetrisCollides(tetrisState.piece, 0, 1)) {
    tetrisState.piece.y++;
  } else {
    tetrisLock();
    tetrisClearLines();
    tetrisSpawnPiece();
  }
  tetrisDrawBoard();
}

function tetrisLock() {
  const { piece, board } = tetrisState;
  piece.cells.forEach(([cx, cy]) => {
    const nx = piece.x + cx, ny = piece.y + cy;
    if (ny >= 0) board[ny][nx] = piece.color;
  });
}

function tetrisClearLines() {
  const { board, ROWS, COLS } = tetrisState;
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v)) {
      board.splice(r, 1);
      board.unshift(Array(COLS).fill(null));
      cleared++; r++;
    }
  }
  if (!cleared) return;
  const points = [0, 100, 300, 500, 800][cleared] * tetrisState.level;
  tetrisState.score += points;
  tetrisState.lines += cleared;
  tetrisState.level = Math.floor(tetrisState.lines / 10) + 1;
  clearInterval(tetrisLoop);
  tetrisLoop = setInterval(tetrisTick, Math.max(80, 500 - (tetrisState.level - 1) * 45));
  const sEl = document.getElementById("tet-score"); if (sEl) sEl.textContent = tetrisState.score;
  const lEl = document.getElementById("tet-lines"); if (lEl) lEl.textContent = tetrisState.lines;
  const lvEl= document.getElementById("tet-level"); if (lvEl) lvEl.textContent = tetrisState.level;
  const gsEl= document.getElementById("game-score"); if (gsEl) gsEl.textContent = "SCORE: " + tetrisState.score;
}

function tetrisRotate(cells) {
  // Rotate 90° CW around bounding box center
  const maxX = Math.max(...cells.map(c => c[0]));
  return cells.map(([cx, cy]) => [cy, maxX - cx]);
}

function tetrisKeyHandler(e) {
  if (!tetrisState || !tetrisState.alive || !tetrisState.started) return;
  const p = tetrisState.piece;
  if (!p) return;
  switch (e.key) {
    case "ArrowLeft":  if (!tetrisCollides(p, -1, 0)) { p.x--; tetrisDrawBoard(); } break;
    case "ArrowRight": if (!tetrisCollides(p,  1, 0)) { p.x++; tetrisDrawBoard(); } break;
    case "ArrowDown":
      if (!tetrisCollides(p, 0, 1)) { p.y++; tetrisDrawBoard(); }
      break;
    case "ArrowUp": {
      const rotated = tetrisRotate(p.cells);
      if (!tetrisCollides(p, 0, 0, rotated)) { p.cells = rotated; tetrisDrawBoard(); }
      break;
    }
    case " ": {
      while (!tetrisCollides(p, 0, 1)) p.y++;
      tetrisLock(); tetrisClearLines(); tetrisSpawnPiece(); tetrisDrawBoard();
      break;
    }
    default: return;
  }
  e.preventDefault();
}

function tetrisDrawBoard() {
  const { board, piece, ROWS, COLS, CELL, ctx } = tetrisState;
  ctx.fillStyle = "#050d07";
  ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
  // Grid
  ctx.strokeStyle = "rgba(122,158,126,0.06)"; ctx.lineWidth = 0.5;
  for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, ROWS * CELL); ctx.stroke(); }
  for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(COLS * CELL, y * CELL); ctx.stroke(); }
  // Locked cells
  board.forEach((row, r) => row.forEach((color, c) => {
    if (!color) return;
    ctx.fillStyle = color;
    ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
  }));
  // Ghost piece
  if (piece) {
    const ghost = { ...piece, y: piece.y };
    while (!tetrisCollides(ghost, 0, 1)) ghost.y++;
    piece.cells.forEach(([cx, cy]) => {
      const gx = piece.x + cx, gy = ghost.y + cy;
      if (gy >= 0) {
        ctx.fillStyle = "rgba(122,158,126,0.15)";
        ctx.fillRect(gx * CELL + 1, gy * CELL + 1, CELL - 2, CELL - 2);
      }
    });
    // Active piece
    piece.cells.forEach(([cx, cy]) => {
      const nx = piece.x + cx, ny = piece.y + cy;
      if (ny >= 0) {
        ctx.fillStyle = piece.color;
        ctx.fillRect(nx * CELL + 1, ny * CELL + 1, CELL - 2, CELL - 2);
      }
    });
  }
}

function tetrisDrawNext() {
  const nc = document.getElementById("tetris-next-canvas");
  if (!nc || !tetrisState) return;
  const ctx2 = nc.getContext("2d");
  const CELL = 18;
  ctx2.fillStyle = "#050d07"; ctx2.fillRect(0, 0, 72, 72);
  const p = tetrisState.nextPiece;
  ctx2.fillStyle = p.color;
  p.cells.forEach(([cx, cy]) => ctx2.fillRect(cx * CELL + 3, cy * CELL + 3, CELL - 2, CELL - 2));
}

function tetrisGameOver() {
  const wrap = document.getElementById("game-canvas-wrap"); if (!wrap) return;
  const old = document.getElementById("tetris-overlay"); if (old) old.remove();
  const overlay = document.createElement("div");
  overlay.className = "game-overlay"; overlay.id = "tetris-overlay";
  overlay.innerHTML = `
    <div class="game-overlay-title">GAME OVER</div>
    <div class="game-overlay-score">SCORE: ${tetrisState?.score || 0}</div>
    <button class="game-start-btn" onclick="tetrisBegin()">PLAY AGAIN</button>`;
  wrap.appendChild(overlay);
}
