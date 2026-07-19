/* PhantomCube — an original B-Cubed-style tile-clearing puzzle for
 * PhantomPlay. All rules live in levels.js's createSim(), the exact
 * engine a BFS solver ran over every level to prove it solvable before
 * shipping (see PARS below — each entry is the solver's true minimum).
 *
 * Structure follows the classic web-puzzle format: numbered levels,
 * level-select grid, beat-one-to-unlock-the-next progression.
 *
 * PhantomPlay host bridge — see starter-template.html for the platform
 * contract this implements (ready/score/progress/complete, settings,
 * restore). Embedded play runs sandboxed without allow-same-origin, so
 * localStorage throws there (verified) — progress instead rides in the
 * `state` field of score/progress/complete messages, and the host hands
 * it back via `restore` after `ready`. Standalone (non-embedded) play
 * still uses localStorage so the demo catalog keeps working unchanged.
 */
(function () {
  "use strict";

  const { LEVELS, createSim } = window.PhantomCubeCore;
  /* Solver-verified minimum moves per level (scratch solver run, BFS
     over the same createSim rules — not hand-guessed). */
  const PARS = [8, 11, 8, 5, 14, 8, 10, 7, 12, 16, 11, 18];

  const embedded = window.parent !== window;
  const host = (type, data = {}) => { if (embedded) parent.postMessage({ source: "phantomplay-game", type, ...data }, "*"); };
  let hostSound = true, hostReducedMotion = false;

  const PROGRESS_KEY = "pf.phantomcube.v1";
  function loadProgress() {
    if (embedded) return { unlocked: 1, done: {} }; // filled in by `restore` if the host has prior state
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || { unlocked: 1, done: {} }; }
    catch { return { unlocked: 1, done: {} }; }
  }
  function saveProgress(p) {
    if (embedded) { host("progress", { progress: Math.round((Object.keys(p.done).length / LEVELS.length) * 100), state: p }); return; }
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch {}
  }
  let progress = loadProgress();
  let allClearedSent = false; // host requires 'complete' exactly once per run

  window.addEventListener("message", (e) => {
    if (!e.data || e.data.source !== "phantomplay-host") return;
    if (e.data.type === "settings") { hostSound = e.data.sound !== false; hostReducedMotion = !!e.data.reducedMotion; }
    if (e.data.type === "restore" && e.data.state && typeof e.data.state.unlocked === "number") {
      progress = e.data.state;
      renderLevelSelect();
    }
  });

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let levelIndex = 0;
  let sim = null;
  let cubeAnim = null; // {fromR,fromC,toR,toC,t} render-side slide tween
  let crumbles = [];   // {r,c,t} tiles fading out
  let finished = false;

  function loadLevel(i) {
    levelIndex = i;
    sim = createSim(LEVELS[i]);
    cubeAnim = null;
    crumbles = [];
    finished = false;
    winOverlay.hidden = true;
    stuckOverlay.hidden = true;
    selectOverlay.hidden = true;
    hudLevelNum.textContent = String(i + 1);
    hudLevelName.textContent = LEVELS[i].name;
    hudPar.textContent = String(PARS[i]);
    hudMoves.textContent = "0";
  }

  function keyRC(key) { const [r, c] = key.split(",").map(Number); return { r, c }; }

  function tryMove(dir) {
    if (!sim || finished || !winOverlay.hidden || !selectOverlay.hidden) return false;
    const before = sim.pos;
    const beforeState = sim.stateOf(before);
    if (!sim.move(dir)) return false;
    const a = keyRC(before), b = keyRC(sim.pos);
    cubeAnim = { fromR: a.r, fromC: a.c, toR: b.r, toC: b.c, t: 0 };
    if (beforeState !== Infinity && sim.stateOf(before) === 0) crumbles.push({ r: a.r, c: a.c, t: 0 });
    hudMoves.textContent = String(sim.moves);
    if (sim.won()) onWin();
    else if (sim.stuck()) setTimeout(() => { if (sim.stuck()) stuckOverlay.hidden = false; }, 450);
    return true;
  }

  function onWin() {
    finished = true;
    progress.done[levelIndex] = Math.min(progress.done[levelIndex] || Infinity, sim.moves);
    progress.unlocked = Math.max(progress.unlocked, Math.min(LEVELS.length, levelIndex + 2));
    saveProgress(progress);
    const par = PARS[levelIndex];
    const allCleared = Object.keys(progress.done).length >= LEVELS.length;
    const scorePayload = { score: Object.values(progress.done).reduce((s, m) => s + Math.max(0, 100 - m), 0), progress: Math.round((Object.keys(progress.done).length / LEVELS.length) * 100), state: progress };
    host("score", scorePayload);
    if (allCleared && !allClearedSent) { allClearedSent = true; host("complete", { ...scorePayload, progress: 100 }); }
    winTitle.textContent = `Level ${levelIndex + 1} Clear!`;
    winSub.textContent = sim.moves <= par
      ? `${sim.moves} moves — that's par. Perfect run.`
      : `${sim.moves} moves (par ${par}).`;
    nextBtn.hidden = levelIndex + 1 >= LEVELS.length;
    setTimeout(() => { winOverlay.hidden = false; }, 380);
  }

  // ---------------------------------------------------------------------
  // Isometric rendering
  // ---------------------------------------------------------------------
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  const TILE_W = 74, TILE_H = 40, TILE_D = 14, CUBE_H = 40;

  function isoX(r, c) { return (c - r) * (TILE_W / 2); }
  function isoY(r, c) { return (c + r) * (TILE_H / 2); }

  function levelBounds() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [, cell] of sim.cells) {
      const x = isoX(cell.r, cell.c), y = isoY(cell.r, cell.c);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { minX: minX - TILE_W, maxX: maxX + TILE_W, minY: minY - TILE_H, maxY: maxY + TILE_H * 2 };
  }

  function diamond(cx, cy, w, h) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy);
    ctx.lineTo(cx, cy + h / 2);
    ctx.lineTo(cx - w / 2, cy);
    ctx.closePath();
  }

  function drawTile(cell, state, t) {
    const x = isoX(cell.r, cell.c), y = isoY(cell.r, cell.c);
    let top = "#152a1f", side = "#0b1a13", edge = "rgba(65,255,161,.4)";
    if (cell.kind === "exit") {
      const allClear = (() => { for (const [k, n] of simStateIter()) if (k !== sim.exitKey && n > 0) return false; return true; })();
      const pulse = allClear ? 0.55 + Math.sin(t * 5) * 0.3 : 0.18;
      top = allClear ? "#1d4433" : "#11241b"; edge = `rgba(255,209,102,${pulse})`; side = "#0d1f16";
    } else if (cell.kind === "double") {
      top = state === 2 ? "#27204a" : "#152a1f";
      edge = state === 2 ? "rgba(160,120,255,.65)" : "rgba(65,255,161,.4)";
      side = state === 2 ? "#161230" : "#0b1a13";
    } else if (cell.kind === "tele") {
      top = "#0f2a33"; edge = "rgba(30,240,255,.65)"; side = "#08171d";
    }
    // sides
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.moveTo(x - TILE_W / 2, y);
    ctx.lineTo(x, y + TILE_H / 2);
    ctx.lineTo(x, y + TILE_H / 2 + TILE_D);
    ctx.lineTo(x - TILE_W / 2, y + TILE_D);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + TILE_W / 2, y);
    ctx.lineTo(x, y + TILE_H / 2);
    ctx.lineTo(x, y + TILE_H / 2 + TILE_D);
    ctx.lineTo(x + TILE_W / 2, y + TILE_D);
    ctx.closePath(); ctx.fill();
    // top
    diamond(x, y, TILE_W, TILE_H);
    ctx.fillStyle = top; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 1.6; ctx.stroke();
    // markers
    if (cell.kind === "double" && state === 2) {
      ctx.fillStyle = "rgba(200,170,255,.85)"; ctx.font = "700 13px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("×2", x, y);
    } else if (cell.kind === "tele") {
      ctx.strokeStyle = "rgba(30,240,255,.8)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, 14, 7, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y, 7, 3.5, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (cell.kind === "exit") {
      ctx.fillStyle = "rgba(255,209,102,.9)"; ctx.font = "700 11px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("EXIT", x, y);
    }
  }

  function simStateIter() {
    const out = [];
    for (const [key] of sim.cells) out.push([key, sim.stateOf(key)]);
    return out;
  }

  function drawCube(r, c, t) {
    const x = isoX(r, c), y = isoY(r, c);
    const bob = Math.sin(t * 3) * 1.5;
    const topY = y - CUBE_H + bob;
    // left face
    ctx.fillStyle = "#1e8f5c";
    ctx.beginPath();
    ctx.moveTo(x - TILE_W / 2 * 0.62, topY + TILE_H / 2 * 0.62);
    ctx.lineTo(x, topY + TILE_H * 0.62);
    ctx.lineTo(x, y + bob);
    ctx.lineTo(x - TILE_W / 2 * 0.62, y - TILE_H / 2 * 0.62 + bob);
    ctx.closePath(); ctx.fill();
    // right face
    ctx.fillStyle = "#25b573";
    ctx.beginPath();
    ctx.moveTo(x + TILE_W / 2 * 0.62, topY + TILE_H / 2 * 0.62);
    ctx.lineTo(x, topY + TILE_H * 0.62);
    ctx.lineTo(x, y + bob);
    ctx.lineTo(x + TILE_W / 2 * 0.62, y - TILE_H / 2 * 0.62 + bob);
    ctx.closePath(); ctx.fill();
    // top face
    diamond(x, topY, TILE_W * 0.62, TILE_H * 0.62);
    ctx.fillStyle = "#41ffa1"; ctx.fill();
    ctx.strokeStyle = "rgba(234,255,244,.7)"; ctx.lineWidth = 1.4; ctx.stroke();
    // glow
    ctx.save();
    ctx.globalAlpha = 0.25 + Math.sin(t * 3) * 0.08;
    diamond(x, y + TILE_H * 0.1, TILE_W * 1.1, TILE_H * 1.1);
    ctx.strokeStyle = "#41ffa1"; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  let lastCanvasW = 0, lastCanvasH = 0;
  function resizeIfNeeded() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w !== lastCanvasW || h !== lastCanvasH) { canvas.width = w; canvas.height = h; lastCanvasW = w; lastCanvasH = h; }
  }

  let lastFrame = 0;
  function frame(now) {
    if (!lastFrame) lastFrame = now;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const t = now / 1000;
    resizeIfNeeded();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sim) { requestAnimationFrame(frame); return; }

    const b = levelBounds();
    const scale = Math.min(1.25, (canvas.width - 60) / (b.maxX - b.minX), (canvas.height - 170) / (b.maxY - b.minY));
    ctx.save();
    ctx.translate(canvas.width / 2 - (b.minX + b.maxX) / 2 * scale, (canvas.height / 2 + 20) - (b.minY + b.maxY) / 2 * scale);
    ctx.scale(scale, scale);

    // painter's order: back-to-front by r+c
    const cells = [...sim.cells.values()].sort((p, q) => (p.r + p.c) - (q.r + q.c));
    for (const cell of cells) {
      const key = `${cell.r},${cell.c}`;
      const st = sim.stateOf(key);
      if (st > 0 || cell.kind === "exit") drawTile(cell, st, t);
    }

    // crumbling tiles fade+drop
    for (let i = crumbles.length - 1; i >= 0; i--) {
      const cr = crumbles[i];
      cr.t += dt;
      if (cr.t > 0.5) { crumbles.splice(i, 1); continue; }
      const fade = 1 - cr.t / 0.5;
      ctx.save();
      ctx.globalAlpha = fade * 0.8;
      ctx.translate(0, cr.t * 46);
      diamond(isoX(cr.r, cr.c), isoY(cr.r, cr.c), TILE_W, TILE_H);
      ctx.fillStyle = "#152a1f"; ctx.fill();
      ctx.strokeStyle = "rgba(65,255,161,.3)"; ctx.stroke();
      ctx.restore();
    }

    // cube (tweened between cells)
    let cr = keyRC(sim.pos);
    if (cubeAnim) {
      cubeAnim.t += dt * 7;
      if (cubeAnim.t >= 1) cubeAnim = null;
      else {
        const e = 1 - Math.pow(1 - cubeAnim.t, 2);
        cr = { r: cubeAnim.fromR + (cubeAnim.toR - cubeAnim.fromR) * e, c: cubeAnim.fromC + (cubeAnim.toC - cubeAnim.fromC) * e };
      }
    }
    drawCube(cr.r, cr.c, t);
    ctx.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------------
  // UI wiring
  // ---------------------------------------------------------------------
  const $ = (s) => document.querySelector(s);
  const hudLevelNum = $("[data-level-num]"), hudMoves = $("[data-moves]"), hudPar = $("[data-par]"), hudLevelName = $("[data-level-name]");
  const selectOverlay = $("[data-select-overlay]"), winOverlay = $("[data-win-overlay]"), stuckOverlay = $("[data-stuck-overlay]");
  const winTitle = $("[data-win-title]"), winSub = $("[data-win-sub]"), nextBtn = $("[data-next-btn]");
  const levelGrid = $("[data-level-grid]");

  function renderLevelSelect() {
    levelGrid.innerHTML = LEVELS.map((lv, i) => {
      const locked = i + 1 > progress.unlocked;
      const done = progress.done[i] != null;
      return `<button class="level-cell ${done ? "done" : ""}" data-pick="${i}" ${locked ? "disabled" : ""}>
        <b>${locked ? "🔒" : i + 1}</b>
        <span>${done ? `best ${progress.done[i]}` : locked ? "locked" : `par ${PARS[i]}`}</span>
      </button>`;
    }).join("");
  }
  function openLevelSelect() { renderLevelSelect(); selectOverlay.hidden = false; winOverlay.hidden = true; stuckOverlay.hidden = true; }

  levelGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pick]");
    if (btn && !btn.disabled) loadLevel(Number(btn.dataset.pick));
  });
  $("[data-restart-btn]").addEventListener("click", () => loadLevel(levelIndex));
  $("[data-stuck-restart-btn]").addEventListener("click", () => loadLevel(levelIndex));
  $("[data-levels-btn]").addEventListener("click", openLevelSelect);
  $("[data-win-levels-btn]").addEventListener("click", openLevelSelect);
  nextBtn.addEventListener("click", () => loadLevel(Math.min(LEVELS.length - 1, levelIndex + 1)));

  const KEYMAP = {
    ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
  };
  window.addEventListener("keydown", (e) => {
    if (KEYMAP[e.code]) { e.preventDefault(); tryMove(KEYMAP[e.code]); }
    else if (e.code === "KeyR") loadLevel(levelIndex);
    else if (e.code === "KeyL") openLevelSelect();
  });

  // Boot into level select (classic arcade-site flow).
  loadLevel(0);
  openLevelSelect();
  host("ready");

  // ---------------------------------------------------------------------
  // Test/debug hook — NOT part of normal play; used by the automated
  // Playwright verification, which replays the BFS solver's solution
  // through this exact UI path.
  // ---------------------------------------------------------------------
  window.__PhantomCubeTest = {
    loadLevel(i) { loadLevel(i); },
    move(dir) { return tryMove(dir); },
    state() { return { level: levelIndex, pos: sim.pos, moves: sim.moves, won: sim.won(), stuck: sim.stuck(), finished, unlocked: progress.unlocked }; },
    resetProgress() { progress = { unlocked: 1, done: {} }; allClearedSent = false; saveProgress(progress); },
  };
})();
