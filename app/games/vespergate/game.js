/* VESPERGATE: THE HOLLOW GEOMETRY — game.js
 * Player (two hands), projectiles with Foldshot effects, enemies, Bellmother
 * boss, bell shockwaves, collision, Sable rendering, gate destination view,
 * HUD, save/resume, PhantomPlay host bridge, main loop.
 */
"use strict";
(() => {
  const VG = window.VG, T = VG.TILE;
  const ctx = VG.ctx;
  const embedded = window.parent !== window;
  const host = (type, data = {}) => { if (embedded) parent.postMessage({ source: "phantomplay-game", type, ...data }, "*"); };

  const $ = (s) => document.querySelector(s);
  const state = {
    phase: "title",           // title | playing | paused | dead | win
    room: null, roomId: "fall",
    t: 0, completeSent: false,
    score: 0, kills: 0, bossHp: 0, bossMax: 1,
  };
  VG.state = state;
  const portals = new VG.PortalSystem();
  VG.portals = portals;

  /* ================= player ================= */
  const SHOTS = [
    { id: "needle", name: "Votive Needle", cd: 0.14, dmg: 8, ash: 4, speed: 340, r: 3, charge: false },
    { id: "orb", name: "Knell Orb", cd: 0.55, dmg: 22, ash: 16, speed: 150, r: 6, charge: true, blast: 26 },
  ];
  const player = {
    x: 60, y: 60, vx: 0, vy: 0, w: 9, h: 20, r: 8,
    onGround: false, coyote: 0, jumpBuf: 0, facing: 1,
    hp: 6, maxHp: 6, iframe: 0, ash: 100, maxAsh: 100,
    shot: 0, cd: 0, charge: 0, charging: false,
    dashCd: 0, dashT: 0, dashDir: { x: 1, y: 0 },
    wardT: 0, wardCd: 0, aimx: 1, aimy: 0, hasFoldstep: true, hasWard: true, relics: {},
    _key: "player",
    dead: false,
  };
  VG.player = player;

  function resetPlayer(spawn) {
    player.x = spawn.x * T + 8; player.y = spawn.y * T + 4;
    player.vx = 0; player.vy = 0; player.dead = false; player.iframe = 0;
  }

  /* ================= entities ================= */
  let shots = [];       // player projectiles
  let bolts = [];       // enemy projectiles
  let enemies = [];
  let pickups = [];
  let rings = [];       // bell shockwaves
  let particles = [];
  let boss = null;
  let floatText = [];

  function spawnParticles(x, y, color, n, spd = 60) {
    if (VG.settings.reducedEffects) n = Math.min(3, n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random());
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.3, max: 0.6, color });
    }
  }
  function toast(text, x, y, color = "#eaf2ff") { floatText.push({ text, x, y, life: 1, color }); }

  /* ================= collision ================= */
  function solid(x, y) { return state.room.solidAtPx(x, y); }
  function moveBody(o, dt) {
    // horizontal
    let nx = o.x + o.vx * dt;
    const hw = o.w / 2;
    if (o.vx !== 0) {
      const dir = Math.sign(o.vx);
      const edge = nx + dir * hw;
      if (solid(edge, o.y - o.h / 2 + 2) || solid(edge, o.y - o.h / 2 + o.h / 2) || solid(edge, o.y - 2)) {
        nx = dir > 0 ? Math.floor((edge) / T) * T - hw - 0.01 : Math.ceil((edge) / T) * T + hw + 0.01;
        o.vx = 0;
      }
    }
    o.x = nx;
    // vertical
    let ny = o.y + o.vy * dt;
    o.onGround = false;
    if (o.vy > 0) { // falling
      const foot = ny;
      const belowMat = state.room.matAtPx(o.x, foot);
      const isPlat = state.room.platformAtPx(o.x, foot);
      const passPlat = isPlat && (VG.input.keys.has("KeyS") || VG.input.keys.has("ArrowDown"));
      if ((solid(o.x - hw + 1, foot) || solid(o.x + hw - 1, foot) || (isPlat && !passPlat && (o.y <= Math.floor(foot / T) * T))) ) {
        ny = Math.floor(foot / T) * T - 0.01;
        o.vy = 0; o.onGround = true;
      }
    } else if (o.vy < 0) { // rising
      const head = ny - o.h;
      if (solid(o.x - hw + 1, head) || solid(o.x + hw - 1, head)) {
        ny = Math.ceil(head / T) * T + o.h + 0.01; o.vy = 0;
      }
    }
    o.y = ny;
    // spikes
    if (state.room.spikeAtPx(o.x, o.y - 4) && o === player && player.iframe <= 0) hurtPlayer(2, 0, -1);
  }

  /* ================= input → aim ================= */
  function updateAim() {
    if (VG.input.usingPad && VG.input.pad) {
      const a = VG.input.padAim; const m = Math.hypot(a.x, a.y);
      if (m > 0.2) { player.aimx = a.x / m; player.aimy = a.y / m; }
    } else {
      const wx = VG.camera.x + VG.input.mx, wy = VG.camera.y + VG.input.my;
      const dx = wx - player.x, dy = wy - (player.y - 10);
      const m = Math.hypot(dx, dy) || 1; player.aimx = dx / m; player.aimy = dy / m;
    }
    if (Math.abs(player.aimx) > 0.15) player.facing = Math.sign(player.aimx);
  }

  /* ================= firing ================= */
  function fire() {
    const s = SHOTS[player.shot];
    if (player.cd > 0 || player.ash < s.ash) { if (player.ash < s.ash) VG.sfx(200, 0.05, "square", 0.03); return; }
    player.cd = s.cd; player.ash -= s.ash;
    const px = player.x + player.aimx * 8, py = player.y - 10 + player.aimy * 8;
    const chargeMul = s.charge ? (1 + player.charge * 0.8) : 1;
    shots.push({
      x: px, y: py, vx: player.aimx * s.speed, vy: player.aimy * s.speed,
      r: s.r, dmg: s.dmg * chargeMul, life: 2.4, type: s.id, blast: s.blast || 0,
      _foldCount: 0, pierce: 0, key: "shot" + Math.random(),
    });
    player.charge = 0;
    VG.sfxCinder(s.id);
    VG.camera.jolt(0.08);
    spawnParticles(px, py, "#ffcf6b", 3, 40);
  }

  /* ================= gate placement ================= */
  let placePreview = null;
  function updateGatePreview() {
    const wx = VG.camera.x + (VG.input.usingPad ? player.x + player.aimx * 80 : VG.input.mx);
    const wy = VG.camera.y + (VG.input.usingPad ? player.y - 10 + player.aimy * 80 : VG.input.my);
    // cast a short ray from player toward aim to find a surface if aiming at open air
    let cls = state.room.classifyPortal(wx, wy);
    if (!cls.valid && cls.reason === "open-air") {
      for (let d = 8; d < 120; d += 6) {
        const rx = player.x + player.aimx * d, ry = (player.y - 10) + player.aimy * d;
        const c2 = state.room.classifyPortal(rx, ry);
        if (c2.valid || c2.reason !== "open-air") { cls = c2; break; }
      }
    }
    placePreview = cls;
  }
  function placeGate() {
    if (!placePreview) return;
    if (!placePreview.valid) { VG.sfxGate(portals.selected, "invalid"); toast("no gate here", player.x, player.y - 24, "#ff8095"); return; }
    portals.place(portals.selected, placePreview.x, placePreview.y, placePreview.dir, true);
    spawnParticles(placePreview.x, placePreview.y, portals.selected === 0 ? "#8fe9ff" : "#ff9ad0", 8, 50);
  }

  /* ================= enemies ================= */
  function makeEnemy(def) {
    const base = { x: def.x * T + 8, y: def.y * T + 8, vx: 0, vy: 0, hp: 20, maxHp: 20, w: 12, h: 16, r: 8, type: def.type, cd: 1, dead: false, hurt: 0, _key: "e" + Math.random() };
    if (def.type === "guard") return { ...base, hp: 34, maxHp: 34, shield: 1 };
    if (def.type === "sniper") return { ...base, hp: 16, maxHp: 16, aim: 0, aiming: 0 };
    if (def.type === "leech") return { ...base, hp: 10, maxHp: 10, w: 8, h: 8, r: 5, onGate: false };
    if (def.type === "mourner") return { ...base, hp: 18, maxHp: 18, r: 7, blinkT: 1.5, ghost: 0.6, phase: Math.random() * 6 };
    return base;
  }
  function stepEnemy(e, dt) {
    if (e.dead) return;
    e.hurt = Math.max(0, e.hurt - dt);
    const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy);
    if (e.type === "guard") {
      e.face = Math.sign(dx) || 1;
      if (d > 24) e.x += e.face * 26 * dt;
      e.vy += 500 * dt; e.y += e.vy * dt;
      if (solid(e.x, e.y + e.h / 2)) { e.y = Math.floor((e.y + e.h / 2) / T) * T - e.h / 2; e.vy = 0; }
      e.cd -= dt;
      if (d < 220 && e.cd <= 0) { e.cd = 1.6; shootBolt(e.x, e.y, dx / d, dy / d, 150, 6); }
    } else if (e.type === "sniper") {
      e.vy += 400 * dt; e.y += e.vy * dt;
      if (solid(e.x, e.y + e.h / 2)) { e.y = Math.floor((e.y + e.h / 2) / T) * T - e.h / 2; e.vy = 0; }
      if (e.aiming > 0) { e.aiming -= dt; if (e.aiming <= 0) { shootBolt(e.x, e.y, dx / d, dy / d, 320, 10, "#ff5c74"); } }
      else { e.cd -= dt; if (e.cd <= 0 && d < 320) { e.cd = 2.4; e.aiming = 0.9; e.aimx = dx / d; e.aimy = dy / d; } }
    } else if (e.type === "mourner") {
      e.phase += dt;
      e.x += (dx / (d || 1)) * 34 * dt;
      e.y += (dy / (d || 1)) * 22 * dt + Math.sin(e.phase * 2) * 8 * dt;
      e.blinkT -= dt;
      if (e.blinkT <= 0) {
        e.blinkT = 2 + Math.random() * 1.5;
        e.x = VG.clamp(state.room.pxW - e.x, 20, state.room.pxW - 20);
        e.ghost = 0.2; spawnParticles(e.x, e.y, "#c9d6e8", 5);
      }
      e.ghost = Math.min(1, e.ghost + dt * 1.5);
      e.cd -= dt;
      if (d < 200 && e.cd <= 0) { e.cd = 1.8; shootBolt(e.x, e.y, dx / d, dy / d, 130, 5, "#c9d6e8"); }
    } else if (e.type === "leech") {
      // drift toward nearest open gate; attach and add strain
      const g = portals.gates.find((gg) => gg.active);
      if (g) {
        const gdx = g.x - e.x, gdy = g.y - e.y, gd = Math.hypot(gdx, gdy) || 1;
        e.x += gdx / gd * 40 * dt; e.y += gdy / gd * 40 * dt;
        if (gd < 14) { e.onGate = true; portals.addStrain(0.12 * dt); }
        else e.onGate = false;
      } else { e.vy += 300 * dt; e.y += e.vy * dt; if (solid(e.x, e.y + 4)) { e.y = Math.floor((e.y + 4) / T) * T - 4; e.vy = 0; } }
    }
    // enemy teleports through gates too
    portals.tryTeleport(e, e._key, { strain: 0.04 });
    // touch damage
    if (d < 14 && player.iframe <= 0) hurtPlayer(1, Math.sign(-dx), -0.4);
  }
  function shootBolt(x, y, dx, dy, spd, dmg, color = "#ff9a5d") {
    bolts.push({ x, y, vx: dx * spd, vy: dy * spd, r: 3, dmg, life: 3, color, key: "b" + Math.random() });
  }

  /* ================= boss: Bellmother ================= */
  function makeBoss(def) {
    return {
      x: def.x * T, y: def.y * T, vx: 0, hp: 240, maxHp: 240, w: 40, h: 40, r: 24,
      phase: 1, cd: 2, ringCd: 3, hurt: 0, dir: 1, _key: "boss", dead: false, sweep: 0,
    };
  }
  function stepBoss(b, dt) {
    if (b.dead) return;
    b.hurt = Math.max(0, b.hurt - dt);
    b.phase = b.hp > b.maxHp * 0.66 ? 1 : b.hp > b.maxHp * 0.33 ? 2 : 3;
    state.bossHp = b.hp; state.bossMax = b.maxHp;
    // slow horizontal sweep
    b.sweep += dt * (0.4 + b.phase * 0.2);
    b.x = 18 * T + Math.sin(b.sweep) * (7 * T);
    b.y = 6 * T + (b.phase >= 2 ? Math.sin(b.sweep * 1.7) * 30 : 0);
    // resonance rings across the room
    b.ringCd -= dt;
    if (b.ringCd <= 0) {
      b.ringCd = b.phase === 3 ? 1.6 : b.phase === 2 ? 2.2 : 2.8;
      rings.push({ x: b.x, y: b.y, r: 12, vr: 130, dmg: 2, life: 3, hostile: true });
      VG.sfxBell(90, 0.14);
      VG.camera.jolt(0.15);
    }
    // summon adds in phase 2
    b.cd -= dt;
    if (b.phase >= 2 && b.cd <= 0 && enemies.filter((e) => !e.dead).length < 3) {
      b.cd = 6;
      enemies.push(makeEnemy({ type: "sniper", x: 4 + Math.floor(Math.random() * 26), y: 8 }));
    }
    if (b.phase === 3) {
      // faster, more rings; weak points require portal loops (reachable via gates)
      b.cd -= dt;
    }
  }

  /* ================= damage ================= */
  function damageEnemy(e, dmg, fromBehind) {
    if (e.dead) return;
    if (e.type === "guard" && e.shield && !fromBehind) { spawnParticles(e.x, e.y, "#8aa", 3, 30); VG.sfx(320, 0.04, "square", 0.03); return; }
    e.hp -= dmg; e.hurt = 0.12; spawnParticles(e.x, e.y, "#ffd166", 4);
    VG.sfx(500, 0.03, "triangle", 0.03);
    if (e.hp <= 0) {
      e.dead = true; state.kills++; state.score += 100; spawnParticles(e.x, e.y, "#8fe9ff", 12);
      if (e.onGate) portals.strain = Math.max(0, portals.strain - 0.2);
      // Glass Mourner shatters into two fragment bolts
      if (e.type === "mourner") { shootBolt(e.x, e.y, -0.7, -0.7, 160, 4, "#c9d6e8"); shootBolt(e.x, e.y, 0.7, -0.7, 160, 4, "#c9d6e8"); VG.sfx(900, 0.08, "triangle", 0.05); }
    }
  }
  function damageBoss(dmg) {
    if (!boss || boss.dead) return;
    boss.hp -= dmg; boss.hurt = 0.1; spawnParticles(boss.x, boss.y, "#ffd166", 5);
    if (boss.hp <= 0) { boss.dead = true; onWin(); }
  }
  function hurtPlayer(dmg, kx = 0, ky = 0) {
    if (player.iframe > 0 || player.dead) return;
    if (player.wardT > 0) { VG.sfx(700, 0.05, "sine", 0.05); return; }
    player.hp -= dmg * VG.settings.damageTaken; player.iframe = 0.9;
    player.vx += kx * 120; player.vy += ky * 160;
    VG.camera.jolt(0.3); spawnParticles(player.x, player.y - 8, "#ff5c74", 8);
    VG.sfx(140, 0.14, "sawtooth", 0.06);
    if (player.hp <= 0) onDead();
  }

  /* ================= bells ================= */
  function ringBell(bx, by) {
    rings.push({ x: bx, y: by, r: 8, vr: 150, dmg: 4, life: 2.5, hostile: false });
    VG.sfxBell(110, 0.18); VG.camera.jolt(0.12);
  }

  /* ================= room loading ================= */
  function loadRoom(id, spawn) {
    const def = VG.ROOMS[id];
    state.room = new VG.Room(def);
    state.roomId = id;
    VG.camera.bounds = { x: 0, y: 0, w: state.room.pxW, h: state.room.pxH };
    shots = []; bolts = []; rings = []; particles = []; floatText = [];
    enemies = (def.enemies || []).map(makeEnemy);
    pickups = (def.pickups || []).map((p) => ({ x: p.x * T + 8, y: p.y * T + 8, type: p.type, relic: p.relic, bob: Math.random() * 6 }));
    boss = def.boss ? makeBoss(def.boss) : null;
    portals.reset();
    const sp = spawn || def.spawn;
    resetPlayer(sp);
    VG.camera.snapTo(player.x, player.y);
    VG.setMusicState(boss ? "boss" : id === "boss" ? "boss" : "explore");
    if (def.bells) state.bells = def.bells.map((b) => ({ x: b.gx * T + 8, y: b.gy * T + 8, cd: 0 }));
    else state.bells = [];
    if (def.shrine) state.shrine = { x: def.shrine.gx * T + 8, y: def.shrine.gy * T + 12 };
    else state.shrine = null;
    setHint(def.hint || "");
    VG.save.write({ roomId: id, hp: player.hp, ash: player.ash, score: state.score, kills: state.kills });
    host("progress", { progress: Math.round(progressPct()), state: { room: id } });
  }
  function progressPct() {
    const order = ["fall", "teach", "bells", "boss", "ossuary1", "ossuary2", "belfry"];
    const i = Math.max(0, order.indexOf(state.roomId));
    return (i / order.length) * 100 + (state.roomId === "boss" && boss ? (1 - boss.hp / boss.maxHp) * (100 / order.length) : 0);
  }

  /* ================= simulate ================= */
  function simulate(dt) {
    state.t += dt;
    updateAim();
    portals.update(dt);
    // pull edge inputs
    const pressed = VG.input.pressed; const pad = VG.input.pad;
    const wantFire = VG.input.fireHeld || (pad && pad.fire);
    const wantGate = pressed.has("M2") || pressed.has("PadRT") || (pad && pad.gate && !player._gateHeldPrev);
    player._gateHeldPrev = pad && pad.gate;

    /* ---- movement ---- */
    const left = VG.input.keys.has("KeyA") || VG.input.keys.has("ArrowLeft") || (pad && pad.lx < -0.3);
    const right = VG.input.keys.has("KeyD") || VG.input.keys.has("ArrowRight") || (pad && pad.lx > 0.3);
    const wantJump = pressed.has("Space") || pressed.has("PadA");
    const jumpHeld = VG.input.keys.has("Space") || (pad && pad.jump);
    const wantDash = pressed.has("ShiftLeft") || pressed.has("ShiftRight") || pressed.has("PadB");

    const accel = player.onGround ? 1400 : 900;
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    if (player.dashT <= 0) {
      player.vx += (target * 150 - player.vx) * Math.min(1, accel / 150 * dt);
      if (target === 0 && player.onGround) player.vx *= Math.pow(0.0005, dt);
    }
    player.coyote = player.onGround ? 0.1 : Math.max(0, player.coyote - dt);
    if (wantJump) player.jumpBuf = 0.12;
    player.jumpBuf = Math.max(0, player.jumpBuf - dt);
    if (player.jumpBuf > 0 && player.coyote > 0) { player.vy = -230; player.jumpBuf = 0; player.coyote = 0; VG.sfx(300, 0.05, "sine", 0.04); }
    if (player.vy < 0 && !jumpHeld) player.vy += 700 * dt; // variable jump
    if (player.dashT <= 0) player.vy += 620 * dt;
    player.vy = Math.min(player.vy, 420);

    // Foldstep dash
    player.dashCd = Math.max(0, player.dashCd - dt);
    if (wantDash && player.dashCd <= 0 && player.hasFoldstep) {
      player.dashT = 0.16; player.dashCd = 0.5; player.iframe = Math.max(player.iframe, 0.18);
      player.dashDir = { x: (target || player.facing), y: 0 };
      VG.sfxGate(0, "cross"); spawnParticles(player.x, player.y - 8, "#8fe9ff", 6);
    }
    if (player.dashT > 0) { player.dashT -= dt; player.vx = player.dashDir.x * 300; player.vy = 0; }

    moveBody(player, dt);
    // player teleport through gates (preserve momentum — the pillar mechanic)
    const tp = portals.tryTeleport(player, "player", { strain: 0.06 });
    if (tp === "critical") { doCollapse(); }
    else if (tp) { VG.camera.jolt(0.1); }

    /* ---- fire / charge ---- */
    player.cd = Math.max(0, player.cd - dt);
    const s = SHOTS[player.shot];
    if (s.charge && wantFire && VG.settings.holdToCharge) { player.charging = true; player.charge = Math.min(1, player.charge + dt * 1.4); }
    if (wantFire && (!s.charge || !VG.settings.holdToCharge)) fire();
    if (s.charge && VG.settings.holdToCharge && !wantFire && player.charging) { player.charging = false; fire(); }
    // swap shot
    if (pressed.has("Digit1")) player.shot = 0;
    if (pressed.has("Digit2")) player.shot = 1;
    if (pressed.has("PadLB") || pressed.has("KeyLB")) player.shot = (player.shot + 1) % SHOTS.length;
    // ash regen (faster after portal actions)
    const regen = 8 + (portals.strain > 0.2 ? 6 : 0);
    player.ash = Math.min(player.maxAsh, player.ash + regen * dt);
    player.iframe = Math.max(0, player.iframe - dt);
    player.wardT = Math.max(0, player.wardT - dt); player.wardCd = Math.max(0, player.wardCd - dt);
    // ward
    if ((pressed.has("PadY") || pressed.has("KeyF")) && player.wardCd <= 0 && player.ash >= 10) {
      player.wardT = 0.28; player.wardCd = 0.6; player.ash -= 10; VG.sfx(620, 0.08, "sine", 0.05);
    }

    /* ---- gates ---- */
    updateGatePreview();
    if (wantGate) placeGate();
    if (pressed.has("KeyQ") || pressed.has("PadRB")) portals.selected = 1 - portals.selected;
    if (pressed.has("KeyF") && pressed.has("ShiftLeft")) {} // reserved
    if (pressed.has("KeyR")) portals.recall(portals.selected);
    if (pressed.has("KeyE") || pressed.has("PadX")) tryInteract();
    if (pressed.has("KeyF") && !player.wardT) { if (portals.vent()) toast("gates vented", player.x, player.y - 24, "#8fe9ff"); }

    /* ---- shots ---- */
    for (const sh of shots) {
      sh.life -= dt;
      const px = sh.x, py = sh.y;
      sh.x += sh.vx * dt; sh.y += sh.vy * dt;
      const tpz = portals.tryTeleport(sh, sh.key, { strain: 0.04 });
      if (tpz) { sh.foldshot = true; sh.dmg *= 1.25; sh.pierce += 1; spawnParticles(sh.x, sh.y, "#8fe9ff", 3); }
      // hit walls
      if (solid(sh.x, sh.y)) {
        // mirror-bone reflects the shot instead of consuming it (bank shots)
        if (state.room.reflectAtPx(sh.x, sh.y) && (sh._bounces || 0) < 3) {
          sh._bounces = (sh._bounces || 0) + 1;
          // reflect off the face we hit: undo the step, flip the dominant axis
          sh.x = px; sh.y = py;
          // flip the dominant travel axis (banks the shot off the mirror face)
          if (Math.abs(sh.vx) >= Math.abs(sh.vy)) sh.vx = -sh.vx; else sh.vy = -sh.vy;
          sh.foldshot = true; // banked shots gain penetration like foldshots
          spawnParticles(sh.x, sh.y, "#c9d6e8", 4); VG.sfx(620, 0.04, "sine", 0.03);
        } else {
          if (sh.blast) blast(sh.x, sh.y, sh.blast, sh.dmg);
          if (state.room.matAtPx(sh.x, sh.y) === VG.MAT.BRASS) ringBell(Math.floor(sh.x / T) * T + 8, Math.floor(sh.y / T) * T + 8);
          sh.life = 0; spawnParticles(sh.x, sh.y, "#ffcf6b", 3);
        }
      }
      // hit enemies
      for (const e of enemies) {
        if (e.dead) continue;
        if (VG.dist(sh.x, sh.y, e.x, e.y) < e.r + sh.r) {
          const fromBehind = Math.sign(sh.vx) === -e.face || sh.foldshot;
          damageEnemy(e, sh.dmg, fromBehind);
          if (sh.blast) blast(sh.x, sh.y, sh.blast, sh.dmg);
          if (sh.pierce <= 0) { sh.life = 0; }
          else sh.pierce--;
          break;
        }
      }
      // hit boss
      if (boss && !boss.dead && VG.dist(sh.x, sh.y, boss.x, boss.y) < boss.r + sh.r) {
        damageBoss(sh.dmg * (sh.foldshot ? 1.5 : 1));
        if (sh.blast) blast(sh.x, sh.y, sh.blast, sh.dmg);
        sh.life = 0;
      }
    }
    shots = shots.filter((s) => s.life > 0);

    /* ---- enemy bolts (deflectable / teleportable) ---- */
    for (const b of bolts) {
      b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt;
      const tpb = portals.tryTeleport(b, b.key, { strain: 0.03 });
      if (tpb) { b.hostileToEnemies = true; b.color = "#8fe9ff"; }
      if (solid(b.x, b.y)) { b.life = 0; continue; }
      // ward deflect — Mirror Litany relic makes deflected/redirected bolts
      // strike far harder and pierce (member of the portal-combat capability set)
      if (player.wardT > 0 && VG.dist(b.x, b.y, player.x, player.y - 8) < 22) {
        b.vx = player.aimx * 300; b.vy = player.aimy * 300; b.hostileToEnemies = true; b.color = "#ffd166";
        if (player.relics["mirror-litany"]) { b.dmg *= 2.2; b.color = "#8fe9ff"; b._pierce = 2; }
        VG.sfx(700, 0.05, "sine", 0.05); continue;
      }
      if (b.hostileToEnemies) {
        for (const e of enemies) { if (!e.dead && VG.dist(b.x, b.y, e.x, e.y) < e.r + b.r) { damageEnemy(e, b.dmg, true); if (b._pierce > 0) b._pierce--; else b.life = 0; break; } }
        if (boss && !boss.dead && VG.dist(b.x, b.y, boss.x, boss.y) < boss.r) { damageBoss(b.dmg * 1.5); if (b._pierce > 0) b._pierce--; else b.life = 0; }
      } else if (VG.dist(b.x, b.y, player.x, player.y - 8) < 12) { hurtPlayer(b.dmg / 4 || 1, Math.sign(b.vx), -0.3); b.life = 0; }
    }
    bolts = bolts.filter((b) => b.life > 0);

    /* ---- rings (bell shockwaves; teleportable) ---- */
    for (const rg of rings) {
      rg.life -= dt; rg.r += rg.vr * dt;
      if (rg.hostile && VG.dist(rg.x, rg.y, player.x, player.y - 8) < rg.r + 4 && VG.dist(rg.x, rg.y, player.x, player.y - 8) > rg.r - 8 && player.iframe <= 0) {
        hurtPlayer(rg.dmg, Math.sign(player.x - rg.x), -0.5);
      }
      if (!rg.hostile) {
        // friendly bell pulse damages enemies/boss it expands across
        for (const e of enemies) { if (!e.dead) { const d = VG.dist(rg.x, rg.y, e.x, e.y); if (Math.abs(d - rg.r) < 8) { damageEnemy(e, rg.dmg, true); } } }
        if (boss && !boss.dead) { const d = VG.dist(rg.x, rg.y, boss.x, boss.y); if (Math.abs(d - rg.r) < 10) damageBoss(rg.dmg * 2); }
      }
    }
    rings = rings.filter((r) => r.life > 0 && r.r < 400);

    /* ---- enemies + boss ---- */
    for (const e of enemies) stepEnemy(e, dt);
    if (boss) stepBoss(boss, dt);
    enemies = enemies.filter((e) => !e.dead || e.hurt > 0);

    /* ---- pickups ---- */
    for (const p of pickups) {
      p.bob += dt;
      if (VG.dist(p.x, p.y, player.x, player.y - 8) < 14) {
        if (p.type === "ash") { player.maxAsh += 20; player.ash = player.maxAsh; toast("+Ash Vessel", p.x, p.y - 10, "#ffcf6b"); }
        else if (p.type === "pulse") { player.maxHp += 1; player.hp = player.maxHp; toast("+Pulse Fragment", p.x, p.y - 10, "#ff9ad0"); }
        else if (p.type === "relic") { player.relics[p.relic] = true; toast("RELIC: " + (p.relic === "mirror-litany" ? "Mirror Litany" : p.relic), p.x, p.y - 12, "#8fe9ff"); VG.sfxBell(200, 0.14); }
        p.dead = true; VG.sfx(660, 0.1, "triangle", 0.05); spawnParticles(p.x, p.y, "#fff", 8);
      }
    }
    pickups = pickups.filter((p) => !p.dead);

    /* ---- particles / text ---- */
    for (const pt of particles) { pt.life -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 120 * dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floatText) { f.life -= dt; f.y -= 14 * dt; }
    floatText = floatText.filter((f) => f.life > 0);

    /* ---- room transitions ---- */
    checkExits();
    // music state
    const inCombat = enemies.some((e) => !e.dead) || boss;
    VG.setMusicState(boss ? "boss" : inCombat ? "combat" : state.shrine && VG.dist(player.x, player.y, state.shrine.x, state.shrine.y) < 20 ? "shrine" : "explore");

    VG.camera.follow(player.x, player.y - 8, VG.camera.x + VG.input.mx, VG.camera.y + VG.input.my, dt);
    VG.input.pressed.clear();
    // strain HUD sync + critical auto
    if (portals.strain >= 1) doCollapse();
  }

  function blast(x, y, radius, dmg) {
    spawnParticles(x, y, "#ff9a5d", 10, 120);
    VG.camera.jolt(0.2); VG.sfxCinder("orb");
    for (const e of enemies) if (!e.dead && VG.dist(x, y, e.x, e.y) < radius) damageEnemy(e, dmg * 0.7, true);
    if (boss && !boss.dead && VG.dist(x, y, boss.x, boss.y) < radius + 10) damageBoss(dmg * 0.7);
  }
  function doCollapse() {
    // critical strain collapse: shockwave, self risk, lock
    rings.push({ x: portals.dawn.x, y: portals.dawn.y, r: 8, vr: 200, dmg: 3, life: 1, hostile: false });
    for (const e of enemies) if (!e.dead && VG.dist(portals.dawn.x, portals.dawn.y, e.x, e.y) < 60) damageEnemy(e, 12, true);
    if (VG.dist(portals.dawn.x, portals.dawn.y, player.x, player.y) < 40) hurtPlayer(1, 0, -0.6);
    portals.collapse();
    VG.camera.jolt(0.5);
    toast("GATE COLLAPSE", player.x, player.y - 28, "#ff8095");
  }
  function tryInteract() {
    if (state.shrine && VG.dist(player.x, player.y, state.shrine.x, state.shrine.y) < 22) {
      player.hp = player.maxHp; player.ash = player.maxAsh;
      VG.save.write({ roomId: state.roomId, hp: player.hp, ash: player.ash, score: state.score, kills: state.kills });
      toast("Wake Shrine — rested", player.x, player.y - 26, "#8fe9ff"); VG.sfxBell(160, 0.1);
    }
  }
  function checkExits() {
    const def = VG.ROOMS[state.roomId];
    for (const ex of (def.exits || [])) {
      if (ex.needBossDead && !(boss && boss.dead) && !state.completeSent) continue;
      const ex0 = ex.gx * T, ey0 = ex.gy * T;
      if (player.x > ex0 - 4 && player.x < ex0 + T + 4 && player.y > ey0 - 12 && player.y < ey0 + T + 12) {
        if (ex.complete) { onFinalWin(); return; }
        loadRoom(ex.to, ex.toSpawn); return;
      }
    }
  }

  /* ================= win / dead ================= */
  function onWin() {
    // Bellmother's fall is the slice's completion milestone AND opens a route
    // into the Glass Ossuary — play continues; walk to the shrine-side gate.
    state.score += 1000;
    if (!state.completeSent) { state.completeSent = true; host("complete", { score: state.score, progress: 100, state: { kills: state.kills, boss: "bellmother" } }); }
    VG.sfxBell(220, 0.2);
    VG.save.write({ roomId: "boss", hp: player.hp, ash: player.ash, score: state.score, kills: state.kills, bossDead: true });
    toast("THE BRONZE IS SILENT — a path opens east", player.x, player.y - 30, "#8fe9ff");
    setHint("Bellmother has fallen. A route into the Glass Ossuary opens to the east.");
  }
  function onFinalWin() {
    state.score += 1500;
    VG.sfxBell(330, 0.28);
    VG.save.write({ roomId: "belfry", hp: player.hp, ash: player.ash, score: state.score, kills: state.kills, bossDead: true, belfryComplete: true });
    host("complete", { score: state.score, progress: 100, state: { kills: state.kills, relic: "upper-belfry", region: "glass-ossuary" } });
    state.phase = "win";
    showOverlay("win");
  }
  function onDead() {
    player.dead = true; state.phase = "dead"; VG.sfx(90, 0.4, "sawtooth", 0.06);
    showOverlay("dead");
  }

  /* ================= rendering ================= */
  function drawScene(cam, entities = true) {
    state.room.draw(ctx, cam, state.t);
    // bells
    for (const b of state.bells || []) {
      ctx.fillStyle = "#7a5a20"; ctx.beginPath(); ctx.moveTo(b.x - 7, b.y - 8); ctx.lineTo(b.x + 7, b.y - 8); ctx.lineTo(b.x + 5, b.y + 8); ctx.lineTo(b.x - 5, b.y + 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,220,120,0.25)"; ctx.fillRect(b.x - 6, b.y - 7, 12, 2);
    }
    // shrine
    if (state.shrine) { ctx.fillStyle = "#2a3a5a"; ctx.fillRect(state.shrine.x - 6, state.shrine.y - 16, 12, 16); ctx.fillStyle = "rgba(143,233,255,0.5)"; ctx.fillRect(state.shrine.x - 4, state.shrine.y - 14, 8, 3); }
    if (!entities) return;
    // pickups
    for (const p of pickups) {
      const yy = p.y + Math.sin(p.bob * 2) * 2;
      if (p.type === "relic") {
        ctx.fillStyle = "#8fe9ff"; ctx.save(); ctx.translate(p.x, yy); ctx.rotate(p.bob);
        ctx.fillRect(-4, -4, 8, 8); ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillRect(-2, -2, 4, 4); ctx.restore();
      } else {
        ctx.fillStyle = p.type === "ash" ? "#ffcf6b" : "#ff9ad0";
        ctx.beginPath(); ctx.arc(p.x, yy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(p.x - 1, yy - 6, 2, 12);
      }
    }
    // rings
    for (const rg of rings) {
      ctx.strokeStyle = rg.hostile ? `rgba(255,120,90,${Math.min(0.6, rg.life)})` : `rgba(143,233,255,${Math.min(0.6, rg.life)})`;
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2); ctx.stroke();
    }
    // enemies
    for (const e of enemies) drawEnemy(e);
    if (boss) drawBoss(boss);
    // bolts
    for (const b of bolts) { ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }
    // player shots
    for (const sh of shots) {
      ctx.fillStyle = sh.foldshot ? "#8fe9ff" : sh.type === "orb" ? "#ff9a5d" : "#ffcf6b";
      ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2); ctx.fill();
      if (sh.type === "orb") { ctx.strokeStyle = "rgba(255,154,93,0.4)"; ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.r + 2, 0, Math.PI * 2); ctx.stroke(); }
    }
    // sniper aim lines
    for (const e of enemies) if (e.type === "sniper" && e.aiming > 0) {
      ctx.strokeStyle = `rgba(255,92,116,${0.3 + Math.sin(state.t * 30) * 0.2})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + e.aimx * 300, e.y + e.aimy * 300); ctx.stroke();
    }
    drawPlayer();
    // particles
    for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.fillRect(p.x - 1, p.y - 1, 2, 2); ctx.globalAlpha = 1; }
    // float text
    for (const f of floatText) { ctx.globalAlpha = Math.min(1, f.life); ctx.fillStyle = f.color; ctx.font = "6px monospace"; ctx.textAlign = "center"; ctx.fillText(f.text, f.x, f.y); ctx.globalAlpha = 1; ctx.textAlign = "left"; }
  }
  function drawEnemy(e) {
    ctx.save(); ctx.translate(e.x, e.y);
    if (e.hurt > 0) ctx.globalAlpha = 0.7;
    if (e.type === "guard") {
      ctx.fillStyle = "#2a2438"; ctx.fillRect(-6, -8, 12, 16);
      ctx.fillStyle = "#5a6a8a"; ctx.fillRect(e.face > 0 ? 4 : -8, -9, 4, 18); // shield
      ctx.fillStyle = "#8a3a3a"; ctx.fillRect(-3, -6, 6, 3);
    } else if (e.type === "sniper") {
      ctx.fillStyle = "#3a2a48"; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ff5c74"; ctx.fillRect(-2, -2, 4, 4);
    } else if (e.type === "leech") {
      ctx.fillStyle = e.onGate ? "#ff9ad0" : "#4a3a5a"; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === "mourner") {
      ctx.globalAlpha *= VG.clamp(e.ghost, 0.25, 1);
      // veiled glass figure
      ctx.fillStyle = "#aeb8d0"; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc(0, -3, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3a4a6a"; ctx.fillRect(-2, -4, 1.5, 2); ctx.fillRect(1, -4, 1.5, 2);
    }
    // hp bar
    if (e.hp < e.maxHp) { ctx.globalAlpha = 1; ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(-6, -13, 12, 2); ctx.fillStyle = "#ff5c74"; ctx.fillRect(-6, -13, 12 * Math.max(0, e.hp / e.maxHp), 2); }
    ctx.restore();
  }
  function drawBoss(b) {
    ctx.save(); ctx.translate(b.x, b.y);
    if (b.hurt > 0) ctx.globalAlpha = 0.75;
    // bronze saint machine
    ctx.fillStyle = "#3a2a12"; ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#7a5a20"; ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,220,120,0.3)"; ctx.beginPath(); ctx.arc(0, -4, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1a1420"; ctx.beginPath(); ctx.arc(-5, -2, 2.5, 0, Math.PI * 2); ctx.arc(5, -2, 2.5, 0, Math.PI * 2); ctx.fill();
    // resonant armor seams glow by phase
    ctx.strokeStyle = `rgba(143,233,255,${0.2 + b.phase * 0.12})`; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 12 + i * 4, b.sweep + i, b.sweep + i + 2); ctx.stroke(); }
    ctx.restore();
  }
  function drawPlayer() {
    const p = player; ctx.save(); ctx.translate(p.x, p.y - 4);
    if (p.iframe > 0 && Math.floor(state.t * 30) % 2) ctx.globalAlpha = 0.4;
    const f = p.facing;
    // mourning cloak
    ctx.fillStyle = "#1a1226"; ctx.beginPath(); ctx.moveTo(-5 * f, -14); ctx.lineTo(6 * f, -12); ctx.lineTo(3 * f, 6); ctx.lineTo(-6 * f, 6); ctx.closePath(); ctx.fill();
    // body / coat
    ctx.fillStyle = "#2a2036"; ctx.fillRect(-4, -14, 8, 18);
    // high collar
    ctx.fillStyle = "#0e0a16"; ctx.fillRect(-4, -16, 8, 4);
    // pale face
    ctx.fillStyle = "#d8c8d8"; ctx.fillRect(-2 + f, -15, 4, 4);
    // LEFT hand: heavy black cinder gauntlet (aim direction)
    const ax = p.aimx, ay = p.aimy;
    ctx.fillStyle = "#0c0a12"; ctx.save(); ctx.translate(ax * 6, -6 + ay * 6); ctx.rotate(Math.atan2(ay, ax));
    ctx.fillRect(0, -3, 9, 6); ctx.fillStyle = p.ash > 10 ? "#ffcf6b" : "#664"; ctx.fillRect(7, -2, 3, 4); ctx.restore();
    // RIGHT hand: pale, luminous fractures (opposite side)
    ctx.fillStyle = "#e8dcf0"; ctx.fillRect(-6 * f - 1, -6, 3, 5);
    ctx.fillStyle = portals.selected === 0 ? "#8fe9ff" : "#ff9ad0"; ctx.fillRect(-6 * f - 1, -6, 3, 1);
    // ward bubble
    if (p.wardT > 0) { ctx.strokeStyle = "rgba(255,209,102,0.6)"; ctx.beginPath(); ctx.arc(0, -6, 16, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }

  /* ---- gate rendering with real destination view ---- */
  function drawGates() {
    for (let i = 0; i < 2; i++) {
      const g = portals.gates[i];
      if (!g.active) continue;
      drawGateDestination(g, portals.gates[1 - i]);
    }
    // rims on top
    for (let i = 0; i < 2; i++) { const g = portals.gates[i]; if (g.active) drawGateRim(g); }
    // placement preview
    if (placePreview && (VG.input.gateHeld || true)) {
      const pv = placePreview;
      if (pv.valid) {
        ctx.strokeStyle = portals.selected === 0 ? "rgba(143,233,255,0.5)" : "rgba(255,154,208,0.5)";
        ctx.lineWidth = 1; const n = VG.portalNormals[pv.dir];
        ctx.save(); ctx.translate(pv.x, pv.y); ctx.rotate(Math.atan2(n.y, n.x) + Math.PI / 2);
        ctx.strokeRect(-18, -2, 36, 4); ctx.restore();
      }
    }
  }
  function drawGateDestination(inG, outG) {
    if (!outG.active || inG.open < 0.3) return;
    const half = inG.half * inG.open;
    // clip to gate mouth rectangle
    ctx.save();
    ctx.beginPath();
    const nx = inG.nx, ny = inG.ny, tx = inG.tx, ty = inG.ty;
    const depth = 30;
    ctx.moveTo(inG.x + tx * half, inG.y + ty * half);
    ctx.lineTo(inG.x - tx * half, inG.y - ty * half);
    ctx.lineTo(inG.x - tx * half + nx * depth, inG.y - ty * half + ny * depth);
    ctx.lineTo(inG.x + tx * half + nx * depth, inG.y + ty * half + ny * depth);
    ctx.closePath();
    ctx.clip();
    // transform: map exit gate's frame onto entry gate's frame so we render the
    // scene as seen through the exit. Translate so outG.x/y aligns to inG.x/y,
    // and orient by the difference of normals.
    const inAng = Math.atan2(inG.ny, inG.nx);
    const outAng = Math.atan2(outG.ny, outG.nx);
    const rot = inAng - outAng + Math.PI;
    ctx.translate(inG.x, inG.y);
    ctx.rotate(rot);
    ctx.translate(-outG.x, -outG.y);
    // dim tint so it reads as "through a gate"
    drawScene(VG.camera, true);
    ctx.restore();
    // color veil over the mouth
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(inG.x + tx * half, inG.y + ty * half);
    ctx.lineTo(inG.x - tx * half, inG.y - ty * half);
    ctx.lineTo(inG.x - tx * half + nx * depth, inG.y - ty * half + ny * depth);
    ctx.lineTo(inG.x + tx * half + nx * depth, inG.y + ty * half + ny * depth);
    ctx.closePath();
    ctx.fillStyle = inG.endpoint === 0 ? "rgba(60,120,180,0.14)" : "rgba(180,80,140,0.14)";
    ctx.fill();
    ctx.restore();
  }
  function drawGateRim(g) {
    const half = g.half * g.open;
    ctx.save(); ctx.translate(g.x, g.y);
    const col = g.endpoint === 0 ? "#8fe9ff" : "#ff9ad0";
    const strainFrac = portals.strain;
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(g.tx * half, g.ty * half); ctx.lineTo(-g.tx * half, -g.ty * half); ctx.stroke();
    // moving glyphs along the rim
    for (let k = -2; k <= 2; k++) {
      const off = ((k / 2) + Math.sin(g.glyphPhase + k) * 0.1);
      const gx = g.tx * half * off, gy = g.ty * half * off;
      ctx.fillStyle = col; ctx.globalAlpha = 0.7 + Math.sin(g.glyphPhase * 2 + k) * 0.3;
      ctx.fillRect(gx - 0.5, gy - 0.5, 1.5, 1.5); ctx.globalAlpha = 1;
    }
    // strain fracture
    if (strainFrac > 0.5) {
      ctx.strokeStyle = `rgba(255,120,90,${(strainFrac - 0.5) * 1.4})`; ctx.lineWidth = 0.8;
      for (let k = 0; k < 4; k++) { const a = k * 1.6 + g.glyphPhase; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * half, Math.sin(a) * half); ctx.stroke(); }
    }
    ctx.restore();
  }

  /* ================= HUD (DOM overlay + canvas) ================= */
  function drawHUD() {
    // Pulse (left) — relates to Cinder Hand
    for (let i = 0; i < player.maxHp; i++) {
      ctx.fillStyle = i < player.hp ? "#ff5c74" : "rgba(120,60,80,0.4)";
      ctx.fillRect(8 + i * 10, 8, 8, 8);
    }
    // Ash bar (left, below)
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(8, 20, 80, 4);
    ctx.fillStyle = "#ffcf6b"; ctx.fillRect(8, 20, 80 * (player.ash / player.maxAsh), 4);
    // shot mode
    ctx.fillStyle = "#eaf2ff"; ctx.font = "6px monospace";
    ctx.fillText(SHOTS[player.shot].name, 8, 34);
    // Strain (right) — relates to Vesper Hand
    const sw = 80;
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(VG.W - sw - 8, 8, sw, 5);
    const st = portals.strain;
    ctx.fillStyle = st > 0.8 ? "#ff5c74" : st > 0.5 ? "#ffcf6b" : "#8fe9ff";
    ctx.fillRect(VG.W - sw - 8, 8, sw * st, 5);
    ctx.textAlign = "right"; ctx.fillStyle = "#8aa"; ctx.fillText("STRAIN", VG.W - 8, 20);
    ctx.fillStyle = portals.selected === 0 ? "#8fe9ff" : "#ff9ad0";
    ctx.fillText(portals.selected === 0 ? "DAWN GATE" : "DUSK GATE", VG.W - 8, 28);
    ctx.textAlign = "left";
    // boss bar
    if (boss && !boss.dead) {
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(60, VG.H - 16, VG.W - 120, 6);
      ctx.fillStyle = "#b8863a"; ctx.fillRect(60, VG.H - 16, (VG.W - 120) * Math.max(0, boss.hp / boss.maxHp), 6);
      ctx.textAlign = "center"; ctx.fillStyle = "#eaf2ff"; ctx.fillText("BELLMOTHER, THE SAINT BENEATH THE BRONZE", VG.W / 2, VG.H - 20); ctx.textAlign = "left";
    }
    // crosshair
    const cx = VG.input.usingPad ? VG.W / 2 + player.aimx * 40 : VG.input.mx;
    const cy = VG.input.usingPad ? VG.H / 2 + player.aimy * 40 : VG.input.my;
    ctx.strokeStyle = "rgba(234,242,255,0.7)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 4, cy); ctx.lineTo(cx - 1, cy); ctx.moveTo(cx + 1, cy); ctx.lineTo(cx + 4, cy);
    ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy - 1); ctx.moveTo(cx, cy + 1); ctx.lineTo(cx, cy + 4); ctx.stroke();
  }

  /* ================= overlays / DOM ================= */
  function showOverlay(kind) { $("[data-vg-overlay]").dataset.kind = kind; $("[data-vg-overlay]").hidden = false; renderOverlay(kind); }
  function hideOverlay() { $("[data-vg-overlay]").hidden = true; }
  function setHint(text) { const h = $("[data-vg-hint]"); if (h) { h.textContent = text; h.hidden = !text; } }
  function renderOverlay(kind) {
    const el = $("[data-vg-overlay]");
    if (kind === "title") {
      const cont = VG.save.read();
      el.innerHTML = `<div class="vg-panel">
        <p class="vg-kick">THE HOLLOW GEOMETRY</p>
        <h1>VESPERGATE</h1>
        <p class="vg-sub">Left hand makes force. Right hand folds space. Turn the room into a weapon.</p>
        <div class="vg-btns">
          ${cont ? `<button class="vg-btn" data-vg-continue>Continue — ${cont.roomId}</button>` : ""}
          <button class="vg-btn vg-primary" data-vg-new>New Game</button>
          <button class="vg-btn" data-vg-settings>Settings</button>
        </div>
        <p class="vg-controls">Move WASD · Jump Space · Dash Shift · Fire L-Click/LT · Gate R-Click/RT · Swap Q/RB · Vent F/Y · Interact E · Map hint below</p>
      </div>`;
    } else if (kind === "dead") {
      el.innerHTML = `<div class="vg-panel"><p class="vg-kick" style="color:#ff5c74">THE FOLD TOOK YOU</p><h1>COLLAPSED</h1><p class="vg-sub">Wake at the last shrine.</p><div class="vg-btns"><button class="vg-btn vg-primary" data-vg-retry>Wake</button><button class="vg-btn" data-vg-title>Title</button></div></div>`;
    } else if (kind === "win") {
      el.innerHTML = `<div class="vg-panel"><p class="vg-kick" style="color:#8fe9ff">THE BELFRY IS OPEN</p><h1>VESPERGATE CLEARED</h1><p class="vg-sub">You carried the Bellmother's silence through the Glass Ossuary and reached the upper aperture. Score ${state.score}.</p><div class="vg-btns"><button class="vg-btn vg-primary" data-vg-title>Return</button></div></div>`;
    } else if (kind === "settings") {
      const s = VG.settings;
      const row = (label, key, min, max, step) => `<label class="vg-set"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-vg-set="${key}"/></label>`;
      const chk = (label, key) => `<label class="vg-set"><span>${label}</span><input type="checkbox" ${s[key] ? "checked" : ""} data-vg-chk="${key}"/></label>`;
      el.innerHTML = `<div class="vg-panel vg-settings"><h1>Settings</h1>
        ${row("Volume", "volume", 0, 1, 0.05)}${row("Music", "music", 0, 1, 0.05)}
        ${row("Screenshake", "shake", 0, 1, 0.1)}${row("Flash", "flash", 0, 1, 0.1)}${row("Motion", "motion", 0.3, 1, 0.1)}
        ${row("Gate snap", "snapStrength", 0, 2, 0.1)}${row("Aim assist", "aimAssist", 0, 1, 0.1)}
        ${row("Damage taken", "damageTaken", 0.25, 1, 0.25)}
        ${chk("Reduced effects", "reducedEffects")}${chk("Hold to charge", "holdToCharge")}${chk("Soft scaling", "softScale")}
        <div class="vg-btns"><button class="vg-btn vg-primary" data-vg-settings-back>Back</button></div></div>`;
    } else if (kind === "pause") {
      el.innerHTML = `<div class="vg-panel"><h1>Paused</h1><div class="vg-btns"><button class="vg-btn vg-primary" data-vg-resume>Resume</button><button class="vg-btn" data-vg-settings>Settings</button><button class="vg-btn" data-vg-title>Title</button></div></div>`;
    }
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    VG.unlockAudio();
    if (b.dataset.vgNew !== undefined) { VG.save.clear(); startGame("fall", null); }
    else if (b.dataset.vgContinue !== undefined) { const s = VG.save.read(); player.hp = s.hp || 6; player.ash = s.ash || 100; state.score = s.score || 0; state.kills = s.kills || 0; startGame(s.bossDead ? "ossuary1" : (s.roomId || "fall"), null); }
    else if (b.dataset.vgRetry !== undefined) { const s = VG.save.read(); startGame(s ? s.roomId : "fall", null); }
    else if (b.dataset.vgTitle !== undefined) { state.phase = "title"; showOverlay("title"); }
    else if (b.dataset.vgSettings !== undefined) { showOverlay("settings"); }
    else if (b.dataset.vgSettingsBack !== undefined) { VG.saveSettings(); showOverlay(state.phase === "paused" ? "pause" : "title"); }
    else if (b.dataset.vgResume !== undefined) { state.phase = "playing"; hideOverlay(); }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.vgSet) { VG.settings[t.dataset.vgSet] = parseFloat(t.value); if (t.dataset.vgSet === "volume" && VG.audio.master) VG.audio.master.gain.value = VG.settings.volume; VG.saveSettings(); }
    if (t.dataset && t.dataset.vgChk) { VG.settings[t.dataset.vgChk] = t.checked; VG.saveSettings(); VG.fit(); }
  });

  function startGame(roomId, spawn) {
    state.phase = "playing"; state.completeSent = false;
    if (roomId === "fall") { player.hp = player.maxHp; player.ash = player.maxAsh; state.score = 0; state.kills = 0; }
    hideOverlay();
    loadRoom(roomId, spawn);
    VG.unlockAudio();
  }

  /* ================= host bridge ================= */
  let soundOn = true;
  window.addEventListener("message", (e) => {
    const d = e.data; if (!d || d.source !== "phantomplay-host") return;
    if (d.type === "settings" && typeof d.sound === "boolean") { soundOn = d.sound; VG.setMuted(!soundOn); }
    if (d.type === "settings" && d.reducedMotion) { VG.settings.motion = 0.5; VG.settings.reducedEffects = true; VG.settings.shake = 0.3; }
    if (d.type === "pause") { if (state.phase === "playing") { state.phase = "paused"; showOverlay("pause"); } }
    if (d.type === "resume") { if (state.phase === "paused") { state.phase = "playing"; hideOverlay(); } }
    if (d.type === "restart") startGame("fall", null);
  });

  /* ================= main loop ================= */
  let last = 0;
  function frame(now) {
    if (!last) last = now;
    let dt = Math.min(0.033, (now - last) / 1000); last = now;
    VG.pollPad();
    // global pause key
    if (VG.input.pressed.has("Escape") || VG.input.pressed.has("PadStart")) {
      if (state.phase === "playing") { state.phase = "paused"; showOverlay("pause"); }
      else if (state.phase === "paused") { state.phase = "playing"; hideOverlay(); }
      VG.input.pressed.delete("Escape");
    }
    if (state.phase === "playing") simulate(dt);
    else VG.input.pressed.clear();

    // render
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, VG.H);
    g.addColorStop(0, "#070510"); g.addColorStop(0.6, "#0c0a1a"); g.addColorStop(1, "#141024");
    ctx.fillStyle = g; ctx.fillRect(0, 0, VG.W, VG.H);
    if (state.room) {
      // parallax hint
      ctx.fillStyle = "rgba(40,30,70,0.4)";
      for (let i = 0; i < 6; i++) { const px = (i * 140 - VG.camera.x * 0.3) % (VG.W + 140) - 70; ctx.fillRect(px, 40 + (i % 2) * 30, 60, 200); }
      VG.camera.apply(ctx);
      drawScene(VG.camera, true);
      drawGates();
      VG.camera.reset(ctx);
      drawHUD();
    }
    requestAnimationFrame(frame);
  }

  /* ================= boot ================= */
  VG.fit();
  showOverlay("title");
  host("ready", { title: "Vespergate" });
  requestAnimationFrame(frame);

  /* ================= test hook ================= */
  window.__VespergateTest = {
    state: () => ({
      phase: state.phase, room: state.roomId, hp: player.hp, ash: Math.round(player.ash),
      px: +player.x.toFixed(1), py: +player.y.toFixed(1), vx: +player.vx.toFixed(1), vy: +player.vy.toFixed(1),
      strain: +portals.strain.toFixed(2), gates: portals.gates.map((g) => g.active), selected: portals.selected,
      shots: shots.length, enemies: enemies.filter((e) => !e.dead).length, bossHp: boss ? boss.hp : null,
      score: state.score, kills: state.kills, completeSent: state.completeSent,
    }),
    start: (room) => startGame(room || "fall", null),
    placeGate: (endpoint, x, y, dir) => { portals.selected = endpoint; portals.place(endpoint, x, y, dir, true); },
    teleportTest: (ent) => portals.tryTeleport(ent, "test" + Math.random(), { strain: 0.05, force: true }),
    setPlayer: (x, y, vx, vy) => { player.x = x; player.y = y; if (vx != null) player.vx = vx; if (vy != null) player.vy = vy; },
    fire: () => fire(),
    tick: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) simulate(dt); },
    portals, player,
  };
})();
