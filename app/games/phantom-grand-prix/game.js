/* Phantom Grand Prix - an original cockpit-view racer for PhantomPlay.
 * Arcade physics, drift-charged mini-turbos, catch-up items, CPU rivals,
 * and local split-screen remain simulation-driven in world space. The
 * renderer projects that world into each driver's first-person viewport.
 *
 * Perf discipline: fixed-timestep simulation decoupled from render
 * rate, pooled particles/projectiles (ObjectPool, below), a cached
 * Path2D for the track so it isn't rebuilt every frame, and no
 * per-frame allocation in the hot loop.
 */
(function () {
  "use strict";

  // PhantomPlay host protocol — every built-in game hand-rolls this the
  // same way: postMessage 'ready' once interactive, report score/progress/
  // complete, and react to pause/resume/restart/exit/settings from the host.
  const host = (type, data = {}) => parent.postMessage({ source: "phantomplay-game", type, ...data }, "*");

  // Generic object pool — avoids per-frame allocation in spawn-heavy hot
  // loops (particles, projectiles).
  class ObjectPool {
    constructor(factory, reset, initialSize = 0) {
      this.factory = factory; // () => T — creates a brand-new instance
      this.reset = reset;     // (T) => void — restores an instance to a clean, reusable state
      this.free = [];
      for (let i = 0; i < initialSize; i++) this.free.push(factory());
    }

    acquire() {
      return this.free.length ? this.free.pop() : this.factory();
    }

    release(obj) {
      this.reset(obj);
      this.free.push(obj);
    }

    get pooledCount() {
      return this.free.length;
    }
  }

  const TICK = 1 / 60;
  const MAX_SPEED = 620;
  const TRACK_WIDTH = 260;
  const LAPS = 3;
  const COLORS = { p1: "#41ffa1", p2: "#1ef0ff", cpu1: "#ff3d94", cpu2: "#ffd166" };
  // Livery accents — dark racing stripe + trim per racer so every car reads
  // as a distinct machine, not a colored triangle.
  const ACCENTS = { "#41ffa1": "#0a3d25", "#1ef0ff": "#083948", "#ff3d94": "#4d0f2c", "#ffd166": "#5c430c", "#ff9a5c": "#5e2a0c" };
  const ITEM_COLORS = { boost: "#ffd166", shield: "#41ffa1", surge: "#ff3d94", ooze: "#a06bff", bolt: "#ff5c74" };
  const ITEM_LABELS = { boost: "BST", shield: "SHD", surge: "SRG", ooze: "OOZ", bolt: "BLT" };
  const KEYS_P1 = { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", drift: "ShiftLeft", driftAlt: "ShiftRight", item: "Space" };
  const KEYS_P2 = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", drift: "Slash", item: "Enter" };
  const ITEM_ODDS = {
    1: [["boost", 0.68], ["shield", 0.22], ["ooze", 0.10]],
    2: [["boost", 0.42], ["bolt", 0.18], ["shield", 0.15], ["ooze", 0.25]],
    3: [["boost", 0.22], ["bolt", 0.36], ["ooze", 0.20], ["shield", 0.10], ["surge", 0.12]],
    4: [["boost", 0.12], ["bolt", 0.33], ["surge", 0.28], ["shield", 0.10], ["ooze", 0.17]],
  };

  // ---------------------------------------------------------------------
  // Tracks - closed Catmull-Rom splines with distinct cockpit scenery.
  // ---------------------------------------------------------------------
  const TRACK_DEFS = {
    ghostlight: {
      label: "Ghostlight Speedway", scene: "city",
      skyTop: "#081024", skyBottom: "#4f2c63", ground: "#101a22", road: "#252a31", edge: "#1ef0ff", accent: "#ff3d94",
      control: [{x:220,y:1000},{x:220,y:300},{x:620,y:90},{x:1400,y:90},{x:1950,y:280},{x:1520,y:560},{x:1950,y:840},{x:1950,y:1420},{x:1500,y:1820},{x:680,y:1920},{x:230,y:1700}]
    },
    redwood: {
      label: "Redwood Run", scene: "forest",
      skyTop: "#6aa5b1", skyBottom: "#f4ba70", ground: "#173326", road: "#34383a", edge: "#ffd166", accent: "#41ffa1",
      control: [{x:230,y:1050},{x:160,y:430},{x:520,y:120},{x:1260,y:80},{x:1880,y:310},{x:1600,y:720},{x:1990,y:1190},{x:1750,y:1710},{x:1120,y:1910},{x:470,y:1770},{x:120,y:1410}]
    },
    aurora: {
      label: "Aurora Ring", scene: "ice",
      skyTop: "#07152f", skyBottom: "#365a87", ground: "#b4d9de", road: "#2a3442", edge: "#7fffd4", accent: "#d6a8ff",
      control: [{x:300,y:1080},{x:120,y:520},{x:460,y:120},{x:1080,y:210},{x:1680,y:90},{x:2000,y:620},{x:1570,y:980},{x:1980,y:1440},{x:1450,y:1880},{x:790,y:1710},{x:320,y:1910},{x:90,y:1460}]
    }
  };

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return {
      x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    };
  }

  function buildTrack(controlPoints, samplesPerSeg) {
    const n = controlPoints.length;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const p0 = controlPoints[(i - 1 + n) % n], p1 = controlPoints[i], p2 = controlPoints[(i + 1) % n], p3 = controlPoints[(i + 2) % n];
      for (let s = 0; s < samplesPerSeg; s++) pts.push(catmullRom(p0, p1, p2, p3, s / samplesPerSeg));
    }
    const N = pts.length;
    const tan = [], nor = [];
    for (let i = 0; i < N; i++) {
      const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
      let dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      tan.push({ x: dx, y: dy });
      nor.push({ x: -dy, y: dx });
    }
    return { pts, tan, nor, N };
  }
  let selectedTrackId = "ghostlight";
  let TRACK = buildTrack(TRACK_DEFS[selectedTrackId].control, 18);
  let AVG_SAMPLE_SPACING = (function () {
    let total = 0;
    for (let i = 0; i < TRACK.N; i++) total += Math.hypot(TRACK.pts[(i + 1) % TRACK.N].x - TRACK.pts[i].x, TRACK.pts[(i + 1) % TRACK.N].y - TRACK.pts[i].y);
    return total / TRACK.N;
  })();

  let TRACK_PATH = (function () {
    const p = new Path2D();
    p.moveTo(TRACK.pts[0].x, TRACK.pts[0].y);
    for (let i = 1; i < TRACK.N; i++) p.lineTo(TRACK.pts[i].x, TRACK.pts[i].y);
    p.closePath();
    return p;
  })();

  function rebuildTrack(id) {
    selectedTrackId = TRACK_DEFS[id] ? id : "ghostlight";
    TRACK = buildTrack(TRACK_DEFS[selectedTrackId].control, 18);
    let total = 0;
    for (let i = 0; i < TRACK.N; i++) total += Math.hypot(TRACK.pts[(i + 1) % TRACK.N].x - TRACK.pts[i].x, TRACK.pts[(i + 1) % TRACK.N].y - TRACK.pts[i].y);
    AVG_SAMPLE_SPACING = total / TRACK.N;
    const path = new Path2D();
    path.moveTo(TRACK.pts[0].x, TRACK.pts[0].y);
    for (let i = 1; i < TRACK.N; i++) path.lineTo(TRACK.pts[i].x, TRACK.pts[i].y);
    path.closePath();
    TRACK_PATH = path;
  }

  function makeItemBoxes() {
    const boxes = [];
    for (const f of [0.08, 0.34, 0.60, 0.85]) {
      const idx = Math.floor(f * TRACK.N) % TRACK.N;
      const pt = TRACK.pts[idx], nor = TRACK.nor[idx];
      for (const off of [-55, 0, 55]) boxes.push({ x: pt.x + nor.x * off, y: pt.y + nor.y * off, active: true, respawnT: 0, spin: Math.random() * Math.PI * 2 });
    }
    return boxes;
  }

  function wrapDelta(newIdx, oldIdx, N) {
    let d = newIdx - oldIdx;
    if (d > N / 2) d -= N;
    if (d < -N / 2) d += N;
    return d;
  }
  function findNearestIndex(pos, hint, N, windowSize) {
    let best = hint, bestD = Infinity;
    for (let k = -windowSize; k <= windowSize; k++) {
      const idx = ((hint + k) % N + N) % N;
      const p = TRACK.pts[idx];
      const dx = pos.x - p.x, dy = pos.y - p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = idx; }
    }
    return best;
  }
  function findNearestIndexFull(pos) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < TRACK.N; i++) {
      const p = TRACK.pts[i];
      const dx = pos.x - p.x, dy = pos.y - p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function rollItem(rank) {
    const table = ITEM_ODDS[Math.min(4, Math.max(1, rank))];
    let r = Math.random(), acc = 0;
    for (const [id, w] of table) { acc += w; if (r <= acc) return id; }
    return table[table.length - 1][0];
  }

  // ---------------------------------------------------------------------
  // Pools
  // ---------------------------------------------------------------------
  const particlePool = new ObjectPool(
    () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, color: "", size: 0 }),
    (p) => { p.alive = false; }
  );
  function spawnParticle(x, y, vx, vy, life, color, size) {
    const p = particlePool.acquire();
    p.alive = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.maxLife = life; p.color = color; p.size = size;
    state.particles.push(p);
  }
  const boltPool = new ObjectPool(
    () => ({ alive: false, x: 0, y: 0, angle: 0, speed: 0, ownerId: -1, targetId: -1, life: 0 }),
    (b) => { b.alive = false; }
  );

  // ---------------------------------------------------------------------
  // State + kart factory
  // ---------------------------------------------------------------------
  const state = { mode: null, trackId: selectedTrackId, karts: [], boxes: [], hazards: [], bolts: [], particles: [], phase: "title", countdownT: 0, raceT: 0, finishOrder: [] };
  let career = { races: 0, wins: 0, bestPlace: 0, selectedTrack: "ghostlight" };
  try {
    const stored = JSON.parse(localStorage.getItem("phantomGrandPrix.v2") || "null");
    if (stored && typeof stored === "object") career = Object.assign(career, stored);
  } catch (_) {}
  if (TRACK_DEFS[career.selectedTrack]) { selectedTrackId = career.selectedTrack; rebuildTrack(selectedTrackId); }
  function saveCareer() { try { localStorage.setItem("phantomGrandPrix.v2", JSON.stringify(career)); } catch (_) {} }

  function makeKart(id, name, color, human, keys, slot) {
    const lateral = slot % 2 === 0 ? -70 : 70;
    const behind = 40 + Math.floor(slot / 2) * 110;
    const p0 = TRACK.pts[0], n0 = TRACK.nor[0], t0 = TRACK.tan[0];
    const x = p0.x + n0.x * lateral - t0.x * behind;
    const y = p0.y + n0.y * lateral - t0.y * behind;
    return {
      id, name, color, human, keys,
      accent: ACCENTS[color] || "#1a1c24",
      x, y, angle: Math.atan2(t0.y, t0.x),
      camX: x, camY: y, camA: 0, camZoom: 0.62,
      shakeT: 0, shakeMag: 0, visSteer: 0, visYaw: 0,
      speed: 0, inputSteer: 0, inputThrottle: 0, inputDrift: false,
      drifting: false, driftCharge: 0,
      boostTimer: 0, surgeTimer: 0, spinTimer: 0, shielded: false, shieldTimer: 0,
      item: null, rank: slot + 1,
      hintIdx: findNearestIndexFull({ x, y }),
      unwrapped: -(behind / AVG_SAMPLE_SPACING),
      finished: false, place: 0,
      aiOffset: human ? 0 : Math.random() * 80 - 40,
      aiDecisionT: Math.random() * 0.4,
      _offTrack: false, _itemKeyWasDown: false, _wallT: 0, _reportedLap: 0,
    };
  }

  function startRace(mode) {
    rebuildTrack(selectedTrackId);
    state.mode = mode;
    state.trackId = selectedTrackId;
    state.boxes = makeItemBoxes();
    state.hazards = [];
    for (const b of state.bolts) boltPool.release(b);
    state.bolts = [];
    for (const p of state.particles) particlePool.release(p);
    state.particles = [];
    state.finishOrder = [];
    const roster = mode === "1p"
      ? [{ name: "You", human: true, keys: KEYS_P1, color: COLORS.p1 },
         { name: "Vex", human: false, color: COLORS.cpu1 },
         { name: "Nyra", human: false, color: COLORS.cpu2 },
         { name: "Bram", human: false, color: "#ff9a5c" }]
      : [{ name: "P1", human: true, keys: KEYS_P1, color: COLORS.p1 },
         { name: "P2", human: true, keys: KEYS_P2, color: COLORS.p2 },
         { name: "Vex", human: false, color: COLORS.cpu1 },
         { name: "Nyra", human: false, color: COLORS.cpu2 }];
    state.karts = roster.map((r, i) => makeKart(i, r.name, r.color, r.human, r.keys || null, i));
    state.phase = "countdown";
    state.countdownT = 3.15;
    state.raceT = 0;
    finishReported = false;
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------
  const pressed = new Set();
  const touchInput = { left: false, right: false, gas: false, brake: false, drift: false };
  let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Per-viewport camera mode: false = north-up follow (default), true =
  // rotate-with-car. Index 0 = P1 viewport, 1 = P2 viewport.
  const camRotate = [false, false];
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Slash", "Enter"].includes(e.code)) e.preventDefault();
    if (e.code === "Escape" && !e.repeat && state.phase !== "title" && state.phase !== "setup" && state.phase !== "finished") {
      e.preventDefault();
      setHostPaused(!hostPaused);
      return;
    }
    if (!e.repeat) {
      if (e.code === "KeyC") camRotate[0] = !camRotate[0];
      else if (e.code === "Period") camRotate[1] = !camRotate[1];
    }
    pressed.add(e.code);
  });
  window.addEventListener("keyup", (e) => { pressed.delete(e.code); });
  const keyIsDown = (code) => !!code && pressed.has(code);

  function applyHumanInput(kart) {
    const k = kart.keys;
    kart.inputThrottle = (keyIsDown(k.up) ? 1 : 0) - (keyIsDown(k.down) ? 1 : 0);
    kart.inputSteer = (keyIsDown(k.right) ? 1 : 0) - (keyIsDown(k.left) ? 1 : 0);
    kart.inputDrift = keyIsDown(k.drift) || (k.driftAlt && keyIsDown(k.driftAlt));
    if (kart.id === 0) {
      kart.inputThrottle = Math.max(-1, Math.min(1, kart.inputThrottle + (touchInput.gas ? 1 : 0) - (touchInput.brake ? 1 : 0)));
      kart.inputSteer = Math.max(-1, Math.min(1, kart.inputSteer + (touchInput.right ? 1 : 0) - (touchInput.left ? 1 : 0)));
      kart.inputDrift = kart.inputDrift || touchInput.drift;
    }
    const itemDown = keyIsDown(k.item);
    if (itemDown && !kart._itemKeyWasDown) useItem(kart);
    kart._itemKeyWasDown = itemDown;
    if (gpEnabled) applyGamepadInput(kart, kart.id);
  }

  // --- Gamepad (PhantomPlay standard mapping) ---
  // First connected controller drives P1 (kart.id 0), second drives P2
  // (kart.id 1, 2P mode only) — layered on top of keyboard, not replacing
  // it, so either input source works standalone or together.
  let gpEnabled = false;
  const GP_DEADZONE = 0.22;
  const gpPrevItem = {};
  function gpPad(slot) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return pads[slot] || null;
  }
  function applyGamepadInput(kart, slot) {
    const pad = gpPad(slot);
    if (!pad) return;
    const ax = pad.axes[0] || 0;
    const dpadLeft = !!pad.buttons[14]?.pressed, dpadRight = !!pad.buttons[15]?.pressed;
    const steerGp = Math.abs(ax) > GP_DEADZONE ? ax : (dpadLeft ? -1 : dpadRight ? 1 : 0);
    const rt = pad.buttons[7]?.value || (pad.buttons[7]?.pressed ? 1 : 0);
    const lt = pad.buttons[6]?.value || (pad.buttons[6]?.pressed ? 1 : 0);
    const throttleGp = rt - lt;
    const driftGp = !!pad.buttons[0]?.pressed || !!pad.buttons[5]?.pressed;
    const itemGp = !!pad.buttons[2]?.pressed;
    if (steerGp) kart.inputSteer = Math.max(-1, Math.min(1, kart.inputSteer + steerGp));
    if (throttleGp) kart.inputThrottle = Math.max(-1, Math.min(1, kart.inputThrottle + throttleGp));
    if (driftGp) kart.inputDrift = true;
    const wasItem = !!gpPrevItem[slot];
    if (itemGp && !wasItem) useItem(kart);
    gpPrevItem[slot] = itemGp;
  }

  function steerAI(kart) {
    const lookahead = 11 + Math.min(9, kart.speed / 60);
    const idx = ((kart.hintIdx + Math.floor(lookahead)) % TRACK.N + TRACK.N) % TRACK.N;
    const pt = TRACK.pts[idx], nor = TRACK.nor[idx];
    const tx = pt.x + nor.x * kart.aiOffset, ty = pt.y + nor.y * kart.aiOffset;
    const desired = Math.atan2(ty - kart.y, tx - kart.x);
    let diff = desired - kart.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    kart.inputSteer = Math.max(-1, Math.min(1, diff / 0.5));
    kart.inputThrottle = Math.abs(diff) > 1.0 ? 0.45 : Math.abs(diff) > 0.55 ? 0.75 : 1;
    kart.inputDrift = Math.abs(diff) > 0.4 && kart.speed > 180;
  }

  function findTargetAhead(kart) {
    let best = null, bestDiff = Infinity;
    for (const o of state.karts) {
      if (o === kart || o.finished) continue;
      const diff = o.unwrapped - kart.unwrapped;
      if (diff > 0 && diff < bestDiff) { bestDiff = diff; best = o; }
    }
    return best;
  }

  function decideAI(kart, dt) {
    kart.aiDecisionT -= dt;
    if (kart.aiDecisionT > 0) return;
    kart.aiDecisionT = 0.35 + Math.random() * 0.25;
    if (!kart.item) return;
    let use = false;
    if (kart.item === "boost" || kart.item === "surge") use = true;
    else if (kart.item === "bolt") { const t = findTargetAhead(kart); use = !!t && (t.unwrapped - kart.unwrapped) < 55; }
    else if (kart.item === "ooze") use = state.karts.some((o) => o !== kart && !o.finished && (kart.unwrapped - o.unwrapped) > 0 && (kart.unwrapped - o.unwrapped) < 40);
    else if (kart.item === "shield") use = Math.random() < 0.3;
    if (use) useItem(kart);
  }

  function useItem(kart) {
    if (!kart.item || kart.finished) return;
    const id = kart.item;
    kart.item = null;
    if (id === "boost") {
      kart.speed = Math.min(kart.speed + 200, MAX_SPEED * 1.5);
      kart.boostTimer = Math.max(kart.boostTimer, 1.3);
      for (let i = 0; i < 8; i++) spawnParticle(kart.x - Math.cos(kart.angle) * 20, kart.y - Math.sin(kart.angle) * 20, -Math.cos(kart.angle) * 140 + (Math.random() - 0.5) * 60, -Math.sin(kart.angle) * 140 + (Math.random() - 0.5) * 60, 0.4, "#ffd166", 4);
    } else if (id === "shield") {
      kart.shielded = true; kart.shieldTimer = 12;
    } else if (id === "surge") {
      kart.surgeTimer = 3.2;
      kart.speed = Math.min(kart.speed + 260, MAX_SPEED * 1.8);
    } else if (id === "ooze") {
      state.hazards.push({ x: kart.x - Math.cos(kart.angle) * 70, y: kart.y - Math.sin(kart.angle) * 70, life: 20, ownerId: kart.id, ownerImmuneT: 1.2 });
    } else if (id === "bolt") {
      const target = findTargetAhead(kart);
      const b = boltPool.acquire();
      b.alive = true; b.x = kart.x + Math.cos(kart.angle) * 40; b.y = kart.y + Math.sin(kart.angle) * 40;
      b.angle = kart.angle; b.speed = 760; b.ownerId = kart.id; b.targetId = target ? target.id : -1; b.life = 3.2;
      state.bolts.push(b);
    }
  }

  function applyHit(kart) {
    if (kart.finished) return;
    if (kart.shielded) { kart.shielded = false; kart.shieldTimer = 0; for (let i = 0; i < 10; i++) spawnParticle(kart.x, kart.y, (Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100, 0.4, "#41ffa1", 3); return; }
    if (kart.surgeTimer > 0) return;
    kart.spinTimer = 0.9;
    kart.speed *= 0.25;
    kart.drifting = false; kart.driftCharge = 0;
    for (let i = 0; i < 8; i++) spawnParticle(kart.x, kart.y, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, 0.5, "#ff5c74", 3);
  }

  // ---------------------------------------------------------------------
  // Physics
  // ---------------------------------------------------------------------
  function updateKartPhysics(kart, dt) {
    if (kart.finished) return;
    if (kart.spinTimer > 0) {
      kart.spinTimer -= dt;
      kart.angle += dt * 10;
      kart.speed *= 0.9;
    } else {
      const steer = kart.inputSteer, throttle = kart.inputThrottle;
      const wantDrift = kart.inputDrift && Math.abs(steer) > 0.25 && kart.speed > 140;

      if (wantDrift && !kart.drifting) { kart.drifting = true; kart.driftCharge = 0; }
      if (kart.drifting && (!kart.inputDrift || Math.abs(steer) < 0.15)) {
        let boostAmt = 0, boostTime = 0, sparkColor = null;
        if (kart.driftCharge >= 3.0) { boostAmt = 340; boostTime = 1.6; sparkColor = "#ffd166"; }
        else if (kart.driftCharge >= 1.8) { boostAmt = 230; boostTime = 1.1; sparkColor = "#ff3d94"; }
        else if (kart.driftCharge >= 0.8) { boostAmt = 140; boostTime = 0.75; sparkColor = "#1ef0ff"; }
        else if (kart.driftCharge >= 0.4 && !kart._offTrack) { boostAmt = 80; boostTime = 0.45; sparkColor = "#9fffe0"; } // small clean-drift-exit reward
        if (boostAmt > 0) {
          kart.speed = Math.min(kart.speed + boostAmt * 0.5, MAX_SPEED * 1.5);
          kart.boostTimer = Math.max(kart.boostTimer, boostTime);
          for (let i = 0; i < 10; i++) spawnParticle(kart.x, kart.y, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, 0.5 + Math.random() * 0.3, sparkColor || "#fff", 3 + Math.random() * 3);
        }
        kart.drifting = false; kart.driftCharge = 0;
      }
      if (kart.drifting) kart.driftCharge += dt;

      // Turn model: responsive at low speed, tightens up (planted) near top
      // speed instead of getting twitchier; drifting restores agility.
      const sN = Math.min(1, Math.abs(kart.speed) / MAX_SPEED);
      const turnRate = 2.8 * Math.min(1, 0.4 + sN * 1.4) * (1 - sN * 0.25) * (kart.drifting ? 1.35 : 1);
      kart.angle += steer * turnRate * dt * (kart.speed < 0 ? -1 : 1);

      let maxSpeed = MAX_SPEED;
      if (kart._offTrack) maxSpeed *= 0.55;
      if (kart.boostTimer > 0) maxSpeed *= 1.35;
      if (kart.surgeTimer > 0) maxSpeed *= 1.6;

      if (throttle !== 0) {
        // Strong launch that tapers as the kart approaches its speed cap.
        const accel = throttle > 0 ? 640 * (1 - 0.4 * Math.max(0, Math.min(1, kart.speed / maxSpeed))) : 520;
        kart.speed += throttle * accel * dt;
      } else {
        const drag = kart._offTrack ? 520 : 300;
        if (kart.speed > 0) kart.speed = Math.max(0, kart.speed - drag * dt);
        else if (kart.speed < 0) kart.speed = Math.min(0, kart.speed + drag * dt);
      }
      kart.speed = Math.max(-MAX_SPEED * 0.45, Math.min(maxSpeed, kart.speed));

      if (kart.drifting && Math.random() < 0.6) spawnParticle(kart.x - Math.cos(kart.angle) * 14, kart.y - Math.sin(kart.angle) * 14, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.3, "#fff", 2);
      if (kart.boostTimer > 0 && Math.random() < 0.7) spawnParticle(kart.x - Math.cos(kart.angle) * 22, kart.y - Math.sin(kart.angle) * 22, -Math.cos(kart.angle) * 60, -Math.sin(kart.angle) * 60, 0.3, "#ffd166", 3);
      // Exhaust puffs while on the gas — subtle, pooled, cheap.
      if (throttle > 0 && kart.speed > 60 && Math.random() < 0.22) {
        spawnParticle(kart.x - Math.cos(kart.angle) * 26, kart.y - Math.sin(kart.angle) * 26, -Math.cos(kart.angle) * 40 + (Math.random() - 0.5) * 24, -Math.sin(kart.angle) * 40 + (Math.random() - 0.5) * 24, 0.35, "#8a8f98", 2.5);
      }
      // Dust kicked up while on the grass.
      if (kart._offTrack && Math.abs(kart.speed) > 120 && Math.random() < 0.55) {
        spawnParticle(kart.x - Math.cos(kart.angle) * 16, kart.y - Math.sin(kart.angle) * 16, (Math.random() - 0.5) * 90, (Math.random() - 0.5) * 90, 0.45, Math.random() < 0.5 ? "#7a6a3f" : "#5d6b3c", 3.5);
      }
    }

    if (kart.boostTimer > 0) kart.boostTimer = Math.max(0, kart.boostTimer - dt);
    if (kart.surgeTimer > 0) kart.surgeTimer = Math.max(0, kart.surgeTimer - dt);
    if (kart.shieldTimer > 0) { kart.shieldTimer -= dt; if (kart.shieldTimer <= 0) kart.shielded = false; }

    kart.x += Math.cos(kart.angle) * kart.speed * dt;
    kart.y += Math.sin(kart.angle) * kart.speed * dt;

    const idx = findNearestIndex({ x: kart.x, y: kart.y }, kart.hintIdx, TRACK.N, 14);
    const pt = TRACK.pts[idx], nor = TRACK.nor[idx];
    let lateral = (kart.x - pt.x) * nor.x + (kart.y - pt.y) * nor.y;
    const wasOff = kart._offTrack;
    kart._offTrack = Math.abs(lateral) > TRACK_WIDTH / 2;

    // Grass: strong one-time scrub on entry (with dust burst + shake) so
    // cutting corners hurts, then the 0.55x cap/drag keeps it recoverable.
    if (kart._offTrack && !wasOff && Math.abs(kart.speed) > 200) {
      kart.speed *= 0.72;
      kart.shakeT = Math.max(kart.shakeT, 0.25); kart.shakeMag = Math.max(kart.shakeMag, 4);
      for (let i = 0; i < 6; i++) spawnParticle(kart.x, kart.y, (Math.random() - 0.5) * 130, (Math.random() - 0.5) * 130, 0.5, Math.random() < 0.5 ? "#7a6a3f" : "#5d6b3c", 4);
    }
    if (kart._offTrack && Math.abs(kart.speed) > 150) { kart.shakeT = Math.max(kart.shakeT, 0.06); kart.shakeMag = Math.max(kart.shakeMag, 1.8); } // grass rumble

    // Soft barrier: deep grass gently shepherds the kart back toward the road.
    const softEdge = TRACK_WIDTH / 2 + 30;
    if (Math.abs(lateral) > softEdge) {
      const nudge = Math.min(90, (Math.abs(lateral) - softEdge) * 1.4) * dt * Math.sign(lateral);
      kart.x -= nor.x * nudge;
      kart.y -= nor.y * nudge;
      lateral -= nudge;
    }

    // Hard outer boundary: clamp inside the wall, kill only the outward
    // velocity component (so the kart slides along instead of sticking),
    // and scrub speed once per impact — no repeat-drain, no tunneling.
    const hardWall = TRACK_WIDTH / 2 + 110;
    if (Math.abs(lateral) > hardWall) {
      const side = Math.sign(lateral);
      kart.x = pt.x + nor.x * side * (hardWall - 4);
      kart.y = pt.y + nor.y * side * (hardWall - 4);
      const outX = nor.x * side, outY = nor.y * side;
      if (kart.speed > 0.001) {
        let vx = Math.cos(kart.angle) * kart.speed, vy = Math.sin(kart.angle) * kart.speed;
        const dot = vx * outX + vy * outY;
        if (dot > 0) {
          vx -= outX * dot * 1.25; vy -= outY * dot * 1.25; // deflect along wall with a slight bounce-in
          kart.speed = Math.hypot(vx, vy);
          if (kart.speed > 1) kart.angle = Math.atan2(vy, vx);
        }
      } else {
        kart.speed *= 0.5; // reversing into the wall just deadens
      }
      if (kart._wallT <= 0) {
        kart._wallT = 0.35;
        kart.speed *= 0.6;
        kart.shakeT = Math.max(kart.shakeT, 0.3); kart.shakeMag = Math.max(kart.shakeMag, 7);
        for (let i = 0; i < 7; i++) spawnParticle(kart.x + outX * 18, kart.y + outY * 18, -outX * 90 + (Math.random() - 0.5) * 140, -outY * 90 + (Math.random() - 0.5) * 140, 0.35, "#ffe9a3", 2.5);
      }
    }
    if (kart._wallT > 0) kart._wallT -= dt;
    if (kart.shakeT > 0) kart.shakeT -= dt; else kart.shakeMag = 0;

    const delta = wrapDelta(idx, kart.hintIdx, TRACK.N);
    kart.hintIdx = idx;
    kart.unwrapped += delta;

    if (kart.id === 0 && kart.human) {
      const completedLap = Math.max(0, Math.min(LAPS, Math.floor(kart.unwrapped / TRACK.N)));
      if (completedLap > kart._reportedLap) {
        kart._reportedLap = completedLap;
        host("progress", { progress: Math.round(completedLap / LAPS * 100), score: Math.max(0, 5 - (kart.rank || 4)) * 100, state: raceState() });
      }
    }

    if (!kart.finished && kart.unwrapped >= LAPS * TRACK.N) {
      kart.finished = true;
      kart.place = state.finishOrder.length + 1;
      state.finishOrder.push(kart.id);
      kart.speed = 0;
    }
  }

  function collideKarts() {
    const list = state.karts;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.finished || b.finished) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const minD = 50;
        if (d > 0.001 && d < minD) {
          if (a.surgeTimer > 0 && b.surgeTimer <= 0) { applyHit(b); continue; }
          if (b.surgeTimer > 0 && a.surgeTimer <= 0) { applyHit(a); continue; }
          const push = (minD - d) / 2, nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          const rel = (a.speed - b.speed) * 0.08;
          a.speed -= rel; b.speed += rel;
        }
      }
    }
  }

  function updateHazards(dt) {
    for (let i = state.hazards.length - 1; i >= 0; i--) {
      const hz = state.hazards[i];
      hz.life -= dt;
      if (hz.ownerImmuneT > 0) hz.ownerImmuneT -= dt;
      if (hz.life <= 0) { state.hazards.splice(i, 1); continue; }
      let hit = false;
      for (const kart of state.karts) {
        if (kart.finished) continue;
        if (kart.id === hz.ownerId && hz.ownerImmuneT > 0) continue;
        const dx = kart.x - hz.x, dy = kart.y - hz.y;
        if (dx * dx + dy * dy < 48 * 48) { applyHit(kart); hit = true; break; }
      }
      if (hit) state.hazards.splice(i, 1);
    }
  }

  function updateBolts(dt) {
    for (let i = state.bolts.length - 1; i >= 0; i--) {
      const b = state.bolts[i];
      b.life -= dt;
      if (b.life <= 0) { boltPool.release(b); state.bolts.splice(i, 1); continue; }
      const target = state.karts.find((k) => k.id === b.targetId && !k.finished);
      if (target) {
        const desired = Math.atan2(target.y - b.y, target.x - b.x);
        let diff = desired - b.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        b.angle += Math.max(-4 * dt, Math.min(4 * dt, diff));
      }
      b.x += Math.cos(b.angle) * b.speed * dt;
      b.y += Math.sin(b.angle) * b.speed * dt;
      let hit = false;
      for (const kart of state.karts) {
        if (kart.finished || kart.id === b.ownerId) continue;
        const dx = kart.x - b.x, dy = kart.y - b.y;
        if (dx * dx + dy * dy < 38 * 38) { applyHit(kart); hit = true; break; }
      }
      if (hit) { boltPool.release(b); state.bolts.splice(i, 1); }
    }
  }

  function updateBoxes(dt) {
    for (const box of state.boxes) {
      box.spin += dt * 2.2;
      if (!box.active) { box.respawnT -= dt; if (box.respawnT <= 0) box.active = true; }
    }
  }

  function computeStandings() {
    const arr = state.karts.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.place - b.place;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.unwrapped - a.unwrapped;
    });
    arr.forEach((k, i) => { k.rank = i + 1; });
    return arr;
  }

  function handlePickups() {
    computeStandings();
    for (const kart of state.karts) {
      if (kart.finished || kart.item) continue;
      for (const box of state.boxes) {
        if (!box.active) continue;
        const dx = kart.x - box.x, dy = kart.y - box.y;
        if (dx * dx + dy * dy < 58 * 58) {
          kart.item = rollItem(kart.rank || 2);
          box.active = false; box.respawnT = 6.5;
          break;
        }
      }
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) { particlePool.release(p); state.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
    }
  }

  function simulateTick(dt) {
    if (state.phase === "countdown") {
      state.countdownT -= dt;
      if (state.countdownT <= 0) state.phase = "racing";
      return;
    }
    if (state.phase !== "racing") return;
    state.raceT += dt;
    for (const kart of state.karts) {
      if (kart.human) applyHumanInput(kart);
      else { steerAI(kart); decideAI(kart, dt); }
      updateKartPhysics(kart, dt);
    }
    collideKarts();
    updateHazards(dt);
    updateBolts(dt);
    updateBoxes(dt);
    handlePickups();
    updateParticles(dt);

    const done = state.mode === "1p" ? state.karts[0].finished : (state.karts[0].finished && state.karts[1].finished);
    if (done) state.phase = "finished";
  }

  function reportRaceComplete() {
    if (finishReported) return;
    finishReported = true;
    const you = state.karts.find((k) => k.human);
    career.races++;
    if (you?.place === 1) career.wins++;
    if (you?.place && (!career.bestPlace || you.place < career.bestPlace)) career.bestPlace = you.place;
    career.selectedTrack = selectedTrackId;
    saveCareer();
    host("complete", { progress: 100, score: you ? Math.max(0, 5 - (you.place || 5)) * 100 : undefined, state: raceState() });
  }

  function raceState() {
    const you = state.karts.find((k) => k.human);
    return { v: 2, track: state.trackId, mode: state.mode, place: you?.place || you?.rank, career, standings: computeStandings().map((k) => ({ name: k.name, rank: k.rank, human: k.human })) };
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  let lastCanvasW = 0, lastCanvasH = 0;
  function resizeIfNeeded() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w !== lastCanvasW || h !== lastCanvasH) { canvas.width = w; canvas.height = h; lastCanvasW = w; lastCanvasH = h; }
  }

  function drawTrack() {
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = "#3a3226"; ctx.lineWidth = TRACK_WIDTH + 40; ctx.stroke(TRACK_PATH);
    ctx.strokeStyle = "#23262c"; ctx.lineWidth = TRACK_WIDTH; ctx.stroke(TRACK_PATH);
    ctx.setLineDash([26, 22]);
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 5; ctx.stroke(TRACK_PATH);
    ctx.setLineDash([]);
    const p0 = TRACK.pts[0], nor = TRACK.nor[0];
    ctx.strokeStyle = "#eafff4"; ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(p0.x - nor.x * TRACK_WIDTH / 2, p0.y - nor.y * TRACK_WIDTH / 2);
    ctx.lineTo(p0.x + nor.x * TRACK_WIDTH / 2, p0.y + nor.y * TRACK_WIDTH / 2);
    ctx.stroke();
  }

  function drawBoxes() {
    for (const b of state.boxes) {
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.active) {
        ctx.rotate(b.spin);
        ctx.fillStyle = "#ffd166"; ctx.fillRect(-16, -16, 32, 32);
        ctx.strokeStyle = "#05030a"; ctx.lineWidth = 3; ctx.strokeRect(-16, -16, 32, 32);
        ctx.rotate(-b.spin - currentCamA);
        ctx.fillStyle = "#05030a"; ctx.font = "800 20px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("?", 0, 1);
      } else {
        ctx.strokeStyle = "rgba(255,209,102,.25)"; ctx.lineWidth = 2; ctx.strokeRect(-14, -14, 28, 28);
      }
      ctx.restore();
    }
  }

  function drawHazards() {
    for (const h of state.hazards) {
      ctx.save();
      ctx.translate(h.x, h.y);
      const pulse = 1 + Math.sin(state.raceT * 6) * 0.08;
      ctx.fillStyle = "rgba(150,60,220,.75)";
      ctx.beginPath(); ctx.arc(0, 0, 30 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(220,150,255,.9)"; ctx.lineWidth = 3; ctx.stroke();
      ctx.restore();
    }
  }

  function drawBolts() {
    for (const b of state.bolts) {
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(b.angle);
      const grad = ctx.createLinearGradient(-26, 0, 10, 0);
      grad.addColorStop(0, "rgba(255,61,148,0)"); grad.addColorStop(1, "#ff3d94");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.ellipse(0, 0, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------
  // Visual-upgrade helpers (color math, lighting, particle glow). These are
  // pure rendering utilities — no gameplay state is read or written here
  // besides the pooled particle spawns, which are visual-only.
  // ---------------------------------------------------------------------

  // Fixed "sun" direction in world space (screen-up, slightly left) so every
  // car reads as lit from the same consistent angle no matter which way it's
  // facing — cheap trick for consistent lighting across a top-down track.
  const SUN_X = -0.45, SUN_Y = -0.9;

  function hexToRgb(hex) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const num = parseInt(h, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  function shadeColor(hex, amt) {
    // amt > 0 lightens toward white, amt < 0 darkens toward black.
    const { r, g, b } = hexToRgb(hex);
    const adj = (c) => (amt >= 0 ? Math.round(c + (255 - c) * amt) : Math.round(c * (1 + amt)));
    return `rgb(${adj(r)}, ${adj(g)}, ${adj(b)})`;
  }
  function withAlpha(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  // Converts a point in a kart's local (+x = forward) frame to world space —
  // used so new particle emitters spawn exactly where the matching visual
  // (flame/aura/spark) is drawn.
  function localToWorld(cx, cy, angle, lx, ly) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c };
  }
  // Colors that render as an additive glow in drawParticles (embers, sparks,
  // energy effects); everything else (dust, exhaust smoke) stays a flat,
  // matte soft blob so grass/gravel effects don't look like fireworks.
  const GLOW_PARTICLE_COLORS = new Set([
    "#ffd166", "#ff3d94", "#1ef0ff", "#9fffe0", "#fff", "#ffe9a3",
    "#ff9a4a", "#fff6d8", "#ffb3d9", "#41ffa1", "#ff5c74",
  ]);

  function drawParticles() {
    for (const p of state.particles) {
      const t = Math.max(0, Math.min(1, p.life / p.maxLife));
      // Slight shrink-as-it-fades instead of a constant flat disc — reads
      // more like a spark/ember than a dot.
      const size = p.size * (0.55 + 0.55 * t);
      if (GLOW_PARTICLE_COLORS.has(p.color)) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 1.8);
        rg.addColorStop(0, withAlpha(p.color, t));
        rg.addColorStop(0.5, withAlpha(p.color, t * 0.6));
        rg.addColorStop(1, withAlpha(p.color, 0));
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(p.x, p.y, size * 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        ctx.globalAlpha = t;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Current viewport's camera rotation — labels counter-rotate against it so
  // names stay upright in rotate-with-car mode.
  let currentCamA = 0;

  function drawWheel(w, h) {
    // Draws a wheel centered on the current origin: dark tire tread ring
    // around a lighter rim/hub, in place of the old single flat rectangle.
    ctx.fillStyle = "#0c0d12";
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = "#3a3d46"; ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = "#4a4e58";
    ctx.fillRect(-w / 2 + 1.6, -h / 2 + 1.2, w - 3.2, h - 2.4);
    ctx.fillStyle = "#9096a2";
    ctx.fillRect(-w / 2 + 3, -h / 2 + 2.2, Math.max(1, w - 6), Math.max(1, h - 4.4));
  }

  function drawCarBody(k, ghosted) {
    // Local frame: +x = forward. ~46 long x ~26 wide open-wheel racer.
    const body = ghosted ? "#888" : k.color;
    const accent = ghosted ? "#555" : k.accent;
    const hi = shadeColor(body, 0.5);
    const lo = shadeColor(body, -0.45);

    // Local-space light direction: rotate the fixed world "sun" vector by
    // the kart's inverse heading so every car is lit from the same
    // on-screen direction (upper-left) regardless of which way it's facing.
    const ca = Math.cos(k.angle), sa = Math.sin(k.angle);
    const lx = SUN_X * ca + SUN_Y * sa;
    const ly = -SUN_X * sa + SUN_Y * ca;

    // Wheels first (under the body edges). Fronts visibly steer.
    for (const sy of [-1, 1]) {
      ctx.save(); ctx.translate(-13, sy * 10); drawWheel(12, 8); ctx.restore(); // rear
      ctx.save();
      ctx.translate(13, sy * 10);
      ctx.rotate(k.visSteer);
      drawWheel(11, 7); // front, steered
      ctx.restore();
    }
    // Rear spoiler.
    ctx.fillStyle = "#101218";
    ctx.fillRect(-23, -14, 5, 28);
    ctx.fillStyle = accent;
    ctx.fillRect(-23, -14, 5, 5); ctx.fillRect(-23, 9, 5, 5);
    // Body silhouette: pointed nose, waisted cockpit, wide side pods.
    ctx.beginPath();
    ctx.moveTo(24, 0);
    ctx.quadraticCurveTo(23, -6, 15, -7);   // nose flank
    ctx.quadraticCurveTo(9, -8, 6, -12);    // front pod flare
    ctx.lineTo(-6, -13);                    // side pod
    ctx.quadraticCurveTo(-14, -12, -18, -9);
    ctx.lineTo(-18, 9);
    ctx.quadraticCurveTo(-14, 12, -6, 13);
    ctx.lineTo(6, 12);
    ctx.quadraticCurveTo(9, 8, 15, 7);
    ctx.quadraticCurveTo(23, 6, 24, 0);
    ctx.closePath();
    // Glossy panel: gradient across the fixed light axis instead of a flat
    // fill, so the curved body reads as lit metal rather than a cutout.
    const grad = ctx.createLinearGradient(lx * 20, ly * 20, -lx * 20, -ly * 20);
    grad.addColorStop(0, hi);
    grad.addColorStop(0.45, body);
    grad.addColorStop(1, lo);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 1.5; ctx.stroke();
    // Highlight streak — thin glossy reflection along the lit side.
    ctx.save();
    ctx.beginPath();
    const hx = lx * 9, hy = ly * 9;
    ctx.moveTo(16 + hx, -2 + hy * 0.5);
    ctx.quadraticCurveTo(2 + hx, -8 + hy, -14 + hx, -5 + hy * 0.5);
    ctx.strokeStyle = "rgba(255,255,255,.32)";
    ctx.lineWidth = 2.2; ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
    // Center racing stripe down hood + engine cover.
    ctx.fillStyle = accent;
    ctx.fillRect(-18, -2.5, 40, 5);
    // Cabin/windshield.
    ctx.beginPath();
    ctx.moveTo(9, -4); ctx.lineTo(3, -6); ctx.lineTo(-4, -5.5); ctx.lineTo(-6, 0); ctx.lineTo(-4, 5.5); ctx.lineTo(3, 6); ctx.lineTo(9, 4); ctx.closePath();
    ctx.fillStyle = "rgba(12,18,28,.92)"; ctx.fill();
    ctx.fillStyle = "rgba(180,220,255,.35)";
    ctx.fillRect(4, -4, 3, 8); // glass glint
    // Nose tip trim + headlights.
    ctx.fillStyle = "#eafff4";
    ctx.fillRect(20, -2, 4, 4);
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.beginPath(); ctx.ellipse(20, -3.3, 1.6, 1.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(20, 3.3, 1.6, 1.1, 0, 0, Math.PI * 2); ctx.fill();
    // Taillights, mounted either side of the spoiler.
    ctx.fillStyle = "rgba(255,70,70,.9)";
    ctx.beginPath(); ctx.ellipse(-20.5, -11.5, 1.8, 1.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-20.5, 11.5, 1.8, 1.4, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawKart(k) {
    const ghosted = k.spinTimer > 0;
    const yaw = k.angle + k.visYaw;
    // Subtle weight-shift lean: a small horizontal skew of the body drawing
    // proportional to steering input (visSteer is the already-smoothed
    // visual steer value used elsewhere for the front wheels). Purely
    // cosmetic — it never touches kart.angle/steering/physics.
    const bank = ghosted ? 0 : k.visSteer * 0.32;
    // 0..1 how "at speed" the kart is, above a threshold, for streaks/smear.
    const speedN = Math.max(0, Math.min(1, (Math.abs(k.speed) - 380) / (MAX_SPEED * 1.5 - 380)));
    // New particle emission below is gated to active, unpaused racing so a
    // paused/finished frame can't leak particles (render runs every rAF
    // frame regardless of pause, but updateParticles/aging only runs on the
    // fixed-tick simulation).
    const canEmit = !k.finished && state.phase === "racing" && !hostPaused && state.particles.length < 480;

    // Drop shadow (offset, same heading; stretches slightly at high speed to
    // help sell velocity).
    ctx.save();
    ctx.translate(k.x + 3 + Math.cos(yaw + Math.PI) * speedN * 10, k.y + 5 + Math.sin(yaw + Math.PI) * speedN * 10);
    ctx.rotate(yaw);
    ctx.fillStyle = "rgba(0,0,0,.32)";
    ctx.beginPath(); ctx.ellipse(0, 0, 25 + speedN * 14, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Speed-blur streaks trailing behind at high velocity — pseudo-3D
    // "juice" layered on the flat 2D camera, no physics involved.
    if (speedN > 0.02) {
      ctx.save();
      ctx.translate(k.x, k.y);
      ctx.rotate(yaw);
      ctx.globalAlpha = Math.min(0.5, speedN * 0.55);
      ctx.strokeStyle = "#eafff4";
      ctx.lineWidth = 1.3;
      for (const sy of [-9, -3, 3, 9]) {
        const len = 12 + speedN * 30 + Math.random() * 6;
        ctx.beginPath();
        ctx.moveTo(-25, sy);
        ctx.lineTo(-25 - len, sy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.rotate(yaw);

    if (k.surgeTimer > 0) {
      const pulse = 1 + Math.sin(state.raceT * 14) * 0.12;
      const rg = ctx.createRadialGradient(0, 0, 4, 0, 0, 38 * pulse);
      rg.addColorStop(0, "rgba(255,120,185,.35)");
      rg.addColorStop(0.7, "rgba(255,61,148,.22)");
      rg.addColorStop(1, "rgba(255,61,148,0)");
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(0, 0, 38 * pulse, 0, Math.PI * 2); ctx.fill();
      // Sparkling energy particles orbiting the surge aura.
      if (canEmit && Math.random() < 0.55) {
        const ang = Math.random() * Math.PI * 2, r = 16 + Math.random() * 18;
        const wp = localToWorld(k.x, k.y, yaw, Math.cos(ang) * r, Math.sin(ang) * r);
        spawnParticle(wp.x, wp.y, Math.cos(ang) * 24, Math.sin(ang) * 24, 0.3 + Math.random() * 0.25, Math.random() < 0.5 ? "#ff3d94" : "#ffb3d9", 2 + Math.random() * 1.5);
      }
    }

    // Boost exhaust: layered flame gradients (flicker via Math.random()) plus
    // real ember/spark particles fired backward from the twin pipes.
    if (k.boostTimer > 0) {
      const flick = 0.7 + Math.random() * 0.6;
      for (const sy of [-4.5, 4.5]) {
        const len = 8 * flick + Math.random() * 3;
        const grad = ctx.createLinearGradient(-24, sy, -24 - (14 + len), sy);
        grad.addColorStop(0, "rgba(255,255,255,.95)");
        grad.addColorStop(0.25, "rgba(255,225,140,.9)");
        grad.addColorStop(0.6, "rgba(255,140,40,.6)");
        grad.addColorStop(1, "rgba(255,90,20,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.ellipse(-24 - len * 0.5, sy, 8 + len * 0.5, 3.4 * flick, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,250,220,.9)";
        ctx.beginPath(); ctx.ellipse(-25 - 3 * flick, sy, 4 * flick, 1.6, 0, 0, Math.PI * 2); ctx.fill();
      }
      if (canEmit && Math.random() < 0.85) {
        for (const sy of [-4.5, 4.5]) {
          if (Math.random() < 0.6) {
            const wp = localToWorld(k.x, k.y, yaw, -30, sy);
            const spreadA = yaw + Math.PI + (Math.random() - 0.5) * 0.9;
            const spd = 60 + Math.random() * 90;
            const col = Math.random() < 0.4 ? "#ffd166" : Math.random() < 0.7 ? "#ff9a4a" : "#fff6d8";
            spawnParticle(wp.x, wp.y, Math.cos(spreadA) * spd, Math.sin(spreadA) * spd, 0.22 + Math.random() * 0.22, col, 2 + Math.random() * 2);
          }
        }
      }
    }

    // Enriched drift smoke/sparks layered on top of the existing
    // physics-driven spark (see updateKartPhysics) — density, brightness and
    // size escalate through the same charge tiers already used for the HUD
    // meter and mini-turbo payout, reinforcing the tier system visually.
    if (k.drifting && canEmit) {
      const tier = k.driftCharge >= 3.0 ? 3 : k.driftCharge >= 1.8 ? 2 : k.driftCharge >= 0.8 ? 1 : k.driftCharge >= 0.4 ? 0.5 : 0;
      if (tier > 0 && Math.random() < 0.3 + tier * 0.15) {
        const tierColor = tier >= 3 ? "#ffd166" : tier >= 2 ? "#ff3d94" : tier >= 1 ? "#1ef0ff" : "#9fffe0";
        const count = 1 + Math.floor(tier);
        for (let i = 0; i < count; i++) {
          const wp = localToWorld(k.x, k.y, yaw, -16 - Math.random() * 6, (Math.random() - 0.5) * 14);
          spawnParticle(wp.x, wp.y, (Math.random() - 0.5) * 50, (Math.random() - 0.5) * 50, 0.32 + tier * 0.06, tierColor, 2 + tier * 0.9);
        }
      }
    }

    // Body drawn with a subtle bank/lean shear proportional to steering —
    // cheap pseudo-3D weight-shift. Isolated in its own save/restore so it
    // never distorts the (rotation-invariant) shield ring below.
    ctx.save();
    ctx.transform(1, 0, bank, 1, 0, 0);
    drawCarBody(k, ghosted);
    ctx.restore();

    if (k.shielded) {
      ctx.strokeStyle = "rgba(65,255,161,.7)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 33, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.rotate(-currentCamA); // keep the label upright regardless of camera mode
    ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.font = "700 11px monospace"; ctx.textAlign = "center";
    ctx.fillText(k.name, 0, -32);
    ctx.restore();
  }

  // Minimap uses the real track geometry — precompute world bounds once.
  const MINI_BOUNDS = (function () {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of TRACK.pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const pad = TRACK_WIDTH / 2 + 20;
    return { minX: minX - pad, minY: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  })();

  function drawMinimap(mx, my, mw, mh, camKart) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(2,2,6,.55)"; ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = "rgba(255,255,255,.3)"; ctx.lineWidth = 2; ctx.strokeRect(mx, my, mw, mh);
    const inset = 8;
    const s = Math.min((mw - inset * 2) / MINI_BOUNDS.w, (mh - inset * 2) / MINI_BOUNDS.h);
    const offX = mx + (mw - MINI_BOUNDS.w * s) / 2, offY = my + (mh - MINI_BOUNDS.h * s) / 2;
    // Track ribbon: reuse the cached Path2D under a scaled transform.
    ctx.save();
    ctx.translate(offX - MINI_BOUNDS.minX * s, offY - MINI_BOUNDS.minY * s);
    ctx.scale(s, s);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = TRACK_WIDTH; ctx.stroke(TRACK_PATH);
    ctx.strokeStyle = "rgba(10,12,18,.9)"; ctx.lineWidth = TRACK_WIDTH * 0.55; ctx.stroke(TRACK_PATH);
    // Start/finish tick.
    const p0 = TRACK.pts[0], n0 = TRACK.nor[0];
    ctx.strokeStyle = "#eafff4"; ctx.lineWidth = TRACK_WIDTH * 0.3;
    ctx.beginPath();
    ctx.moveTo(p0.x - n0.x * TRACK_WIDTH / 2, p0.y - n0.y * TRACK_WIDTH / 2);
    ctx.lineTo(p0.x + n0.x * TRACK_WIDTH / 2, p0.y + n0.y * TRACK_WIDTH / 2);
    ctx.stroke();
    ctx.restore();
    // Kart dots at their true positions; camera kart gets a ring + heading tick.
    for (const k of state.karts) {
      const dx = offX + (k.x - MINI_BOUNDS.minX) * s, dy = offY + (k.y - MINI_BOUNDS.minY) * s;
      ctx.fillStyle = k.color;
      ctx.beginPath(); ctx.arc(dx, dy, k === camKart ? 4.5 : 3, 0, Math.PI * 2); ctx.fill();
      if (k === camKart) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(dx, dy, 6.5, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(dx, dy);
        ctx.lineTo(dx + Math.cos(k.angle) * 10, dy + Math.sin(k.angle) * 10); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawViewportHUD(vx, vy, vw, vh, kart) {
    ctx.save();
    ctx.font = '800 32px "Space Grotesk", sans-serif';
    ctx.fillStyle = "#eafff4";
    ctx.textBaseline = "top";
    const ord = ["", "1ST", "2ND", "3RD", "4TH"][kart.rank || 1];
    ctx.fillText(ord, vx + 16, vy + 14);
    ctx.font = '700 13px "DM Mono", monospace';
    ctx.fillStyle = "rgba(234,255,244,.65)";
    ctx.fillText(`LAP ${Math.min(LAPS, Math.max(1, Math.floor(kart.unwrapped / TRACK.N) + 1))}/${LAPS}`, vx + 16, vy + 52);
    ctx.fillText(kart.name, vx + 16, vy + 70);

    ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 2;
    ctx.strokeRect(vx + vw - 76, vy + vh - 76, 56, 56);
    if (kart.item) {
      ctx.fillStyle = ITEM_COLORS[kart.item] || "#fff";
      ctx.fillRect(vx + vw - 72, vy + vh - 72, 48, 48);
      ctx.fillStyle = "#05030a"; ctx.font = "800 11px monospace"; ctx.textAlign = "center";
      ctx.fillText(ITEM_LABELS[kart.item] || "", vx + vw - 48, vy + vh - 44);
    }
    if (kart.drifting) {
      const w = 120;
      ctx.fillStyle = "rgba(255,255,255,.15)"; ctx.fillRect(vx + vw / 2 - w / 2, vy + vh - 30, w, 10);
      ctx.fillStyle = kart.driftCharge >= 3 ? "#ffd166" : kart.driftCharge >= 1.8 ? "#ff3d94" : "#1ef0ff";
      ctx.fillRect(vx + vw / 2 - w / 2, vy + vh - 30, w * Math.min(1, kart.driftCharge / 3), 10);
    }
    ctx.restore();
    drawMinimap(vx + vw - 148, vy + 14, 132, 112, kart);
  }

  function updateCamera(k, dtReal, vw, vh, rotOn) {
    // Position: lerp toward the kart plus a velocity look-ahead so the road
    // ahead dominates the screen at speed.
    const lead = 46 + Math.max(0, k.speed) * 0.22;
    const tx = k.x + Math.cos(k.angle) * lead, ty = k.y + Math.sin(k.angle) * lead;
    const f = Math.min(1, dtReal * 5.5);
    k.camX += (tx - k.camX) * f;
    k.camY += (ty - k.camY) * f;
    // Zoom: sized to the viewport so a meaningful road stretch is always
    // visible, easing out slightly at speed.
    const sFrac = Math.min(1, Math.abs(k.speed) / MAX_SPEED);
    const base = Math.max(0.5, Math.min(0.85, Math.min(vw, vh) / 620));
    const zt = base * (1 - 0.2 * sFrac);
    k.camZoom += (zt - k.camZoom) * Math.min(1, dtReal * 2.5);
    // Rotation: north-up by default; rotate-with-car keeps the nose pointing
    // screen-up. Smoothed with angle wrapping so toggling never snaps.
    const targetA = rotOn ? (-Math.PI / 2 - k.angle) : 0;
    let dA = targetA - k.camA;
    while (dA > Math.PI) dA -= Math.PI * 2;
    while (dA < -Math.PI) dA += Math.PI * 2;
    k.camA += dA * Math.min(1, dtReal * 4);
    while (k.camA > Math.PI) k.camA -= Math.PI * 2;
    while (k.camA < -Math.PI) k.camA += Math.PI * 2;
  }

  function renderViewport(vx, vy, vw, vh, cameraKart) {
    ctx.save();
    ctx.beginPath(); ctx.rect(vx, vy, vw, vh); ctx.clip();
    ctx.fillStyle = "#0e2415"; ctx.fillRect(vx, vy, vw, vh);
    const zoom = cameraKart.camZoom;
    let sx = 0, sy = 0;
    if (cameraKart.shakeT > 0) {
      sx = (Math.random() - 0.5) * 2 * cameraKart.shakeMag;
      sy = (Math.random() - 0.5) * 2 * cameraKart.shakeMag;
    }
    ctx.translate(vx + vw / 2 + sx, vy + vh / 2 + sy);
    ctx.scale(zoom, zoom);
    ctx.rotate(cameraKart.camA);
    ctx.translate(-cameraKart.camX, -cameraKart.camY);
    currentCamA = cameraKart.camA;
    drawTrack();
    drawBoxes();
    drawHazards();
    drawBolts();
    drawParticles();
    for (const k of state.karts) drawKart(k);
    ctx.restore();
    currentCamA = 0;
    drawViewportHUD(vx, vy, vw, vh, cameraKart);
  }

  // ---------------------------------------------------------------------
  // Cockpit projection renderer. Physics remains on the 2D spline; these
  // functions treat the active kart as a camera and perspective-project the
  // road, scenery, pickups, hazards, and rivals into its windshield.
  // ---------------------------------------------------------------------
  function quad(a, b, c, d, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
  }

  function cameraProjection(kart, x, y, vw, vh, horizon) {
    const a = kart.angle + kart.visYaw * 0.22;
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = x - kart.x, dy = y - kart.y;
    const forward = dx * ca + dy * sa;
    if (forward < 24) return null;
    const side = -dx * sa + dy * ca;
    const focal = Math.min(vw * 1.05, vh * 1.85);
    return { x: vw / 2 + side / forward * focal, y: horizon + 78 / forward * focal, scale: focal / forward, forward };
  }

  function projectedRoadSample(kart, idx, vw, vh, horizon) {
    const p = TRACK.pts[idx], n = TRACK.nor[idx];
    const l = cameraProjection(kart, p.x - n.x * TRACK_WIDTH / 2, p.y - n.y * TRACK_WIDTH / 2, vw, vh, horizon);
    const r = cameraProjection(kart, p.x + n.x * TRACK_WIDTH / 2, p.y + n.y * TRACK_WIDTH / 2, vw, vh, horizon);
    if (!l || !r) return null;
    return { l: { x: l.x, y: Math.min(vh * 1.16, l.y) }, r: { x: r.x, y: Math.min(vh * 1.16, r.y) }, idx, forward: (l.forward + r.forward) / 2 };
  }

  function drawProjectedRoad(kart, vw, vh, horizon, theme) {
    const center = TRACK.pts[kart.hintIdx], normal = TRACK.nor[kart.hintIdx];
    const lateral = (kart.x - center.x) * normal.x + (kart.y - center.y) * normal.y;
    const nearCenter = vw / 2 - lateral / (TRACK_WIDTH / 2) * vw * 0.31;
    const samples = [{ l: { x: nearCenter - vw * 0.63, y: vh * 1.08 }, r: { x: nearCenter + vw * 0.63, y: vh * 1.08 }, idx: kart.hintIdx, forward: 1 }];
    for (let step = 3; step <= 48; step += 2) {
      const idx = (kart.hintIdx + step) % TRACK.N;
      const sample = projectedRoadSample(kart, idx, vw, vh, horizon);
      if (sample && sample.forward < 1700 && sample.l.x < vw * 2.5 && sample.r.x > -vw * 1.5) samples.push(sample);
    }
    for (let i = samples.length - 1; i > 0; i--) {
      const far = samples[i], near = samples[i - 1];
      const fw = Math.abs(far.r.x - far.l.x), nw = Math.abs(near.r.x - near.l.x);
      const stripe = ((Math.floor(far.idx / 3) & 1) === 0) ? theme.edge : "#e9f2ed";
      quad({x:far.l.x-fw*.1,y:far.l.y},{x:far.r.x+fw*.1,y:far.r.y},{x:near.r.x+nw*.1,y:near.r.y},{x:near.l.x-nw*.1,y:near.l.y},stripe);
      const roadShade = (Math.floor(far.idx / 4) & 1) ? theme.road : shadeColor(theme.road, .045);
      quad(far.l, far.r, near.r, near.l, roadShade);
      if ((Math.floor(far.idx / 4) & 1) === 0) {
        const fc = (far.l.x + far.r.x) / 2, nc = (near.l.x + near.r.x) / 2;
        const fLine = Math.max(1, fw * .012), nLine = Math.max(2, nw * .012);
        quad({x:fc-fLine,y:far.l.y},{x:fc+fLine,y:far.r.y},{x:nc+nLine,y:near.r.y},{x:nc-nLine,y:near.l.y},"rgba(255,255,255,.5)");
      }
    }
    return samples;
  }

  function drawBillboard(scene, p, side, seed, theme, vh) {
    const s = Math.max(.12, Math.min(2.2, p.scale));
    const base = Math.min(vh * 1.04, p.y);
    ctx.save(); ctx.translate(p.x, base);
    if (scene === "forest") {
      const h = 105 * s + (seed % 3) * 12 * s;
      ctx.fillStyle = "#4b2f24"; ctx.fillRect(-6*s, -h*.58, 12*s, h*.58);
      ctx.fillStyle = seed % 2 ? "#174f39" : "#236447";
      ctx.beginPath(); ctx.moveTo(0,-h); ctx.lineTo(-32*s,-h*.35); ctx.lineTo(32*s,-h*.35); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0,-h*.78); ctx.lineTo(-38*s,-h*.16); ctx.lineTo(38*s,-h*.16); ctx.closePath(); ctx.fill();
    } else if (scene === "ice") {
      const h = (70 + seed % 4 * 17) * s;
      const ice = ctx.createLinearGradient(-20*s,-h,20*s,0); ice.addColorStop(0,"#ecffff"); ice.addColorStop(1,"#70b8d0");
      quad({x:-25*s,y:0},{x:0,y:-h},{x:19*s,y:0},{x:7*s,y:-h*.2},ice);
    } else {
      const h = (70 + seed % 5 * 18) * s, w = (35 + seed % 3 * 10) * s;
      ctx.fillStyle = seed % 2 ? "#111a29" : "#182033"; ctx.fillRect(-w/2,-h,w,h);
      ctx.fillStyle = seed % 2 ? theme.accent : theme.edge;
      for (let y = -h + 12*s; y < -8*s; y += 15*s) for (let x = -w/2 + 7*s; x < w/2 - 3*s; x += 12*s) ctx.fillRect(x,y,4*s,5*s);
    }
    ctx.restore();
  }

  function drawScenery(kart, vw, vh, horizon, theme) {
    const objects = [];
    for (let step = 8; step <= 46; step += 4) {
      const idx = (kart.hintIdx + step) % TRACK.N, point = TRACK.pts[idx], normal = TRACK.nor[idx];
      for (const side of [-1, 1]) {
        if (((idx + side + 3) % 3) === 0 && theme.scene === "city") continue;
        const off = TRACK_WIDTH / 2 + 95 + (idx % 4) * 28;
        const p = cameraProjection(kart, point.x + normal.x * off * side, point.y + normal.y * off * side, vw, vh, horizon);
        if (p && p.x > -vw*.3 && p.x < vw*1.3) objects.push({p,side,idx});
      }
    }
    objects.sort((a,b)=>b.p.forward-a.p.forward);
    for (const o of objects) drawBillboard(theme.scene,o.p,o.side,o.idx,theme,vh);
  }

  function drawProjectedPickup(kart, box, vw, vh, horizon) {
    if (!box.active) return;
    const p = cameraProjection(kart,box.x,box.y,vw,vh,horizon); if (!p || p.x < -80 || p.x > vw+80) return;
    const s = Math.max(5,Math.min(34,22*p.scale)); ctx.save();ctx.translate(p.x,p.y-s*.55);ctx.rotate(box.spin*.35);ctx.fillStyle="#ffd166";ctx.fillRect(-s/2,-s/2,s,s);ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.strokeRect(-s/2,-s/2,s,s);ctx.rotate(-box.spin*.35);ctx.fillStyle="#15110a";ctx.font=`900 ${Math.max(8,s*.55)}px sans-serif`;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("?",0,1);ctx.restore();
  }

  function drawProjectedRival(cameraKart, rival, vw, vh, horizon) {
    const p = cameraProjection(cameraKart,rival.x,rival.y,vw,vh,horizon); if (!p || p.x < -vw*.3 || p.x > vw*1.3) return;
    const s = Math.max(.22,Math.min(2.8,p.scale)), w=42*s,h=24*s;
    ctx.save();ctx.translate(p.x,p.y);ctx.shadowColor=rival.boostTimer>0?"#ffd166":rival.color;ctx.shadowBlur=rival.boostTimer>0?18:7;
    ctx.fillStyle="#090b0f";ctx.fillRect(-w*.58,-h*.12,w*.18,h*.8);ctx.fillRect(w*.4,-h*.12,w*.18,h*.8);
    ctx.fillStyle=rival.color;ctx.beginPath();ctx.moveTo(-w*.48,h*.5);ctx.lineTo(-w*.34,-h*.48);ctx.lineTo(w*.34,-h*.48);ctx.lineTo(w*.48,h*.5);ctx.closePath();ctx.fill();
    ctx.fillStyle=rival.accent;ctx.fillRect(-w*.38,-h*.32,w*.76,h*.18);ctx.fillStyle="#ff4d59";ctx.fillRect(-w*.31,h*.25,w*.18,h*.12);ctx.fillRect(w*.13,h*.25,w*.18,h*.12);
    if(rival.shielded){ctx.strokeStyle="#41ffa1";ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,0,w*.68,h,0,0,Math.PI*2);ctx.stroke();}
    ctx.shadowBlur=0;ctx.fillStyle="#fff";ctx.font=`800 ${Math.max(8,10*s)}px ui-monospace,monospace`;ctx.textAlign="center";ctx.fillText(rival.name,0,-h*.72);ctx.restore();
  }

  function drawRaceObjects(kart, vw, vh, horizon) {
    for (const box of state.boxes) drawProjectedPickup(kart,box,vw,vh,horizon);
    for (const hazard of state.hazards) {
      const p=cameraProjection(kart,hazard.x,hazard.y,vw,vh,horizon);if(!p)continue;const s=Math.max(5,Math.min(70,38*p.scale));ctx.fillStyle="rgba(161,83,235,.72)";ctx.beginPath();ctx.ellipse(p.x,p.y,s,s*.22,0,0,Math.PI*2);ctx.fill();
    }
    const rivals=state.karts.filter(k=>k!==kart&&!k.finished).map(k=>({k,p:cameraProjection(kart,k.x,k.y,vw,vh,horizon)})).filter(o=>o.p).sort((a,b)=>b.p.forward-a.p.forward);
    for(const o of rivals)drawProjectedRival(kart,o.k,vw,vh,horizon);
    for(const bolt of state.bolts){const p=cameraProjection(kart,bolt.x,bolt.y,vw,vh,horizon);if(!p)continue;ctx.fillStyle="#ff5c74";ctx.beginPath();ctx.arc(p.x,p.y,Math.max(3,8*p.scale),0,Math.PI*2);ctx.fill();}
  }

  function drawRearMirror(kart, vw, vh) {
    const mw=Math.min(240,vw*.36),mh=Math.min(62,vh*.13),mx=vw/2-mw/2,my=8;
    ctx.fillStyle="#05080c";ctx.fillRect(mx,my,mw,mh);ctx.strokeStyle="#b7c2c4";ctx.lineWidth=3;ctx.strokeRect(mx,my,mw,mh);ctx.fillStyle="#24394a";ctx.fillRect(mx+4,my+4,mw-8,mh*.45);
    const behind=state.karts.filter(k=>k!==kart&&!k.finished&&k.unwrapped<kart.unwrapped).sort((a,b)=>b.unwrapped-a.unwrapped)[0];
    if(behind){const diff=Math.max(1,kart.unwrapped-behind.unwrapped),size=Math.max(8,Math.min(28,38/diff));ctx.fillStyle=behind.color;ctx.fillRect(vw/2-size/2,my+mh-size*.7,size,size*.65);ctx.fillStyle="#fff";ctx.font="700 9px ui-monospace,monospace";ctx.textAlign="center";ctx.fillText(behind.name+"  "+Math.round(diff*AVG_SAMPLE_SPACING/10)+"m",vw/2,my+mh-6);}else{ctx.fillStyle="#93a2a5";ctx.font="700 9px ui-monospace,monospace";ctx.textAlign="center";ctx.fillText("CLEAR",vw/2,my+mh-10);}
  }

  function drawCockpit(kart, vw, vh, theme) {
    const dashY=vh*.79, steerX=vw*.5, steerY=vh*.89, wheelR=Math.min(vw,vh)*.105;
    ctx.fillStyle="#05070a";quad({x:0,y:vh},{x:0,y:dashY},{x:vw*.31,y:dashY-22},{x:vw*.39,y:vh},"#05070a");quad({x:vw,y:vh},{x:vw,y:dashY},{x:vw*.69,y:dashY-22},{x:vw*.61,y:vh},"#05070a");
    const dash=ctx.createLinearGradient(0,dashY,0,vh);dash.addColorStop(0,"#202831");dash.addColorStop(1,"#07090d");ctx.fillStyle=dash;ctx.beginPath();ctx.moveTo(0,vh);ctx.lineTo(0,dashY);ctx.quadraticCurveTo(vw/2,dashY-45,vw,dashY);ctx.lineTo(vw,vh);ctx.closePath();ctx.fill();
    ctx.fillStyle=kart.color;ctx.beginPath();ctx.moveTo(vw*.35,vh);ctx.lineTo(vw*.43,dashY-18);ctx.lineTo(vw*.57,dashY-18);ctx.lineTo(vw*.65,vh);ctx.closePath();ctx.fill();ctx.fillStyle=kart.accent;ctx.fillRect(vw*.485,dashY-18,vw*.03,vh-dashY+18);
    ctx.save();ctx.translate(steerX,steerY);ctx.rotate(kart.visSteer*1.8);ctx.strokeStyle="#11151a";ctx.lineWidth=Math.max(10,wheelR*.2);ctx.beginPath();ctx.arc(0,0,wheelR,0,Math.PI*2);ctx.stroke();ctx.strokeStyle="#818b91";ctx.lineWidth=Math.max(3,wheelR*.055);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-wheelR*.72,-wheelR*.55);ctx.moveTo(0,0);ctx.lineTo(wheelR*.72,-wheelR*.55);ctx.moveTo(0,0);ctx.lineTo(0,wheelR*.86);ctx.stroke();ctx.fillStyle="#20262b";ctx.beginPath();ctx.arc(0,0,wheelR*.28,0,Math.PI*2);ctx.fill();ctx.restore();
    ctx.fillStyle="#20262b";ctx.beginPath();ctx.ellipse(steerX-wheelR*.85,steerY-wheelR*.25,wheelR*.28,wheelR*.18,-.2,0,Math.PI*2);ctx.ellipse(steerX+wheelR*.85,steerY-wheelR*.25,wheelR*.28,wheelR*.18,.2,0,Math.PI*2);ctx.fill();
    if(kart.boostTimer>0||kart.surgeTimer>0){ctx.strokeStyle=kart.surgeTimer>0?"#ff3d94":"#ffd166";ctx.lineWidth=Math.max(5,vw*.012);ctx.strokeRect(3,3,vw-6,vh-6);}
  }

  function drawCockpitHud(kart, vw, vh, theme) {
    const ord=["","1ST","2ND","3RD","4TH"][kart.rank||1],lap=Math.min(LAPS,Math.max(1,Math.floor(kart.unwrapped/TRACK.N)+1));
    ctx.textBaseline="top";ctx.textAlign="left";ctx.fillStyle="#effff7";ctx.font=`1000 ${Math.max(24,Math.min(42,vh*.09))}px system-ui`;ctx.fillText(ord,14,12);ctx.fillStyle="#b8c9c5";ctx.font=`800 ${Math.max(9,Math.min(13,vh*.027))}px ui-monospace,monospace`;ctx.fillText(`LAP ${lap}/${LAPS}`,16,Math.max(48,vh*.105));ctx.fillText(TRACK_DEFS[state.trackId].label.toUpperCase(),16,Math.max(63,vh*.14));
    const mph=Math.max(0,Math.round(Math.abs(kart.speed)/MAX_SPEED*168));ctx.textAlign="center";ctx.fillStyle=kart.boostTimer>0?"#ffd166":"#effff7";ctx.font=`1000 ${Math.max(24,Math.min(48,vh*.1))}px ui-monospace,monospace`;ctx.fillText(String(mph),vw/2,vh*.72);ctx.font=`800 ${Math.max(8,Math.min(11,vh*.024))}px ui-monospace,monospace`;ctx.fillStyle="#9cafaf";ctx.fillText("MPH",vw/2,vh*.72+Math.max(32,vh*.09));
    const ix=vw-74,iy=vh-74;ctx.strokeStyle="#ffffff55";ctx.lineWidth=2;ctx.strokeRect(ix,iy,56,56);if(kart.item){ctx.fillStyle=ITEM_COLORS[kart.item]||"#fff";ctx.fillRect(ix+4,iy+4,48,48);ctx.fillStyle="#090b0f";ctx.font="900 11px ui-monospace,monospace";ctx.textAlign="center";ctx.fillText(ITEM_LABELS[kart.item]||"",ix+28,iy+22);}
    if(kart.drifting){const meterW=Math.min(180,vw*.32),x=vw/2-meterW/2,y=vh*.68;ctx.fillStyle="#ffffff22";ctx.fillRect(x,y,meterW,8);ctx.fillStyle=kart.driftCharge>=3?"#ffd166":kart.driftCharge>=1.8?"#ff3d94":"#1ef0ff";ctx.fillRect(x,y,meterW*Math.min(1,kart.driftCharge/3),8);ctx.fillStyle="#fff";ctx.font="800 9px ui-monospace,monospace";ctx.textAlign="center";ctx.fillText("DRIFT CHARGE",vw/2,y-14);}
  }

  function drawSpeedLines(kart, vw, vh, horizon) {
    if(reducedMotion)return;const speedN=Math.max(0,Math.min(1,(Math.abs(kart.speed)-360)/(MAX_SPEED*.8)));if(speedN<=0)return;ctx.strokeStyle=`rgba(255,255,255,${speedN*.32})`;ctx.lineWidth=1.5;for(let i=0;i<12;i++){const side=i%2?-1:1,startX=vw/2+side*(vw*.2+(i%6)*vw*.06),startY=horizon+(i%4)*vh*.08,len=20+speedN*70;ctx.beginPath();ctx.moveTo(startX,startY);ctx.lineTo(startX+side*len,startY+len*.4);ctx.stroke();}}

  function renderCockpitViewport(vx,vy,vw,vh,kart){
    const theme=TRACK_DEFS[state.trackId]||TRACK_DEFS.ghostlight,horizon=vh*.37;ctx.save();ctx.beginPath();ctx.rect(vx,vy,vw,vh);ctx.clip();ctx.translate(vx,vy);
    let sx=0,sy=0;if(!reducedMotion&&kart.shakeT>0){sx=(Math.random()-.5)*kart.shakeMag;sy=(Math.random()-.5)*kart.shakeMag;}ctx.translate(sx,sy);
    const sky=ctx.createLinearGradient(0,0,0,horizon+vh*.2);sky.addColorStop(0,theme.skyTop);sky.addColorStop(1,theme.skyBottom);ctx.fillStyle=sky;ctx.fillRect(-20,-20,vw+40,horizon+40);ctx.fillStyle=theme.ground;ctx.fillRect(-20,horizon,vw+40,vh-horizon+20);
    if(theme.scene==="ice"){ctx.fillStyle="#b7f5df33";ctx.beginPath();ctx.moveTo(0,horizon*.45);ctx.quadraticCurveTo(vw*.25,horizon*.08,vw*.52,horizon*.42);ctx.quadraticCurveTo(vw*.75,horizon*.72,vw,horizon*.2);ctx.lineTo(vw,0);ctx.lineTo(0,0);ctx.fill();}
    const bank=reducedMotion?0:(kart.drifting?kart.inputSteer*.035:kart.inputSteer*.015);ctx.save();ctx.translate(vw/2,vh*.58);ctx.rotate(bank);ctx.translate(-vw/2,-vh*.58);drawScenery(kart,vw,vh,horizon,theme);drawProjectedRoad(kart,vw,vh,horizon,theme);drawRaceObjects(kart,vw,vh,horizon);drawSpeedLines(kart,vw,vh,horizon);ctx.restore();drawRearMirror(kart,vw,vh);drawCockpit(kart,vw,vh,theme);drawCockpitHud(kart,vw,vh,theme);ctx.restore();
  }

  function drawMenuBackdrop(){
    const theme=TRACK_DEFS[selectedTrackId]||TRACK_DEFS.ghostlight,w=canvas.width,h=canvas.height,hy=h*.42;const sky=ctx.createLinearGradient(0,0,0,hy);sky.addColorStop(0,theme.skyTop);sky.addColorStop(1,theme.skyBottom);ctx.fillStyle=sky;ctx.fillRect(0,0,w,hy);ctx.fillStyle=theme.ground;ctx.fillRect(0,hy,w,h-hy);quad({x:w*.47,y:hy},{x:w*.53,y:hy},{x:w*.9,y:h},{x:w*.1,y:h},theme.edge);quad({x:w*.475,y:hy},{x:w*.525,y:hy},{x:w*.82,y:h},{x:w*.18,y:h},theme.road);ctx.strokeStyle="#ffffff55";ctx.setLineDash([18,20]);ctx.beginPath();ctx.moveTo(w/2,hy);ctx.lineTo(w/2,h);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#05070a";ctx.beginPath();ctx.moveTo(0,h);ctx.lineTo(0,h*.82);ctx.quadraticCurveTo(w/2,h*.75,w,h*.82);ctx.lineTo(w,h);ctx.fill();
  }

  function render(dtReal) {
    resizeIfNeeded();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (state.phase === "title" || state.phase === "setup" || !state.karts.length) { drawMenuBackdrop(); return; }
    // Visual-only smoothing (steer/drift yaw) for every drawn kart.
    const vf = Math.min(1, dtReal * 10);
    for (const k of state.karts) {
      k.visSteer += (k.inputSteer * 0.42 - k.visSteer) * vf;
      k.visYaw += ((k.drifting ? k.inputSteer * 0.32 : 0) - k.visYaw) * vf;
    }
    const humans = state.karts.filter((k) => k.human);
    if (humans.length <= 1) {
      const cam = humans[0] || state.karts[0];
      renderCockpitViewport(0,0,canvas.width,canvas.height,cam);
    } else {
      const h = canvas.height / 2;
      renderCockpitViewport(0,0,canvas.width,h,humans[0]);
      renderCockpitViewport(0,h,canvas.width,h,humans[1]);
      ctx.fillStyle = "#05030a"; ctx.fillRect(0, h - 2, canvas.width, 4);
    }
  }

  // ---------------------------------------------------------------------
  // DOM wiring
  // ---------------------------------------------------------------------
  const titleOverlay = document.querySelector("[data-title-overlay]");
  const startOverlay = document.querySelector("[data-start-overlay]");
  const countdownOverlay = document.querySelector("[data-countdown-overlay]");
  const countdownNumEl = document.querySelector("[data-countdown-num]");
  const finishOverlay = document.querySelector("[data-finish-overlay]");
  const pauseOverlay = document.querySelector("[data-pause-overlay]");
  const standingsEl = document.querySelector("[data-standings]");
  const touchControls = document.querySelector("[data-touch-controls]");
  const finishTrackEl = document.querySelector("[data-finish-track]");
  let hostPaused = false;
  let finishReported = false;

  function setHostPaused(next) {
    if (hostPaused === next) return;
    hostPaused = next;
    pauseOverlay.hidden = !hostPaused;
    host("paused", { paused: hostPaused });
  }

  function renderStandingsList() {
    const standings = computeStandings();
    standingsEl.innerHTML = standings.map((k) => {
      const ord = ["", "1st", "2nd", "3rd", "4th"][k.rank] || `${k.rank}th`;
      return `<div class="standing-row ${k.human ? "is-you" : ""}">
        <span class="standing-place">${ord}</span>
        <span class="standing-dot" style="background:${k.color}"></span>
        <span class="standing-name">${k.name}${k.human ? " (you)" : ""}</span>
      </div>`;
    }).join("");
    finishTrackEl.textContent = TRACK_DEFS[state.trackId].label + " | " + LAPS + " laps";
  }

  function updateDomOverlays() {
    if (state.phase === "countdown") {
      countdownOverlay.hidden = false;
      const n = Math.min(3,Math.ceil(state.countdownT));
      countdownNumEl.textContent = n > 0 ? String(n) : "GO!";
      countdownNumEl.classList.toggle("go", n <= 0);
    } else {
      countdownOverlay.hidden = true;
    }
    if (state.phase === "finished") {
      if (finishOverlay.hidden) { finishOverlay.hidden = false; renderStandingsList(); reportRaceComplete(); }
    } else {
      finishOverlay.hidden = true;
    }
    touchControls.hidden = !((state.phase === "racing" || state.phase === "countdown") && state.mode === "1p" && !hostPaused);
  }

  document.querySelector("[data-garage-btn]").addEventListener("click", () => { titleOverlay.hidden = true; startOverlay.hidden = false; state.phase = "setup"; });
  document.querySelector("[data-title-btn]").addEventListener("click", () => { startOverlay.hidden = true; titleOverlay.hidden = false; state.phase = "title"; });
  document.querySelectorAll("[data-track]").forEach((btn) => {
    btn.setAttribute("aria-pressed",String(btn.dataset.track===selectedTrackId));
    btn.addEventListener("click", () => {
      selectedTrackId = TRACK_DEFS[btn.dataset.track] ? btn.dataset.track : "ghostlight";
      career.selectedTrack = selectedTrackId; saveCareer(); rebuildTrack(selectedTrackId);
      document.querySelectorAll("[data-track]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    });
  });
  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => { startOverlay.hidden = true; startRace(btn.dataset.mode); });
  });
  document.querySelector("[data-restart-btn]").addEventListener("click", () => { finishOverlay.hidden = true; startRace(state.mode); });
  document.querySelector("[data-menu-btn]").addEventListener("click", () => { finishOverlay.hidden = true; state.phase = "setup"; startOverlay.hidden = false; });
  document.querySelector("[data-resume-btn]").addEventListener("click", () => setHostPaused(false));

  document.querySelectorAll("[data-touch]").forEach((btn) => {
    const action = btn.dataset.touch;
    const on = (e) => { e.preventDefault(); if (action === "item") { const kart=state.karts[0]; if(kart) useItem(kart); return; } touchInput[action] = true; btn.setPointerCapture?.(e.pointerId); };
    const off = (e) => { e.preventDefault(); if (action !== "item") touchInput[action] = false; };
    btn.addEventListener("pointerdown", on); btn.addEventListener("pointerup", off); btn.addEventListener("pointercancel", off); btn.addEventListener("pointerleave", off);
  });

  // ---------------------------------------------------------------------
  // Main loop — fixed timestep simulation, rAF-driven render.
  // ---------------------------------------------------------------------
  let accumulator = 0, lastFrameTime = 0;
  function frame(now) {
    if (!lastFrameTime) lastFrameTime = now;
    let delta = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    delta = Math.min(delta, 0.25);
    if ((state.phase === "racing" || state.phase === "countdown") && !hostPaused) {
      accumulator += delta;
      while (accumulator >= TICK) { simulateTick(TICK); accumulator -= TICK; }
    }
    render(delta);
    updateDomOverlays();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Host <-> game protocol: the PhantomPlay shell posts these once the
  // iframe is mounted; without a 'ready' reply the shell's watchdog treats
  // the game as unresponsive after 12s.
  window.addEventListener("message", (evt) => {
    const d = evt.data;
    if (!d || d.source !== "phantomplay-host") return;
    if (d.type === "settings") { gpEnabled = !!d.gamepad; reducedMotion = !!d.reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    else if (d.type === "pause") setHostPaused(true);
    else if (d.type === "resume") setHostPaused(false);
    else if (d.type === "restart") {
      finishOverlay.hidden = true;
      setHostPaused(false);
      if (state.mode) startRace(state.mode);
      else { state.phase = "title"; titleOverlay.hidden = false; startOverlay.hidden = true; }
    } else if (d.type === "exit") {
      setHostPaused(true);
    } else if (d.type === "restore" || d.type === "load-state") {
      const incoming=d.state;if(incoming&&typeof incoming==="object"){
        if(incoming.career&&typeof incoming.career==="object")career=Object.assign(career,incoming.career);
        const track=incoming.track||incoming.career?.selectedTrack;if(TRACK_DEFS[track]){selectedTrackId=track;rebuildTrack(track);document.querySelectorAll("[data-track]").forEach((b)=>b.setAttribute("aria-pressed",String(b.dataset.track===track)));}
        saveCareer();
      }
    } else if (d.type === "save-state") {
      host("progress",{progress:state.karts[0]?Math.max(0,Math.min(99,Math.round(state.karts[0].unwrapped/(TRACK.N*LAPS)*100))):0,score:state.karts[0]?Math.max(0,5-(state.karts[0].rank||4))*100:0,state:raceState()});
    }
  });
  host("ready");

  // ---------------------------------------------------------------------
  // Test/debug hook — NOT part of normal play, used for automated
  // verification only.
  // ---------------------------------------------------------------------
  window.__PhantomGPTest = {
    start(mode) { startOverlay.hidden = true; startRace(mode); state.phase = "racing"; state.countdownT = 0; },
    tick(n = 1) { for (let i = 0; i < n; i++) simulateTick(TICK); },
    getState() { return state; },
    standings() { return computeStandings().map((k) => ({ id: k.id, name: k.name, rank: k.rank, finished: k.finished, place: k.place, unwrapped: k.unwrapped, human: k.human })); },
    setItem(idx, item) { state.karts[idx].item = item; },
    useItem(idx) { useItem(state.karts[idx]); },
    setInput(idx, input) { Object.assign(state.karts[idx], input); },
  };
})();
