'use strict';
/* Skyguard Arena — original tower-defense + 1v1 battle-mode game for
   PhantomPlay. Vanilla JS, canvas rendering, WebAudio SFX, no external
   assets, no network calls (CSP: connect-src 'none').

   ============================================================
   IMPORTANT — a verified platform constraint that shapes Battle Mode:
   app/js/phantomplay.js's handleMatchAction() only forwards a game's
   "match-action" message to the server when the CURRENT signed-in actor
   is the room's host (room.hostActorId === ui.snapshot.actorId); a
   non-host participant's match-action is silently dropped client-side.
   The server route (updatePhantomPlayRoomMatchState in phantomplay.ts)
   independently enforces the same host-only rule. Net effect: only the
   room HOST's actions ever reach the shared matchState today. This file
   is written correctly and symmetrically against the *documented*
   match-state/match-action contract (so it will start working
   bidirectionally the moment that relay gap is closed platform-side,
   with zero changes needed here) but ships an honest, disclosed
   asymmetry for the guest seat in the meantime — see the "battle" /
   "duel" sections below and the platform owner's build report for the
   exact, tested behavior this produces today.
   ============================================================
*/

// ---------------------------------------------------------------------
// 1. Host bridge
// ---------------------------------------------------------------------
const host = (type, data = {}) => parent.postMessage({ source: 'phantomplay-game', type, ...data }, '*');
function matchAction(action, mode) { host('match-action', { action, mode: mode === 'replace' ? 'replace' : 'merge' }); }

// ---------------------------------------------------------------------
// 2. World constants
// ---------------------------------------------------------------------
const REF_W = 960, REF_H = 540;
const PATH_N = [[0.03, 0.52], [0.24, 0.52], [0.24, 0.16], [0.46, 0.16], [0.46, 0.84], [0.68, 0.84], [0.68, 0.30], [0.92, 0.30], [0.985, 0.46]];
const SLOTS_N = [
  [0.14, 0.64], [0.14, 0.36],
  [0.335, 0.09], [0.335, 0.235],
  [0.365, 0.615], [0.365, 0.77],
  [0.565, 0.90], [0.565, 0.70],
  [0.585, 0.20], [0.585, 0.365],
  [0.805, 0.185], [0.805, 0.395],
];
const PATH_PX = PATH_N.map(([x, y]) => [x * REF_W, y * REF_H]);
const SLOT_PX = SLOTS_N.map(([x, y]) => [x * REF_W, y * REF_H]);
const SEG_LEN = []; let TOTAL_LEN = 0;
for (let i = 0; i < PATH_PX.length - 1; i++) {
  const [x1, y1] = PATH_PX[i], [x2, y2] = PATH_PX[i + 1];
  const d = Math.hypot(x2 - x1, y2 - y1);
  SEG_LEN.push(d); TOTAL_LEN += d;
}
function pointAtT(t) {
  t = Math.max(0, Math.min(1, t));
  let dist = t * TOTAL_LEN;
  for (let i = 0; i < SEG_LEN.length; i++) {
    if (dist <= SEG_LEN[i] || i === SEG_LEN.length - 1) {
      const frac = SEG_LEN[i] > 0 ? dist / SEG_LEN[i] : 0;
      const [x1, y1] = PATH_PX[i], [x2, y2] = PATH_PX[i + 1];
      return { x: x1 + (x2 - x1) * frac, y: y1 + (y2 - y1) * frac };
    }
    dist -= SEG_LEN[i];
  }
  const last = PATH_PX[PATH_PX.length - 1];
  return { x: last[0], y: last[1] };
}

const DEFENDERS = {
  glare: { id: 'glare', name: 'Glare Cannon', cost: 50, color: '#ffb84d', shape: 'circle', role: 'single target',
    base: { dmg: 6, rof: 3.2, range: 108, pierce: 0 } },
  arc: { id: 'arc', name: 'Arc Diffuser', cost: 85, color: '#ff4d8d', shape: 'hex', role: 'chains and shields',
    base: { dmg: 5, rof: 1.1, range: 100, splash: 44 } },
  frost: { id: 'frost', name: 'Frost Prism', cost: 70, color: '#4ddbff', shape: 'tri', role: 'slow and control',
    base: { dmg: 1, rof: 1.0, range: 126, slow: 0.35, slowDur: 1.6 } },
  vane: { id: 'vane', name: 'Vane Sniper', cost: 130, color: '#8a6bff', shape: 'star', role: 'elite killer',
    base: { dmg: 42, rof: 0.55, range: 210, pierce: 2 } },
  flak: { id: 'flak', name: 'Flak Bastion', cost: 95, color: '#ff7b3d', shape: 'square', role: 'anti-swarm',
    base: { dmg: 8, rof: 1.7, range: 112, splash: 54, swarmBonus: 1.9 } },
  null: { id: 'null', name: 'Null Beacon', cost: 110, color: '#5be6a0', shape: 'diamond', role: 'detection',
    base: { dmg: 3, rof: 1.0, range: 132, detect: true, shieldBreak: 10, disrupt: 0.28 } },
  drone: { id: 'drone', name: 'Drone Foundry', cost: 125, color: '#5da8ff', shape: 'hangar', role: 'interceptors',
    base: { dmg: 7, rof: 2.2, range: 148, drone: true, swarmBonus: 1.25 } },
  gravity: { id: 'gravity', name: 'Gravity Well', cost: 170, color: '#d46bff', shape: 'well', role: 'route control',
    base: { dmg: 2, rof: 0.72, range: 138, slow: 0.28, slowDur: 1.8, pull: 0.018, phaseBreak: true } },
};
const DEFENDER_ORDER = ['glare', 'arc', 'frost', 'vane', 'flak', 'null', 'drone', 'gravity'];
const UNLOCK_RANK = { glare: 1, arc: 1, frost: 1, vane: 1, flak: 2, null: 2, drone: 3, gravity: 4 };

const UPGRADE_PATHS = {
  glare: {
    solar: { name: 'Solar Lance', ultimate: 'Helios Lance', costs: [70, 115, 170, 245],
      steps: [
        { label: 'Focus Lens', dmgMul: 1.45, rangeAdd: 18, pierceAdd: 2 },
        { label: 'Fusion Ray', dmgMul: 1.35, pierceAdd: 3 },
        { label: 'Sunpiercer', dmgMul: 1.5, rangeAdd: 18, pierceAdd: 4 },
        { label: 'Helios Lance', dmgMul: 1.7, rangeAdd: 28, pierceAdd: 8, beam: true },
      ] },
    nova: { name: 'Nova Battery', ultimate: 'Starstorm Battery', costs: [65, 105, 155, 225],
      steps: [
        { label: 'Twin Emitters', rofMul: 1.35 },
        { label: 'Scatter Burst', rofMul: 1.2, splashAdd: 26 },
        { label: 'Quad Array', rofMul: 1.35, splashAdd: 18 },
        { label: 'Starstorm Battery', rofMul: 1.55, splashAdd: 30, barrage: true },
      ] },
    reactor: { name: 'Radiant Reactor', ultimate: 'Dawn Engine', costs: [60, 95, 145, 210],
      steps: [
        { label: 'Hot Core', dmgMul: 1.15, overchargeGain: 0.4 },
        { label: 'Energy Relay', rangeAdd: 16, supportAura: 0.1 },
        { label: 'Radiant Field', supportAura: 0.16, overchargeGain: 0.8 },
        { label: 'Dawn Engine', supportAura: 0.24, overchargeGain: 1.5, dawn: true },
      ] },
  },
  arc: {
    chain: { name: 'Chain Storm', ultimate: 'Thunderweb', costs: [75, 120, 175, 250],
      steps: [
        { label: 'Extended Arc', chain: 1, rangeAdd: 8 },
        { label: 'Forked Current', chain: 2, dmgMul: 1.15 },
        { label: 'Rolling Voltage', chain: 3, dmgMul: 1.2 },
        { label: 'Thunderweb', chain: 5, dmgMul: 1.35, stormField: true },
      ] },
    emp: { name: 'EMP Command', ultimate: 'Blackout Core', costs: [70, 110, 160, 235],
      steps: [
        { label: 'Shield Breaker', shieldBreak: 18 },
        { label: 'Ion Lock', shieldBreak: 24, disrupt: 0.22 },
        { label: 'System Crash', shieldBreak: 34, disrupt: 0.32 },
        { label: 'Blackout Core', shieldBreak: 60, disrupt: 0.55, blackout: true },
      ] },
    grid: { name: 'Tempest Grid', ultimate: 'Tempest Nexus', costs: [70, 115, 170, 245],
      steps: [
        { label: 'Static Residue', splashAdd: 16 },
        { label: 'Arc Mines', splashAdd: 22, slow: 0.16, slowDur: 0.8 },
        { label: 'Storm Field', splashAdd: 32, slow: 0.22, slowDur: 1.2 },
        { label: 'Tempest Nexus', splashAdd: 48, slow: 0.28, slowDur: 1.6, stormField: true },
      ] },
  },
  frost: {
    zero: { name: 'Absolute Zero', ultimate: 'Absolute Zero', costs: [65, 105, 155, 225],
      steps: [
        { label: 'Cold Lens', slow: 0.5, slowDur: 2.1 },
        { label: 'Deep Freeze', slow: 0.62, slowDur: 2.8 },
        { label: 'Cryostasis', slow: 0.75, slowDur: 3.4, freeze: true },
        { label: 'Absolute Zero', slow: 0.88, slowDur: 4.2, freeze: true, iceHalo: true },
      ] },
    shatter: { name: 'Crystal Shatter', ultimate: 'Avalanche Prism', costs: [70, 110, 165, 235],
      steps: [
        { label: 'Brittle Beam', vuln: 0.18 },
        { label: 'Ice Fracture', vuln: 0.28, dmgMul: 1.4 },
        { label: 'Chain Shatter', vuln: 0.38, splashAdd: 18 },
        { label: 'Avalanche Prism', vuln: 0.55, splashAdd: 38, avalanche: true },
      ] },
    vortex: { name: 'Cryo Vortex', ultimate: 'Singularity Ice', costs: [75, 120, 180, 260],
      steps: [
        { label: 'Wide Halo', rangeAdd: 18 },
        { label: 'Frozen Current', pull: 0.008, slow: 0.45 },
        { label: 'Polar Vortex', pull: 0.014, rangeAdd: 18 },
        { label: 'Singularity Ice', pull: 0.026, rangeAdd: 28, iceHalo: true },
      ] },
  },
  vane: {
    rail: { name: 'Rail Verdict', ultimate: 'Judgment Rail', costs: [90, 145, 215, 310],
      steps: [
        { label: 'Dense Rounds', dmgMul: 1.28, pierceAdd: 2 },
        { label: 'Hypervelocity', dmgMul: 1.42, pierceAdd: 3 },
        { label: 'Hullbreaker', dmgMul: 1.58, pierceAdd: 4 },
        { label: 'Judgment Rail', dmgMul: 1.9, pierceAdd: 8, beam: true },
      ] },
    hunter: { name: 'Hunter Protocol', ultimate: 'Apex Hunter', costs: [85, 135, 205, 290],
      steps: [
        { label: 'Tracking Suite', detect: true, rofMul: 1.16 },
        { label: 'Cloak Sensor', detect: true, eliteBonus: 1.45 },
        { label: 'Execution Matrix', detect: true, execute: 0.18 },
        { label: 'Apex Hunter', detect: true, eliteBonus: 1.8, execute: 0.28 },
      ] },
    orbital: { name: 'Orbital Mark', ultimate: 'Orbital Verdict', costs: [80, 125, 190, 275],
      steps: [
        { label: 'Target Painter', mark: 0.18 },
        { label: 'Shared Lock', mark: 0.28, rangeAdd: 14 },
        { label: 'Vulnerability Scan', mark: 0.38 },
        { label: 'Orbital Verdict', mark: 0.55, orbital: true },
      ] },
  },
};

