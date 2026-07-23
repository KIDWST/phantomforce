/* Phantom Ages — an Age-of-War-style lane pusher, built for PhantomPlay.
 *
 * v2 — "way better": animated characters, a rotating base cannon that
 * auto-fires, visible projectiles + hit sparks + death puffs, a full upgrade
 * shop (Cannon / Economy / Fortress tracks) on top of the era-branch tree,
 * and a much faster coin economy so the fun starts immediately.
 *
 * Engineering notes (unchanged discipline):
 *  - Fixed-timestep simulation, decoupled from render/rAF rate.
 *  - Units, popups, projectiles and particles are pooled — no allocation in
 *    the hot loop past initial setup.
 *  - Damage is applied at fire time (deterministic); projectiles/particles
 *    are purely visual so the sim + test hook stay exact.
 */
(function () {
  "use strict";

  // Theme music — PhantomScore (app/games/shared/phantomScore.js), driven by
  // theme.js's GAME_THEME. Real composition, zero audio files, zero CSP
  // change (see app/games/shared/phantomScore.schema.md).
  const score = (window.PhantomScore && window.GAME_THEME)
    ? window.PhantomScore.create(window.GAME_THEME) : null;
  addEventListener("message", (e) => {
    if (e.data?.source !== "phantomplay-host" || e.data.type !== "settings" || !score) return;
    if (e.data.sound !== false) score.unmute(); else score.mute();
  });
  addEventListener("pointerdown", () => { if (score) score.start(); }, { once: true });

  const LANE_LENGTH = 620;    // world units, player base at 0, enemy base at LANE_LENGTH
  const SPEED_SCALE = 1.5;    // units march faster so the first clash lands in ~5s, not 30s
  const TICK_SECONDS = 1 / 60;
  const START_GOLD = 120;

  const TURRET = { range: 240, damage: 26, cooldown: 1.4 };
  const MANUAL_OVERCHARGE_CD = 6; // seconds between manual "Overcharge" volleys

  // VIEW = the battlefield's CSS-pixel size, kept in sync with the canvas box.
  // All world→screen math uses this, so the field is never squished on mobile.
  const VIEW = { w: 1280, h: 420 };

  const reduceMotion = (() => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();

  // ---------------------------------------------------------------------
  // Unit data — `art` picks the character silhouette + weapon; `type` gates
  // ranged projectiles.
  // ---------------------------------------------------------------------
  const UNITS = {
    clubman:     { name: "Clubman",      cost: 20,  hp: 45,  attack: 7,   range: 18,  speed: 40, cooldown: 0.9, era: 0, type: "melee",  art: "club" },
    rockThrower: { name: "Rock Thrower", cost: 35,  hp: 30,  attack: 9,   range: 80,  speed: 30, cooldown: 1.2, era: 0, type: "ranged", art: "sling" },
    swordsman:   { name: "Swordsman",    cost: 50,  hp: 80,  attack: 12,  range: 20,  speed: 42, cooldown: 0.85,era: 1, type: "melee",  art: "sword" },
    archer:      { name: "Archer",       cost: 65,  hp: 45,  attack: 14,  range: 100, speed: 34, cooldown: 1.0, era: 1, type: "ranged", art: "bow" },
    knight:      { name: "Knight",       cost: 95,  hp: 140, attack: 18,  range: 22,  speed: 44, cooldown: 0.8, era: 2, type: "melee",  art: "lance" },
    crossbow:    { name: "Crossbowman",  cost: 115, hp: 75,  attack: 22,  range: 120, speed: 34, cooldown: 1.1, era: 2, type: "ranged", art: "crossbow" },
    // Industrial+ (path-specific)
    rifleman:    { name: "Rifleman",     cost: 160, hp: 165, attack: 30,  range: 150, speed: 38, cooldown: 0.6, era: 3, path: "military", type: "ranged", art: "rifle" },
    grenadier:   { name: "Grenadier",    cost: 220, hp: 150, attack: 50,  range: 110, speed: 28, cooldown: 1.3, era: 3, path: "military", type: "ranged", art: "launcher" },
    drone:       { name: "Drone Scout",  cost: 150, hp: 90,  attack: 20,  range: 170, speed: 52, cooldown: 0.45,era: 3, path: "tech", type: "ranged", art: "drone", fly: true },
    tesla:       { name: "Tesla Trooper",cost: 240, hp: 155, attack: 38,  range: 130, speed: 34, cooldown: 0.9, era: 3, path: "tech", type: "ranged", art: "tesla" },
    mech:        { name: "Mech Warrior", cost: 400, hp: 360, attack: 66,  range: 160, speed: 36, cooldown: 0.65,era: 4, path: "military", type: "ranged", art: "mech" },
    plasma:      { name: "Plasma Trooper",cost: 460,hp: 240, attack: 88,  range: 180, speed: 34, cooldown: 0.95,era: 4, path: "military", type: "ranged", art: "plasma" },
    nanoSwarm:   { name: "Nano Swarm",   cost: 380, hp: 170, attack: 44,  range: 190, speed: 56, cooldown: 0.35,era: 4, path: "tech", type: "ranged", art: "swarm", fly: true },
    aiSentinel:  { name: "AI Sentinel",  cost: 520, hp: 300, attack: 78,  range: 210, speed: 32, cooldown: 0.85,era: 4, path: "tech", type: "ranged", art: "sentinel" },
  };

  const ERAS = [
    { name: "Stone Age",      advanceCost: 0,    unitIds: ["clubman", "rockThrower"] },
    { name: "Bronze Age",     advanceCost: 140,  unitIds: ["swordsman", "archer"] },
    { name: "Iron Age",       advanceCost: 320,  unitIds: ["knight", "crossbow"] },
    { name: "Industrial Age", advanceCost: 620,  unitIds: null },
    { name: "Future Age",     advanceCost: 1200, unitIds: null },
  ];
  const PATH_UNITS = {
    military: { 3: ["rifleman", "grenadier"], 4: ["mech", "plasma"] },
    tech:     { 3: ["drone", "tesla"], 4: ["nanoSwarm", "aiSentinel"] },
  };
  const BRANCH_ERA_INDEX = 3;

  function unitsForEra(eraIndex, path) {
    if (eraIndex < BRANCH_ERA_INDEX) return ERAS[eraIndex].unitIds;
    return (path && PATH_UNITS[path] && PATH_UNITS[path][eraIndex]) || [];
  }

  // ---------------------------------------------------------------------
  // Upgrade shop — three tracks, each with levels. `cost(level)` and the
  // derived-stat helpers below read the current level off `side.up`.
  // ---------------------------------------------------------------------
  const UPGRADES = [
    { id: "cannonDmg",  label: "Cannon Power",  icon: "🎯", track: "Cannon",   max: 6, cost: (l) => 55 + l * 55 },
    { id: "cannonRate", label: "Fire Rate",     icon: "⚡", track: "Cannon",   max: 5, cost: (l) => 70 + l * 70 },
    { id: "cannonRange",label: "Cannon Range",  icon: "📡", track: "Cannon",   max: 5, cost: (l) => 45 + l * 45 },
    { id: "cannonMulti",label: "Multi-Shot",    icon: "🔱", track: "Cannon",   max: 3, cost: (l) => 160 + l * 150 },
    { id: "income",     label: "Gold Income",   icon: "💰", track: "Economy",  max: 6, cost: (l) => 60 + l * 55 },
    { id: "bounty",     label: "Kill Bounty",   icon: "🏆", track: "Economy",  max: 4, cost: (l) => 90 + l * 80 },
    { id: "baseHp",     label: "Fortress Walls",icon: "🛡", track: "Fortress", max: 5, cost: (l) => 80 + l * 75 },
    { id: "regen",      label: "Auto-Repair",   icon: "🔧", track: "Fortress", max: 4, cost: (l) => 110 + l * 90 },
  ];
  const upById = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

  const turretDamage   = (s) => TURRET.damage + s.up.cannonDmg * 16 + s.eraIndex * 4;
  const turretCooldown = (s) => TURRET.cooldown * Math.pow(0.82, s.up.cannonRate) * (s.path === "tech" ? 0.75 : 1);
  // A fully-upgraded cannon reaches exactly half the lane at max level — it
  // should out-range early units but never reach the enemy's own base/spawn
  // line, and never overshoot its own cannonball's travel-time visual (see
  // spawnProjectile).
  const TURRET_RANGE_PER_LEVEL = (LANE_LENGTH / 2 - TURRET.range) / upById.cannonRange.max; // = 14
  const turretRange    = (s) => TURRET.range + s.up.cannonRange * TURRET_RANGE_PER_LEVEL;
  const turretTargets  = (s) => 1 + s.up.cannonMulti;
  const incomePerSec   = (s) => 9 + s.eraIndex * 3 + s.up.income * 6;
  const killBounty     = (s) => 0.5 + s.up.bounty * 0.18;
  const baseRegen      = (s) => s.up.regen * 6; // hp/sec

  // ---------------------------------------------------------------------
  // Pools
  // ---------------------------------------------------------------------
  const unitPool = new ObjectPool(
    () => ({ alive: false, side: "player", unitId: null, x: 0, hp: 0, maxHp: 0, cooldown: 0, walk: 0, atk: 0, flash: 0 }),
    (u) => { u.alive = false; u.walk = 0; u.atk = 0; u.flash = 0; }
  );
  const popupPool = new ObjectPool(
    () => ({ alive: false, x: 0, y: 0, text: "", life: 0, color: "", vy: 0 }),
    (p) => { p.alive = false; }
  );
  const projPool = new ObjectPool(
    () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, color: "", size: 2, trail: false }),
    (p) => { p.alive = false; }
  );
  const partPool = new ObjectPool(
    () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, color: "", size: 2, grav: 0 }),
    (p) => { p.alive = false; }
  );

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  function freshSide(startX) {
    return {
      gold: START_GOLD, baseHp: 550, baseMaxHp: 550,
      eraIndex: 0, path: null,
      turretCooldown: 0, turretAngle: 0, turretRecoil: 0,
      manualCd: 0,
      up: { cannonDmg: 0, cannonRate: 0, cannonRange: 0, cannonMulti: 0, income: 0, bounty: 0, baseHp: 0, regen: 0 },
      units: [], baseX: startX,
    };
  }
  const state = {
    player: freshSide(0), enemy: freshSide(LANE_LENGTH),
    popups: [], projectiles: [], particles: [],
    t: 0, over: false, winner: null, aiTimer: 0, aiUpTimer: 0,
    shake: 0, accumulator: 0, lastFrameTime: 0,
  };
  let paused = false;
  let completionSent = false;
  let lastPersistAt = 0;

  function host(type, payload = {}) {
    try {
      parent.postMessage({ source: "phantomplay-game", type, ...payload }, "*");
    } catch {}
  }

  function resetGame() {
    for (const u of state.player.units) unitPool.release(u);
    for (const u of state.enemy.units) unitPool.release(u);
    for (const p of state.popups) popupPool.release(p);
    for (const p of state.projectiles) projPool.release(p);
    for (const p of state.particles) partPool.release(p);
    state.player = freshSide(0); state.enemy = freshSide(LANE_LENGTH);
    state.popups = []; state.projectiles = []; state.particles = [];
    state.t = 0; state.over = false; state.winner = null; state.aiTimer = 0; state.aiUpTimer = 4; state.shake = 0;
    state.accumulator = 0; state.lastFrameTime = 0;
    completionSent = false;
  }

  function sideSave(side) {
    return {
      gold: Math.max(0, Math.round(side.gold * 10) / 10),
      baseHp: Math.max(0, Math.round(side.baseHp * 10) / 10),
      baseMaxHp: Math.max(1, Math.round(side.baseMaxHp)),
      eraIndex: Math.max(0, Math.min(ERAS.length - 1, Number(side.eraIndex) || 0)),
      path: side.path === "military" || side.path === "tech" ? side.path : null,
      manualCd: Math.max(0, Number(side.manualCd) || 0),
      up: Object.fromEntries(UPGRADES.map((upgrade) => [
        upgrade.id,
        Math.max(0, Math.min(upgrade.max, Number(side.up?.[upgrade.id]) || 0)),
      ])),
      units: side.units.filter((unit) => unit.alive && UNITS[unit.unitId]).slice(0, 80).map((unit) => ({
        unitId: unit.unitId,
        x: Math.max(0, Math.min(LANE_LENGTH, Number(unit.x) || 0)),
        hp: Math.max(1, Math.min(unit.maxHp, Number(unit.hp) || 1)),
        cooldown: Math.max(0, Number(unit.cooldown) || 0),
      })),
    };
  }

  function saveState(completed = false) {
    return {
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      completed,
      elapsedSeconds: Math.max(0, Math.round(state.t)),
      player: sideSave(state.player),
      enemy: sideSave(state.enemy),
    };
  }

  function restoreSide(target, source, fallbackX) {
    const fresh = freshSide(fallbackX);
    const input = source && typeof source === "object" ? source : {};
    const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    fresh.gold = Math.max(0, finiteOr(input.gold, START_GOLD));
    fresh.baseMaxHp = Math.max(1, finiteOr(input.baseMaxHp, 550));
    fresh.baseHp = Math.max(0, Math.min(fresh.baseMaxHp, finiteOr(input.baseHp, fresh.baseMaxHp)));
    fresh.eraIndex = Math.max(0, Math.min(ERAS.length - 1, Number(input.eraIndex) || 0));
    fresh.path = input.path === "military" || input.path === "tech" ? input.path : null;
    fresh.manualCd = Math.max(0, Number(input.manualCd) || 0);
    for (const upgrade of UPGRADES) {
      fresh.up[upgrade.id] = Math.max(0, Math.min(upgrade.max, Number(input.up?.[upgrade.id]) || 0));
    }
    for (const savedUnit of Array.isArray(input.units) ? input.units.slice(0, 80) : []) {
      const def = UNITS[savedUnit?.unitId];
      if (!def) continue;
      const unit = unitPool.acquire();
      unit.alive = true;
      unit.side = target;
      unit.unitId = savedUnit.unitId;
      unit.x = Math.max(0, Math.min(LANE_LENGTH, Number(savedUnit.x) || fallbackX));
      unit.hp = Math.max(1, Math.min(def.hp, Number(savedUnit.hp) || def.hp));
      unit.maxHp = def.hp;
      unit.cooldown = Math.max(0, Number(savedUnit.cooldown) || 0);
      unit.walk = 0; unit.atk = 0; unit.flash = 0;
      fresh.units.push(unit);
    }
    return fresh;
  }

  function migrateSave(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (Number(raw.schemaVersion) >= 2) return raw;
    // Early development saves only carried top-level gold/era fields. Keep
    // them readable instead of turning a catalog update into a silent wipe.
    return {
      schemaVersion: 2,
      elapsedSeconds: Number(raw.elapsedSeconds || raw.t) || 0,
      player: raw.player || {
        gold: raw.playerGold,
        baseHp: raw.playerBaseHp,
        eraIndex: raw.playerEraIndex,
        path: raw.playerPath,
        up: raw.playerUp,
      },
      enemy: raw.enemy || {
        gold: raw.enemyGold,
        baseHp: raw.enemyBaseHp,
        eraIndex: raw.enemyEraIndex,
        path: raw.enemyPath,
        up: raw.enemyUp,
      },
    };
  }

  function applySave(raw) {
    const saved = migrateSave(raw);
    if (!saved) return false;
    resetGame();
    if (saved.completed === true) return true;
    state.player = restoreSide("player", saved.player, 0);
    state.enemy = restoreSide("enemy", saved.enemy, LANE_LENGTH);
    state.t = Math.max(0, Number(saved.elapsedSeconds) || 0);
    state.aiUpTimer = 2;
    endModal.hidden = true;
    renderHud();
    return true;
  }

  function scoreForState() {
    return Math.max(0, Math.round((state.enemy.baseMaxHp - state.enemy.baseHp) + state.player.eraIndex * 150 + state.t));
  }

  function persistProgress(force = false) {
    const current = performance.now();
    if (!force && current - lastPersistAt < 5000) return;
    lastPersistAt = current;
    host("progress", {
      score: scoreForState(),
      progress: Math.max(0, Math.min(99, Math.round((state.player.eraIndex / (ERAS.length - 1)) * 60 + (1 - state.enemy.baseHp / state.enemy.baseMaxHp) * 39))),
      state: saveState(),
    });
  }

  function spawnUnit(side, unitId) {
    const def = UNITS[unitId];
    if (!def || side.gold < def.cost) return false;
    side.gold -= def.cost;
    const u = unitPool.acquire();
    u.alive = true;
    u.side = side === state.player ? "player" : "enemy";
    u.unitId = unitId;
    u.x = side === state.player ? 14 : LANE_LENGTH - 14;
    u.hp = def.hp; u.maxHp = def.hp; u.cooldown = 0; u.walk = Math.random() * 6; u.atk = 0; u.flash = 0;
    side.units.push(u);
    return true;
  }

  function buyUpgrade(side, id) {
    const def = upById[id]; if (!def) return false;
    const lvl = side.up[id];
    if (lvl >= def.max) return false;
    const cost = def.cost(lvl);
    if (side.gold < cost) return false;
    side.gold -= cost;
    side.up[id] = lvl + 1;
    if (id === "baseHp") { side.baseMaxHp += 220; side.baseHp = Math.min(side.baseMaxHp, side.baseHp + 220); }
    return true;
  }

  function spawnPopup(x, y, text, color, vy) {
    const p = popupPool.acquire();
    p.alive = true; p.x = x; p.y = y; p.text = text; p.life = 0.9; p.color = color; p.vy = vy || -26;
    state.popups.push(p);
  }
  function spawnProjectile(x, y, tx, ty, color, size, trail) {
    if (reduceMotion || state.projectiles.length > 90) return;
    const p = projPool.acquire();
    const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy) || 1;
    const sp = 640;
    p.alive = true; p.x = x; p.y = y; p.vx = (dx / d) * sp; p.vy = (dy / d) * sp;
    // Hit/damage is applied instantly at fire time (see fireTurret/stepUnits) —
    // this is purely the visual travel. It must last exactly as long as the
    // real flight so a long-range shot never vanishes before it visually
    // reaches its target (that desync read as "random" delayed deaths).
    p.life = Math.min(2.2, d / sp); p.color = color; p.size = size || 2.5; p.trail = !!trail;
    state.projectiles.push(p);
  }
  function spawnParticles(x, y, color, n, spread, grav) {
    if (reduceMotion) return;
    n = Math.min(n, 130 - state.particles.length);
    for (let i = 0; i < n; i++) {
      const p = partPool.acquire();
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * (spread || 120);
      p.alive = true; p.x = x; p.y = y; p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 40;
      p.life = 0.3 + Math.random() * 0.4; p.maxLife = p.life; p.color = color;
      p.size = 1.5 + Math.random() * 2.5; p.grav = grav == null ? 320 : grav;
      state.particles.push(p);
    }
  }

  // ---------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------
  const groundY = () => VIEW.h - 24;
  const unitScreen = (u) => worldToScreen(u.x);

  function nearestEnemyUnit(oppSide, x) {
    let best = null, bestDist = Infinity;
    for (const u of oppSide.units) { if (!u.alive) continue; const d = Math.abs(u.x - x); if (d < bestDist) { bestDist = d; best = u; } }
    return best;
  }

  function killUnit(target, byside) {
    target.alive = false;
    byside.gold += Math.round(UNITS[target.unitId].cost * killBounty(byside));
    const sx = worldToScreen(target.x);
    spawnParticles(sx, groundY() - 14, target.side === "player" ? "#41ffa1" : "#ff5c74", 12, 150, 260);
    spawnPopup(target.x, -60, "💥", "#ffd166", -34);
  }

  function stepUnits(mySide, oppSide, movingRight, dt) {
    for (const u of mySide.units) {
      if (!u.alive) continue;
      const def = UNITS[u.unitId];
      u.atk = Math.max(0, u.atk - dt);
      u.flash = Math.max(0, u.flash - dt);
      const target = nearestEnemyUnit(oppSide, u.x);
      const distToBase = movingRight ? (oppSide.baseX - u.x) : (u.x - oppSide.baseX);
      const targetDist = target ? Math.abs(target.x - u.x) : distToBase;
      const inRangeOfUnit = target && targetDist <= def.range;
      const inRangeOfBase = !target && distToBase <= def.range;

      if (inRangeOfUnit || inRangeOfBase) {
        u.cooldown -= dt;
        if (u.cooldown <= 0) {
          u.cooldown = def.cooldown;
          u.atk = 0.22; u.flash = 0.12;
          const gy = groundY() - (def.fly ? 46 : 22);
          const muzzleX = unitScreen(u) + (movingRight ? 12 : -12);
          if (inRangeOfUnit) {
            target.hp -= def.attack;
            if (def.type === "ranged") spawnProjectile(muzzleX, gy, unitScreen(target), groundY() - 16, u.side === "player" ? "#8effc9" : "#ffb0bd", 2.5, true);
            spawnParticles(unitScreen(target), groundY() - 16, "#ffffff", 4, 70, 200);
            spawnPopup(target.x, -34, `-${def.attack}`, u.side === "player" ? "#41ffa1" : "#ff5c74");
            if (target.hp <= 0) killUnit(target, mySide);
          } else {
            oppSide.baseHp -= def.attack;
            if (def.type === "ranged") spawnProjectile(muzzleX, gy, worldToScreen(oppSide.baseX), groundY() - 60, "#ffe08a", 3, true);
            spawnPopup(oppSide.baseX + (movingRight ? -20 : 20), -50, `-${def.attack}`, "#ffe08a");
            if (mySide === state.player || oppSide === state.player) state.shake = Math.min(6, state.shake + 1.4);
          }
        }
      } else {
        u.x += (movingRight ? 1 : -1) * def.speed * SPEED_SCALE * dt;
        u.walk += dt * 10;
      }
    }
    if (mySide.units.some((u) => !u.alive)) {
      mySide.units = mySide.units.filter((u) => { if (u.alive) return true; unitPool.release(u); return false; });
    }
  }

  function fireTurret(mySide, oppSide, movingRight, manual) {
    if (!manual && mySide.turretCooldown > 0) return;
    const range = turretRange(mySide), dmg = turretDamage(mySide) * (manual ? 1.5 : 1);
    // gather up to N nearest targets in range
    const cand = [];
    for (const u of oppSide.units) { if (!u.alive) continue; const d = Math.abs(u.x - mySide.baseX); if (d <= range) cand.push({ u, d }); }
    cand.sort((a, b) => a.d - b.d);
    const n = manual ? Math.max(3, turretTargets(mySide) + 2) : turretTargets(mySide);
    const hit = cand.slice(0, n);
    mySide.turretCooldown = manual ? mySide.turretCooldown : turretCooldown(mySide);
    mySide.turretRecoil = 1;
    const baseSx = worldToScreen(mySide.baseX);
    const py = baseTopY(mySide);
    if (hit.length) {
      mySide.turretAngle = Math.atan2((groundY() - 16) - py, unitScreen(hit[0].u) - baseSx);
      for (const { u } of hit) {
        u.hp -= dmg;
        spawnProjectile(baseSx + (movingRight ? 16 : -16), py, unitScreen(u), groundY() - 16, "#1ef0ff", 3.5, true);
        spawnParticles(unitScreen(u), groundY() - 16, "#1ef0ff", 6, 110, 220);
        spawnPopup(u.x, -50, `-${Math.round(dmg)}`, "#1ef0ff");
        if (u.hp <= 0) killUnit(u, mySide);
      }
    }
  }

  function aiThink(dt) {
    if (state.over) return;
    const e = state.enemy;
    state.aiTimer -= dt;
    if (state.aiTimer <= 0) {
      state.aiTimer = 0.9 + Math.random() * 0.8;
      const avail = unitsForEra(e.eraIndex, e.path).filter((id) => UNITS[id].cost <= e.gold);
      if (avail.length && Math.random() < 0.88) spawnUnit(e, avail[Math.floor(Math.random() * avail.length)]);
      if (Math.random() < 0.35) fireTurret(e, state.player, false, false);
    }
    // AI invests in upgrades + eras over time so it ramps
    state.aiUpTimer -= dt;
    if (state.aiUpTimer <= 0) {
      state.aiUpTimer = 3 + Math.random() * 3;
      const picks = ["cannonDmg", "income", "cannonRate", "baseHp", "cannonMulti"];
      const id = picks[Math.floor(Math.random() * picks.length)];
      if (e.gold > upById[id].cost(e.up[id]) * 1.6) buyUpgrade(e, id);
      const next = ERAS[e.eraIndex + 1];
      if (next && e.gold >= next.advanceCost * 1.2 && state.t > (e.eraIndex + 1) * 18) {
        advanceEra(e, e.eraIndex + 1 === BRANCH_ERA_INDEX ? (Math.random() < 0.5 ? "military" : "tech") : undefined);
      }
    }
    e.turretCooldown -= dt;
    if (e.turretCooldown <= 0) fireTurret(e, state.player, false, false);
  }

  function advanceEra(side, chosenPath) {
    const nextIndex = side.eraIndex + 1;
    const era = ERAS[nextIndex];
    if (!era || side.gold < era.advanceCost) return false;
    side.gold -= era.advanceCost;
    side.eraIndex = nextIndex;
    side.baseMaxHp += 140;
    side.baseHp = Math.min(side.baseMaxHp, side.baseHp + 160);
    if (nextIndex === BRANCH_ERA_INDEX) side.path = chosenPath || side.path || "military";
    const sx = worldToScreen(side.baseX);
    spawnParticles(sx, baseTopY(side), side === state.player ? "#1ef0ff" : "#ff9a5c", 26, 200, -40);
    return true;
  }

  function simulateTick(dt) {
    if (state.over) return;
    state.t += dt;
    state.player.gold += incomePerSec(state.player) * dt;
    state.enemy.gold += incomePerSec(state.enemy) * dt;
    // fortress auto-repair
    state.player.baseHp = Math.min(state.player.baseMaxHp, state.player.baseHp + baseRegen(state.player) * dt);
    state.enemy.baseHp = Math.min(state.enemy.baseMaxHp, state.enemy.baseHp + baseRegen(state.enemy) * dt);

    state.player.turretCooldown = Math.max(0, state.player.turretCooldown - dt);
    state.player.manualCd = Math.max(0, state.player.manualCd - dt);
    state.player.turretRecoil = Math.max(0, state.player.turretRecoil - dt * 5);
    state.enemy.turretRecoil = Math.max(0, state.enemy.turretRecoil - dt * 5);
    state.shake = Math.max(0, state.shake - dt * 12);

    // player turret auto-fires (aim handled in fireTurret)
    if (state.player.turretCooldown <= 0) fireTurret(state.player, state.enemy, true, false);

    stepUnits(state.player, state.enemy, true, dt);
    stepUnits(state.enemy, state.player, false, dt);
    aiThink(dt);

    for (let i = state.popups.length - 1; i >= 0; i--) { const p = state.popups[i]; p.life -= dt; p.y += p.vy * dt; if (p.life <= 0) { popupPool.release(p); state.popups.splice(i, 1); } }
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const p = state.projectiles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) { spawnParticles(p.x, p.y, p.color, 3, 60, 180); projPool.release(p); state.projectiles.splice(i, 1); }
    }
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i]; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) { partPool.release(p); state.particles.splice(i, 1); }
    }

    if (state.enemy.baseHp <= 0 && !state.over) { state.over = true; state.winner = "player"; }
    else if (state.player.baseHp <= 0 && !state.over) { state.over = true; state.winner = "enemy"; }
  }

  // ---------------------------------------------------------------------
  // Rendering — DPR-aware, sized to the canvas's real CSS box so nothing is
  // ever squished (this is what made it look broken on phones).
  // ---------------------------------------------------------------------
  const canvas = document.getElementById("battlefield");
  const ctx = canvas.getContext("2d");
  let DPR = 1;
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    VIEW.w = Math.max(320, Math.round(rect.width));
    VIEW.h = Math.max(200, Math.round(rect.height));
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(VIEW.w * DPR);
    canvas.height = Math.round(VIEW.h * DPR);
  }
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", resizeCanvas, { passive: true });
  resizeCanvas();

  function worldToScreen(x) { return (x / LANE_LENGTH) * VIEW.w; }
  function baseHeight(side) { return Math.min(VIEW.h * 0.42, 96 + side.eraIndex * 18); }
  function baseTopY(side) { return VIEW.h - 22 - baseHeight(side); }
  const uScale = () => Math.max(0.85, Math.min(1.6, VIEW.h / 300)); // characters scale with field height

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
    g.addColorStop(0, "#0a1a2b"); g.addColorStop(0.55, "#07131f"); g.addColorStop(1, "#04070c");
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    // far hills (two parallax bands)
    ctx.fillStyle = "rgba(28,58,86,0.35)";
    ctx.beginPath(); ctx.moveTo(0, VIEW.h - 22);
    for (let x = 0; x <= VIEW.w; x += 48) ctx.lineTo(x, VIEW.h - 46 - Math.abs(Math.sin(x * 0.012)) * 30);
    ctx.lineTo(VIEW.w, VIEW.h); ctx.lineTo(0, VIEW.h); ctx.fill();
    ctx.fillStyle = "rgba(20,44,66,0.5)";
    ctx.beginPath(); ctx.moveTo(0, VIEW.h - 22);
    for (let x = 0; x <= VIEW.w; x += 70) ctx.lineTo(x, VIEW.h - 30 - Math.abs(Math.cos(x * 0.008 + 1)) * 20);
    ctx.lineTo(VIEW.w, VIEW.h); ctx.lineTo(0, VIEW.h); ctx.fill();
    // ground
    ctx.fillStyle = "#0e1d29"; ctx.fillRect(0, VIEW.h - 22, VIEW.w, 22);
    ctx.strokeStyle = "rgba(120,200,255,0.14)"; ctx.beginPath(); ctx.moveTo(0, VIEW.h - 22); ctx.lineTo(VIEW.w, VIEW.h - 22); ctx.stroke();
  }

  // --- Upgradeable stone tower + cannon. The cannon visibly grows with the
  //     player's Cannon upgrades: extra barrels (multi-shot), longer + brighter
  //     barrel (power), a glowing core (fire-rate). ---
  function drawTower(side, stone, flag, faceRight) {
    const sx = worldToScreen(side.baseX);
    const h = baseHeight(side), topY = VIEW.h - 22 - h;
    const w = 48 + side.eraIndex * 6;
    const half = w / 2;
    // wall with brick rows
    const g = ctx.createLinearGradient(sx - half, 0, sx + half, 0);
    g.addColorStop(0, stone); g.addColorStop(0.5, "rgba(255,255,255,0.12)"); g.addColorStop(1, stone);
    ctx.fillStyle = stone; ctx.fillRect(sx - half, topY, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    for (let ry = topY + 12; ry < VIEW.h - 22; ry += 14) ctx.fillRect(sx - half, ry, w, 1.5);
    for (let ry = topY + 12, r = 0; ry < VIEW.h - 22; ry += 14, r++) { const off = r % 2 ? 0 : w / 3; ctx.fillRect(sx - half + off, ry - 14, 1.5, 14); ctx.fillRect(sx - half + off + w / 3, ry - 14, 1.5, 14); }
    // highlight edge
    ctx.fillStyle = g; ctx.globalAlpha = 0.25; ctx.fillRect(sx - half, topY, w, h); ctx.globalAlpha = 1;
    // battlements
    ctx.fillStyle = stone;
    for (let i = -half; i <= half - 8; i += 13) ctx.fillRect(sx + i, topY - 9, 9, 9);
    // gate
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.moveTo(sx - 9, VIEW.h - 22); ctx.lineTo(sx - 9, VIEW.h - 22 - 22); ctx.arc(sx, VIEW.h - 22 - 22, 9, Math.PI, 0); ctx.lineTo(sx + 9, VIEW.h - 22); ctx.fill();
    // flag pole + banner
    ctx.strokeStyle = "rgba(220,235,245,0.6)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx, topY - 9); ctx.lineTo(sx, topY - 34); ctx.stroke();
    ctx.fillStyle = flag; ctx.beginPath(); ctx.moveTo(sx, topY - 34); ctx.lineTo(sx + (faceRight ? 18 : -18), topY - 30); ctx.lineTo(sx, topY - 24); ctx.fill();
    // --- cannon platform + turret ---
    const pivotX = sx, pivotY = topY + 4;
    const dmgLvl = side.up.cannonDmg, rateLvl = side.up.cannonRate, multi = side.up.cannonMulti, tech = side.path === "tech";
    const barrelLen = 20 + dmgLvl * 3.5, recoil = side.turretRecoil * 7;
    ctx.save(); ctx.translate(pivotX, pivotY);
    ctx.rotate(side.turretAngle || (faceRight ? -0.18 : Math.PI + 0.18));
    // barrels (multi-shot adds barrels)
    const barrels = 1 + multi;
    for (let b = 0; b < barrels; b++) {
      const off = (b - (barrels - 1) / 2) * 6;
      ctx.fillStyle = tech ? "#7fe3ff" : "#c9d8e2";
      ctx.fillRect(-4 - recoil, off - 2.4, barrelLen - recoil, 4.8);
      ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(barrelLen - 6 - recoil, off - 2.4, 3, 4.8);
    }
    // housing
    ctx.fillStyle = tech ? "#2a6f8a" : "#7d92a1"; ctx.beginPath(); ctx.arc(0, 0, 10 + dmgLvl * 0.6, 0, 7); ctx.fill();
    ctx.fillStyle = rateLvl ? (tech ? "#8ff0ff" : "#ffd166") : "#3a4a56"; ctx.beginPath(); ctx.arc(0, 0, 4 + rateLvl * 0.8, 0, 7); ctx.fill(); // glowing core
    if (side.turretRecoil > 0.4) { ctx.fillStyle = tech ? "rgba(120,240,255,0.85)" : "rgba(255,210,120,0.85)"; ctx.beginPath(); ctx.arc(barrelLen - recoil, 0, 6 * side.turretRecoil, 0, 7); ctx.fill(); }
    ctx.restore();
    // fortress HP ring under the tower
    const frac = Math.max(0, side.baseHp / side.baseMaxHp);
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(sx - half, topY - 15, w, 4);
    ctx.fillStyle = faceRight ? "#41ffa1" : "#ff6274"; ctx.fillRect(sx - half, topY - 15, w * frac, 4);
  }

  // --- Real soldiers: helmeted infantry with shields + swords/spears, hooded
  //     archers drawing real bows, gunners, energy troopers, mechs, fliers. ---
  const ERA_ARMOR = ["#b9a07a", "#d9b45a", "#c9ccd4", "#8fb8d6", "#c39bff"]; // stone/bronze/iron/industrial/future
  function drawCharacter(u) {
    const def = UNITS[u.unitId];
    const sx = worldToScreen(u.x);
    const player = u.side === "player";
    const dir = player ? 1 : -1;
    const s = uScale() * (0.82 + Math.min(0.55, def.hp / 320));
    const fly = def.fly;
    const gy = groundY();
    const bob = fly ? Math.sin(u.walk * 0.7 + sx * 0.05) * 5 : 0;
    const footY = fly ? gy - 44 * s + bob : gy;
    const lunge = u.atk > 0 ? Math.sin((0.22 - u.atk) / 0.22 * Math.PI) * 7 * dir * s : 0;
    const cx = sx + lunge;
    const cloth = player ? "#2fbf78" : "#e0556a";
    const clothDk = player ? "#1c7d50" : "#9c3242";
    const skin = player ? "#e8c9a8" : "#e8b7a8";
    const armor = ERA_ARMOR[def.era] || "#c9ccd4";
    const steel = "#dbe6ee";

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.32)"; ctx.beginPath(); ctx.ellipse(sx, gy - 2, 12 * s, 3.6, 0, 0, 7); ctx.fill();
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    const HH = 46 * s;                    // full height
    const hipY = footY - HH * 0.34;
    const shoulderY = footY - HH * 0.74;
    const headR = 6.2 * s;
    const headY = shoulderY - headR * 1.5;
    const kind = def.type === "melee" ? "melee" : (["bow", "sling", "crossbow"].includes(def.art) ? "archer" : ["rifle", "launcher"].includes(def.art) ? "gunner" : ["mech", "sentinel"].includes(def.art) ? "mech" : "energy");

    if (fly) {
      // hover craft: body + rotor + underglow
      ctx.fillStyle = "rgba(120,220,255,0.22)"; ctx.beginPath(); ctx.ellipse(cx, footY + 22 * s, 13 * s, 5 * s, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = armor; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(cx - 15 * s, shoulderY); ctx.lineTo(cx + 15 * s, shoulderY); ctx.stroke();
      ctx.fillStyle = cloth; ctx.beginPath(); ctx.ellipse(cx, footY, 12 * s, 7 * s, 0, 0, 7); ctx.fill();
      ctx.fillStyle = armor; ctx.beginPath(); ctx.ellipse(cx, footY, 6 * s, 4 * s, 0, 0, 7); ctx.fill();
      ctx.fillStyle = u.flash > 0 ? "#fff1b8" : "#6fd0ff"; ctx.beginPath(); ctx.arc(cx + dir * 12 * s, footY, 3 * s, 0, 7); ctx.fill();
      drawHpBar(cx, footY - 16 * s, u, s); return;
    }

    // legs (marching)
    const step = Math.sin(u.walk) * 6 * s;
    ctx.strokeStyle = clothDk; ctx.lineWidth = 3.4 * s;
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx + step, footY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx - step, footY); ctx.stroke();
    // boots
    ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 3.4 * s;
    ctx.beginPath(); ctx.moveTo(cx + step, footY); ctx.lineTo(cx + step + dir * 3 * s, footY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - step, footY); ctx.lineTo(cx - step + dir * 3 * s, footY); ctx.stroke();

    // torso (tunic) + chest armor
    ctx.fillStyle = cloth;
    ctx.beginPath();
    ctx.moveTo(cx - 6 * s, hipY); ctx.lineTo(cx + 6 * s, hipY);
    ctx.lineTo(cx + 7 * s, shoulderY); ctx.lineTo(cx - 7 * s, shoulderY); ctx.closePath(); ctx.fill();
    if (kind === "mech") { ctx.fillStyle = armor; ctx.fillRect(cx - 8 * s, shoulderY, 16 * s, (hipY - shoulderY)); }
    else { ctx.fillStyle = armor; ctx.beginPath(); ctx.moveTo(cx - 6 * s, shoulderY); ctx.lineTo(cx + 6 * s, shoulderY); ctx.lineTo(cx + 4 * s, shoulderY + 9 * s); ctx.lineTo(cx - 4 * s, shoulderY + 9 * s); ctx.closePath(); ctx.fill(); }
    // shoulder pads
    ctx.fillStyle = steel; ctx.beginPath(); ctx.arc(cx - 7 * s, shoulderY + 1 * s, 3.2 * s, 0, 7); ctx.arc(cx + 7 * s, shoulderY + 1 * s, 3.2 * s, 0, 7); ctx.fill();

    // head + helmet
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(cx, headY, headR, 0, 7); ctx.fill();
    ctx.fillStyle = armor;
    if (kind === "archer") { ctx.beginPath(); ctx.arc(cx, headY, headR + 1.5 * s, Math.PI, 0); ctx.fill(); ctx.beginPath(); ctx.moveTo(cx - headR, headY); ctx.lineTo(cx - dir * (headR + 5 * s), headY + 3 * s); ctx.lineTo(cx - headR, headY + 2 * s); ctx.fill(); } // hood
    else { ctx.beginPath(); ctx.arc(cx, headY - 1 * s, headR + 1.5 * s, Math.PI, 0); ctx.fill(); ctx.fillRect(cx - headR - 1 * s, headY - 1 * s, (headR + 1) * 2 * s, 2.5 * s); // helmet + brim
      if (def.era >= 2) { ctx.fillStyle = player ? "#5effb0" : "#ff8a97"; ctx.fillRect(cx - 1 * s, headY - headR - 5 * s, 2 * s, 5 * s); } } // crest
    ctx.fillStyle = "rgba(20,20,30,0.8)"; ctx.fillRect(cx + dir * 1.5 * s, headY - 1 * s, dir * 3.5 * s, 2 * s); // eye slit

    // arms + weapon by kind
    const handX = cx + dir * 8 * s, handY = shoulderY + 5 * s;
    ctx.strokeStyle = cloth; ctx.lineWidth = 3 * s;
    if (kind === "archer") {
      // front arm holds bow, back arm draws string
      const pull = u.atk > 0 ? 3 * s : 7 * s;
      ctx.beginPath(); ctx.moveTo(cx, shoulderY + 3 * s); ctx.lineTo(handX + dir * 3 * s, handY); ctx.stroke();
      ctx.strokeStyle = def.art === "crossbow" ? "#8a5a30" : "#b8895a"; ctx.lineWidth = 2.4 * s;
      const bx = handX + dir * 5 * s;
      ctx.beginPath(); ctx.arc(bx, handY, 11 * s, dir > 0 ? -1.1 : Math.PI - 1.1, dir > 0 ? 1.1 : Math.PI + 1.1); ctx.stroke(); // bow limb
      ctx.strokeStyle = "rgba(230,240,250,0.8)"; ctx.lineWidth = 1 * s; // string
      ctx.beginPath(); ctx.moveTo(bx + dir * Math.cos(-1.1) * 11 * s, handY - 11 * s); ctx.lineTo(bx - dir * pull, handY); ctx.lineTo(bx + dir * Math.cos(1.1) * 11 * s, handY + 11 * s); ctx.stroke();
      ctx.strokeStyle = "#e8d9b0"; ctx.lineWidth = 1.6 * s; // nocked arrow
      ctx.beginPath(); ctx.moveTo(bx - dir * pull, handY); ctx.lineTo(bx + dir * 10 * s, handY); ctx.stroke();
      // quiver on back
      ctx.strokeStyle = "#7a5330"; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(cx - dir * 5 * s, shoulderY + 2 * s); ctx.lineTo(cx - dir * 8 * s, hipY); ctx.stroke();
    } else if (kind === "gunner") {
      ctx.beginPath(); ctx.moveTo(cx, shoulderY + 3 * s); ctx.lineTo(handX, handY - 2 * s); ctx.stroke();
      ctx.fillStyle = "#3b444d"; ctx.fillRect(cx, handY - 4 * s, dir * 18 * s, 3.6 * s); // rifle
      ctx.fillStyle = "#6a4a2c"; ctx.fillRect(cx, handY - 2 * s, dir * 6 * s, 3 * s); // stock
      if (u.flash > 0) { ctx.fillStyle = "rgba(255,240,180,0.95)"; ctx.beginPath(); ctx.arc(cx + dir * 18 * s, handY - 2 * s, 4 * s, 0, 7); ctx.fill(); }
    } else if (kind === "energy") {
      ctx.beginPath(); ctx.moveTo(cx, shoulderY + 3 * s); ctx.lineTo(handX, handY); ctx.stroke();
      ctx.strokeStyle = "#7fe3ff"; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(cx, handY); ctx.lineTo(cx + dir * 14 * s, handY - 3 * s); ctx.stroke();
      ctx.fillStyle = u.flash > 0 ? "#e6f7ff" : "#38b6ff"; ctx.beginPath(); ctx.arc(cx + dir * 15 * s, handY - 3 * s, (u.flash > 0 ? 5 : 3) * s, 0, 7); ctx.fill();
    } else if (kind === "mech") {
      ctx.fillStyle = "#8fa6b6"; ctx.fillRect(cx, shoulderY + 2 * s, dir * 6 * s, 5 * s);
      ctx.fillStyle = "#5a6b78"; ctx.fillRect(cx + dir * 5 * s, shoulderY + 1 * s, dir * 16 * s, 7 * s); // arm cannon
      ctx.fillStyle = u.flash > 0 ? "#fff1b8" : "#ff9a5c"; ctx.beginPath(); ctx.arc(cx + dir * 21 * s, shoulderY + 4.5 * s, (u.flash > 0 ? 6 : 3) * s, 0, 7); ctx.fill();
      ctx.fillStyle = player ? "#5effb0" : "#ff8a97"; ctx.beginPath(); ctx.arc(cx, shoulderY + 12 * s, 2.5 * s, 0, 7); ctx.fill(); // core
    } else {
      // melee: sword/spear/club + round shield on front
      ctx.beginPath(); ctx.moveTo(cx, shoulderY + 3 * s); ctx.lineTo(handX, shoulderY - (u.atk > 0 ? 8 : 2) * s); ctx.stroke();
      ctx.strokeStyle = def.art === "club" ? "#a9743f" : steel; ctx.lineWidth = def.art === "lance" ? 2.2 * s : 3 * s;
      const wl = def.art === "lance" ? 22 : def.art === "sword" ? 16 : 13;
      ctx.beginPath(); ctx.moveTo(handX, shoulderY - (u.atk > 0 ? 8 : 2) * s); ctx.lineTo(handX + dir * wl * s, shoulderY - (u.atk > 0 ? 14 : 10) * s); ctx.stroke();
      if (def.art === "club") { ctx.fillStyle = "#8a5a30"; ctx.beginPath(); ctx.arc(handX + dir * 13 * s, shoulderY - 10 * s, 4 * s, 0, 7); ctx.fill(); }
      // shield
      ctx.fillStyle = clothDk; ctx.beginPath(); ctx.ellipse(cx - dir * 6 * s, hipY - 6 * s, 4.5 * s, 7 * s, 0, 0, 7); ctx.fill();
      ctx.fillStyle = armor; ctx.beginPath(); ctx.arc(cx - dir * 6 * s, hipY - 6 * s, 2 * s, 0, 7); ctx.fill();
    }

    drawHpBar(cx, headY - headR - 6 * s, u, s);
  }
  function drawHpBar(cx, y, u, s) {
    const frac = Math.max(0, u.hp / u.maxHp), w = 22 * s;
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(cx - w / 2, y, w, 3 * s);
    ctx.fillStyle = frac > 0.5 ? "#8dffc0" : frac > 0.25 ? "#ffd166" : "#ff6274"; ctx.fillRect(cx - w / 2, y, w * frac, 3 * s);
  }

  function render() {
    const shx = (state.shake > 0.1 && !reduceMotion) ? (Math.random() - 0.5) * state.shake : 0;
    const shy = (state.shake > 0.1 && !reduceMotion) ? (Math.random() - 0.5) * state.shake : 0;
    ctx.setTransform(DPR, 0, 0, DPR, shx * DPR, shy * DPR);
    drawBackground();
    drawTower(state.player, "#5a6f82", "#1ef0ff", true);
    drawTower(state.enemy, "#7a5a48", "#ff9a5c", false);
    for (const u of state.player.units) if (u.alive) drawCharacter(u);
    for (const u of state.enemy.units) if (u.alive) drawCharacter(u);
    for (const p of state.projectiles) {
      ctx.strokeStyle = p.color; ctx.lineWidth = p.size;
      if (p.trail) { const d = Math.hypot(p.vx, p.vy) || 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx / d * 9, p.y - p.vy / d * 9); ctx.stroke(); }
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
    }
    for (const p of state.particles) { ctx.globalAlpha = Math.max(0, p.life / p.maxLife); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.font = `700 ${Math.round(13 * uScale())}px ui-monospace, monospace`; ctx.textAlign = "center";
    for (const p of state.popups) { ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, p.life / 0.9); ctx.fillText(p.text, worldToScreen(p.x), groundY() - 44 + p.y); }
    ctx.globalAlpha = 1; ctx.textAlign = "left";
  }

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const unitButtonsEl = $("[data-unit-buttons]");
  const upgradesEl = $("[data-upgrades]");
  const branchModal = $("[data-branch-modal]");
  const endModal = $("[data-end-modal]");

  let builtEra = -1, builtPath = null;
  function rebuildUnitButtonsIfNeeded() {
    if (builtEra === state.player.eraIndex && builtPath === state.player.path) return;
    builtEra = state.player.eraIndex; builtPath = state.player.path;
    const ids = unitsForEra(state.player.eraIndex, state.player.path);
    unitButtonsEl.innerHTML = ids.map((id) => {
      const d = UNITS[id];
      return `<button class="unit-btn" data-spawn="${id}"><b>${d.name}</b><span>${d.cost}g · ${d.attack}⚔ · ${d.hp}♥</span></button>`;
    }).join("");
  }
  let upgradesBuilt = false;
  function buildUpgrades() {
    if (upgradesBuilt || !upgradesEl) return; upgradesBuilt = true;
    upgradesEl.innerHTML = UPGRADES.map((u) =>
      `<button class="up-btn" data-upgrade="${u.id}" title="${u.track}"><span class="up-ic">${u.icon}</span><b>${u.label}</b><span class="up-meta" data-up-meta="${u.id}"></span><span class="up-pips" data-up-pips="${u.id}"></span></button>`
    ).join("");
  }

  function renderHud() {
    const p = state.player;
    $("[data-player-hp-fill]").style.width = `${Math.max(0, (p.baseHp / p.baseMaxHp) * 100)}%`;
    $("[data-enemy-hp-fill]").style.width = `${Math.max(0, (state.enemy.baseHp / state.enemy.baseMaxHp) * 100)}%`;
    $("[data-player-hp-text]").textContent = `${Math.max(0, Math.round(p.baseHp))} / ${p.baseMaxHp}`;
    $("[data-enemy-hp-text]").textContent = `${Math.max(0, Math.round(state.enemy.baseHp))} / ${state.enemy.baseMaxHp}`;
    $("[data-gold]").textContent = `💰 ${Math.floor(p.gold)}`;
    const inc = $("[data-income]"); if (inc) inc.textContent = `+${Math.round(incomePerSec(p))}/s`;
    $("[data-era-name]").textContent = ERAS[p.eraIndex].name + (p.path ? ` · ${p.path}` : "");

    rebuildUnitButtonsIfNeeded();
    for (const btn of unitButtonsEl.querySelectorAll("[data-spawn]")) btn.disabled = p.gold < UNITS[btn.dataset.spawn].cost;

    buildUpgrades();
    if (upgradesEl) for (const u of UPGRADES) {
      const lvl = p.up[u.id], maxed = lvl >= u.max, cost = u.cost(lvl);
      const btn = upgradesEl.querySelector(`[data-upgrade="${u.id}"]`);
      if (!btn) continue;
      btn.disabled = maxed || p.gold < cost;
      btn.classList.toggle("is-maxed", maxed);
      upgradesEl.querySelector(`[data-up-meta="${u.id}"]`).textContent = maxed ? "MAX" : `${cost}g`;
      upgradesEl.querySelector(`[data-up-pips="${u.id}"]`).innerHTML = Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? "on" : ""}"></i>`).join("");
    }

    const overBtn = $("[data-turret-btn]");
    if (overBtn) { overBtn.disabled = p.manualCd > 0; overBtn.textContent = p.manualCd > 0 ? `⚡ Overcharge (${Math.ceil(p.manualCd)}s)` : "⚡ Overcharge (Space)"; }
    const advanceBtn = $("[data-advance-btn]");
    const next = ERAS[p.eraIndex + 1];
    if (!next) { advanceBtn.disabled = true; advanceBtn.textContent = "⬆ Max Era"; }
    else { advanceBtn.disabled = p.gold < next.advanceCost; advanceBtn.textContent = `⬆ ${next.name} (${next.advanceCost}g)`; }
  }

  function showEndScreen() {
    endModal.hidden = false;
    $("[data-end-title]").textContent = state.winner === "player" ? "Victory!" : "Defeated";
    $("[data-end-sub]").textContent = state.winner === "player"
      ? "The enemy fortress has fallen. Try a harder path — or a faster one."
      : "Your fortress has fallen. Upgrade the cannon earlier next run.";
    if (!completionSent) {
      completionSent = true;
      host("complete", { score: scoreForState(), progress: state.winner === "player" ? 100 : 0, state: saveState(true) });
    }
  }

  document.addEventListener("click", (e) => {
    const spawnBtn = e.target.closest("[data-spawn]");
    if (spawnBtn) { spawnUnit(state.player, spawnBtn.dataset.spawn); persistProgress(true); return; }
    const upBtn = e.target.closest("[data-upgrade]");
    if (upBtn) { buyUpgrade(state.player, upBtn.dataset.upgrade); persistProgress(true); return; }
    if (e.target.closest("[data-turret-btn]")) { if (state.player.manualCd <= 0) { fireTurret(state.player, state.enemy, true, true); state.player.manualCd = MANUAL_OVERCHARGE_CD; } return; }
    if (e.target.closest("[data-advance-btn]")) {
      const ni = state.player.eraIndex + 1;
      if (ni === BRANCH_ERA_INDEX) { if (ERAS[ni] && state.player.gold >= ERAS[ni].advanceCost) branchModal.hidden = false; }
      else { advanceEra(state.player); persistProgress(true); }
      return;
    }
    const pathBtn = e.target.closest("[data-path-choice]");
    if (pathBtn) { advanceEra(state.player, pathBtn.dataset.pathChoice); branchModal.hidden = true; persistProgress(true); return; }
    if (e.target.closest("[data-restart-btn]")) { resetGame(); endModal.hidden = true; persistProgress(true); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); if (state.player.manualCd <= 0) { fireTurret(state.player, state.enemy, true, true); state.player.manualCd = MANUAL_OVERCHARGE_CD; } }
  });

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  function frame(now) {
    if (!state.lastFrameTime) state.lastFrameTime = now;
    let delta = (now - state.lastFrameTime) / 1000; state.lastFrameTime = now;
    delta = paused ? 0 : Math.min(delta, 0.25); state.accumulator += delta;
    while (state.accumulator >= TICK_SECONDS) { simulateTick(TICK_SECONDS); state.accumulator -= TICK_SECONDS; }
    render(); renderHud();
    if (state.over && endModal.hidden) showEndScreen();
    if (!paused && !state.over) persistProgress(false);
    requestAnimationFrame(frame);
  }
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "phantomplay-host") return;
    if (data.type === "pause") { paused = true; host("paused", { paused: true }); }
    else if (data.type === "resume") { paused = false; state.lastFrameTime = 0; host("paused", { paused: false }); }
    else if (data.type === "restart") { paused = false; resetGame(); endModal.hidden = true; persistProgress(true); }
    else if (data.type === "exit") { paused = true; persistProgress(true); }
    else if (data.type === "restore" || data.type === "load-state") { applySave(data.state); }
    else if (data.type === "save-state") { persistProgress(true); }
  });
  requestAnimationFrame(frame);
  renderHud();
  host("ready", { schemaVersion: 2 });

  // ---------------------------------------------------------------------
  // Test/debug hook — automated verification only.
  // ---------------------------------------------------------------------
  window.__PhantomAgesTest = {
    tick(n = 1) { for (let i = 0; i < n; i++) simulateTick(TICK_SECONDS); render(); renderHud(); },
    getState() { return state; },
    spawn(side, unitId) { return spawnUnit(side === "player" ? state.player : state.enemy, unitId); },
    buy(side, id) { return buyUpgrade(side === "player" ? state.player : state.enemy, id); },
    forceGold(side, amount) { (side === "player" ? state.player : state.enemy).gold = amount; },
    advanceEra(side, path) { return advanceEra(side === "player" ? state.player : state.enemy, path); },
    reset() { resetGame(); },
  };
})();
