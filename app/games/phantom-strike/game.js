/* Phantom Strike — first-person vault-defense shooter for PhantomPlay.
 *
 * A real 3D view from a raycast engine (textured walls, distance fog,
 * z-buffered billboard sprites) rendered to canvas — no external assets,
 * no libraries, everything procedural, per the platform's sandbox CSP.
 *
 * Platform contract (see starter-template.html and skyguard-arena):
 *   host('ready') once · host('score'|'progress') during play ·
 *   host('complete') EXACTLY once per run · honors settings
 *   {sound, reducedMotion} · pauses on tab-hide · keyboard AND touch ·
 *   responsive to 360px. Adds full gamepad support (left stick move,
 *   right stick aim, RT/A fire, LB/RB weapons, Start pause) — the
 *   PhantomPlay player grants the Gamepad API via its iframe allow list.
 *
 * Perf discipline: fixed 60Hz simulation decoupled from render; typed
 * arrays for the depth buffer; textures painted once to offscreen
 * canvases; pooled projectiles/particles/draw-list entries; gradients
 * cached on resize; HUD DOM rebuilt only when its content changes. The
 * remaining per-frame allocations are transient rgba() strings on
 * flash/damage frames only.
 */
(function () {
  "use strict";

  /* ================= host bridge ================= */
  const embedded = window.parent !== window;
  const host = (type, data = {}) => { if (embedded) parent.postMessage({ source: "phantomplay-game", type, ...data }, "*"); };
  let soundOn = true, reduced = false;
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.source !== "phantomplay-host") return;
    if (d.type === "settings") {
      soundOn = d.sound !== false;
      reduced = !!d.reducedMotion;
      syncMuteButton();
    }
    if (d.type === "pause") setPaused(true, false);
    if (d.type === "resume") setPaused(false, false);
  });

  /* ================= audio (tiny synth) ================= */
  let audioCtx = null;
  function blip(freq, dur = 0.09, type = "square", gain = 0.05, slide = 0) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, audioCtx.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), audioCtx.currentTime + dur);
      g.gain.setValueAtTime(gain, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur + 0.02);
    } catch {}
  }
  const sfx = {
    pulse: () => blip(880, 0.07, "square", 0.045, -400),
    scatter: () => { blip(220, 0.12, "sawtooth", 0.06, -80); blip(180, 0.1, "square", 0.04, -60); },
    lance: () => blip(1400, 0.22, "sawtooth", 0.05, -1100),
    hit: () => blip(160, 0.06, "triangle", 0.06, -40),
    kill: () => blip(520, 0.16, "triangle", 0.06, -320),
    hurt: () => blip(90, 0.2, "sawtooth", 0.08, -30),
    pickup: () => { blip(660, 0.08, "sine", 0.05); blip(990, 0.1, "sine", 0.05); },
    wave: () => { blip(330, 0.22, "square", 0.05); blip(440, 0.3, "square", 0.05, 120); },
    empty: () => blip(120, 0.05, "square", 0.03),
  };

  /* ================= map ================= */
  /* 24x24 vault. 0 empty · 1 vault plate · 2 circuit panel · 3 conduit
     glow · 4 core door (solid, decorative). Hand-laid: central core room,
     four spoke corridors, pillar arena ring, spawn alcoves in corners. */
  const MAP_W = 24, MAP_H = 24;
  const M = [
    "111111111111111111111111",
    "100000000000000000000001",
    "102220011100011100222001",
    "102000000000000000002001",
    "102001110033330011100201",
    "100001000000000000100001",
    "101001003000000300100101",
    "101000003000000300000101",
    "100000000011110000000001",
    "100300000010010000003001",
    "100300000010010000003001",
    "100000000010010000000001",
    "100000000010010000000001",
    "100300000014410000003001",
    "100300000000000000003001",
    "100000000000000000000001",
    "101000003000000300000101",
    "101001003000000300100101",
    "100001000000000000100001",
    "102001110033330011100201",
    "102000000000000000002001",
    "102220011100011100222001",
    "100000000000000000000001",
    "111111111111111111111111",
  ].map((row) => row.split("").map(Number));
  const cell = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? 1 : M[y][x]);
  const solid = (x, y) => cell(Math.floor(x), Math.floor(y)) > 0;

  /* ================= procedural textures ================= */
  const TEX = 64;
  function makeTexture(paint) {
    const c = document.createElement("canvas");
    c.width = TEX; c.height = TEX;
    const g = c.getContext("2d");
    paint(g);
    return g.getImageData(0, 0, TEX, TEX);
  }
  const noise = (g, base, amp, step = 2) => {
    for (let y = 0; y < TEX; y += step) for (let x = 0; x < TEX; x += step) {
      const v = base + (Math.random() - 0.5) * amp;
      g.fillStyle = `rgb(${v | 0},${(v * 1.6) | 0},${(v * 1.15) | 0})`;
      g.fillRect(x, y, step, step);
    }
  };
  const textures = [
    null,
    makeTexture((g) => { // 1: vault plate
      noise(g, 26, 10);
      g.strokeStyle = "rgba(10,50,32,.9)"; g.lineWidth = 2;
      g.strokeRect(3, 3, TEX - 6, TEX - 6);
      g.strokeStyle = "rgba(90,220,160,.20)";
      g.strokeRect(6, 6, TEX - 12, TEX - 12);
      g.fillStyle = "rgba(90,220,160,.35)";
      for (const [x, y] of [[8, 8], [TEX - 10, 8], [8, TEX - 10], [TEX - 10, TEX - 10]]) g.fillRect(x, y, 3, 3);
    }),
    makeTexture((g) => { // 2: circuit panel
      noise(g, 20, 8);
      g.strokeStyle = "rgba(65,255,161,.45)"; g.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        g.beginPath();
        let x = 4 + Math.random() * 24, y = 6 + i * 8;
        g.moveTo(x, y);
        for (let s = 0; s < 3; s++) { x += 6 + Math.random() * 14; g.lineTo(x, y); y += (Math.random() < 0.5 ? -1 : 1) * 6; g.lineTo(x, y); }
        g.stroke();
        g.fillStyle = "rgba(65,255,161,.8)"; g.fillRect(x - 1, y - 1, 3, 3);
      }
    }),
    makeTexture((g) => { // 3: conduit glow column
      noise(g, 16, 6);
      const grad = g.createLinearGradient(0, 0, TEX, 0);
      grad.addColorStop(0, "rgba(65,255,161,0)");
      grad.addColorStop(0.5, "rgba(65,255,161,.55)");
      grad.addColorStop(1, "rgba(65,255,161,0)");
      g.fillStyle = grad; g.fillRect(TEX / 2 - 10, 0, 20, TEX);
      g.fillStyle = "rgba(240,255,248,.9)";
      g.fillRect(TEX / 2 - 1, 0, 2, TEX);
      for (let y = 6; y < TEX; y += 12) g.fillRect(TEX / 2 - 5, y, 10, 2);
    }),
    makeTexture((g) => { // 4: core door
      noise(g, 22, 8);
      g.strokeStyle = "rgba(255,209,102,.6)"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(TEX / 2, 4); g.lineTo(TEX - 4, TEX / 2); g.lineTo(TEX / 2, TEX - 4); g.lineTo(4, TEX / 2); g.closePath(); g.stroke();
      g.strokeStyle = "rgba(255,209,102,.25)";
      g.strokeRect(2, 2, TEX - 4, TEX - 4);
    }),
  ];

  /* Sprite art: painted once per type at 96px, original hooded-wisp
     silhouettes in three tints + pickup cells. */
  const SPR = 96;
  function makeSprite(paint) {
    const c = document.createElement("canvas");
    c.width = SPR; c.height = SPR;
    paint(c.getContext("2d"));
    return c;
  }
  function paintWisp(g, tint, eye, tatter) {
    const cx = SPR / 2;
    g.translate(cx, SPR * 0.54);
    const s = SPR * 0.30;
    const grd = g.createRadialGradient(0, -s * 0.4, s * 0.1, 0, 0, s * 1.5);
    grd.addColorStop(0, tint[0]); grd.addColorStop(1, tint[1]);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(-s * 0.9, s * 0.8);
    g.bezierCurveTo(-s * 1.15, -s * 0.4, -s * 0.62, -s * 1.35, 0, -s * 1.35);
    g.bezierCurveTo(s * 0.62, -s * 1.35, s * 1.15, -s * 0.4, s * 0.9, s * 0.8);
    for (let i = 0; i < tatter; i++) {
      const x1 = s * 0.9 - (i * 1.8 * s) / tatter, x2 = s * 0.9 - ((i + 1) * 1.8 * s) / tatter;
      g.quadraticCurveTo((x1 + x2) / 2, s * (1.05 + (i % 2) * 0.12), x2, s * 0.8);
    }
    g.closePath(); g.fill();
    // hood shadow
    g.fillStyle = "rgba(0,0,0,.55)";
    g.beginPath(); g.ellipse(0, -s * 0.55, s * 0.52, s * 0.42, 0, 0, Math.PI * 2); g.fill();
    // eyes
    g.fillStyle = eye;
    g.shadowColor = eye; g.shadowBlur = 8;
    g.beginPath(); g.ellipse(-s * 0.2, -s * 0.55, s * 0.09, s * 0.13, -0.25, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(s * 0.2, -s * 0.55, s * 0.09, s * 0.13, 0.25, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
  }
  const sprites = {
    drifter: makeSprite((g) => paintWisp(g, ["rgba(120,255,190,.95)", "rgba(10,60,36,.85)"], "#eaffff", 5)),
    spitter: makeSprite((g) => paintWisp(g, ["rgba(140,220,255,.95)", "rgba(8,40,60,.85)"], "#9df", 4)),
    warden: makeSprite((g) => { paintWisp(g, ["rgba(255,220,140,.95)", "rgba(70,40,4,.9)"], "#ffd166", 6); }),
    bolt: makeSprite((g) => {
      g.translate(SPR / 2, SPR / 2);
      const grd = g.createRadialGradient(0, 0, 2, 0, 0, 16);
      grd.addColorStop(0, "#eaffff"); grd.addColorStop(0.5, "#6ec9ff"); grd.addColorStop(1, "rgba(110,201,255,0)");
      g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 16, 0, Math.PI * 2); g.fill();
    }),
    health: makeSprite((g) => {
      g.translate(SPR / 2, SPR / 2);
      g.fillStyle = "rgba(65,255,161,.18)"; g.beginPath(); g.arc(0, 8, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#41ffa1"; g.shadowColor = "#41ffa1"; g.shadowBlur = 10;
      g.fillRect(-4, -6 + 8, 8, 22 - 10); g.fillRect(-11, 1 + 8 - 4, 22, 8);
      g.shadowBlur = 0;
    }),
    ammo: makeSprite((g) => {
      g.translate(SPR / 2, SPR / 2 + 8);
      g.fillStyle = "rgba(255,209,102,.18)"; g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#ffd166"; g.shadowColor = "#ffd166"; g.shadowBlur = 10;
      for (let i = -1; i <= 1; i++) { g.fillRect(i * 9 - 2.5, -12, 5, 18); g.beginPath(); g.arc(i * 9, -12, 2.5, Math.PI, 0); g.fill(); }
      g.shadowBlur = 0;
    }),
  };

  /* ================= weapons ================= */
  const WEAPONS = [
    { id: "pulse", label: "1 PULSE", dmg: 34, cooldown: 0.22, spread: 0.012, pellets: 1, ammo: Infinity, range: 24, sfx: sfx.pulse, color: "#41ffa1" },
    { id: "scatter", label: "2 SCATTER", dmg: 16, cooldown: 0.75, spread: 0.11, pellets: 6, ammo: 24, range: 9, sfx: sfx.scatter, color: "#ffd166" },
    { id: "lance", label: "3 LANCE", dmg: 120, cooldown: 1.05, spread: 0, pellets: 1, ammo: 10, range: 30, pierce: true, sfx: sfx.lance, color: "#1ef0ff" },
  ];

  /* ================= waves ================= */
  const SPAWNS = [[1.5, 2.5], [21.5, 2.5], [1.5, 21.5], [21.5, 21.5], [12, 2.5], [12, 21.5], [2.5, 12], [21.5, 12]];
  const WAVES = [
    { drifter: 4, spitter: 0, warden: 0 },
    { drifter: 5, spitter: 2, warden: 0 },
    { drifter: 6, spitter: 4, warden: 0 },
    { drifter: 7, spitter: 5, warden: 1 },
    { drifter: 8, spitter: 6, warden: 2 },
  ];
  const ENEMY = {
    drifter: { hp: 60, speed: 1.55, radius: 0.30, touchDmg: 12, score: 100, scale: 1.0, sprite: "drifter" },
    spitter: { hp: 45, speed: 1.15, radius: 0.30, touchDmg: 8, score: 150, shootEvery: 2.2, boltSpeed: 3.6, boltDmg: 10, scale: 0.92, sprite: "spitter" },
    warden: { hp: 420, speed: 0.95, radius: 0.42, touchDmg: 26, score: 600, shootEvery: 1.6, boltSpeed: 4.2, boltDmg: 14, scale: 1.35, sprite: "warden" },
  };

  /* ================= state ================= */
  const state = {
    phase: "start", // start | playing | paused | dead | won
    px: 12, py: 16.5, ang: -Math.PI / 2,
    hp: 100, weapon: 0, ammo: [Infinity, 24, 10],
    cooldown: 0, kills: 0, shotsFired: 0, shotsHit: 0, score: 0,
    wave: 0, waveTotal: 0, spawnQueue: [], spawnTimer: 0,
    enemies: [], bolts: [], pickups: [], particles: [],
    bob: 0, flash: 0, hurtFlash: 0, hitMark: 0, shake: 0,
    completeSent: false, muted: false,
    time: 0,
  };

  /* pools */
  function takeFrom(pool, factory) { return pool.length ? pool.pop() : factory(); }
  const boltPool = [], particlePool = [];
  const newBolt = () => ({ x: 0, y: 0, vx: 0, vy: 0, dmg: 0, alive: false });
  const newParticle = () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, color: "", alive: false });

  function spawnParticleBurst(x, y, color, n = 6) {
    if (reduced) n = Math.min(2, n);
    for (let i = 0; i < n; i++) {
      const p = takeFrom(particlePool, newParticle);
      const a = Math.random() * Math.PI * 2, s = 0.5 + Math.random() * 2;
      p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.max = p.life = 0.35 + Math.random() * 0.3; p.color = color; p.alive = true;
      state.particles.push(p);
    }
  }

  /* ================= run lifecycle ================= */
  function resetRun() {
    state.px = 12; state.py = 16.5; state.ang = -Math.PI / 2;
    state.hp = 100; state.weapon = 0; state.ammo = [Infinity, 24, 10];
    state.cooldown = 0; state.kills = 0; state.shotsFired = 0; state.shotsHit = 0; state.score = 0;
    state.wave = 0; state.spawnQueue = []; state.spawnTimer = 0;
    for (const b of state.bolts) boltPool.push(b);
    for (const p of state.particles) particlePool.push(p);
    state.enemies = []; state.bolts = []; state.pickups = []; state.particles = [];
    state.flash = 0; state.hurtFlash = 0; state.shake = 0;
    state.completeSent = false; state.time = 0;
    startWave(0);
    host("progress", { progress: 0, state: { wave: 1 } });
  }

  function startWave(i) {
    state.wave = i;
    const spec = WAVES[i];
    state.spawnQueue = [];
    for (const kind of ["drifter", "spitter", "warden"]) for (let n = 0; n < spec[kind]; n++) state.spawnQueue.push(kind);
    // shuffle so types interleave
    for (let a = state.spawnQueue.length - 1; a > 0; a--) { const b = (Math.random() * (a + 1)) | 0; [state.spawnQueue[a], state.spawnQueue[b]] = [state.spawnQueue[b], state.spawnQueue[a]]; }
    state.waveTotal = state.spawnQueue.length;
    state.spawnTimer = 0.5;
    // supply drop between waves
    if (i > 0) {
      dropPickup("health"); dropPickup("ammo"); dropPickup("ammo");
    }
    sfx.wave();
    toast(`WAVE ${i + 1}${i === WAVES.length - 1 ? " — THE WARDENS" : ""}`);
    syncHud();
  }

  function dropPickup(kind) {
    for (let tries = 0; tries < 40; tries++) {
      const x = 2 + Math.random() * (MAP_W - 4), y = 2 + Math.random() * (MAP_H - 4);
      if (!solid(x, y) && Math.hypot(x - state.px, y - state.py) > 3) { state.pickups.push({ kind, x, y }); return; }
    }
  }

  /* a body that starts inside a solid cell can never be extracted by the
     collision snap, rendered, or hit — so every spawn must be an open cell */
  function openNear(x, y) {
    if (!solid(x, y)) return [x, y];
    for (let r = 1; r <= 3; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      const nx = Math.floor(x) + ox + 0.5, ny = Math.floor(y) + oy + 0.5;
      if (nx > 0 && ny > 0 && nx < MAP_W && ny < MAP_H && !solid(nx, ny)) return [nx, ny];
    }
    return [12, 15.5];
  }

  function spawnEnemy(kind) {
    // farthest spawn points from the player first, so waves come from depth
    const sorted = SPAWNS.slice().sort((a, b) => Math.hypot(b[0] - state.px, b[1] - state.py) - Math.hypot(a[0] - state.px, a[1] - state.py));
    const [sx, sy] = openNear(...sorted[(Math.random() * Math.min(4, sorted.length)) | 0]);
    const def = ENEMY[kind];
    state.enemies.push({ kind, x: sx, y: sy, hp: def.hp, cooldown: 1 + Math.random(), stagger: 0, alive: true, drift: Math.random() * Math.PI * 2 });
  }

  /* ================= combat ================= */
  function fire() {
    if (state.phase !== "playing" || state.cooldown > 0) return;
    const w = WEAPONS[state.weapon];
    if (state.ammo[state.weapon] <= 0) { state.cooldown = 0.3; sfx.empty(); toast("OUT — PULSE IS INFINITE"); return; }
    state.cooldown = w.cooldown;
    if (state.ammo[state.weapon] !== Infinity) state.ammo[state.weapon]--;
    state.shotsFired += w.pellets; // per-pellet, so scatter accuracy stays 0-100%
    state.flash = reduced ? 0.04 : 0.09;
    state.shake = reduced ? 0 : Math.min(0.5, state.shake + (w.pellets > 1 ? 0.35 : 0.15));
    w.sfx();
    let hitAny = false;
    for (let p = 0; p < w.pellets; p++) {
      const a = state.ang + (Math.random() - 0.5) * 2 * w.spread;
      hitAny = castShot(a, w) || hitAny;
    }
    if (hitAny) { state.hitMark = 0.12; }
    syncHud();
  }

  function castShot(angle, w) {
    // walk the ray; collect enemy hits before the wall
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let wallDist = w.range;
    { // cheap wall limit via fine stepping (shots only, not rendering)
      let x = state.px, y = state.py;
      for (let t = 0; t < w.range; t += 0.05) {
        x += dx * 0.05; y += dy * 0.05;
        if (solid(x, y)) { wallDist = t; break; }
      }
    }
    let hit = false;
    const targets = state.enemies
      .map((e) => {
        if (!e.alive) return null; // a corpse killed by an earlier pellet this trigger pull
        const ex = e.x - state.px, ey = e.y - state.py;
        const along = ex * dx + ey * dy;
        if (along < 0.2 || along > wallDist) return null;
        const perp = Math.abs(ex * dy - ey * dx);
        const def = ENEMY[e.kind];
        return perp < def.radius + 0.12 ? { e, along } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.along - b.along);
    for (const t of targets) {
      damageEnemy(t.e, w.dmg);
      spawnParticleBurst(t.e.x, t.e.y, w.color, 5);
      hit = true;
      if (!w.pierce) break;
    }
    if (hit) state.shotsHit++;
    return hit;
  }

  function damageEnemy(e, dmg) {
    e.hp -= dmg;
    e.stagger = 0.15;
    sfx.hit();
    if (e.hp <= 0 && e.alive) {
      e.alive = false;
      const def = ENEMY[e.kind];
      state.kills++;
      state.score += def.score;
      sfx.kill();
      spawnParticleBurst(e.x, e.y, "#41ffa1", 12);
      if (Math.random() < 0.18) dropPickupAt(e.x, e.y, Math.random() < 0.5 ? "health" : "ammo");
      reportScore();
    }
  }
  function dropPickupAt(x, y, kind) { if (!solid(x, y)) state.pickups.push({ kind, x, y }); }

  function hurtPlayer(dmg) {
    if (state.phase !== "playing") return;
    state.hp -= dmg;
    state.hurtFlash = 0.5;
    state.shake = reduced ? 0 : Math.min(0.8, state.shake + 0.4);
    sfx.hurt();
    syncHud();
    if (state.hp <= 0) {
      state.hp = 0;
      state.phase = "dead";
      $("[data-dead-line]").textContent = `You held to wave ${state.wave + 1} — ${state.kills} phantoms purged, score ${state.score}.`;
      show("[data-dead-overlay]");
      document.exitPointerLock?.();
      /* a run ending in death is still a completed run for the host — send
         the terminal report directly (never through the score throttle) */
      if (!state.completeSent) {
        state.completeSent = true;
        host("complete", { score: state.score, progress: Math.round(waveProgressFraction() * 100), state: { wave: state.wave + 1, kills: state.kills, outcome: "defeat" } });
      }
    }
  }

  /* ================= simulation ================= */
  function moveWithCollision(o, nx, ny, radius) {
    if (!solid(nx + Math.sign(nx - o.x) * radius, o.y)) o.x = nx;
    else o.x = Math.sign(nx - o.x) > 0 ? Math.ceil(o.x) - radius - 0.001 : Math.floor(o.x) + radius + 0.001;
    if (!solid(o.x, ny + Math.sign(ny - o.y) * radius)) o.y = ny;
    else o.y = Math.sign(ny - o.y) > 0 ? Math.ceil(o.y) - radius - 0.001 : Math.floor(o.y) + radius + 0.001;
  }

  function lineOfSight(x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(d / 0.15);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (solid(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
    }
    return true;
  }

  const input = { fwd: 0, strafe: 0, turn: 0, firing: false };
  const playerBody = { x: 0, y: 0 };

  function simulate(dt) {
    if (state.phase !== "playing") return;
    state.time += dt;
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.hurtFlash = Math.max(0, state.hurtFlash - dt * 1.6);
    state.hitMark = Math.max(0, state.hitMark - dt);
    state.shake *= Math.pow(0.001, dt);

    /* player movement (playerBody proxies px/py through the shared
       collision helper, which mutates o.x/o.y) */
    const SPEED = 3.4;
    const mvx = Math.cos(state.ang) * input.fwd - Math.sin(state.ang) * input.strafe;
    const mvy = Math.sin(state.ang) * input.fwd + Math.cos(state.ang) * input.strafe;
    const mlen = Math.hypot(mvx, mvy) || 1;
    const norm = Math.min(1, Math.hypot(input.fwd, input.strafe));
    playerBody.x = state.px; playerBody.y = state.py;
    moveWithCollision(playerBody, state.px + (mvx / mlen) * norm * SPEED * dt, state.py + (mvy / mlen) * norm * SPEED * dt, 0.24);
    state.px = playerBody.x; state.py = playerBody.y;
    state.ang += input.turn * dt;
    state.bob = norm > 0.05 && !reduced ? state.bob + dt * 9 : 0;
    if (input.firing) fire();

    /* spawns */
    if (state.spawnQueue.length) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        spawnEnemy(state.spawnQueue.pop());
        state.spawnTimer = Math.max(0.35, 1.1 - state.wave * 0.14);
      }
    }

    /* enemies */
    for (const e of state.enemies) {
      if (!e.alive) continue;
      const def = ENEMY[e.kind];
      e.stagger = Math.max(0, e.stagger - dt);
      const distToPlayer = Math.hypot(state.px - e.x, state.py - e.y);
      const sees = lineOfSight(e.x, e.y, state.px, state.py);
      /* movement: always hunt the player — every obstacle on this map is a
         convex block, so the axis-separated slide in moveWithCollision
         rounds corners. If an enemy jams anyway (concave pocket), it takes
         a short random detour instead of pushing the wall forever. */
      e.drift += dt * 0.9;
      e.detour = Math.max(0, (e.detour || 0) - dt);
      const wob = Math.sin(e.drift) * 0.35;
      const a = e.detour > 0 && !sees
        ? e.detourAng
        : Math.atan2(state.py - e.y, state.px - e.x) + (sees ? wob * 0.4 : wob);
      const sp = def.speed * (e.stagger > 0 ? 0.25 : 1);
      if (!sees || distToPlayer > 0.7) {
        const ox = e.x, oy = e.y;
        moveWithCollision(e, e.x + Math.cos(a) * sp * dt, e.y + Math.sin(a) * sp * dt, def.radius);
        if (Math.hypot(e.x - ox, e.y - oy) < sp * dt * 0.25) {
          e.stuckT = (e.stuckT || 0) + dt;
          if (e.stuckT > 1) { e.detour = 1.2; e.detourAng = Math.random() * Math.PI * 2; e.stuckT = 0; }
        } else if (e.stuckT) e.stuckT = 0;
      }
      /* touch damage */
      if (distToPlayer < def.radius + 0.35) {
        e.cooldown -= dt;
        if (e.cooldown <= 0) { hurtPlayer(def.touchDmg); e.cooldown = 0.9; }
      } else if (def.shootEvery && sees && distToPlayer < 11) {
        e.cooldown -= dt;
        if (e.cooldown <= 0) {
          e.cooldown = def.shootEvery;
          const b = takeFrom(boltPool, newBolt);
          const ba = Math.atan2(state.py - e.y, state.px - e.x);
          b.x = e.x; b.y = e.y; b.vx = Math.cos(ba) * def.boltSpeed; b.vy = Math.sin(ba) * def.boltSpeed;
          b.dmg = def.boltDmg; b.alive = true;
          state.bolts.push(b);
        }
      }
    }
    /* sweep dead enemies (release nothing — enemy objects are per-wave) */
    if (state.enemies.some((e) => !e.alive)) state.enemies = state.enemies.filter((e) => e.alive);

    /* enemy bolts */
    for (let i = state.bolts.length - 1; i >= 0; i--) {
      const b = state.bolts[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      let gone = solid(b.x, b.y);
      if (!gone && Math.hypot(b.x - state.px, b.y - state.py) < 0.35) { hurtPlayer(b.dmg); gone = true; }
      if (gone) { b.alive = false; boltPool.push(b); state.bolts.splice(i, 1); }
    }

    /* pickups */
    for (let i = state.pickups.length - 1; i >= 0; i--) {
      const p = state.pickups[i];
      if (Math.hypot(p.x - state.px, p.y - state.py) < 0.5) {
        if (p.kind === "health") { state.hp = Math.min(100, state.hp + 25); toast("+25 CORE"); }
        else { state.ammo[1] = Math.min(48, state.ammo[1] + 8); state.ammo[2] = Math.min(20, state.ammo[2] + 3); toast("+AMMO"); }
        sfx.pickup();
        state.pickups.splice(i, 1);
        syncHud();
      }
    }

    /* particles */
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; particlePool.push(p); state.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }

    /* wave / win logic */
    if (!state.spawnQueue.length && !state.enemies.length && state.phase === "playing") {
      if (state.wave + 1 < WAVES.length) {
        startWave(state.wave + 1);
        reportProgress();
      } else if (!state.completeSent) {
        state.completeSent = true;
        state.phase = "won";
        const acc = state.shotsFired ? Math.round((state.shotsHit / state.shotsFired) * 100) : 0;
        state.score += acc * 10 + Math.round(state.hp) * 5;
        $("[data-win-line]").textContent = `${state.kills} phantoms purged · ${acc}% accuracy · score ${state.score}.`;
        show("[data-win-overlay]");
        document.exitPointerLock?.();
        host("complete", { score: state.score, progress: 100, state: { kills: state.kills, accuracy: acc, hp: Math.round(state.hp) } });
      }
    }
  }

  function waveProgressFraction() {
    const done = state.wave / WAVES.length;
    const inWave = state.waveTotal ? (state.waveTotal - state.spawnQueue.length - state.enemies.length) / state.waveTotal : 0;
    return Math.min(0.99, done + inWave / WAVES.length);
  }
  let lastReport = 0;
  function reportProgress() {
    host("progress", { progress: Math.round(waveProgressFraction() * 100), state: { wave: state.wave + 1, kills: state.kills } });
  }
  function reportScore() {
    const now = performance.now();
    if (now - lastReport < 400) return;
    lastReport = now;
    host("score", { score: state.score, progress: Math.round(waveProgressFraction() * 100), state: { wave: state.wave + 1, kills: state.kills } });
  }

  /* ================= renderer ================= */
  const view = document.getElementById("view");
  const ctx = view.getContext("2d");
  const fx = document.getElementById("hudfx");
  const fxc = fx.getContext("2d");
  let W = 0, H = 0, COLS = 0, colW = 1;
  let depth = new Float32Array(1);
  let skyGrad = null, floorGrad = null, vmGrad = null, vmFlashGrads = [];
  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    W = view.width = Math.floor(view.clientWidth * scale * 0.7);
    H = view.height = Math.floor(view.clientHeight * scale * 0.7);
    fx.width = fx.clientWidth; fx.height = fx.clientHeight;
    COLS = Math.min(W, 480);
    colW = W / COLS;
    depth = new Float32Array(COLS);
    /* gradients are size-dependent but not frame-dependent — build them here
       once instead of allocating 3+ per rendered frame (bob/shake moves the
       horizon by <1% of H, invisible against a clamped gradient) */
    skyGrad = ctx.createLinearGradient(0, 0, 0, H / 2);
    skyGrad.addColorStop(0, "#010603"); skyGrad.addColorStop(1, "#03140b");
    floorGrad = ctx.createLinearGradient(0, H / 2, 0, H);
    floorGrad.addColorStop(0, "#02130a"); floorGrad.addColorStop(1, "#051f12");
    vmGrad = ctx.createLinearGradient(0, -H * 0.24, 0, 0);
    vmGrad.addColorStop(0, "#0a2416"); vmGrad.addColorStop(1, "#123524");
    vmFlashGrads = WEAPONS.map((w) => {
      const fg = ctx.createRadialGradient(0, -H * 0.22, 2, 0, -H * 0.22, H * 0.07);
      fg.addColorStop(0, "#fff"); fg.addColorStop(0.4, w.color); fg.addColorStop(1, "rgba(0,0,0,0)");
      return fg;
    });
  }
  window.addEventListener("resize", resize);

  const FOV = Math.PI / 3;

  function render() {
    if (!W) resize();
    const bobOff = reduced ? 0 : Math.sin(state.bob) * H * 0.008;
    const shakeX = state.shake ? (Math.random() - 0.5) * state.shake * H * 0.02 : 0;
    const shakeY = state.shake ? (Math.random() - 0.5) * state.shake * H * 0.02 : 0;
    const horizon = H / 2 + bobOff + shakeY;

    /* sky + floor (gradients cached in resize) */
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, horizon);
    ctx.fillStyle = floorGrad; ctx.fillRect(0, horizon, W, H - horizon);

    /* walls via DDA */
    for (let c = 0; c < COLS; c++) {
      const camX = (2 * c) / COLS - 1;
      const rayA = state.ang + Math.atan(camX * Math.tan(FOV / 2));
      const rdx = Math.cos(rayA), rdy = Math.sin(rayA);
      let mapX = Math.floor(state.px), mapY = Math.floor(state.py);
      const dDistX = Math.abs(1 / (rdx || 1e-9)), dDistY = Math.abs(1 / (rdy || 1e-9));
      let stepX, stepY, sideDistX, sideDistY;
      if (rdx < 0) { stepX = -1; sideDistX = (state.px - mapX) * dDistX; } else { stepX = 1; sideDistX = (mapX + 1 - state.px) * dDistX; }
      if (rdy < 0) { stepY = -1; sideDistY = (state.py - mapY) * dDistY; } else { stepY = 1; sideDistY = (mapY + 1 - state.py) * dDistY; }
      let side = 0, tex = 1;
      for (let it = 0; it < 64; it++) {
        if (sideDistX < sideDistY) { sideDistX += dDistX; mapX += stepX; side = 0; } else { sideDistY += dDistY; mapY += stepY; side = 1; }
        tex = cell(mapX, mapY);
        if (tex > 0) break;
      }
      const rawDist = side === 0 ? sideDistX - dDistX : sideDistY - dDistY;
      const dist = Math.max(0.01, rawDist * Math.cos(rayA - state.ang)); // de-fisheye
      depth[c] = dist;
      const lineH = Math.min(H * 3, H / dist);
      const y0 = horizon - lineH / 2;
      /* textured strip */
      let wallX = side === 0 ? state.py + rawDist * rdy : state.px + rawDist * rdx;
      wallX -= Math.floor(wallX);
      const texX = Math.min(TEX - 1, (wallX * TEX) | 0);
      drawTexColumn(textures[tex] || textures[1], texX, c * colW, y0, colW + 1, lineH, side, dist);
    }

    /* sprites (enemies, bolts, pickups) — painter sorted, z-clipped */
    drawSprites(horizon);

    /* weapon viewmodel */
    drawViewmodel(horizon, shakeX);

    /* full-screen flashes */
    if (state.flash > 0 && !reduced) { ctx.fillStyle = `rgba(190,255,220,${state.flash * 1.6})`; ctx.fillRect(0, 0, W, H); }
    if (state.hurtFlash > 0) { ctx.fillStyle = `rgba(255,40,60,${Math.min(0.42, state.hurtFlash * 0.5)})`; ctx.fillRect(0, 0, W, H); }

    /* hudfx overlay canvas: minimap */
    fxc.clearRect(0, 0, fx.width, fx.height);
    if (state.phase === "playing") drawMinimap();
  }

  /* column-render a texture strip with distance shade */
  function drawTexColumn(img, texX, dx, dy, dw, dh, side, dist) {
    // ImageData-based textures: draw via a 1px-wide backing canvas cache
    const strip = texStrip(img, texX);
    ctx.globalAlpha = 1;
    ctx.drawImage(strip, 0, 0, 1, TEX, dx, dy, dw, dh);
    const shade = Math.min(0.88, dist / 16 + (side ? 0.16 : 0) );
    if (shade > 0.02) { ctx.fillStyle = `rgba(1,6,3,${shade})`; ctx.fillRect(dx, dy, dw, dh); }
  }
  /* cache: one 1xTEX canvas per texture per column */
  const stripCache = new Map();
  function texStrip(imgData, x) {
    const key = imgData === textures[1] ? 1 : imgData === textures[2] ? 2 : imgData === textures[3] ? 3 : 4;
    let arr = stripCache.get(key);
    if (!arr) { arr = new Array(TEX); stripCache.set(key, arr); }
    if (!arr[x]) {
      const c = document.createElement("canvas");
      c.width = 1; c.height = TEX;
      const g = c.getContext("2d");
      const col = g.createImageData(1, TEX);
      for (let y = 0; y < TEX; y++) {
        const si = (y * TEX + x) * 4, di = y * 4;
        col.data[di] = imgData.data[si]; col.data[di + 1] = imgData.data[si + 1];
        col.data[di + 2] = imgData.data[si + 2]; col.data[di + 3] = 255;
      }
      g.putImageData(col, 0, 0);
      arr[x] = c;
    }
    return arr[x];
  }

  /* draw-list entries are pooled — the array of refs is reused and entries
     are recycled, so a steady frame allocates nothing here */
  const drawList = [];
  const drawEntryPool = [];
  let drawEntryIdx = 0;
  function pushDrawEntry(x, y, img, scale, stag, bobber, color, alpha) {
    let s = drawEntryPool[drawEntryIdx];
    if (!s) drawEntryPool[drawEntryIdx] = s = { x: 0, y: 0, img: null, scale: 1, stag: false, bobber: false, color: "", alpha: 1, d2: 0 };
    drawEntryIdx++;
    s.x = x; s.y = y; s.img = img; s.scale = scale; s.stag = stag; s.bobber = bobber; s.color = color; s.alpha = alpha;
    s.d2 = (x - state.px) ** 2 + (y - state.py) ** 2;
    drawList.push(s);
  }
  function drawSprites(horizon) {
    drawList.length = 0;
    drawEntryIdx = 0;
    for (const e of state.enemies) pushDrawEntry(e.x, e.y, sprites[ENEMY[e.kind].sprite], ENEMY[e.kind].scale, e.stagger > 0, false, "", 1);
    for (const b of state.bolts) pushDrawEntry(b.x, b.y, sprites.bolt, 0.34, false, false, "", 1);
    for (const p of state.pickups) pushDrawEntry(p.x, p.y, sprites[p.kind], 0.55, false, true, "", 1);
    for (const p of state.particles) pushDrawEntry(p.x, p.y, null, 0.1, false, false, p.color, p.life / p.max);
    drawList.sort((a, b) => b.d2 - a.d2);
    for (const s of drawList) {
      const dx = s.x - state.px, dy = s.y - state.py;
      const dist = Math.sqrt(s.d2);
      let rel = Math.atan2(dy, dx) - state.ang;
      while (rel > Math.PI) rel -= 2 * Math.PI;
      while (rel < -Math.PI) rel += 2 * Math.PI;
      if (Math.abs(rel) > FOV / 2 + 0.35 || dist < 0.15) continue;
      const perp = dist * Math.cos(rel);
      if (perp < 0.1) continue;
      const screenX = ((rel / FOV) + 0.5) * W;
      const size = (H / perp) * s.scale;
      const bobY = s.bobber ? Math.sin(state.time * 2.4 + s.x) * size * 0.08 : 0;
      const top = horizon - size / 2 + (s.scale < 1 ? size * (1 - s.scale) * 0.4 : 0) + bobY;
      /* z-clip against wall columns */
      const c0 = Math.max(0, Math.floor((screenX - size / 2) / colW));
      const c1 = Math.min(COLS - 1, Math.floor((screenX + size / 2) / colW));
      if (c0 > c1) continue;
      ctx.globalAlpha = s.alpha != null ? s.alpha : 1;
      for (let c = c0; c <= c1; c++) {
        if (depth[c] <= perp) continue;
        const sx0 = c * colW, sw = colW + 1;
        if (s.img) {
          const u = ((sx0 - (screenX - size / 2)) / size) * SPR;
          ctx.drawImage(s.img, Math.max(0, Math.min(SPR - 1, u)), 0, Math.max(1, (sw / size) * SPR), SPR, sx0, top, sw, size);
        } else {
          ctx.fillStyle = s.color;
          ctx.fillRect(sx0, horizon - size / 2, sw, size);
        }
      }
      ctx.globalAlpha = 1;
      /* stagger tint */
      if (s.stag && s.img) {
        ctx.globalAlpha = 0.25; ctx.fillStyle = "#fff";
        ctx.fillRect(Math.max(0, screenX - size / 2), top, Math.min(size, W - screenX + size / 2), size);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawViewmodel(horizon, shakeX) {
    if (state.phase !== "playing") return;
    const w = WEAPONS[state.weapon];
    const bobX = reduced ? 0 : Math.sin(state.bob) * W * 0.006;
    const bobY = reduced ? 0 : Math.abs(Math.cos(state.bob)) * H * 0.008;
    const cx = W / 2 + bobX + shakeX, base = H + bobY;
    const kick = state.cooldown > w.cooldown - 0.08 ? H * 0.03 : 0;
    ctx.save();
    ctx.translate(cx, base + kick);
    /* barrel (gradient cached in resize; coords are translate-relative) */
    ctx.fillStyle = vmGrad;
    ctx.beginPath();
    ctx.moveTo(-W * 0.055, 0); ctx.lineTo(-W * 0.026, -H * 0.21); ctx.lineTo(W * 0.026, -H * 0.21); ctx.lineTo(W * 0.055, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(65,255,161,.4)"; ctx.lineWidth = 2; ctx.stroke();
    /* energy core = weapon color */
    ctx.fillStyle = w.color;
    ctx.shadowColor = w.color; ctx.shadowBlur = 12;
    ctx.fillRect(-W * 0.012, -H * 0.20, W * 0.024, H * 0.05);
    ctx.shadowBlur = 0;
    /* muzzle flash */
    if (state.flash > 0.02 && !reduced) {
      ctx.globalAlpha = Math.min(1, state.flash * 10);
      ctx.fillStyle = vmFlashGrads[state.weapon];
      ctx.beginPath(); ctx.arc(0, -H * 0.22, H * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawMinimap() {
    const S = Math.min(fx.width, fx.height) * 0.22, px = fx.width - S - 12, py = 12, u = S / MAP_W;
    fxc.globalAlpha = 0.82;
    fxc.fillStyle = "rgba(1,8,4,.8)"; fxc.fillRect(px - 3, py - 3, S + 6, S + 6);
    fxc.strokeStyle = "rgba(65,255,161,.4)"; fxc.strokeRect(px - 3, py - 3, S + 6, S + 6);
    fxc.fillStyle = "rgba(65,255,161,.28)";
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (M[y][x]) fxc.fillRect(px + x * u, py + y * u, u, u);
    for (const e of state.enemies) { fxc.fillStyle = e.kind === "warden" ? "#ffd166" : "#ff5c74"; fxc.fillRect(px + e.x * u - 1.5, py + e.y * u - 1.5, 3, 3); }
    fxc.fillStyle = "#effff6";
    fxc.beginPath(); fxc.arc(px + state.px * u, py + state.py * u, 2.4, 0, Math.PI * 2); fxc.fill();
    fxc.strokeStyle = "#effff6";
    fxc.beginPath(); fxc.moveTo(px + state.px * u, py + state.py * u);
    fxc.lineTo(px + (state.px + Math.cos(state.ang) * 1.6) * u, py + (state.py + Math.sin(state.ang) * 1.6) * u); fxc.stroke();
    fxc.globalAlpha = 1;
  }

  /* ================= input ================= */
  const $ = (s) => document.querySelector(s);
  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === "Digit1") switchWeapon(0);
    if (e.code === "Digit2") switchWeapon(1);
    if (e.code === "Digit3") switchWeapon(2);
    if (e.code === "KeyM") toggleMute();
    if (e.code === "KeyP" || e.code === "Escape") { if (state.phase === "playing") setPaused(true); else if (state.phase === "paused" && e.code === "KeyP") setPaused(false); }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  view.addEventListener("click", () => {
    if (state.phase !== "playing") return;
    if (document.pointerLockElement !== view && !isTouch) view.requestPointerLock?.();
    else fire();
  });
  document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === view && state.phase === "playing") state.ang += e.movementX * 0.0023;
  });
  document.addEventListener("mousedown", (e) => { if (document.pointerLockElement === view && e.button === 0) input.firing = true; });
  document.addEventListener("mouseup", (e) => { if (e.button === 0) input.firing = false; });

  /* gamepad — polled every frame; PhantomPlay's player passes the
     Gamepad permission into the sandbox via its iframe allow list. */
  let padConnectedToastShown = false;
  let padFireHeld = false, padSwapHeld = false, padPauseHeld = false;
  function pollGamepad() {
    let pads = [];
    try { pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; } catch { return; }
    const pad = pads.find((p) => p && p.connected);
    if (!pad) return;
    if (!padConnectedToastShown) { padConnectedToastShown = true; toast("CONTROLLER CONNECTED"); }
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    /* movement + fire only steer an active run */
    if (state.phase === "playing") {
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      const lx = dz(pad.axes[0] || 0), ly = dz(pad.axes[1] || 0);
      const rx = dz(pad.axes[2] || 0);
      if (lx || ly) { input.strafe = lx; input.fwd = -ly; }
      if (rx) input.turn = rx * 3.1;
      const fireDown = btn(7) || btn(0);            // RT or A/Cross
      if (fireDown) input.firing = true;
      else if (padFireHeld) input.firing = false;
      padFireHeld = fireDown;
      const swapDown = btn(4) || btn(5);            // LB / RB
      if (swapDown && !padSwapHeld) switchWeapon((state.weapon + (btn(4) ? WEAPONS.length - 1 : 1)) % WEAPONS.length);
      padSwapHeld = swapDown;
    } else {
      padFireHeld = false; padSwapHeld = false;
    }
    /* Start works from every phase — pause, resume, and (re)start */
    const pauseDown = btn(9);
    if (pauseDown && !padPauseHeld) {
      if (state.phase === "playing") setPaused(true);
      else if (state.phase === "paused") setPaused(false);
      else if (state.phase === "start" || state.phase === "dead" || state.phase === "won") startRun();
    }
    padPauseHeld = pauseDown;
  }

  /* touch: left stick + right-half drag aim + fire button */
  const isTouch = matchMedia("(pointer: coarse)").matches;
  const stick = { active: false, id: -1, cx: 0, cy: 0 };
  const aim = { id: -1, lastX: 0 };
  let touchFireHeld = false;
  function bindTouch() {
    const stickEl = $("[data-stick]"), nub = $("[data-stick-nub]");
    stickEl.addEventListener("pointerdown", (e) => {
      stick.active = true; stick.id = e.pointerId;
      const r = stickEl.getBoundingClientRect();
      stick.cx = r.left + r.width / 2; stick.cy = r.top + r.height / 2;
      stickEl.setPointerCapture(e.pointerId);
    });
    stickEl.addEventListener("pointermove", (e) => {
      if (!stick.active || e.pointerId !== stick.id) return;
      const dx = (e.clientX - stick.cx) / 44, dy = (e.clientY - stick.cy) / 44;
      const len = Math.hypot(dx, dy), cap = len > 1 ? 1 / len : 1;
      input.strafe = dx * cap; input.fwd = -dy * cap;
      nub.style.transform = `translate(${dx * cap * 30}px, ${dy * cap * 30}px)`;
    });
    const endStick = (e) => {
      if (e.pointerId !== stick.id) return;
      stick.active = false; input.strafe = 0; input.fwd = 0;
      nub.style.transform = "";
    };
    stickEl.addEventListener("pointerup", endStick);
    stickEl.addEventListener("pointercancel", endStick);

    view.addEventListener("pointerdown", (e) => {
      if (!isTouch || e.clientX < window.innerWidth * 0.45) return;
      aim.id = e.pointerId; aim.lastX = e.clientX;
    });
    view.addEventListener("pointermove", (e) => {
      if (e.pointerId !== aim.id || state.phase !== "playing") return;
      state.ang += (e.clientX - aim.lastX) * 0.006;
      aim.lastX = e.clientX;
    });
    const endAim = (e) => { if (e.pointerId === aim.id) aim.id = -1; };
    view.addEventListener("pointerup", endAim);
    view.addEventListener("pointercancel", endAim);

    const fireBtn = $("[data-touch-fire]");
    fireBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); touchFireHeld = true; input.firing = true; });
    fireBtn.addEventListener("pointerup", () => { touchFireHeld = false; input.firing = false; });
    fireBtn.addEventListener("pointercancel", () => { touchFireHeld = false; input.firing = false; });
    $("[data-touch-swap]").addEventListener("click", () => switchWeapon((state.weapon + 1) % WEAPONS.length));
  }

  function readKeyboard() {
    if (isTouch && (stick.active || aim.id !== -1)) return; // touch owns movement
    let fwd = 0, strafe = 0, turn = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) fwd += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) fwd -= 1;
    if (keys.has("KeyA")) strafe -= 1;
    if (keys.has("KeyD")) strafe += 1;
    if (keys.has("ArrowLeft")) turn -= 2.4;
    if (keys.has("ArrowRight")) turn += 2.4;
    if (keys.has("Space")) input.firing = true;
    else if (!padFireHeld && !touchFireHeld && aim.id === -1 && !mouseHeld()) input.firing = false;
    input.fwd = fwd; input.strafe = strafe; input.turn = turn;
  }
  const mouseHeld = () => document.pointerLockElement === view && mouseDown;
  let mouseDown = false;
  document.addEventListener("mousedown", () => { mouseDown = true; });
  document.addEventListener("mouseup", () => { mouseDown = false; });

  /* ================= UI ================= */
  function show(sel) { for (const o of document.querySelectorAll(".ps-overlay")) o.hidden = true; if (sel) $(sel).hidden = false; }
  let toastTimer = 0;
  function toast(msg) {
    const t = $("[data-toast]");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 1400);
  }
  function switchWeapon(i) {
    if (i === state.weapon || state.phase !== "playing") { state.weapon = i; syncHud(); return; }
    state.weapon = i; state.cooldown = Math.max(state.cooldown, 0.18);
    blip(440 + i * 120, 0.05, "square", 0.03);
    syncHud();
  }
  function toggleMute() {
    state.muted = !state.muted;
    soundOn = !state.muted;
    syncMuteButton();
  }
  function syncMuteButton() {
    const b = $("[data-mute]");
    if (b) b.classList.toggle("off", state.muted || !soundOn);
  }
  let lastWeaponsKey = "";
  function syncHud() {
    $("[data-hp]").textContent = Math.max(0, Math.round(state.hp));
    const bar = $("[data-hp-bar]");
    bar.style.width = `${Math.max(0, state.hp)}%`;
    bar.classList.toggle("low", state.hp <= 30);
    const ammo = state.ammo[state.weapon];
    $("[data-ammo]").textContent = ammo === Infinity ? "∞" : String(ammo);
    $("[data-score]").textContent = String(state.score);
    $("[data-left]").textContent = String(state.enemies.length + state.spawnQueue.length);
    $("[data-wave-label]").textContent = `WAVE ${Math.min(WAVES.length, state.wave + 1)} / ${WAVES.length}`;
    const weaponsKey = `${state.weapon}:${state.ammo[1]}:${state.ammo[2]}`;
    if (weaponsKey !== lastWeaponsKey) {
      lastWeaponsKey = weaponsKey;
      $("[data-weapons]").innerHTML = WEAPONS.map((w, i) =>
        `<span class="ps-weapon ${i === state.weapon ? "active" : ""}">${w.label}${w.ammo === Infinity ? "" : ` · ${state.ammo[i]}`}</span>`).join("");
    }
    $("[data-crosshair]").classList.toggle("hit", state.hitMark > 0);
  }

  function setPaused(v, notifyHost = true) {
    if (v && state.phase === "playing") {
      state.phase = "paused";
      show("[data-pause-overlay]");
      document.exitPointerLock?.();
      if (notifyHost) host("paused", { paused: true });
    } else if (!v && state.phase === "paused") {
      state.phase = "playing";
      show(null);
      if (notifyHost) host("paused", { paused: false });
    }
  }

  function startRun() {
    resetRun();
    state.phase = "playing";
    show(null);
    $("[data-hud]").hidden = false;
    $("[data-touch]").hidden = !isTouch;
    syncHud();
  }

  $("[data-start-btn]").addEventListener("click", startRun);
  $("[data-retry-btn]").addEventListener("click", startRun);
  $("[data-again-btn]").addEventListener("click", startRun);
  $("[data-resume-btn]").addEventListener("click", () => setPaused(false));
  $("[data-mute]").addEventListener("click", toggleMute);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.phase === "playing") setPaused(true);
  });
  /* losing OS/window focus (alt-tab, host stealing focus) never delivers the
     matching keyup — drop every latched input and pause instead of walking
     into enemies or auto-firing forever */
  window.addEventListener("blur", () => {
    keys.clear();
    mouseDown = false;
    input.fwd = 0; input.strafe = 0; input.turn = 0; input.firing = false;
    if (state.phase === "playing") setPaused(true);
  });

  /* ================= main loop ================= */
  const TICK = 1 / 60;
  let acc = 0, last = 0;
  function frame(now) {
    if (!last) last = now;
    let dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    input.turn = 0;
    readKeyboard();
    pollGamepad(); // every frame — Start must resume from pause and start runs
    if (state.phase === "playing") {
      acc += dt;
      while (acc >= TICK) { simulate(TICK); acc -= TICK; }
    } else {
      acc = 0;
    }
    render();
    requestAnimationFrame(frame);
  }
  resize();
  bindTouch();
  requestAnimationFrame(frame);
  host("ready");

  /* ================= test hook (automation only) ================= */
  window.__PhantomStrikeTest = {
    start() { startRun(); },
    state() {
      return {
        phase: state.phase, hp: state.hp, wave: state.wave + 1, kills: state.kills,
        score: state.score, enemies: state.enemies.length, queued: state.spawnQueue.length,
        px: state.px, py: state.py, ang: state.ang, weapon: state.weapon,
        completeSent: state.completeSent, cols: COLS, depthSample: depth[Math.floor(COLS / 2)] || 0,
      };
    },
    setInput(o) { Object.assign(input, o); },
    fire() { fire(); },
    combatDebug() {
      const w = WEAPONS[state.weapon];
      const dx = Math.cos(state.ang), dy = Math.sin(state.ang);
      let wallDist = w.range;
      { let x = state.px, y = state.py;
        for (let t = 0; t < w.range; t += 0.05) { x += dx * 0.05; y += dy * 0.05; if (solid(x, y)) { wallDist = t; break; } } }
      return {
        cooldown: state.cooldown, shotsFired: state.shotsFired, shotsHit: state.shotsHit, wallDist,
        enemies: state.enemies.map((e) => {
          const ex = e.x - state.px, ey = e.y - state.py;
          return { kind: e.kind, x: +e.x.toFixed(2), y: +e.y.toFixed(2), hp: e.hp,
            along: +(ex * dx + ey * dy).toFixed(3), perp: +Math.abs(ex * dy - ey * dx).toFixed(3),
            window: ENEMY[e.kind].radius + 0.12 };
        }),
      };
    },
    aimAtNearest() {
      const e = state.enemies[0];
      if (e) state.ang = Math.atan2(e.y - state.py, e.x - state.px);
      return !!e;
    },
    teleport(x, y) { state.px = x; state.py = y; },
    godmode(v) { state.hp = v ?? 10000; },
    clearWave() { state.spawnQueue = []; for (const e of state.enemies) { e.hp = 0; damageEnemy(e, 1); } },
    tick(n = 1) { for (let i = 0; i < n; i++) simulate(TICK); },
    hurt(n) { hurtPlayer(n); },
  };
})();