const ENEMIES = {
  driftling: { hp: 16, speed: 0.085, armor: 0, bounty: 4, color: '#7c88c9', r: 9, label: 'Driftling', tags: ['swarm'] },
  skiff: { hp: 10, speed: 0.145, armor: 0, bounty: 5, color: '#ff8fb4', r: 7, label: 'Skiff Raider', tags: ['fast'] },
  spark: { hp: 9, speed: 0.155, armor: 0, bounty: 3, color: '#7dd3fc', r: 6, label: 'Spark Drone', tags: ['swarm', 'fast'] },
  needle: { hp: 14, speed: 0.18, armor: 0, bounty: 5, color: '#ff8fb4', r: 7, label: 'Needlewing', tags: ['fast'] },
  bulwark: { hp: 70, speed: 0.052, armor: 4, bounty: 13, color: '#c98b4a', r: 12, label: 'Bulwark', tags: ['armor'] },
  prism: { hp: 36, speed: 0.075, armor: 1, shield: 42, shieldRegen: 4, bounty: 12, color: '#6fdfff', r: 10, label: 'Prism Skiff', tags: ['shield'] },
  ghost: { hp: 26, speed: 0.11, armor: 0, cloak: true, bounty: 14, color: '#b25cff', r: 10, label: 'Ghost Manta', tags: ['cloak'] },
  splitter: { hp: 38, speed: 0.082, armor: 0, splitTo: 'spark', splitCount: 3, bounty: 12, color: '#f97316', r: 11, label: 'Splitter Pod', tags: ['swarm', 'carrier'] },
  repair: { hp: 52, speed: 0.058, armor: 1, repairAura: 11, bounty: 18, color: '#5be6a0', r: 12, label: 'Repair Frigate', tags: ['support'] },
  jammer: { hp: 48, speed: 0.064, armor: 1, jammer: 0.34, bounty: 18, color: '#fb7185', r: 12, label: 'Jammer Corvette', tags: ['support'] },
  phase: { hp: 30, speed: 0.12, armor: 0, phase: true, bounty: 16, color: '#a78bfa', r: 9, label: 'Phase Skimmer', tags: ['phase', 'fast'] },
  carrier: { hp: 135, speed: 0.042, armor: 2, carrier: true, bounty: 32, color: '#38bdf8', r: 16, label: 'Drone Carrier', tags: ['carrier', 'support'] },
  leviathan: { hp: 280, speed: 0.028, armor: 7, controlResist: 0.55, bounty: 52, color: '#f59e0b', r: 20, label: 'Leviathan Barge', tags: ['armor', 'boss'] },
  colossus: { hp: 950, speed: 0.032, armor: 6, bounty: 180, color: '#ff4d8d', r: 22, label: 'Voidmaw Colossus', boss: true, tags: ['boss', 'armor'] },
  dreadnought: { hp: 1450, speed: 0.024, armor: 8, shield: 220, shieldRegen: 7, bounty: 260, color: '#ff4d8d', r: 27, label: 'Dreadnought', boss: true, dreadnought: true, tags: ['boss', 'armor', 'shield', 'carrier', 'support'] },
};

const SENDS = {
  spark: { id: 'spark', name: 'Spark Drones', kind: 'fleet', cost: 35, reactor: 3, type: 'spark', count: 8, gap: 180, tags: ['Swarm', 'Fast'] },
  needle: { id: 'needle', name: 'Needlewing Rush', kind: 'fleet', cost: 45, reactor: 4, type: 'needle', count: 5, gap: 240, tags: ['Fast'] },
  bulwark: { id: 'bulwark', name: 'Bulwark Line', kind: 'fleet', cost: 60, reactor: 5, type: 'bulwark', count: 3, gap: 520, tags: ['Armor'] },
  prism: { id: 'prism', name: 'Prism Skiffs', kind: 'fleet', cost: 70, reactor: 6, type: 'prism', count: 3, gap: 460, tags: ['Shield'] },
  splitter: { id: 'splitter', name: 'Splitter Pods', kind: 'fleet', cost: 75, reactor: 6, type: 'splitter', count: 3, gap: 520, tags: ['Swarm', 'Carrier'] },
  ghost: { id: 'ghost', name: 'Ghost Mantas', kind: 'tactical', cost: 95, cooldown: 11, type: 'ghost', count: 4, gap: 420, tags: ['Cloak'] },
  repair: { id: 'repair', name: 'Repair Frigate', kind: 'tactical', cost: 105, cooldown: 12, type: 'repair', count: 1, gap: 0, escort: ['bulwark', 'bulwark'], formation: 'Iron Convoy', tags: ['Support'] },
  jammer: { id: 'jammer', name: 'Jammer Corvette', kind: 'tactical', cost: 110, cooldown: 12, type: 'jammer', count: 1, gap: 0, escort: ['ghost', 'ghost'], formation: 'Silent Running', tags: ['Support', 'Cloak'] },
  phase: { id: 'phase', name: 'Phase Skimmers', kind: 'tactical', cost: 115, cooldown: 13, type: 'phase', count: 4, gap: 360, tags: ['Phase'] },
  carrier: { id: 'carrier', name: 'Drone Carrier', kind: 'tactical', cost: 150, cooldown: 16, type: 'carrier', count: 1, gap: 0, escort: ['phase', 'phase'], formation: 'Carrier Strike', tags: ['Carrier'] },
  dreadnought: { id: 'dreadnought', name: 'Dreadnought', kind: 'tactical', cost: 240, cooldown: 28, type: 'dreadnought', count: 1, gap: 0, formation: 'Dreadnought breach', tags: ['Boss'] },
};

const CAMPAIGN_WAVES = [
  [{ type: 'spark', count: 10, gap: 520 }],
  [{ type: 'needle', count: 8, gap: 470 }, { type: 'driftling', count: 8, gap: 560, delay: 1600 }],
  [{ type: 'prism', count: 4, gap: 760 }, { type: 'spark', count: 12, gap: 380, delay: 900 }],
  [{ type: 'bulwark', count: 5, gap: 920 }, { type: 'splitter', count: 3, gap: 820, delay: 1200 }],
  [{ type: 'ghost', count: 5, gap: 620 }, { type: 'repair', count: 2, gap: 1200, delay: 1500 }, { type: 'needle', count: 8, gap: 420, delay: 2400 }],
  [{ type: 'jammer', count: 2, gap: 1600 }, { type: 'prism', count: 5, gap: 720, delay: 500 }, { type: 'phase', count: 5, gap: 520, delay: 1800 }],
  [{ type: 'carrier', count: 1, gap: 0 }, { type: 'bulwark', count: 7, gap: 760, delay: 900 }, { type: 'ghost', count: 4, gap: 560, delay: 2200 }],
  [{ type: 'dreadnought', count: 1, gap: 0 }, { type: 'splitter', count: 5, gap: 580, delay: 900 }, { type: 'repair', count: 2, gap: 1100, delay: 1800 }],
];
function endlessWave(n) {
  const tier = Math.floor((n - 1) / 3);
  const hpMul = 1 + tier * 0.22;
  const countMul = 1 + Math.floor(tier / 2) * 0.5;
  const entries = [{ type: 'spark', count: Math.round((8 + tier * 2) * countMul), gap: Math.max(220, 560 - tier * 28) }];
  if (n >= 2) entries.push({ type: 'needle', count: Math.round((3 + tier * 2) * countMul), gap: Math.max(190, 470 - tier * 24), delay: 700 });
  if (n >= 3) entries.push({ type: 'prism', count: Math.round((2 + tier) * countMul), gap: 720, delay: 1200 });
  if (n >= 4) entries.push({ type: 'bulwark', count: Math.round((2 + tier) * countMul), gap: 860, delay: 1400 });
  if (n >= 5 && n % 2 === 1) entries.push({ type: 'ghost', count: Math.round(2 + tier * 0.6), gap: 600, delay: 1600 });
  if (n >= 6 && n % 3 === 0) entries.push({ type: 'repair', count: 1 + Math.floor(tier / 2), gap: 1300, delay: 1800 });
  if (n >= 7 && n % 4 === 0) entries.push({ type: 'jammer', count: 1 + Math.floor(tier / 3), gap: 1500, delay: 1900 });
  if (n >= 8 && n % 5 === 0) entries.push({ type: 'carrier', count: 1, gap: 0, delay: 1100 });
  if (n % 10 === 0) entries.push({ type: 'dreadnought', count: 1, gap: 0, delay: 400 });
  else if (n % 6 === 0) entries.push({ type: 'colossus', count: 1, gap: 0, delay: 400 });
  return { entries, hpMul };
}

// ---------------------------------------------------------------------
// 3. DOM references
// ---------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const screens = { menu: $('#screenMenu'), tutorial: $('#screenTutorial'), lobby: $('#screenDuelLobby'), game: $('#screenGame') };
let currentScreen = 'menu';
function showScreen(name) {
  for (const key in screens) screens[key].hidden = key !== name;
  currentScreen = name;
}

const canvas = $('[data-canvas]'), ctx = canvas.getContext('2d');
const fieldEl = $('[data-field]');
const hud = { gold: $('[data-hud-gold]'), wave: $('[data-hud-wave]'), lives: $('[data-hud-lives]'), score: $('[data-hud-score]'), mode: $('[data-hud-mode]'), livesChip: document.querySelector('.sg-chip-lives') };
const waveBanner = $('[data-wave-banner]'), bossBanner = $('[data-boss-banner]');
const dockDefenders = $('[data-dock-defenders]'), dockSelected = $('[data-dock-selected]'), dockPressure = $('[data-dock-pressure]');
const commanderBtn = $('[data-commander-btn]'), commanderFill = $('[data-commander-fill]');
const opponentPanel = $('[data-opponent-panel]'), oppName = $('[data-opp-name]'), oppLives = $('[data-opp-lives]'), oppWave = $('[data-opp-wave]'), oppStatus = $('[data-opp-status]'), oppBar = $('[data-opp-bar]'), oppNote = $('[data-opp-note]');
const toastEl = $('[data-toast]');
const overlayPause = $('[data-overlay-pause]'), overlaySettings = $('[data-overlay-settings]'), overlayResults = $('[data-overlay-results]');
const resultsTitle = $('[data-results-title]'), resultsSub = $('[data-results-sub]'), resultsGrid = $('[data-results-grid]'), rematchBtn = $('[data-results-rematch]');
const lobbyRoster = $('[data-lobby-roster]'), lobbyNote = $('[data-lobby-note]'), lobbyTitle = $('[data-lobby-title]'), lobbyCopy = $('[data-lobby-copy]'), lobbyStartBtn = $('[data-lobby-start]');
const rankEls = { rank: $('[data-rank]'), fill: $('[data-rank-fill]'), bestCampaign: $('[data-best-campaign]'), bestEndless: $('[data-best-endless]'), duelCard: $('[data-pp-duel-card]'), duelSub: $('[data-duel-card-sub]'), unlockNote: $('[data-unlock-note]') };
const tutorialBody = $('[data-tutorial-body]'), tutorialDots = $('[data-tutorial-dots]');

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

