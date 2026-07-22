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

  const LANE_LENGTH = 1200;   // world units, player base at 0, enemy base at LANE_LENGTH
  const TICK_SECONDS = 1 / 60;
  const START_GOLD = 120;

  const TURRET = { range: 240, damage: 26, cooldown: 1.4 };
  const MANUAL_OVERCHARGE_CD = 6; // seconds between manual "Overcharge" volleys

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
  const turretRange    = (s) => TURRET.range + s.up.cannonRange * 55;
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

  function resetGame() {
    for (const u of state.player.units) unitPool.release(u);
    for (const u of state.enemy.units) unitPool.release(u);
    for (const p of state.popups) popupPool.release(p);
    for (const p of state.projectiles) projPool.release(p);
    for (const p of state.particles) partPool.release(p);
    state.player = freshSide(0); state.enemy = freshSide(LANE_LENGTH);
    state.popups = []; state.projectiles = []; state.particles = [];
    state.t = 0; state.over = false; state.winner = null; state.aiTimer = 0; state.aiUpTimer = 4; state.shake = 0;
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
    p.life = Math.min(0.5, d / sp); p.color = color; p.size = size || 2.5; p.trail = !!trail;
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
  const groundY = () => canvas.height - 30;
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
        u.x += (movingRight ? 1 : -1) * def.speed * dt;
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
  // Rendering
  // ---------------------------------------------------------------------
  const canvas = document.getElementById("battlefield");
  const ctx = canvas.getContext("2d");
  function worldToScreen(x) { return (x / LANE_LENGTH) * canvas.width; }
  function baseHeight(side) { return 96 + side.eraIndex * 16; }
  function baseTopY(side) { return canvas.height - 20 - baseHeight(side); }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, "#0a1826"); g.addColorStop(0.6, "#071019"); g.addColorStop(1, "#04070c");
    ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
    // parallax hills
    ctx.fillStyle = "rgba(30,60,90,0.25)";
    ctx.beginPath(); ctx.moveTo(0, canvas.height - 40);
    for (let x = 0; x <= canvas.width; x += 60) ctx.lineTo(x, canvas.height - 40 - Math.abs(Math.sin(x * 0.01)) * 40);
    ctx.lineTo(canvas.width, canvas.height); ctx.lineTo(0, canvas.height); ctx.fill();
    // ground
    ctx.fillStyle = "#0d1a24"; ctx.fillRect(0, canvas.height - 20, canvas.width, 20);
    ctx.strokeStyle = "rgba(120,200,255,0.12)"; ctx.beginPath(); ctx.moveTo(0, canvas.height - 20); ctx.lineTo(canvas.width, canvas.height - 20); ctx.stroke();
  }

  function drawBase(side, color, faceRight) {
    const sx = worldToScreen(side.baseX);
    const h = baseHeight(side), topY = canvas.height - 20 - h;
    const w = 54 + side.eraIndex * 4;
    // body
    const g = ctx.createLinearGradient(0, topY, 0, canvas.height - 20);
    g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = g;
    ctx.fillRect(sx - w / 2, topY, w, h);
    // crenellations
    ctx.fillStyle = color;
    for (let i = -w / 2; i < w / 2 - 4; i += 12) ctx.fillRect(sx + i, topY - 8, 8, 8);
    // door
    ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(sx - 8, canvas.height - 20 - 26, 16, 26);
    // flag
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.moveTo(sx, topY - 8); ctx.lineTo(sx, topY - 30); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(sx, topY - 30); ctx.lineTo(sx + (faceRight ? 16 : -16), topY - 25); ctx.lineTo(sx, topY - 20); ctx.fill();
    // turret cannon
    const pivotY = topY + 6, recoil = side.turretRecoil * 6;
    ctx.save(); ctx.translate(sx, pivotY); ctx.rotate(side.turretAngle || (faceRight ? -0.15 : Math.PI + 0.15));
    ctx.fillStyle = "#c9d8e2"; ctx.fillRect(-6 - recoil, -5, 26 - recoil, 10);
    ctx.fillStyle = "#8fa6b4"; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
    if (side.turretRecoil > 0.5) { ctx.fillStyle = "rgba(30,240,255,0.8)"; ctx.beginPath(); ctx.arc(22 - recoil, 0, 6 * side.turretRecoil, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  function drawCharacter(u) {
    const def = UNITS[u.unitId];
    const sx = worldToScreen(u.x);
    const player = u.side === "player";
    const dir = player ? 1 : -1;
    const scale = 0.85 + Math.min(0.7, def.hp / 300);
    const fly = def.fly;
    const baseY = groundY();
    const bob = fly ? Math.sin(u.walk * 0.6 + sx * 0.05) * 4 : 0;
    const footY = fly ? baseY - 40 + bob : baseY;
    const lunge = u.atk > 0 ? Math.sin((0.22 - u.atk) / 0.22 * Math.PI) * 6 * dir : 0;
    const cx = sx + lunge;
    const body = player ? "#3be38c" : "#ff6274";
    const dark = player ? "#1f7d51" : "#a13440";
    const accent = ["#cdd6df", "#e6c86a", "#c98a4a", "#6fd0ff", "#b98bff"][def.era] || "#cdd6df";

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.ellipse(sx, baseY - 2, 11 * scale, 3.5, 0, 0, Math.PI * 2); ctx.fill();

    const H = 34 * scale;              // total height
    const hipY = footY - H * 0.42;
    const headR = 5.5 * scale;

    ctx.lineCap = "round";
    if (!fly) {
      // legs (walk cycle)
      const step = Math.sin(u.walk) * 5 * scale;
      ctx.strokeStyle = dark; ctx.lineWidth = 3 * scale;
      ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx + step, footY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx - step, footY); ctx.stroke();
    } else {
      // hover glow + rotor
      ctx.fillStyle = "rgba(111,208,255,0.25)"; ctx.beginPath(); ctx.arc(cx, footY + 20, 10 * scale, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 12, footY - H * 0.55); ctx.lineTo(cx + 12, footY - H * 0.55); ctx.stroke();
    }
    // torso
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(cx - 5 * scale, hipY); ctx.lineTo(cx + 5 * scale, hipY);
    ctx.lineTo(cx + 6 * scale, hipY - H * 0.4); ctx.lineTo(cx - 6 * scale, hipY - H * 0.4); ctx.closePath(); ctx.fill();
    // armor stripe
    ctx.fillStyle = accent; ctx.fillRect(cx - 6 * scale, hipY - H * 0.4, 12 * scale, 3 * scale);
    // head
    const headY = hipY - H * 0.4 - headR;
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, headY, headR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accent; ctx.fillRect(cx + dir * 1, headY - 1.5, dir * 4 * scale, 2.4); // visor
    // weapon
    drawWeapon(def.art, cx, hipY - H * 0.28, dir, scale, accent, u.flash > 0);

    // hp bar
    const frac = Math.max(0, u.hp / u.maxHp);
    const barY = headY - headR - 6;
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(cx - 10, barY, 20, 3);
    ctx.fillStyle = frac > 0.5 ? "#8dffc0" : frac > 0.25 ? "#ffd166" : "#ff6274"; ctx.fillRect(cx - 10, barY, 20 * frac, 3);
  }

  function drawWeapon(art, x, y, dir, s, accent, flash) {
    ctx.save(); ctx.translate(x + dir * 6 * s, y); ctx.scale(dir, 1);
    ctx.strokeStyle = "#d7e2ea"; ctx.fillStyle = "#d7e2ea"; ctx.lineWidth = 2.4 * s;
    switch (art) {
      case "club": ctx.strokeStyle = "#b07a45"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(9 * s, -8 * s); ctx.stroke(); ctx.fillStyle = "#8a5a30"; ctx.beginPath(); ctx.arc(10 * s, -9 * s, 4 * s, 0, 7); ctx.fill(); break;
      case "sling": case "sword": ctx.beginPath(); ctx.moveTo(0, 2 * s); ctx.lineTo(13 * s, -9 * s); ctx.stroke(); break;
      case "bow": case "crossbow": ctx.beginPath(); ctx.arc(6 * s, 0, 7 * s, -1, 1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(6 * s, -6 * s); ctx.lineTo(6 * s, 6 * s); ctx.stroke(); break;
      case "lance": ctx.beginPath(); ctx.moveTo(-4 * s, 3 * s); ctx.lineTo(16 * s, -6 * s); ctx.stroke(); break;
      case "rifle": case "sentinel": ctx.fillRect(0, -2 * s, 16 * s, 3 * s); break;
      case "launcher": case "plasma": ctx.fillRect(0, -3 * s, 15 * s, 6 * s); break;
      case "tesla": ctx.strokeStyle = "#6fd0ff"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(8 * s, -3 * s); ctx.lineTo(12 * s, 2 * s); ctx.lineTo(16 * s, -4 * s); ctx.stroke(); break;
      case "mech": ctx.fillStyle = "#9fb3c2"; ctx.fillRect(-2 * s, -6 * s, 6 * s, 12 * s); ctx.fillRect(4 * s, -3 * s, 16 * s, 5 * s); break;
      case "drone": case "swarm": ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(0, 0, 4 * s, 0, 7); ctx.fill(); break;
      default: ctx.fillRect(0, -2 * s, 12 * s, 3 * s);
    }
    if (flash) { ctx.fillStyle = "rgba(255,240,180,0.9)"; ctx.beginPath(); ctx.arc(17 * s, -3 * s, 4 * s, 0, 7); ctx.fill(); }
    ctx.restore();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (state.shake > 0.1 && !reduceMotion) ctx.setTransform(1, 0, 0, 1, (Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    drawBackground();
    drawBase(state.player, "#1a9fd6", true);
    drawBase(state.enemy, "#d6742c", false);
    for (const u of state.player.units) if (u.alive) drawCharacter(u);
    for (const u of state.enemy.units) if (u.alive) drawCharacter(u);
    // projectiles
    for (const p of state.projectiles) {
      ctx.strokeStyle = p.color; ctx.lineWidth = p.size;
      if (p.trail) { const d = Math.hypot(p.vx, p.vy) || 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx / d * 8, p.y - p.vy / d * 8); ctx.stroke(); }
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
    }
    // particles
    for (const p of state.particles) { ctx.globalAlpha = Math.max(0, p.life / p.maxLife); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    // damage popups
    ctx.font = "700 13px ui-monospace, monospace"; ctx.textAlign = "center";
    for (const p of state.popups) { ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, p.life / 0.9); ctx.fillText(p.text, worldToScreen(p.x), groundY() - 40 + p.y); }
    ctx.globalAlpha = 1; ctx.textAlign = "left";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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
  }

  document.addEventListener("click", (e) => {
    const spawnBtn = e.target.closest("[data-spawn]");
    if (spawnBtn) return void spawnUnit(state.player, spawnBtn.dataset.spawn);
    const upBtn = e.target.closest("[data-upgrade]");
    if (upBtn) return void buyUpgrade(state.player, upBtn.dataset.upgrade);
    if (e.target.closest("[data-turret-btn]")) { if (state.player.manualCd <= 0) { fireTurret(state.player, state.enemy, true, true); state.player.manualCd = MANUAL_OVERCHARGE_CD; } return; }
    if (e.target.closest("[data-advance-btn]")) {
      const ni = state.player.eraIndex + 1;
      if (ni === BRANCH_ERA_INDEX) { if (ERAS[ni] && state.player.gold >= ERAS[ni].advanceCost) branchModal.hidden = false; }
      else advanceEra(state.player);
      return;
    }
    const pathBtn = e.target.closest("[data-path-choice]");
    if (pathBtn) { advanceEra(state.player, pathBtn.dataset.pathChoice); branchModal.hidden = true; return; }
    if (e.target.closest("[data-restart-btn]")) { resetGame(); endModal.hidden = true; }
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
    delta = Math.min(delta, 0.25); state.accumulator += delta;
    while (state.accumulator >= TICK_SECONDS) { simulateTick(TICK_SECONDS); state.accumulator -= TICK_SECONDS; }
    render(); renderHud();
    if (state.over && endModal.hidden) showEndScreen();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  renderHud();

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
