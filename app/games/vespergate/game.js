/* VESPERGATE: THE VESPER HAND — game.js
 * Top-down action-adventure: Duskhollow village, the open Vale, the Vesper
 * Hand (strike / cinder bolt / linked gates), NPCs + dialogue + quests +
 * inventory + shop, two dungeons with bosses, and the evensong ending.
 * Portal collision fix: an open gate pair is a HOLE in the wall — walking
 * through a portal is walking through a doorway.
 */
"use strict";
(() => {
  const VG = window.VG, T = VG.TILE;
  const ctx = VG.ctx;
  const D = VG.DATA;
  const embedded = window.parent !== window;
  const host = (type, data = {}) => { if (embedded) parent.postMessage({ source: "phantomplay-game", type, ...data }, "*"); };
  const $ = (s) => document.querySelector(s);

  /* ================= state ================= */
  const state = {
    phase: "title",   // title | playing | dialog | inventory | shop | scene | paused | dead | win
    room: null, roomId: "maren",
    t: 0, score: 0, kills: 0,
    quests: {}, flags: {}, shopBought: {},
    dialog: null, scene: null, banner: null,
    bossHp: 0, bossMax: 1, completeSent: false,
    combo: 0, comboT: 0, bestCombo: 0,
    damageFlash: 0, roomFade: 0,
    dawn: 0, dawnTransition: false,           // 0 = full night, 1 = daylight restored (evensong)
    vesperHearts: 0, heartsTotal: 2,
    soulTiers: {},                             // id -> true once a Vesper Soul power-up tier is unlocked
  };
  VG.state = state;
  for (const q of Object.keys(D.QUESTS)) state.quests[q] = "locked";
  const portals = new VG.PortalSystem();
  VG.portals = portals;

  const player = {
    x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, r: 6, w: 10,
    fx: 0, fy: 1,                     // facing
    hp: 4, maxHp: 4, embers: 0, vesperSouls: 0,
    iframe: 0, strikeCd: 0, strikeT: 0, boltCd: 0,
    rollT: 0, rollCd: 0, rollDir: { x: 0, y: 1 },
    relics: {}, equipped: [],          // owned map, equipped ids (max 2)
    materials: { wolfshard: 0, glassshard: 0 },
    aimx: 0, aimy: 1, dead: false, _key: "player",
    _trail: [], _stepT: 0,             // roll afterimage samples; footstep-dust timer
    // Vesper Soul power-up bonuses, applied permanently as tiers unlock
    bonusMeleeDmg: 0, bonusStrikeCdMul: 1, bonusBeamDmg: 0, bonusReach: 0, bonusMagnetMul: 1,
    // cosmetics: { owned: [ids], equipped: { cloak, glow, accessory, trail } }
    cosmetics: { owned: [], equipped: { cloak: null, glow: null, accessory: null, trail: null } },
  };
  VG.player = player;
  const relicOn = (id) => player.equipped.includes(id);

  let shots = [], bolts = [], enemies = [], pickups = [], rings = [], particles = [], floatText = [], npcs = [], boss = null;
  let wrongVisitRoomId = null; // Presence system: this room-visit carries a "moved without you" tell
  let wasStill = false, stillSince = 0; // Presence system: "don't look back" still->moving transition

  /* ================= helpers ================= */
  function spawnParticles(x, y, color, n, spd = 60) {
    if (VG.settings.reducedEffects) n = Math.min(3, n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random());
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.3, max: 0.6, color });
    }
  }
  function toast(text, x, y, color = "#eaf2ff") { floatText.push({ text, x, y, life: 1.4, color }); }
  function banner(text) { state.banner = { text, t: 2.6 }; }
  function questsDone() { return Object.values(state.quests).filter((s) => s === "done").length; }
  function rep() { return ["q_wolves", "q_lantern", "q_bell", "q_glass"].filter((q) => state.quests[q] === "done").length; }
  function roomFlags() {
    return { bellRestored: !!state.flags.bellRestored, fencesFixed: rep() >= 2, lanternsLit: state.flags.bellRestored ? true : rep() >= 1 || true };
  }
  function progressPct() { return Math.round(questsDone() / 6 * 100); }

  /* ================= quests ================= */
  function acceptQuest(id) {
    if (state.quests[id] !== "locked") return;
    state.quests[id] = "active";
    banner("NEW QUEST — " + D.QUESTS[id].title);
    VG.sfx(520, 0.12, "triangle", 0.05); VG.sfx(660, 0.14, "triangle", 0.04);
    saveGame();
  }
  function completeQuest(id) {
    if (state.quests[id] === "done") return;
    state.quests[id] = "done";
    VG.dread.notifyQuestProgress();
    const q = D.QUESTS[id];
    if (q.reward) { player.embers += q.reward; toast("+" + q.reward + " embers", player.x, player.y - 16, "#ffcf6b"); }
    banner("QUEST COMPLETE — " + q.title);
    VG.sfxBell(180, 0.12);
    state.score += 250;
    host("progress", { progress: progressPct(), state: { quests: state.quests } });
    saveGame();
  }
  function trackedQuest() {
    const order = ["q_evensong", "q_glass", "q_bell", "q_lantern", "q_wolves", "q_hand"];
    for (const id of order) if (state.quests[id] === "active") return D.QUESTS[id];
    return null;
  }

  /* ================= collision (gate-hole aware) ================= */
  function blocked(x, y) {
    if (portals.holeAt(x, y)) return false;      // THE portal fix
    return state.room.blockedAtPx(x, y);
  }
  function solidShot(x, y) {
    if (portals.holeAt(x, y)) return false;
    return state.room.solidAtPx(x, y);
  }
  function moveBody(o, dt) {
    const r = o.r;
    let nx = o.x + o.vx * dt;
    if (o.vx !== 0) {
      const dir = Math.sign(o.vx), ex = nx + dir * r;
      if (blocked(ex, o.y - r * 0.6) || blocked(ex, o.y) || blocked(ex, o.y + r * 0.6)) { nx = o.x; o.vx = 0; }
    }
    o.x = nx;
    let ny = o.y + o.vy * dt;
    if (o.vy !== 0) {
      const dir = Math.sign(o.vy), ey = ny + dir * r;
      if (blocked(o.x - r * 0.6, ey) || blocked(o.x, ey) || blocked(o.x + r * 0.6, ey)) { ny = o.y; o.vy = 0; }
    }
    o.y = ny;
  }

  /* ================= aim & gates ================= */
  function updateAim() {
    if (VG.input.usingPad && VG.input.pad) {
      const a = VG.input.padAim, m = Math.hypot(a.x, a.y);
      if (m > 0.2) { player.aimx = a.x / m; player.aimy = a.y / m; }
    } else {
      const w = VG.camera.screenToWorld(VG.input.mx, VG.input.my);
      const dx = w.x - player.x, dy = w.y - player.y, m = Math.hypot(dx, dy) || 1;
      player.aimx = dx / m; player.aimy = dy / m;
    }
  }
  let placePreview = null;
  function updateGatePreview() {
    if (!state.flags.hasHand) { placePreview = null; return; }
    const sw = VG.camera.screenToWorld(VG.input.mx, VG.input.my);
    const wx = VG.input.usingPad ? player.x + player.aimx * 80 : sw.x;
    const wy = VG.input.usingPad ? player.y + player.aimy * 80 : sw.y;
    let cls = state.room.classifyPortal(wx, wy);
    if (!cls.valid && cls.reason === "open-air") {
      const dx = wx - player.x, dy = wy - player.y, m = Math.hypot(dx, dy) || 1;
      for (let d2 = 10; d2 < 180; d2 += 6) {
        const c2 = state.room.classifyPortal(player.x + dx / m * d2, player.y + dy / m * d2);
        if (c2.valid || c2.reason !== "open-air") { cls = c2; break; }
      }
    }
    placePreview = cls;
  }
  function placeGate() {
    if (!state.flags.hasHand) return;
    if (!placePreview || !placePreview.valid) { VG.sfxGate(portals.selected, "invalid"); toast("no gate here", player.x, player.y - 18, "#ff8095"); return; }
    portals.place(portals.selected, placePreview.x, placePreview.y, placePreview.dir, true);
    portals.selected = 1 - portals.selected;   // Zelda-simple: alternate ends automatically
    spawnParticles(placePreview.x, placePreview.y, portals.selected === 0 ? "#8fe9ff" : "#ff9ad0", 8, 50);
  }

  /* ================= combat ================= */
  function strike() {
    if (player.strikeCd > 0) return;
    player.strikeCd = 0.32 * player.bonusStrikeCdMul; player.strikeT = 0.14;
    VG.sfxCinder("needle"); VG.camera.jolt(0.05);
    const reach = 20 + player.bonusReach, arc = 1.15;
    const fa = Math.atan2(player.fy, player.fx);
    spawnParticles(player.x + player.fx * 12, player.y + player.fy * 12, "#ffd166", 5, 55);
    for (const e of enemies) {
      if (e.dead) continue;
      const d = VG.dist(player.x, player.y, e.x, e.y);
      if (d > reach + e.r) continue;
      const da = Math.abs(Math.atan2(Math.sin(Math.atan2(e.y - player.y, e.x - player.x) - fa), Math.cos(Math.atan2(e.y - player.y, e.x - player.x) - fa)));
      if (da > arc) continue;
      const fromBehind = e.facing ? (Math.cos(e.facing) * (e.x - player.x) + Math.sin(e.facing) * (e.y - player.y)) > 0 : true;
      damageEnemy(e, 10 + player.bonusMeleeDmg, fromBehind);
      // Knockback impulse, not an instant position nudge: applied/decayed in
      // stepEnemy so it survives that enemy's own AI movement this frame
      // instead of being immediately overwritten by it.
      e.kx = (e.kx || 0) + player.fx * 210; e.ky = (e.ky || 0) + player.fy * 210;
    }
    if (boss && !boss.dead && VG.dist(player.x, player.y, boss.x, boss.y) < reach + boss.r) damageBoss(8 + player.bonusMeleeDmg);
    // deflect bolts
    for (const b of bolts) {
      if (b.hostileToEnemies) continue;
      if (VG.dist(b.x, b.y, player.x, player.y) < 24) {
        b.vx = player.fx * 300; b.vy = player.fy * 300; b.hostileToEnemies = true; b.color = "#ffd166";
        if (relicOn("mirrorlitany")) { b.dmg *= 2.2; b.color = "#8fe9ff"; b._pierce = 2; }
        VG.sfx(700, 0.05, "sine", 0.05);
      }
    }
    // Bell Sigil: resonant pulse + rings nearby brass
    if (relicOn("bellsigil")) {
      rings.push({ x: player.x, y: player.y, r: 6, vr: 120, dmg: 2, life: 0.5, hostile: false });
      ringNearbyBrass(player.x, player.y, 26);
    }
  }
  function fireBolt() {
    if (!state.flags.hasHand) return;
    // The beam only answers a Hand at full health — take a single hit and
    // it's melee-only until a heart restores you back to max. No ash cost:
    // full HP *is* the resource.
    if (player.boltCd > 0 || player.hp < player.maxHp) { if (player.hp < player.maxHp) VG.sfx(200, 0.05, "square", 0.03); return; }
    player.boltCd = 0.22;
    shots.push({
      x: player.x + player.aimx * 8, y: player.y + player.aimy * 8,
      vx: player.aimx * 300, vy: player.aimy * 300,
      r: 2, dmg: 4 + player.bonusBeamDmg, life: 1.8, _bounces: 0, foldshot: false, pierce: 0, key: "shot" + Math.random(),
    });
    VG.sfxCinder("needle"); VG.camera.jolt(0.04);
    spawnParticles(player.x + player.aimx * 8, player.y + player.aimy * 8, "#ffcf6b", 2, 40);
  }
  function damageEnemy(e, dmg, fromBehind) {
    if (e.dead) return;
    if (e.type === "guard" && e.shield && !fromBehind) { spawnParticles(e.x, e.y, "#8aa", 3, 30); VG.sfx(320, 0.04, "square", 0.03); return; }
    e.hp -= dmg; e.hurt = 0.12; spawnParticles(e.x, e.y, "#ffd166", 6, 70);
    VG.sfx(500, 0.03, "triangle", 0.03);
    if (e.hp <= 0) killEnemy(e);
  }
  function killEnemy(e) {
    e.dead = true; state.kills++;
    state.combo = state.comboT > 0 ? state.combo + 1 : 1;
    state.comboT = 3.25;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    const multiplier = Math.min(4, 1 + Math.floor((state.combo - 1) / 2));
    state.score += 100 * multiplier;
    spawnParticles(e.x, e.y, "#8fe9ff", 12);
    VG.camera.jolt(0.09);
    if (state.combo >= 2) toast(`${state.combo} SOUL CHAIN  ×${multiplier}`, e.x, e.y - 18, state.combo >= 6 ? "#ffcf6b" : "#8fe9ff");
    const val = e.type === "wolf" ? 4 : e.type === "guard" ? 6 : e.type === "mourner" ? 6 : 3;
    for (let i = 0; i < val; i++) pickups.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90, type: "ember", value: 1, bob: Math.random() * 6 });
    const soulVal = e.type === "guard" || e.type === "mourner" ? 3 : e.type === "wolf" ? 2 : 1;
    for (let i = 0; i < soulVal; i++) pickups.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90, type: "soul", value: 1, bob: Math.random() * 6 });
    if (e.type === "wolf") player.materials.wolfshard++;
    if (e.type === "mourner") {
      player.materials.glassshard++;
      shootBolt(e.x, e.y, -0.7, -0.7, 160, 1, "#c9d6e8"); shootBolt(e.x, e.y, 0.7, -0.7, 160, 1, "#c9d6e8");
      VG.sfx(900, 0.08, "triangle", 0.05);
      if (e.tag === "choir") for (const o of enemies) if (!o.dead && o.tag === "choir") { o.enrage = (o.enrage || 0) + 1; }
    }
    // quest: wolves in the orchard
    if (e.tag === "q_wolves" && state.quests.q_wolves === "active") {
      state.flags.wolfKills = (state.flags.wolfKills || 0) + 1;
      toast(state.flags.wolfKills + " / 4 wolves", e.x, e.y - 12, "#d0ffc0");
      if (state.flags.wolfKills >= 4) completeQuest("q_wolves");
    }
    // choir cleared → glass quest done + relic
    if (state.room && VG.ROOMS[state.roomId].choir && !enemies.some((o) => !o.dead && o.tag === "choir")) {
      if (!state.flags.glassDone) {
        state.flags.glassDone = true;
        completeQuest("q_glass");
        player.relics.mirrorlitany = true;
        banner("RELIC — Mirror Litany");
        toast("Owning it isn't enough — open TAB and equip it (max 2)", player.x, player.y - 28, "#c9d6e8");
        VG.sfxBell(240, 0.16);
        grantHeart("heart_choir", "VESPER HEART — the Choir's voice, silenced");
      }
    }
  }
  function grantHeart(flagKey, msg) {
    if (state.flags[flagKey]) return;
    state.flags[flagKey] = true;
    state.vesperHearts = Math.min(state.heartsTotal, state.vesperHearts + 1);
    banner(`${msg}  (${state.vesperHearts}/${state.heartsTotal})`);
  }
  const SOUL_TIERS = [
    { at: 15, apply: () => { player.bonusMeleeDmg += 3; }, msg: "SOUL-TEMPERED STRIKE — melee +3 damage" },
    { at: 40, apply: () => { player.bonusStrikeCdMul *= 0.85; }, msg: "STEADY HAND — strike recovers 15% faster" },
    { at: 75, apply: () => { player.bonusBeamDmg += 3; }, msg: "FOCUSED BEAM — beam +3 damage" },
    { at: 120, apply: () => { player.bonusReach += 6; }, msg: "WIDE REACH — melee reach +6" },
    { at: 180, apply: () => { player.bonusMagnetMul *= 2; }, msg: "SOUL MAGNET — pickup range doubled" },
  ];
  function checkSoulTiers() {
    for (const tier of SOUL_TIERS) {
      const key = "soulTier" + tier.at;
      if (!state.soulTiers[key] && player.vesperSouls >= tier.at) {
        state.soulTiers[key] = true;
        tier.apply();
        banner(tier.msg);
        VG.sfxBell(300, 0.14);
      }
    }
  }
  function damageBoss(dmg) {
    if (!boss || boss.dead) return;
    const prevPhase = boss.phase;
    boss.hp -= dmg; boss.hurt = 0.1; spawnParticles(boss.x, boss.y, "#ffd166", 5);
    const newPhase = boss.hp > boss.maxHp * 0.66 ? 1 : boss.hp > boss.maxHp * 0.33 ? 2 : 3;
    if (newPhase !== prevPhase && boss.hp > 0) {
      VG.fx.hitStop(0.09); VG.camera.jolt(0.45);
      VG.fx.spawnShockwave(boss.x, boss.y, { maxR: 320, speed: 180, color: "255,90,70" });
      VG.sfxBell(140, 0.18);
      toast(newPhase === 3 ? "THE BELLMOTHER WAKES FULLY" : "THE BRONZE STIRS", boss.x, boss.y - 26, "#ff8095");
    }
    if (boss.hp <= 0) {
      boss.dead = true;
      state.flags.bellRestored = true;
      completeQuest("q_bell");
      player.relics.bellsigil = true;
      banner("RELIC — Bell Sigil");
      grantHeart("heart_bellmother", "VESPER HEART — the Bellmother's toll, silenced");
      toast("THE BRONZE REMEMBERS ITS SONG", boss.x, boss.y - 24, "#8fe9ff");
      toast("Owning it isn't enough — open TAB and equip it (max 2)", player.x, player.y - 28, "#c9d6e8");
      VG.sfxBell(220, 0.2);
      VG.fx.hitStop(0.14); VG.camera.jolt(0.5);
      VG.fx.spawnShockwave(boss.x, boss.y, { maxR: 420, speed: 210, color: "143,233,255" });
      spawnParticles(boss.x, boss.y, "#c9d6e8", 26, 110);
      spawnParticles(boss.x, boss.y, "#5a4020", 16, 70);
      state.score += 1000;
    }
  }
  function hurtPlayer(dmg, kx = 0, ky = 0) {
    if (player.iframe > 0 || player.dead || player.rollT > 0) return;
    player.hp -= Math.max(1, Math.round(dmg * VG.settings.damageTaken));
    player.iframe = 0.9;
    state.damageFlash = 1;
    // Knockback lives in kx/ky, not vx/vy directly: the movement block below
    // reassigns vx/vy from input every frame ("vx = mx * speed"), which used
    // to erase any impulse added here before it ever moved the player — kx/ky
    // is a separate decaying push the movement block adds on top of input,
    // so getting hit actually creates distance instead of leaving the player
    // glued to whatever hit them.
    player.kx += kx * 170; player.ky += ky * 170;
    VG.camera.jolt(0.3); spawnParticles(player.x, player.y, "#ff5c74", 8);
    VG.sfx(140, 0.14, "sawtooth", 0.06);
    if (player.hp <= 0) { player.dead = true; state.phase = "dead"; showOverlay("dead"); }
  }
  function shootBolt(x, y, dx, dy, spd, dmg, color = "#ff9a5d") {
    bolts.push({ x, y, vx: dx * spd, vy: dy * spd, r: 3, dmg, life: 3, color, key: "b" + Math.random() });
  }
  function ringNearbyBrass(x, y, radius) {
    const gx0 = Math.floor((x - radius) / T), gx1 = Math.floor((x + radius) / T);
    const gy0 = Math.floor((y - radius) / T), gy1 = Math.floor((y + radius) / T);
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      if (state.room.matAt(gx, gy) === VG.MAT.BRASS) ringBell(gx * T + 8, gy * T + 8);
    }
  }
  function ringBell(bx, by) {
    rings.push({ x: bx, y: by, r: 8, vr: 150, dmg: 4, life: 2, hostile: false });
    VG.sfxBell(110, 0.18); VG.camera.jolt(0.12);
    // dungeon bells: mark rung
    const def = VG.ROOMS[state.roomId];
    (def.bells || []).forEach((b, i) => {
      if (VG.dist(bx, by, b.gx * T + 8, b.gy * T + 8) < 24) {
        const key = `bell_${state.roomId}_${i}`;
        if (!state.flags[key]) { state.flags[key] = true; toast("A BELL WAKES", bx, by - 14, "#ffcf6b"); }
      }
    });
  }
  function bellsRung(roomId) {
    const def = VG.ROOMS[roomId];
    return (def.bells || []).filter((b, i) => state.flags[`bell_${roomId}_${i}`]).length;
  }

  /* ================= enemies ================= */
  function makeEnemy(def) {
    const base = {
      x: def.x * T + 8, y: def.y * T + 8, vx: 0, vy: 0, kx: 0, ky: 0, hp: 14, maxHp: 14, r: 7,
      type: def.type, tag: def.tag, elite: !!def.elite, cd: 1 + Math.random(), hurt: 0, dead: false,
      homeX: def.x * T + 8, homeY: def.y * T + 8, wanderT: 0, wx: 0, wy: 0, facing: 0, _key: "e" + Math.random(),
    };
    if (def.type === "wolf") return { ...base, hp: 14, maxHp: 14, lungeT: 0 };
    if (def.type === "guard") return { ...base, hp: 30, maxHp: 30, shield: 1, r: 8 };
    if (def.type === "leech") return { ...base, hp: 10, maxHp: 10, r: 5 };
    if (def.type === "mourner") {
      const hp = def.elite ? 34 : 16;
      return { ...base, hp, maxHp: hp, blinkT: 2 + Math.random(), ghost: 1, enrage: 0 };
    }
    return base;
  }
  function stepEnemy(e, dt) {
    if (e.dead) return;
    e.hurt = Math.max(0, e.hurt - dt);
    // Strike knockback: a decaying position push applied here, ahead of the
    // AI branches below, so a hit visibly shoves the enemy before its own
    // chase logic resumes — instead of the impulse being invisible because
    // the AI's own movement this same frame overwrote it.
    if (e.kx || e.ky) {
      e.x += e.kx * dt; e.y += e.ky * dt;
      e.kx *= 0.85; e.ky *= 0.85;
      if (Math.abs(e.kx) < 1) e.kx = 0;
      if (Math.abs(e.ky) < 1) e.ky = 0;
    }
    const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy) || 1;
    e.facing = Math.atan2(dy, dx);
    if (e.type === "wolf") {
      e.lungeT = Math.max(0, e.lungeT - dt);
      if (d < 100) {
        const sp = e.lungeT > 0 ? 150 : 62;
        e.vx = dx / d * sp; e.vy = dy / d * sp;
        e.cd -= dt;
        if (e.cd <= 0 && d < 60) { e.cd = 1.6; e.lungeT = 0.32; VG.sfx(180, 0.06, "sawtooth", 0.04); }
      } else {
        e.wanderT -= dt;
        if (e.wanderT <= 0) { e.wanderT = 1.4 + Math.random() * 1.6; const a = Math.random() * Math.PI * 2; e.wx = Math.cos(a) * 26; e.wy = Math.sin(a) * 26; }
        e.vx = e.wx * 0.8; e.vy = e.wy * 0.8;
        if (VG.dist(e.x, e.y, e.homeX, e.homeY) > 90) { e.vx = (e.homeX - e.x) * 0.6; e.vy = (e.homeY - e.y) * 0.6; }
      }
      moveBody(e, dt);
    } else if (e.type === "guard") {
      if (d < 150 && d > 26) { e.vx = dx / d * 34; e.vy = dy / d * 34; }
      else { e.vx *= 0.8; e.vy *= 0.8; }
      moveBody(e, dt);
      e.cd -= dt;
      if (d < 150 && e.cd <= 0 && lineClear(e, player)) { e.cd = 1.7; shootBolt(e.x, e.y, dx / d, dy / d, 150, 1); }
    } else if (e.type === "leech") {
      const g = portals.gates.find((gg) => gg.active);
      if (g) {
        const gdx = g.x - e.x, gdy = g.y - e.y, gd = Math.hypot(gdx, gdy) || 1;
        e.x += gdx / gd * 42 * dt; e.y += gdy / gd * 42 * dt;
        if (gd < 14) portals.addStrain(0.10 * dt);
      } else {
        e.wanderT -= dt;
        if (e.wanderT <= 0) { e.wanderT = 2; const a = Math.random() * Math.PI * 2; e.wx = Math.cos(a) * 18; e.wy = Math.sin(a) * 18; }
        e.x += e.wx * dt; e.y += e.wy * dt;
      }
    } else if (e.type === "mourner") {
      const speed = 26 + e.enrage * 10 + (e.elite ? 8 : 0);
      e.x += dx / d * speed * dt; e.y += dy / d * speed * dt + Math.sin(state.t * 2 + e.homeX) * 6 * dt;
      e.blinkT -= dt * (1 + e.enrage * 0.4);
      if (e.blinkT <= 0) {
        e.blinkT = 2.4 + Math.random();
        const mx = state.room.pxW - e.x;    // blink across the mirror axis
        if (!blocked(mx, e.y)) { spawnParticles(e.x, e.y, "#c9d6e8", 5); e.x = mx; spawnParticles(e.x, e.y, "#c9d6e8", 5); }
      }
      e.cd -= dt;
      const boltCd = (e.elite ? 1.4 : 1.9) / (1 + e.enrage * 0.35);
      if (d < 190 && e.cd <= 0) { e.cd = boltCd; shootBolt(e.x, e.y, dx / d, dy / d, 130, 1, "#c9d6e8"); }
    }
    portals.tryTeleport(e, e._key, { strain: 0.04 });
    if (d < e.r + player.r + 2 && player.iframe <= 0) hurtPlayer(1, dx > 0 ? -0.6 : 0.6, dy > 0 ? -0.6 : 0.6);
  }
  function lineClear(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy), steps = Math.ceil(dist / 6);
    for (let i = 1; i < steps; i++) { const t2 = i / steps; if (solidShot(a.x + dx * t2, a.y + dy * t2)) return false; }
    return true;
  }

  /* ================= Bellmother ================= */
  function makeBoss(def) {
    return {
      x: def.x * T, y: def.y * T, hp: 260, maxHp: 260, r: 22,
      phase: 1, cd: 2.2, ringCd: 3, sweep: 0, hurt: 0, dead: false, _key: "boss",
      cx: def.x * T, cy: def.y * T,
    };
  }
  function stepBoss(b, dt) {
    if (b.dead) return;
    b.hurt = Math.max(0, b.hurt - dt);
    b.phase = b.hp > b.maxHp * 0.66 ? 1 : b.hp > b.maxHp * 0.33 ? 2 : 3;
    state.bossHp = b.hp; state.bossMax = b.maxHp;
    b.sweep += dt * (0.5 + b.phase * 0.25);
    b.x = b.cx + Math.cos(b.sweep) * 58;
    b.y = b.cy + Math.sin(b.sweep * (b.phase >= 2 ? 1.6 : 1)) * 40;
    b.ringCd -= dt;
    if (b.ringCd <= 0) {
      b.ringCd = b.phase === 3 ? 1.5 : b.phase === 2 ? 2.1 : 2.7;
      rings.push({ x: b.x, y: b.y, r: 12, vr: 120, dmg: 1, life: 3, hostile: true });
      if (b.phase === 3) rings.push({ x: b.x, y: b.y, r: 2, vr: 85, dmg: 1, life: 3, hostile: true });
      VG.fx.spawnShockwave(b.x, b.y, { maxR: 220, speed: 150, color: b.phase >= 3 ? "255,70,70" : "220,150,90" });
      VG.sfxBell(90, 0.14); VG.camera.jolt(0.15 + b.phase * 0.04);
    }
    b.cd -= dt;
    if (b.phase >= 2 && b.cd <= 0 && enemies.filter((e) => !e.dead).length < 3) {
      b.cd = 6;
      enemies.push(makeEnemy({ type: "leech", x: Math.round(b.x / T), y: Math.round(b.y / T) }));
    }
    if (VG.dist(player.x, player.y, b.x, b.y) < b.r + player.r && player.iframe <= 0) hurtPlayer(1, Math.sign(player.x - b.x), Math.sign(player.y - b.y));
  }

  /* ================= NPCs & dialogue ================= */
  function loadNpcs(def) {
    npcs = (def.npcs || []).map((id) => {
      const n = D.NPCS[id];
      if (!n) return null;
      if (n.showFlag && !state.flags[n.showFlag]) return null;
      return { ...n, px: n.x * T + 8, py: n.y * T + 8, bob: Math.random() * 6 };
    }).filter(Boolean);
  }
  function condOk(when = {}) {
    if (when.flag && !state.flags[when.flag]) return false;
    if (when.notFlag && state.flags[when.notFlag]) return false;
    if (when.questActive && state.quests[when.questActive] !== "active") return false;
    if (when.questDone && state.quests[when.questDone] !== "done") return false;
    if (when.questDoneB && state.quests[when.questDoneB] !== "done") return false;
    if (when.notQuestDone && state.quests[when.notQuestDone] === "done") return false;
    return true;
  }
  /* Presence system: at higher dread, a real dialogue line can be swapped
   * for a flat, context-blind one — the quest/flag actions still fire as
   * normal underneath, only the displayed text is wrong. Never twice in a
   * row for the same NPC, so it reads as a glitch, not a broken NPC. */
  let lastFlatNpc = null;
  function pickDialoguePages(npc, rule) {
    const pool = D.FLATLINES[npc.id];
    if (npc.id === lastFlatNpc) { lastFlatNpc = null; return rule.pages.slice(); }
    if (VG.dread.tier() >= 2 && pool && pool.length && Math.random() < 0.16) {
      lastFlatNpc = npc.id;
      return [pool[Math.floor(Math.random() * pool.length)]];
    }
    return rule.pages.slice();
  }
  function talkTo(npc) {
    const rules = D.DIALOG[npc.id] || [];
    for (const rule of rules) {
      if (!condOk(rule.when)) continue;
      if (rule.scene) { startScene(rule.scene); return; }
      state.dialog = { npc, pages: pickDialoguePages(npc, rule), page: 0, actions: rule.do || null };
      state.phase = "dialog";
      return;
    }
  }
  function advanceDialog() {
    const dlg = state.dialog;
    if (!dlg) return;
    dlg.page++;
    if (dlg.page < dlg.pages.length) return;
    // dialogue over → apply actions
    const act = dlg.actions;
    state.dialog = null; state.phase = "playing";
    if (act) {
      if (act.accept) acceptQuest(act.accept);
      if (act.complete) completeQuest(act.complete);
      if (act.shop) { state.phase = "shop"; state.shopSel = 0; }
    }
  }

  /* ================= scenes ================= */
  const SCENES = {
    handing: {
      pages: [
        "MAREN — “Come here, little bearer. Seventy years this thing has been on my arm, and my mother's before me, and hers.”",
        "MAREN — “It isn't a weapon. It's a KEY that got carried through seven generations of stubborn women.”",
        "MAREN — “Liminal stone. Bell-brass. Saint-glass. The Hand opens doors in anything that remembers being a door.”",
        "The Vesper Hand closes around your forearm. It is warm. It has been waiting.",
        "MAREN — “The Vale is south. The village needs more from you than I ever gave it. Go.”",
      ],
      end() {
        state.flags.hasHand = true;
        state.quests.q_hand = "done";
        acceptQuest("q_wolves");
        banner("THE VESPER HAND — right-click opens gates");
        VG.sfxBell(200, 0.16);
        spawnParticles(player.x, player.y, "#8fe9ff", 16, 80);
        saveGame();
      },
    },
    evensong: {
      pages: [
        "Sexton El takes the rope. Maren puts her hand over yours on the Hand.",
        "The bell swings once — and the whole valley answers. Bronze below. Glass beneath the lake. Every gate you ever opened, ringing in sympathy.",
        "Duskhollow hears evensong for the first time in a year. Pip is crying. He will deny it forever.",
        "MAREN — “Eight bearers. My mother would have liked you, little one.”",
      ],
      end() {
        state.flags.evensong = true;
        completeQuest("q_evensong");
        for (let i = 0; i < 5; i++) setTimeout(() => VG.sfxBell(110 + i * 30, 0.16), i * 420);
        state.score += 1500;
        state.dawnTransition = true;
        if (!state.completeSent) { state.completeSent = true; host("complete", { score: state.score, progress: 100, state: { quests: state.quests } }); }
        state.phase = "win"; showOverlay("win");
      },
    },
  };
  function startScene(id) {
    state.scene = { id, pages: SCENES[id].pages, page: 0 };
    state.phase = "scene";
  }
  function advanceScene() {
    const sc = state.scene;
    sc.page++;
    if (sc.page < sc.pages.length) return;
    const def = SCENES[sc.id];
    state.scene = null; state.phase = "playing";
    def.end();
  }

  /* ================= interact ================= */
  function nearestNpc() {
    let best = null, bd = 26;
    for (const n of npcs) { const d = VG.dist(player.x, player.y, n.px, n.py); if (d < bd) { bd = d; best = n; } }
    return best;
  }
  function nearBoard() {
    const gx = Math.floor(player.x / T), gy = Math.floor(player.y / T);
    for (let yy = gy - 1; yy <= gy + 1; yy++) for (let xx = gx - 1; xx <= gx + 1; xx++) if (state.room.matAt(xx, yy) === VG.MAT.BOARD) return true;
    return false;
  }
  function nearVillageBell() {
    const gx = Math.floor(player.x / T), gy = Math.floor(player.y / T);
    for (let yy = gy - 1; yy <= gy + 1; yy++) for (let xx = gx - 1; xx <= gx + 1; xx++) if (state.room.matAt(xx, yy) === VG.MAT.BELL) return true;
    return false;
  }
  function tryInteract() {
    // the evensong bell is the explicit goal at the finale, and it shares the
    // plaza with Maren — let ringing it win over talking when that quest is up.
    if (state.roomId === "village" && nearVillageBell() && state.quests.q_evensong === "active") { startScene("evensong"); return; }
    const npc = nearestNpc();
    if (npc) { talkTo(npc); return; }
    if (state.roomId === "village" && nearVillageBell()) {
      if (state.flags.bellRestored) { VG.sfxBell(130, 0.14); toast("the bell answers softly", player.x, player.y - 18, "#ffcf6b"); return; }
      toast("the bell is silent", player.x, player.y - 18, "#8a9ac0");
      return;
    }
    if (nearBoard()) {
      state.dialog = {
        npc: { name: "Quest Board", title: "village requests" },
        pages: state.quests.q_wolves === "locked"
          ? ["“WOLVES. Orchard. Four of them. Reward from the village purse. — O.”"]
          : ["Nothing new is pinned today."],
        page: 0,
        actions: state.quests.q_wolves === "locked" ? { accept: "q_wolves" } : null,
      };
      state.phase = "dialog";
    }
  }

  /* ================= shop / inventory ================= */
  function buyItem(item) {
    const bought = state.shopBought[item.id] || 0;
    if (item.max && bought >= item.max) { toast("sold out", player.x, player.y - 16, "#8a9ac0"); return; }
    if (item.relic && player.relics[item.relic]) { toast("already owned", player.x, player.y - 16, "#8a9ac0"); return; }
    if (player.embers < item.cost) { VG.sfx(200, 0.06, "square", 0.03); toast("not enough embers", player.x, player.y - 16, "#ff8095"); return; }
    player.embers -= item.cost;
    state.shopBought[item.id] = bought + 1;
    if (item.id === "heart") { player.maxHp++; player.hp = player.maxHp; }
    if (item.relic) { player.relics[item.relic] = true; banner("RELIC — " + D.RELICS[item.relic].name); toast("Owning it isn't enough — open TAB and equip it (max 2)", player.x, player.y - 28, "#c9d6e8"); }
    VG.sfx(660, 0.1, "triangle", 0.05);
    saveGame();
  }
  function toggleEquip(id) {
    const i = player.equipped.indexOf(id);
    if (i >= 0) player.equipped.splice(i, 1);
    else { if (player.equipped.length >= 2) player.equipped.shift(); player.equipped.push(id); }
    VG.sfx(480, 0.05, "triangle", 0.04);
    saveGame();
  }

  /* ================= save ================= */
  function saveGame() {
    VG.save.write({
      roomId: ["hollowboss", "ossuaryboss"].includes(state.roomId) ? "village" : state.roomId,
      hp: player.hp, maxHp: player.maxHp,
      embers: player.embers, vesperSouls: player.vesperSouls, relics: player.relics, equipped: player.equipped,
      materials: player.materials, quests: state.quests, flags: state.flags,
      shopBought: state.shopBought, score: state.score, kills: state.kills,
      bestCombo: state.bestCombo, dawn: state.dawn, dawnTransition: state.dawnTransition,
      vesperHearts: state.vesperHearts, soulTiers: state.soulTiers,
      bonusMeleeDmg: player.bonusMeleeDmg, bonusStrikeCdMul: player.bonusStrikeCdMul,
      bonusBeamDmg: player.bonusBeamDmg, bonusReach: player.bonusReach, bonusMagnetMul: player.bonusMagnetMul,
      cosmetics: player.cosmetics,
    });
  }
  function restoreSave(s) {
    player.hp = s.hp ?? 4; player.maxHp = s.maxHp ?? 4;
    player.embers = s.embers ?? 0; player.vesperSouls = s.vesperSouls ?? 0;
    player.relics = s.relics || {}; player.equipped = s.equipped || [];
    player.materials = s.materials || { wolfshard: 0, glassshard: 0 };
    state.quests = Object.assign(state.quests, s.quests || {});
    state.flags = s.flags || {};
    if (!state.flags.cosmeticOrder) state.flags.cosmeticOrder = shuffledCosmeticOrder();
    state.shopBought = s.shopBought || {};
    state.score = s.score || 0; state.kills = s.kills || 0;
    state.bestCombo = s.bestCombo || 0;
    state.dawn = s.dawn || 0; state.dawnTransition = !!s.dawnTransition;
    state.vesperHearts = s.vesperHearts || 0; state.soulTiers = s.soulTiers || {};
    player.bonusMeleeDmg = s.bonusMeleeDmg || 0; player.bonusStrikeCdMul = s.bonusStrikeCdMul ?? 1;
    player.bonusBeamDmg = s.bonusBeamDmg || 0; player.bonusReach = s.bonusReach || 0; player.bonusMagnetMul = s.bonusMagnetMul ?? 1;
    player.cosmetics = s.cosmetics || { owned: [], equipped: { cloak: null, glow: null, accessory: null, trail: null } };
  }

  /* ================= room loading ================= */
  function loadRoom(id, spawn) {
    const def = VG.ROOMS[id];
    state.room = new VG.Room(def);
    state.roomId = id;
    VG.dread.onRoomEnter(id, (VG.BIOMES[def.biome] || {}).warm !== false);
    wrongVisitRoomId = (VG.dread.consumeBacktrack() && Math.random() < 0.45) ? id : null;
    VG.camera.setRoom(state.room.pxW, state.room.pxH);
    shots = []; bolts = []; rings = []; particles = []; floatText = [];
    enemies = (def.enemies || [])
      .filter((e) => !(e.tag === "q_wolves" && state.quests.q_wolves === "done"))
      .filter((e) => !(e.tag === "choir" && state.flags.glassDone))
      .map(makeEnemy);
    pickups = (def.pickups || [])
      .filter((p) => !(p.type === "quest" && (state.flags[p.id] || state.quests.q_lantern === "done")))
      .filter((p) => !state.flags["got_" + id + "_" + p.x + "_" + p.y] || p.type === "quest")
      .map((p) => ({ x: p.x * T + 8, y: p.y * T + 8, type: p.type, id: p.id, slot: p.slot, defKey: "got_" + id + "_" + p.x + "_" + p.y, bob: Math.random() * 6 }));
    boss = def.boss && !(def.boss.type === "bellmother" && state.flags.bellRestored) ? makeBoss(def.boss) : null;
    loadNpcs(def);
    portals.reset();
    const sp = spawn || def.spawn;
    player.x = sp.x * T + 8; player.y = sp.y * T + 8;
    player.vx = 0; player.vy = 0; player.dead = false;
    VG.camera.snapTo(player.x, player.y);
    state.roomFade = 1;
    if (wrongVisitRoomId === id) {
      spawnParticles(player.x, player.y - 6, "#c9d6e8", 5, 20);
      VG.sfxBell(83, 0.05);
    }
    VG.setMusicState(boss ? "boss" : def.biome === "village" || def.biome === "interior" ? "shrine" : "explore");
    banner(def.name.toUpperCase());
    setHint(def.hint || "");
    saveGame();
  }
  function setHint(text) { const h = $("[data-vg-hint]"); if (h) { h.textContent = text; h.hidden = !text; } }
  function checkExits() {
    const def = VG.ROOMS[state.roomId];
    for (const ex of (def.exits || [])) {
      const ex0 = ex.gx * T, ey0 = ex.gy * T;
      if (player.x > ex0 - 5 && player.x < ex0 + T + 5 && player.y > ey0 - 5 && player.y < ey0 + T + 5) {
        if (ex.needBells && bellsRung(state.roomId) < ex.needBells && !state.flags.bellRestored) {
          toast(`${bellsRung(state.roomId)} / ${ex.needBells} bells — the door holds`, player.x, player.y - 18, "#ffcf6b");
          player.x -= Math.sign(player.x - state.room.pxW / 2) * -4;
          player.y += 6;
          return;
        }
        if (ex.needSigil && !state.flags["sigil_" + state.roomId]) {
          toast("the sigil is dark — bank a shot into it", player.x, player.y - 18, "#c9d6e8");
          player.y += 6;
          return;
        }
        loadRoom(ex.to, ex.toSpawn);
        return;
      }
    }
  }

  /* ================= simulate ================= */
  function simulate(dt) {
    state.t += dt;
    VG.fx.tick(dt);
    updateAim();
    portals.update(dt);
    const pressed = VG.input.pressed, pad = VG.input.pad;

    /* movement */
    const left = VG.input.keys.has("KeyA") || VG.input.keys.has("ArrowLeft") || (pad && pad.lx < -0.3);
    const right = VG.input.keys.has("KeyD") || VG.input.keys.has("ArrowRight") || (pad && pad.lx > 0.3);
    const up = VG.input.keys.has("KeyW") || VG.input.keys.has("ArrowUp") || (pad && pad.ly < -0.3);
    const down = VG.input.keys.has("KeyS") || VG.input.keys.has("ArrowDown") || (pad && pad.ly > 0.3);
    let mx = (right ? 1 : 0) - (left ? 1 : 0), my = (down ? 1 : 0) - (up ? 1 : 0);
    const mlen = Math.hypot(mx, my) || 1; mx /= mlen; my /= mlen;
    if (mx || my) { player.fx = mx; player.fy = my; }
    const roomWarm = (VG.BIOMES[state.room.biome] || {}).warm !== false;
    const stillNow = !mx && !my && player.rollT <= 0;
    VG.dread.tick(dt, { warm: roomWarm, still: stillNow });
    // "don't look back": lingering somewhere, then walking away, can trail
    // a footstep/breath cue a beat later — audio only, nothing is ever
    // actually there when you turn around. Never in warm/home biomes.
    if (stillNow) { if (!wasStill) stillSince = state.t; wasStill = true; }
    else {
      if (wasStill && !roomWarm && state.t - stillSince > 2.2 && VG.dread.tier() >= 1 && Math.random() < 0.35) {
        setTimeout(() => { if (state.phase === "playing" && VG.sfxDreadStep) VG.sfxDreadStep(); }, 380 + Math.random() * 220);
      }
      wasStill = false;
    }

    player.rollCd = Math.max(0, player.rollCd - dt);
    if ((pressed.has("ShiftLeft") || pressed.has("ShiftRight") || pressed.has("PadB")) && player.rollCd <= 0 && (mx || my)) {
      player.rollT = 0.26; player.rollCd = 0.55; player.rollDir = { x: mx, y: my };
      VG.sfx(300, 0.06, "sine", 0.04);
      spawnParticles(player.x, player.y, "#c9c2ff", 4, 40);
    }
    const speed = 92 * (relicOn("swiftsoles") ? 1.12 : 1);
    if (player.rollT > 0) {
      player.rollT -= dt;
      player.vx = player.rollDir.x * 195; player.vy = player.rollDir.y * 195;
    } else {
      player.vx = mx * speed + player.kx; player.vy = my * speed + player.ky;
    }
    player.kx *= 0.85; player.ky *= 0.85;
    // teleport BEFORE collision so inward velocity survives (the order bug fix)
    const tp = portals.tryTeleport(player, "player", { strain: 0.05 });
    if (tp === "critical") doCollapse();
    else if (tp) VG.camera.jolt(0.1);
    moveBody(player, dt);
    if (state.room.spikeAtPx(player.x, player.y) && player.iframe <= 0) hurtPlayer(1, 0, 0);
    if (state.room.tallGrassAtPx(player.x, player.y) && (mx || my) && Math.random() < dt * 6) {
      particles.push({ x: player.x + (Math.random() - 0.5) * 8, y: player.y + 4, vx: (Math.random() - 0.5) * 30, vy: -20, life: 0.4, max: 0.4, color: "#6aa050" });
    }
    // roll afterimage: a handful of fading ghost silhouettes trailing the dash,
    // sampled at a fixed cadence (not every frame) so they read as discrete
    // frames rather than a smear.
    if (player.rollT > 0) {
      player._stepT -= dt;
      if (player._stepT <= 0) {
        player._stepT = 0.03;
        player._trail.push({ x: player.x, y: player.y, fx: player.fx, fy: player.fy, life: 0.22, max: 0.22 });
        if (player._trail.length > 6) player._trail.shift();
      }
    } else if (mx || my) {
      // footstep dust: only on floor-ish ground, gated like the tall-grass rustle above
      player._stepT -= dt;
      if (player._stepT <= 0 && Math.random() < 0.6) {
        player._stepT = 0.16;
        particles.push({ x: player.x - player.fx * 3 + (Math.random() - 0.5) * 3, y: player.y + 4, vx: (Math.random() - 0.5) * 10, vy: -6, life: 0.3, max: 0.3, color: "rgba(180,170,200,0.4)" });
      }
    } else {
      player._stepT = 0;
    }

    /* actions */
    if (pressed.has("M1") || pressed.has("PadX")) strike();
    if (pressed.has("KeyF") || (pad && pad.fire && !player._fireHeld)) fireBolt();
    player._fireHeld = pad && pad.fire;
    if (pressed.has("M2") || (pad && pad.gate && !player._gateHeld)) { updateGatePreview(); placeGate(); }
    player._gateHeld = pad && pad.gate;
    if (pressed.has("KeyQ") || pressed.has("PadLB")) portals.selected = 1 - portals.selected;
    if (pressed.has("KeyR") || pressed.has("PadY")) portals.vent();
    if (pressed.has("KeyE") || pressed.has("PadA")) tryInteract();
    if (pressed.has("Tab") || pressed.has("KeyI") || pressed.has("PadBack")) { state.phase = "inventory"; }

    player.strikeCd = Math.max(0, player.strikeCd - dt);
    player.strikeT = Math.max(0, player.strikeT - dt);
    player.boltCd = Math.max(0, player.boltCd - dt);
    player.iframe = Math.max(0, player.iframe - dt);

    updateGatePreview();

    /* player shots */
    for (const sh of shots) {
      sh.life -= dt;
      const px = sh.x, py = sh.y;
      sh.x += sh.vx * dt; sh.y += sh.vy * dt;
      const tpz = portals.tryTeleport(sh, sh.key, { strain: 0.03 });
      if (tpz) { sh.foldshot = true; sh.dmg *= 1.25; sh.pierce += 1; spawnParticles(sh.x, sh.y, "#8fe9ff", 3); }
      if (solidShot(sh.x, sh.y)) {
        if (state.room.reflectAtPx(sh.x, sh.y) && (sh._bounces || 0) < 3) {
          sh._bounces++;
          sh.x = px; sh.y = py;
          if (Math.abs(sh.vx) >= Math.abs(sh.vy)) sh.vx = -sh.vx; else sh.vy = -sh.vy;
          sh.foldshot = true;
          if (relicOn("mirrorlitany")) { sh.dmg *= 1.4; sh.pierce += 1; }
          spawnParticles(sh.x, sh.y, "#c9d6e8", 4); VG.sfx(620, 0.04, "sine", 0.03);
        } else {
          if (state.room.matAtPx(sh.x, sh.y) === VG.MAT.BRASS) ringBell(Math.floor(sh.x / T) * T + 8, Math.floor(sh.y / T) * T + 8);
          sh.life = 0; spawnParticles(sh.x, sh.y, "#ffcf6b", 3);
        }
      }
      // ossuary sigil: only banked/folded shots mark it
      const def = VG.ROOMS[state.roomId];
      if (def.sigil && (sh._bounces > 0 || sh.foldshot) && !state.flags["sigil_" + state.roomId]) {
        if (VG.dist(sh.x, sh.y, def.sigil.gx * T + 8, def.sigil.gy * T + 8) < 16) {
          state.flags["sigil_" + state.roomId] = true;
          banner("THE SIGIL ANSWERS");
          VG.sfxBell(260, 0.18); spawnParticles(sh.x, sh.y, "#8fe9ff", 14, 90);
          saveGame();
        }
      }
      for (const e of enemies) {
        if (e.dead) continue;
        if (VG.dist(sh.x, sh.y, e.x, e.y) < e.r + sh.r) {
          const dot = Math.cos(e.facing) * sh.vx + Math.sin(e.facing) * sh.vy;
          damageEnemy(e, sh.dmg, dot > 0 || sh.foldshot);
          if (sh.pierce <= 0) sh.life = 0; else sh.pierce--;
          break;
        }
      }
      if (boss && !boss.dead && VG.dist(sh.x, sh.y, boss.x, boss.y) < boss.r + sh.r) {
        damageBoss(sh.dmg * (sh.foldshot ? 1.5 : 1)); sh.life = 0;
      }
    }
    shots = shots.filter((s) => s.life > 0);

    /* enemy bolts */
    for (const b of bolts) {
      b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt;
      const tpb = portals.tryTeleport(b, b.key, { strain: 0.02 });
      if (tpb) { b.hostileToEnemies = true; b.color = "#8fe9ff"; }
      if (solidShot(b.x, b.y)) { b.life = 0; continue; }
      if (b.hostileToEnemies) {
        for (const e of enemies) { if (!e.dead && VG.dist(b.x, b.y, e.x, e.y) < e.r + b.r) { damageEnemy(e, b.dmg * 6, true); if (b._pierce > 0) b._pierce--; else b.life = 0; break; } }
        if (boss && !boss.dead && VG.dist(b.x, b.y, boss.x, boss.y) < boss.r) { damageBoss(b.dmg * 8); if (b._pierce > 0) b._pierce--; else b.life = 0; }
      } else if (VG.dist(b.x, b.y, player.x, player.y) < player.r + b.r) { hurtPlayer(b.dmg, Math.sign(b.vx) * 0.4, Math.sign(b.vy) * 0.4); b.life = 0; }
    }
    bolts = bolts.filter((b) => b.life > 0);

    /* rings */
    for (const rg of rings) {
      rg.life -= dt; rg.r += rg.vr * dt;
      const pd = VG.dist(rg.x, rg.y, player.x, player.y);
      if (rg.hostile && Math.abs(pd - rg.r) < 6 && player.iframe <= 0) hurtPlayer(rg.dmg, Math.sign(player.x - rg.x) * 0.5, Math.sign(player.y - rg.y) * 0.5);
      if (!rg.hostile) {
        for (const e of enemies) { if (!e.dead && Math.abs(VG.dist(rg.x, rg.y, e.x, e.y) - rg.r) < 8) damageEnemy(e, rg.dmg, true); }
        if (boss && !boss.dead && Math.abs(VG.dist(rg.x, rg.y, boss.x, boss.y) - rg.r) < 10) damageBoss(rg.dmg * 2);
      }
    }
    rings = rings.filter((r) => r.life > 0 && r.r < 420);

    /* enemies / boss */
    for (const e of enemies) stepEnemy(e, dt);
    if (boss) stepBoss(boss, dt);
    enemies = enemies.filter((e) => !e.dead || e.hurt > 0);

    /* pickups (embers/souls magnet to player) */
    for (const p of pickups) {
      p.bob += dt;
      if (p.type === "ember" || p.type === "soul") {
        p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
        p.vx = (p.vx || 0) * 0.9; p.vy = (p.vy || 0) * 0.9;
        const magnetR = 30 * player.bonusMagnetMul;
        const d = VG.dist(p.x, p.y, player.x, player.y);
        if (d < magnetR) { p.x += (player.x - p.x) * dt * 8; p.y += (player.y - p.y) * dt * 8; }
        if (d < 10) {
          p.dead = true;
          if (p.type === "ember") { player.embers += p.value; VG.sfx(760, 0.04, "triangle", 0.03); }
          else {
            player.vesperSouls += Math.round(p.value * (relicOn("embercharm") ? 1.25 : 1));
            VG.sfx(820, 0.04, "sine", 0.03);
            checkSoulTiers();
          }
        }
        continue;
      }
      if (VG.dist(p.x, p.y, player.x, player.y) < 14) {
        if (p.type === "pulse") { player.maxHp += 1; player.hp = player.maxHp; banner("HEART VESSEL"); }
        else if (p.type === "quest") { state.flags[p.id] = true; banner(p.id === "lantern" ? "PIP'S LANTERN — return it" : p.id.toUpperCase()); }
        else if (p.type === "cosmetic") {
          const cosId = state.flags.cosmeticOrder && state.flags.cosmeticOrder[p.slot];
          const item = cosId && D.COSMETICS.find((c) => c.id === cosId);
          if (item && !player.cosmetics.owned.includes(cosId)) {
            player.cosmetics.owned.push(cosId);
            banner("FOUND — " + item.name);
          }
        }
        if (p.defKey && p.type !== "quest") state.flags[p.defKey] = true;
        p.dead = true; VG.sfx(660, 0.1, "triangle", 0.05); spawnParticles(p.x, p.y, "#fff", 8);
        saveGame();
      }
    }
    pickups = pickups.filter((p) => !p.dead);

    /* particles / text */
    for (const pt of particles) { pt.life -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const tr of player._trail) tr.life -= dt;
    player._trail = player._trail.filter((tr) => tr.life > 0);
    for (const f of floatText) { f.life -= dt; f.y -= 14 * dt; }
    floatText = floatText.filter((f) => f.life > 0);
    if (state.banner) { state.banner.t -= dt; if (state.banner.t <= 0) state.banner = null; }

    checkExits();
    const inCombat = enemies.some((e) => !e.dead && VG.dist(e.x, e.y, player.x, player.y) < 140);
    const def2 = VG.ROOMS[state.roomId];
    VG.setMusicState(boss && !boss.dead ? "boss" : inCombat ? "combat" : (def2.biome === "village" || def2.biome === "interior") ? "shrine" : "explore");
    const look = VG.camera.screenToWorld(VG.input.mx, VG.input.my);
    VG.camera.follow(player.x, player.y, look.x, look.y, dt);
    if (portals.strain >= 1) doCollapse();
  }
  function doCollapse() {
    rings.push({ x: portals.dawn.x, y: portals.dawn.y, r: 8, vr: 200, dmg: 2, life: 1, hostile: false });
    for (const e of enemies) if (!e.dead && VG.dist(portals.dawn.x, portals.dawn.y, e.x, e.y) < 60) damageEnemy(e, 12, true);
    if (VG.dist(portals.dawn.x, portals.dawn.y, player.x, player.y) < 40) hurtPlayer(1, 0, 0);
    portals.collapse();
    VG.camera.jolt(0.5);
    toast("GATE COLLAPSE", player.x, player.y - 22, "#ff8095");
  }

  /* ================= rendering ================= */
  function drawTitleBackdrop() {
    const sky = ctx.createLinearGradient(0, 0, 0, VG.H);
    sky.addColorStop(0, "#17112a"); sky.addColorStop(0.58, "#080716"); sky.addColorStop(1, "#030208");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, VG.W, VG.H);

    // The title screen is a live glimpse of Duskhollow, built from the same
    // light, bell, and linked-gate language as the playable world.
    ctx.fillStyle = "rgba(197,214,255,0.08)";
    ctx.beginPath(); ctx.arc(500, 78, 52, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,238,210,0.12)";
    ctx.beginPath(); ctx.arc(500, 78, 37, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "#070711";
    ctx.fillRect(0, 272, VG.W, 88);
    for (let i = 0; i < 13; i++) {
      const x = 286 + i * 31, h = 25 + ((i * 17) % 54);
      ctx.fillRect(x, 272 - h, 23, h);
      ctx.beginPath(); ctx.moveTo(x - 4, 272 - h); ctx.lineTo(x + 11, 250 - h); ctx.lineTo(x + 27, 272 - h); ctx.fill();
    }
    ctx.fillRect(468, 128, 38, 144);
    ctx.beginPath(); ctx.moveTo(462, 128); ctx.lineTo(487, 84); ctx.lineTo(512, 128); ctx.fill();
    ctx.fillStyle = "rgba(255,207,107,0.22)"; ctx.fillRect(483, 143, 8, 13);

    const pulse = 0.72 + Math.sin(state.t * 1.8) * 0.18;
    const gates = [
      { x: 424, y: 244, color: `rgba(143,233,255,${pulse})`, lean: -0.18 },
      { x: 553, y: 234, color: `rgba(255,154,208,${pulse * 0.92})`, lean: 0.2 },
    ];
    for (const gate of gates) {
      ctx.save(); ctx.translate(gate.x, gate.y); ctx.rotate(gate.lean);
      ctx.shadowColor = gate.color; ctx.shadowBlur = 18;
      ctx.strokeStyle = gate.color; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 34, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.3; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(0, 0, 5, 29, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#b8c9ef";
    for (let i = 0; i < 4; i++) {
      const x = ((state.t * (7 + i) + i * 180) % 820) - 90;
      ctx.beginPath(); ctx.ellipse(x, 250 + i * 23, 120, 12 + i * 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function shadow(x, y, w2) {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath(); ctx.ellipse(x, y + 5, w2, w2 * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }
  /* rim-light: everything in this game is flat canvas primitives, no sprites —
     a soft colored shadowBlur around a silhouette is what stands in for
     cel-shaded rim lighting. Cheap, and reads at this pixel scale where
     actual normal-mapped lighting wouldn't. */
  function glow(color, blur, fn) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = blur;
    fn();
    ctx.restore();
  }
  /* the ossuary's mirror-bone banks shots — and, up close, throws back a
     silhouette that doesn't quite keep time with you. Presence system:
     desync gets more frequent as dread rises, and water surfaces join in
     (rare, since water reflecting anything at all is itself the wrongness). */
  function drawGhostAt(m, opts = {}) {
    const dx = m.x - player.x, dy = m.y - player.y;
    const tier = VG.dread.tier();
    const desyncMod = tier >= 3 ? 2 : tier === 2 ? 3 : 5;
    const desync = Math.floor(state.t * 0.7 + m.x * 0.13) % desyncMod === 0;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.scale(-1, 1);
    ctx.translate(-dx * 0.15, -dy * 0.15 - 2);
    ctx.globalAlpha = (opts.alpha ?? 0.32) + Math.sin(state.t * 2 + m.x) * 0.06;
    ctx.rotate(desync ? -Math.atan2(player.fy, player.fx) : Math.atan2(player.fy, player.fx));
    ctx.fillStyle = "#1c1830";
    ctx.beginPath(); ctx.ellipse(0, 0, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = desync ? "rgba(255,120,140,0.55)" : "rgba(143,233,255,0.35)";
    ctx.beginPath(); ctx.arc(3, 0, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawMirrorGhosts() {
    for (const m of state.room.mirrorTilesNear(player.x, player.y, 90)) drawGhostAt(m);
    // water only joins in while dread is still elevated (e.g. carried in
    // from a dungeon) — normal calm water never reflects a ghost.
    if (VG.dread.tier() >= 2 && (state.room.biome === "vale" || state.room.biome === "lake")) {
      const wet = state.room.mirrorTilesNear(player.x, player.y, 50, [VG.MAT.WATER]);
      if (wet.length && Math.random() < 0.01) drawGhostAt(wet[Math.floor(Math.random() * wet.length)], { alpha: 0.16 });
    }
  }
  /* ---------------- Living Darkness: mood + per-frame light gather ---------------- */
  function moodColorAlpha() {
    if (state.roomId === "hollowboss") {
      const heat = boss ? (boss.phase - 1) / 2 : 0;
      return [10 + heat * 40, 6 + heat * 4, 10 + heat * 6, 0.84];
    }
    // Presence system: a slow cold/violet drift and a heavier mask as dread
    // rises — only in the two "explore" dark rooms, so it never competes
    // with the boss rooms' own phase-driven heat tint.
    const dv = state.roomId === "hollow1" || state.roomId === "ossuary1" ? VG.dread.value() : 0;
    if (state.roomId === "ossuary1") return [8 - dv * 4, 16 - dv * 10, 10 + dv * 8, 0.86 + dv * 0.06];
    if (state.roomId === "ossuaryboss") return [10, 10, 26, 0.87];
    return [6 + dv * 6, 6 - dv * 3, 12 + dv * 6, 0.8 + dv * 0.08];
  }
  function applyLighting() {
    const biome = state.room && state.room.biome;
    VG.fx.seedAtmosphere(VG.camera, biome);
    if (!VG.fx.DARK_BIOMES.has(biome)) return;
    const intensity = VG.settings.lighting ?? 1;
    if (intensity <= 0.02) return;
    VG.fx.pushLight(player.x, player.y, 46, { seed: 1 });
    for (const l of state.room.collectLights(VG.camera)) VG.fx.pushLight(l.x, l.y, l.r, { seed: l.seed });
    if (boss && !boss.dead) {
      VG.fx.pushLight(boss.x, boss.y, 60 + boss.phase * 8, { seed: 99, boost: 1.1 });
    }
    for (const e of enemies) if (!e.dead && e.tag === "choir" && e.enrage > 0) VG.fx.pushLight(e.x, e.y, 20 + e.enrage * 4, { seed: e.homeX });
    for (let i = 0; i < 2; i++) { const g = portals.gates[i]; if (g.active) VG.fx.pushLight(g.x, g.y, 26, { seed: 500 + i, flicker: false }); }
    const [r, g, b, a] = moodColorAlpha();
    VG.fx.renderDarkness(ctx, VG.camera, `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${(a * intensity).toFixed(3)})`);
    // Presence system: a subliminal glimpse, tier 3 only, rare — gone almost
    // as soon as it registers. Never the boss rooms; that's their own beat.
    if (!boss && VG.dread.tier() >= 3 && Math.random() < 0.0025) {
      const onX = Math.random() < 0.5;
      const ex = onX ? Math.random() * VG.W : (Math.random() < 0.5 ? -4 : VG.W + 4);
      const ey = onX ? (Math.random() < 0.5 ? -4 : VG.H + 4) : Math.random() * VG.H;
      const w = VG.camera.screenToWorld(ex, ey);
      VG.fx.spawnGlimpse(w.x, w.y);
    }
    VG.fx.drawGlimpses(ctx, VG.camera);
  }
  /* Night → day arc: the dungeons already have their own Living Darkness
     mood system (above); this is the *overworld's* time-of-day, layered on
     top of the biome's existing dusk wash (world.js drawLight). Starts at
     full night, only lifts once the evensong ending fires (see SCENES.evensong). */
  function applyNightVeil() {
    const biome = state.room && state.room.biome;
    if (VG.fx.DARK_BIOMES.has(biome)) return;
    const dawn = state.dawn || 0;
    if (dawn >= 1) return;
    const night = (1 - dawn) * 0.5;
    const r = Math.round(8 + dawn * 60), g = Math.round(10 + dawn * 44), b = Math.round(26 + dawn * 30);
    ctx.fillStyle = `rgba(${r},${g},${b},${night.toFixed(3)})`;
    ctx.fillRect(VG.camera.x, VG.camera.y, VG.W, VG.H);
  }
  function drawScene() {
    const flags = roomFlags();
    state.room.draw(ctx, VG.camera, state.t, flags);
    // ossuary sigil marker
    const def = VG.ROOMS[state.roomId];
    if (def.sigil) {
      const sx = def.sigil.gx * T + 8, sy = def.sigil.gy * T + 8;
      const lit = state.flags["sigil_" + state.roomId];
      ctx.strokeStyle = lit ? "#8fe9ff" : `rgba(201,214,232,${0.4 + Math.sin(state.t * 3) * 0.2})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 4, sy); ctx.lineTo(sx + 4, sy); ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 4); ctx.stroke();
      if (lit) { ctx.fillStyle = "rgba(143,233,255,0.3)"; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill(); }
    }
    // pickups
    for (const p of pickups) {
      const yy = p.y + Math.sin(p.bob * 2) * 2;
      if (p.type === "ember") {
        ctx.fillStyle = "#ffcf6b"; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
        ctx.fillStyle = "rgba(255,220,140,0.5)"; ctx.fillRect(p.x - 0.5, p.y - 3, 1, 6);
      } else if (p.type === "soul") {
        glow("rgba(156,143,255,0.6)", 3, () => {
          ctx.fillStyle = "#9c8fff"; ctx.beginPath(); ctx.arc(p.x, yy, 2, 0, Math.PI * 2); ctx.fill();
        });
      } else if (p.type === "quest") {
        shadow(p.x, p.y, 5);
        ctx.fillStyle = "#3a2c1a"; ctx.fillRect(p.x - 3, yy - 6, 6, 9);
        ctx.fillStyle = `rgba(255,200,110,${0.7 + Math.sin(state.t * 4) * 0.3})`; ctx.fillRect(p.x - 2, yy - 5, 4, 6);
      } else if (p.type === "cosmetic") {
        const spin = state.t * 2 + p.x;
        glow("rgba(255,244,216,0.7)", 5, () => {
          ctx.save(); ctx.translate(p.x, yy); ctx.rotate(spin);
          ctx.fillStyle = "#fff4d8";
          ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(2, 0); ctx.lineTo(0, 5); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill();
          ctx.restore();
        });
      } else {
        shadow(p.x, p.y, 4);
        ctx.fillStyle = "#ff9ad0";
        ctx.beginPath(); ctx.arc(p.x, yy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(p.x - 1, yy - 6, 2, 12);
      }
    }
    /* actors, painter-sorted by y */
    const actors = [];
    for (const n of npcs) actors.push({ y: n.py, draw: () => drawNpc(n) });
    for (const e of enemies) if (!e.dead) actors.push({ y: e.y, draw: () => drawEnemy(e) });
    if (boss && !boss.dead) actors.push({ y: boss.y, draw: () => drawBoss(boss) });
    actors.push({ y: player.y, draw: drawPlayer });
    actors.sort((a, b) => a.y - b.y);
    for (const a of actors) a.draw();
    drawMirrorGhosts();
    VG.fx.drawShockwaves(ctx);
    // rings
    for (const rg of rings) {
      ctx.strokeStyle = rg.hostile ? `rgba(255,120,90,${Math.min(0.6, rg.life)})` : `rgba(143,233,255,${Math.min(0.6, rg.life)})`;
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2); ctx.stroke();
    }
    // bolts + shots
    for (const b of bolts) { ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }
    for (const sh of shots) {
      ctx.fillStyle = sh.foldshot ? "#8fe9ff" : "#ffcf6b";
      ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2); ctx.fill();
    }
    drawGates();
    for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.fillRect(p.x - 1, p.y - 1, 2, 2); ctx.globalAlpha = 1; }
    VG.fx.drawAtmosphere(ctx, VG.camera);
    // dusk light pass
    state.room.drawLight(ctx, VG.camera, state.t, flags);
    applyNightVeil();
    // drifting cloud shadows over the open world
    if (["village", "vale", "lake"].includes(def.biome)) {
      ctx.fillStyle = "rgba(8,6,20,0.10)";
      for (let i = 0; i < 3; i++) {
        const cx = ((state.t * 6 + i * 300) % (state.room.pxW + 300)) - 150;
        const cy = 60 + i * 120 + Math.sin(state.t * 0.1 + i) * 30;
        ctx.beginPath(); ctx.ellipse(cx, cy, 90, 40, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const f of floatText) {
      ctx.globalAlpha = Math.min(1, f.life); ctx.fillStyle = f.color;
      ctx.font = "6px monospace"; ctx.textAlign = "center"; ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1; ctx.textAlign = "left";
    }
    // interact prompt
    const npc = state.phase === "playing" ? nearestNpc() : null;
    if (npc) {
      ctx.font = "6px monospace"; ctx.textAlign = "center";
      ctx.fillStyle = "rgba(6,5,16,0.8)"; ctx.fillRect(npc.px - 30, npc.py - 26, 60, 9);
      ctx.fillStyle = "#8fe9ff"; ctx.fillText("E — talk to " + npc.name, npc.px, npc.py - 19);
      ctx.textAlign = "left";
    }
  }

  // permanent, subtle cool-dark vignette + grade — the constant "dark
  // fairytale" frame that sits under every other screen effect. Cheap
  // (two radial fills), always on unless the player turned effects down.
  function drawAtmosphereGrade() {
    if (!state.room || VG.settings.reducedEffects) return;
    const vig = ctx.createRadialGradient(VG.W / 2, VG.H / 2, VG.H * 0.35, VG.W / 2, VG.H / 2, VG.H * 0.85);
    vig.addColorStop(0, "rgba(4,3,10,0)"); vig.addColorStop(1, "rgba(3,2,9,0.4)");
    ctx.fillStyle = vig; ctx.fillRect(0, 0, VG.W, VG.H);
    ctx.fillStyle = "rgba(70,60,140,0.035)";
    ctx.fillRect(0, 0, VG.W, VG.H);
  }
  function drawScreenFx() {
    drawAtmosphereGrade();
    if (player.hp <= Math.max(1, Math.floor(player.maxHp * 0.25)) && state.phase === "playing") {
      const low = 0.15 + Math.sin(state.t * 5) * 0.05;
      const vignette = ctx.createRadialGradient(VG.W / 2, VG.H / 2, 80, VG.W / 2, VG.H / 2, 340);
      vignette.addColorStop(0, "rgba(80,0,25,0)"); vignette.addColorStop(1, `rgba(130,12,45,${low})`);
      ctx.fillStyle = vignette; ctx.fillRect(0, 0, VG.W, VG.H);
    }
    if (state.damageFlash > 0) {
      ctx.fillStyle = `rgba(255,45,80,${state.damageFlash * 0.13})`;
      ctx.fillRect(0, 0, VG.W, VG.H);
    }
    if (state.roomFade > 0) {
      ctx.fillStyle = `rgba(3,2,9,${Math.min(1, state.roomFade)})`;
      ctx.fillRect(0, 0, VG.W, VG.H);
    }
  }
  function drawTrailGhost(tr) {
    ctx.save();
    ctx.globalAlpha = (tr.life / tr.max) * 0.35;
    ctx.translate(tr.x, tr.y);
    ctx.fillStyle = "#c9c2ff";
    ctx.beginPath(); ctx.ellipse(0, -1, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawPlayer() {
    const p = player;
    if (p.iframe > 0 && Math.floor(state.t * 30) % 2) return;
    for (const tr of p._trail) drawTrailGhost(tr);
    shadow(p.x, p.y, 6);
    const fa = Math.atan2(p.fy, p.fx);
    // strikeT counts down from 0.14 -> 0; strikeK is the inverse (1 at swing
    // start), driving a brief forward lunge + squash-stretch punch-through.
    const strikeK = p.strikeT > 0 ? p.strikeT / 0.14 : 0;
    const lunge = strikeK * 2.2;
    const rimColor = state.flags.hasHand && p.ash > 10
      ? (portals.selected === 0 ? "rgba(143,233,255,0.85)" : "rgba(255,154,208,0.85)")
      : "rgba(201,190,255,0.55)";
    const rimBlur = 5 + strikeK * 6 + (p.rollT > 0 ? 4 : 0);
    ctx.save(); ctx.translate(p.x + p.fx * lunge, p.y + p.fy * lunge);
    const rollSquash = p.rollT > 0 ? 0.7 : 1;
    const punchStretch = 1 + strikeK * 0.18;

    // trailing shroud tendrils, echoing the boss's shroud language at hero scale
    ctx.strokeStyle = "rgba(36,26,56,0.55)"; ctx.lineWidth = 1.4;
    for (let i = -1; i <= 1; i++) {
      const sway = Math.sin(state.t * 5 + i * 1.7) * 1.6 - p.fx * 3;
      ctx.beginPath();
      ctx.moveTo(-p.fx * 2 + i * 2, 1);
      ctx.quadraticCurveTo(-p.fx * 4 + sway + i * 2, 5, -p.fx * 6 + sway * 1.4 + i * 2, 9);
      ctx.stroke();
    }

    // cloak + body, rim-lit against the dark
    glow(rimColor, rimBlur, () => {
      ctx.fillStyle = "#241a38";
      ctx.beginPath(); ctx.ellipse(-p.fx * 2, -p.fy * 2 + 1, 6 * punchStretch, 7 * rollSquash, fa, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3a2c50";
      ctx.beginPath(); ctx.ellipse(0, -1, 4.5 * punchStretch, 5.5 * rollSquash, 0, 0, Math.PI * 2); ctx.fill();
    });

    // head + hood — chibi-scaled up against the body for readability
    glow(rimColor, rimBlur * 0.6, () => {
      ctx.fillStyle = "#1a1226"; ctx.beginPath(); ctx.arc(p.fx * 1.7, -5.5 + p.fy * 1.3, 5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = "#d8c8d8"; ctx.beginPath(); ctx.arc(p.fx * 2.7, -5.5 + p.fy * 2, 2.6, 0, Math.PI * 2); ctx.fill();

    // a bare blade sliver on the leading hand, always visible — the Hand's
    // gauntlet (below) replaces it once acquired rather than adding to it
    ctx.save(); ctx.rotate(fa);
    ctx.fillStyle = "#c9d6e8";
    ctx.beginPath(); ctx.moveTo(5, -0.6); ctx.lineTo(9 + strikeK * 3, 0); ctx.lineTo(5, 0.6); ctx.closePath(); ctx.fill();
    ctx.restore();

    // THE VESPER HAND — gauntlet on the leading arm, glowing by ash
    if (state.flags.hasHand) {
      ctx.save(); ctx.rotate(fa);
      ctx.fillStyle = "#0c0a12"; ctx.fillRect(3, -2, 7, 4);
      ctx.fillStyle = p.ash > 10 ? (portals.selected === 0 ? "#8fe9ff" : "#ff9ad0") : "#565060";
      ctx.fillRect(8, -1.5, 2.5, 3);
      ctx.restore();
    }
    // strike flourish: thicker glowing blade-sweep arcs with a bright core + soft outer bloom
    if (p.strikeT > 0) {
      glow(rimColor, 10, () => {
        ctx.strokeStyle = `rgba(255,240,200,${strikeK})`;
        ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.arc(0, 0, 15, fa - 0.9, fa + 0.9); ctx.stroke();
      });
      ctx.strokeStyle = `rgba(143,233,255,${strikeK * 0.5})`;
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 19, fa - 0.7, fa + 0.7); ctx.stroke();
    }
    ctx.restore();
  }
  /* Presence system: NPCs go stiller, jitter in short stutters instead of
     smooth motion, and their eyes drift to track the player, as dread rises. */
  function drawNpc(n) {
    shadow(n.px, n.py, n.small ? 4 : 5);
    const tier = VG.dread.tier();
    const bob = Math.sin(state.t * 2 + n.bob) * (tier >= 2 ? 0.15 : 0.8);
    let jx = 0, jy = 0;
    if (tier >= 2) {
      const stutter = Math.floor(state.t * 1.3 + n.px * 0.07);
      if (stutter % 7 === 0) { jx = ((stutter * 928371 + n.py) % 5 - 2) * 0.4; jy = ((stutter * 1299721) % 5 - 2) * 0.3; }
    }
    ctx.save(); ctx.translate(n.px + jx, n.py + bob + jy);
    const s = n.small ? 0.75 : 1;
    glow("rgba(255,224,170,0.4)", 4, () => {
      ctx.fillStyle = n.body;
      ctx.beginPath(); ctx.ellipse(0, -1, 4.5 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = n.trim; ctx.fillRect(-3 * s, -3 * s, 6 * s, 1.5);
    // chibi head: a touch bigger than the old flat circle, warm-lit like a lantern
    glow("rgba(255,224,170,0.5)", 3, () => {
      ctx.fillStyle = "#e8d8c8"; ctx.beginPath(); ctx.arc(0, -7.4 * s, 3.4 * s, 0, Math.PI * 2); ctx.fill();
    });
    let ex = 0, ey = 0;
    if (tier >= 1) {
      const dx = player.x - n.px, dy = player.y - n.py, dlen = Math.hypot(dx, dy) || 1;
      const pull = Math.min(0.7, tier * 0.25);
      ex = (dx / dlen) * pull; ey = (dy / dlen) * pull * 0.5;
    }
    ctx.fillStyle = "#241a20";
    ctx.fillRect(-1.5 * s + ex, -8 * s + ey, 1, 1.4); ctx.fillRect(0.7 * s + ex, -8 * s + ey, 1, 1.4);
    ctx.restore();
  }
  function drawEnemy(e) {
    shadow(e.x, e.y, e.r * 0.9);
    ctx.save(); ctx.translate(e.x, e.y);
    if (e.hurt > 0) ctx.globalAlpha = 0.7;
    if (e.type === "wolf") {
      const a = e.facing;
      ctx.rotate(a);
      const bob = Math.sin(state.t * 6 + e.homeX) * 0.5; // idle prowl bob
      glow("rgba(140,160,255,0.55)", 4, () => {
        ctx.fillStyle = "#3c3448"; ctx.beginPath(); ctx.ellipse(0, bob, 8, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#54486a"; ctx.beginPath(); ctx.arc(6, bob, 3.4, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = "#c9d6e8"; // shard spines
      ctx.beginPath(); ctx.moveTo(-2, bob - 3); ctx.lineTo(0, bob - 7); ctx.lineTo(2, bob - 3); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-5, bob - 2); ctx.lineTo(-3.6, bob - 5.4); ctx.lineTo(-2, bob - 2); ctx.fill();
      ctx.fillStyle = "#ff8095"; ctx.fillRect(7, bob - 1.6, 1.4, 1.2); ctx.fillRect(7, bob + 0.6, 1.4, 1.2);
    } else if (e.type === "guard") {
      glow("rgba(255,90,90,0.45)", 4, () => {
        ctx.fillStyle = "#2a2438"; ctx.beginPath(); ctx.ellipse(0, 0, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
      });
      ctx.save(); ctx.rotate(e.facing);
      ctx.fillStyle = "#5a6a8a"; ctx.fillRect(5, -6, 3, 12);   // tower shield
      ctx.restore();
      ctx.fillStyle = "#8a3a3a"; ctx.fillRect(-2, -3, 4, 2);
    } else if (e.type === "leech") {
      const bob = Math.sin(state.t * 4 + e.homeX) * 2;
      glow("rgba(255,154,208,0.65)", 5, () => {
        ctx.fillStyle = "#4a3a5a"; ctx.beginPath(); ctx.arc(0, bob, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ff9ad0"; ctx.beginPath(); ctx.arc(0, bob, 2, 0, Math.PI * 2); ctx.fill();
      });
    } else if (e.type === "mourner") {
      const sc = e.elite ? 1.4 : 1;
      glow(e.elite ? "rgba(255,120,150,0.5)" : "rgba(220,225,255,0.4)", 4, () => {
        ctx.fillStyle = e.elite ? "#c8d4ea" : "#aeb8d0";
        ctx.beginPath(); ctx.moveTo(0, -9 * sc); ctx.lineTo(6 * sc, 7 * sc); ctx.lineTo(-6 * sc, 7 * sc); ctx.closePath(); ctx.fill();
      });
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc(0, -3 * sc, 2.5 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3a4a6a"; ctx.fillRect(-2 * sc, -4 * sc, 1.5, 2); ctx.fillRect(sc, -4 * sc, 1.5, 2);
      if (e.enrage) {
        const rippleN = Math.min(3, 1 + e.enrage);
        for (let i = 0; i < rippleN; i++) {
          const rr = (10 + i * 6) * sc + Math.sin(state.t * 3 + i + e.homeX) * 1.5;
          ctx.strokeStyle = `rgba(255,120,150,${Math.max(0, 0.34 - i * 0.09) + e.enrage * 0.05})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
    if (e.type === "wolf" && e.lungeT > 0) {
      ctx.strokeStyle = `rgba(255,207,107,${Math.min(1, e.lungeT * 3)})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, 11 + (0.32 - e.lungeT) * 18, 0, Math.PI * 2); ctx.stroke();
    }
    if (e.hurt > 0) {
      ctx.globalAlpha = Math.min(1, e.hurt * 7);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, e.r + 3, 0, Math.PI * 2); ctx.stroke();
    }
    if (e.hp < e.maxHp) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(-6, -13, 12, 2);
      ctx.fillStyle = "#ff5c74"; ctx.fillRect(-6, -13, 12 * Math.max(0, e.hp / e.maxHp), 2);
    }
    ctx.restore();
  }
  function drawBoss(b) {
    shadow(b.x, b.y + 10, 20);
    ctx.save(); ctx.translate(b.x, b.y);
    if (b.hurt > 0) ctx.globalAlpha = 0.75;
    const heat = (b.phase - 1) / 2; // 0 / 0.5 / 1 across the three phases
    const bodyA = `rgb(${Math.round(48 + heat * 130)},${Math.round(40 - heat * 22)},${Math.round(30 - heat * 12)})`;
    const bodyB = `rgb(${Math.round(110 + heat * 120)},${Math.round(70 - heat * 32)},${Math.round(38 - heat * 12)})`;
    const eyeCol = `rgb(255,${Math.round(60 - heat * 40)},${Math.round(60 - heat * 40)})`;

    // tattered shroud tendrils, swaying independent of the body sweep
    ctx.strokeStyle = "rgba(18,12,10,0.6)"; ctx.lineWidth = 2.4;
    for (let i = -3; i <= 3; i++) {
      const sway = Math.sin(state.t * 1.6 + i * 1.3) * 4;
      ctx.beginPath();
      ctx.moveTo(i * 6, 14);
      ctx.quadraticCurveTo(i * 6 + sway, 24, i * 6 + sway * 1.6, 34 + Math.abs(i) * 1.5);
      ctx.stroke();
    }

    // bell-shaped body — a hooded matron cast in bronze, rim-lit with a slow
    // heartbeat pulse (synced to her tolling sweep) that intensifies with heat
    const heartbeat = 0.6 + Math.sin(b.sweep * 1.4) * 0.4;
    const rimColor = `rgba(${Math.round(255)},${Math.round(140 - heat * 60)},${Math.round(90 - heat * 40)},${0.35 + heat * 0.25})`;
    glow(rimColor, 6 + heartbeat * 5 + heat * 6, () => {
      ctx.fillStyle = bodyA;
      ctx.beginPath();
      ctx.moveTo(-20, 14);
      ctx.quadraticCurveTo(-22, -4, -8, -18);
      ctx.quadraticCurveTo(0, -24, 8, -18);
      ctx.quadraticCurveTo(22, -4, 20, 14);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = bodyB;
      ctx.beginPath(); ctx.ellipse(0, -6, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
    });

    // torn opening over the swinging clapper — her "heart"
    const swing = Math.sin(b.sweep * 1.4) * 6;
    ctx.fillStyle = "rgba(8,5,4,0.85)";
    ctx.beginPath(); ctx.ellipse(0, 4, 6, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(${Math.round(200 + heat * 55)},${Math.round(90 - heat * 40)},${Math.round(50 - heat * 20)},0.9)`;
    ctx.beginPath(); ctx.arc(swing * 0.5, 8, 2.6, 0, Math.PI * 2); ctx.fill();

    // glowing eyes, tracking the player
    const ea = Math.atan2(player.y - b.y, player.x - b.x);
    const ex = Math.cos(ea) * 2, ey = Math.sin(ea) * 2;
    ctx.fillStyle = eyeCol;
    ctx.shadowColor = eyeCol; ctx.shadowBlur = 8 + heat * 6;
    ctx.beginPath(); ctx.arc(-5 + ex, -8 + ey, 1.8, 0, Math.PI * 2); ctx.arc(5 + ex, -8 + ey, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // tolling sweep rings
    ctx.strokeStyle = `rgba(255,${Math.round(140 - heat * 60)},${Math.round(100 - heat * 40)},${0.22 + heat * 0.18})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 14 + i * 5, b.sweep + i, b.sweep + i + 2); ctx.stroke(); }
    ctx.restore();
  }
  function drawGates() {
    for (let i = 0; i < 2; i++) {
      const g = portals.gates[i];
      if (!g.active) continue;
      const half = g.half * g.open;
      const col = g.endpoint === 0 ? "#8fe9ff" : "#ff9ad0";
      ctx.save(); ctx.translate(g.x, g.y);
      ctx.shadowColor = col; ctx.shadowBlur = 11 + Math.sin(g.glyphPhase * 2) * 3;
      // mouth: soft void into the linked space
      ctx.fillStyle = g.endpoint === 0 ? "rgba(40,90,140,0.55)" : "rgba(140,60,110,0.55)";
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.abs(g.tx) * half + Math.abs(g.nx) * 4, Math.abs(g.ty) * half + Math.abs(g.ny) * 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(g.tx * half, g.ty * half); ctx.lineTo(-g.tx * half, -g.ty * half); ctx.stroke();
      ctx.shadowBlur = 0;
      for (let k = -2; k <= 2; k++) {
        const off = (k / 2) + Math.sin(g.glyphPhase + k) * 0.1;
        ctx.fillStyle = col; ctx.globalAlpha = 0.7 + Math.sin(g.glyphPhase * 2 + k) * 0.3;
        ctx.fillRect(g.tx * half * off - 0.5, g.ty * half * off - 0.5, 1.5, 1.5);
        ctx.globalAlpha = 1;
      }
      if (portals.strain > 0.5) {
        ctx.strokeStyle = `rgba(255,120,90,${(portals.strain - 0.5) * 1.4})`; ctx.lineWidth = 0.8;
        for (let k = 0; k < 4; k++) { const a = k * 1.6 + g.glyphPhase; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * half, Math.sin(a) * half); ctx.stroke(); }
      }
      ctx.restore();
    }
    if (placePreview && placePreview.valid && state.flags.hasHand && state.phase === "playing") {
      const pv = placePreview, n = VG.portalNormals[pv.dir];
      ctx.strokeStyle = portals.selected === 0 ? "rgba(143,233,255,0.5)" : "rgba(255,154,208,0.5)";
      ctx.lineWidth = 1;
      ctx.save(); ctx.translate(pv.x, pv.y); ctx.rotate(Math.atan2(n.y, n.x) + Math.PI / 2);
      ctx.strokeRect(-18, -2, 36, 4); ctx.restore();
    }
  }

  /* ================= HUD & panels ================= */
  /* Presence system: HUD panels get torn, uneven edges instead of clean
     rectangles — same footprint/readability, just not a machined box. */
  function jaggedOffset(seed, i, edge) {
    const h = ((seed + i * 928371 + edge * 1299721) >>> 0) % 100;
    return (h / 100 - 0.5) * 3;
  }
  function parchmentPanel(x, y, w, h, opts = {}) {
    const seed = opts.seed ?? Math.round(x * 7 + y * 13);
    const steps = 5;
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push([x + (w * i) / steps, y + jaggedOffset(seed, i, 0)]);
    for (let i = 0; i <= steps; i++) pts.push([x + w + jaggedOffset(seed, i, 1), y + (h * i) / steps]);
    for (let i = steps; i >= 0; i--) pts.push([x + (w * i) / steps, y + h + jaggedOffset(seed, i, 2)]);
    for (let i = steps; i >= 0; i--) pts.push([x + jaggedOffset(seed, i, 3), y + (h * i) / steps]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fillStyle = opts.fill || "rgba(5,4,13,0.72)";
    ctx.fill();
    const strokeColor = opts.stroke || "rgba(143,233,255,0.16)";
    glow(strokeColor, 3.5, () => {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = opts.lineWidth || 1;
      ctx.stroke();
    });
  }
  /* hearts render as guttering candles: a lit flame per point of health,
     a snuffed stub per point lost. Presence system: the flame gutters
     harder — shorter, jumpier — as dread rises. Same 7x9 footprint as the
     old heart icon, so HUD/inventory spacing is untouched. */
  function drawHeart(x, y, filled) {
    const gutter = filled ? VG.dread.tier() * 0.6 : 0;
    const flick = Math.sin(state.t * 9 + x) * (0.5 + gutter) + (gutter > 1 ? (Math.random() - 0.5) * gutter : 0);
    ctx.fillStyle = filled ? "#e8dcc0" : "#4a4030";
    ctx.fillRect(x + 1, y + 5, 5, 4);
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x + 1, y + 8, 5, 1);
    ctx.fillStyle = "#2a2018"; ctx.fillRect(x + 3, y + 2, 1, 3);
    if (filled) {
      const h = Math.max(1, 3 + flick);
      glow("rgba(255,180,90,0.7)", 4, () => {
        ctx.fillStyle = "rgba(255,170,80,0.35)"; ctx.beginPath(); ctx.ellipse(x + 3.5, y + 1, 3, h + 1.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffcf6b"; ctx.beginPath(); ctx.ellipse(x + 3.5, y + 1.5, 1.4, h, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff4d8"; ctx.beginPath(); ctx.ellipse(x + 3.5, y + 2, 0.6, h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      });
    } else {
      ctx.fillStyle = "rgba(150,150,160,0.4)"; ctx.beginPath(); ctx.ellipse(x + 3.5, y + 2, 0.8, 1.2, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawHUD() {
    parchmentPanel(5, 5, 96, 31, { seed: 1 });
    for (let i = 0; i < player.maxHp; i++) drawHeart(8 + i * 10, 7, i < player.hp);
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(8, 18, 70, 4);
    const ashW = 70 * (player.ash / player.maxAsh);
    ctx.fillStyle = "#ffcf6b"; ctx.fillRect(8, 18, ashW, 4);
    if (ashW > 1) {
      // a slow highlight streak sliding across the filled cinder bar
      ctx.save();
      ctx.beginPath(); ctx.rect(8, 18, ashW, 4); ctx.clip();
      const sx = 8 + ((state.t * 26) % (ashW + 14)) - 10;
      const shimmer = ctx.createLinearGradient(sx, 0, sx + 10, 0);
      shimmer.addColorStop(0, "rgba(255,255,255,0)"); shimmer.addColorStop(0.5, "rgba(255,255,255,0.55)"); shimmer.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shimmer; ctx.fillRect(8, 18, ashW, 4);
      ctx.restore();
    }
    ctx.fillStyle = "#8a9ac0"; ctx.font = "5px monospace"; ctx.fillText("CINDER", 81, 22);
    // embers
    ctx.fillStyle = "#ffcf6b"; ctx.fillRect(8, 27, 4, 4);
    ctx.fillStyle = "#eaf2ff"; ctx.font = "7px monospace"; ctx.fillText(String(player.embers), 15, 32);

    const roomName = VG.ROOMS[state.roomId]?.name || "Duskhollow";
    parchmentPanel(VG.W - 176, 5, 171, 22, { seed: 2, fill: "rgba(5,4,13,0.68)" });
    ctx.textAlign = "right";
    ctx.fillStyle = "#eaf2ff"; ctx.font = "700 7px Georgia, serif"; ctx.fillText(roomName.toUpperCase(), VG.W - 10, 14);
    ctx.fillStyle = "#8a9ac0"; ctx.font = "5px monospace";
    ctx.fillText(`${enemies.filter((e) => !e.dead).length + (boss && !boss.dead ? 1 : 0)} THREATS · ${state.score} SCORE`, VG.W - 10, 22);
    ctx.textAlign = "left";
    // gate strain (only when a gate is up)
    if (portals.gates.some((g) => g.active)) {
      const sw = 70;
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(VG.W - sw - 8, 30, sw, 5);
      const st = portals.strain;
      ctx.fillStyle = st > 0.8 ? "#ff5c74" : st > 0.5 ? "#ffcf6b" : "#8fe9ff";
      ctx.fillRect(VG.W - sw - 8, 30, sw * st, 5);
      ctx.textAlign = "right"; ctx.fillStyle = "#8a9ac0"; ctx.font = "6px monospace"; ctx.fillText("STRAIN", VG.W - 8, 43); ctx.textAlign = "left";
    }
    if (state.flags.hasHand) {
      ctx.textAlign = "right"; ctx.font = "6px monospace";
      ctx.fillStyle = portals.selected === 0 ? "#8fe9ff" : "#ff9ad0";
      ctx.fillText(portals.selected === 0 ? "NEXT GATE: DAWN" : "NEXT GATE: DUSK", VG.W - 8, portals.gates.some((g) => g.active) ? 52 : 36);
      ctx.textAlign = "left";
    }
    // quest tracker
    const tq = trackedQuest();
    if (tq && !(boss && !boss.dead)) {
      let desc = tq.desc.length > 66 ? tq.desc.slice(0, 63) + "..." : tq.desc;
      // Presence system: at max dread, a single glyph can misrender for one
      // frame — easy to miss, unsettling on the replay where you catch it.
      if (VG.dread.tier() >= 3 && Math.random() < 0.004) {
        const glyphs = "†ø§‡Ω";
        const idx = Math.floor(Math.random() * desc.length);
        desc = desc.slice(0, idx) + glyphs[Math.floor(Math.random() * glyphs.length)] + desc.slice(idx + 1);
      }
      parchmentPanel(6, VG.H - 35, 272, 29, { seed: 3, fill: "rgba(5,4,13,0.78)", stroke: "rgba(255,207,107,0.2)" });
      ctx.font = "700 6px monospace"; ctx.fillStyle = "#ffcf6b"; ctx.fillText("CURRENT QUEST  ·  " + tq.title.toUpperCase(), 12, VG.H - 23);
      ctx.font = "6px Georgia, serif"; ctx.fillStyle = "#b7c2d9"; ctx.fillText(desc, 12, VG.H - 12);
    }
    if (state.combo >= 2 && state.comboT > 0) {
      const multiplier = Math.min(4, 1 + Math.floor((state.combo - 1) / 2));
      const fade = Math.min(1, state.comboT);
      // punch-in: comboT resets to 3.25 on every fresh kill, so time-since-
      // last-kill is derived for free without any new state to track.
      const elapsed = 3.25 - state.comboT;
      const punch = 1 + Math.max(0, (0.18 - elapsed) / 0.18) * 0.4;
      ctx.globalAlpha = fade;
      ctx.save();
      ctx.translate(VG.W / 2, 18); ctx.scale(punch, punch); ctx.translate(-VG.W / 2, -18);
      parchmentPanel(VG.W / 2 - 58, 7, 116, 23, { seed: 4, fill: "rgba(5,4,13,0.68)" });
      ctx.textAlign = "center";
      ctx.fillStyle = state.combo >= 6 ? "#ffcf6b" : "#8fe9ff"; ctx.font = "700 10px Georgia, serif";
      ctx.fillText(`${state.combo} SOUL CHAIN`, VG.W / 2, 17);
      ctx.fillStyle = "#eaf2ff"; ctx.font = "6px monospace"; ctx.fillText(`SCORE ×${multiplier}`, VG.W / 2, 26);
      ctx.textAlign = "left";
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // boss bar
    if (boss && !boss.dead) {
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(60, VG.H - 14, VG.W - 120, 6);
      ctx.fillStyle = "#b8863a"; ctx.fillRect(60, VG.H - 14, (VG.W - 120) * Math.max(0, boss.hp / boss.maxHp), 6);
      ctx.textAlign = "center"; ctx.font = "6px monospace"; ctx.fillStyle = "#eaf2ff";
      ctx.fillText("BELLMOTHER, THE SAINT BENEATH THE BRONZE", VG.W / 2, VG.H - 18); ctx.textAlign = "left";
    }
    // room banner
    if (state.banner) {
      const a = Math.min(1, state.banner.t);
      ctx.globalAlpha = a;
      ctx.textAlign = "center";
      ctx.font = "700 12px Georgia, serif";
      ctx.fillStyle = "rgba(6,5,16,0.6)"; ctx.fillRect(VG.W / 2 - 110, 34, 220, 18);
      ctx.fillStyle = "#eaf2ff"; ctx.fillText(state.banner.text, VG.W / 2, 47);
      ctx.textAlign = "left"; ctx.globalAlpha = 1;
    }
    // crosshair (subtle, only with the Hand)
    if (state.flags.hasHand && !VG.input.usingPad) {
      const cx = VG.input.mx, cy = VG.input.my;
      ctx.strokeStyle = portals.selected === 0 ? "rgba(143,233,255,0.72)" : "rgba(255,154,208,0.72)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 3, cy); ctx.lineTo(cx + 3, cy); ctx.moveTo(cx, cy - 3); ctx.lineTo(cx, cy + 3); ctx.stroke();
    }
  }
  function drawDialog() {
    const dlg = state.dialog || state.scene;
    if (!dlg) return;
    const pages = dlg.pages, page = pages[Math.min(dlg.page, pages.length - 1)];
    const x = 20, w = VG.W - 40, h = 64, y = VG.H - h - 12;
    parchmentPanel(x, y, w, h, { seed: 5, fill: "rgba(6,5,16,0.92)", stroke: "rgba(143,233,255,0.35)" });
    if (state.dialog) {
      ctx.fillStyle = "#8fe9ff"; ctx.font = "700 8px Georgia, serif";
      ctx.fillText(state.dialog.npc.name.toUpperCase() + (state.dialog.npc.title ? " — " + state.dialog.npc.title : ""), x + 10, y + 13);
    }
    ctx.fillStyle = "#eaf2ff"; ctx.font = "8px Georgia, serif";
    // word-wrap
    const words = page.split(" ");
    let line = "", ly = y + (state.dialog ? 26 : 18);
    for (const wd of words) {
      if (ctx.measureText(line + wd).width > w - 24) { ctx.fillText(line, x + 10, ly); ly += 11; line = wd + " "; }
      else line += wd + " ";
    }
    ctx.fillText(line, x + 10, ly);
    ctx.fillStyle = "#8a9ac0"; ctx.font = "6px monospace"; ctx.textAlign = "right";
    ctx.fillText("E / click ▸", x + w - 8, y + h - 7);
    ctx.textAlign = "left";
  }
  let invRects = [];
  function drawInventory() {
    ctx.fillStyle = "rgba(3,2,9,0.88)"; ctx.fillRect(0, 0, VG.W, VG.H);
    const x = 30, y = 22, w = VG.W - 60, h = VG.H - 44;
    ctx.fillStyle = "rgba(12,10,26,0.96)"; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(143,233,255,0.3)"; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = "#eaf2ff"; ctx.font = "700 12px Georgia, serif"; ctx.fillText("THE BEARER", x + 14, y + 20);
    for (let i = 0; i < player.maxHp; i++) drawHeart(x + 14 + i * 10, y + 28, i < player.hp);
    ctx.font = "7px monospace"; ctx.fillStyle = "#ffcf6b";
    ctx.fillText(`◆ ${player.embers} embers`, x + 14, y + 50);
    ctx.fillStyle = "#8a9ac0";
    ctx.fillText(`ash ${Math.round(player.ash)}/${player.maxAsh}   wolf shards ${player.materials.wolfshard}   glass shards ${player.materials.glassshard}${state.flags.lantern && state.quests.q_lantern !== "done" ? "   pip's lantern" : ""}`, x + 14, y + 62);
    // relics
    ctx.fillStyle = "#8fe9ff"; ctx.font = "700 9px Georgia, serif"; ctx.fillText("RELICS — equip two", x + 14, y + 82);
    invRects = [];
    const owned = Object.keys(player.relics);
    if (!owned.length) { ctx.fillStyle = "#5a6a90"; ctx.font = "7px monospace"; ctx.fillText("none yet — the world is holding them for you", x + 14, y + 96); }
    owned.forEach((id, i) => {
      const ry = y + 92 + i * 22, on = relicOn(id);
      const rect = { x: x + 14, y: ry - 9, w: 250, h: 20, id };
      invRects.push(rect);
      ctx.fillStyle = on ? "rgba(143,233,255,0.12)" : "rgba(255,255,255,0.03)";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = on ? "#8fe9ff" : "rgba(138,154,192,0.3)"; ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      ctx.fillStyle = on ? "#8fe9ff" : "#eaf2ff"; ctx.font = "700 8px Georgia, serif";
      ctx.fillText((on ? "◈ " : "◇ ") + D.RELICS[id].name, rect.x + 6, ry + 1);
      ctx.fillStyle = "#8a9ac0"; ctx.font = "6px monospace";
      ctx.fillText(D.RELICS[id].desc, rect.x + 6, ry + 9);
    });
    // quest log
    const qx = x + w - 260;
    ctx.fillStyle = "#ffcf6b"; ctx.font = "700 9px Georgia, serif"; ctx.fillText("QUESTS", qx, y + 82);
    let qy = y + 94;
    for (const id of Object.keys(D.QUESTS)) {
      const st = state.quests[id];
      if (st === "locked") continue;
      ctx.font = "7px monospace";
      ctx.fillStyle = st === "done" ? "#5a8a5a" : "#ffcf6b";
      ctx.fillText((st === "done" ? "✓ " : "◆ ") + D.QUESTS[id].title, qx, qy);
      qy += 9;
      if (st === "active") {
        ctx.fillStyle = "#8a9ac0"; ctx.font = "6px monospace";
        const dsc = D.QUESTS[id].desc;
        let line = "", ly2 = qy;
        for (const wd of dsc.split(" ")) {
          if (ctx.measureText(line + wd).width > 240) { ctx.fillText(line, qx, ly2); ly2 += 8; line = wd + " "; }
          else line += wd + " ";
        }
        ctx.fillText(line, qx, ly2); qy = ly2 + 11;
      }
    }
    ctx.fillStyle = "#8a9ac0"; ctx.font = "6px monospace"; ctx.textAlign = "center";
    ctx.fillText("TAB / I / ESC — close · click a relic to equip", x + w / 2, y + h - 8);
    ctx.textAlign = "left";
  }
  let shopRects = [];
  function drawShop() {
    ctx.fillStyle = "rgba(3,2,9,0.88)"; ctx.fillRect(0, 0, VG.W, VG.H);
    const x = 60, y = 30, w = VG.W - 120, h = VG.H - 60;
    ctx.fillStyle = "rgba(16,12,10,0.97)"; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,207,107,0.35)"; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = "#ffcf6b"; ctx.font = "700 12px Georgia, serif"; ctx.fillText("BRAM'S FORGE & GOODS", x + 14, y + 20);
    ctx.font = "7px monospace"; ctx.fillText(`your embers: ${player.embers}`, x + w - 130, y + 20);
    shopRects = [];
    D.SHOP.forEach((item, i) => {
      const ry = y + 44 + i * 30;
      const bought = state.shopBought[item.id] || 0;
      const soldOut = (item.max && bought >= item.max) || (item.relic && player.relics[item.relic]);
      const afford = player.embers >= item.cost;
      const rect = { x: x + 14, y: ry - 12, w: w - 28, h: 26, item };
      shopRects.push(rect);
      ctx.fillStyle = soldOut ? "rgba(255,255,255,0.02)" : afford ? "rgba(255,207,107,0.08)" : "rgba(255,255,255,0.03)";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = soldOut ? "rgba(90,90,90,0.4)" : "rgba(255,207,107,0.3)"; ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      ctx.fillStyle = soldOut ? "#5a5a6a" : "#eaf2ff"; ctx.font = "700 8px Georgia, serif";
      ctx.fillText(item.name + (item.max ? `  (${bought}/${item.max})` : ""), rect.x + 8, ry);
      ctx.fillStyle = "#8a9ac0"; ctx.font = "6px monospace"; ctx.fillText(item.desc, rect.x + 8, ry + 9);
      ctx.textAlign = "right"; ctx.fillStyle = soldOut ? "#5a5a6a" : afford ? "#ffcf6b" : "#ff8095";
      ctx.font = "700 9px monospace"; ctx.fillText(soldOut ? "SOLD" : "◆ " + item.cost, rect.x + rect.w - 8, ry + 4);
      ctx.textAlign = "left";
    });
    ctx.fillStyle = "#8a9ac0"; ctx.font = "6px monospace"; ctx.textAlign = "center";
    ctx.fillText("click to buy · ESC to leave", x + w / 2, y + h - 8);
    ctx.textAlign = "left";
  }

  /* ================= overlays (DOM) ================= */
  function showOverlay(kind) { document.body.classList.add("is-vg-overlay-visible"); document.body.dataset.vgOverlayKind = kind; $("[data-vg-overlay]").dataset.kind = kind; $("[data-vg-overlay]").hidden = false; renderOverlay(kind); }
  function hideOverlay() { document.body.classList.remove("is-vg-overlay-visible"); delete document.body.dataset.vgOverlayKind; $("[data-vg-overlay]").hidden = true; }
  function renderOverlay(kind) {
    const el = $("[data-vg-overlay]");
    if (kind === "title") {
      const cont = VG.save.read();
      el.innerHTML = `<div class="vg-panel">
        <p class="vg-kick">A DUSKHOLLOW TALE · THE VESPER HAND</p>
        <h1>VESPERGATE</h1>
        <p class="vg-sub">The village bell is silent. The lake sings back. Tonight your grandmother passes down a gauntlet that folds space through every wall that remembers being a door.</p>
        <div class="vg-campaign"><span>Open world</span><span>6 quests</span><span>2 dungeons</span><span>Linked portals</span></div>
        <div class="vg-btns">
          ${cont ? `<button class="vg-btn vg-primary" data-vg-continue>Continue in ${VG.ROOMS[cont.roomId] ? VG.ROOMS[cont.roomId].name : "Duskhollow"}</button>` : `<button class="vg-btn vg-primary" data-vg-new>Begin the tale</button>`}
          ${cont ? `<button class="vg-btn" data-vg-new>New tale</button>` : ""}
          <button class="vg-btn" data-vg-settings>Settings</button>
        </div>
        <div class="vg-controls" aria-label="Controls">
          <span class="vg-control"><b>WASD</b>Move</span><span class="vg-control"><b>LEFT CLICK</b>Strike</span>
          <span class="vg-control"><b>F</b>Cinder bolt</span><span class="vg-control"><b>RIGHT CLICK</b>Place gate</span>
          <span class="vg-control"><b>Q / R</b>Swap / vent</span><span class="vg-control"><b>SHIFT</b>Roll</span>
          <span class="vg-control"><b>E</b>Talk / use</span><span class="vg-control"><b>TAB</b>Inventory</span>
        </div>
      </div>`;
    } else if (kind === "dead") {
      el.innerHTML = `<div class="vg-panel"><p class="vg-kick" style="color:#ff5c74">THE DUSK TOOK YOU</p><h1>COLLAPSED</h1><p class="vg-sub">You wake at home in Duskhollow. The Hand kept everything you carried.</p><div class="vg-btns"><button class="vg-btn vg-primary" data-vg-retry>Wake</button><button class="vg-btn" data-vg-title>Title</button></div></div>`;
    } else if (kind === "win") {
      el.innerHTML = `<div class="vg-panel"><p class="vg-kick" style="color:#8fe9ff">EVENSONG</p><h1>DUSKHOLLOW RINGS</h1><p class="vg-sub">Bronze below, glass beneath the lake, and the village bell above — all three voices home. The eighth bearer did what seven could not. Score ${state.score}.</p><div class="vg-btns"><button class="vg-btn vg-primary" data-vg-resume>Keep wandering</button><button class="vg-btn" data-vg-title>Title</button></div></div>`;
    } else if (kind === "settings") {
      const s = VG.settings;
      const row = (label, key, min, max, step) => `<label class="vg-set"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-vg-set="${key}"/></label>`;
      const chk = (label, key) => `<label class="vg-set"><span>${label}</span><input type="checkbox" ${s[key] ? "checked" : ""} data-vg-chk="${key}"/></label>`;
      el.innerHTML = `<div class="vg-panel vg-settings"><h1>Settings</h1>
        ${row("Volume", "volume", 0, 1, 0.05)}${row("Music", "music", 0, 1, 0.05)}
        ${row("Screenshake", "shake", 0, 1, 0.1)}${row("Motion", "motion", 0.3, 1, 0.1)}
        ${row("Darkness", "lighting", 0, 1, 0.1)}
        ${row("Damage taken", "damageTaken", 0.25, 1, 0.25)}
        ${chk("Reduced effects", "reducedEffects")}${chk("Crisp HD rendering", "sharpRender")}
        <div class="vg-btns"><button class="vg-btn vg-primary" data-vg-settings-back>Back</button></div></div>`;
    } else if (kind === "pause") {
      const quest = trackedQuest();
      el.innerHTML = `<div class="vg-panel"><p class="vg-kick">${VG.ROOMS[state.roomId]?.name || "Duskhollow"}</p><h1>Paused</h1>
        <p class="vg-sub">${quest ? `Current quest: ${quest.title}.` : "The road is quiet for a moment."} Score ${state.score} · Best chain ${state.bestCombo}.</p>
        <div class="vg-btns"><button class="vg-btn vg-primary" data-vg-resume>Return to Duskhollow</button><button class="vg-btn" data-vg-settings>Settings</button><button class="vg-btn" data-vg-title>Title</button></div></div>`;
    }
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    VG.unlockAudio();
    if (b.dataset.vgFullscreen !== undefined) { VG.toggleFullscreen(); return; }
    if (b.dataset.vgSound !== undefined) { VG.toggleMuted(); return; }
    if (b.dataset.vgPause !== undefined) {
      if (state.phase === "playing") { state.phase = "paused"; showOverlay("pause"); b.textContent = "RESUME"; }
      else if (state.phase === "paused") { state.phase = "playing"; hideOverlay(); b.textContent = "PAUSE"; }
      return;
    }
    if (b.dataset.vgNew !== undefined) { VG.save.clear(); newGame(); }
    else if (b.dataset.vgContinue !== undefined) { const s = VG.save.read(); if (s) { restoreSave(s); startGame(VG.ROOMS[s.roomId] ? s.roomId : "village", null); } else newGame(); }
    else if (b.dataset.vgRetry !== undefined) { player.hp = player.maxHp; player.dead = false; startGame("village", null); }
    else if (b.dataset.vgTitle !== undefined) { state.phase = "title"; showOverlay("title"); }
    else if (b.dataset.vgSettings !== undefined) showOverlay("settings");
    else if (b.dataset.vgSettingsBack !== undefined) { VG.saveSettings(); showOverlay(state.phase === "paused" ? "pause" : state.phase === "win" ? "win" : "title"); }
    else if (b.dataset.vgResume !== undefined) { state.phase = "playing"; hideOverlay(); const pause = $("[data-vg-pause]"); if (pause) pause.textContent = "PAUSE"; }
  });
  document.addEventListener("input", (e) => {
    const t2 = e.target;
    if (t2.dataset && t2.dataset.vgSet) { VG.settings[t2.dataset.vgSet] = parseFloat(t2.value); if (t2.dataset.vgSet === "volume" && VG.audio.master) VG.audio.master.gain.value = VG.settings.volume; VG.saveSettings(); }
    if (t2.dataset && t2.dataset.vgChk) { VG.settings[t2.dataset.vgChk] = t2.checked; VG.saveSettings(); VG.fit(); }
  });
  function shuffledCosmeticOrder() {
    const ids = D.COSMETICS.map((c) => c.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  }
  function newGame() {
    VG.dread.reset();
    for (const q of Object.keys(D.QUESTS)) state.quests[q] = "locked";
    state.quests.q_hand = "active";
    state.flags = { cosmeticOrder: shuffledCosmeticOrder() }; state.shopBought = {};
    player.hp = 4; player.maxHp = 4;
    player.embers = 0; player.vesperSouls = 0; player.relics = {}; player.equipped = []; player.materials = { wolfshard: 0, glassshard: 0 };
    player.bonusMeleeDmg = 0; player.bonusStrikeCdMul = 1; player.bonusBeamDmg = 0; player.bonusReach = 0; player.bonusMagnetMul = 1;
    player.cosmetics = { owned: [], equipped: { cloak: null, glow: null, accessory: null, trail: null } };
    state.score = 0; state.kills = 0; state.completeSent = false;
    state.combo = 0; state.comboT = 0; state.bestCombo = 0; state.damageFlash = 0;
    state.dawn = 0; state.dawnTransition = false; state.vesperHearts = 0; state.soulTiers = {};
    startGame("maren", null);
  }
  function startGame(roomId, spawn) {
    state.phase = "playing";
    hideOverlay();
    loadRoom(roomId, spawn);
    VG.unlockAudio();
  }

  /* canvas clicks: inventory equip / shop buy / dialog advance */
  VG.cv.addEventListener("pointerdown", (e) => {
    const r = VG.cv.getBoundingClientRect();
    const cx2 = (e.clientX - r.left) / r.width * VG.W, cy2 = (e.clientY - r.top) / r.height * VG.H;
    if (state.phase === "inventory") { for (const rc of invRects) if (cx2 >= rc.x && cx2 <= rc.x + rc.w && cy2 >= rc.y && cy2 <= rc.y + rc.h) { toggleEquip(rc.id); return; } }
    else if (state.phase === "shop") { for (const rc of shopRects) if (cx2 >= rc.x && cx2 <= rc.x + rc.w && cy2 >= rc.y && cy2 <= rc.y + rc.h) { buyItem(rc.item); return; } }
    else if (state.phase === "dialog") advanceDialog();
    else if (state.phase === "scene") advanceScene();
  });

  /* ================= host bridge ================= */
  window.addEventListener("message", (e) => {
    const d2 = e.data; if (!d2 || d2.source !== "phantomplay-host") return;
    if (d2.type === "settings" && typeof d2.sound === "boolean") VG.setMuted(!d2.sound);
    if (d2.type === "settings" && d2.reducedMotion) { VG.settings.motion = 0.5; VG.settings.reducedEffects = true; VG.settings.shake = 0.3; }
    if (d2.type === "pause" && state.phase === "playing") { state.phase = "paused"; showOverlay("pause"); const p = $("[data-vg-pause]"); if (p) p.textContent = "RESUME"; }
    if (d2.type === "resume" && state.phase === "paused") { state.phase = "playing"; hideOverlay(); const p = $("[data-vg-pause]"); if (p) p.textContent = "PAUSE"; }
    if (d2.type === "restart") newGame();
  });

  /* ================= main loop ================= */
  let last = 0;
  function frame(now) {
    if (!last) last = now;
    const dt = Math.min(0.033, (now - last) / 1000); last = now;
    state.damageFlash = Math.max(0, state.damageFlash - dt * 3.8);
    state.roomFade = Math.max(0, state.roomFade - dt * 2.6);
    if (state.dawnTransition && state.dawn < 1) state.dawn = Math.min(1, state.dawn + dt / 8);
    if (state.comboT > 0) {
      state.comboT = Math.max(0, state.comboT - dt);
      if (state.comboT === 0) state.combo = 0;
    }
    VG.pollPad();
    const pressed = VG.input.pressed;
    if (pressed.has("Escape") || pressed.has("PadStart")) {
      const pauseButton = $("[data-vg-pause]");
      if (state.phase === "playing") { state.phase = "paused"; showOverlay("pause"); if (pauseButton) pauseButton.textContent = "RESUME"; }
      else if (state.phase === "paused") { state.phase = "playing"; hideOverlay(); if (pauseButton) pauseButton.textContent = "PAUSE"; }
      else if (state.phase === "inventory" || state.phase === "shop") state.phase = "playing";
      pressed.delete("Escape");
    }
    if (state.phase === "playing") { simulate(VG.fx.scaleDt(dt)); pressed.clear(); }
    else if (state.phase === "dialog" || state.phase === "scene") {
      state.t += dt;
      if (pressed.has("KeyE") || pressed.has("Space") || pressed.has("M1") || pressed.has("PadA")) {
        if (state.dialog) advanceDialog(); else advanceScene();
      }
      pressed.clear();
    } else if (state.phase === "inventory" || state.phase === "shop") {
      state.t += dt;
      if (pressed.has("Tab") || pressed.has("KeyI") || pressed.has("PadBack")) state.phase = "playing";
      pressed.clear();
    } else {
      if (state.phase === "title" || state.phase === "dead" || state.phase === "win") state.t += dt;
      pressed.clear();
    }

    VG.resetCanvasTransform();
    ctx.fillStyle = "#05040c"; ctx.fillRect(0, 0, VG.W, VG.H);
    if (state.room) {
      VG.camera.apply(ctx);
      drawScene();
      VG.camera.reset(ctx);
      applyLighting();
      drawHUD();
      drawScreenFx();
      if (state.phase === "dialog" || state.phase === "scene") drawDialog();
      if (state.phase === "inventory") drawInventory();
      if (state.phase === "shop") drawShop();
    } else drawTitleBackdrop();
    requestAnimationFrame(frame);
  }

  /* ================= boot ================= */
  VG.fit();
  showOverlay("title");
  host("ready", { title: "Vespergate: The Vesper Hand" });
  requestAnimationFrame(frame);

  /* ================= test hook ================= */
  window.__VespergateTest = {
    state: () => ({
      phase: state.phase, room: state.roomId,
      px: +player.x.toFixed(1), py: +player.y.toFixed(1),
      hp: player.hp, maxHp: player.maxHp, ash: Math.round(player.ash), embers: player.embers,
      quests: { ...state.quests }, flags: Object.keys(state.flags),
      relics: Object.keys(player.relics), equipped: player.equipped.slice(),
      gates: portals.gates.map((g) => g.active), strain: +portals.strain.toFixed(2),
      enemies: enemies.filter((e) => !e.dead).length, npcs: npcs.map((n) => n.id),
      bossHp: boss ? boss.hp : null, score: state.score, kills: state.kills,
      combo: state.combo, bestCombo: state.bestCombo,
      renderScale: +(VG.renderScale || 1).toFixed(2),
      fullscreen: !!document.fullscreenElement || document.body.classList.contains("is-vg-theater"),
    }),
    newGame: () => newGame(),
    warp: (room, gx, gy) => { loadRoom(room, gx != null ? { x: gx, y: gy } : null); state.phase = "playing"; hideOverlay(); },
    grant: (flag) => { state.flags[flag] = true; },
    setQuest: (id, st) => { state.quests[id] = st; },
    embers: (n) => { player.embers += n; },
    clearEnemies: () => { for (const e of enemies.slice()) if (!e.dead) killEnemy(e); },
    skipScene: () => { while (state.scene) advanceScene(); while (state.dialog) advanceDialog(); },
    placeGates: (x1, y1, d1, x2, y2, d2) => { portals.place(0, x1, y1, d1, true); portals.place(1, x2, y2, d2, true); portals.gates.forEach((g) => g.open = 1); },
    teleportTest: (ent) => portals.tryTeleport(ent, "test" + Math.random(), { strain: 0, force: true }),
    holeTest: (x, y) => portals.holeAt(x, y),
    rooms: () => Object.keys(VG.ROOMS),
  };
})();