// ---------------------------------------------------------------------
// 4. Audio (WebAudio synthesis only — no embedded media)
// ---------------------------------------------------------------------
let audioCtx = null;
let hostSoundOn = true, localMuted = false, localVolPct = 70, hostReducedMotion = false, localReducedMotion = false;
function ensureCtx() { if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio available */ } } return audioCtx; }
function effectiveVolume() { return (hostSoundOn && !localMuted) ? localVolPct / 100 : 0; }
function reducedMotion() { return hostReducedMotion || localReducedMotion; }
function applyReducedMotionClass() { document.body.classList.toggle('reduced', reducedMotion()); }
function tone(freq, dur, type, gainMul, delay) {
  const vol = effectiveVolume(); if (vol <= 0) return;
  const ctxA = ensureCtx(); if (!ctxA) return;
  const t0 = ctxA.currentTime + (delay || 0);
  const o = ctxA.createOscillator(), g = ctxA.createGain();
  o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
  const peak = Math.max(0.0006, 0.16 * vol * (gainMul || 1));
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctxA.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function noiseBurst(dur, gainMul, delay) {
  const vol = effectiveVolume(); if (vol <= 0) return;
  const ctxA = ensureCtx(); if (!ctxA) return;
  const t0 = ctxA.currentTime + (delay || 0);
  const size = Math.max(1, Math.floor(ctxA.sampleRate * dur));
  const buffer = ctxA.createBuffer(1, size, ctxA.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
  const src = ctxA.createBufferSource(); src.buffer = buffer;
  const g = ctxA.createGain();
  g.gain.setValueAtTime(Math.max(0.0006, 0.22 * vol * (gainMul || 1)), t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(g).connect(ctxA.destination);
  src.start(t0);
}
function sfx(name) {
  switch (name) {
    case 'place': tone(520, 0.09, 'triangle', 0.8); tone(780, 0.07, 'triangle', 0.5, 0.03); break;
    case 'upgrade': tone(440, 0.08, 'square', 0.7); tone(660, 0.1, 'square', 0.7, 0.06); tone(880, 0.12, 'square', 0.7, 0.12); break;
    case 'fire-glare': tone(920, 0.045, 'square', 0.28); break;
    case 'fire-arc': tone(300, 0.09, 'sawtooth', 0.32); break;
    case 'fire-frost': tone(1400, 0.06, 'sine', 0.25); break;
    case 'fire-vane': tone(180, 0.16, 'sawtooth', 0.5); noiseBurst(0.05, 0.25); break;
    case 'death': noiseBurst(0.14, 0.5); tone(150, 0.18, 'sawtooth', 0.35, 0.02); break;
    case 'leak': tone(160, 0.25, 'sawtooth', 0.7); tone(120, 0.3, 'sawtooth', 0.6, 0.08); break;
    case 'wave': tone(392, 0.16, 'triangle', 0.6); tone(523, 0.2, 'triangle', 0.6, 0.14); break;
    case 'boss': tone(110, 0.4, 'sawtooth', 0.8); tone(146, 0.4, 'sawtooth', 0.7, 0.15); break;
    case 'commander': tone(660, 0.1, 'square', 0.7); tone(880, 0.12, 'square', 0.7, 0.08); tone(1180, 0.18, 'square', 0.7, 0.16); break;
    case 'victory': tone(523, 0.16, 'triangle', 0.7); tone(659, 0.16, 'triangle', 0.7, 0.14); tone(784, 0.24, 'triangle', 0.7, 0.28); break;
    case 'defeat': tone(220, 0.3, 'sawtooth', 0.6); tone(160, 0.4, 'sawtooth', 0.6, 0.18); break;
    case 'click': tone(700, 0.04, 'triangle', 0.4); break;
    case 'pressure-send': tone(500, 0.05, 'square', 0.4); tone(700, 0.05, 'square', 0.4, 0.05); break;
    case 'pressure-hit': tone(200, 0.12, 'sawtooth', 0.5); noiseBurst(0.08, 0.4); break;
  }
}
function fireSfxFor(defId) { sfx('fire-' + defId); }

// ---------------------------------------------------------------------
// 5. Meta save / progression (flat, primitives-only — matches the
//    server's safePlayState, which drops any non-string/number/boolean
//    top-level value; also round-tripped via the "restore" host->game
//    message, the same real mechanism app/games/phantom-rumble.html and
//    app/games/sudoku-signal.html already use).
// ---------------------------------------------------------------------
const META_DEFAULT = { rank: 1, xp: 0, bestWaveCampaign: 0, bestWaveEndless: 0, totalRuns: 0, winsBattle: 0, lossesBattle: 0, tutorialSeen: false, soundVol: 70, reducedMotion: false, unlockedCsv: 'glare,arc' };
let meta = { ...META_DEFAULT };
function clampInt(v, min, max, fallback) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function unlockedSet() { return new Set(String(meta.unlockedCsv || 'glare,arc').split(',').filter(Boolean)); }
function recomputeUnlocks() {
  const set = new Set(['glare', 'arc']);
  if (meta.rank >= UNLOCK_RANK.frost) set.add('frost');
  if (meta.rank >= UNLOCK_RANK.vane) set.add('vane');
  meta.unlockedCsv = [...set].join(',');
}
function applyMetaFromState(state) {
  if (!state || typeof state !== 'object') return;
  meta.rank = clampInt(state.rank, 1, 999, meta.rank);
  meta.xp = clampInt(state.xp, 0, 10000000, meta.xp);
  meta.bestWaveCampaign = clampInt(state.bestWaveCampaign, 0, 999, meta.bestWaveCampaign);
  meta.bestWaveEndless = clampInt(state.bestWaveEndless, 0, 9999, meta.bestWaveEndless);
  meta.totalRuns = clampInt(state.totalRuns, 0, 999999, meta.totalRuns);
  meta.winsBattle = clampInt(state.winsBattle, 0, 999999, meta.winsBattle);
  meta.lossesBattle = clampInt(state.lossesBattle, 0, 999999, meta.lossesBattle);
  meta.tutorialSeen = !!state.tutorialSeen;
  meta.soundVol = clampInt(state.soundVol, 0, 100, meta.soundVol);
  meta.reducedMotion = !!state.reducedMotion;
  if (typeof state.unlockedCsv === 'string' && state.unlockedCsv) meta.unlockedCsv = state.unlockedCsv;
  recomputeUnlocks();
  localVolPct = meta.soundVol; localReducedMotion = meta.reducedMotion;
  applyReducedMotionClass();
}
function metaStatePayload() {
  return { rank: meta.rank, xp: meta.xp, bestWaveCampaign: meta.bestWaveCampaign, bestWaveEndless: meta.bestWaveEndless, totalRuns: meta.totalRuns, winsBattle: meta.winsBattle, lossesBattle: meta.lossesBattle, tutorialSeen: meta.tutorialSeen, soundVol: meta.soundVol, reducedMotion: meta.reducedMotion, unlockedCsv: meta.unlockedCsv };
}
function grantRunRewards(waveReached, won) {
  const xpGain = Math.max(0, waveReached) * 10 + (won ? 100 : 0) + Math.min(killCount, 200);
  meta.xp += xpGain; meta.totalRuns++;
  const newRank = 1 + Math.floor(meta.xp / 300);
  const rankedUp = newRank > meta.rank;
  meta.rank = newRank;
  recomputeUnlocks();
  return { xpGain, rankedUp };
}

// ---------------------------------------------------------------------
// 6. Run state
// ---------------------------------------------------------------------
let mode = null; // 'campaign' | 'endless' | 'skirmish' | 'battle'
let running = false, paused = false, runCompleted = false, myResult = null;
let gold = 0, lives = 0, maxLives = 20, wave = 0, totalWaves = 0, score = 0, killCount = 0;
let sentinels = [], enemies = [], particles = [];
let spawnQueue = [], waveActive = false, waveClockMs = 0;
let prepRemaining = 0;
let selectedSlot = -1, placingDef = null;
let commanderActive = false, commanderCooldown = 0, commanderTimer = 0;
const COMMANDER_COOLDOWN = 25, COMMANDER_DURATION = 6;
let pressureCooldown = 0, sendTab = 'fleet', reactorOutput = 0, reactorBank = 0, sendCombo = [];
let sendCooldowns = {};
let bot = null;
let _uid = 1; function uid() { return _uid++; }

function newBot(difficulty) {
  const diffMul = { easy: 0.75, standard: 1.0, hard: 1.3 }[difficulty] || 1.0;
  return { lives: 20, maxLives: 20, wave: 0, gold: 180, alive: true, result: null, diffMul, jamStacks: 0, label: 'Rival AI' };
}
function botAdvanceWave(theBot, waveNo, isBoss) {
  if (!theBot || !theBot.alive) return;
  const jam = 1 + Math.min(2, theBot.jamStacks || 0) * 0.35;
  theBot.jamStacks = 0;
  const pressure = (isBoss ? 4.4 : 1) * (1 + waveNo * 0.12) * jam / theBot.diffMul;
  const loss = Math.max(0, Math.round(pressure * (0.55 + Math.random() * 0.8)));
  theBot.lives = Math.max(0, theBot.lives - loss);
  theBot.wave = waveNo;
  theBot.gold += 40 + waveNo * 6;
  if (theBot.lives <= 0) { theBot.alive = false; theBot.result = 'defeated'; }
  if (mode === 'skirmish' && running && Math.random() < 0.4) {
    const pool = waveNo >= 6 ? ['spark', 'needle', 'bulwark', 'prism', 'ghost', 'jammer'] : ['spark', 'needle', 'bulwark'];
    const kind = pool[Math.floor(Math.random() * pool.length)];
    applyPressureToPlayer(kind, true);
  }
}
function sendPower(send) {
  if (!send) return 0;
  const base = ENEMIES[send.type] || ENEMIES.spark;
  return Math.round((base.hp / 18 + base.speed * 28 + base.armor * 2 + (base.shield || 0) / 18 + (base.boss ? 18 : 0) + (base.cloak ? 6 : 0) + (base.jammer ? 8 : 0) + (base.repairAura ? 7 : 0)) * Math.max(1, send.count || 1));
}
function formationLine(send) {
  if (send?.formation) return send.formation;
  const recent = sendCombo.slice(-3).map((s) => s.id);
  if (recent.includes('bulwark') && recent.includes('repair')) return 'Iron Convoy';
  if (recent.includes('ghost') && recent.includes('jammer')) return 'Silent Running';
  if (recent.includes('splitter') && recent.includes('needle')) return 'Fracture Rush';
  if (recent.includes('carrier') && recent.includes('phase')) return 'Carrier Strike';
  if (recent.includes('bulwark') && recent.includes('dreadnought')) return 'Siege Column';
  return '';
}
function queueEnemySend(send, hpMul) {
  if (!send) return;
  const start = waveClockMs + 450;
  const types = [];
  for (let i = 0; i < (send.count || 1); i++) types.push(send.type);
  for (const t of (send.escort || [])) types.push(t);
  types.forEach((type, i) => spawnQueue.push({ time: start + i * (send.gap || 260), type, hpMul: hpMul || 1 }));
  spawnQueue.sort((a, b) => a.time - b.time);
  waveActive = true;
}
function applyPressureToBot(kind) {
  if (!bot || !bot.alive) return;
  const send = SENDS[kind];
  if (!send) return;
  const pressure = Math.max(1, Math.round(sendPower(send) / 18));
  bot.lives = Math.max(0, bot.lives - pressure);
  if (send.tags?.includes('Support')) bot.jamStacks = (bot.jamStacks || 0) + 1;
  if (bot.lives <= 0) { bot.alive = false; bot.result = 'defeated'; }
}
function applyPressureToPlayer(kind, fromBot) {
  const send = SENDS[kind];
  if (!send) return;
  queueEnemySend(send, 1 + wave * 0.025);
  if (send.tags?.includes('Support')) commanderCooldown = Math.min(COMMANDER_COOLDOWN + 6, commanderCooldown + 4);
  sfx('pressure-hit');
  const line = formationLine(send);
  toast(fromBot ? `Rival AI sent ${send.name}.` : `${line ? line + ' - ' : ''}${send.name} entering your lane.`);
}

// ---------------------------------------------------------------------
// 7. Room battle state (self-election + shared duel envelope)
// ---------------------------------------------------------------------
const battle = {
  active: false, roleKnown: false, amIHost: false, myProbeId: null, pendingHello: false, helloSentAt: 0,
  participants: [], readyStates: {}, hostControls: null, botSlots: [], duel: null, lastSeq: 0, _lastBroadcast: 0, consumedStartedAt: null,
};
function tryResolveRole(ms) {
  if (battle.roleKnown) return;
  if (!battle.pendingHello) {
    battle.myProbeId = 'p' + Math.random().toString(36).slice(2, 9);
    battle.pendingHello = true; battle.helloSentAt = Date.now();
    matchAction({ duelHello: { from: battle.myProbeId, ts: Date.now() } }, 'merge');
    return;
  }
  if (ms.duelHello && ms.duelHello.from === battle.myProbeId) { battle.amIHost = true; battle.roleKnown = true; return; }
  if (ms.duelHello && ms.duelHello.from && ms.duelHello.from !== battle.myProbeId) { battle.amIHost = false; battle.roleKnown = true; return; }
  if (Date.now() - battle.helloSentAt > 9000) { battle.amIHost = false; battle.roleKnown = true; }
}
function pushDuelState(patch) {
  battle.duel = { ...(battle.duel || {}), ...patch };
  matchAction({ duel: battle.duel }, 'merge');
}
function maybeBroadcastHostStatus(force) {
  if (mode !== 'battle' || !battle.roleKnown || !battle.amIHost) return;
  const nowMs = Date.now();
  if (!force && nowMs - battle._lastBroadcast < 1800) return;
  battle._lastBroadcast = nowMs;
  pushDuelState({ hostStatus: { label: 'Host', lives, maxLives, wave, totalWaves, gold, alive: running && lives > 0, result: myResult, updatedAt: nowMs } });
}
function applyDuelUpdate() {
  if (mode !== 'battle' || currentScreen !== 'game') return;
  const log = (battle.duel && battle.duel.pressureLog) || [];
  for (const entry of log) {
    if (entry.seq <= battle.lastSeq) continue;
    battle.lastSeq = entry.seq;
    if (entry.from === 'host' && !battle.amIHost) applyPressureToPlayer(entry.type, false);
  }
}
function guestResolveResult() {
  const h = battle.duel && battle.duel.hostStatus;
  if (!h) return null;
  const myDone = !running;
  const hostDone = h.alive === false;
  if (!myDone && !hostDone) return null;
  if (myResult === 'defeat' && hostDone) {
    if (wave > h.wave) return 'win';
    if (wave < h.wave) return 'lose';
    return 'draw';
  }
  if (myResult === 'defeat' && !hostDone) return null;
  if (myResult === 'victory' && hostDone) return 'win';
  if (myResult === 'victory' && !hostDone) return null;
  return null;
}

// ---------------------------------------------------------------------
// 8. Canvas sizing (letterboxed 16:9 logical world)
// ---------------------------------------------------------------------
let scale = 1, offX = 0, offY = 0, cssW = REF_W, cssH = REF_H;
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cssW = canvas.clientWidth || REF_W; cssH = canvas.clientHeight || REF_H;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = Math.min(cssW / REF_W, cssH / REF_H) || 1;
  offX = (cssW - REF_W * scale) / 2;
  offY = (cssH - REF_H * scale) / 2;
}
function toPx(rx, ry) { return [offX + rx * scale, offY + ry * scale]; }
if ('ResizeObserver' in window) new ResizeObserver(() => resizeCanvas()).observe(fieldEl);
window.addEventListener('resize', resizeCanvas);

// ---------------------------------------------------------------------
// 9. Simulation
// ---------------------------------------------------------------------
function pathFor(s) { return s && s.path ? UPGRADE_PATHS[s.defId]?.[s.path] : null; }
function pathLevel(s) { return Math.max(0, Math.min(4, Number(s?.pathLevel) || 0)); }
function pathLabel(s) {
  const p = pathFor(s); const level = pathLevel(s);
  if (!p || level <= 0) return 'Core T1';
  return level >= 4 ? p.ultimate : p.steps[level - 1].label;
}
function applyStep(stats, step) {
  if (!step) return;
  if (step.dmgMul) stats.dmg *= step.dmgMul;
  if (step.rofMul) stats.rof *= step.rofMul;
  if (step.rangeAdd) stats.range += step.rangeAdd;
  if (step.pierceAdd) stats.pierce = (stats.pierce || 0) + step.pierceAdd;
  if (step.splashAdd) stats.splash = (stats.splash || 0) + step.splashAdd;
  for (const key of ['slow', 'slowDur', 'detect', 'shieldBreak', 'disrupt', 'pull', 'vuln', 'mark', 'chain', 'freeze', 'beam', 'barrage', 'dawn', 'supportAura', 'stormField', 'blackout', 'iceHalo', 'avalanche', 'orbital', 'eliteBonus', 'execute', 'phaseBreak']) {
    if (step[key] !== undefined) {
      if (typeof step[key] === 'number' && typeof stats[key] === 'number' && key !== 'slow' && key !== 'slowDur') stats[key] += step[key];
      else stats[key] = step[key];
    }
  }
}
function currentStats(s) {
  const def = DEFENDERS[s.defId];
  const stats = { ...def.base };
  const p = pathFor(s);
  for (let i = 0; p && i < pathLevel(s); i++) applyStep(stats, p.steps[i]);
  stats.dmg = Math.max(1, Math.round(stats.dmg * 10) / 10);
  stats.rof = Math.max(0.15, Math.round(stats.rof * 100) / 100);
  stats.range = Math.round(stats.range);
  return stats;
}
function enemyHas(enemy, tag) { return (enemy.tags || []).includes(tag); }
function dealDamage(enemy, dmg, pierce, stats) {
  let amount = dmg;
  if (enemy.vulnerableUntil > simTime) amount *= 1 + (enemy.vulnerableFactor || 0);
  if (enemy.markedUntil > simTime) amount *= 1 + (enemy.markedFactor || 0);
  if (stats?.swarmBonus && enemyHas(enemy, 'swarm')) amount *= stats.swarmBonus;
  if (stats?.eliteBonus && (enemy.boss || enemyHas(enemy, 'support') || enemyHas(enemy, 'cloak') || enemyHas(enemy, 'phase'))) amount *= stats.eliteBonus;
  if (stats?.execute && enemy.hp / enemy.maxHp < stats.execute) amount *= 3.4;
  if (enemy.shield > 0) {
    const shieldDamage = amount + (stats?.shieldBreak || 0);
    enemy.shield = Math.max(0, enemy.shield - shieldDamage);
    if (enemy.shield > 0) return;
    amount = Math.max(1, shieldDamage * 0.25);
  }
  const armor = Math.max(0, enemy.armor - (pierce || 0));
  enemy.hp -= Math.max(1, amount - armor);
}
function spawnEnemy(type, hpMul) {
  const base = ENEMIES[type]; if (!base) return;
  const p = pointAtT(0);
  enemies.push({
    id: uid(), type, hp: base.hp * (hpMul || 1), maxHp: base.hp * (hpMul || 1), armor: base.armor, bounty: base.bounty,
    speed: base.speed, t: 0, x: p.x, y: p.y, alive: true, boss: !!base.boss, slowUntil: 0, slowFactor: 0,
    shield: base.shield || 0, maxShield: base.shield || 0, shieldRegen: base.shieldRegen || 0, tags: base.tags || [],
    cloak: !!base.cloak, phase: !!base.phase, nextPhaseAt: base.phase ? simTime + 1.6 : 0, phasedUntil: 0,
    repairAura: base.repairAura || 0, jammer: base.jammer || 0, carrier: !!base.carrier, carrierTimer: base.carrier ? 2.5 : 0,
    splitTo: base.splitTo || null, splitCount: base.splitCount || 0, dreadnought: !!base.dreadnought, modules: base.dreadnought ? { shield: true, hangar: true, jammer: true } : null,
    controlResist: base.controlResist || 0, vulnerableUntil: 0, vulnerableFactor: 0, markedUntil: 0, markedFactor: 0, revealedUntil: 0, disruptedUntil: 0,
  });
}
function loadWave(entries, hpMul) {
  spawnQueue = [];
  for (const entry of entries) {
    const start = entry.delay || 0;
    for (let i = 0; i < entry.count; i++) spawnQueue.push({ time: start + i * entry.gap, type: entry.type, hpMul: hpMul || 1 });
  }
  spawnQueue.sort((a, b) => a.time - b.time);
  waveClockMs = 0; waveActive = true;
}
function scheduleWave(n) {
  wave = n;
  let entries, hpMul = 1, isBoss = false;
  if (mode === 'endless') { const w = endlessWave(n); entries = w.entries; hpMul = w.hpMul; }
  else { const idx = n - 1; if (idx >= CAMPAIGN_WAVES.length) return; entries = CAMPAIGN_WAVES[idx]; }
  isBoss = entries.some((e) => ENEMIES[e.type]?.boss);
  waveBanner.hidden = isBoss; bossBanner.hidden = !isBoss;
  if (isBoss) bossBanner.textContent = entries.some((e) => e.type === 'dreadnought') ? 'BOSS SIGNAL - DREADNOUGHT' : 'BOSS SIGNAL - VOIDMAW COLOSSUS';
  if (isBoss) sfx('boss');
  if (!isBoss) { waveBanner.textContent = `Wave ${n}${mode !== 'endless' ? '/' + totalWaves : ''} inbound`; waveBanner.hidden = false; }
  loadWave(entries, hpMul);
  updateHud();
}
function handleWaveCleared() {
  const bonus = 20 + wave * 5;
  gold += bonus; score += wave * 30;
  sfx('wave');
  reportProgress();
  if (mode === 'battle') maybeBroadcastHostStatus(false);
  if (mode === 'skirmish') botAdvanceWave(bot, wave, false);
  const isLast = mode !== 'endless' && wave >= totalWaves;
  if (isLast) { finishRun('victory'); return; }
  beginPrep(mode === 'endless' ? 3.5 : 4.5);
}
function beginPrep(seconds) {
  prepRemaining = seconds;
  waveBanner.hidden = false; bossBanner.hidden = true;
  waveBanner.textContent = `Next wave in ${Math.ceil(seconds)}s`;
}
function leak(e) {
  e.alive = false;
  lives = Math.max(0, lives - (e.boss ? 5 : 1));
  sfx('leak'); flashSpireHit();
  updateHud();
  if (mode === 'battle' && battle.amIHost) maybeBroadcastHostStatus(false);
  if (lives <= 0 && running && !runCompleted) finishRun('defeat');
}
let spireFlash = 0;
function flashSpireHit() { spireFlash = 0.35; }
function tickEnemyAbilities(dt) {
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.shieldRegen && e.shield < e.maxShield && e.disruptedUntil <= simTime) e.shield = Math.min(e.maxShield, e.shield + e.shieldRegen * dt);
    if (e.phase && e.nextPhaseAt <= simTime && e.disruptedUntil <= simTime) {
      e.phasedUntil = simTime + 0.85;
      e.nextPhaseAt = simTime + 3.2;
    }
    if (e.repairAura && e.disruptedUntil <= simTime) {
      for (const other of enemies) {
        if (other === e || !other.alive || other.hp >= other.maxHp) continue;
        if (Math.hypot(other.x - e.x, other.y - e.y) <= 82) other.hp = Math.min(other.maxHp, other.hp + e.repairAura * dt);
      }
    }
    if (e.carrier && e.disruptedUntil <= simTime) {
      e.carrierTimer -= dt;
      if (e.carrierTimer <= 0) {
        e.carrierTimer = e.dreadnought && e.modules && e.modules.hangar ? 1.6 : 2.7;
        const p = pointAtT(Math.max(0, e.t - 0.025));
        const base = ENEMIES.spark;
        enemies.push({ id: uid(), type: 'spark', hp: base.hp, maxHp: base.hp, armor: base.armor, bounty: 1, speed: base.speed, t: Math.max(0, e.t - 0.025), x: p.x, y: p.y, alive: true, boss: false, slowUntil: 0, slowFactor: 0, shield: 0, maxShield: 0, tags: base.tags || [] });
      }
    }
  }
}
function sentinelJamFactor(s) {
  const [sx, sy] = SLOT_PX[s.slotIndex];
  let factor = 1;
  for (const e of enemies) {
    if (!e.alive || !e.jammer || e.disruptedUntil > simTime) continue;
    if (Math.hypot(e.x - sx, e.y - sy) <= 150) factor *= Math.max(0.45, 1 - e.jammer);
  }
  return factor;
}
function killEnemy(e) {
  if (!e.alive) return;
  e.alive = false;
  if (e.splitTo && e.splitCount) {
    const base = ENEMIES[e.splitTo];
    for (let i = 0; i < e.splitCount; i++) {
      const p = pointAtT(Math.max(0, e.t - i * 0.006));
      enemies.push({ id: uid(), type: e.splitTo, hp: base.hp, maxHp: base.hp, armor: base.armor, bounty: base.bounty, speed: base.speed * (1 + i * 0.03), t: Math.max(0, e.t - i * 0.006), x: p.x, y: p.y, alive: true, boss: false, slowUntil: 0, slowFactor: 0, shield: 0, maxShield: 0, tags: base.tags || [] });
    }
  }
  gold += e.bounty; score += e.bounty * 2 + (e.boss ? 100 : 0); killCount++;
  sfx('death'); spawnBurst(e.x, e.y, ENEMIES[e.type].color);
}

