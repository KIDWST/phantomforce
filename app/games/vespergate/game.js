/* VESPERGATE 3.1: LIVING DREAD — game.js
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
  const BALANCE_VERSION = 3;
  const embedded = window.parent !== window;
  const host = (type, data = {}) => { if (embedded) parent.postMessage({ source: "phantomplay-game", type, ...data }, "*"); };
  const $ = (s) => document.querySelector(s);

  /* ================= state ================= */
  const state = {
    phase: "title",   // title | playing | dialog | inventory | map | shop | scene | paused | dead | win
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
    mastery: { portalCrossings: 0, foldshots: 0, perfectRooms: 0 },
    discovered: {}, playSeconds: 0,
    focusCd: 0, focusT: 0, autosaveT: 0,
    checkpoint: { roomId: "maren", spawn: { x: 8, y: 9 } },
    progressionWatch: { key: "", since: 0, hintTier: 0 },
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
    shieldT: 0, shieldCd: 0, shieldWarnCd: 0,
    progressShots: 0,
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

  let shots = [], bolts = [], enemies = [], pickups = [], rings = [], particles = [], floatText = [], npcs = [], recoveryFonts = [], resonanceFonts = [], boss = null;
  let beamFailCooldown = 0;
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
    return {
      bellRestored: !!state.flags.bellRestored,
      fencesFixed: !!state.flags.orchardRestored,
      lanternsLit: !!(state.flags.lanternRestored || state.flags.bellRestored || state.flags.evensong),
      orchardRestored: !!state.flags.orchardRestored,
      glassRestored: !!state.flags.glassRestored,
    };
  }
  function progressPct() { return Math.round(questsDone() / Object.keys(D.QUESTS).length * 100); }
  function recoveryFlag(id, suffix) { return `recovery_${id}_${suffix}`; }
  function sigilFlag(roomId) { return "sigil_" + roomId; }
  function recoveryStillNeeded(def) {
    const rec = def.wholenessRecovery;
    return !!rec && (!rec.requiredUntilFlag || !state.flags[rec.requiredUntilFlag]);
  }
  function recoveryAwakened(def) {
    const rec = def.wholenessRecovery;
    return !!rec && !!state.flags[recoveryFlag(rec.id, "awake")];
  }
  function buildRecoveryFont(def) {
    const rec = def.wholenessRecovery;
    if (!rec) return null;
    const needed = recoveryStillNeeded(def);
    const awake = recoveryAwakened(def);
    return {
      ...rec,
      x: rec.gx * T + 8,
      y: rec.gy * T + 8,
      state: needed ? (awake ? "ready" : "inactive") : "dimmed",
      t: 0,
    };
  }
  function resonanceFlag(id, suffix) { return `resonance_${id}_${suffix}`; }
  function resonanceStillNeeded(def) {
    const rec = def?.resonanceRecovery;
    if (!rec) return false;
    if (rec.requiredUntil?.kind === "bells") return bellsRung(def.id) < (rec.requiredUntil.count || (def.bells || []).length);
    if (rec.requiredUntil?.kind === "sequence") return !sequenceComplete(def);
    return true;
  }
  function resonanceAwakened(def) {
    const rec = def?.resonanceRecovery;
    return !!rec && !!state.flags[resonanceFlag(rec.id, "awake")];
  }
  function buildResonanceFont(def) {
    const rec = def?.resonanceRecovery;
    if (!rec) return null;
    const needed = resonanceStillNeeded(def);
    const awake = resonanceAwakened(def);
    return {
      ...rec,
      x: rec.gx * T + 8,
      y: rec.gy * T + 8,
      state: needed ? (awake ? "ready" : "inactive") : "dimmed",
      t: 0,
    };
  }
  function encounterFlag(def) { return def.clearFlag || (def.persistClear ? `clear_${def.id}` : null); }
  function encounterCleared(def) {
    const flag = encounterFlag(def);
    return !!(flag && state.flags[flag]);
  }
  function sequenceKey(roomId) { return `bell_sequence_${roomId}`; }
  function sequenceProgress(roomId) { return Number(state.flags[sequenceKey(roomId)] || 0); }
  function sequenceComplete(def) { return !!def.bellSequence && sequenceProgress(def.id) >= def.bellSequence.length; }
  function relayFlag(roomId, relayId) { return `relay_${roomId}_${relayId}`; }
  function relaysLit(def) { return (def.mirrorRelays || []).filter((relay) => state.flags[relayFlag(def.id, relay.id)]).length; }
  function sanctumComplete(def) { return !!(def.sanctum?.completeFlag && state.flags[def.sanctum.completeFlag]); }
  function liveThreatCount() { return enemies.filter((enemy) => !enemy.dead).length + (boss && !boss.dead ? 1 : 0); }
  function roomObjectiveText(def = VG.ROOMS[state.roomId]) {
    if (!def) return "";
    if (def.sanctum) return sanctumComplete(def) ? (def.restoredHint || def.hint || "") : (def.hint || "");
    if (def.boss) return state.flags[def.bossClearFlag] ? (def.postClearHint || def.hint || "") : (def.hint || "");
    if (def.choir) return state.flags.glassDone ? (def.postClearHint || def.hint || "") : (def.hint || "");
    if (liveThreatCount() > 0) return def.hint || "";
    if (def.bellSequence) return sequenceComplete(def) ? (def.solvedHint || def.postClearHint || def.hint || "") : (def.postClearHint || def.hint || "");
    if ((def.mirrorRelays || []).length) return relaysLit(def) >= def.mirrorRelays.length ? (def.solvedHint || def.postClearHint || def.hint || "") : (def.postClearHint || def.hint || "");
    if (def.sigil) return state.flags[sigilFlag(def.id)] ? (def.solvedHint || def.postClearHint || def.hint || "") : (def.postClearHint || def.hint || "");
    if ((def.bells || []).length) return bellsRung(def.id) >= def.bells.length ? (def.solvedHint || def.postClearHint || def.hint || "") : (def.postClearHint || def.hint || "");
    return encounterCleared(def) ? (def.postClearHint || def.hint || "") : (def.hint || "");
  }
  function refreshRoomObjective() { setHint(roomObjectiveText()); }
  function exitLockReason(ex, def = VG.ROOMS[state.roomId]) {
    if (ex.needClear && !encounterCleared(def)) return "Clear every threat";
    if (ex.needBells && bellsRung(def.id) < ex.needBells && !state.flags.bellRestored) return `${bellsRung(def.id)} / ${ex.needBells} bells`;
    if (ex.needSequence && !sequenceComplete(def)) return `${sequenceProgress(def.id)} / ${def.bellSequence.length} chord`;
    if (ex.needSigil && !state.flags[sigilFlag(def.id)]) return "The sigil is dark";
    if (ex.needRelays && relaysLit(def) < ex.needRelays) return `${relaysLit(def)} / ${ex.needRelays} reflections`;
    if (ex.needFlag && !state.flags[ex.needFlag]) return "The way is still sealed";
    return "";
  }
  function musicStateForRoom(def, bossActive = false) {
    if (bossActive) return "boss";
    return def && (def.biome === "dungeon" || def.biome === "ossuary") ? "dungeon" : "outdoors";
  }
  function copySpawn(spawn) {
    return spawn && Number.isFinite(spawn.x) && Number.isFinite(spawn.y) ? { x: spawn.x, y: spawn.y } : null;
  }
  function setCheckpoint(roomId, spawn) {
    if (!VG.ROOMS[roomId]) return;
    state.checkpoint = { roomId, spawn: copySpawn(spawn) || copySpawn(VG.ROOMS[roomId].spawn) };
  }
  function respawnAtCheckpoint() {
    const checkpoint = state.checkpoint && VG.ROOMS[state.checkpoint.roomId]
      ? state.checkpoint
      : { roomId: "maren", spawn: { x: 8, y: 9 } };
    player.hp = player.maxHp;
    player.dead = false;
    player.iframe = 1.2;
    player.kx = 0; player.ky = 0;
    player.shieldT = 0; player.shieldCd = 0;
    state.phase = "playing";
    hideOverlay();
    loadRoom(checkpoint.roomId, checkpoint.spawn);
    banner("RETURNED TO THE LAST DOOR");
  }
  const MASTERY_RANKS = [
    { at: 0, name: "UNAWAKENED" }, { at: 8, name: "GATEBOUND" },
    { at: 24, name: "FOLDWALKER" }, { at: 52, name: "VESPER ADEPT" },
    { at: 90, name: "EIGHTH BEARER" },
  ];
  function masteryScore() {
    return state.mastery.portalCrossings + state.mastery.foldshots * 2 + questsDone() * 6 + state.mastery.perfectRooms * 4;
  }
  function masteryRank() {
    const score = masteryScore();
    return [...MASTERY_RANKS].reverse().find((rank) => score >= rank.at) || MASTERY_RANKS[0];
  }
  function nextMasteryRank() { return MASTERY_RANKS.find((rank) => rank.at > masteryScore()) || null; }
  function recordMastery(kind) {
    const before = masteryRank().name;
    state.mastery[kind] = (state.mastery[kind] || 0) + 1;
    const after = masteryRank().name;
    if (after !== before) { banner("VESPER MASTERY — " + after); VG.sfxBell(330, 0.14); saveGame(); }
  }
  function useVesperSense() {
    if (!state.flags.hasHand || state.focusCd > 0) return;
    state.focusCd = 8; state.focusT = 1.4;
    VG.fx.spawnShockwave(player.x, player.y, { maxR: 360, speed: 240, color: "143,233,255" });
    VG.sfxBell(260, 0.08);
    toast("VESPER SENSE — paths revealed", player.x, player.y - 20, "#8fe9ff");
  }

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
    if (id === "q_wolves") state.flags.orchardRestored = true;
    if (id === "q_lantern") state.flags.lanternRestored = true;
    if (q.reward) { player.embers += q.reward; toast("+" + q.reward + " embers", player.x, player.y - 16, "#ffcf6b"); }
    banner("QUEST COMPLETE — " + q.title);
    VG.sfxBell(180, 0.12);
    state.score += 250;
    host("progress", { progress: progressPct(), state: { quests: state.quests } });
    saveGame();
    ensureNextQuestDirection(id);
  }
  function trackedQuest() {
    const order = ["q_evensong", "q_glass", "q_bell", "q_lantern", "q_wolves", "q_hand"];
    for (const id of order) if (state.quests[id] === "active") return D.QUESTS[id];
    return null;
  }
  function ensureNextQuestDirection(doneId) {
    if (doneId === "q_bell" && state.quests.q_glass === "locked") {
      acceptQuest("q_glass");
      setHint("Next: cross the Vale to Lake Saint-Glass and enter the Ossuary stair on the island.");
      return;
    }
    if (doneId === "q_glass" && state.quests.q_evensong === "locked") {
      acceptQuest("q_evensong");
      setHint("Finale: return to Duskhollow village and ring the bell in the plaza.");
    }
  }
  function repairQuestDirectionFromSave() {
    if (state.quests.q_bell === "done" && state.quests.q_glass === "locked") state.quests.q_glass = "active";
    if (state.quests.q_glass === "done" && state.quests.q_evensong === "locked") state.quests.q_evensong = "active";
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
  function bodyClear(o, x, y) {
    const r = o.r;
    return !blocked(x - r * 0.65, y - r * 0.65)
      && !blocked(x + r * 0.65, y - r * 0.65)
      && !blocked(x - r * 0.65, y + r * 0.65)
      && !blocked(x + r * 0.65, y + r * 0.65);
  }
  function nudgeBody(o, dx, dy) {
    const nx = o.x + dx, ny = o.y + dy;
    if (bodyClear(o, nx, ny)) { o.x = nx; o.y = ny; return; }
    if (bodyClear(o, nx, o.y)) o.x = nx;
    if (bodyClear(o, o.x, ny)) o.y = ny;
  }
  function separateBodies(a, b, padding = 2, aShare = 0.68) {
    let dx = a.x - b.x, dy = a.y - b.y;
    let distance = Math.hypot(dx, dy);
    if (distance < 0.001) { dx = a.fx || 1; dy = a.fy || 0; distance = Math.hypot(dx, dy) || 1; }
    const nx = dx / distance, ny = dy / distance;
    const overlap = a.r + b.r + padding - distance;
    if (overlap <= 0) return null;
    nudgeBody(a, nx * overlap * aShare, ny * overlap * aShare);
    nudgeBody(b, -nx * overlap * (1 - aShare), -ny * overlap * (1 - aShare));
    return { nx, ny, overlap };
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
    confuseGuardsNearGate(placePreview.x, placePreview.y);
  }

  /* ================= combat ================= */
  function confuseShieldGuard(e, x, y, duration = 2.4) {
    if (!e || e.dead || e.type !== "guard") return false;
    e.confuseT = Math.max(e.confuseT || 0, duration);
    e.investigateX = x;
    e.investigateY = y;
    e.cd = Math.max(e.cd, duration * 0.65);
    toast("?", e.x, e.y - 22, "#8fe9ff");
    spawnParticles(e.x, e.y, "#8fe9ff", 5, 36);
    VG.sfxGate(0, "cross");
    return true;
  }
  function confuseGuardsNearGate(x, y) {
    let fooled = 0;
    for (const e of enemies) {
      if (e.dead || e.type !== "guard") continue;
      const distance = VG.dist(e.x, e.y, x, y);
      if (distance > 86) continue;
      const behindDot = Math.cos(e.facing) * (x - e.x) + Math.sin(e.facing) * (y - e.y);
      if (distance < 42 || behindDot < 18) {
        if (confuseShieldGuard(e, x, y)) fooled++;
      }
    }
    if (fooled) toast("guard fooled", x, y - 18, "#8fe9ff");
  }
  function strike() {
    if (player.strikeCd > 0) return;
    const aimLength = Math.hypot(player.aimx, player.aimy) || 1;
    player.fx = player.aimx / aimLength; player.fy = player.aimy / aimLength;
    player.strikeCd = 0.27 * player.bonusStrikeCdMul; player.strikeT = 0.14;
    VG.sfxCinder("needle"); VG.camera.jolt(0.05);
    const reach = 24 + player.bonusReach, arc = 1.25;
    const fa = Math.atan2(player.fy, player.fx);
    spawnParticles(player.x + player.fx * 12, player.y + player.fy * 12, "#ffd166", 5, 55);
    for (const e of enemies) {
      if (e.dead) continue;
      const d = VG.dist(player.x, player.y, e.x, e.y);
      if (d > reach + e.r) continue;
      const da = Math.abs(Math.atan2(Math.sin(Math.atan2(e.y - player.y, e.x - player.x) - fa), Math.cos(Math.atan2(e.y - player.y, e.x - player.x) - fa)));
      const contactHit = d <= player.r + e.r + 5;
      if (da > arc && !contactHit) continue;
      const fromBehind = contactHit || (e.facing ? (Math.cos(e.facing) * (e.x - player.x) + Math.sin(e.facing) * (e.y - player.y)) > 0 : true);
      damageEnemy(e, 10 + player.bonusMeleeDmg, fromBehind);
      // Knockback impulse, not an instant position nudge: applied/decayed in
      // stepEnemy so it survives that enemy's own AI movement this frame
      // instead of being immediately overwritten by it.
      const hitDx = e.x - player.x, hitDy = e.y - player.y, hitLength = Math.hypot(hitDx, hitDy) || 1;
      e.kx = (e.kx || 0) + hitDx / hitLength * 240; e.ky = (e.ky || 0) + hitDy / hitLength * 240;
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
    const progressShot = player.progressShots > 0 && mandatoryRangedTargetsRemain();
    if (player.boltCd > 0 || (player.hp < player.maxHp && !progressShot)) {
      if (player.hp < player.maxHp && !progressShot && beamFailCooldown <= 0) {
        beamFailCooldown = 0.75;
        toast("The Hand answers only while you are whole", player.x, player.y - 22, "#ffcf6b");
        VG.sfx(160, 0.08, "square", 0.035);
        VG.sfx(240, 0.06, "sine", 0.025);
        VG.camera.jolt(0.08);
        spawnParticles(player.x + player.aimx * 8, player.y + player.aimy * 8, "#8a9ac0", 4, 26);
        try {
          const pad = navigator.getGamepads && Array.from(navigator.getGamepads()).find((p) => p && p.connected);
          pad?.vibrationActuator?.playEffect?.("dual-rumble", { duration: 80, weakMagnitude: 0.18, strongMagnitude: 0.08 });
        } catch {}
      }
      return;
    }
    if (progressShot) player.progressShots = Math.max(0, player.progressShots - 1);
    player.boltCd = 0.22;
    shots.push({
      x: player.x + player.aimx * 8, y: player.y + player.aimy * 8,
      vx: player.aimx * 300, vy: player.aimy * 300,
      r: progressShot ? 2.5 : 2, dmg: 4 + player.bonusBeamDmg, life: 1.8, _bounces: 0, foldshot: false, pierce: 0, progressShot, key: "shot" + Math.random(),
    });
    VG.sfxCinder("needle"); VG.camera.jolt(progressShot ? 0.06 : 0.04);
    spawnParticles(player.x + player.aimx * 8, player.y + player.aimy * 8, progressShot ? "#fff0c2" : "#ffcf6b", progressShot ? 5 : 2, 40);
  }
  function nearestShieldTarget() {
    const targets = enemies.filter((enemy) => !enemy.dead);
    if (boss && !boss.dead) targets.push(boss);
    let nearest = null, distance = Infinity;
    for (const target of targets) {
      const d = VG.dist(player.x, player.y, target.x, target.y);
      if (d < distance) { nearest = target; distance = d; }
    }
    return nearest;
  }
  function activateVesperShield() {
    if (!state.flags.hasVesperShield) return false;
    if (player.shieldCd > 0) {
      if (player.shieldWarnCd <= 0) {
        toast(`shield recharging · ${player.shieldCd.toFixed(1)}s`, player.x, player.y - 20, "#8fe9ff");
        player.shieldWarnCd = 0.45;
      }
      return false;
    }
    player.shieldT = 0.72;
    player.shieldCd = 3.4;
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - player.x, dy = enemy.y - player.y, d = Math.hypot(dx, dy) || 1;
      if (d > 48) continue;
      enemy.kx += dx / d * 250; enemy.ky += dy / d * 250;
    }
    rings.push({ x: player.x, y: player.y, r: 8, vr: 150, dmg: 2, life: 0.5, hostile: false });
    spawnParticles(player.x, player.y, "#8fe9ff", 12, 80);
    VG.sfxGate(0, "cross"); VG.camera.jolt(0.08);
    return true;
  }
  function reflectWithVesperShield(bolt) {
    const target = nearestShieldTarget();
    let dx = target ? target.x - player.x : -bolt.vx;
    let dy = target ? target.y - player.y : -bolt.vy;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const speed = Math.max(260, Math.hypot(bolt.vx, bolt.vy) * 1.25);
    bolt.x = player.x + dx * 18; bolt.y = player.y + dy * 18;
    bolt.vx = dx * speed; bolt.vy = dy * speed;
    bolt.hostileToEnemies = true;
    bolt.color = "#8fe9ff";
    bolt.dmg = Math.max(1.5, bolt.dmg * 1.6);
    spawnParticles(player.x + dx * 12, player.y + dy * 12, "#8fe9ff", 7, 70);
    VG.sfx(860, 0.08, "triangle", 0.05);
  }
  function damageEnemy(e, dmg, fromBehind) {
    if (e.dead) return;
    const confused = (e.confuseT || 0) > 0;
    if (e.type === "guard" && e.shield && !fromBehind && !confused) { spawnParticles(e.x, e.y, "#8aa", 3, 30); VG.sfx(320, 0.04, "square", 0.03); return; }
    e.hp -= dmg * (VG.settings.damageDealtMul || 1); e.hurt = 0.12; spawnParticles(e.x, e.y, "#ffd166", 6, 70);
    VG.sfx(500, 0.03, "triangle", 0.03);
    if (e.hp <= 0) killEnemy(e);
  }
  function finishPersistentCombat() {
    const def = VG.ROOMS[state.roomId];
    if (!def?.persistClear || enemies.some((enemy) => !enemy.dead)) return;
    const flag = encounterFlag(def);
    if (!flag || state.flags[flag]) return;
    state.flags[flag] = true;
    banner(def.clearBanner || "THE ROOM FALLS QUIET");
    VG.sfxBell(190, 0.12);
    refreshRoomObjective();
    saveGame();
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
    if (player.hp < player.maxHp && (state.kills % 3 === 0 || Math.random() < 0.18)) {
      pickups.push({ x: e.x, y: e.y, vx: 0, vy: -24, type: "heart", value: 1, bob: Math.random() * 6 });
    }
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
    // The Choir victory opens a forward route. The civic quest resolves in
    // the Heart of Glass, where the player actually returns its memory.
    if (state.room && VG.ROOMS[state.roomId].choir && !enemies.some((o) => !o.dead && o.tag === "choir")) {
      if (!state.flags.glassDone) {
        state.flags.glassDone = true;
        state.flags.choirSilenced = true;
        player.relics.mirrorlitany = true;
        toast("Owning it isn't enough — open TAB and equip it (max 2)", player.x, player.y - 28, "#c9d6e8");
        VG.sfxBell(240, 0.16);
        grantHeart("heart_choir", "VESPER HEART — the Choir's voice, silenced");
        banner(VG.ROOMS[state.roomId].clearBanner || "THE CHOIR BREAKS");
        refreshRoomObjective();
        saveGame();
      }
    }
    finishPersistentCombat();
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
      state.flags.bellmotherSilenced = true;
      player.relics.bellsigil = true;
      grantHeart("heart_bellmother", "VESPER HEART — the Bellmother's toll, silenced");
      state.flags.hasVesperShield = true;
      player.shieldCd = 0;
      banner("VESPER SHIELD — RIGHT-CLICK TO RETURN FIRE");
      toast("THE BRONZE REMEMBERS ITS SONG", boss.x, boss.y - 24, "#8fe9ff");
      toast("Bell Sigil gained · press G to place gates now", player.x, player.y - 28, "#c9d6e8");
      VG.sfxBell(220, 0.2);
      VG.fx.hitStop(0.14); VG.camera.jolt(0.5);
      VG.fx.spawnShockwave(boss.x, boss.y, { maxR: 420, speed: 210, color: "143,233,255" });
      spawnParticles(boss.x, boss.y, "#c9d6e8", 26, 110);
      spawnParticles(boss.x, boss.y, "#5a4020", 16, 70);
      state.score += 1000;
      banner(VG.ROOMS[state.roomId].clearBanner || "THE BRONZE DOOR WAKES");
      refreshRoomObjective();
      saveGame();
    }
  }
  function hurtPlayer(dmg, kx = 0, ky = 0) {
    if (player.iframe > 0 || player.dead || player.rollT > 0) return;
    player.hp -= Math.max(1, Math.round(dmg * VG.settings.damageTaken));
    player.iframe = 1.05;
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
  function awakenRecoveryFont(font) {
    if (!font || font.state !== "inactive") return;
    font.state = "awakening";
    font.t = 0;
    state.flags[recoveryFlag(font.id, "awake")] = true;
    if (!state.flags[recoveryFlag(font.id, "announced")]) {
      state.flags[recoveryFlag(font.id, "announced")] = true;
      banner(font.firstBanner || "THE GLASS REMEMBERS");
      toast(font.lesson || "The Hand answers only while the bearer is whole.", font.x, font.y - 18, "#c9d6e8");
    }
    VG.sfxBell(220, 0.16);
    spawnParticles(font.x, font.y, "#c9d6e8", 16, 70);
    saveGame();
  }
  function useRecoveryFont(font, quiet = false) {
    if (!font || (font.state !== "ready" && font.state !== "awakening")) return false;
    if (player.hp >= player.maxHp) {
      if (!quiet) {
        toast("You are whole", font.x, font.y - 16, "#fff0c2");
        VG.sfx(520, 0.05, "triangle", 0.025);
      }
      return true;
    }
    player.hp = player.maxHp;
    font.state = "healing";
    font.t = 0;
    toast("WHOLENESS RESTORED", player.x, player.y - 18, "#fff0c2");
    VG.sfxBell(280, 0.12);
    VG.sfx(720, 0.12, "sine", 0.035);
    VG.camera.jolt(0.12);
    spawnParticles(player.x, player.y, "#fff0c2", 22, 80);
    saveGame();
    return true;
  }
  function updateRecoveryFonts(dt) {
    const def = VG.ROOMS[state.roomId];
    const needed = recoveryStillNeeded(def);
    for (const font of recoveryFonts) {
      font.t += dt;
      if (!needed) {
        font.state = "dimmed";
        continue;
      }
      if (font.state === "inactive" && font.awakenWhenEnemiesCleared && enemies.every((e) => e.dead)) {
        awakenRecoveryFont(font);
      }
      if (font.state === "awakening" && font.t > 0.45) font.state = "ready";
      if (font.state === "healing" && font.t > 0.55) font.state = "ready";
      if ((font.state === "ready" || font.state === "awakening") && VG.dist(player.x, player.y, font.x, font.y) < (font.radius || 16)) {
        useRecoveryFont(font, true);
      }
    }
  }
  function mandatoryRangedTargetsRemain(def = VG.ROOMS[state.roomId]) {
    if (!def) return false;
    if ((def.bells || []).length && resonanceStillNeeded(def)) return true;
    if (def.sigil && !state.flags[sigilFlag(def.id)]) return true;
    if ((def.mirrorRelays || []).length && relaysLit(def) < def.mirrorRelays.length) return true;
    return false;
  }
  function awakenResonanceFont(font) {
    if (!font || font.state !== "inactive") return;
    font.state = "awakening";
    font.t = 0;
    state.flags[resonanceFlag(font.id, "awake")] = true;
    if (!state.flags[resonanceFlag(font.id, "announced")]) {
      state.flags[resonanceFlag(font.id, "announced")] = true;
      banner(font.firstBanner || "THE BRASS OFFERS A HAND");
      toast(font.lesson || "The road can still answer.", font.x, font.y - 18, "#ffcf6b");
    }
    VG.sfxBell(160, 0.14);
    spawnParticles(font.x, font.y, "#ffcf6b", 14, 62);
    saveGame();
  }
  function grantProgressShot(font, quiet = false) {
    if (!font || (font.state !== "ready" && font.state !== "awakening")) return false;
    if (!mandatoryRangedTargetsRemain()) return false;
    player.progressShots = Math.max(player.progressShots || 0, 1);
    font.state = "charging";
    font.t = 0;
    if (!quiet) toast("A puzzle shot gathers in the Hand", player.x, player.y - 18, "#ffcf6b");
    VG.sfx(620, 0.08, "triangle", 0.035);
    spawnParticles(player.x, player.y, "#ffcf6b", 12, 55);
    saveGame();
    return true;
  }
  function updateResonanceFonts(dt) {
    const def = VG.ROOMS[state.roomId];
    const needed = resonanceStillNeeded(def);
    for (const font of resonanceFonts) {
      font.t += dt;
      if (!needed) {
        font.state = "dimmed";
        continue;
      }
      if (font.state === "inactive" && font.awakenWhenEnemiesCleared && enemies.every((e) => e.dead)) {
        awakenResonanceFont(font);
      }
      if (font.state === "awakening" && font.t > 0.45) font.state = "ready";
      if (font.state === "charging" && font.t > 0.5) font.state = "ready";
      if ((font.state === "ready" || font.state === "awakening") && player.progressShots <= 0 && VG.dist(player.x, player.y, font.x, font.y) < (font.radius || 16)) {
        grantProgressShot(font, true);
      }
    }
  }
  function objectiveProgressKey(def = VG.ROOMS[state.roomId]) {
    if (!def) return "none";
    return [
      def.id,
      liveThreatCount(),
      bellsRung(def.id),
      sequenceProgress(def.id),
      relaysLit(def),
      def.sigil ? Number(!!state.flags[sigilFlag(def.id)]) : 0,
      player.hp,
      player.progressShots || 0,
    ].join(":");
  }
  function inspectProgression(def = VG.ROOMS[state.roomId]) {
    const objective = (def?.progressionObjectives || [])[0] || null;
    const remaining = [];
    const recoveries = [];
    let possible = true;
    let reason = "";
    if (!def || !objective) {
      return { room: state.roomId, objective: null, requiredConditions: [], availableCapabilities: [], remainingRequiredObjects: [], recoveryMethods: [], exitCondition: "", possible: true, reason: "No mandatory objective is active." };
    }
    const threats = liveThreatCount();
    const canFire = player.hp >= player.maxHp || player.progressShots > 0;
    const bellCount = (def.bells || []).length;
    const bellsDone = bellCount ? bellsRung(def.id) : 0;
    if (bellCount && bellsDone < bellCount) {
      for (let i = 0; i < bellCount; i++) if (!state.flags[`bell_${def.id}_${i}`]) remaining.push(`bell:${def.id}:${i}`);
      const directBell = !!nearbyMandatoryBell();
      const resonanceReady = resonanceFonts.some((font) => font.state === "ready" || font.state === "awakening" || font.state === "charging");
      if (def.resonanceRecovery) recoveries.push(def.resonanceRecovery.id);
      possible = threats > 0 || canFire || directBell || resonanceReady || !!def.resonanceRecovery;
      if (!possible) reason = "Required ranged bell activation is unavailable and no resonance recovery exists.";
    }
    if (def.bellSequence && !sequenceComplete(def)) {
      remaining.length = 0;
      for (const index of def.bellSequence.slice(sequenceProgress(def.id))) remaining.push(`bell:${def.id}:${index}`);
      const directBell = !!nearbyMandatoryBell();
      const resonanceReady = resonanceFonts.some((font) => font.state === "ready" || font.state === "awakening" || font.state === "charging");
      if (def.resonanceRecovery && !recoveries.includes(def.resonanceRecovery.id)) recoveries.push(def.resonanceRecovery.id);
      possible = threats > 0 || canFire || directBell || resonanceReady || !!def.resonanceRecovery;
      if (!possible) reason = "Required bell sequence activation is unavailable and no resonance recovery exists.";
    }
    if (def.sigil && !state.flags[sigilFlag(def.id)]) {
      remaining.push(`sigil:${def.id}`);
      const recoveryReady = recoveryFonts.some((font) => font.state === "ready" || font.state === "awakening" || font.state === "healing");
      if (def.wholenessRecovery) recoveries.push(def.wholenessRecovery.id);
      possible = threats > 0 || canFire || recoveryReady || !!def.wholenessRecovery;
      if (!possible) reason = "Required whole beam is unavailable and no wholeness recovery exists.";
    }
    if ((def.mirrorRelays || []).length && relaysLit(def) < def.mirrorRelays.length) {
      for (const relay of def.mirrorRelays) if (!state.flags[relayFlag(def.id, relay.id)]) remaining.push(`relay:${def.id}:${relay.id}`);
      const recoveryReady = recoveryFonts.some((font) => font.state === "ready" || font.state === "awakening" || font.state === "healing");
      if (def.wholenessRecovery && !recoveries.includes(def.wholenessRecovery.id)) recoveries.push(def.wholenessRecovery.id);
      possible = threats > 0 || canFire || recoveryReady || !!def.wholenessRecovery;
      if (!possible) reason = "Required relay beam is unavailable and no wholeness recovery exists.";
    }
    const exitCondition = (def.exits || []).map((ex) => ({ to: ex.to, locked: exitLockReason(ex, def) || null })).filter((ex) => ex.locked || objective.requiredWorldObjects?.includes(`exit:${ex.to}`));
    return {
      room: def.id,
      objective: objective.label || objective.id,
      requiredConditions: {
        interactions: objective.requiredInteractions || [],
        abilities: objective.requiredAbilities || [],
        resources: objective.requiredResources || [],
        playerState: objective.requiredPlayerState || [],
        enemyState: objective.requiredEnemyState || null,
      },
      availableCapabilities: {
        fire: canFire,
        whole: player.hp >= player.maxHp,
        progressShots: player.progressShots || 0,
        directBell: !!nearbyMandatoryBell(),
      },
      remainingRequiredObjects: remaining,
      recoveryMethods: [...new Set([...(objective.recoveryMethods || []), ...recoveries])],
      exitCondition,
      possible,
      reason: possible ? "At least one forward or recovery path exists." : reason,
    };
  }
  function ensureProgressionSafety(dt) {
    const def = VG.ROOMS[state.roomId];
    if (!def?.progressionObjectives?.length) return;
    const key = objectiveProgressKey(def);
    if (state.progressionWatch.key !== key) {
      state.progressionWatch = { key, since: state.t, hintTier: 0 };
    }
    if (def.resonanceRecovery && resonanceStillNeeded(def) && liveThreatCount() <= 0) {
      for (const font of resonanceFonts) if (font.state === "inactive") awakenResonanceFont(font);
    }
    const report = inspectProgression(def);
    if (!report.possible) {
      const recovery = resonanceFonts.find((font) => font.state === "ready" || font.state === "awakening")
        || recoveryFonts.find((font) => font.state === "ready" || font.state === "awakening");
      if (recovery && recovery.id?.includes("resonance")) grantProgressShot(recovery, true);
      else if (recovery) useRecoveryFont(recovery, true);
      return;
    }
    const idleFor = state.t - state.progressionWatch.since;
    if (idleFor > 24 && state.progressionWatch.hintTier < 1 && report.remainingRequiredObjects.length) {
      state.progressionWatch.hintTier = 1;
      toast("The marked brass is still waiting", player.x, player.y - 24, "#ffcf6b");
    } else if (idleFor > 45 && state.progressionWatch.hintTier < 2 && report.remainingRequiredObjects.length) {
      state.progressionWatch.hintTier = 2;
      setHint(roomObjectiveText(def));
    }
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
    const def = VG.ROOMS[state.roomId];
    (def.bells || []).forEach((b, i) => {
      if (VG.dist(bx, by, b.gx * T + 8, b.gy * T + 8) < 24) {
        if (def.bellSequence) {
          if (def.persistClear && !encounterCleared(def)) {
            toast("The wardens swallow the note", bx, by - 14, "#8a9ac0");
            return;
          }
          if (sequenceComplete(def)) return;
          const key = sequenceKey(def.id);
          const progress = sequenceProgress(def.id);
          if (i === def.bellSequence[progress]) {
            state.flags[key] = progress + 1;
            const done = sequenceComplete(def);
            toast(done ? "THE CHORD IS WHOLE" : `RESONANCE ${progress + 1} / ${def.bellSequence.length}`, bx, by - 14, done ? "#fff0c2" : "#ffcf6b");
            if (done) banner("THE BRONZE CHORD OPENS THE WAY");
          } else {
            state.flags[key] = i === def.bellSequence[0] ? 1 : 0;
            toast("THE CHORD BREAKS — BEGIN AGAIN", bx, by - 14, "#ff8095");
          }
          refreshRoomObjective();
          saveGame();
          return;
        }
        const key = `bell_${state.roomId}_${i}`;
        if (!state.flags[key]) {
          state.flags[key] = true;
          toast("A BELL WAKES", bx, by - 14, "#ffcf6b");
          refreshRoomObjective();
          saveGame();
        }
      }
    });
  }
  function bellsRung(roomId) {
    const def = VG.ROOMS[roomId];
    return (def.bells || []).filter((b, i) => state.flags[`bell_${roomId}_${i}`]).length;
  }
  function activateMirrorRelay(def, relay) {
    const key = relayFlag(def.id, relay.id);
    if (state.flags[key]) return false;
    const rx = relay.gx * T + 8, ry = relay.gy * T + 8;
    if (def.persistClear && !encounterCleared(def)) {
      toast("The moving Choir scatters the memory", rx, ry - 14, "#8a9ac0");
      return false;
    }
    state.flags[key] = true;
    const lit = relaysLit(def);
    toast(`REFLECTION ${lit} / ${def.mirrorRelays.length}`, rx, ry - 14, "#8fe9ff");
    VG.sfxBell(230 + lit * 28, 0.14);
    spawnParticles(rx, ry, "#c9d6e8", 14, 80);
    if (lit >= def.mirrorRelays.length) {
      state.flags[`relays_${def.id}_done`] = true;
      for (const font of recoveryFonts) font.state = "dimmed";
      banner("THREE MEMORIES — ONE OPEN ROAD");
    }
    refreshRoomObjective();
    saveGame();
    return true;
  }

  /* ================= enemies ================= */
  function makeEnemy(def) {
    const base = {
      x: def.x * T + 8, y: def.y * T + 8, vx: 0, vy: 0, kx: 0, ky: 0, hp: 14, maxHp: 14, r: 7,
      type: def.type, tag: def.tag, elite: !!def.elite, cd: 1 + Math.random(), hurt: 0, dead: false,
      homeX: def.x * T + 8, homeY: def.y * T + 8, wanderT: 0, wx: 0, wy: 0, facing: 0,
      confuseT: 0, investigateX: null, investigateY: null, _key: "e" + Math.random(),
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
    e.confuseT = Math.max(0, (e.confuseT || 0) - dt);
    const knockSpeed = Math.hypot(e.kx || 0, e.ky || 0);
    const staggered = knockSpeed > 34;
    if (knockSpeed > 0.5) {
      e.vx = e.kx; e.vy = e.ky;
      moveBody(e, dt);
      const decay = Math.exp(-10 * dt);
      e.kx *= decay; e.ky *= decay;
      if (Math.abs(e.kx) < 1) e.kx = 0;
      if (Math.abs(e.ky) < 1) e.ky = 0;
    }
    const confused = (e.confuseT || 0) > 0;
    let dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy) || 1;
    if (confused && Number.isFinite(e.investigateX) && Number.isFinite(e.investigateY)) {
      dx = e.investigateX - e.x;
      dy = e.investigateY - e.y;
      d = Math.hypot(dx, dy) || 1;
    }
    e.facing = Math.atan2(dy, dx);
    if (staggered) {
      e.vx = 0; e.vy = 0;
    } else if (e.type === "wolf") {
      e.lungeT = Math.max(0, e.lungeT - dt);
      if (d < 100) {
        const sp = e.lungeT > 0 ? 124 : 52;
        e.vx = dx / d * sp; e.vy = dy / d * sp;
        e.cd -= dt;
        if (e.cd <= 0 && d < 60) { e.cd = 1.9; e.lungeT = 0.28; VG.sfx(180, 0.06, "sawtooth", 0.04); }
      } else {
        e.wanderT -= dt;
        if (e.wanderT <= 0) { e.wanderT = 1.4 + Math.random() * 1.6; const a = Math.random() * Math.PI * 2; e.wx = Math.cos(a) * 26; e.wy = Math.sin(a) * 26; }
        e.vx = e.wx * 0.8; e.vy = e.wy * 0.8;
        if (VG.dist(e.x, e.y, e.homeX, e.homeY) > 90) { e.vx = (e.homeX - e.x) * 0.6; e.vy = (e.homeY - e.y) * 0.6; }
      }
      moveBody(e, dt);
    } else if (e.type === "guard") {
      if (confused) {
        if (d > 18) { e.vx = dx / d * 18; e.vy = dy / d * 18; }
        else { e.vx *= 0.45; e.vy *= 0.45; }
        moveBody(e, dt);
        return;
      }
      if (d < 150 && d > 29) { e.vx = dx / d * 28; e.vy = dy / d * 28; }
      else { e.vx *= 0.8; e.vy *= 0.8; }
      moveBody(e, dt);
      e.cd -= dt;
      if (d < 150 && e.cd <= 0 && lineClear(e, player)) { e.cd = 2.1; shootBolt(e.x, e.y, dx / d, dy / d, 142, 1); }
    } else if (e.type === "leech") {
      const g = portals.gates.find((gg) => gg.active);
      if (g) {
        const gdx = g.x - e.x, gdy = g.y - e.y, gd = Math.hypot(gdx, gdy) || 1;
        e.vx = gdx / gd * 36; e.vy = gdy / gd * 36; moveBody(e, dt);
        if (gd < 14) portals.addStrain(0.10 * dt);
      } else {
        e.wanderT -= dt;
        if (e.wanderT <= 0) { e.wanderT = 2; const a = Math.random() * Math.PI * 2; e.wx = Math.cos(a) * 18; e.wy = Math.sin(a) * 18; }
        e.vx = e.wx; e.vy = e.wy; moveBody(e, dt);
      }
    } else if (e.type === "mourner") {
      const speed = 22 + e.enrage * 8 + (e.elite ? 6 : 0);
      e.vx = dx / d * speed; e.vy = dy / d * speed + Math.sin(state.t * 2 + e.homeX) * 6; moveBody(e, dt);
      e.blinkT -= dt * (1 + e.enrage * 0.4);
      if (e.blinkT <= 0) {
        e.blinkT = 2.4 + Math.random();
        const mx = state.room.pxW - e.x;    // blink across the mirror axis
        if (!blocked(mx, e.y)) { spawnParticles(e.x, e.y, "#c9d6e8", 5); e.x = mx; spawnParticles(e.x, e.y, "#c9d6e8", 5); }
      }
      e.cd -= dt;
      const boltCd = (e.elite ? 1.75 : 2.3) / (1 + e.enrage * 0.28);
      if (d < 190 && e.cd <= 0) { e.cd = boltCd; shootBolt(e.x, e.y, dx / d, dy / d, 122, 1, "#c9d6e8"); }
    }
    const enemyTeleported = portals.tryTeleport(e, e._key, { strain: 0.04 });
    if (enemyTeleported && e.type === "guard") confuseShieldGuard(e, e.x, e.y, 3.0);
    const contact = separateBodies(player, e, 3);
    if (contact) {
      if (player.shieldT > 0) {
        e.kx -= contact.nx * 280; e.ky -= contact.ny * 280;
        spawnParticles(e.x, e.y, "#8fe9ff", 4, 45);
      } else if (player.iframe <= 0) {
        hurtPlayer(1, contact.nx, contact.ny);
        e.kx -= contact.nx * 120; e.ky -= contact.ny * 120;
      }
    }
  }
  function lineClear(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy), steps = Math.ceil(dist / 6);
    for (let i = 1; i < steps; i++) { const t2 = i / steps; if (solidShot(a.x + dx * t2, a.y + dy * t2)) return false; }
    return true;
  }

  /* ================= Bellmother ================= */
  function makeBoss(def) {
    return {
      x: def.x * T, y: def.y * T, hp: 220, maxHp: 220, r: 22,
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
      b.ringCd = b.phase === 3 ? 1.85 : b.phase === 2 ? 2.45 : 3.1;
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
    const contact = separateBodies(player, b, 5, 0.86);
    if (contact && player.iframe <= 0 && player.shieldT <= 0) hurtPlayer(1, contact.nx, contact.ny);
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
        "MAREN — “One lesson before the road. My old cache has no door. Put one gate on the brass hearthstone and the other on the inner stone seam. A bearer should never leave home empty-handed.”",
        "MAREN — “The Vale is south. The village needs more from you than I ever gave it. Go.”",
      ],
      end() {
        state.flags.hasHand = true;
        state.quests.q_hand = "done";
        acceptQuest("q_wolves");
        banner("THE VESPER HAND — OPEN MAREN'S SEALED CACHE");
        setHint("Portal lesson: right-click the brass hearthstone, then the inner stone seam to reach Maren's cache.");
        VG.sfxBell(200, 0.16);
        spawnParticles(player.x, player.y, "#8fe9ff", 16, 80);
        saveGame();
      },
    },
    bronze_restoration: {
      pages: [
        "The memory bell is smaller than the Bellmother's heart, small enough to carry in two hands.",
        "When you touch it, every brass wall in the Hollow Geometry answers from far behind you. The stolen note has found a road home.",
        "MAREN'S VOICE, REMEMBERED — “A bell is not its metal. It is the promise that someone will answer.”",
        "The south gate opens. Above, Duskhollow's silent bell begins to move.",
      ],
      end() {
        if (!state.flags.bronzeRestored) {
          state.flags.bronzeRestored = true;
          state.flags.bellRestored = true;
          player.vesperSouls += 12;
          checkSoulTiers();
          completeQuest("q_bell");
          state.score += 500;
        }
        banner("THE VILLAGE VOICE IS HOME");
        refreshRoomObjective();
        saveGame();
      },
    },
    glass_restoration: {
      pages: [
        "The font holds every face the lake was forced to remember: mourners, bearers, and the village staring down into borrowed grief.",
        "You lower the Vesper Hand. The Choir's last note passes through you, through the gate, and upward into open water.",
        "The reflections separate. For the first time in a year, Lake Saint-Glass shows only the sky above it.",
        "A white-gold stair forms in the water. The road home is no longer the road you entered by.",
      ],
      end() {
        if (!state.flags.glassRestored) {
          state.flags.glassRestored = true;
          player.vesperSouls += 15;
          checkSoulTiers();
          completeQuest("q_glass");
          state.score += 500;
        }
        banner("THE LAKE REMEMBERS THE SKY");
        refreshRoomObjective();
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
  function nearbySanctum() {
    const sanctum = VG.ROOMS[state.roomId]?.sanctum;
    if (!sanctum) return null;
    const x = sanctum.gx * T + 8, y = sanctum.gy * T + 8;
    return VG.dist(player.x, player.y, x, y) < 24 ? { ...sanctum, x, y } : null;
  }
  function nearbyMandatoryBell() {
    const def = VG.ROOMS[state.roomId];
    if (!def || !(def.bells || []).length || liveThreatCount() > 0) return null;
    for (let i = 0; i < def.bells.length; i++) {
      const bell = def.bells[i];
      const x = bell.gx * T + 8, y = bell.gy * T + 8;
      const already = def.bellSequence ? sequenceComplete(def) : state.flags[`bell_${def.id}_${i}`];
      if (!already && VG.dist(player.x, player.y, x, y) < 26) return { ...bell, index: i, x, y };
    }
    return null;
  }
  function useSanctum(sanctum) {
    if (!sanctum) return false;
    if (sanctum.completeFlag && state.flags[sanctum.completeFlag]) {
      toast("The memory is home", sanctum.x, sanctum.y - 18, "#fff0c2");
      return true;
    }
    if (sanctum.requiresFlag && !state.flags[sanctum.requiresFlag]) {
      toast("The memory will not answer yet", sanctum.x, sanctum.y - 18, "#8a9ac0");
      return true;
    }
    startScene(sanctum.scene);
    return true;
  }
  function tryInteract() {
    const sanctum = nearbySanctum();
    if (sanctum && useSanctum(sanctum)) return;
    const font = recoveryFonts.find((f) => VG.dist(player.x, player.y, f.x, f.y) < (f.radius || 16) + 4);
    if (font && useRecoveryFont(font)) return;
    const resonance = resonanceFonts.find((f) => VG.dist(player.x, player.y, f.x, f.y) < (f.radius || 16) + 4);
    if (resonance && grantProgressShot(resonance)) return;
    const bell = nearbyMandatoryBell();
    if (bell) { ringBell(bell.x, bell.y); return; }
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
  function cycleAppearance(cat, dir) {
    const inCat = D.COSMETICS.filter((c) => c.cat === cat && player.cosmetics.owned.includes(c.id));
    if (!inCat.length) return;
    const options = [null, ...inCat.map((c) => c.id)];
    const idx = options.indexOf(player.cosmetics.equipped[cat]);
    const next = (idx + dir + options.length) % options.length;
    player.cosmetics.equipped[cat] = options[next];
    VG.sfx(560, 0.05, "triangle", 0.04);
    saveGame();
  }

  /* ================= save ================= */
  function saveGame() {
    const checkpoint = state.checkpoint && VG.ROOMS[state.checkpoint.roomId]
      ? state.checkpoint
      : { roomId: state.roomId, spawn: copySpawn(VG.ROOMS[state.roomId]?.spawn) };
    VG.save.write({
      balanceVersion: BALANCE_VERSION,
      roomId: checkpoint.roomId,
      checkpoint: { roomId: checkpoint.roomId, spawn: copySpawn(checkpoint.spawn) },
      hp: player.hp, maxHp: player.maxHp,
      embers: player.embers, vesperSouls: player.vesperSouls, relics: player.relics, equipped: player.equipped,
      materials: player.materials, quests: state.quests, flags: state.flags,
      shopBought: state.shopBought, score: state.score, kills: state.kills,
      bestCombo: state.bestCombo, dawn: state.dawn, dawnTransition: state.dawnTransition,
      vesperHearts: state.vesperHearts, soulTiers: state.soulTiers,
      bonusMeleeDmg: player.bonusMeleeDmg, bonusStrikeCdMul: player.bonusStrikeCdMul,
      bonusBeamDmg: player.bonusBeamDmg, bonusReach: player.bonusReach, bonusMagnetMul: player.bonusMagnetMul,
      cosmetics: player.cosmetics,
      mastery: state.mastery, discovered: state.discovered, playSeconds: Math.round(state.playSeconds),
    });
  }
  function restoreSave(s) {
    player.hp = s.hp ?? 4; player.maxHp = s.maxHp ?? 4;
    if ((s.balanceVersion || 0) < BALANCE_VERSION && player.maxHp < 5) {
      player.maxHp = 5;
      player.hp = Math.min(player.maxHp, player.hp + 1);
    }
    player.embers = s.embers ?? 0; player.vesperSouls = s.vesperSouls ?? 0;
    player.relics = s.relics || {}; player.equipped = s.equipped || [];
    player.materials = s.materials || { wolfshard: 0, glassshard: 0 };
    state.quests = Object.assign(state.quests, s.quests || {});
    repairQuestDirectionFromSave();
    state.flags = s.flags || {};
    if (state.flags.bellRestored) {
      state.flags.hasVesperShield = true;
      state.flags.bellmotherSilenced = true;
    }
    if (state.quests.q_glass === "done") state.flags.glassDone = true;
    if (!state.flags.cosmeticOrder) state.flags.cosmeticOrder = shuffledCosmeticOrder();
    state.shopBought = s.shopBought || {};
    state.score = s.score || 0; state.kills = s.kills || 0;
    state.bestCombo = s.bestCombo || 0;
    state.dawn = s.dawn || 0; state.dawnTransition = !!s.dawnTransition;
    state.vesperHearts = s.vesperHearts || 0; state.soulTiers = s.soulTiers || {};
    player.bonusMeleeDmg = s.bonusMeleeDmg || 0; player.bonusStrikeCdMul = s.bonusStrikeCdMul ?? 1;
    player.bonusBeamDmg = s.bonusBeamDmg || 0; player.bonusReach = s.bonusReach || 0; player.bonusMagnetMul = s.bonusMagnetMul ?? 1;
    player.cosmetics = s.cosmetics || { owned: [], equipped: { cloak: null, glow: null, accessory: null, trail: null } };
    state.mastery = Object.assign({ portalCrossings: 0, foldshots: 0, perfectRooms: 0 }, s.mastery || {});
    state.discovered = s.discovered || {};
    state.playSeconds = Number(s.playSeconds) || 0;
    const savedCheckpoint = s.checkpoint && VG.ROOMS[s.checkpoint.roomId]
      ? s.checkpoint
      : { roomId: VG.ROOMS[s.roomId] ? s.roomId : "maren", spawn: null };
    state.checkpoint = {
      roomId: savedCheckpoint.roomId,
      spawn: copySpawn(savedCheckpoint.spawn) || copySpawn(VG.ROOMS[savedCheckpoint.roomId].spawn),
    };
  }

  /* ================= room loading ================= */
  function loadRoom(id, spawn) {
    const def = VG.ROOMS[id];
    state.room = new VG.Room(def);
    state.roomId = id;
    state.discovered[id] = true;
    VG.dread.onRoomEnter(id, (VG.BIOMES[def.biome] || {}).warm !== false);
    wrongVisitRoomId = (VG.dread.consumeBacktrack() && Math.random() < 0.45) ? id : null;
    VG.camera.setRoom(state.room.pxW, state.room.pxH);
    shots = []; bolts = []; rings = []; particles = []; floatText = []; recoveryFonts = []; resonanceFonts = [];
    player.progressShots = 0;
    const persistentClear = def.persistClear && encounterCleared(def);
    enemies = (def.enemies || [])
      .filter((e) => !(e.tag === "q_wolves" && state.quests.q_wolves === "done"))
      .filter((e) => !(e.tag === "choir" && state.flags.glassDone))
      .filter(() => !persistentClear)
      .filter(() => !(def.wholenessRecovery?.clearsRoomEnemies && recoveryAwakened(def) && recoveryStillNeeded(def)))
      .map(makeEnemy);
    pickups = (def.pickups || [])
      .filter((p) => !(p.type === "quest" && (state.flags[p.id] || state.quests.q_lantern === "done")))
      .filter((p) => !state.flags["got_" + id + "_" + p.x + "_" + p.y] || p.type === "quest")
      .map((p) => ({ x: p.x * T + 8, y: p.y * T + 8, type: p.type, id: p.id, slot: p.slot, value: p.value ?? 1, defKey: "got_" + id + "_" + p.x + "_" + p.y, bob: Math.random() * 6 }));
    boss = def.boss && !(def.bossClearFlag && state.flags[def.bossClearFlag]) ? makeBoss(def.boss) : null;
    const recoveryFont = buildRecoveryFont(def);
    if (recoveryFont) recoveryFonts.push(recoveryFont);
    const resonanceFont = buildResonanceFont(def);
    if (resonanceFont) resonanceFonts.push(resonanceFont);
    loadNpcs(def);
    portals.reset();
    const sp = spawn || def.spawn;
    player.x = sp.x * T + 8; player.y = sp.y * T + 8;
    player.vx = 0; player.vy = 0; player.kx = 0; player.ky = 0; player.dead = false; player.shieldT = 0;
    VG.camera.snapTo(player.x, player.y);
    state.roomFade = 1;
    if (wrongVisitRoomId === id) {
      spawnParticles(player.x, player.y - 6, "#c9d6e8", 5, 20);
      VG.sfxBell(83, 0.05);
    }
    VG.setMusicState(musicStateForRoom(def, !!boss));
    banner(def.name.toUpperCase());
    refreshRoomObjective();
    saveGame();
  }
  function setHint(text) { const h = $("[data-vg-hint]"); if (h) { h.textContent = text; h.hidden = !text; } }
  function checkExits() {
    const def = VG.ROOMS[state.roomId];
    for (const ex of (def.exits || [])) {
      const ex0 = ex.gx * T, ey0 = ex.gy * T;
      if (player.x > ex0 - 5 && player.x < ex0 + T + 5 && player.y > ey0 - 5 && player.y < ey0 + T + 5) {
        const locked = exitLockReason(ex, def);
        if (locked) {
          toast(locked, player.x, player.y - 18, "#ffcf6b");
          const cx = state.room.pxW / 2, cy = state.room.pxH / 2;
          const dx = cx - player.x, dy = cy - player.y, len = Math.hypot(dx, dy) || 1;
          player.x += dx / len * 5; player.y += dy / len * 5;
          return;
        }
        setCheckpoint(ex.to, ex.toSpawn);
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
    const touch = VG.input.touchMove;
    const left = VG.input.keys.has("KeyA") || VG.input.keys.has("ArrowLeft") || (pad && pad.lx < -0.3);
    const right = VG.input.keys.has("KeyD") || VG.input.keys.has("ArrowRight") || (pad && pad.lx > 0.3);
    const up = VG.input.keys.has("KeyW") || VG.input.keys.has("ArrowUp") || (pad && pad.ly < -0.3);
    const down = VG.input.keys.has("KeyS") || VG.input.keys.has("ArrowDown") || (pad && pad.ly > 0.3);
    let mx = touch.active ? touch.x : (right ? 1 : 0) - (left ? 1 : 0);
    let my = touch.active ? touch.y : (down ? 1 : 0) - (up ? 1 : 0);
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
    const speed = 92 * (relicOn("swiftsoles") ? 1.12 : 1) * (VG.settings.speedMul || 1);
    if (player.rollT > 0) {
      player.rollT -= dt;
      player.vx = player.rollDir.x * 195; player.vy = player.rollDir.y * 195;
    } else {
      player.vx = mx * speed + player.kx; player.vy = my * speed + player.ky;
    }
    const playerKnockDecay = Math.exp(-12 * dt);
    player.kx *= playerKnockDecay; player.ky *= playerKnockDecay;
    // teleport BEFORE collision so inward velocity survives (the order bug fix)
    const tp = portals.tryTeleport(player, "player", { strain: 0.05 });
    if (tp === "critical") doCollapse();
    else if (tp) { VG.camera.jolt(0.1); recordMastery("portalCrossings"); }
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
    const rightAction = pressed.has("M2") || (pad && pad.gate && !player._gateHeld);
    if (state.flags.hasVesperShield && rightAction) activateVesperShield();
    if (pressed.has("KeyG") || (!state.flags.hasVesperShield && rightAction)) { updateGatePreview(); placeGate(); }
    player._gateHeld = pad && pad.gate;
    if (pressed.has("KeyQ") || pressed.has("PadLB")) portals.selected = 1 - portals.selected;
    if (pressed.has("KeyR") || pressed.has("PadY")) portals.vent();
    if (pressed.has("KeyE") || pressed.has("PadA")) tryInteract();
    if (pressed.has("Tab") || pressed.has("KeyI") || pressed.has("PadBack")) { state.phase = "inventory"; }
    if (pressed.has("Space")) useVesperSense();
    if (pressed.has("KeyM") || pressed.has("PadRB")) { state.phase = "map"; }

    state.focusCd = Math.max(0, state.focusCd - dt);
    state.focusT = Math.max(0, state.focusT - dt);
    state.playSeconds += dt;
    state.autosaveT += dt;
    if (state.autosaveT >= 20) { state.autosaveT = 0; saveGame(); }

    player.strikeCd = Math.max(0, player.strikeCd - dt);
    player.strikeT = Math.max(0, player.strikeT - dt);
    player.boltCd = Math.max(0, player.boltCd - dt);
    beamFailCooldown = Math.max(0, beamFailCooldown - dt);
    player.iframe = Math.max(0, player.iframe - dt);
    player.shieldT = Math.max(0, player.shieldT - dt);
    player.shieldCd = Math.max(0, player.shieldCd - dt);
    player.shieldWarnCd = Math.max(0, player.shieldWarnCd - dt);

    updateGatePreview();

    /* player shots */
    for (const sh of shots) {
      sh.life -= dt;
      const px = sh.x, py = sh.y;
      sh.x += sh.vx * dt; sh.y += sh.vy * dt;
      const tpz = portals.tryTeleport(sh, sh.key, { strain: 0.03 });
      if (tpz) {
        if (!sh.foldshot) recordMastery("foldshots");
        sh.foldshot = true; sh.dmg *= 1.25; sh.pierce += 1; spawnParticles(sh.x, sh.y, "#8fe9ff", 3);
      }
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
          state.flags[sigilFlag(state.roomId)] = true;
          for (const font of recoveryFonts) font.state = "dimmed";
          banner("THE SIGIL ANSWERS");
          VG.sfxBell(260, 0.18); spawnParticles(sh.x, sh.y, "#8fe9ff", 14, 90);
          refreshRoomObjective();
          saveGame();
        }
      }
      if ((def.mirrorRelays || []).length && (sh._bounces > 0 || sh.foldshot)) {
        for (const relay of def.mirrorRelays) {
          const key = relayFlag(def.id, relay.id);
          if (state.flags[key]) continue;
          const rx = relay.gx * T + 8, ry = relay.gy * T + 8;
          if (VG.dist(sh.x, sh.y, rx, ry) >= 16) continue;
          activateMirrorRelay(def, relay);
          break;
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
      if (!b.hostileToEnemies && player.shieldT > 0 && VG.dist(b.x, b.y, player.x, player.y) < player.r + b.r + 20) {
        reflectWithVesperShield(b);
        continue;
      }
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
      if (rg.hostile && player.shieldT > 0 && Math.abs(pd - rg.r) < 10) {
        rg.hostile = false; rg.x = player.x; rg.y = player.y; rg.r = 8; rg.vr = 170; rg.life = 0.7;
        spawnParticles(player.x, player.y, "#8fe9ff", 6, 55);
      } else if (rg.hostile && Math.abs(pd - rg.r) < 6 && player.iframe <= 0) {
        hurtPlayer(rg.dmg, Math.sign(player.x - rg.x) * 0.5, Math.sign(player.y - rg.y) * 0.5);
      }
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
    updateRecoveryFonts(dt);
    updateResonanceFonts(dt);
    ensureProgressionSafety(dt);

    /* pickups (embers/souls magnet to player) */
    for (const p of pickups) {
      p.bob += dt;
      if (p.type === "ember" || p.type === "soul" || p.type === "heart") {
        p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
        p.vx = (p.vx || 0) * 0.9; p.vy = (p.vy || 0) * 0.9;
        const magnetR = 30 * player.bonusMagnetMul;
        const d = VG.dist(p.x, p.y, player.x, player.y);
        if (d < magnetR) { p.x += (player.x - p.x) * dt * 8; p.y += (player.y - p.y) * dt * 8; }
        if (d < 10) {
          if (p.type === "heart" && player.hp >= player.maxHp) continue;
          p.dead = true;
          if (p.type === "ember") { player.embers += p.value; VG.sfx(760, 0.04, "triangle", 0.03); }
          else if (p.type === "soul") {
            player.vesperSouls += Math.round(p.value * (relicOn("embercharm") ? 1.25 : 1));
            VG.sfx(820, 0.04, "sine", 0.03);
            checkSoulTiers();
          } else {
            player.hp = Math.min(player.maxHp, player.hp + 1);
            toast("+1 heart", player.x, player.y - 16, "#ff9ad0");
            VG.sfx(660, 0.08, "triangle", 0.04);
          }
          if (p.defKey) { state.flags[p.defKey] = true; saveGame(); }
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
    const def2 = VG.ROOMS[state.roomId];
    VG.setMusicState(musicStateForRoom(def2, !!(boss && !boss.dead)));
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
    sky.addColorStop(0, "#17152c"); sky.addColorStop(0.58, "#0a0818"); sky.addColorStop(1, "#030208");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, VG.W, VG.H);

    // Illustrated board glimpse: the same visual language as the playable
    // world, not a generic menu background.
    const moonX = 504, moonY = 72;
    ctx.fillStyle = "rgba(255,226,176,0.10)";
    ctx.beginPath(); ctx.arc(moonX, moonY, 58, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,238,210,0.16)";
    ctx.beginPath(); ctx.arc(moonX, moonY, 38, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,245,218,0.22)";
    ctx.beginPath(); ctx.arc(moonX - 8, moonY - 7, 25, 0, Math.PI * 2); ctx.fill();

    for (let y = 118; y < 340; y += 23) {
      for (let x = 250; x < 640; x += 32) {
        const k = ((x * 17 + y * 31) % 37) / 37;
        ctx.fillStyle = k > 0.5 ? "rgba(54,61,78,0.34)" : "rgba(33,37,55,0.44)";
        ctx.fillRect(x, y, 31, 22);
        ctx.strokeStyle = "rgba(231,129,66,0.12)";
        ctx.strokeRect(x + 0.5, y + 0.5, 30, 21);
        if ((x + y) % 5 === 0) {
          ctx.strokeStyle = "rgba(255,190,110,0.10)";
          ctx.beginPath(); ctx.moveTo(x + 6, y + 16); ctx.quadraticCurveTo(x + 14, y + 7, x + 23, y + 14); ctx.stroke();
        }
      }
    }
    ctx.fillStyle = "#070711";
    ctx.fillRect(0, 276, VG.W, 84);
    ctx.fillStyle = "#0f0c17";
    for (let i = 0; i < 8; i++) {
      const x = 348 + i * 34, h = 25 + ((i * 17) % 50);
      ctx.fillRect(x, 276 - h, 25, h);
      ctx.beginPath(); ctx.moveTo(x - 4, 276 - h); ctx.lineTo(x + 12, 254 - h); ctx.lineTo(x + 29, 276 - h); ctx.fill();
    }
    ctx.fillStyle = "#17101b";
    ctx.fillRect(470, 134, 42, 142);
    ctx.beginPath(); ctx.moveTo(462, 134); ctx.lineTo(491, 88); ctx.lineTo(520, 134); ctx.fill();
    ctx.strokeStyle = "rgba(255,183,93,0.28)";
    ctx.strokeRect(474.5, 139.5, 34, 132);
    ctx.fillStyle = "rgba(255,194,96,0.28)"; ctx.fillRect(484, 148, 10, 15);

    const hearth = ctx.createRadialGradient(556, 194, 4, 556, 194, 66);
    hearth.addColorStop(0, "rgba(255,210,112,0.55)");
    hearth.addColorStop(0.34, "rgba(244,102,53,0.26)");
    hearth.addColorStop(1, "rgba(244,102,53,0)");
    ctx.fillStyle = hearth; ctx.fillRect(490, 128, 132, 132);
    ctx.fillStyle = "rgba(255,195,95,0.75)";
    ctx.beginPath(); ctx.moveTo(556, 178); ctx.quadraticCurveTo(568, 194, 556, 213); ctx.quadraticCurveTo(544, 196, 556, 178); ctx.fill();

    const pulse = 0.72 + Math.sin(state.t * 1.8) * 0.18;
    const gates = [
      { x: 414, y: 236, color: `rgba(143,233,255,${pulse})`, lean: -0.18 },
      { x: 592, y: 226, color: `rgba(216,139,200,${pulse * 0.92})`, lean: 0.2 },
    ];
    for (const gate of gates) {
      ctx.save(); ctx.translate(gate.x, gate.y); ctx.rotate(gate.lean);
      ctx.shadowColor = gate.color; ctx.shadowBlur = 18;
      ctx.strokeStyle = gate.color; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 34, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.3; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(0, 0, 5, 29, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.75; ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2 + state.t;
        ctx.beginPath(); ctx.arc(Math.cos(a) * 8, Math.sin(a) * 31, 1.1, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    ctx.fillStyle = "rgba(12,8,20,0.92)";
    ctx.beginPath(); ctx.moveTo(0, 360); ctx.lineTo(0, 286);
    for (let i = 0; i < 12; i++) {
      const x = i * 58;
      ctx.quadraticCurveTo(x + 18, 272 + Math.sin(i) * 12, x + 58, 292 + Math.cos(i) * 10);
    }
    ctx.lineTo(640, 360); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(42,76,63,0.44)";
    for (let i = 0; i < 15; i++) {
      const x = (i * 47 + 8) % 640, y = 306 + (i * 19) % 46;
      ctx.beginPath(); ctx.ellipse(x, y, 16, 5, -0.6 + i * 0.12, 0, Math.PI * 2); ctx.fill();
    }

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#f1c27e";
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
  function drawRecoveryFont(font) {
    const ready = font.state === "ready" || font.state === "healing" || font.state === "awakening";
    const dim = font.state === "dimmed";
    const pulse = 0.5 + Math.sin(state.t * (ready ? 5.2 : 2.1)) * 0.5;
    shadow(font.x, font.y + 4, 11);
    if (ready) {
      const g = ctx.createRadialGradient(font.x, font.y, 2, font.x, font.y, 34 + pulse * 8);
      g.addColorStop(0, `rgba(255,240,194,${0.22 + pulse * 0.1})`);
      g.addColorStop(0.45, "rgba(201,214,232,0.10)");
      g.addColorStop(1, "rgba(201,214,232,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(font.x, font.y, 40, 0, Math.PI * 2); ctx.fill();
    }
    glow(ready ? "rgba(255,240,194,0.75)" : "rgba(143,233,255,0.25)", ready ? 12 : 4, () => {
      ctx.fillStyle = dim ? "rgba(80,84,108,0.55)" : "#d8e7ff";
      ctx.beginPath(); ctx.ellipse(font.x, font.y + 5, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = ready ? "#fff0c2" : "rgba(143,233,255,0.42)";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(font.x, font.y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(font.x - 6, font.y); ctx.lineTo(font.x + 6, font.y);
      ctx.moveTo(font.x, font.y - 6); ctx.lineTo(font.x, font.y + 6);
      ctx.stroke();
      if (font.state === "healing") {
        ctx.strokeStyle = "#fff8db";
        ctx.beginPath(); ctx.arc(font.x, font.y, 13 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
      }
    });
  }
  function drawResonanceFont(font) {
    const ready = font.state === "ready" || font.state === "charging" || font.state === "awakening";
    const dim = font.state === "dimmed";
    const pulse = 0.5 + Math.sin(state.t * (ready ? 5.8 : 2.4)) * 0.5;
    shadow(font.x, font.y + 4, 10);
    if (ready) {
      const g = ctx.createRadialGradient(font.x, font.y, 2, font.x, font.y, 32 + pulse * 8);
      g.addColorStop(0, `rgba(255,207,107,${0.22 + pulse * 0.12})`);
      g.addColorStop(0.46, "rgba(255,207,107,0.10)");
      g.addColorStop(1, "rgba(255,207,107,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(font.x, font.y, 38, 0, Math.PI * 2); ctx.fill();
    }
    glow(ready ? "rgba(255,207,107,0.78)" : "rgba(255,207,107,0.22)", ready ? 13 : 4, () => {
      ctx.fillStyle = dim ? "rgba(92,78,56,0.55)" : "#d6a94a";
      ctx.beginPath(); ctx.ellipse(font.x, font.y + 5, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = ready ? "#fff0c2" : "rgba(255,207,107,0.45)";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(font.x, font.y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(font.x - 5, font.y - 3); ctx.quadraticCurveTo(font.x, font.y - 8, font.x + 5, font.y - 3);
      ctx.moveTo(font.x - 6, font.y + 2); ctx.lineTo(font.x + 6, font.y + 2);
      ctx.stroke();
      if (font.state === "charging") {
        ctx.strokeStyle = "#fff8db";
        ctx.beginPath(); ctx.arc(font.x, font.y, 13 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
      }
    });
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
    const indoors = biome === "interior";
    const night = (1 - dawn) * (indoors ? 0.22 : 0.36);
    const r = Math.round((indoors ? 20 : 8) + dawn * 60);
    const g = Math.round((indoors ? 12 : 10) + dawn * 44);
    const b = Math.round((indoors ? 24 : 26) + dawn * 30);
    ctx.fillStyle = `rgba(${r},${g},${b},${night.toFixed(3)})`;
    ctx.fillRect(VG.camera.x, VG.camera.y, VG.W, VG.H);
    if (indoors) {
      const warm = ctx.createRadialGradient(player.x, player.y - 34, 6, player.x, player.y - 34, 145);
      warm.addColorStop(0, "rgba(255,175,88,0.13)");
      warm.addColorStop(0.46, "rgba(255,132,72,0.055)");
      warm.addColorStop(1, "rgba(255,132,72,0)");
      ctx.fillStyle = warm;
      ctx.fillRect(VG.camera.x, VG.camera.y, VG.W, VG.H);
    }
  }
  function drawExitMarkers(def) {
    if (!def || !["dungeon", "ossuary"].includes(def.biome)) return;
    for (const ex of def.exits || []) {
      const x = ex.gx * T + 8, y = ex.gy * T + 8;
      const locked = exitLockReason(ex, def);
      const important = !!(ex.needClear || ex.needBells || ex.needSequence || ex.needSigil || ex.needRelays || ex.needFlag);
      const pulse = 0.65 + Math.sin(state.t * 4 + ex.gx + ex.gy) * 0.2;
      const openColor = def.biome === "ossuary" ? "143,233,255" : "255,207,107";
      const color = locked ? "128,116,104" : openColor;
      const horizontal = ex.gy === 0 || ex.gy === state.room.h - 1;
      ctx.save();
      ctx.shadowColor = `rgba(${color},${locked ? 0.16 : pulse})`;
      ctx.shadowBlur = locked ? 5 : 16;
      ctx.strokeStyle = `rgba(${color},${locked ? 0.42 : 0.88})`;
      ctx.lineWidth = locked ? 1 : 1.8;
      ctx.beginPath();
      ctx.ellipse(x, y, horizontal ? 8 : 4, horizontal ? 4 : 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (!locked) {
        ctx.fillStyle = `rgba(${color},${0.12 + pulse * 0.1})`;
        ctx.beginPath(); ctx.arc(x, y, important ? 11 : 7, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "rgba(8,6,14,0.82)"; ctx.fillRect(x - 3, y - 3, 6, 6);
        ctx.strokeStyle = "rgba(190,170,145,0.62)"; ctx.strokeRect(x - 2.5, y - 2.5, 5, 5);
      }
      const near = VG.dist(player.x, player.y, x, y) < 105;
      if (important || near) {
        const inwardY = ex.gy === 0 ? 50 : ex.gy === state.room.h - 1 ? -34 : 0;
        const inwardX = ex.gx === 0 ? 52 : ex.gx === state.room.w - 1 ? -52 : 0;
        const target = VG.ROOMS[ex.to]?.name || ex.to;
        const label = locked ? locked.toUpperCase() : `OPEN · ${target.toUpperCase()}`;
        ctx.font = "700 5px monospace"; ctx.textAlign = "center";
        const viewW = VG.W / (VG.camera.zoom || 1), viewH = VG.H / (VG.camera.zoom || 1);
        const tx = VG.clamp(x + inwardX, VG.camera.x + 70, VG.camera.x + viewW - 70);
        const ty = VG.clamp(y + inwardY, VG.camera.y + 42, VG.camera.y + viewH - 24);
        ctx.strokeStyle = locked ? "rgba(168,155,140,0.36)" : `rgba(${color},0.52)`;
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty - Math.sign(inwardY || 1) * 7); ctx.stroke();
        const width = Math.min(132, Math.max(42, ctx.measureText(label).width + 10));
        ctx.fillStyle = "rgba(5,4,13,0.82)"; ctx.fillRect(tx - width / 2, ty - 7, width, 10);
        ctx.fillStyle = locked ? "#a89b8c" : (def.biome === "ossuary" ? "#8fe9ff" : "#ffcf6b");
        ctx.fillText(label.length > 31 ? label.slice(0, 30) + "…" : label, tx, ty);
        ctx.textAlign = "left";
      }
      ctx.restore();
    }
  }
  function drawDungeonMechanics(def) {
    for (let i = 0; i < (def.bells || []).length; i++) {
      const bell = def.bells[i], x = bell.gx * T + 8, y = bell.gy * T + 8;
      const normalLit = !!state.flags[`bell_${def.id}_${i}`];
      const order = def.bellSequence ? def.bellSequence.indexOf(i) + 1 : 0;
      const sequenceLit = order > 0 && sequenceProgress(def.id) >= order;
      const lit = normalLit || sequenceLit;
      const needsAttention = liveThreatCount() <= 0 && !lit && ((def.bellSequence && !sequenceComplete(def)) || (!def.bellSequence && bellsRung(def.id) < (def.bells || []).length));
      const bellPulse = 0.45 + Math.sin(state.t * 4.2 + i) * 0.18;
      if (needsAttention) {
        ctx.fillStyle = `rgba(255,207,107,${0.12 + bellPulse * 0.08})`;
        ctx.beginPath(); ctx.arc(x, y, 14 + bellPulse * 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = lit ? "#fff0c2" : needsAttention ? "rgba(255,207,107,0.9)" : "rgba(255,207,107,0.58)";
      ctx.lineWidth = lit ? 2 : 1;
      ctx.beginPath(); ctx.arc(x, y, 9 + Math.sin(state.t * 3 + i) * 1.2, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 5, y + 4);
      ctx.quadraticCurveTo(x, y - 7, x + 5, y + 4);
      ctx.lineTo(x - 5, y + 4);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y + 5, 2, 0, Math.PI * 2); ctx.stroke();
      if (order) {
        ctx.fillStyle = "rgba(5,4,13,0.82)"; ctx.fillRect(x - 5, y - 4, 10, 8);
        ctx.fillStyle = lit ? "#fff0c2" : "#ffcf6b"; ctx.font = "700 6px monospace"; ctx.textAlign = "center";
        ctx.fillText(String(order), x, y + 2); ctx.textAlign = "left";
      }
    }
    for (const relay of def.mirrorRelays || []) {
      const x = relay.gx * T + 8, y = relay.gy * T + 8;
      const lit = !!state.flags[relayFlag(def.id, relay.id)];
      ctx.strokeStyle = lit ? "#8fe9ff" : "rgba(201,214,232,0.68)";
      ctx.lineWidth = lit ? 2 : 1.2;
      ctx.beginPath(); ctx.arc(x, y, 7 + Math.sin(state.t * 3 + y) * 1.2, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.closePath(); ctx.stroke();
      if (lit) { ctx.fillStyle = "rgba(143,233,255,0.24)"; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill(); }
    }
    if (def.sanctum) {
      const x = def.sanctum.gx * T + 8, y = def.sanctum.gy * T + 8;
      const restored = sanctumComplete(def);
      const color = def.biome === "ossuary" ? "143,233,255" : "255,207,107";
      const pulse = 0.55 + Math.sin(state.t * 2.8) * 0.18;
      ctx.fillStyle = `rgba(${color},${restored ? 0.14 : pulse * 0.24})`;
      ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(${color},${restored ? 0.55 : 0.9})`; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = restored ? "#fff0c2" : (def.biome === "ossuary" ? "#8fe9ff" : "#ffcf6b");
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
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
    for (const font of recoveryFonts) drawRecoveryFont(font);
    for (const font of resonanceFonts) drawResonanceFont(font);
    // pickups
    for (const p of pickups) {
      const yy = p.y + Math.sin(p.bob * 2) * 2;
      if (p.type === "ember") {
        glow("rgba(255,184,91,0.65)", 5, () => {
          ctx.fillStyle = "#3b2414"; ctx.fillRect(p.x - 3, yy - 4, 6, 7);
          ctx.fillStyle = "#ffbf69";
          ctx.beginPath(); ctx.moveTo(p.x, yy - 7); ctx.quadraticCurveTo(p.x + 4, yy - 2, p.x, yy + 3); ctx.quadraticCurveTo(p.x - 4, yy - 2, p.x, yy - 7); ctx.fill();
          ctx.fillStyle = "#fff0c2"; ctx.beginPath(); ctx.ellipse(p.x, yy - 1, 1.2, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        });
      } else if (p.type === "soul") {
        glow("rgba(156,143,255,0.68)", 6, () => {
          ctx.fillStyle = "rgba(156,143,255,0.28)"; ctx.beginPath(); ctx.arc(p.x, yy, 5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#b9afff"; ctx.beginPath(); ctx.arc(p.x, yy, 2.4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#fff4d8"; ctx.beginPath(); ctx.arc(p.x + 0.7, yy - 0.9, 0.8, 0, Math.PI * 2); ctx.fill();
        });
      } else if (p.type === "heart") {
        glow("rgba(255,104,132,0.65)", 6, () => {
          ctx.save(); ctx.translate(p.x, yy);
          ctx.fillStyle = "#ff6884";
          ctx.beginPath();
          ctx.moveTo(0, 5); ctx.bezierCurveTo(-8, 0, -5, -6, 0, -3); ctx.bezierCurveTo(5, -6, 8, 0, 0, 5); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.65)"; ctx.fillRect(-2.5, -2.5, 1.5, 1.5);
          ctx.restore();
        });
      } else if (p.type === "quest") {
        shadow(p.x, p.y, 5);
        ctx.fillStyle = "#3a2c1a"; ctx.fillRect(p.x - 4, yy - 7, 8, 10);
        ctx.strokeStyle = "rgba(255,217,143,0.45)"; ctx.strokeRect(p.x - 3.5, yy - 6.5, 7, 9);
        ctx.fillStyle = `rgba(255,200,110,${0.72 + Math.sin(state.t * 4) * 0.22})`; ctx.fillRect(p.x - 2, yy - 5, 4, 6);
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
        glow("rgba(216,139,200,0.65)", 5, () => {
          ctx.fillStyle = "#d88bc8";
          ctx.beginPath(); ctx.arc(p.x, yy, 4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(p.x - 1, yy - 6, 2, 12);
        });
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
    drawVesperSense();
    for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.fillRect(p.x - 1, p.y - 1, 2, 2); ctx.globalAlpha = 1; }
    VG.fx.drawAtmosphere(ctx, VG.camera);
    // dusk light pass
    state.room.drawLight(ctx, VG.camera, state.t, flags);
    applyNightVeil();
    // Progression language is painted after darkness so a newly opened route
    // cannot disappear into the same grading that gives the dungeon its mood.
    drawExitMarkers(def);
    drawDungeonMechanics(def);
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
    const font = state.phase === "playing"
      ? recoveryFonts.find((f) => VG.dist(player.x, player.y, f.x, f.y) < (f.radius || 16) + 4)
      : null;
    if (font && (font.state === "ready" || font.state === "awakening")) {
      ctx.font = "6px monospace"; ctx.textAlign = "center";
      ctx.fillStyle = "rgba(6,5,16,0.82)"; ctx.fillRect(font.x - 38, font.y - 28, 76, 9);
      ctx.fillStyle = player.hp >= player.maxHp ? "#fff0c2" : "#8fe9ff";
      ctx.fillText(player.hp >= player.maxHp ? "E — you are whole" : "E — restore wholeness", font.x, font.y - 21);
      ctx.textAlign = "left";
    }
    const resonance = state.phase === "playing"
      ? resonanceFonts.find((f) => VG.dist(player.x, player.y, f.x, f.y) < (f.radius || 16) + 4)
      : null;
    if (resonance && (resonance.state === "ready" || resonance.state === "awakening")) {
      ctx.font = "6px monospace"; ctx.textAlign = "center";
      ctx.fillStyle = "rgba(6,5,16,0.82)"; ctx.fillRect(resonance.x - 46, resonance.y - 28, 92, 9);
      ctx.fillStyle = player.progressShots > 0 ? "#fff0c2" : "#ffcf6b";
      ctx.fillText(player.progressShots > 0 ? "SPACE — puzzle shot ready" : "E — gather bell shot", resonance.x, resonance.y - 21);
      ctx.textAlign = "left";
    }
    const bell = state.phase === "playing" ? nearbyMandatoryBell() : null;
    if (bell) {
      ctx.font = "6px monospace"; ctx.textAlign = "center";
      ctx.fillStyle = "rgba(6,5,16,0.84)"; ctx.fillRect(bell.x - 34, bell.y - 29, 68, 10);
      ctx.fillStyle = "#ffcf6b";
      ctx.fillText("E — ring bell", bell.x, bell.y - 22);
      ctx.textAlign = "left";
    }
    const sanctum = state.phase === "playing" ? nearbySanctum() : null;
    if (sanctum) {
      ctx.font = "6px monospace"; ctx.textAlign = "center";
      ctx.fillStyle = "rgba(6,5,16,0.84)"; ctx.fillRect(sanctum.x - 42, sanctum.y - 31, 84, 10);
      ctx.fillStyle = state.flags[sanctum.completeFlag] ? "#fff0c2" : "#8fe9ff";
      ctx.fillText(state.flags[sanctum.completeFlag] ? "E — hear the memory" : "E — restore the memory", sanctum.x, sanctum.y - 23);
      ctx.textAlign = "left";
    }
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
    vig.addColorStop(0, "rgba(4,3,10,0)"); vig.addColorStop(1, "rgba(2,1,8,0.40)");
    ctx.fillStyle = vig; ctx.fillRect(0, 0, VG.W, VG.H);
    ctx.fillStyle = "rgba(84,52,132,0.045)";
    ctx.fillRect(0, 0, VG.W, VG.H);
    ctx.fillStyle = "rgba(255,160,74,0.025)";
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
    const trailCos = cosmeticOf("trail");
    ctx.fillStyle = trailCos ? trailCos.color : "#c9c2ff";
    ctx.beginPath(); ctx.ellipse(0, -1, 2.8, 3.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function cosmeticOf(cat) {
    const id = player.cosmetics.equipped[cat];
    return id ? D.COSMETICS.find((c) => c.id === id) : null;
  }
  function drawPlayer() {
    const p = player;
    if (p.shieldT > 0) {
      const pulse = 16 + Math.sin(state.t * 18) * 1.5;
      ctx.fillStyle = "rgba(143,233,255,0.10)";
      ctx.beginPath(); ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(143,233,255,${0.55 + p.shieldT * 0.35})`;
      ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(255,207,107,0.42)"; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(p.x, p.y, pulse - 3, -0.8, 1.8); ctx.stroke();
    }
    if (p.iframe > 0 && Math.floor(state.t * 30) % 2) return;
    for (const tr of p._trail) drawTrailGhost(tr);
    shadow(p.x, p.y, 5.5);
    const fa = Math.atan2(p.fy, p.fx);
    // strikeT counts down from 0.14 -> 0; strikeK is the inverse (1 at swing
    // start), driving a brief forward lunge + squash-stretch punch-through.
    const strikeK = p.strikeT > 0 ? p.strikeT / 0.14 : 0;
    const lunge = strikeK * 2.2;
    const beamReady = state.flags.hasHand && p.hp === p.maxHp;
    const glowCos = cosmeticOf("glow");
    const glowColor = glowCos ? glowCos.color : (portals.selected === 0 ? "#8fe9ff" : "#ff9ad0");
    const rimColor = beamReady ? `${glowColor}d9` : "rgba(201,190,255,0.55)";
    const rimBlur = 5 + strikeK * 6 + (p.rollT > 0 ? 4 : 0);
    ctx.save(); ctx.translate(p.x + p.fx * lunge, p.y + p.fy * lunge);
    // Collision remains unchanged; only the illustrated sprite is reduced so
    // the bearer fits the world and no longer covers most of a floor tile.
    ctx.scale(0.72, 0.72);
    const rollSquash = p.rollT > 0 ? 0.7 : 1;
    const punchStretch = 1 + strikeK * 0.18;
    const cloakCos = cosmeticOf("cloak");
    const cloakOuter = cloakCos ? cloakCos.outer : "#201432", cloakInner = cloakCos ? cloakCos.inner : "#4a2868";
    const bob = Math.sin(state.t * 6) * 0.45;
    const side = Math.max(-1, Math.min(1, p.fx));

    // Three split cloak tails give the bearer a sharp, moving silhouette.
    ctx.strokeStyle = "rgba(12,7,22,0.88)"; ctx.lineWidth = 2.4;
    for (let i = -1; i <= 1; i++) {
      const sway = Math.sin(state.t * 5 + i * 1.7) * 1.1 - p.fx * 2.4;
      ctx.beginPath();
      ctx.moveTo(-p.fx * 1.5 + i * 2.2, 2 + bob);
      ctx.quadraticCurveTo(-p.fx * 4 + sway + i * 1.7, 6, -p.fx * 6 + sway * 1.3 + i * 1.8, 10.5);
      ctx.stroke();
    }

    // Boots anchor the character and keep the cloak from reading as a capsule.
    ctx.fillStyle = "#100b19";
    ctx.fillRect(-5.2, 7.2, 3.5, 3.2);
    ctx.fillRect(1.5, 7.2, 3.5, 3.2);

    // Asymmetric mantle, belted tunic, and split lower cloak.
    glow(rimColor, rimBlur, () => {
      ctx.fillStyle = cloakOuter;
      ctx.beginPath();
      ctx.moveTo(-1, -12.5 + bob);
      ctx.lineTo(7.8 * punchStretch, -7.5);
      ctx.lineTo(6.2, 3.5 * rollSquash);
      ctx.lineTo(3.2, 9.2);
      ctx.lineTo(0, 6.8);
      ctx.lineTo(-3.8, 10);
      ctx.lineTo(-6.4, 2.6 * rollSquash);
      ctx.lineTo(-7.2 * punchStretch, -6.2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = cloakInner;
      ctx.beginPath();
      ctx.moveTo(-1.5, -7.5 + bob);
      ctx.lineTo(5.2, -4.8);
      ctx.lineTo(3.5, 5.8);
      ctx.lineTo(0, 4.2);
      ctx.lineTo(-3.3, 6.5);
      ctx.lineTo(-4.6, -3.8);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#9a6542";
      ctx.fillRect(-5.4, 0.2, 10.8, 1.5);
      ctx.fillStyle = "#efbf68";
      ctx.fillRect(-0.9, -0.2, 1.8, 2.3);
    });

    // Pointed hood and narrow mask distinguish the bearer from every villager.
    ctx.fillStyle = cloakOuter;
    ctx.beginPath();
    ctx.moveTo(-5.8, -8.6 + bob);
    ctx.quadraticCurveTo(-4.2, -15.8 + bob, 0.4, -16.8 + bob);
    ctx.quadraticCurveTo(5.7, -14 + bob, 6.2, -8.2 + bob);
    ctx.lineTo(3.8, -5.4 + bob);
    ctx.lineTo(-4.2, -5.5 + bob);
    ctx.closePath(); ctx.fill();
    glow(rimColor, rimBlur * 0.6, () => {
      ctx.fillStyle = "#e8d5b5";
      ctx.beginPath(); ctx.ellipse(side * 0.7, -9.8 + bob, 4.2, 3.7, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = "#17101f";
    ctx.fillRect(side * 0.7 - 2.7, -10.5 + bob, 1.5, 1.1);
    ctx.fillRect(side * 0.7 + 1.2, -10.5 + bob, 1.5, 1.1);
    ctx.fillStyle = "#d9824d";
    ctx.beginPath(); ctx.moveTo(-5.8, -6.5 + bob); ctx.lineTo(5.4, -8.2 + bob); ctx.lineTo(4.4, -5.9 + bob); ctx.lineTo(-5.2, -4.8 + bob); ctx.closePath(); ctx.fill();

    // a bare blade sliver on the leading hand, always visible — the Hand's
    // gauntlet (below) replaces it once acquired rather than adding to it
    ctx.save(); ctx.rotate(fa);
    ctx.fillStyle = "#f4e3be";
    ctx.beginPath(); ctx.moveTo(5, -1); ctx.lineTo(12 + strikeK * 4, 0); ctx.lineTo(5, 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,154,208,0.45)"; ctx.fillRect(4.2, -1.8, 2.4, 3.6);
    ctx.restore();

    // THE VESPER HAND — gauntlet on the leading arm, glowing when the beam is ready (full HP)
    if (state.flags.hasHand) {
      ctx.save(); ctx.rotate(fa);
      ctx.fillStyle = "#0c0a12"; ctx.fillRect(3, -2.4, 8, 4.8);
      ctx.fillStyle = beamReady ? glowColor : "#565060";
      ctx.fillRect(8.5, -1.8, 3, 3.6);
      ctx.strokeStyle = "rgba(255,220,150,0.45)"; ctx.strokeRect(3.4, -2, 7.4, 4);
      ctx.restore();
    }
    // accessory: small silhouette near the head
    const accCos = cosmeticOf("accessory");
    if (accCos) {
      ctx.fillStyle = accCos.color;
      ctx.beginPath(); ctx.arc(p.fx * 1.7 + 3, -8.5 + p.fy * 1.3, 1.6, 0, Math.PI * 2); ctx.fill();
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
    const role = n.id === "maren_plaza" ? "maren" : n.id;
    const actorScale = n.small ? 0.62 : 0.78;
    shadow(n.px, n.py, role === "bram" ? 5.2 : n.small ? 3.2 : 4.2);
    const tier = VG.dread.tier();
    const bob = Math.sin(state.t * 2 + n.bob) * (tier >= 2 ? 0.15 : 0.8);
    let jx = 0, jy = 0;
    if (tier >= 2) {
      const stutter = Math.floor(state.t * 1.3 + n.px * 0.07);
      if (stutter % 7 === 0) { jx = ((stutter * 928371 + n.py) % 5 - 2) * 0.4; jy = ((stutter * 1299721) % 5 - 2) * 0.3; }
    }
    ctx.save(); ctx.translate(n.px + jx, n.py + bob + jy); ctx.scale(actorScale, actorScale);
    const skin = role === "bram" ? "#b97851" : role === "vey" ? "#9f6e55" : "#dfc5a6";
    const hair = role === "maren" ? "#d7cfdd" : role === "odile" ? "#442f34" : role === "pip" ? "#6a4428" : role === "el" ? "#bfc5d1" : "#241a20";

    // Every named villager has a profession-readable silhouette.
    glow("rgba(255,214,150,0.28)", 2.5, () => {
      ctx.fillStyle = n.body;
      ctx.beginPath();
      if (role === "bram") {
        ctx.moveTo(-8, -6); ctx.lineTo(8, -6); ctx.lineTo(7, 7); ctx.lineTo(3, 9); ctx.lineTo(-4, 9); ctx.lineTo(-7, 6);
      } else if (role === "odile") {
        ctx.moveTo(-5, -7); ctx.quadraticCurveTo(7, -6, 6, 1); ctx.lineTo(9, 9); ctx.lineTo(-8, 9); ctx.lineTo(-6, 1);
      } else if (role === "pip") {
        ctx.moveTo(-5, -6); ctx.lineTo(5, -6); ctx.lineTo(4, 7); ctx.lineTo(0, 9); ctx.lineTo(-4, 7);
      } else if (role === "el") {
        ctx.moveTo(-4, -11); ctx.lineTo(4, -11); ctx.lineTo(6, 10); ctx.lineTo(-6, 10);
      } else if (role === "vey") {
        ctx.moveTo(-8, -7); ctx.lineTo(6, -6); ctx.lineTo(8, 7); ctx.lineTo(1, 9); ctx.lineTo(-7, 6);
      } else {
        ctx.moveTo(-5, -9); ctx.quadraticCurveTo(6, -8, 6, 1); ctx.lineTo(4, 10); ctx.lineTo(-5, 10); ctx.lineTo(-7, 1);
      }
      ctx.closePath(); ctx.fill();
    });

    // Clothing and props.
    if (role === "maren") {
      ctx.fillStyle = "#b8a8c4"; ctx.beginPath(); ctx.moveTo(-6, -5); ctx.lineTo(6, -5); ctx.lineTo(3, 1); ctx.lineTo(-3, 1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#8c6744"; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(7, -5); ctx.lineTo(8, 11); ctx.stroke();
      ctx.fillStyle = "#d7cfdd"; ctx.beginPath(); ctx.arc(3, -14, 2.8, 0, Math.PI * 2); ctx.fill();
    } else if (role === "bram") {
      ctx.fillStyle = "#382a2c"; ctx.fillRect(-5.5, -3, 11, 10);
      ctx.fillStyle = "#d9913d"; ctx.fillRect(-1.2, -2, 2.4, 8);
      ctx.strokeStyle = "#c6c9cf"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(8, -2); ctx.lineTo(11, 8); ctx.stroke();
      ctx.fillStyle = "#8e5b38"; ctx.fillRect(8, -4, 5, 3);
    } else if (role === "odile") {
      ctx.fillStyle = "#d9c8ad"; ctx.beginPath(); ctx.moveTo(-4, -3); ctx.lineTo(4, -3); ctx.lineTo(6, 7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#76a3b2"; ctx.fillRect(-4, -3, 8, 1.3);
      ctx.fillStyle = "#c78c55"; ctx.fillRect(6, 0, 6, 1.2);
      ctx.fillStyle = "#e8d8bd"; ctx.beginPath(); ctx.arc(10, -1, 1.8, 0, Math.PI * 2); ctx.fill();
    } else if (role === "pip") {
      ctx.fillStyle = "#d4a549"; ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(5, -1); ctx.lineTo(4, 1); ctx.lineTo(-5, -2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#7b5630"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(5, 1); ctx.lineTo(9, 6); ctx.stroke();
      glow("rgba(255,193,91,0.65)", 4, () => { ctx.fillStyle = "#ffc45f"; ctx.fillRect(7, 5, 4, 5); });
    } else if (role === "el") {
      ctx.fillStyle = "#2d2d3b"; ctx.beginPath(); ctx.moveTo(-5, -12); ctx.lineTo(0, -18); ctx.lineTo(5, -12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = n.trim; ctx.fillRect(-4, -3, 8, 1.3);
      ctx.strokeStyle = "#787080"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(7, -7); ctx.lineTo(8, 11); ctx.stroke();
      ctx.strokeStyle = "#d4b56d"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(8, -8, 3, 0, Math.PI * 2); ctx.stroke();
    } else if (role === "vey") {
      ctx.fillStyle = "#3b2946"; ctx.beginPath(); ctx.ellipse(-7, 0, 4, 8, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = n.trim; ctx.beginPath(); ctx.moveTo(-6, -5); ctx.lineTo(7, -2); ctx.lineTo(6, 0); ctx.lineTo(-7, -3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#e6b35e"; ctx.fillRect(5, 2, 3, 3); ctx.fillRect(1, 5, 3, 3);
    }

    const headY = role === "el" ? -12 : role === "maren" ? -11 : -9;
    glow("rgba(255,224,170,0.38)", 2, () => {
      ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(0, headY, role === "bram" ? 5 : 4.4, 4.2, 0, 0, Math.PI * 2); ctx.fill();
    });
    if (role === "bram") {
      ctx.fillStyle = "#5b3325"; ctx.beginPath(); ctx.moveTo(-4.4, headY + 1); ctx.lineTo(4.4, headY + 1); ctx.lineTo(2, headY + 6); ctx.lineTo(-2, headY + 6); ctx.closePath(); ctx.fill();
    } else if (role === "odile") {
      ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(0, headY - 1.5, 4.6, Math.PI, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(3.2, headY - 3.8, 2.4, 0, Math.PI * 2); ctx.fill();
    } else if (role === "pip") {
      ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(-0.5, headY - 1.8, 4.5, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#b95f46"; ctx.beginPath(); ctx.moveTo(-5, headY - 2); ctx.lineTo(4, headY - 5); ctx.lineTo(5, headY - 1); ctx.closePath(); ctx.fill();
    } else if (role === "maren") {
      ctx.strokeStyle = hair; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, headY, 4.5, Math.PI, Math.PI * 2); ctx.stroke();
    } else if (role === "vey") {
      ctx.fillStyle = "#3c2443"; ctx.beginPath(); ctx.arc(0, headY - 1, 5, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#d88bc8"; ctx.beginPath(); ctx.moveTo(2, headY - 5); ctx.lineTo(7, headY - 10); ctx.lineTo(4, headY - 3); ctx.closePath(); ctx.fill();
    }

    let ex = 0, ey = 0;
    if (tier >= 1) {
      const dx = player.x - n.px, dy = player.y - n.py, dlen = Math.hypot(dx, dy) || 1;
      const pull = Math.min(0.7, tier * 0.25);
      ex = (dx / dlen) * pull; ey = (dy / dlen) * pull * 0.5;
    }
    ctx.fillStyle = "#241a20";
    ctx.fillRect(-2.1 + ex, headY - 0.8 + ey, 1.2, 1.5); ctx.fillRect(1 + ex, headY - 0.8 + ey, 1.2, 1.5);
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
    if ((e.confuseT || 0) > 0) {
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(6,5,16,0.78)";
      ctx.fillRect(-6, -26, 12, 12);
      ctx.fillStyle = "#8fe9ff";
      ctx.fillText("?", 0, -17);
      ctx.textAlign = "left";
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
      ctx.shadowColor = col; ctx.shadowBlur = 14 + Math.sin(g.glyphPhase * 2) * 4;
      // mouth: soft void into the linked space
      ctx.fillStyle = g.endpoint === 0 ? "rgba(22,60,102,0.62)" : "rgba(92,34,82,0.62)";
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.abs(g.tx) * half + Math.abs(g.nx) * 4, Math.abs(g.ty) * half + Math.abs(g.ny) * 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,205,125,0.36)";
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, 0, Math.abs(g.tx) * half + Math.abs(g.nx) * 6, Math.abs(g.ty) * half + Math.abs(g.ny) * 6, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(0, 0, Math.abs(g.tx) * half + Math.abs(g.nx) * 3, Math.abs(g.ty) * half + Math.abs(g.ny) * 3, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g.tx * half, g.ty * half); ctx.lineTo(-g.tx * half, -g.ty * half); ctx.stroke();
      ctx.shadowBlur = 0;
      for (let k = -3; k <= 3; k++) {
        const off = (k / 3) + Math.sin(g.glyphPhase + k) * 0.08;
        ctx.fillStyle = col; ctx.globalAlpha = 0.7 + Math.sin(g.glyphPhase * 2 + k) * 0.3;
        ctx.fillRect(g.tx * half * off - 0.5, g.ty * half * off - 0.5, 1.5, 1.5);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = "rgba(255,232,180,0.48)"; ctx.lineWidth = 0.7;
      for (let k = 0; k < 8; k++) {
        const a = g.glyphPhase * 0.6 + k * Math.PI * 0.25;
        const rx = Math.cos(a) * (Math.abs(g.tx) * half + Math.abs(g.nx) * 7);
        const ry = Math.sin(a) * (Math.abs(g.ty) * half + Math.abs(g.ny) * 7);
        ctx.beginPath(); ctx.arc(rx, ry, 1.4, 0, Math.PI * 2); ctx.stroke();
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

  function drawVesperSense() {
    if (state.focusT <= 0 || !state.room) return;
    const alpha = Math.min(1, state.focusT) * (0.55 + Math.sin(state.t * 8) * 0.15);
    const mark = (x, y, color, label) => {
      ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 8 + (1.4 - state.focusT) * 6, 0, Math.PI * 2); ctx.stroke();
      ctx.font = "700 5px monospace"; ctx.textAlign = "center"; ctx.fillStyle = color; ctx.fillText(label, x, y - 12);
      ctx.restore(); ctx.textAlign = "left";
    };
    for (const ex of (VG.ROOMS[state.roomId].exits || [])) mark(ex.gx * T + 8, ex.gy * T + 8, "#8fe9ff", "PATH");
    for (const npc of npcs) mark(npc.px, npc.py, "#ffcf6b", npc.name.toUpperCase());
    for (const pickup of pickups) if (["quest", "pulse", "cosmetic"].includes(pickup.type)) mark(pickup.x, pickup.y, "#ff9ad0", "RESONANCE");
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
    ctx.fillStyle = opts.fill || "rgba(7,5,18,0.82)";
    ctx.fill();
    const strokeColor = opts.stroke || "rgba(236,148,76,0.36)";
    glow(strokeColor, 4.5, () => {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = opts.lineWidth || 1;
      ctx.stroke();
    });
    ctx.strokeStyle = opts.innerStroke || "rgba(255,218,142,0.20)";
    ctx.lineWidth = 0.65;
    ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
    if (opts.ornament !== false && w >= 46 && h >= 18) {
      const gold = opts.gold || "rgba(255,202,116,0.58)";
      ctx.strokeStyle = gold;
      ctx.lineWidth = 0.8;
      const c = 8;
      ctx.beginPath();
      ctx.moveTo(x + c, y + 5); ctx.quadraticCurveTo(x + 4, y + 4, x + 5, y + c);
      ctx.moveTo(x + w - c, y + 5); ctx.quadraticCurveTo(x + w - 4, y + 4, x + w - 5, y + c);
      ctx.moveTo(x + c, y + h - 5); ctx.quadraticCurveTo(x + 4, y + h - 4, x + 5, y + h - c);
      ctx.moveTo(x + w - c, y + h - 5); ctx.quadraticCurveTo(x + w - 4, y + h - 4, x + w - 5, y + h - c);
      ctx.stroke();
      ctx.fillStyle = gold;
      ctx.fillRect(x + 8, y + 4, 2, 2); ctx.fillRect(x + w - 10, y + 4, 2, 2);
      ctx.fillRect(x + 8, y + h - 6, 2, 2); ctx.fillRect(x + w - 10, y + h - 6, 2, 2);
    }
  }
  function drawIllustratedFrame() {
    if (VG.settings.reducedEffects) return;
    ctx.save();
    ctx.globalAlpha = 0.58;
    const vine = "rgba(10,7,17,0.72)";
    const leafA = "rgba(37,70,55,0.58)";
    const leafB = "rgba(64,43,85,0.54)";
    const gold = "rgba(255,184,91,0.36)";
    ctx.fillStyle = "rgba(2,1,6,0.26)";
    ctx.fillRect(0, 0, VG.W, 8);
    ctx.fillRect(0, VG.H - 9, VG.W, 9);
    ctx.fillRect(0, 0, 8, VG.H);
    ctx.fillRect(VG.W - 8, 0, 8, VG.H);
    ctx.strokeStyle = gold;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(6.5, 6.5, VG.W - 13, VG.H - 13);

    function vineCorner(sx, sy, flipX, flipY) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(flipX, flipY);
      ctx.strokeStyle = vine;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 56);
      ctx.quadraticCurveTo(18, 34, 10, 8);
      ctx.moveTo(10, 8);
      ctx.quadraticCurveTo(36, 17, 58, 0);
      ctx.stroke();
      for (let i = 0; i < 7; i++) {
        const x = 8 + i * 8;
        const y = 48 - i * 7;
        ctx.fillStyle = i % 2 ? leafA : leafB;
        ctx.beginPath(); ctx.ellipse(x, y, 8, 3.4, -0.7 + i * 0.16, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = gold; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(12, 10); ctx.quadraticCurveTo(18, 4, 28, 7);
      ctx.moveTo(5, 42); ctx.quadraticCurveTo(18, 45, 21, 31);
      ctx.stroke();
      ctx.restore();
    }
    vineCorner(0, 0, 1, 1);
    vineCorner(VG.W, 0, -1, 1);
    vineCorner(0, VG.H, 1, -1);
    vineCorner(VG.W, VG.H, -1, -1);
    ctx.restore();
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
    const beamReadyHUD = state.flags.hasHand && player.hp === player.maxHp;
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(8, 18, 70, 4);
    if (beamReadyHUD) {
      const glowCosHUD = cosmeticOf("glow");
      ctx.fillStyle = glowCosHUD ? glowCosHUD.color : (portals.selected === 0 ? "#8fe9ff" : "#ff9ad0");
      ctx.fillRect(8, 18, 70, 4);
    } else if (player.progressShots > 0) {
      ctx.fillStyle = "#ffcf6b";
      ctx.fillRect(8, 18, 70, 4);
    }
    ctx.fillStyle = "#8a9ac0"; ctx.font = "5px monospace"; ctx.fillText(beamReadyHUD ? "SPACE · BEAM READY" : player.progressShots > 0 ? "SPACE · PUZZLE SHOT" : "SPACE · HEAL TO FULL", 81, 22);
    // embers + vesper souls
    ctx.fillStyle = "#ffcf6b"; ctx.fillRect(8, 27, 4, 4);
    ctx.fillStyle = "#eaf2ff"; ctx.font = "7px monospace"; ctx.fillText(String(player.embers), 15, 32);
    ctx.fillStyle = "#9c8fff"; ctx.beginPath(); ctx.arc(52, 29, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#eaf2ff"; ctx.fillText(String(player.vesperSouls), 57, 32);
    if (state.flags.hasVesperShield) {
      const shieldReady = player.shieldCd <= 0;
      const shieldRatio = shieldReady ? 1 : Math.max(0, 1 - player.shieldCd / 3.4);
      parchmentPanel(5, 40, 96, 16, { seed: 4, fill: "rgba(5,4,13,0.68)" });
      ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(9, 45, 66, 3);
      ctx.fillStyle = shieldReady ? "#8fe9ff" : "#596a86"; ctx.fillRect(9, 45, 66 * shieldRatio, 3);
      ctx.fillStyle = shieldReady ? "#8fe9ff" : "#8a9ac0"; ctx.font = "5px monospace";
      ctx.fillText(shieldReady ? "SHIELD READY" : `SHIELD ${player.shieldCd.toFixed(1)}s`, 9, 54);
    }

    const roomName = VG.ROOMS[state.roomId]?.name || "Duskhollow";
    const hasHeartLine = state.vesperHearts > 0;
    parchmentPanel(VG.W - 176, 5, 171, hasHeartLine ? 32 : 22, { seed: 2, fill: "rgba(5,4,13,0.68)" });
    ctx.textAlign = "right";
    ctx.fillStyle = "#eaf2ff"; ctx.font = "700 7px Georgia, serif"; ctx.fillText(roomName.toUpperCase(), VG.W - 10, 14);
    ctx.fillStyle = "#8a9ac0"; ctx.font = "5px monospace";
    ctx.fillText(`${enemies.filter((e) => !e.dead).length + (boss && !boss.dead ? 1 : 0)} THREATS · ${state.score} SCORE`, VG.W - 10, 22);
    if (hasHeartLine) {
      ctx.fillStyle = "#ff9ad0"; ctx.font = "6px monospace";
      ctx.fillText(`♥ ${state.vesperHearts}/${state.heartsTotal} VESPER HEARTS`, VG.W - 10, 31);
    }
    ctx.textAlign = "left";
    // gate strain (only when a gate is up) — shifted down a row once the hearts line is showing
    const gateY = hasHeartLine ? 40 : 30;
    if (portals.gates.some((g) => g.active)) {
      const sw = 70;
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(VG.W - sw - 8, gateY, sw, 5);
      const st = portals.strain;
      ctx.fillStyle = st > 0.8 ? "#ff5c74" : st > 0.5 ? "#ffcf6b" : "#8fe9ff";
      ctx.fillRect(VG.W - sw - 8, gateY, sw * st, 5);
      ctx.textAlign = "right"; ctx.fillStyle = "#8a9ac0"; ctx.font = "6px monospace"; ctx.fillText("STRAIN", VG.W - 8, gateY + 13); ctx.textAlign = "left";
    }
    if (state.flags.hasHand) {
      ctx.textAlign = "right"; ctx.font = "6px monospace";
      ctx.fillStyle = portals.selected === 0 ? "#8fe9ff" : "#ff9ad0";
      ctx.fillText(portals.selected === 0 ? "NEXT GATE: DAWN" : "NEXT GATE: DUSK", VG.W - 8, portals.gates.some((g) => g.active) ? gateY + 22 : gateY + 6);
      ctx.textAlign = "left";
    }
    if (state.flags.hasHand) {
      const focusReady = state.focusCd <= 0;
      const fw = 70, fx = VG.W - fw - 8, fy = portals.gates.some((g) => g.active) ? gateY + 27 : gateY + 12;
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(fx, fy, fw, 3);
      ctx.fillStyle = focusReady ? "#8fe9ff" : "#615b84";
      ctx.fillRect(fx, fy, fw * (focusReady ? 1 : 1 - state.focusCd / 8), 3);
      ctx.textAlign = "right"; ctx.font = "5px monospace"; ctx.fillStyle = focusReady ? "#8fe9ff" : "#8a9ac0";
      ctx.fillText(focusReady ? "SPACE · VESPER SENSE" : `SENSE ${state.focusCd.toFixed(1)}s`, VG.W - 8, fy + 10); ctx.textAlign = "left";
    }
    // quest tracker
    const tq = trackedQuest();
    const roomDef = VG.ROOMS[state.roomId];
    const dungeonObjective = ["dungeon", "ossuary"].includes(roomDef?.biome) ? roomObjectiveText(roomDef) : "";
    if ((tq || dungeonObjective) && !(boss && !boss.dead)) {
      const trackerTitle = dungeonObjective ? "DUNGEON OBJECTIVE" : "CURRENT QUEST  ·  " + tq.title.toUpperCase();
      const source = dungeonObjective || tq.desc;
      let desc = source.length > 78 ? source.slice(0, 75) + "..." : source;
      // Presence system: at max dread, a single glyph can misrender for one
      // frame — easy to miss, unsettling on the replay where you catch it.
      if (VG.dread.tier() >= 3 && Math.random() < 0.004) {
        const glyphs = "†ø§‡Ω";
        const idx = Math.floor(Math.random() * desc.length);
        desc = desc.slice(0, idx) + glyphs[Math.floor(Math.random() * glyphs.length)] + desc.slice(idx + 1);
      }
      parchmentPanel(6, VG.H - 35, 272, 29, { seed: 3, fill: "rgba(5,4,13,0.78)", stroke: "rgba(255,207,107,0.2)" });
      ctx.font = "700 6px monospace"; ctx.fillStyle = dungeonObjective ? "#8fe9ff" : "#ffcf6b"; ctx.fillText(trackerTitle, 12, VG.H - 23);
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
    ctx.fillText(`◆ ${player.embers} embers   ● ${player.vesperSouls} vesper souls`, x + 14, y + 50);
    ctx.fillStyle = "#8a9ac0";
    ctx.fillText(`wolf shards ${player.materials.wolfshard}   glass shards ${player.materials.glassshard}${state.flags.lantern && state.quests.q_lantern !== "done" ? "   pip's lantern" : ""}`, x + 14, y + 62);
    if (state.flags.hasVesperShield) {
      ctx.fillStyle = "#8fe9ff"; ctx.font = "700 7px monospace";
      ctx.fillText("VESPER SHIELD · RIGHT-CLICK REFLECTS · G PLACES GATES", x + 14, y + 72);
    }
    // relics
    ctx.fillStyle = "#8fe9ff"; ctx.font = "700 9px Georgia, serif"; ctx.fillText("RELICS — equip two", x + 14, y + 82);
    invRects = [];
    const owned = Object.keys(player.relics);
    if (!owned.length) { ctx.fillStyle = "#5a6a90"; ctx.font = "7px monospace"; ctx.fillText("none yet — the world is holding them for you", x + 14, y + 96); }
    owned.forEach((id, i) => {
      const ry = y + 92 + i * 22, on = relicOn(id);
      const rect = { x: x + 14, y: ry - 9, w: 250, h: 20, id, kind: "relic" };
      invRects.push(rect);
      ctx.fillStyle = on ? "rgba(143,233,255,0.12)" : "rgba(255,255,255,0.03)";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = on ? "#8fe9ff" : "rgba(138,154,192,0.3)"; ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      ctx.fillStyle = on ? "#8fe9ff" : "#eaf2ff"; ctx.font = "700 8px Georgia, serif";
      ctx.fillText((on ? "◈ " : "◇ ") + D.RELICS[id].name, rect.x + 6, ry + 1);
      ctx.fillStyle = "#8a9ac0"; ctx.font = "6px monospace";
      ctx.fillText(D.RELICS[id].desc, rect.x + 6, ry + 9);
    });
    // appearance — cycle through owned cosmetics per slot (glints found in the world)
    const apY = y + 220;
    ctx.fillStyle = "#ffd166"; ctx.font = "700 9px Georgia, serif";
    ctx.fillText(`APPEARANCE — ${player.cosmetics.owned.length}/${D.COSMETICS.length} found`, x + 14, apY);
    ["cloak", "glow", "accessory", "trail"].forEach((cat, i) => {
      const ry = apY + 18 + i * 16;
      const inCat = D.COSMETICS.filter((c) => c.cat === cat && player.cosmetics.owned.includes(c.id));
      const cur = cosmeticOf(cat);
      const label = cat[0].toUpperCase() + cat.slice(1);
      ctx.fillStyle = "#8a9ac0"; ctx.font = "7px monospace";
      ctx.fillText(label + ":", x + 14, ry);
      const leftRect = { x: x + 78, y: ry - 8, w: 10, h: 10, kind: "cosCycle", cat, dir: -1 };
      const rightRect = { x: x + 220, y: ry - 8, w: 10, h: 10, kind: "cosCycle", cat, dir: 1 };
      invRects.push(leftRect, rightRect);
      ctx.fillStyle = inCat.length ? "#eaf2ff" : "#4a4a58";
      ctx.fillText("◂", leftRect.x, ry); ctx.fillText("▸", rightRect.x, ry);
      ctx.fillStyle = cur ? "#eaf2ff" : "#5a6a90";
      ctx.font = "700 7px Georgia, serif";
      ctx.fillText(cur ? cur.name : (inCat.length ? "— none equipped —" : "— none found yet —"), x + 92, ry);
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
    ctx.fillText("TAB / I / ESC — close · click a relic to equip · ◂▸ to change appearance", x + w / 2, y + h - 8);
    ctx.textAlign = "left";
  }
  const MAP_NODES = {
    maren: [112, 93], shop: [220, 92], inn: [328, 93], village: [220, 145],
    vale: [230, 218], hollow1: [104, 252], hollowboss: [60, 310],
    lake: [326, 236], ossuary1: [348, 278], ossuaryboss: [372, 320],
  };
  function drawMap() {
    ctx.fillStyle = "rgba(3,2,9,0.94)"; ctx.fillRect(0, 0, VG.W, VG.H);
    const x = 24, y = 18, w = VG.W - 48, h = VG.H - 36;
    parchmentPanel(x, y, w, h, { seed: 9, fill: "rgba(9,7,22,0.97)", stroke: "rgba(143,233,255,0.36)" });
    ctx.fillStyle = "#8fe9ff"; ctx.font = "700 7px monospace"; ctx.fillText("VESPER HAND WAYFINDER · LIVING ROUTES", x + 16, y + 18);
    ctx.fillStyle = "#eef4ff"; ctx.font = "700 15px Georgia, serif"; ctx.fillText("Duskhollow and the folds below", x + 16, y + 39);
    ctx.fillStyle = "#8a9ac0"; ctx.font = "6px monospace";
    ctx.fillText(`${Object.keys(state.discovered).length}/10 places found · ${questsDone()}/6 quests · ${Math.floor(state.playSeconds / 60)}m in this tale`, x + 16, y + 52);

    const links = [];
    for (const [id, room] of Object.entries(VG.ROOMS)) for (const ex of (room.exits || [])) {
      if (MAP_NODES[id] && MAP_NODES[ex.to] && id < ex.to) links.push([id, ex.to]);
    }
    ctx.lineWidth = 2;
    for (const [a, b] of links) {
      const pa = MAP_NODES[a], pb = MAP_NODES[b], known = state.discovered[a] && state.discovered[b];
      ctx.strokeStyle = known ? "rgba(143,233,255,0.34)" : "rgba(90,98,124,0.13)";
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
    }
    for (const [id, pos] of Object.entries(MAP_NODES)) {
      const known = !!state.discovered[id], current = id === state.roomId;
      const pulse = 1 + Math.sin(state.t * 4) * 0.12;
      ctx.save(); ctx.translate(pos[0], pos[1]); if (current) ctx.scale(pulse, pulse);
      ctx.fillStyle = current ? "#8fe9ff" : known ? "#201d38" : "#0b0a14";
      ctx.strokeStyle = current ? "#d9f8ff" : known ? "#756da0" : "#302d42"; ctx.lineWidth = current ? 2 : 1;
      ctx.beginPath(); ctx.arc(0, 0, current ? 8 : 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = current ? "#061018" : known ? "#eaf2ff" : "#5a6075";
      ctx.font = "700 5px monospace"; ctx.textAlign = "center"; ctx.fillText(current ? "YOU" : known ? "◆" : "?", 0, 2);
      ctx.fillStyle = known ? "#c9d6e8" : "#51566a"; ctx.font = "6px Georgia, serif";
      ctx.fillText(known ? VG.ROOMS[id].name : "Unknown", 0, -11); ctx.restore();
    }

    const sx = 392, sy = 60, sw = 178;
    const rank = masteryRank(), next = nextMasteryRank();
    parchmentPanel(sx, sy, sw, 116, { seed: 10, fill: "rgba(5,4,13,0.78)", stroke: "rgba(255,207,107,0.26)" });
    ctx.fillStyle = "#ffcf6b"; ctx.font = "700 6px monospace"; ctx.fillText("VESPER MASTERY", sx + 12, sy + 15);
    ctx.fillStyle = "#fff4d8"; ctx.font = "700 12px Georgia, serif"; ctx.fillText(rank.name, sx + 12, sy + 34);
    ctx.fillStyle = "#8a9ac0"; ctx.font = "6px monospace";
    ctx.fillText(`${state.mastery.portalCrossings} crossings · ${state.mastery.foldshots} foldshots`, sx + 12, sy + 50);
    ctx.fillText(`${masteryScore()} resonance${next ? ` · ${next.at - masteryScore()} to ${next.name}` : " · mastery complete"}`, sx + 12, sy + 61);
    const tq = trackedQuest();
    ctx.fillStyle = "#8fe9ff"; ctx.fillText("CURRENT THREAD", sx + 12, sy + 80);
    ctx.fillStyle = "#eaf2ff"; ctx.font = "700 7px Georgia, serif"; ctx.fillText(tq ? tq.title : "Evensong restored", sx + 12, sy + 94);
    ctx.fillStyle = "#8a9ac0"; ctx.font = "6px monospace"; ctx.fillText("M / RB / ESC — return", sx + 12, sy + 108);
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
        <p class="vg-kick">VESPERGATE 3.1 · LIVING DREAD</p>
        <h1>VESPERGATE</h1>
        <p class="vg-sub">The village bell is silent. The lake sings back. Master the Vesper Hand, fold momentum through linked gates, and bring three lost voices home before the Presence learns yours.</p>
        <div class="vg-campaign"><span>Living world</span><span>6 quests</span><span>2 dungeons</span><span>Portal mastery</span><span>Full touch + gamepad</span></div>
        <div class="vg-btns">
          ${cont ? `<button class="vg-btn vg-primary" data-vg-continue>Continue in ${VG.ROOMS[cont.roomId] ? VG.ROOMS[cont.roomId].name : "Duskhollow"}</button>` : `<button class="vg-btn vg-primary" data-vg-new>Begin the tale</button>`}
          ${cont ? `<button class="vg-btn" data-vg-new>New tale</button>` : ""}
          <button class="vg-btn" data-vg-settings>Settings</button>
        </div>
        <div class="vg-controls" aria-label="Controls">
          <span class="vg-control"><b>WASD</b>Move</span><span class="vg-control"><b>LEFT CLICK</b>Strike</span>
          <span class="vg-control"><b>F</b>Beam (full HP only)</span><span class="vg-control"><b>RIGHT CLICK</b>Place gate</span>
          <span class="vg-control"><b>G / Q / R</b>Gate / swap / vent</span><span class="vg-control"><b>RIGHT CLICK</b>Gate / Vespershield</span>
          <span class="vg-control"><b>SHIFT</b>Roll</span><span class="vg-control"><b>SPACE</b>Vesper Sense</span>
          <span class="vg-control"><b>E</b>Talk / use</span><span class="vg-control"><b>M / TAB</b>Map / inventory</span>
        </div>
      </div>`;
    } else if (kind === "dead") {
      const checkpointName = VG.ROOMS[state.checkpoint?.roomId]?.name || "the last doorway";
      el.innerHTML = `<div class="vg-panel"><p class="vg-kick" style="color:#ff5c74">THE DUSK TOOK YOU</p><h1>COLLAPSED</h1><p class="vg-sub">The Hand pulls you back to ${checkpointName}. You keep everything you carried and return at full health.</p><div class="vg-btns"><button class="vg-btn vg-primary" data-vg-retry>Return to last door</button><button class="vg-btn" data-vg-title>Title</button></div></div>`;
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
        ${chk("Reduced effects", "reducedEffects")}${chk("High-contrast guidance", "highContrast")}${chk("Crisp HD rendering", "sharpRender")}
        <div class="vg-btns"><button class="vg-btn vg-primary" data-vg-settings-back>Back</button></div></div>`;
    } else if (kind === "pause") {
      const quest = trackedQuest();
      el.innerHTML = `<div class="vg-panel"><p class="vg-kick">${VG.ROOMS[state.roomId]?.name || "Duskhollow"}</p><h1>Paused</h1>
        <p class="vg-sub">${quest ? `Current quest: ${quest.title}.` : "The road is quiet for a moment."} ${masteryRank().name} · Score ${state.score} · Best chain ${state.bestCombo}.</p>
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
    else if (b.dataset.vgContinue !== undefined) { const s = VG.save.read(); if (s) { restoreSave(s); startGame(state.checkpoint.roomId, state.checkpoint.spawn); } else newGame(); }
    else if (b.dataset.vgRetry !== undefined) respawnAtCheckpoint();
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
    player.hp = 5; player.maxHp = 5;
    player.embers = 0; player.vesperSouls = 0; player.relics = {}; player.equipped = []; player.materials = { wolfshard: 0, glassshard: 0 };
    player.bonusMeleeDmg = 0; player.bonusStrikeCdMul = 1; player.bonusBeamDmg = 0; player.bonusReach = 0; player.bonusMagnetMul = 1;
    player.cosmetics = { owned: [], equipped: { cloak: null, glow: null, accessory: null, trail: null } };
    state.score = 0; state.kills = 0; state.completeSent = false;
    state.combo = 0; state.comboT = 0; state.bestCombo = 0; state.damageFlash = 0;
    state.dawn = 0; state.dawnTransition = false; state.vesperHearts = 0; state.soulTiers = {};
    state.mastery = { portalCrossings: 0, foldshots: 0, perfectRooms: 0 };
    state.discovered = {}; state.playSeconds = 0; state.focusCd = 0; state.focusT = 0; state.autosaveT = 0;
    state.checkpoint = { roomId: "maren", spawn: { x: 8, y: 9 } };
    player.shieldT = 0; player.shieldCd = 0; player.shieldWarnCd = 0;
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
    if (state.phase === "inventory") {
      for (const rc of invRects) {
        if (cx2 >= rc.x && cx2 <= rc.x + rc.w && cy2 >= rc.y && cy2 <= rc.y + rc.h) {
          if (rc.kind === "cosCycle") cycleAppearance(rc.cat, rc.dir); else toggleEquip(rc.id);
          return;
        }
      }
    }
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
    if (d2.type === "save-state") {
      saveGame();
      host("progress", { score: state.score, progress: progressPct(), state: VG.save.read() });
    }
    if ((d2.type === "load-state" || d2.type === "restore") && d2.state && VG.save.import(d2.state)) {
      const restored = VG.save.read();
      if (restored) { restoreSave(restored); startGame(VG.ROOMS[restored.roomId] ? restored.roomId : "village", null); }
    }
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
      else if (state.phase === "inventory" || state.phase === "map" || state.phase === "shop") state.phase = "playing";
      pressed.delete("Escape");
    }
    if (state.phase === "playing") { simulate(VG.fx.scaleDt(dt)); pressed.clear(); }
    else if (state.phase === "dialog" || state.phase === "scene") {
      state.t += dt;
      if (pressed.has("KeyE") || pressed.has("Space") || pressed.has("M1") || pressed.has("PadA")) {
        if (state.dialog) advanceDialog(); else advanceScene();
      }
      pressed.clear();
    } else if (state.phase === "inventory" || state.phase === "map" || state.phase === "shop") {
      state.t += dt;
      if (state.phase === "map" && (pressed.has("KeyM") || pressed.has("PadRB"))) state.phase = "playing";
      else if (state.phase === "inventory" && (pressed.has("Tab") || pressed.has("KeyI") || pressed.has("PadBack"))) state.phase = "playing";
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
      drawIllustratedFrame();
      if (state.phase === "dialog" || state.phase === "scene") drawDialog();
      if (state.phase === "inventory") drawInventory();
      if (state.phase === "map") drawMap();
      if (state.phase === "shop") drawShop();
    } else drawTitleBackdrop();
    requestAnimationFrame(frame);
  }

  /* ================= boot ================= */
  VG.fit();
  showOverlay("title");
  host("ready", { title: "Vespergate 3.0: Living Dread", version: "3.0.0", capabilities: ["save-state", "touch", "gamepad", "map", "mastery"] });
  requestAnimationFrame(frame);

  /* ================= test hook ================= */
  window.__VespergateTest = {
    state: () => ({
      phase: state.phase, room: state.roomId,
      px: +player.x.toFixed(1), py: +player.y.toFixed(1),
      hp: player.hp, maxHp: player.maxHp, embers: player.embers, vesperSouls: player.vesperSouls,
      vesperHearts: state.vesperHearts, cosmeticsOwned: player.cosmetics.owned.length,
      quests: { ...state.quests }, flags: Object.keys(state.flags),
      relics: Object.keys(player.relics), equipped: player.equipped.slice(),
      gates: portals.gates.map((g) => g.active), strain: +portals.strain.toFixed(2),
      enemies: enemies.filter((e) => !e.dead).length, npcs: npcs.map((n) => n.id),
      recoveryFonts: recoveryFonts.map((f) => ({ id: f.id, state: f.state, x: f.x, y: f.y })),
      resonanceFonts: resonanceFonts.map((f) => ({ id: f.id, state: f.state, x: f.x, y: f.y })),
      progressShots: player.progressShots || 0,
      bossHp: boss ? boss.hp : null, score: state.score, kills: state.kills,
      combo: state.combo, bestCombo: state.bestCombo,
      renderScale: +(VG.renderScale || 1).toFixed(2),
      fullscreen: !!document.fullscreenElement || document.body.classList.contains("is-vg-theater"),
      mastery: { ...state.mastery, score: masteryScore(), rank: masteryRank().name },
      discovered: Object.keys(state.discovered), focusReady: state.focusCd <= 0,
      objective: roomObjectiveText(),
      exits: (VG.ROOMS[state.roomId]?.exits || []).map((ex) => ({ to: ex.to, locked: exitLockReason(ex) || null })),
      progression: inspectProgression(),
      sequence: VG.ROOMS[state.roomId]?.bellSequence ? sequenceProgress(state.roomId) : null,
      relays: VG.ROOMS[state.roomId]?.mirrorRelays ? relaysLit(VG.ROOMS[state.roomId]) : null,
      sanctumComplete: sanctumComplete(VG.ROOMS[state.roomId]),
      visualProfile: "living-dread-restored-v1",
      characterProfile: "pointed-hood-asymmetric-mantle-v1",
    }),
    newGame: () => newGame(),
    warp: (room, gx, gy) => { loadRoom(room, gx != null ? { x: gx, y: gy } : null); state.phase = "playing"; hideOverlay(); },
    grant: (flag) => { state.flags[flag] = true; },
    setQuest: (id, st) => { state.quests[id] = st; },
    embers: (n) => { player.embers += n; },
    souls: (n) => { player.vesperSouls += n; checkSoulTiers(); },
    grantCosmetic: (id) => { if (!player.cosmetics.owned.includes(id)) player.cosmetics.owned.push(id); },
    grantAllCosmetics: () => { for (const c of D.COSMETICS) if (!player.cosmetics.owned.includes(c.id)) player.cosmetics.owned.push(c.id); },
    cosmeticIds: () => D.COSMETICS.map((c) => c.id),
    hp: (n) => { player.hp = Math.max(0, Math.min(player.maxHp, n)); },
    maxHp: (n) => { player.maxHp = Math.max(1, n); player.hp = Math.min(player.hp, player.maxHp); },
    clearEnemies: () => { for (const e of enemies.slice()) if (!e.dead) killEnemy(e); },
    confuseNearestGuard: () => {
      const guard = enemies.find((e) => !e.dead && e.type === "guard");
      return guard ? confuseShieldGuard(guard, guard.x - 24, guard.y, 2.4) : false;
    },
    nearestGuardState: () => {
      const guard = enemies.find((e) => !e.dead && e.type === "guard");
      return guard ? {
        hp: guard.hp,
        maxHp: guard.maxHp,
        shield: !!guard.shield,
        confused: (guard.confuseT || 0) > 0,
        confuseT: +(guard.confuseT || 0).toFixed(2),
        facing: +guard.facing.toFixed(3),
      } : null;
    },
    defeatBoss: () => { if (boss && !boss.dead) damageBoss(boss.hp + 1); },
    ringBell: (index) => { const def = VG.ROOMS[state.roomId], bell = def?.bells?.[index]; if (bell) ringBell(bell.gx * T + 8, bell.gy * T + 8); },
    activateRelay: (id) => { const def = VG.ROOMS[state.roomId], relay = def?.mirrorRelays?.find((item) => item.id === id); return relay ? activateMirrorRelay(def, relay) : false; },
    solveSigil: () => { const def = VG.ROOMS[state.roomId]; if (def?.sigil) { state.flags[sigilFlag(def.id)] = true; refreshRoomObjective(); saveGame(); return true; } return false; },
    useSanctum: () => { const def = VG.ROOMS[state.roomId], sanctum = def?.sanctum; if (!sanctum) return false; player.x = sanctum.gx * T + 8; player.y = sanctum.gy * T + 8; return useSanctum({ ...sanctum, x: player.x, y: player.y }); },
    interact: () => tryInteract(),
    position: (gx, gy) => { player.x = gx * T + 8; player.y = gy * T + 8; VG.camera.snapTo(player.x, player.y); },
    useRecovery: () => recoveryFonts.some((f) => useRecoveryFont(f)),
    useResonance: () => resonanceFonts.some((f) => grantProgressShot(f)),
    inspectProgression: () => inspectProgression(),
    tickProgressionSafety: () => ensureProgressionSafety(0),
    save: () => saveGame(),
    loadSaved: () => { const s = VG.save.read(); if (s) { restoreSave(s); loadRoom(state.checkpoint.roomId, state.checkpoint.spawn); state.phase = "playing"; hideOverlay(); } },
    skipScene: () => { while (state.scene) advanceScene(); while (state.dialog) advanceDialog(); },
    placeGates: (x1, y1, d1, x2, y2, d2) => { portals.place(0, x1, y1, d1, true); portals.place(1, x2, y2, d2, true); portals.gates.forEach((g) => g.open = 1); },
    teleportTest: (ent) => portals.tryTeleport(ent, "test" + Math.random(), { strain: 0, force: true }),
    holeTest: (x, y) => portals.holeAt(x, y),
    rooms: () => Object.keys(VG.ROOMS),
  };
})();
