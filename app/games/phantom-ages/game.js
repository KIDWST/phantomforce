/* Phantom Ages — an Age-of-War-style lane pusher, built for PhantomPlay.
 * See PHANTOMPLAY-NEXT-STEP.md §2 for the design rationale (branching
 * era paths, positioned as the strategic sibling to Kingdom Breakers'
 * real-time action identity).
 *
 * Engineering notes (practicing §6's performance checklist, not just
 * writing it down):
 *  - Fixed-timestep simulation, decoupled from render/rAF rate.
 *  - Units and projectiles are pooled (shared/objectPool.js), never
 *    allocated per-spawn in the hot loop.
 *  - No allocation inside update()/render() past initial setup.
 */
(function () {
  "use strict";

  const LANE_LENGTH = 1200; // world units, player base at 0, enemy base at LANE_LENGTH
  const TICK_SECONDS = 1 / 60;
  const TURRET_RANGE = 220;
  const TURRET_DAMAGE = 30;
  const TURRET_COOLDOWN = 2.0;

  // ---------------------------------------------------------------------
  // Unit + era data
  // ---------------------------------------------------------------------
  const UNITS = {
    clubman:     { name: "Clubman",      cost: 20,  hp: 40,  attack: 6,  range: 16,  speed: 34, cooldown: 1.0, era: 0 },
    rockThrower: { name: "Rock Thrower", cost: 35,  hp: 25,  attack: 8,  range: 70,  speed: 26, cooldown: 1.3, era: 0 },
    swordsman:   { name: "Swordsman",    cost: 45,  hp: 70,  attack: 10, range: 16,  speed: 36, cooldown: 0.9, era: 1 },
    archer:      { name: "Archer",       cost: 60,  hp: 40,  attack: 12, range: 90,  speed: 30, cooldown: 1.1, era: 1 },
    knight:      { name: "Knight",       cost: 90,  hp: 120, attack: 16, range: 18,  speed: 40, cooldown: 0.8, era: 2 },
    crossbow:    { name: "Crossbowman",  cost: 110, hp: 65,  attack: 20, range: 110, speed: 30, cooldown: 1.2, era: 2 },
    // Industrial+, path-specific
    rifleman:    { name: "Rifleman",     cost: 160, hp: 150, attack: 28, range: 140, speed: 34, cooldown: 0.7, era: 3, path: "military" },
    grenadier:   { name: "Grenadier",    cost: 220, hp: 130, attack: 45, range: 100, speed: 24, cooldown: 1.4, era: 3, path: "military" },
    drone:       { name: "Drone Scout",  cost: 150, hp: 80,  attack: 18, range: 160, speed: 46, cooldown: 0.5, era: 3, path: "tech" },
    tesla:       { name: "Tesla Trooper",cost: 240, hp: 140, attack: 35, range: 120, speed: 30, cooldown: 1.0, era: 3, path: "tech" },
    mech:        { name: "Mech Warrior", cost: 400, hp: 320, attack: 60, range: 150, speed: 32, cooldown: 0.7, era: 4, path: "military" },
    plasma:      { name: "Plasma Trooper",cost: 460, hp: 220, attack: 80, range: 170, speed: 30, cooldown: 1.0, era: 4, path: "military" },
    nanoSwarm:   { name: "Nano Swarm Bot",cost: 380, hp: 150, attack: 40, range: 180, speed: 50, cooldown: 0.4, era: 4, path: "tech" },
    aiSentinel:  { name: "AI Sentinel",  cost: 500, hp: 280, attack: 70, range: 200, speed: 28, cooldown: 0.9, era: 4, path: "tech" },
  };

  const ERAS = [
    { name: "Stone Age",      advanceCost: 0,    unitIds: ["clubman", "rockThrower"] },
    { name: "Bronze Age",     advanceCost: 150,  unitIds: ["swordsman", "archer"] },
    { name: "Iron Age",       advanceCost: 350,  unitIds: ["knight", "crossbow"] },
    { name: "Industrial Age", advanceCost: 700,  unitIds: null }, // resolved by chosen path
    { name: "Future Age",     advanceCost: 1400, unitIds: null },
  ];
  const PATH_UNITS = {
    military: { 3: ["rifleman", "grenadier"], 4: ["mech", "plasma"] },
    tech:     { 3: ["drone", "tesla"], 4: ["nanoSwarm", "aiSentinel"] },
  };
  const BRANCH_ERA_INDEX = 3; // choosing a path happens when advancing INTO this era

  function unitsForEra(eraIndex, path) {
    if (eraIndex < BRANCH_ERA_INDEX) return ERAS[eraIndex].unitIds;
    return (path && PATH_UNITS[path] && PATH_UNITS[path][eraIndex]) || [];
  }

  // ---------------------------------------------------------------------
  // Object pools (units + floating damage numbers) — see shared/objectPool.js
  // ---------------------------------------------------------------------
  const unitPool = new ObjectPool(
    () => ({ alive: false, side: "player", unitId: null, x: 0, hp: 0, maxHp: 0, cooldown: 0 }),
    (u) => { u.alive = false; }
  );
  const popupPool = new ObjectPool(
    () => ({ alive: false, x: 0, y: 0, text: "", life: 0, color: "" }),
    (p) => { p.alive = false; }
  );

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  function freshSide(startX) {
    return {
      gold: 60,
      baseHp: 500,
      baseMaxHp: 500,
      eraIndex: 0,
      path: null,
      turretCooldown: 0,
      units: [], // array of pooled unit objects owned by this side
      baseX: startX,
    };
  }

  const state = {
    player: freshSide(0),
    enemy: freshSide(LANE_LENGTH),
    popups: [],
    t: 0,
    over: false,
    winner: null,
    aiTimer: 0,
    accumulator: 0,
    lastFrameTime: 0,
  };

  function resetGame() {
    for (const u of state.player.units) unitPool.release(u);
    for (const u of state.enemy.units) unitPool.release(u);
    for (const p of state.popups) popupPool.release(p);
    state.player = freshSide(0);
    state.enemy = freshSide(LANE_LENGTH);
    state.popups = [];
    state.t = 0;
    state.over = false;
    state.winner = null;
    state.aiTimer = 0;
  }

  function spawnUnit(side, unitId) {
    const def = UNITS[unitId];
    if (!def) return false;
    if (side.gold < def.cost) return false;
    side.gold -= def.cost;
    const u = unitPool.acquire();
    u.alive = true;
    u.side = side === state.player ? "player" : "enemy";
    u.unitId = unitId;
    u.x = side === state.player ? 10 : LANE_LENGTH - 10;
    u.hp = def.hp;
    u.maxHp = def.hp;
    u.cooldown = 0;
    side.units.push(u);
    return true;
  }

  function spawnPopup(x, y, text, color) {
    const p = popupPool.acquire();
    p.alive = true; p.x = x; p.y = y; p.text = text; p.life = 0.8; p.color = color;
    state.popups.push(p);
  }

  // ---------------------------------------------------------------------
  // Fixed-timestep simulation
  // ---------------------------------------------------------------------
  function nearestEnemyUnit(mySide, oppSide, x, movingRight) {
    let best = null, bestDist = Infinity;
    for (const u of oppSide.units) {
      if (!u.alive) continue;
      const d = Math.abs(u.x - x);
      if (d < bestDist) { bestDist = d; best = u; }
    }
    return best;
  }

  function stepUnits(mySide, oppSide, movingRight, dt) {
    for (const u of mySide.units) {
      if (!u.alive) continue;
      const def = UNITS[u.unitId];
      const target = nearestEnemyUnit(mySide, oppSide, u.x, movingRight);
      const distToBase = movingRight ? (oppSide.baseX - u.x) : (u.x - oppSide.baseX);
      const targetDist = target ? Math.abs(target.x - u.x) : distToBase;
      const inRangeOfUnit = target && targetDist <= def.range;
      const inRangeOfBase = !target && distToBase <= def.range;

      if (inRangeOfUnit || inRangeOfBase) {
        u.cooldown -= dt;
        if (u.cooldown <= 0) {
          u.cooldown = def.cooldown;
          if (inRangeOfUnit) {
            target.hp -= def.attack;
            spawnPopup(target.x, -30, `-${def.attack}`, u.side === "player" ? "#41ffa1" : "#ff5c74");
            if (target.hp <= 0) {
              target.alive = false;
              mySide.gold += Math.round(UNITS[target.unitId].cost * 0.3);
            }
          } else {
            oppSide.baseHp -= def.attack;
            spawnPopup(oppSide.baseX + (movingRight ? -20 : 20), -30, `-${def.attack}`, "#ffe08a");
          }
        }
      } else {
        u.x += (movingRight ? 1 : -1) * def.speed * dt;
      }
    }
    // compact dead units out of the array occasionally (not every tick, to
    // avoid churn) — release back to the pool as they're removed.
    if (mySide.units.some((u) => !u.alive)) {
      mySide.units = mySide.units.filter((u) => {
        if (u.alive) return true;
        unitPool.release(u);
        return false;
      });
    }
  }

  function stepTurret(mySide, oppSide, movingRight, dt) {
    mySide.turretCooldown = Math.max(0, mySide.turretCooldown - dt);
  }

  function fireTurret(mySide, oppSide, movingRight) {
    if (mySide.turretCooldown > 0) return;
    const cooldownScale = mySide.path === "tech" ? 0.6 : 1.0;
    let best = null, bestDist = Infinity;
    for (const u of oppSide.units) {
      if (!u.alive) continue;
      const d = Math.abs(u.x - mySide.baseX);
      if (d <= TURRET_RANGE && d < bestDist) { bestDist = d; best = u; }
    }
    mySide.turretCooldown = TURRET_COOLDOWN * cooldownScale;
    if (best) {
      best.hp -= TURRET_DAMAGE;
      spawnPopup(best.x, -50, `-${TURRET_DAMAGE}`, "#1ef0ff");
      if (best.hp <= 0) {
        best.alive = false;
        mySide.gold += Math.round(UNITS[best.unitId].cost * 0.3);
      }
    }
  }

  function aiThink(dt) {
    if (state.over) return;
    state.aiTimer -= dt;
    if (state.aiTimer > 0) return;
    state.aiTimer = 1.1 + Math.random() * 0.9;

    const eraIx = state.enemy.eraIndex;
    const available = unitsForEra(eraIx, state.enemy.path).filter((id) => UNITS[id].cost <= state.enemy.gold);
    if (available.length && Math.random() < 0.85) {
      const pick = available[Math.floor(Math.random() * available.length)];
      spawnUnit(state.enemy, pick);
    }
    // Occasionally advance era once affordable and enough time has passed,
    // so the AI provides a genuine ramping challenge instead of rushing
    // straight to Future Age turn one.
    const next = ERAS[eraIx + 1];
    if (next && state.enemy.gold >= next.advanceCost && state.t > (eraIx + 1) * 25 && Math.random() < 0.02) {
      advanceEra(state.enemy, eraIx + 1 === BRANCH_ERA_INDEX ? (Math.random() < 0.5 ? "military" : "tech") : undefined);
    }
    if (Math.random() < 0.15) fireTurret(state.enemy, state.player, false);
  }

  function advanceEra(side, chosenPath) {
    const nextIndex = side.eraIndex + 1;
    const era = ERAS[nextIndex];
    if (!era || side.gold < era.advanceCost) return false;
    side.gold -= era.advanceCost;
    side.eraIndex = nextIndex;
    side.baseMaxHp += 100;
    side.baseHp = Math.min(side.baseMaxHp, side.baseHp + 100);
    if (nextIndex === BRANCH_ERA_INDEX) side.path = chosenPath || side.path || "military";
    return true;
  }

  function simulateTick(dt) {
    if (state.over) return;
    state.t += dt;

    // passive income, Tech path gets a bonus
    const playerIncome = 5 + state.player.eraIndex + (state.player.path === "tech" ? 3 : 0);
    const enemyIncome = 5 + state.enemy.eraIndex + (state.enemy.path === "tech" ? 3 : 0);
    state.player.gold += playerIncome * dt;
    state.enemy.gold += enemyIncome * dt;

    stepUnits(state.player, state.enemy, true, dt);
    stepUnits(state.enemy, state.player, false, dt);
    stepTurret(state.player, state.enemy, true, dt);
    stepTurret(state.enemy, state.player, false, dt);
    aiThink(dt);

    for (let i = state.popups.length - 1; i >= 0; i--) {
      const p = state.popups[i];
      p.life -= dt; p.y -= 24 * dt;
      if (p.life <= 0) { popupPool.release(p); state.popups.splice(i, 1); }
    }

    if (state.enemy.baseHp <= 0 && !state.over) { state.over = true; state.winner = "player"; }
    else if (state.player.baseHp <= 0 && !state.over) { state.over = true; state.winner = "enemy"; }
  }

  // ---------------------------------------------------------------------
  // Rendering (canvas 2D — simple shapes, no external art assets)
  // ---------------------------------------------------------------------
  const canvas = document.getElementById("battlefield");
  const ctx = canvas.getContext("2d");

  function worldToScreen(x) {
    return (x / LANE_LENGTH) * canvas.width;
  }

  function drawBase(side, x, color) {
    const sx = worldToScreen(x);
    const h = 90 + (side.eraIndex * 8);
    ctx.fillStyle = color;
    ctx.fillRect(sx - 22, canvas.height - h - 20, 44, h);
    ctx.fillStyle = "rgba(255,255,255,.15)";
    ctx.fillRect(sx - 22, canvas.height - h - 20, 44, 6);
  }

  function drawUnit(u) {
    const def = UNITS[u.unitId];
    const sx = worldToScreen(u.x);
    const groundY = canvas.height - 26;
    const size = 10 + Math.min(10, def.hp / 20);
    ctx.fillStyle = u.side === "player" ? "#41ffa1" : "#ff5c74";
    ctx.beginPath();
    ctx.arc(sx, groundY - size, size, 0, Math.PI * 2);
    ctx.fill();
    // hp sliver
    const hpFrac = Math.max(0, u.hp / u.maxHp);
    ctx.fillStyle = "rgba(255,255,255,.25)";
    ctx.fillRect(sx - size, groundY - size * 2 - 8, size * 2, 3);
    ctx.fillStyle = "#fff";
    ctx.fillRect(sx - size, groundY - size * 2 - 8, size * 2 * hpFrac, 3);
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255,255,255,.06)";
    ctx.beginPath();
    ctx.moveTo(0, canvas.height - 20); ctx.lineTo(canvas.width, canvas.height - 20);
    ctx.stroke();

    drawBase(state.player, state.player.baseX, "#1ef0ff");
    drawBase(state.enemy, state.enemy.baseX, "#ff9a5c");
    for (const u of state.player.units) if (u.alive) drawUnit(u);
    for (const u of state.enemy.units) if (u.alive) drawUnit(u);

    ctx.font = "700 12px monospace";
    for (const p of state.popups) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life / 0.8);
      ctx.fillText(p.text, worldToScreen(p.x), canvas.height - 40 + p.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------
  // UI wiring
  // ---------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const unitButtonsEl = $("[data-unit-buttons]");
  const branchModal = $("[data-branch-modal]");
  const endModal = $("[data-end-modal]");

  // Tracks what the unit-button bar was last built for, so it's only
  // rebuilt (innerHTML replaced) on an era/path change — NOT every frame.
  // Rebuilding it 60x/sec was real, measurable DOM churn, and worse: it
  // replaced button elements mid-click, breaking input. Per-frame HUD
  // updates below only ever toggle `disabled`/textContent on the SAME
  // persistent elements — the DOM-churn analogue of "no allocation in the
  // hot loop" from §6.
  let unitButtonsBuiltForEra = -1;
  let unitButtonsBuiltForPath = null;

  function rebuildUnitButtonsIfNeeded() {
    if (unitButtonsBuiltForEra === state.player.eraIndex && unitButtonsBuiltForPath === state.player.path) return;
    unitButtonsBuiltForEra = state.player.eraIndex;
    unitButtonsBuiltForPath = state.player.path;
    const ids = unitsForEra(state.player.eraIndex, state.player.path);
    unitButtonsEl.innerHTML = ids.map((id) => {
      const def = UNITS[id];
      return `<button class="unit-btn" data-spawn="${id}"><b>${def.name}</b><span>${def.cost}g · ${def.attack} dmg</span></button>`;
    }).join("");
  }

  function renderHud() {
    $("[data-player-hp-fill]").style.width = `${Math.max(0, (state.player.baseHp / state.player.baseMaxHp) * 100)}%`;
    $("[data-enemy-hp-fill]").style.width = `${Math.max(0, (state.enemy.baseHp / state.enemy.baseMaxHp) * 100)}%`;
    $("[data-player-hp-text]").textContent = `${Math.max(0, Math.round(state.player.baseHp))} / ${state.player.baseMaxHp}`;
    $("[data-enemy-hp-text]").textContent = `${Math.max(0, Math.round(state.enemy.baseHp))} / ${state.enemy.baseMaxHp}`;
    $("[data-gold]").textContent = `💰 ${Math.floor(state.player.gold)}`;
    $("[data-era-name]").textContent = ERAS[state.player.eraIndex].name + (state.player.path ? ` · ${state.player.path}` : "");

    rebuildUnitButtonsIfNeeded();
    for (const btn of unitButtonsEl.querySelectorAll("[data-spawn]")) {
      const def = UNITS[btn.dataset.spawn];
      btn.disabled = state.player.gold < def.cost;
    }

    const advanceBtn = $("[data-advance-btn]");
    const next = ERAS[state.player.eraIndex + 1];
    if (!next) { advanceBtn.disabled = true; advanceBtn.textContent = "Max Era"; }
    else { advanceBtn.disabled = state.player.gold < next.advanceCost; advanceBtn.textContent = `⬆ Advance to ${next.name} (${next.advanceCost}g)`; }
  }

  function showEndScreen() {
    endModal.hidden = false;
    $("[data-end-title]").textContent = state.winner === "player" ? "Victory!" : "Defeated";
    $("[data-end-sub]").textContent = state.winner === "player"
      ? "The enemy Warden's base has fallen."
      : "Your base has fallen. Try a different path next time.";
  }

  document.addEventListener("click", (e) => {
    const spawnBtn = e.target.closest("[data-spawn]");
    if (spawnBtn) spawnUnit(state.player, spawnBtn.dataset.spawn);

    if (e.target.closest("[data-turret-btn]")) fireTurret(state.player, state.enemy, true);

    if (e.target.closest("[data-advance-btn]")) {
      const nextIndex = state.player.eraIndex + 1;
      if (nextIndex === BRANCH_ERA_INDEX) {
        if (ERAS[nextIndex] && state.player.gold >= ERAS[nextIndex].advanceCost) branchModal.hidden = false;
      } else {
        advanceEra(state.player);
      }
    }

    const pathBtn = e.target.closest("[data-path-choice]");
    if (pathBtn) {
      advanceEra(state.player, pathBtn.dataset.pathChoice);
      branchModal.hidden = true;
    }

    if (e.target.closest("[data-restart-btn]")) {
      resetGame();
      endModal.hidden = true;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); fireTurret(state.player, state.enemy, true); }
  });

  // ---------------------------------------------------------------------
  // Main loop — fixed timestep simulation, rAF-driven render
  // ---------------------------------------------------------------------
  function frame(now) {
    if (!state.lastFrameTime) state.lastFrameTime = now;
    let delta = (now - state.lastFrameTime) / 1000;
    state.lastFrameTime = now;
    delta = Math.min(delta, 0.25); // clamp huge gaps (tab was backgrounded)
    state.accumulator += delta;

    while (state.accumulator >= TICK_SECONDS) {
      simulateTick(TICK_SECONDS);
      state.accumulator -= TICK_SECONDS;
    }

    render();
    renderHud();
    if (state.over && endModal.hidden) showEndScreen();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  renderHud();

  // ---------------------------------------------------------------------
  // Test/debug hook — NOT part of normal play, used for automated
  // verification only (see README.md "How this was verified").
  // ---------------------------------------------------------------------
  window.__PhantomAgesTest = {
    tick(n = 1) { for (let i = 0; i < n; i++) simulateTick(TICK_SECONDS); render(); renderHud(); },
    getState() { return state; },
    spawn(side, unitId) { return spawnUnit(side === "player" ? state.player : state.enemy, unitId); },
    forceGold(side, amount) { (side === "player" ? state.player : state.enemy).gold = amount; },
    advanceEra(side, path) { return advanceEra(side === "player" ? state.player : state.enemy, path); },
    reset() { resetGame(); },
  };
})();