function findTarget(s, stats) {
  const [sx, sy] = SLOT_PX[s.slotIndex];
  let best = null, bestT = -1;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.cloak && e.revealedUntil <= simTime && !stats.detect) continue;
    if (e.phasedUntil > simTime && !stats.phaseBreak) continue;
    const d = Math.hypot(e.x - sx, e.y - sy);
    if (d <= stats.range && e.t > bestT) { best = e; bestT = e.t; }
  }
  return best;
}
function chainTargets(origin, target, count, radius) {
  const hits = [];
  let cursor = target;
  for (let i = 0; i < count; i++) {
    let next = null, best = Infinity;
    for (const e of enemies) {
      if (!e.alive || e === target || hits.includes(e)) continue;
      const d = Math.hypot(e.x - cursor.x, e.y - cursor.y);
      if (d < best && d <= radius) { best = d; next = e; }
    }
    if (!next) break;
    hits.push(next); cursor = next;
  }
  return hits;
}
function fire(s, stats, target) {
  const [sx, sy] = SLOT_PX[s.slotIndex];
  const boostDmg = commanderActive ? 1.6 : 1;
  const dmg = stats.dmg * boostDmg;
  if (stats.detect) target.revealedUntil = Math.max(target.revealedUntil || 0, simTime + 3.5);
  if (stats.disrupt) target.disruptedUntil = Math.max(target.disruptedUntil || 0, simTime + 2.2 + stats.disrupt);
  if (stats.vuln) { target.vulnerableUntil = Math.max(target.vulnerableUntil || 0, simTime + 2.4); target.vulnerableFactor = Math.max(target.vulnerableFactor || 0, stats.vuln); }
  if (stats.mark) { target.markedUntil = Math.max(target.markedUntil || 0, simTime + 3.4); target.markedFactor = Math.max(target.markedFactor || 0, stats.mark); }
  if (stats.pull && !target.boss) target.t = Math.max(0, target.t - stats.pull * (1 - (target.controlResist || 0)));
  dealDamage(target, dmg, stats.pierce || 0, stats);
  particles.push({ type: stats.beam ? 'beam' : 'tracer', x1: sx, y1: sy, x2: target.x, y2: target.y, color: DEFENDERS[s.defId].color, life: stats.beam ? 0.2 : 0.12, age: 0 });
  fireSfxFor(s.defId);
  if (stats.chain) {
    let falloff = 0.72;
    for (const e of chainTargets(s, target, stats.chain, 92 + (stats.stormField ? 45 : 0))) {
      dealDamage(e, dmg * falloff, stats.pierce || 0, stats);
      particles.push({ type: 'tracer', x1: target.x, y1: target.y, x2: e.x, y2: e.y, color: DEFENDERS[s.defId].color, life: 0.16, age: 0 });
      falloff *= 0.78;
    }
  }
  if (stats.splash) {
    for (const e of enemies) {
      if (e === target || !e.alive) continue;
      if (Math.hypot(e.x - target.x, e.y - target.y) <= stats.splash) dealDamage(e, dmg * 0.7, 0, stats);
    }
  }
  if (stats.slow) {
    target.slowUntil = simTime + stats.slowDur;
    target.slowFactor = Math.max(target.slowFactor || 0, stats.slow);
    if (stats.freeze && target.slowFactor >= 0.72) target.slowUntil = Math.max(target.slowUntil, simTime + stats.slowDur + 1);
  }
  if (stats.avalanche && target.hp <= 0) {
    for (const e of enemies) if (e !== target && e.alive && Math.hypot(e.x - target.x, e.y - target.y) <= 76) dealDamage(e, dmg * 1.1, 0, stats);
  }
  if (stats.orbital && target.markedUntil > simTime) {
    target.orbitalHits = (target.orbitalHits || 0) + 1;
    if (target.orbitalHits % 3 === 0) dealDamage(target, dmg * 2.2, stats.pierce || 0, stats);
  }
}
let simTime = 0;
function tick(dt) {
  simTime += dt;
  if (commanderCooldown > 0) commanderCooldown = Math.max(0, commanderCooldown - dt);
  if (commanderActive) { commanderTimer -= dt; if (commanderTimer <= 0) commanderActive = false; }
  if (pressureCooldown > 0) pressureCooldown = Math.max(0, pressureCooldown - dt);
  for (const id in sendCooldowns) sendCooldowns[id] = Math.max(0, (sendCooldowns[id] || 0) - dt);
  if (reactorOutput > 0) {
    reactorBank += reactorOutput * dt / 9;
    if (reactorBank >= 1) { const payout = Math.floor(reactorBank); gold += payout; reactorBank -= payout; }
  }
  if (spireFlash > 0) spireFlash = Math.max(0, spireFlash - dt);
  updateParticles(dt);

  if (prepRemaining > 0) {
    prepRemaining -= dt;
    if (prepRemaining > 0) { waveBanner.textContent = `Next wave in ${Math.ceil(prepRemaining)}s`; return; }
    prepRemaining = 0;
    scheduleWave(wave + 1);
    return;
  }
  if (!waveActive) return;

  waveClockMs += dt * 1000;
  while (spawnQueue.length && spawnQueue[0].time <= waveClockMs) {
    const item = spawnQueue.shift();
    spawnEnemy(item.type, item.hpMul);
  }
  tickEnemyAbilities(dt);
  for (const e of enemies) {
    if (!e.alive) continue;
    const resist = e.controlResist || 0;
    const speedMul = e.slowUntil > simTime ? Math.max(0.15, 1 - (e.slowFactor || 0) * (1 - resist)) : 1;
    e.t += e.speed * speedMul * dt;
    if (e.t >= 1) { leak(e); continue; }
    const p = pointAtT(e.t); e.x = p.x; e.y = p.y;
  }
  enemies = enemies.filter((e) => e.alive);
  for (const s of sentinels) {
    s.cooldown -= dt;
    if (s.cooldown > 0) continue;
    const stats = currentStats(s);
    const target = findTarget(s, stats);
    if (!target) continue;
    fire(s, stats, target);
    const rofMul = (commanderActive ? 1.4 : 1) * sentinelJamFactor(s);
    s.cooldown = 1 / (stats.rof * rofMul);
  }
  for (const e of enemies) if (e.hp <= 0 && e.alive) killEnemy(e);
  enemies = enemies.filter((e) => e.alive);
  updateHud();

  if (waveActive && spawnQueue.length === 0 && enemies.length === 0) { waveActive = false; handleWaveCleared(); }
  if (mode === 'battle') { maybeBroadcastHostStatus(false); applyDuelUpdate(); }
  if (running && (simTime % 4 < dt)) reportProgress();
}
function spawnBurst(x, y, color) {
  if (reducedMotion()) return;
  for (let i = 0; i < 6; i++) {
    const ang = Math.random() * Math.PI * 2, spd = 40 + Math.random() * 60;
    particles.push({ type: 'spark', x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, color, life: 0.35, age: 0 });
  }
}
function updateParticles(dt) {
  for (const p of particles) { p.age += dt; if (p.type === 'spark') { p.x += p.vx * dt; p.y += p.vy * dt; } }
  particles = particles.filter((p) => p.age < p.life);
}

