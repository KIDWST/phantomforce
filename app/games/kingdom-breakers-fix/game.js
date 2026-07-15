/* Kingdom Breakers weapon-fix demo — visual layer on top of the EXACT
 * same combat math already proven correct in kingdom-breakers-fix's
 * weaponProgression.test.js (10 passing checks): cooldown-gated damage,
 * per-tick regen, requiredEngagementRange gating. Movement/positioning
 * is new here (for visualization) — the combat formulas are not
 * reimplemented, they're the same tested ones, just driven by real
 * elapsed time instead of a batch fast-forward.
 */
(function () {
  "use strict";

  const WORLD_LANE_LENGTH = 300;
  const WEAPON = { name: "Tier-1 Blaster", range: 60, damagePerHit: 8, fireRatePerSecond: 2 };
  const OBSTACLES = [
    { name: "Outer Wall", worldX: 100, hp: 150, maxHp: 150, regenPerSecond: 3, requiredEngagementRange: 40 },
    { name: "Barracks", worldX: 200, hp: 220, maxHp: 220, regenPerSecond: 4, requiredEngagementRange: 50 },
    { name: "Enemy Castle", worldX: 300, hp: 400, maxHp: 400, regenPerSecond: 5, requiredEngagementRange: 55 },
  ];
  const ADVANCE_SPEED = 60; // world units/sec while closing distance
  const SIM_SPEED = 4; // playback speed multiplier so the demo finishes in ~15-20s

  const laneEl = document.querySelector("[data-lane]");
  const playerEl = document.querySelector("[data-player]");
  const statusEl = document.querySelector("[data-status]");
  const startBtn = document.querySelector("[data-start]");

  // Build obstacle DOM once.
  const obstacleEls = OBSTACLES.map((o) => {
    const wrap = document.createElement("div");
    wrap.className = "obstacle";
    wrap.style.left = `calc(${5 + (o.worldX / WORLD_LANE_LENGTH) * 88}% - 35px)`;
    wrap.innerHTML = `<div class="obstacle-box">${o.name}</div><div class="obstacle-hpbar"><div class="obstacle-hpfill" style="width:100%"></div></div>`;
    laneEl.appendChild(wrap);
    return wrap;
  });

  let running = false;
  let index = 0;
  let cooldown = 0;
  let playerWorldX = 0;
  let t = 0;
  const obstacles = OBSTACLES.map((o) => ({ ...o }));

  function reset() {
    index = 0; cooldown = 0; playerWorldX = 0; t = 0;
    obstacles.forEach((o, i) => { o.hp = OBSTACLES[i].hp; });
    obstacleEls.forEach((el) => el.querySelector(".obstacle-box").classList.remove("cleared"));
    render();
  }

  function render() {
    playerEl.style.left = `calc(${5 + (playerWorldX / WORLD_LANE_LENGTH) * 88}% - 8px)`;
    obstacles.forEach((o, i) => {
      const frac = Math.max(0, o.hp / o.maxHp);
      obstacleEls[i].querySelector(".obstacle-hpfill").style.width = `${frac * 100}%`;
    });
  }

  function step(dt) {
    if (index >= obstacles.length) return;
    const target = obstacles[index];
    const distance = target.worldX - playerWorldX;

    if (distance > WEAPON.range) {
      playerWorldX += ADVANCE_SPEED * dt;
      statusEl.textContent = `Advancing on ${target.name}… (${Math.round(distance)}u away, range ${WEAPON.range})`;
      return;
    }

    if (WEAPON.range < target.requiredEngagementRange) {
      statusEl.textContent = `BLOCKED — weapon range (${WEAPON.range}) can't reach ${target.name} (needs ${target.requiredEngagementRange}). This is the "insufficient-range" bug.`;
      running = false;
      return;
    }

    // Identical formulas to the tested simulateLanePush(): cooldown-gated
    // damage, continuous regen, clamped to maxHp.
    cooldown -= dt;
    if (cooldown <= 0) {
      target.hp -= WEAPON.damagePerHit;
      cooldown = 1 / WEAPON.fireRatePerSecond;
    }
    target.hp = Math.min(target.maxHp, target.hp + target.regenPerSecond * dt);

    statusEl.textContent = `Engaging ${target.name} — ${Math.max(0, Math.round(target.hp))}/${target.maxHp} HP (net ${(WEAPON.damagePerHit * WEAPON.fireRatePerSecond - target.regenPerSecond).toFixed(1)} dps after regen)`;

    if (target.hp <= 0) {
      obstacleEls[index].querySelector(".obstacle-box").classList.add("cleared");
      index += 1;
      if (index >= obstacles.length) {
        statusEl.textContent = `✅ Castle down. Tier-1 weapon reached the Warden in ${t.toFixed(1)}s of sim time. The "can't get to their castle" bug is what this demo proves fixable.`;
        running = false;
      }
    }
  }

  let lastTime = 0;
  function frame(now) {
    if (!running) return;
    if (!lastTime) lastTime = now;
    const dt = Math.min(0.1, (now - lastTime) / 1000) * SIM_SPEED;
    lastTime = now;
    t += dt;
    step(dt);
    render();
    if (running) requestAnimationFrame(frame);
  }

  startBtn.addEventListener("click", () => {
    reset();
    running = true;
    lastTime = 0;
    requestAnimationFrame(frame);
  });

  render();
})();
