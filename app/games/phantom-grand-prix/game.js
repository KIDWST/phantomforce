/*
 * Chicklet Grand Prix — a Super Monkey Ball–style roll racer for PhantomPlay.
 *
 * You are a little chick tucked in a glass roll-ball. You don't drive — you
 * TILT the world and let momentum carry you down a floating ribbon circuit.
 * Steer clean lines to build Flow, tap it for a burst, draft rivals for a
 * slipstream, and roll to the flag. No weapons, no chaos — just gorgeous,
 * readable, physics-y racing.
 *
 * Rendering is a hand-rolled pseudo-3D segment road (projected trapezoids,
 * back-to-front) with a live camera roll that literally tilts the horizon as
 * you lean, selling the marble-tilt feel. Everything is drawn procedurally —
 * no external assets — so it stays inside the game's strict CSP.
 */
(function () {
  "use strict";

  /* ---- PhantomPlay host bridge ---------------------------------------- */
  const host = (type, data = {}) => parent.postMessage({ source: "phantomplay-game", type, ...data }, "*");

  /* ---- tiny math ------------------------------------------------------ */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
  const nowMs = () => performance.now();
  const TAU = Math.PI * 2;

  /* ---- canvas --------------------------------------------------------- */
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d", { alpha: false });
  let W = 0, H = 0, DPR = 1, CX = 0, CY = 0;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CX = W / 2; CY = H / 2;
  }
  window.addEventListener("resize", resize);
  resize();

  /* ---- pseudo-3D config ---------------------------------------------- */
  const SEG_LEN = 200;         // world units per road segment
  const ROAD_W = 2200;         // half road width
  const RUMBLE = 5;            // segments per rumble stripe
  const DRAW_DIST = 190;       // segments rendered ahead
  const FOV = 100;
  const CAM_HEIGHT = 1350;     // camera height above the road
  const CAM_DEPTH = 1 / Math.tan(((FOV / 2) * Math.PI) / 180);
  const CENTRIFUGAL = 0.32;    // how hard curves throw you outward
  const MAXSPEED = SEG_LEN * 58;
  const LAPS = 3;

  /* ---- themed circuits ------------------------------------------------ */
  const THEMES = {
    meadow: {
      name: "Sunrise Meadow", blurb: "Rolling green hills, warm dawn light",
      sky: ["#ffe7b3", "#ffc178", "#8fd0ff"], sun: "#fff4d6", sunAt: 0.32,
      grass: ["#4bbf6b", "#3fa85f"], rumble: ["#ffffff", "#ff6f9c"],
      road: ["#63707c", "#59656f"], lane: "#f4f9ff", fog: "#ffd9a6",
      hills: "#7fc98a", scenery: "tree",
    },
    cloudtop: {
      name: "Cloudtop Isles", blurb: "Pastel sky islands above the clouds",
      sky: ["#cfeaff", "#a9d4ff", "#f7c9ec"], sun: "#fffef2", sunAt: 0.5,
      grass: ["#9be7d0", "#7fd8c0"], rumble: ["#ffffff", "#7ad0ff"],
      road: ["#7d7fb0", "#7276a6"], lane: "#ffffff", fog: "#dff1ff",
      hills: "#bfe6ff", scenery: "cloud",
    },
    aurora: {
      name: "Aurora Ridge", blurb: "Night snow under a living sky",
      sky: ["#06122e", "#123a6b", "#3ad0b0"], sun: "#bafff0", sunAt: 0.66,
      grass: ["#25406a", "#1d3358"], rumble: ["#eafcff", "#57f0c8"],
      road: ["#3a4668", "#333e5c"], lane: "#d7f6ff", fog: "#0d2145",
      hills: "#2b6c8f", scenery: "crystal",
    },
  };
  const TRACK_ORDER = ["meadow", "cloudtop", "aurora"];

  /* ---- chicklet racers ------------------------------------------------ */
  const CHICKS = [
    { name: "Pippin", body: "#ffd23f", accent: "#ff9e2c" },
    { name: "Yolko", body: "#ffe98a", accent: "#ffab3d" },
    { name: "Biscuit", body: "#ffbf69", accent: "#e07a2c" },
    { name: "Marble", body: "#cfe8ff", accent: "#7fb4ff" },
    { name: "Cocoa", body: "#c89a6a", accent: "#7d5836" },
    { name: "Minty", body: "#b4f0c9", accent: "#4fd39a" },
    { name: "Rosie", body: "#ffc2d6", accent: "#ff6f9c" },
    { name: "Ash", body: "#d7dce6", accent: "#9aa6bd" },
  ];

  /* ---- track building ------------------------------------------------- */
  let segments = [];
  let trackLength = 0;
  let theme = THEMES.meadow;
  let miniPath = [];   // precomputed 2D centerline for the minimap

  function lastY() { return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y; }
  function addSegment(curve, y) {
    const n = segments.length;
    segments.push({
      index: n,
      p1: { world: { y: lastY(), z: n * SEG_LEN }, camera: {}, screen: {} },
      p2: { world: { y, z: (n + 1) * SEG_LEN }, camera: {}, screen: {} },
      curve,
      dark: Math.floor(n / RUMBLE) % 2 === 1,
      boost: false,
      sprites: [],
    });
  }
  function addRoad(enter, hold, leave, curve, height) {
    const startY = lastY();
    const endY = startY + height * SEG_LEN;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) addSegment(easeInOut(n / enter) * curve, startY + easeInOut(n / total) * (endY - startY));
    for (let n = 0; n < hold; n++) addSegment(curve, startY + easeInOut((enter + n) / total) * (endY - startY));
    for (let n = 0; n < leave; n++) addSegment(easeInOut(1 - n / leave) * curve, startY + easeInOut((enter + hold + n) / total) * (endY - startY));
  }
  function addBoostZone(len) {
    const start = segments.length;
    for (let i = 0; i < len; i++) addSegment(0, lastY());
    for (let i = start; i < segments.length; i++) segments[i].boost = true;
  }
  function addScenery(density) {
    const s = theme.scenery;
    for (let i = 20; i < segments.length; i += density) {
      const side = (i % (density * 2) === 0) ? 1 : -1;
      segments[i].sprites.push({ kind: s, offset: side * rand(1.5, 3.2), scale: rand(0.8, 1.5) });
    }
  }

  const C = { EASY: 2, MED: 4, HARD: 6, S_HILL: 20, M_HILL: 40, B_HILL: 60 };
  function buildTrack(key) {
    theme = THEMES[key];
    segments = [];
    addRoad(20, 20, 20, 0, 0);
    addRoad(24, 40, 24, C.MED, C.S_HILL);
    addBoostZone(14);
    addRoad(20, 30, 20, -C.MED, -C.S_HILL);
    addRoad(20, 24, 20, C.HARD, C.M_HILL);
    addRoad(24, 40, 24, 0, -C.M_HILL);
    addRoad(20, 30, 20, -C.HARD, 0);
    addBoostZone(12);
    addRoad(22, 36, 22, C.MED, C.B_HILL);
    addRoad(22, 30, 22, -C.EASY, -C.B_HILL);
    addRoad(24, 44, 24, -C.HARD, C.S_HILL);
    addRoad(20, 26, 20, C.MED, -C.S_HILL);
    addRoad(30, 30, 30, 0, 0);
    addRoad(20, 20, 30, 0, 0);
    // flat, straight start/finish for a clean grid
    for (let i = 0; i < 12; i++) if (segments[i]) { segments[i].curve = 0; segments[i].p1.world.y = 0; segments[i].p2.world.y = 0; }
    addScenery(9);
    trackLength = segments.length * SEG_LEN;
    computeMiniPath();
  }
  function findSegment(z) { return segments[Math.floor(z / SEG_LEN) % segments.length]; }

  function computeMiniPath() {
    let x = 0, y = 0, dir = 0, minx = 0, maxx = 0, miny = 0, maxy = 0;
    const pts = [];
    for (let i = 0; i < segments.length; i++) {
      dir += segments[i].curve * 0.018;
      x += Math.sin(dir) * 6; y += Math.cos(dir) * 6;
      pts.push({ x, y });
      minx = Math.min(minx, x); maxx = Math.max(maxx, x);
      miny = Math.min(miny, y); maxy = Math.max(maxy, y);
    }
    const w = maxx - minx || 1, h = maxy - miny || 1;
    miniPath = pts.map((p) => ({ x: (p.x - minx) / w, y: (p.y - miny) / h }));
  }

  /* ---- projection ----------------------------------------------------- */
  function project(p, camX, camY, camZ) {
    p.camera.x = (p.world.x || 0) - camX;
    p.camera.y = (p.world.y || 0) - camY;
    p.camera.z = (p.world.z || 0) - camZ;
    const scale = CAM_DEPTH / Math.max(1, p.camera.z);
    p.screen.scale = scale;
    p.screen.x = Math.round(CX + scale * p.camera.x * CX);
    p.screen.y = Math.round(CY - scale * p.camera.y * CY);
    p.screen.w = Math.round(scale * ROAD_W * CX);
  }

  /* ---- game state ----------------------------------------------------- */
  const state = {
    phase: "title", mode: "single", trackKey: "meadow",
    racers: [], player: null, countdown: 0, raceTime: 0,
    finishOrder: [], cup: null, hostPaused: false, endTimer: 0,
  };
  let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function makeRacer(chick, human, gridPos) {
    return {
      chick, human,
      pos: -gridPos * SEG_LEN * 0.9,
      x: (gridPos % 2 === 0 ? -0.45 : 0.45) + rand(-0.05, 0.05),
      dx: 0, speed: 0, lap: 0, prevPos: 0,
      finished: false, place: 0, finishTime: 0,
      rollPhase: 0, bob: 0, land: 0,
      flow: 0, boost: 0, slip: 0,
      lane: rand(-0.55, 0.55), skill: human ? 1 : rand(0.9, 1.02),
      laneTimer: rand(1, 3), lastLapMs: 0, bestLapMs: 0, lapStart: 0,
    };
  }
  function resetRace() {
    buildTrack(state.trackKey);
    const field = state.mode === "time" ? 1 : 6;
    const you = makeRacer(CHICKS[0], true, 0);
    const racers = [you];
    for (let i = 1; i < field; i++) racers.push(makeRacer(CHICKS[i % CHICKS.length], false, i));
    state.racers = racers;
    state.player = you;
    state.raceTime = 0;
    state.finishOrder = [];
    state.countdown = 3.2;
    state.phase = "countdown";
    state.endTimer = 0;
    updateCam(true);
  }

  /* ---- input ---------------------------------------------------------- */
  const keys = {};
  const input = { steer: 0, gas: true, brake: false, boost: false, touchSteer: 0, touchBoost: false };
  window.addEventListener("keydown", (e) => {
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(e.key)) e.preventDefault();
    keys[e.key.toLowerCase()] = true;
    if (e.key === " ") keys["space"] = true;
    if ((e.key === "p" || e.key === "Escape") && (state.phase === "racing" || state.phase === "paused")) togglePause();
    if (e.key.toLowerCase() === "m") AudioSys.toggle();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; if (e.key === " ") keys["space"] = false; });
  function readInput() {
    let steer = 0;
    if (keys["arrowleft"] || keys["a"]) steer -= 1;
    if (keys["arrowright"] || keys["d"]) steer += 1;
    steer += input.touchSteer;
    input.steer = clamp(steer, -1, 1);
    input.brake = !!(keys["arrowdown"] || keys["s"]);
    input.boost = !!(keys["space"] || keys["shift"] || input.touchBoost);
  }

  /* ---- physics -------------------------------------------------------- */
  function updateRacer(r, dt) {
    const seg = findSegment(((r.pos % trackLength) + trackLength) % trackLength);
    const speedPct = r.speed / MAXSPEED;
    const onRoad = Math.abs(r.x) < 1;

    let steer = 0, wantBoost = false, braking = false;
    if (r.human) {
      steer = input.steer; braking = input.brake; wantBoost = input.boost;
    } else {
      r.laneTimer -= dt;
      if (r.laneTimer <= 0) { r.lane = rand(-0.6, 0.6); r.laneTimer = rand(1.6, 3.4); }
      const target = r.lane - seg.curve * 0.06;
      steer = clamp((target - r.x) * 2.2, -1, 1);
      wantBoost = r.flow >= 1 && Math.abs(seg.curve) < 1;
    }

    const targetSpeed = braking ? MAXSPEED * 0.35 : MAXSPEED * (onRoad ? 1 : 0.55) * (r.human ? 1 : r.skill);
    const accel = r.speed < targetSpeed ? 5.2 : 7.0;
    r.speed += (targetSpeed - r.speed) * clamp(accel * dt, 0, 1);

    if (seg.boost && onRoad) r.speed = Math.min(MAXSPEED * 1.5, r.speed + MAXSPEED * 1.6 * dt);
    if (r.boost > 0) { r.boost -= dt; r.speed = Math.min(MAXSPEED * 1.45, r.speed + MAXSPEED * 1.3 * dt); }
    if (wantBoost && r.flow >= 1 && r.boost <= 0) { r.boost = 1.1; r.flow = 0; if (r.human) AudioSys.blip(660, 0.12); }
    const smooth = onRoad ? clamp(1 - Math.abs(r.dx) * 0.6, 0, 1) : -1.2;
    r.flow = clamp(r.flow + smooth * dt * 0.32, 0, 1);

    r.slip = Math.max(0, r.slip - dt * 2);
    for (const o of state.racers) {
      if (o === r) continue;
      const gap = o.pos - r.pos;
      if (gap > 40 && gap < SEG_LEN * 5 && Math.abs(o.x - r.x) < 0.4) { r.slip = 1; break; }
    }
    if (r.slip > 0) r.speed = Math.min(MAXSPEED * 1.5, r.speed + MAXSPEED * 0.35 * dt);

    const grip = onRoad ? 1 : 0.5;
    r.dx += steer * dt * 2.6 * grip * (0.5 + speedPct * 0.5);
    r.dx -= seg.curve * speedPct * CENTRIFUGAL * dt;
    r.dx *= Math.pow(0.06, dt);
    r.x += r.dx * dt * 1.35;

    if (r.x < -1.15) { r.x = -1.15; r.dx *= -0.25; r.speed *= 0.985; }
    if (r.x > 1.15) { r.x = 1.15; r.dx *= -0.25; r.speed *= 0.985; }
    if (!onRoad) r.speed *= Math.pow(0.4, dt);

    r.prevPos = r.pos;
    r.pos += r.speed * dt;

    const lapIndex = Math.floor(r.pos / trackLength);
    if (lapIndex > r.lap && r.pos > 0) {
      const t = state.raceTime;
      r.lastLapMs = (t - r.lapStart) * 1000;
      r.bestLapMs = r.bestLapMs ? Math.min(r.bestLapMs, r.lastLapMs) : r.lastLapMs;
      r.lapStart = t; r.lap = lapIndex;
      if (r.lap >= LAPS && !r.finished) finishRacer(r);
    }

    r.rollPhase += (r.speed / SEG_LEN) * dt * 1.4;
    r.bob = Math.sin(r.rollPhase * 2) * 0.5;
    if (r.land > 0) r.land -= dt * 3;
  }

  function finishRacer(r) {
    r.finished = true;
    r.finishTime = state.raceTime;
    state.finishOrder.push(r);
    r.place = state.finishOrder.length;
    if (r.human) {
      AudioSys.fanfare();
      host("progress", { progress: 100, score: Math.max(0, (state.racers.length + 1 - r.place)) * 100, state: raceSnapshot() });
    }
  }
  function computePositions() {
    const order = state.racers.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.place - b.place;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.pos - a.pos;
    });
    order.forEach((r, i) => { if (!r.finished) r.place = i + 1; });
    return order;
  }
  function raceSnapshot() {
    return { track: state.trackKey, mode: state.mode, cup: state.cup ? { round: state.cup.round, points: state.cup.points } : null };
  }
  function findPct(r) { return ((((r.pos % trackLength) + trackLength) % trackLength) / trackLength); }

  /* ---- update --------------------------------------------------------- */
  function update(dt) {
    if (state.phase === "countdown") {
      state.countdown -= dt;
      for (const r of state.racers) { r.speed = 0; r.rollPhase += dt; }
      if (state.countdown <= 0) { state.phase = "racing"; AudioSys.blip(880, 0.14); }
      updateCam(false);
      return;
    }
    if (state.phase !== "racing") return;

    readInput();
    state.raceTime += dt;
    for (const r of state.racers) if (!r.finished) updateRacer(r, dt);

    for (let i = 0; i < state.racers.length; i++) {
      for (let j = i + 1; j < state.racers.length; j++) {
        const a = state.racers[i], b = state.racers[j];
        if (Math.abs(a.pos - b.pos) < SEG_LEN * 1.2 && Math.abs(a.x - b.x) < 0.34) {
          const push = (a.x < b.x ? -1 : 1) * 0.5 * dt;
          a.x += push; b.x -= push; a.dx += push; b.dx -= push;
        }
      }
    }

    computePositions();

    const you = state.player;
    if (you && !you.finished && Math.floor(state.raceTime * 2) !== Math.floor((state.raceTime - dt) * 2)) {
      const prog = clamp(((you.lap + findPct(you)) / LAPS) * 100, 0, 99);
      host("progress", { progress: Math.round(prog), score: Math.max(0, (state.racers.length + 1 - you.place)) * 100, state: raceSnapshot() });
    }

    if (you && you.finished) {
      state.endTimer += dt;
      const stragglers = state.racers.filter((r) => !r.finished);
      if (state.endTimer > 2.4 || stragglers.length === 0) {
        for (const r of computePositions()) if (!r.finished) finishRacer(r);
        endRace();
      }
    }
    updateCam(false);
  }

  /* ---- camera --------------------------------------------------------- */
  const cam = { roll: 0, shake: 0 };
  function updateCam(instant) {
    const you = state.player;
    if (!you) return;
    const seg = findSegment(((you.pos % trackLength) + trackLength) % trackLength);
    const target = clamp(you.dx * 0.42 + seg.curve * (you.speed / MAXSPEED) * 0.018, -0.13, 0.13);
    cam.roll = instant ? target : lerp(cam.roll, reducedMotion ? 0 : target, 0.12);
    cam.shake *= 0.86;
  }

  /* ==================================================================== */
  /* RENDER                                                               */
  /* ==================================================================== */
  function menuCam() {
    // a slow, gentle fly-through so the title/setup screens show a live world
    return { pos: nowMs() / 7, x: Math.sin(nowMs() / 2600) * 0.28, speed: MAXSPEED * 0.45, dx: 0, boost: 0, flow: 0, bob: 0, rollPhase: nowMs() / 260, chick: CHICKS[0], _menu: true };
  }
  function render() {
    const you = state.player || menuCam();
    const basePos = ((you.pos % trackLength) + trackLength) % trackLength;
    const baseSeg = findSegment(basePos);
    const basePct = (basePos % SEG_LEN) / SEG_LEN;
    const playerY = lerp(baseSeg.p1.world.y, baseSeg.p2.world.y, basePct);
    const playerX = you.x;

    ctx.save();
    if ((cam.roll || cam.shake) && !reducedMotion) {
      ctx.translate(CX, CY);
      ctx.rotate(cam.roll);
      // overscan so the rotated frame always covers the viewport corners
      const os = 1 + Math.abs(cam.roll) * 1.1;
      ctx.scale(os, os);
      if (cam.shake) ctx.translate(rand(-cam.shake, cam.shake), rand(-cam.shake, cam.shake));
      ctx.translate(-CX, -CY);
    }

    drawSky(playerX, baseSeg.curve);

    let maxY = H;
    let x = 0, dx = -(baseSeg.curve * basePct);
    for (let n = 0; n < DRAW_DIST; n++) {
      const seg = segments[(baseSeg.index + n) % segments.length];
      const looped = seg.index < baseSeg.index;
      const loopZ = looped ? trackLength : 0;
      const camY = playerY + CAM_HEIGHT;
      project(seg.p1, playerX * ROAD_W - x, camY, basePos - loopZ);
      project(seg.p2, playerX * ROAD_W - x - dx, camY, basePos - loopZ);
      x += dx; dx += seg.curve;
      seg._fog = Math.min(1, (n / DRAW_DIST) ** 2 * 2.4);
      if (seg.p1.camera.z <= CAM_DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxY) continue;
      drawSegment(seg);
      maxY = seg.p2.screen.y;
    }

    drawRacers(basePos);
    ctx.restore();
    drawHUD();
  }

  function drawSky(px, curve) {
    const s = theme.sky;
    const g = ctx.createLinearGradient(0, -40, 0, H * 0.72);
    g.addColorStop(0, s[0]); g.addColorStop(0.55, s[1]); g.addColorStop(1, s[2]);
    ctx.fillStyle = g; ctx.fillRect(-60, -60, W + 120, H + 120);

    const sunX = W * theme.sunAt - px * 120 - curve * 6, sunY = H * 0.26;
    const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.min(W, H) * 0.5);
    sun.addColorStop(0, theme.sun); sun.addColorStop(0.18, theme.sun + "cc"); sun.addColorStop(1, "#00000000");
    ctx.fillStyle = sun; ctx.fillRect(-60, -60, W + 120, H + 120);

    if (state.trackKey === "aurora" && !reducedMotion) {
      const t = nowMs() / 1000;
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.14;
        const yy = H * 0.16 + i * 26 + Math.sin(t * 0.6 + i) * 10;
        const grd = ctx.createLinearGradient(0, yy, W, yy + 40);
        grd.addColorStop(0, "#57f0c8"); grd.addColorStop(0.5, "#7fb4ff"); grd.addColorStop(1, "#b98aff");
        ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(0, yy);
        for (let xx = 0; xx <= W; xx += 40) ctx.lineTo(xx, yy + Math.sin(xx * 0.01 + t + i) * 18);
        ctx.lineTo(W, yy + 46); ctx.lineTo(0, yy + 46); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const horizon = H * 0.5;
    ctx.fillStyle = theme.hills; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(-40, horizon + 40);
    const off = -px * 60 - curve * 3;
    for (let xx = -40; xx <= W + 40; xx += 30) ctx.lineTo(xx, horizon - 18 - 22 * Math.abs(Math.sin((xx + off) * 0.006)));
    ctx.lineTo(W + 40, horizon + 40); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  const _hexCache = {};
  function hexToRgb(h) {
    if (_hexCache[h]) return _hexCache[h];
    const v = h.replace("#", "");
    const r = { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
    _hexCache[h] = r; return r;
  }
  function fogMix(color, f) {
    if (f <= 0) return color;
    const c = hexToRgb(color), d = hexToRgb(theme.fog);
    return `rgb(${Math.round(lerp(c.r, d.r, f))},${Math.round(lerp(c.g, d.g, f))},${Math.round(lerp(c.b, d.b, f))})`;
  }
  function lighten(hex, amt) {
    const c = hexToRgb(hex);
    return `rgb(${clamp(c.r + amt, 0, 255)},${clamp(c.g + amt, 0, 255)},${clamp(c.b + amt, 0, 255)})`;
  }
  function quad(x1, y1, w1, x2, y2, w2, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1 - w1, y1); ctx.lineTo(x1 + w1, y1);
    ctx.lineTo(x2 + w2, y2); ctx.lineTo(x2 - w2, y2);
    ctx.closePath(); ctx.fill();
  }
  function drawSegment(seg) {
    const p1 = seg.p1.screen, p2 = seg.p2.screen, f = seg._fog;
    const grass = fogMix(theme.grass[seg.dark ? 1 : 0], f);
    const road = seg.boost ? fogMix(seg.dark ? "#3b2f6b" : "#463a80", f) : fogMix(theme.road[seg.dark ? 1 : 0], f);
    const rumble = fogMix(theme.rumble[seg.dark ? 1 : 0], f);

    ctx.fillStyle = grass; ctx.fillRect(0, p2.y, W, p1.y - p2.y + 1);
    quad(p1.x, p1.y, p1.w * 1.16, p2.x, p2.y, p2.w * 1.16, rumble);
    quad(p1.x, p1.y, p1.w, p2.x, p2.y, p2.w, road);
    if (seg.boost && !seg.dark) quad(p1.x, p1.y, p1.w * 0.5, p2.x, p2.y, p2.w * 0.5, fogMix("#8f7bff", f));
    if (!seg.dark) quad(p1.x, p1.y, Math.max(1, p1.w * 0.04), p2.x, p2.y, Math.max(1, p2.w * 0.04), fogMix(theme.lane, f));
    for (const sp of seg.sprites) drawScenerySprite(seg, sp, f);
  }
  function drawScenerySprite(seg, sp, f) {
    const s = seg.p1.screen;
    if (s.scale <= 0) return;
    const sx = s.x + s.scale * sp.offset * ROAD_W * CX;
    const sy = s.y;
    const size = s.scale * sp.scale * 2400;
    if (size < 4 || sy > H || sx < -size || sx > W + size) return;
    ctx.globalAlpha = 1 - f * 0.7;
    if (sp.kind === "tree") {
      ctx.fillStyle = fogMix("#6b4a2a", f);
      ctx.fillRect(sx - size * 0.05, sy - size * 0.5, size * 0.1, size * 0.5);
      ctx.fillStyle = fogMix("#3f9e58", f);
      ctx.beginPath(); ctx.arc(sx, sy - size * 0.55, size * 0.32, 0, TAU); ctx.fill();
    } else if (sp.kind === "cloud") {
      ctx.globalAlpha = 0.72 - f * 0.4; ctx.fillStyle = fogMix("#ffffff", f);
      ctx.beginPath();
      ctx.arc(sx, sy - size * 0.4, size * 0.28, 0, TAU);
      ctx.arc(sx + size * 0.24, sy - size * 0.42, size * 0.2, 0, TAU);
      ctx.arc(sx - size * 0.22, sy - size * 0.38, size * 0.18, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = fogMix("#7fe8ff", f);
      ctx.beginPath();
      ctx.moveTo(sx, sy - size * 0.7); ctx.lineTo(sx + size * 0.16, sy - size * 0.2);
      ctx.lineTo(sx, sy); ctx.lineTo(sx - size * 0.16, sy - size * 0.2); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---- racers --------------------------------------------------------- */
  // Rivals are placed using the road segments already projected this frame, so
  // they sit exactly on the ribbon through every curve and hill — no separate
  // (drifting) approximation.
  function drawRacers(basePos) {
    const you = state.player;
    if (!you) return;
    const list = [];
    let nearLabels = 0;
    for (const r of state.racers) {
      if (r === you) continue;
      let rel = r.pos - basePos;
      if (rel < -trackLength / 2) rel += trackLength;
      if (rel > trackLength / 2) rel -= trackLength;
      if (rel <= 0 || rel > (DRAW_DIST - 2) * SEG_LEN) continue; // ahead & on-screen only
      const z = ((r.pos % trackLength) + trackLength) % trackLength;
      const seg = findSegment(z);
      const s1 = seg.p1.screen, s2 = seg.p2.screen;
      if (s1.scale === undefined || s1.scale <= 0) continue;
      const frac = (z % SEG_LEN) / SEG_LEN;
      const scale = lerp(s1.scale, s2.scale, frac);
      if (scale <= 0) continue;
      const roadX = lerp(s1.x, s2.x, frac);
      const roadY = lerp(s1.y, s2.y, frac);
      const halfW = lerp(s1.w, s2.w, frac);
      const size = scale * ROAD_W * CX * 0.34;
      list.push({ r, sx: roadX + r.x * halfW, sy: roadY, size, dist: rel });
    }
    list.sort((a, b) => b.dist - a.dist);
    for (const it of list) {
      if (it.size < 3) continue;
      const label = it.size > H * 0.075 && nearLabels < 2;
      if (label) nearLabels++;
      drawChick(it.sx, it.sy - it.size * 0.9, it.size, it.r, false, label);
    }
    // player chick — the chase-cam avatar, leaning with input
    const pSize = H * 0.11;
    const px = CX + you.dx * 90 + input.steer * 26;
    const py = H - pSize * 1.15 - Math.abs(you.bob) * 6;
    drawChick(px, py, pSize, you, true, false);
  }

  function drawChick(x, y, r, racer, isPlayer, showLabel) {
    if (r < 2) return;
    const roll = racer.rollPhase || 0;
    const body = racer.chick.body, accent = racer.chick.accent;

    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.92, r * 0.85, r * 0.28, 0, 0, TAU); ctx.fill();

    if (racer.boost > 0) {
      ctx.globalAlpha = 0.5;
      const aur = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 1.5);
      aur.addColorStop(0, "#ffe98a"); aur.addColorStop(1, "#ffe98a00");
      ctx.fillStyle = aur; ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
    const bg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.2, x, y, r * 1.1);
    bg.addColorStop(0, lighten(body, 22)); bg.addColorStop(1, body);
    ctx.fillStyle = bg; ctx.fillRect(x - r, y - r, r * 2, r * 2);

    const spin = Math.sin(roll) * r * 0.25;
    ctx.fillStyle = lighten(body, 30);
    ctx.beginPath(); ctx.ellipse(x + spin, y + r * 0.28, r * 0.55, r * 0.42, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.ellipse(x - r * 0.5 + spin * 0.4, y + r * 0.05, r * 0.3, r * 0.5, -0.5, 0, TAU); ctx.fill();

    const fx = x + r * 0.18, fy = y - r * 0.18;
    ctx.fillStyle = "#20242e";
    ctx.beginPath(); ctx.arc(fx - r * 0.02, fy, r * 0.12, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(fx + r * 0.34, fy, r * 0.12, 0, TAU); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(fx - r * 0.05, fy - r * 0.04, r * 0.04, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(fx + r * 0.31, fy - r * 0.04, r * 0.04, 0, TAU); ctx.fill();
    ctx.fillStyle = "#ff9e2c";
    ctx.beginPath();
    ctx.moveTo(fx + r * 0.14, fy + r * 0.16); ctx.lineTo(fx + r * 0.32, fy + r * 0.22);
    ctx.lineTo(fx + r * 0.14, fy + r * 0.3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,120,140,0.5)";
    ctx.beginPath(); ctx.arc(fx - r * 0.12, fy + r * 0.2, r * 0.09, 0, TAU); ctx.fill();

    ctx.strokeStyle = accent; ctx.lineWidth = r * 0.08; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.72); ctx.lineTo(x - r * 0.06, y - r * 0.95);
    ctx.moveTo(x + r * 0.06, y - r * 0.72); ctx.lineTo(x + r * 0.12, y - r * 0.96);
    ctx.stroke();

    ctx.globalAlpha = 0.22; ctx.fillStyle = "#ffffff";
    const streak = (roll % TAU) / TAU;
    ctx.fillRect(x - r + streak * r * 2, y - r, r * 0.16, r * 2);
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath(); ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.22, r * 0.12, -0.7, 0, TAU); ctx.fill();

    if (!isPlayer && showLabel) {
      const fs = clamp(Math.round(r * 0.4), 11, 20);
      ctx.font = `800 ${fs}px system-ui`;
      ctx.textAlign = "center";
      const tw = ctx.measureText(racer.chick.name).width;
      ctx.fillStyle = "rgba(10,7,16,0.6)";
      roundRect(x - tw / 2 - 7, y - r * 1.5, tw + 14, fs + 8, 7); ctx.fill();
      ctx.fillStyle = "#fff6ea";
      ctx.fillText(racer.chick.name, x, y - r * 1.5 + fs);
    }
  }

  /* ---- HUD ------------------------------------------------------------ */
  function drawHUD() {
    if (state.phase === "title" || state.phase === "setup") return;
    const you = state.player;
    if (!you) return;
    ctx.textAlign = "left";

    const pos = you.place || 1, total = state.racers.length;
    hudPill(16, 16, 132, 52);
    ctx.fillStyle = "#ffd23f"; ctx.font = "1000 30px system-ui";
    ctx.fillText(ordinal(pos), 26, 52);
    ctx.fillStyle = "#a9b8b3"; ctx.font = "800 12px ui-monospace, monospace";
    ctx.fillText("/ " + total, 26 + ctx.measureText(ordinal(pos)).width + 8, 51);

    hudPill(W - 150, 16, 134, 52);
    ctx.fillStyle = "#effff7"; ctx.font = "900 13px ui-monospace, monospace";
    ctx.fillText("LAP", W - 138, 36);
    ctx.font = "1000 26px system-ui";
    ctx.fillText(`${clamp(you.lap + 1, 1, LAPS)}/${LAPS}`, W - 138, 60);

    ctx.textAlign = "center";
    ctx.fillStyle = "#effff7"; ctx.font = "900 20px ui-monospace, monospace";
    ctx.fillText(fmtTime(state.raceTime), CX, 40);

    drawFlow(you);
    drawMinimap();

    if (you.flow >= 1 && state.phase === "racing") {
      ctx.textAlign = "center";
      ctx.globalAlpha = 0.6 + Math.sin(nowMs() / 150) * 0.3;
      ctx.fillStyle = "#8f7bff"; ctx.font = "900 14px ui-monospace, monospace";
      ctx.fillText("FLOW READY — SPACE TO BURST", CX, H - 20);
      ctx.globalAlpha = 1;
    }

    if (state.phase === "countdown") {
      ctx.textAlign = "center";
      const go = state.countdown <= 0.35;
      ctx.fillStyle = go ? "#41ffa1" : "#fff";
      ctx.font = "1000 130px system-ui";
      ctx.fillText(go ? "GO!" : String(Math.max(1, Math.ceil(state.countdown - 0.2))), CX, CY + 40);
    }
  }
  function hudPill(x, y, w, h) {
    ctx.fillStyle = "rgba(6,10,16,0.62)"; roundRect(x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1; roundRect(x, y, w, h, 12); ctx.stroke();
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawFlow(you) {
    const x = 16, y = H - 74, w = 190, h = 54;
    hudPill(x, y, w, h);
    ctx.textAlign = "left";
    ctx.fillStyle = "#effff7"; ctx.font = "1000 22px system-ui";
    ctx.fillText(String(Math.round((you.speed / MAXSPEED) * 240)), x + 12, y + 34);
    ctx.fillStyle = "#a9b8b3"; ctx.font = "800 10px ui-monospace, monospace";
    ctx.fillText("KM/H", x + 12, y + 46);
    const bx = x + 74, bw = w - 90;
    ctx.fillStyle = "rgba(255,255,255,0.12)"; roundRect(bx, y + 14, bw, 12, 6); ctx.fill();
    const grd = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grd.addColorStop(0, "#41ffa1"); grd.addColorStop(1, "#8f7bff");
    ctx.fillStyle = grd; roundRect(bx, y + 14, bw * clamp(you.flow, 0, 1), 12, 6); ctx.fill();
    ctx.fillStyle = "#8fa0ac"; ctx.font = "800 9px ui-monospace, monospace";
    ctx.fillText("FLOW", bx, y + 45);
    if (you.slip > 0) { ctx.fillStyle = "#1ef0ff"; ctx.fillText("DRAFT", bx + 44, y + 45); }
  }
  function drawMinimap() {
    if (!miniPath.length) return;
    const size = 116, pad = 16;
    const ox = W - size - pad, oy = H - size - pad;
    ctx.fillStyle = "rgba(6,10,16,0.55)"; roundRect(ox - 8, oy - 8, size + 16, size + 16, 12); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 3; ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < miniPath.length; i += 2) {
      const p = miniPath[i], sx = ox + p.x * size, sy = oy + p.y * size;
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath(); ctx.stroke();
    for (const r of state.racers) {
      const idx = Math.floor(findPct(r) * miniPath.length) % miniPath.length;
      const p = miniPath[idx]; if (!p) continue;
      ctx.fillStyle = r.human ? "#41ffa1" : r.chick.body;
      ctx.beginPath(); ctx.arc(ox + p.x * size, oy + p.y * size, r.human ? 5 : 3.5, 0, TAU); ctx.fill();
      if (r.human) { ctx.strokeStyle = "#05231a"; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
  }
  function ordinal(n) { const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function fmtTime(t) { const m = Math.floor(t / 60), s = t % 60; return `${m}:${s.toFixed(2).padStart(5, "0")}`; }

  /* ---- audio ---------------------------------------------------------- */
  const AudioSys = (() => {
    let ac = null, on = true, master = null;
    function ensure() {
      if (ac) return;
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0.18; master.connect(ac.destination); } catch (_) { ac = null; }
    }
    function blip(freq, dur, type = "triangle") {
      if (!on) return; ensure(); if (!ac) return;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.5, ac.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g); g.connect(master); o.start(); o.stop(ac.currentTime + dur + 0.02);
    }
    function fanfare() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.18, "square"), i * 120)); }
    return { blip, fanfare, setOn(v) { on = v; }, toggle() { on = !on; return on; }, resume() { ensure(); if (ac && ac.state === "suspended") ac.resume(); } };
  })();

  /* ==================================================================== */
  /* FLOW + OVERLAYS                                                       */
  /* ==================================================================== */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const titleOverlay = $("[data-title-overlay]");
  const startOverlay = $("[data-start-overlay]");
  const pauseOverlay = $("[data-pause-overlay]");
  const finishOverlay = $("[data-finish-overlay]");
  const touchControls = $("[data-touch-controls]");

  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function hideAllOverlays() { [titleOverlay, startOverlay, pauseOverlay, finishOverlay].forEach(hide); }
  function goTitle() { state.phase = "title"; hideAllOverlays(); show(titleOverlay); }
  function goSetup() { state.phase = "setup"; hideAllOverlays(); show(startOverlay); }

  function startFromSetup() {
    AudioSys.resume();
    hideAllOverlays();
    if (state.mode === "cup") {
      state.cup = { round: 0, tracks: TRACK_ORDER.slice(), points: {} };
      state.trackKey = state.cup.tracks[0];
    } else state.cup = null;
    resetRace();
    if ("ontouchstart" in window) show(touchControls);
  }

  const POINTS = [10, 7, 5, 3, 2, 1, 0, 0];
  function endRace() {
    state.phase = "finished";
    const order = state.finishOrder.length ? state.finishOrder.slice() : computePositions();
    if (state.cup) order.forEach((r, i) => { state.cup.points[r.chick.name] = (state.cup.points[r.chick.name] || 0) + (POINTS[i] || 0); });
    const you = state.player;
    if (state.cup && state.cup.round < state.cup.tracks.length - 1) {
      host("progress", { progress: Math.round(((state.cup.round + 1) / state.cup.tracks.length) * 100), score: (you ? state.cup.points[you.chick.name] : 0) * 10, state: raceSnapshot() });
    } else {
      host("complete", { progress: 100, score: you ? Math.max(0, (state.racers.length + 1 - (you.place || state.racers.length))) * 100 : 0, state: raceSnapshot() });
    }
    renderResults(order);
    show(finishOverlay);
  }
  function nextCupRace() {
    if (!state.cup) return;
    state.cup.round++;
    if (state.cup.round >= state.cup.tracks.length) { state.cup = null; goSetup(); return; }
    state.trackKey = state.cup.tracks[state.cup.round];
    hideAllOverlays();
    resetRace();
  }
  function renderResults(order) {
    const title = $("[data-finish-title]"), sub = $("[data-finish-track]"), standings = $("[data-standings]"), nextBtn = $("[data-next-btn]");
    const you = state.player;
    const cupDone = state.cup && state.cup.round >= state.cup.tracks.length - 1;
    if (title) title.textContent = state.cup ? (cupDone ? "Grand Prix Cup — Final" : `Round ${state.cup.round + 1} of ${state.cup.tracks.length}`) : (you && you.place === 1 ? "You Win!" : "Race Finished");
    if (sub) sub.textContent = theme.name + (you ? ` · You finished ${ordinal(you.place || 1)}` : "");
    const rows = state.cup ? cupStandings() : order.map((r) => ({ name: r.chick.name, body: r.chick.body, human: r.human, place: r.place, time: r.finishTime }));
    if (standings) {
      standings.innerHTML = rows.map((r, i) => {
        const place = state.cup ? i + 1 : r.place;
        const podium = place <= 3 ? ` podium-${place}` : "";
        const right = state.cup ? `<span class="standing-pts">${r.points} pts</span>` : (r.time ? `<span class="standing-cup">${fmtTime(r.time)}</span>` : "");
        return `<div class="standing-row${r.human ? " is-you" : ""}${podium}"><span class="standing-place">${place}</span><span class="standing-dot" style="background:${r.body}"></span><span class="standing-name">${r.name}${r.human ? " (You)" : ""}</span>${right}</div>`;
      }).join("");
    }
    if (nextBtn) nextBtn.hidden = !(state.cup && state.cup.round < state.cup.tracks.length - 1);
  }
  function cupStandings() {
    const pts = state.cup.points;
    return Object.keys(pts).map((name) => {
      const chick = CHICKS.find((c) => c.name === name) || { body: "#fff" };
      const racer = state.racers.find((r) => r.chick.name === name);
      return { name, body: chick.body, human: racer ? racer.human : false, points: pts[name] };
    }).sort((a, b) => b.points - a.points);
  }

  function togglePause() {
    if (state.phase === "racing") { state.phase = "paused"; show(pauseOverlay); }
    else if (state.phase === "paused") { state.phase = "racing"; hide(pauseOverlay); }
  }
  function setHostPaused(p) {
    state.hostPaused = p;
    if (p && state.phase === "racing") { state.phase = "paused"; show(pauseOverlay); }
  }

  /* ---- overlay wiring ------------------------------------------------- */
  const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener("click", fn); };
  on("[data-play-btn]", () => { AudioSys.resume(); goSetup(); });
  on("[data-title-btn]", goTitle);
  on("[data-start-btn]", startFromSetup);
  on("[data-resume-btn]", () => { state.phase = "racing"; hide(pauseOverlay); });
  on("[data-restart-btn]", () => { hideAllOverlays(); resetRace(); });
  on("[data-next-btn]", () => { hideAllOverlays(); nextCupRace(); });
  on("[data-menu-btn]", () => { state.cup = null; goSetup(); });
  $$("[data-track]").forEach((b) => b.addEventListener("click", () => {
    state.trackKey = b.dataset.track;
    $$("[data-track]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    buildTrack(state.trackKey);
  }));
  $$("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    $$("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  $$("[data-track]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.track === state.trackKey)));
  $$("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.mode === state.mode)));

  /* ---- touch ---------------------------------------------------------- */
  function bindTouch() {
    $$("[data-touch]").forEach((btn) => {
      const k = btn.dataset.touch;
      const down = (e) => { e.preventDefault(); if (k === "left") input.touchSteer = -1; else if (k === "right") input.touchSteer = 1; else if (k === "boost") input.touchBoost = true; AudioSys.resume(); };
      const up = (e) => { if (e) e.preventDefault(); if (k === "left" || k === "right") input.touchSteer = 0; else if (k === "boost") input.touchBoost = false; };
      btn.addEventListener("touchstart", down, { passive: false });
      btn.addEventListener("touchend", up, { passive: false });
      btn.addEventListener("touchcancel", up, { passive: false });
      btn.addEventListener("mousedown", down);
      window.addEventListener("mouseup", () => up());
    });
    let dragId = null, dragX = 0;
    canvas.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; dragId = t.identifier; dragX = t.clientX; }, { passive: true });
    canvas.addEventListener("touchmove", (e) => {
      for (const t of e.changedTouches) if (t.identifier === dragId) input.touchSteer = clamp((t.clientX - dragX) / 60, -1, 1);
    }, { passive: true });
    canvas.addEventListener("touchend", () => { dragId = null; input.touchSteer = 0; }, { passive: true });
  }
  bindTouch();

  /* ---- host protocol -------------------------------------------------- */
  window.addEventListener("message", (evt) => {
    const d = evt.data;
    if (!d || d.source !== "phantomplay-host") return;
    if (d.type === "settings") {
      reducedMotion = !!d.reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (typeof d.sound === "boolean") AudioSys.setOn(d.sound);
    } else if (d.type === "pause") setHostPaused(true);
    else if (d.type === "resume") setHostPaused(false);
    else if (d.type === "restart") { hideAllOverlays(); if (state.phase === "title" || state.phase === "setup") goTitle(); else resetRace(); }
    else if (d.type === "exit") setHostPaused(true);
    else if (d.type === "restore" || d.type === "load-state") {
      const s = d.state;
      if (s && THEMES[s.track]) { state.trackKey = s.track; buildTrack(s.track); $$("[data-track]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.track === s.track))); }
    }
  });

  /* ---- main loop ------------------------------------------------------ */
  let last = nowMs();
  function frame(t) {
    let dt = (t - last) / 1000; last = t;
    dt = Math.min(dt, 1 / 20);
    if ((state.phase === "racing" || state.phase === "countdown") && !state.hostPaused) update(dt);
    render();
    requestAnimationFrame(frame);
  }

  buildTrack(state.trackKey);
  goTitle();
  requestAnimationFrame(frame);
  host("ready");

  /* ---- test hook (automation only) ------------------------------------ */
  window.__ChickletTest = {
    start(mode = "single", track = "meadow") { state.mode = mode; state.trackKey = track; startFromSetup(); state.countdown = 0; state.phase = "racing"; },
    tick(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) update(dt); },
    state,
    positions: computePositions,
    forceFinish() { for (const r of state.racers) if (!r.finished) r.pos = trackLength * LAPS + 10; update(1 / 60); },
  };
})();