// ---------------------------------------------------------------------
// 10. Run lifecycle
// ---------------------------------------------------------------------
function startRun(m) {
  mode = m;
  gold = m === 'endless' ? 180 : 150;
  lives = maxLives = 20;
  wave = 0; score = 0; killCount = 0;
  sentinels = []; enemies = []; particles = [];
  spawnQueue = []; waveActive = false; prepRemaining = 0;
  commanderActive = false; commanderCooldown = 0; commanderTimer = 0; pressureCooldown = 0;
  sendTab = 'fleet'; reactorOutput = 0; reactorBank = 0; sendCooldowns = {}; sendCombo = [];
  selectedSlot = -1; placingDef = null;
  runCompleted = false; myResult = null; running = true; paused = false;
  totalWaves = m === 'endless' ? Infinity : CAMPAIGN_WAVES.length;
  bot = (m === 'skirmish') ? newBot('standard') : null;
  hud.mode.textContent = { campaign: 'Campaign', endless: 'Endless Watch', skirmish: 'Skirmish vs Bot', battle: 'Room Duel' }[m] || m;
  opponentPanel.hidden = !(m === 'skirmish' || m === 'battle');
  overlayResults.hidden = true; overlayPause.hidden = true;
  showScreen('game');
  requestAnimationFrame(resizeCanvas);
  renderDock(); renderDockSelected(); renderPressureDock(); updateHud(); renderOpponentPanel();
  beginPrep(2.5);
  host('progress', { score: 0, progress: 0 });
}
function reportProgress() {
  if (!running) return;
  const progress = mode === 'endless' ? Math.min(99, Math.round((wave / 20) * 100)) : Math.min(99, Math.round(((wave - 1) / totalWaves) * 100));
  host('score', { score, progress, state: metaStatePayload() });
}
function finishRun(kind, opts) {
  if (runCompleted) return;
  runCompleted = true; running = false; myResult = kind;
  const won = kind === 'victory';
  const reachedWave = mode === 'endless' ? Math.max(0, wave - 1) : (won ? totalWaves : Math.max(0, wave - 1));
  if (mode === 'campaign') meta.bestWaveCampaign = Math.max(meta.bestWaveCampaign, reachedWave);
  if (mode === 'endless') meta.bestWaveEndless = Math.max(meta.bestWaveEndless, reachedWave);
  const { xpGain, rankedUp } = grantRunRewards(reachedWave, won);
  sfx(won ? 'victory' : 'defeat');
  if (mode === 'battle') {
    if (won) meta.winsBattle++; else meta.lossesBattle++;
    if (battle.amIHost) maybeBroadcastHostStatus(true);
  }
  waveBanner.hidden = true; bossBanner.hidden = true;
  showResults({ kind, xpGain, rankedUp, surrendered: !!(opts && opts.surrendered) });
  host('complete', { score, progress: 100, state: metaStatePayload() });
}
function surrender() {
  if (!running || runCompleted) return;
  if (mode === 'battle' && battle.amIHost) pushDuelState({ hostStatus: { label: 'Host', lives: 0, maxLives, wave, totalWaves, gold, alive: false, result: 'surrendered', updatedAt: Date.now() } });
  lives = 0;
  finishRun('defeat', { surrendered: true });
}
function returnToMenu() {
  running = false; paused = false;
  overlayPause.hidden = true; overlayResults.hidden = true;
  showScreen('menu');
  renderMenuMeta();
}

