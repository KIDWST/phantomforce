/* Phantom Grand Prix — an original kart racer for PhantomPlay.
 * Top-down arcade physics, drift-charged mini-turbos, catch-up item
 * odds, and local split-screen multiplayer (2 humans + CPU racers
 * filling the rest of the 4-kart grid). No external art assets —
 * everything is canvas-drawn shapes, same approach as the other
 * PhantomPlay titles in this repo.
 *
 * Perf discipline: fixed-timestep simulation decoupled from render
 * rate, pooled particles/projectiles (ObjectPool, below), a cached
 * Path2D for the track so it isn't rebuilt every frame, and no
 * per-frame allocation in the hot loop.
 */
(function () {
  "use strict";

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
  // Track — closed Catmull-Rom spline through hand-placed control points.
  // ---------------------------------------------------------------------
  const CONTROL = [
    { x: 220, y: 1000 }, { x: 220, y: 300 }, { x: 620, y: 90 }, { x: 1400, y: 90 },
    { x: 1950, y: 280 }, { x: 1520, y: 560 }, { x: 1950, y: 840 }, { x: 1950, y: 1420 },
    { x: 1500, y: 1820 }, { x: 680, y: 1920 }, { x: 230, y: 1700 },
  ];

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
  const TRACK = buildTrack(CONTROL, 18); // N = 198 samples
  const AVG_SAMPLE_SPACING = (function () {
    let total = 0;
    for (let i = 0; i < TRACK.N; i++) total += Math.hypot(TRACK.pts[(i + 1) % TRACK.N].x - TRACK.pts[i].x, TRACK.pts[(i + 1) % TRACK.N].y - TRACK.pts[i].y);
    return total / TRACK.N;
  })();

  const TRACK_PATH = (function () {
    const p = new Path2D();
    p.moveTo(TRACK.pts[0].x, TRACK.pts[0].y);
    for (let i = 1; i < TRACK.N; i++) p.lineTo(TRACK.pts[i].x, TRACK.pts[i].y);
    p.closePath();
    return p;
  })();

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
  const state = { mode: null, karts: [], boxes: [], hazards: [], bolts: [], particles: [], phase: "menu", countdownT: 0, raceT: 0, finishOrder: [] };

  function makeKart(id, name, color, human, keys, slot) {
    const lateral = slot % 2 === 0 ? -70 : 70;
    const behind = 40 + Math.floor(slot / 2) * 110;
    const p0 = TRACK.pts[0], n0 = TRACK.nor[0], t0 = TRACK.tan[0];
    const x = p0.x + n0.x * lateral - t0.x * behind;
    const y = p0.y + n0.y * lateral - t0.y * behind;
    return {
      id, name, color, human, keys,
      x, y, angle: Math.atan2(t0.y, t0.x),
      camX: x, camY: y,
      speed: 0, inputSteer: 0, inputThrottle: 0, inputDrift: false,
      drifting: false, driftCharge: 0,
      boostTimer: 0, surgeTimer: 0, spinTimer: 0, shielded: false, shieldTimer: 0,
      item: null, rank: slot + 1,
      hintIdx: findNearestIndexFull({ x, y }),
      unwrapped: -(behind / AVG_SAMPLE_SPACING),
      finished: false, place: 0,
      aiOffset: human ? 0 : Math.random() * 80 - 40,
      aiDecisionT: Math.random() * 0.4,
      _offTrack: false, _itemKeyWasDown: false,
    };
  }

  function startRace(mode) {
    state.mode = mode;
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
    state.countdownT = 3.999;
    state.raceT = 0;
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------
  const pressed = new Set();
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Slash", "Enter"].includes(e.code)) e.preventDefault();
    pressed.add(e.code);
  });
  window.addEventListener("keyup", (e) => { pressed.delete(e.code); });
  const keyIsDown = (code) => !!code && pressed.has(code);

  function applyHumanInput(kart) {
    const k = kart.keys;
    kart.inputThrottle = (keyIsDown(k.up) ? 1 : 0) - (keyIsDown(k.down) ? 1 : 0);
    kart.inputSteer = (keyIsDown(k.right) ? 1 : 0) - (keyIsDown(k.left) ? 1 : 0);
    kart.inputDrift = keyIsDown(k.drift) || (k.driftAlt && keyIsDown(k.driftAlt));
    const itemDown = keyIsDown(k.item);
    if (itemDown && !kart._itemKeyWasDown) useItem(kart);
    kart._itemKeyWasDown = itemDown;
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
    kart.inputThrottle = Math.abs(diff) > 1.0 ? 0.55 : 1;
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
        if (boostAmt > 0) {
          kart.speed = Math.min(kart.speed + boostAmt * 0.5, MAX_SPEED * 1.5);
          kart.boostTimer = Math.max(kart.boostTimer, boostTime);
          for (let i = 0; i < 10; i++) spawnParticle(kart.x, kart.y, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, 0.5 + Math.random() * 0.3, sparkColor || "#fff", 3 + Math.random() * 3);
        }
        kart.drifting = false; kart.driftCharge = 0;
      }
      if (kart.drifting) kart.driftCharge += dt;

      const speedFactor = Math.min(1, 0.35 + (Math.abs(kart.speed) / MAX_SPEED) * 0.85);
      const turnRate = 2.5 * speedFactor * (kart.drifting ? 1.4 : 1);
      kart.angle += steer * turnRate * dt * (kart.speed < 0 ? -1 : 1);

      let maxSpeed = MAX_SPEED;
      if (kart._offTrack) maxSpeed *= 0.55;
      if (kart.boostTimer > 0) maxSpeed *= 1.35;
      if (kart.surgeTimer > 0) maxSpeed *= 1.6;

      if (throttle !== 0) {
        kart.speed += throttle * (throttle > 0 ? 620 : 520) * dt;
      } else {
        const drag = kart._offTrack ? 520 : 300;
        if (kart.speed > 0) kart.speed = Math.max(0, kart.speed - drag * dt);
        else if (kart.speed < 0) kart.speed = Math.min(0, kart.speed + drag * dt);
      }
      kart.speed = Math.max(-MAX_SPEED * 0.45, Math.min(maxSpeed, kart.speed));

      if (kart.drifting && Math.random() < 0.6) spawnParticle(kart.x - Math.cos(kart.angle) * 14, kart.y - Math.sin(kart.angle) * 14, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.3, "#fff", 2);
      if (kart.boostTimer > 0 && Math.random() < 0.7) spawnParticle(kart.x - Math.cos(kart.angle) * 22, kart.y - Math.sin(kart.angle) * 22, -Math.cos(kart.angle) * 60, -Math.sin(kart.angle) * 60, 0.3, "#ffd166", 3);
    }

    if (kart.boostTimer > 0) kart.boostTimer = Math.max(0, kart.boostTimer - dt);
    if (kart.surgeTimer > 0) kart.surgeTimer = Math.max(0, kart.surgeTimer - dt);
    if (kart.shieldTimer > 0) { kart.shieldTimer -= dt; if (kart.shieldTimer <= 0) kart.shielded = false; }

    kart.x += Math.cos(kart.angle) * kart.speed * dt;
    kart.y += Math.sin(kart.angle) * kart.speed * dt;

    const idx = findNearestIndex({ x: kart.x, y: kart.y }, kart.hintIdx, TRACK.N, 14);
    const pt = TRACK.pts[idx], nor = TRACK.nor[idx];
    const lateral = (kart.x - pt.x) * nor.x + (kart.y - pt.y) * nor.y;
    kart._offTrack = Math.abs(lateral) > TRACK_WIDTH / 2;
    const hardWall = TRACK_WIDTH / 2 + 110;
    if (Math.abs(lateral) > hardWall) {
      const clampLat = Math.sign(lateral) * hardWall;
      kart.x = pt.x + nor.x * clampLat;
      kart.y = pt.y + nor.y * clampLat;
      kart.speed *= 0.35;
    }

    const delta = wrapDelta(idx, kart.hintIdx, TRACK.N);
    kart.hintIdx = idx;
    kart.unwrapped += delta;

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
        ctx.rotate(-b.spin);
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

  function drawParticles() {
    for (const p of state.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawKart(k) {
    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.rotate(k.angle);
    ctx.scale(1, k.drifting ? 0.85 : 1);
    if (k.surgeTimer > 0) { ctx.fillStyle = "rgba(255,209,102,.25)"; ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = k.spinTimer > 0 ? "#888" : k.color;
    ctx.beginPath();
    ctx.moveTo(20, 0); ctx.lineTo(-14, -13); ctx.lineTo(-8, 0); ctx.lineTo(-14, 13); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.5)";
    ctx.fillRect(-2, -6, 10, 12);
    if (k.shielded) {
      ctx.rotate(-k.angle);
      ctx.strokeStyle = "rgba(65,255,161,.7)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.translate(k.x, k.y - 30);
    ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.font = "700 11px monospace"; ctx.textAlign = "center";
    ctx.fillText(k.name, 0, 0);
    ctx.restore();
  }

  function drawMinimap(mx, my, mw, mh, camKart) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(2,2,6,.5)"; ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = "rgba(255,255,255,.3)"; ctx.lineWidth = 2; ctx.strokeRect(mx, my, mw, mh);
    const cx = mx + mw / 2, cy = my + mh / 2, rx = mw / 2 - 14, ry = mh / 2 - 14;
    ctx.strokeStyle = "rgba(255,255,255,.4)";
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    for (const k of state.karts) {
      const frac = ((k.unwrapped % TRACK.N) + TRACK.N) % TRACK.N / TRACK.N;
      const ang = frac * Math.PI * 2 - Math.PI / 2;
      const dx = cx + Math.cos(ang) * rx, dy = cy + Math.sin(ang) * ry;
      ctx.fillStyle = k.color;
      ctx.beginPath(); ctx.arc(dx, dy, k === camKart ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
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
    drawMinimap(vx + vw - 140, vy + 16, 124, 94, kart);
  }

  function renderViewport(vx, vy, vw, vh, cameraKart) {
    ctx.save();
    ctx.beginPath(); ctx.rect(vx, vy, vw, vh); ctx.clip();
    ctx.fillStyle = "#0e2415"; ctx.fillRect(vx, vy, vw, vh);
    const zoom = 0.62;
    ctx.translate(vx + vw / 2, vy + vh / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cameraKart.camX, -cameraKart.camY);
    drawTrack();
    drawBoxes();
    drawHazards();
    drawBolts();
    drawParticles();
    for (const k of state.karts) drawKart(k);
    ctx.restore();
    drawViewportHUD(vx, vy, vw, vh, cameraKart);
  }

  function render(dtReal) {
    resizeIfNeeded();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (state.phase === "menu" || !state.karts.length) return;
    for (const k of state.karts) {
      const tx = k.x + Math.cos(k.angle) * 70, ty = k.y + Math.sin(k.angle) * 70;
      k.camX += (tx - k.camX) * Math.min(1, dtReal * 4.5);
      k.camY += (ty - k.camY) * Math.min(1, dtReal * 4.5);
    }
    const humans = state.karts.filter((k) => k.human);
    if (humans.length <= 1) {
      renderViewport(0, 0, canvas.width, canvas.height, humans[0] || state.karts[0]);
    } else {
      const h = canvas.height / 2;
      renderViewport(0, 0, canvas.width, h, humans[0]);
      renderViewport(0, h, canvas.width, h, humans[1]);
      ctx.fillStyle = "#05030a"; ctx.fillRect(0, h - 2, canvas.width, 4);
    }
  }

  // ---------------------------------------------------------------------
  // DOM wiring
  // ---------------------------------------------------------------------
  const startOverlay = document.querySelector("[data-start-overlay]");
  const countdownOverlay = document.querySelector("[data-countdown-overlay]");
  const countdownNumEl = document.querySelector("[data-countdown-num]");
  const finishOverlay = document.querySelector("[data-finish-overlay]");
  const standingsEl = document.querySelector("[data-standings]");

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
  }

  function updateDomOverlays() {
    if (state.phase === "countdown") {
      countdownOverlay.hidden = false;
      const n = Math.ceil(state.countdownT);
      countdownNumEl.textContent = n > 0 ? String(n) : "GO!";
      countdownNumEl.classList.toggle("go", n <= 0);
    } else {
      countdownOverlay.hidden = true;
    }
    if (state.phase === "finished") {
      if (finishOverlay.hidden) { finishOverlay.hidden = false; renderStandingsList(); }
    } else {
      finishOverlay.hidden = true;
    }
  }

  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => { startOverlay.hidden = true; startRace(btn.dataset.mode); });
  });
  document.querySelector("[data-restart-btn]").addEventListener("click", () => { finishOverlay.hidden = true; startRace(state.mode); });
  document.querySelector("[data-menu-btn]").addEventListener("click", () => { finishOverlay.hidden = true; state.phase = "menu"; startOverlay.hidden = false; });

  // ---------------------------------------------------------------------
  // Main loop — fixed timestep simulation, rAF-driven render.
  // ---------------------------------------------------------------------
  let accumulator = 0, lastFrameTime = 0;
  function frame(now) {
    if (!lastFrameTime) lastFrameTime = now;
    let delta = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    delta = Math.min(delta, 0.25);
    if (state.phase === "racing" || state.phase === "countdown") {
      accumulator += delta;
      while (accumulator >= TICK) { simulateTick(TICK); accumulator -= TICK; }
    }
    render(delta);
    updateDomOverlays();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

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