// ---------------------------------------------------------------------
// 11. HUD / dock rendering
// ---------------------------------------------------------------------
let lastDockGold = -1;
function updateHud() {
  hud.gold.textContent = String(gold);
  hud.wave.textContent = mode === 'endless' ? `${wave}` : `${Math.min(wave, totalWaves)}/${totalWaves}`;
  hud.lives.textContent = String(lives);
  hud.score.textContent = String(score);
  hud.livesChip.classList.toggle('is-low', lives <= 5);
  commanderBtn.disabled = commanderCooldown > 0 || !running;
  commanderFill.style.width = Math.round((1 - commanderCooldown / COMMANDER_COOLDOWN) * 100) + '%';
  commanderBtn.querySelector('span').textContent = commanderActive ? `Overcharge active (${commanderTimer.toFixed(1)}s)` : (commanderCooldown > 0 ? `Overcharge (${Math.ceil(commanderCooldown)}s)` : 'Overcharge Pulse');
  renderPressureDock();
  // The dock's afford/lock state depends on `gold`, which changes every
  // tick (kills, bounties, spends) — only rebuild its DOM when the value
  // actually moved, instead of every animation frame.
  if (gold !== lastDockGold) {
    lastDockGold = gold;
    renderDock();
    if (selectedSlot >= 0) renderDockSelected();
  }
}
function renderDock() {
  const unlocked = unlockedSet();
  dockDefenders.innerHTML = DEFENDER_ORDER.map((id) => {
    const def = DEFENDERS[id];
    const isUnlocked = unlocked.has(id);
    const affordable = gold >= def.cost;
    const disabled = !isUnlocked || !affordable;
    const sub = isUnlocked ? `${def.cost} Glint · ${def.role}` : `Rank ${UNLOCK_RANK[id]} required`;
    return `<button type="button" class="sg-def-card ${placingDef === id ? 'is-selected' : ''}" data-def="${id}" ${disabled ? 'disabled' : ''}><span class="sg-def-icon def-${id}"></span><b>${esc(def.name)}</b><span>${esc(sub)}</span></button>`;
  }).join('');
  dockDefenders.querySelectorAll('[data-def]').forEach((btn) => btn.onclick = () => {
    placingDef = placingDef === btn.dataset.def ? null : btn.dataset.def;
    renderDock();
  });
}
function renderDockSelected() {
  const s = sentinels.find((x) => x.slotIndex === selectedSlot);
  if (!s) { dockSelected.hidden = true; return; }
  const def = DEFENDERS[s.defId];
  const stats = currentStats(s);
  const p = pathFor(s);
  const level = pathLevel(s);
  const paths = UPGRADE_PATHS[s.defId] || {};
  const nextCost = p && level < 4 ? p.costs[level] : null;
  dockSelected.hidden = false;
  const pathChoices = !p && Object.entries(paths).length ? `<div class="sg-path-grid">${Object.entries(paths).map(([id, path]) => {
    const cost = path.costs[0];
    return `<button type="button" data-upgrade-path="${esc(id)}" ${gold < cost ? 'disabled' : ''}><b>${esc(path.name)}</b><span>${esc(path.steps[0].label)} · ${cost}</span></button>`;
  }).join('')}</div>` : '';
  const upgradeBtn = p ? (level < 4 ? `<button type="button" data-upgrade ${gold < nextCost ? 'disabled' : ''}>${esc(p.steps[level].label)} (${nextCost})</button>` : `<span>${esc(p.ultimate)} online</span>`) : '';
  dockSelected.innerHTML = `<b>${esc(def.name)} · ${esc(pathLabel(s))}</b>
    <span>Dmg ${Math.round(stats.dmg)} · Rng ${stats.range} · Rate ${stats.rof}/s</span>
    ${pathChoices || upgradeBtn}
    <button type="button" data-sell>Sell (+${Math.round((s.spent || 0) * 0.6)})</button>
    <button type="button" data-deselect>Close</button>`;
  dockSelected.querySelector('[data-upgrade]')?.addEventListener('click', () => upgradeSelected());
  dockSelected.querySelectorAll('[data-upgrade-path]').forEach((btn) => btn.addEventListener('click', () => upgradeSelected(btn.dataset.upgradePath)));
  dockSelected.querySelector('[data-sell]')?.addEventListener('click', sellSelected);
  dockSelected.querySelector('[data-deselect]')?.addEventListener('click', () => selectSlot(-1));
}
function renderPressureDock() {
  const show = running && (mode === 'battle' || mode === 'skirmish');
  dockPressure.hidden = !show;
  if (!show) return;
  const sends = Object.values(SENDS).filter((s) => s.kind === sendTab);
  dockPressure.innerHTML = `
    <div class="sg-send-tabs">
      <button type="button" data-send-tab="fleet" class="${sendTab === 'fleet' ? 'is-on' : ''}">Fleet Sends</button>
      <button type="button" data-send-tab="tactical" class="${sendTab === 'tactical' ? 'is-on' : ''}">Tactical Sends</button>
      <span>Reactor +${reactorOutput}/cycle</span>
    </div>
    <div class="sg-send-list">
      ${sends.map((send) => {
        const cd = Math.ceil(sendCooldowns[send.id] || 0);
        const disabled = gold < send.cost || cd > 0;
        return `<div class="sg-send-card">
          <b>${esc(send.name)}</b><span>${esc(send.tags.join(' / '))}${send.reactor ? ` · +${send.reactor} reactor` : ''}</span>
          <button type="button" data-send="${send.id}" ${disabled ? 'disabled' : ''}>${cd ? cd + 's' : send.cost}</button>
          ${send.kind === 'fleet' ? `<button type="button" data-send-burst="${send.id}" ${gold < send.cost * 5 ? 'disabled' : ''}>x5</button>` : ''}
        </div>`;
      }).join('')}
      <button type="button" class="sg-pressure-btn" data-pressure="surrender">Surrender</button>
    </div>
    <p class="sg-send-preview">${sendCombo.length ? `Last formation: ${esc(formationLine(sendCombo[sendCombo.length - 1]) || sendCombo[sendCombo.length - 1].name)} · arrival ~3s` : 'Fleet sends raise Reactor Output. Tactical sends exploit a weak defense.'}</p>`;
  dockPressure.querySelectorAll('[data-send-tab]').forEach((b) => b.onclick = () => { sendTab = b.dataset.sendTab; renderPressureDock(); });
  dockPressure.querySelectorAll('[data-send]').forEach((b) => b.onclick = () => onSendClick(b.dataset.send, 1));
  dockPressure.querySelectorAll('[data-send-burst]').forEach((b) => b.onclick = () => onSendClick(b.dataset.sendBurst, 5));
  dockPressure.querySelector('[data-pressure="surrender"]')?.addEventListener('click', surrender);
}
function onSendClick(kind, amount) {
  const send = SENDS[kind]; if (!send) return;
  const count = Math.max(1, amount || 1);
  const cost = send.cost * count;
  if (gold < cost || (sendCooldowns[kind] || 0) > 0) return;
  gold -= cost;
  if (send.kind === 'fleet') reactorOutput += (send.reactor || 0) * count;
  if (send.kind === 'tactical') sendCooldowns[kind] = send.cooldown || 10;
  for (let i = 0; i < count; i++) sendCombo.push(send);
  sendCombo = sendCombo.slice(-5);
  sfx('pressure-send'); updateHud();
  const line = formationLine(send);
  if (mode === 'skirmish') {
    for (let i = 0; i < count; i++) applyPressureToBot(kind);
    toast(`${line ? line + ' - ' : ''}${send.name} sent to Rival AI.`);
    return;
  }
  if (mode === 'battle') {
    const existing = ((battle.duel && battle.duel.pressureLog) || []);
    const newEntries = [];
    for (let i = 0; i < count; i++) newEntries.push({ seq: existing.length + newEntries.length + 1, type: kind, from: battle.amIHost ? 'host' : 'guest', at: Date.now() + i });
    if (battle.amIHost) {
      const log = [...existing, ...newEntries].slice(-32);
      pushDuelState({ pressureLog: log });
      toast(`${line ? line + ' - ' : ''}${send.name} sent to your opponent.`);
    } else {
      matchAction({ duel: { ...(battle.duel || {}), pressureLog: [...existing, ...newEntries] } }, 'merge');
      toast(`${send.name} queued — delivery depends on room sync.`);
    }
  }
}
function renderOpponentPanel() {
  if (mode === 'skirmish') {
    oppName.textContent = 'Rival AI';
    oppLives.textContent = bot ? `${bot.lives}/${bot.maxLives}` : '—';
    oppWave.textContent = bot ? `${bot.wave}/${totalWaves}` : '—';
    oppStatus.textContent = bot ? (bot.alive ? 'Holding' : 'Fallen') : '—';
    oppBar.style.width = bot ? Math.round((bot.lives / bot.maxLives) * 100) + '%' : '0%';
    oppNote.textContent = 'Local practice rival — fully simulated on this device, both pressure directions work here.';
    return;
  }
  if (mode !== 'battle') return;
  if (!battle.roleKnown) { oppStatus.textContent = 'Detecting role…'; return; }
  if (battle.amIHost) {
    const other = (battle.participants || []).find((p) => p.role !== 'host');
    oppName.textContent = (other && other.label) || 'Opponent';
    oppLives.textContent = '—'; oppWave.textContent = '—';
    oppStatus.textContent = 'Not relayed to host';
    oppBar.style.width = '0%';
    oppNote.textContent = "This build only relays the room host's match actions, so the host can't see the guest's live status — you'll still get your own final result.";
  } else {
    const h = battle.duel && battle.duel.hostStatus;
    const hostP = (battle.participants || []).find((p) => p.role === 'host');
    oppName.textContent = (hostP && hostP.label) || 'Host';
    if (h) {
      oppLives.textContent = `${h.lives}/${h.maxLives}`;
      oppWave.textContent = `${h.wave}/${h.totalWaves || totalWaves}`;
      oppStatus.textContent = h.alive === false ? (h.result === 'surrendered' ? 'Surrendered' : 'Fallen') : 'Holding';
      oppBar.style.width = Math.round((h.lives / (h.maxLives || 20)) * 100) + '%';
    } else { oppStatus.textContent = 'Syncing…'; }
    oppNote.textContent = 'Live status from the room host.';
  }
}

// ---------------------------------------------------------------------
// 12. Placement / selection input
// ---------------------------------------------------------------------
function refFromEvent(evt) {
  const rect = canvas.getBoundingClientRect();
  const point = evt.touches ? evt.touches[0] : evt;
  return { x: (point.clientX - rect.left - offX) / scale, y: (point.clientY - rect.top - offY) / scale };
}
canvas.style.touchAction = 'none';
canvas.addEventListener('pointerdown', (evt) => {
  if (!running || paused) return;
  evt.preventDefault();
  const { x, y } = refFromEvent(evt);
  let hitSlot = -1, bestD = 30;
  for (let i = 0; i < SLOT_PX.length; i++) {
    const [sx, sy] = SLOT_PX[i];
    const d = Math.hypot(x - sx, y - sy);
    if (d < bestD) { bestD = d; hitSlot = i; }
  }
  if (hitSlot < 0) { selectSlot(-1); return; }
  const occupied = sentinels.find((s) => s.slotIndex === hitSlot);
  if (occupied) { selectSlot(hitSlot); return; }
  if (placingDef) tryPlace(hitSlot); else selectSlot(-1);
});
function selectSlot(i) { selectedSlot = i; renderDockSelected(); }
function tryPlace(slotIndex) {
  const def = DEFENDERS[placingDef];
  if (!unlockedSet().has(placingDef)) { toast('Locked — reach the required Command Rank.'); return; }
  if (gold < def.cost) { toast('Not enough Glint.'); return; }
  gold -= def.cost;
  sentinels.push({ id: uid(), defId: placingDef, path: null, pathLevel: 0, slotIndex, cooldown: 0, spent: def.cost });
  sfx('place'); placingDef = null;
  updateHud(); renderDock(); selectSlot(slotIndex);
}
function upgradeSelected(pathId) {
  const s = sentinels.find((x) => x.slotIndex === selectedSlot);
  if (!s) return;
  const paths = UPGRADE_PATHS[s.defId] || {};
  if (!s.path) {
    if (!pathId || !paths[pathId]) return;
    s.path = pathId;
  }
  const p = pathFor(s);
  const level = pathLevel(s);
  if (!p || level >= 4) return;
  const cost = p.costs[level];
  if (gold < cost) { toast('Not enough Glint.'); return; }
  gold -= cost; s.pathLevel = level + 1; s.spent = (s.spent || 0) + cost;
  if (s.pathLevel >= 4) spawnBurst(SLOT_PX[s.slotIndex][0], SLOT_PX[s.slotIndex][1], DEFENDERS[s.defId].color);
  sfx('upgrade'); updateHud(); renderDockSelected();
}
function sellSelected() {
  const idx = sentinels.findIndex((x) => x.slotIndex === selectedSlot);
  if (idx < 0) return;
  gold += Math.round((sentinels[idx].spent || 0) * 0.6);
  sentinels.splice(idx, 1);
  sfx('click'); updateHud(); renderDock(); selectSlot(-1);
}
commanderBtn.addEventListener('click', () => {
  if (commanderCooldown > 0 || commanderActive || !running) return;
  commanderActive = true; commanderTimer = COMMANDER_DURATION; commanderCooldown = COMMANDER_COOLDOWN;
  sfx('commander'); updateHud();
});
addEventListener('keydown', (e) => {
  if (currentScreen !== 'game' || !running) return;
  if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); commanderBtn.click(); }
  if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setPaused(!paused); }
  if (e.key === 'Escape') { e.preventDefault(); selectSlot(-1); placingDef = null; renderDock(); }
});

// ---------------------------------------------------------------------
// 13. Rendering
// ---------------------------------------------------------------------
function drawShape(cx, cy, r, shape, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (shape === 'circle') { ctx.arc(cx, cy, r, 0, Math.PI * 2); }
  else if (shape === 'hex') { for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i - Math.PI / 2; const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.closePath(); }
  else if (shape === 'tri') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r * 0.8); ctx.lineTo(cx - r, cy + r * 0.8); ctx.closePath(); }
  else if (shape === 'star') { for (let i = 0; i < 10; i++) { const a = Math.PI / 5 * i - Math.PI / 2; const rr = i % 2 === 0 ? r : r * 0.45; const px = cx + rr * Math.cos(a), py = cy + rr * Math.sin(a); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.closePath(); }
  else if (shape === 'square') { ctx.rect(cx - r, cy - r, r * 2, r * 2); }
  else if (shape === 'diamond') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); }
  else if (shape === 'hangar') { ctx.roundRect(cx - r * 1.15, cy - r * 0.78, r * 2.3, r * 1.56, r * 0.32); }
  else if (shape === 'well') { ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.moveTo(cx + r * 1.45, cy); ctx.arc(cx, cy, r * 1.45, 0, Math.PI * 2); }
  ctx.fill();
}
function draw() {
  ctx.clearRect(0, 0, cssW, cssH);
  drawBackground();
  drawPath(); drawSlots(); drawSpire(); drawSentinels(); drawEnemies(); drawParticlesOnCanvas();
  if (spireFlash > 0) { ctx.fillStyle = `rgba(255,77,141,${spireFlash * 0.35})`; ctx.fillRect(0, 0, cssW, cssH); }
}
function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, cssW, cssH);
  grad.addColorStop(0, '#061532');
  grad.addColorStop(0.48, '#020715');
  grad.addColorStop(1, '#130725');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cssW, cssH);

  const nebulaA = ctx.createRadialGradient(cssW * 0.16, cssH * 0.50, 0, cssW * 0.16, cssH * 0.50, cssW * 0.42);
  nebulaA.addColorStop(0, '#6c22ff38');
  nebulaA.addColorStop(0.34, '#20c8ff16');
  nebulaA.addColorStop(1, 'transparent');
  ctx.fillStyle = nebulaA;
  ctx.fillRect(0, 0, cssW, cssH);

  const planet = ctx.createRadialGradient(cssW * 0.78, cssH * 0.18, 0, cssW * 0.78, cssH * 0.18, cssW * 0.28);
  planet.addColorStop(0, '#1a66ff33');
  planet.addColorStop(0.45, '#0b3c8a24');
  planet.addColorStop(1, 'transparent');
  ctx.fillStyle = planet;
  ctx.beginPath();
  ctx.arc(cssW * 0.78, cssH * 0.18, cssW * 0.28, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.72;
  for (let i = 0; i < 105; i++) {
    const x = ((Math.sin(i * 37.77) + 1) * 0.5 * cssW + simTime * (i % 3 ? 2 : -1)) % cssW;
    const y = ((Math.cos(i * 19.13) + 1) * 0.5 * cssH);
    const r = (i % 9 === 0 ? 1.8 : 0.8) * scale;
    ctx.fillStyle = i % 7 === 0 ? '#6fdfff' : '#d9e8ff';
    ctx.fillRect(x, y, r, r);
  }
  ctx.restore();

  drawDistantCarrier(cssW * 0.79, cssH * 0.21, 1.0, 0.28, -1);
  drawDistantCarrier(cssW * 0.19, cssH * 0.75, 1.25, 0.20, 1);
}
function drawDistantCarrier(x, y, size, alpha, dir) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * size * scale, size * scale);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#020711';
  ctx.strokeStyle = '#2aaeff55';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-70, 0); ctx.lineTo(-34, -14); ctx.lineTo(44, -10); ctx.lineTo(82, 0);
  ctx.lineTo(38, 12); ctx.lineTo(-48, 11); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#20c8ff';
  for (let i = 0; i < 5; i++) ctx.fillRect(-32 + i * 20, -2, 8, 2);
  ctx.restore();
}
function drawPath() {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.shadowColor = '#20c8ff';
  ctx.shadowBlur = 28 * scale;
  ctx.lineWidth = 34 * scale; ctx.strokeStyle = '#0b66ff55';
  ctx.beginPath();
  PATH_PX.forEach(([x, y], i) => { const [px, py] = toPx(x, y); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); });
  ctx.stroke();
  ctx.shadowBlur = 18 * scale;
  ctx.lineWidth = 22 * scale; ctx.strokeStyle = '#179affcc';
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 5 * scale; ctx.strokeStyle = '#8fe9ff';
  ctx.stroke();
  ctx.lineWidth = 1.4 * scale; ctx.strokeStyle = '#ffffffcc';
  ctx.stroke();

  ctx.save();
  ctx.shadowColor = '#8fe9ff';
  ctx.shadowBlur = 12 * scale;
  for (let i = 0; i < 18; i++) {
    const t = (simTime * 0.09 + i / 18) % 1;
    const p = pointAtT(t), q = pointAtT(Math.min(1, t + 0.004));
    const [x, y] = toPx(p.x, p.y), [qx, qy] = toPx(q.x, q.y);
    const a = Math.atan2(qy - y, qx - x);
    ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = '#c7f7ff';
    ctx.beginPath();
    ctx.moveTo(8 * scale, 0);
    ctx.lineTo(-5 * scale, -4 * scale);
    ctx.lineTo(-2 * scale, 0);
    ctx.lineTo(-5 * scale, 4 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.restore();
}
function drawSlots() {
  for (let i = 0; i < SLOT_PX.length; i++) {
    const [x, y] = toPx(SLOT_PX[i][0], SLOT_PX[i][1]);
    const occupied = sentinels.find((s) => s.slotIndex === i);
    const isSelected = i === selectedSlot;
    const isValidDrop = placingDef && !occupied;
    const r = (occupied ? 18 : 15) * scale;
    ctx.fillStyle = '#020916cc';
    ctx.beginPath(); ctx.arc(x, y, r + 7 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = isSelected ? '#ffbf33' : isValidDrop ? '#20c8ff' : '#2c5c91';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = (isSelected || isValidDrop ? 16 : 6) * scale;
    ctx.lineWidth = (isSelected || isValidDrop ? 2.4 : 1.4) * scale;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}
function drawSpire() {
  const [x, y] = toPx(PATH_PX[PATH_PX.length - 1][0], PATH_PX[PATH_PX.length - 1][1]);
  const pulse = 1 + Math.sin(simTime * 5) * 0.04;
  ctx.save();
  ctx.shadowColor = '#20c8ff';
  ctx.shadowBlur = 34 * scale;
  const grad = ctx.createRadialGradient(x, y, 2 * scale, x, y, 54 * scale);
  grad.addColorStop(0, '#dffcff');
  grad.addColorStop(0.22, '#20c8ff');
  grad.addColorStop(0.56, '#0b66ff55');
  grad.addColorStop(1, '#20c8ff00');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(x, y, 48 * scale * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#8fe9ff'; ctx.lineWidth = 2.5 * scale;
  for (let r of [24, 36, 48]) { ctx.beginPath(); ctx.arc(x, y, r * scale * pulse, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = '#dffcff';
  ctx.beginPath(); ctx.moveTo(x, y - 30 * scale); ctx.lineTo(x + 14 * scale, y); ctx.lineTo(x, y + 30 * scale); ctx.lineTo(x - 14 * scale, y); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawSentinels() {
  for (const s of sentinels) {
    const [x, y] = SLOT_PX[s.slotIndex];
    const [px, py] = toPx(x, y);
    const def = DEFENDERS[s.defId];
    const level = pathLevel(s);
    const path = pathFor(s);
    if (s.slotIndex === selectedSlot) {
      const stats = currentStats(s);
      ctx.beginPath(); ctx.arc(px, py, stats.range * scale, 0, Math.PI * 2);
      ctx.strokeStyle = def.color + '55'; ctx.lineWidth = 1.2 * scale; ctx.stroke();
    }
    drawTowerBase(px, py, def.color, level);
    ctx.save();
    ctx.shadowColor = def.color;
    ctx.shadowBlur = (20 + level * 4) * scale;
    drawShape(px, py - 4 * scale, (12 + level * 2.4) * scale, def.shape, def.color);
    ctx.restore();
    if (level > 0) {
      ctx.strokeStyle = level >= 4 ? '#fff' : '#fff8'; ctx.lineWidth = (1.2 + level * 0.25) * scale;
      for (let i = 0; i < Math.min(3, level); i++) { ctx.beginPath(); ctx.arc(px, py - 4 * scale, (18 + i * 6) * scale, 0, Math.PI * 2); ctx.stroke(); }
    }
    if (level >= 4 && path) drawUltimateAura(px, py, def.color, path.ultimate);
  }
}
function drawUltimateAura(x, y, color, label) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(simTime * 0.8);
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 24 * scale;
  ctx.lineWidth = 2 * scale;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(0, 0, (32 + i * 8) * scale, (13 + i * 4) * scale, i * Math.PI / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.rotate(-simTime * 1.6);
  ctx.fillStyle = '#fff';
  ctx.font = `${8 * scale}px ui-monospace,monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(label.split(' ')[0].toUpperCase(), 0, -31 * scale);
  ctx.restore();
}
function drawTowerBase(x, y, color, tier) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#071020';
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14 * scale;
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 4 * i + Math.PI / 8;
    const r = (tier ? 25 + tier * 2 : 23) * scale;
    const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.78;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffffff33';
  ctx.beginPath(); ctx.arc(0, 0, (tier ? 16 + tier * 2 : 15) * scale, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
function drawEnemies() {
  for (const e of enemies) {
    const [x, y] = toPx(e.x, e.y);
    const info = ENEMIES[e.type];
    const r = (info.r + (e.boss ? 6 : 0)) * scale;
    const slowed = e.slowUntil > simTime;
    const phased = e.phasedUntil > simTime;
    const color = e.cloak && e.revealedUntil <= simTime ? '#7c3aed' : slowed ? '#20c8ff' : phased ? '#e9d5ff' : info.color;
    ctx.globalAlpha = e.cloak && e.revealedUntil <= simTime ? 0.38 : phased ? 0.5 : 1;
    drawEnemyShip(e, x, y, r, color);
    ctx.globalAlpha = 1;
    if (e.boss) { ctx.strokeStyle = '#ff563dcc'; ctx.lineWidth = 2 * scale; ctx.shadowColor = '#ff563d'; ctx.shadowBlur = 18 * scale; ctx.beginPath(); ctx.arc(x, y, r + 12 * scale, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0; }
    if (e.shield > 0) { ctx.strokeStyle = '#6fdfffcc'; ctx.lineWidth = 2 * scale; ctx.shadowColor = '#6fdfff'; ctx.shadowBlur = 12 * scale; ctx.beginPath(); ctx.arc(x, y, r + 7 * scale, 0, Math.PI * 2 * Math.max(0.06, e.shield / Math.max(1, e.maxShield))); ctx.stroke(); ctx.shadowBlur = 0; }
    if (e.repairAura && e.disruptedUntil <= simTime) { ctx.strokeStyle = '#5be6a055'; ctx.beginPath(); ctx.arc(x, y, 34 * scale, 0, Math.PI * 2); ctx.stroke(); }
    if (e.jammer && e.disruptedUntil <= simTime) { ctx.strokeStyle = '#fb718555'; ctx.beginPath(); ctx.arc(x, y, 42 * scale, 0, Math.PI * 2); ctx.stroke(); }
    if (e.markedUntil > simTime) { ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 1.5 * scale; ctx.beginPath(); ctx.arc(x, y, r + 15 * scale, 0, Math.PI * 2); ctx.stroke(); }
    const w = 22 * scale, ratio = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = '#1a2050'; ctx.fillRect(x - w / 2, y - r - 8 * scale, w, 3 * scale);
    ctx.fillStyle = ratio > 0.4 ? '#5be6a0' : '#ff5c6c'; ctx.fillRect(x - w / 2, y - r - 8 * scale, w * ratio, 3 * scale);
    if (e.tags && e.tags.length && r > 9 * scale) {
      ctx.fillStyle = '#dbeafe';
      ctx.font = `${7 * scale}px ui-monospace,monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(e.tags[0].slice(0, 3).toUpperCase(), x, y + r + 10 * scale);
    }
  }
}
function drawEnemyShip(e, x, y, r, color) {
  const p = pointAtT(Math.min(1, e.t + 0.004));
  const [qx, qy] = toPx(p.x, p.y);
  const a = Math.atan2(qy - y, qx - x);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.shadowColor = color;
  ctx.shadowBlur = 16 * scale;
  ctx.fillStyle = '#020711';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * scale;
  const body = e.boss ? r * 1.9 : r * 1.35;
  ctx.beginPath();
  ctx.moveTo(body, 0);
  ctx.lineTo(-body * 0.55, -r * 0.78);
  ctx.lineTo(-body * 0.20, 0);
  ctx.lineTo(-body * 0.55, r * 0.78);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(-body * 0.75, -r * 0.28, r * 0.55, r * 0.16);
  ctx.fillRect(-body * 0.75, r * 0.12, r * 0.55, r * 0.16);
  ctx.restore();
}
function drawParticlesOnCanvas() {
  for (const p of particles) {
    const t = Math.max(0, 1 - p.age / p.life);
    ctx.globalAlpha = t;
    if (p.type === 'tracer' || p.type === 'beam') {
      const [x1, y1] = toPx(p.x1, p.y1), [x2, y2] = toPx(p.x2, p.y2);
      ctx.shadowColor = p.color; ctx.shadowBlur = 18 * scale;
      ctx.strokeStyle = p.color; ctx.lineWidth = (p.type === 'beam' ? 8 : 3.5) * scale;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (p.type === 'beam') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * scale; ctx.stroke(); }
      ctx.shadowBlur = 0;
    } else {
      const [x, y] = toPx(p.x, p.y);
      ctx.shadowColor = p.color; ctx.shadowBlur = 12 * scale;
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, 4 * scale, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------
// 14. Main loop
// ---------------------------------------------------------------------
let lastFrame = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  if (!lastFrame) lastFrame = ts;
  let dt = (ts - lastFrame) / 1000; lastFrame = ts;
  dt = Math.min(dt, 0.05);
  if (running && !paused && !document.hidden && currentScreen === 'game') tick(dt);
  if (currentScreen === 'game') draw();
}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange', () => { if (document.hidden && running && !paused) setPaused(true); });

// ---------------------------------------------------------------------
// 15. Pause / results
// ---------------------------------------------------------------------
function setPaused(v) {
  if (!running) return;
  paused = v;
  overlayPause.hidden = !v;
  host('paused', { paused: v });
}
$('[data-pause-btn]').addEventListener('click', () => setPaused(true));
$('[data-exit-btn]').addEventListener('click', () => returnToMenu());
$('[data-resume-btn]').addEventListener('click', () => setPaused(false));
$('[data-restart-btn]').addEventListener('click', () => { overlayPause.hidden = true; startRun(mode); });
$('[data-menu-btn]').addEventListener('click', () => returnToMenu());

function showResults({ kind, xpGain, rankedUp, surrendered }) {
  const won = kind === 'victory';
  resultsTitle.textContent = won ? (mode === 'battle' ? 'Duel won' : 'Route held') : (mode === 'battle' ? 'Duel lost' : (surrendered ? 'Surrendered' : 'Spire fallen'));
  resultsSub.textContent = mode === 'endless' ? `Endless run — reached wave ${wave}.` : `${{ campaign: 'Campaign', skirmish: 'Skirmish', battle: 'Room Duel' }[mode] || mode} run finished.`;
  const stats = [
    ['Waves survived', String(mode === 'endless' ? Math.max(0, wave - 1) : Math.min(wave, totalWaves))],
    ['Enemies defeated', String(killCount)],
    ['Score', String(score)],
    ['XP gained', '+' + xpGain],
    ['Command rank', String(meta.rank) + (rankedUp ? ' (ranked up!)' : '')],
  ];
  if (mode === 'battle') {
    let duelLine;
    if (!battle.amIHost) {
      const r = guestResolveResult();
      duelLine = r ? ({ win: 'You won the duel', lose: 'You lost the duel', draw: 'Draw' }[r]) : 'Waiting on final opponent sync';
    } else {
      duelLine = `Your lane ${won ? 'held' : 'fell'} — opponent result isn't relayed to the host in this build`;
    }
    stats.push(['Duel outcome', duelLine]);
  }
  resultsGrid.innerHTML = stats.map(([k, v]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
  overlayResults.hidden = false;
  rematchBtn.hidden = mode !== 'battle';
}
// The guest's duel-outcome line can only be resolved once the host's final
// status arrives, which may land *after* the results overlay already
// rendered "Waiting on final opponent sync" — re-check and patch that one
// line in place whenever a fresh match-state comes in while it's showing,
// instead of leaving it permanently stale.
function refreshDuelOutcomeLine() {
  if (mode !== 'battle' || overlayResults.hidden || battle.amIHost) return;
  const r = guestResolveResult();
  if (!r) return;
  const line = ({ win: 'You won the duel', lose: 'You lost the duel', draw: 'Draw' })[r];
  const cells = resultsGrid.querySelectorAll('div');
  const last = cells[cells.length - 1];
  if (last && last.querySelector('b')) last.querySelector('b').textContent = line;
}
$('[data-results-again]').addEventListener('click', () => { overlayResults.hidden = true; startRun(mode); });
$('[data-results-menu]').addEventListener('click', () => returnToMenu());
$('[data-results-rematch]').addEventListener('click', () => {
  overlayResults.hidden = true;
  if (battle.amIHost) { battle.duel = {}; matchAction({ duel: {} }, 'merge'); battle.lastSeq = 0; }
  showScreen('lobby'); renderLobby();
});

// ---------------------------------------------------------------------
// 16. Settings (volume, mute, reduced motion) — both the pause overlay
//     and the menu settings overlay drive the same local state.
// ---------------------------------------------------------------------
function syncSettingsInputs() {
  [$('[data-vol-mute]'), $('[data-vol-mute-menu]')].forEach((el) => el.checked = localMuted);
  [$('[data-vol-slider]'), $('[data-vol-slider-menu]')].forEach((el) => el.value = String(localVolPct));
  [$('[data-reduced-toggle]'), $('[data-reduced-toggle-menu]')].forEach((el) => el.checked = localReducedMotion);
}
function wireSettingsInputs(muteSel, volSel, reducedSel) {
  $(muteSel).addEventListener('change', (e) => { localMuted = e.target.checked; syncSettingsInputs(); });
  $(volSel).addEventListener('input', (e) => { localVolPct = Number(e.target.value) || 0; meta.soundVol = localVolPct; syncSettingsInputs(); });
  $(reducedSel).addEventListener('change', (e) => { localReducedMotion = e.target.checked; meta.reducedMotion = localReducedMotion; applyReducedMotionClass(); syncSettingsInputs(); });
}
wireSettingsInputs('[data-vol-mute]', '[data-vol-slider]', '[data-reduced-toggle]');
wireSettingsInputs('[data-vol-mute-menu]', '[data-vol-slider-menu]', '[data-reduced-toggle-menu]');
$('[data-open-settings]').addEventListener('click', () => { syncSettingsInputs(); overlaySettings.hidden = false; });
$('[data-settings-close]').addEventListener('click', () => { overlaySettings.hidden = true; });

// ---------------------------------------------------------------------
// 17. Tutorial
// ---------------------------------------------------------------------
const TUTORIAL_STEPS = [
  { h: 'Welcome, Skyguard', p: 'Driftbreaker raids follow the Skyline Route toward your Anchor Spire. Place Sentinels along the corridor to break them before they arrive.' },
  { h: 'Glint economy', p: 'Defeating raiders and clearing waves earns Glint. Spend it placing new Sentinels and upgrading the ones you already have.' },
  { h: 'Eight Sentinels', p: 'Glare, Arc, Frost, Vane, Flak, Null, Drone, and Gravity each answer a different fleet problem: armor, shields, swarms, cloak, support, phase, bosses, or control.' },
  { h: 'Upgrade paths', p: 'Tap a placed Sentinel and choose a path. The original four Sentinels each have three identities and a final Tier-5 visual evolution.' },
  { h: 'Fleet pressure', p: 'Skirmish and Room Duel add Fleet and Tactical sends. Fleet sends pressure the opponent and increase Reactor Output; Tactical sends exploit a weakness at the right moment.' },
  { h: 'Overcharge Pulse', p: "Your commander ability boosts every Sentinel's damage and fire rate for a few seconds. Use it on a tough wave, then wait out its cooldown." },
  { h: 'Hold the Spire', p: 'Every raider that reaches the end drains your Spire’s integrity. Lose it all and the route falls. Clear every wave, including the boss, to win a Campaign run.' },
  { h: 'Named formations', p: 'Certain sends combine into formations like Iron Convoy, Silent Running, Fracture Rush, Carrier Strike, and Siege Column.' },
];
let tutorialStep = 0, tutorialReturn = 'menu';
function openTutorial(returnTo) { tutorialReturn = returnTo || 'menu'; tutorialStep = 0; renderTutorial(); showScreen('tutorial'); }
function renderTutorial() {
  const step = TUTORIAL_STEPS[tutorialStep];
  tutorialBody.innerHTML = `<h3>${esc(step.h)}</h3><p>${esc(step.p)}</p>`;
  tutorialDots.innerHTML = TUTORIAL_STEPS.map((_, i) => `<i class="${i === tutorialStep ? 'is-on' : ''}"></i>`).join('');
  $('[data-tutorial-back]').disabled = tutorialStep === 0;
  $('[data-tutorial-next]').textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? 'Done' : 'Next';
}
function closeTutorial() {
  meta.tutorialSeen = true;
  showScreen(tutorialReturn);
  if (tutorialReturn === 'menu') renderMenuMeta();
}
$('[data-tutorial-next]').addEventListener('click', () => { if (tutorialStep < TUTORIAL_STEPS.length - 1) { tutorialStep++; renderTutorial(); } else closeTutorial(); });
$('[data-tutorial-back]').addEventListener('click', () => { if (tutorialStep > 0) { tutorialStep--; renderTutorial(); } });
$('[data-tutorial-skip]').addEventListener('click', closeTutorial);
$('[data-open-tutorial]').addEventListener('click', () => openTutorial('menu'));

// ---------------------------------------------------------------------
// 18. Menu
// ---------------------------------------------------------------------
function renderMenuMeta() {
  rankEls.rank.textContent = String(meta.rank);
  rankEls.fill.style.width = Math.round(((meta.xp % 300) / 300) * 100) + '%';
  rankEls.bestCampaign.textContent = String(meta.bestWaveCampaign);
  rankEls.bestEndless.textContent = String(meta.bestWaveEndless);
  const locked = DEFENDER_ORDER.filter((id) => !unlockedSet().has(id));
  rankEls.unlockNote.textContent = locked.length ? `Unlocks: ${locked.map((id) => `${DEFENDERS[id].name} at Rank ${UNLOCK_RANK[id]}`).join(' · ')}` : 'All Sentinels unlocked.';
  rankEls.duelCard.hidden = !battle.active;
  if (battle.active) rankEls.duelSub.textContent = battle.roleKnown ? (battle.amIHost ? 'You host this room.' : 'You joined this room.') : 'Connecting to the room…';
}
document.querySelectorAll('[data-mode]').forEach((btn) => btn.addEventListener('click', () => {
  const m = btn.dataset.mode;
  if (m === 'battle') {
    if (!battle.active) { toast('Open Skyguard Arena from a Playtest Room to duel.'); return; }
    showScreen('lobby'); renderLobby(); return;
  }
  startRun(m);
}));

// ---------------------------------------------------------------------
// 19. Duel lobby
// ---------------------------------------------------------------------
function renderLobby() {
  const humans = (battle.participants || []).filter((p) => p.status !== 'left');
  lobbyRoster.innerHTML = humans.map((p) => `<li><span>${esc(p.label || 'Player')} ${p.role === 'host' ? '(Host)' : ''}</span><b>${(battle.readyStates || {})[p.actorId] ? 'Ready' : 'Not ready'}</b></li>`).join('') || '<li><span>No one here yet</span><b>—</b></li>';
  const botFill = battle.hostControls && battle.hostControls.allowBotFill && (battle.botSlots || []).length > 0;
  let note = '';
  if (!battle.roleKnown) note = 'Detecting your role in this room…';
  else if (humans.length < 2 && !botFill) note = 'Waiting for a second player to join this room from the Playtest Rooms panel.';
  else if (humans.length > 2) note = 'Room Duel only supports exactly 2 players — ask any extra players to leave this room.';
  lobbyNote.textContent = note;
  const allReady = humans.length === 2 ? humans.every((p) => (battle.readyStates || {})[p.actorId]) : (humans.length === 1 && botFill);
  lobbyStartBtn.hidden = !(battle.roleKnown && battle.amIHost && allReady && !(battle.duel && battle.duel.startedAt));
  lobbyTitle.textContent = allReady ? 'Both defenders ready' : 'Waiting for both defenders…';
  lobbyCopy.textContent = (botFill && humans.length === 1) ? 'Solo host with bot fill enabled — this plays like Skirmish, hosted through a room.' : 'Ready up from the Playtest Room panel outside this window. The duel begins once both sides are ready.';
  // Only auto-enter on a startedAt we haven't already played — otherwise a
  // guest returning to this screen after a finished match (e.g. via the
  // Rematch button, before the host has actually reset+restarted) would
  // get yanked straight back into the just-finished match on the very
  // next poll, since the old startedAt is still sitting in matchState.
  if (battle.duel && battle.duel.startedAt && battle.duel.startedAt !== battle.consumedStartedAt && currentScreen === 'lobby') beginBattleRun();
}
lobbyStartBtn.addEventListener('click', () => {
  if (!battle.amIHost) return;
  battle.duel = { startedAt: Date.now(), hostStatus: null, pressureLog: [], endedAt: null };
  matchAction({ duel: battle.duel }, 'merge');
  beginBattleRun();
});
$('[data-lobby-back]').addEventListener('click', () => showScreen('menu'));
function beginBattleRun() { battle.lastSeq = 0; battle.consumedStartedAt = battle.duel && battle.duel.startedAt; startRun('battle'); }

// ---------------------------------------------------------------------
// 20. Host protocol listener
// ---------------------------------------------------------------------
addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.source !== 'phantomplay-host') return;
  switch (d.type) {
    case 'settings':
      if ('sound' in d) hostSoundOn = !!d.sound;
      hostReducedMotion = !!d.reducedMotion;
      applyReducedMotionClass();
      break;
    case 'pause': setPaused(true); break;
    case 'resume': setPaused(false); break;
    case 'restart': if (mode) startRun(mode); break;
    case 'restore':
      if (d.state) { applyMetaFromState(d.state); syncSettingsInputs(); renderMenuMeta(); }
      break;
    case 'match-state':
      battle.active = true;
      battle.participants = d.participants || [];
      battle.readyStates = d.readyStates || {};
      battle.hostControls = d.hostControls || null;
      battle.botSlots = d.botSlots || [];
      { const ms = d.matchState || {}; tryResolveRole(ms); battle.duel = ms.duel || battle.duel; }
      if (currentScreen === 'lobby') renderLobby();
      if (currentScreen === 'game') { applyDuelUpdate(); renderOpponentPanel(); refreshDuelOutcomeLine(); }
      if (currentScreen === 'menu') renderMenuMeta();
      break;
  }
});

// ---------------------------------------------------------------------
// 21. Boot
// ---------------------------------------------------------------------
recomputeUnlocks();
renderMenuMeta();
syncSettingsInputs();
showScreen('menu');
requestAnimationFrame(resizeCanvas);
host('ready');
setTimeout(() => { if (!meta.tutorialSeen && currentScreen === 'menu') openTutorial('menu'); }, 150);
