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
  glare: { id: 'glare', name: 'Glare Cannon', cost: 50, upgradeCost: 45, color: '#ffb84d', shape: 'circle',
    tiers: [{ dmg: 6, rof: 3.2, range: 108 }, { dmg: 11, rof: 4.0, range: 124 }] },
  arc: { id: 'arc', name: 'Arc Diffuser', cost: 85, upgradeCost: 65, color: '#ff4d8d', shape: 'hex',
    tiers: [{ dmg: 5, rof: 1.1, range: 100, splash: 44 }, { dmg: 9, rof: 1.3, range: 112, splash: 58 }] },
  frost: { id: 'frost', name: 'Frost Prism', cost: 70, upgradeCost: 55, color: '#4ddbff', shape: 'tri',
    tiers: [{ dmg: 1, rof: 1.0, range: 126, slow: 0.35, slowDur: 1.6 }, { dmg: 2, rof: 1.2, range: 145, slow: 0.55, slowDur: 2.0 }] },
  vane: { id: 'vane', name: 'Vane Sniper', cost: 130, upgradeCost: 95, color: '#8a6bff', shape: 'star',
    tiers: [{ dmg: 42, rof: 0.55, range: 210, pierce: 2 }, { dmg: 68, rof: 0.65, range: 230, pierce: 4 }] },
};
const DEFENDER_ORDER = ['glare', 'arc', 'frost', 'vane'];
const UNLOCK_RANK = { glare: 1, arc: 1, frost: 2, vane: 3 };
const CURRENCY = 'Stardust';
const PREBATTLE_OFFERS = [
  { id: 'shipMachine', title: 'Ship Machine', tag: 'AUTO SEND', cost: 50, have: 'x1', art: 'ship', copy: 'Launches Spark Drone pressure for you every cycle so your rival never gets a quiet lane.' },
  { id: 'starHarvester', title: 'Star Harvester', tag: 'ECON', cost: 50, have: 'x1', art: 'harvester', copy: `Pulls extra ${CURRENCY} after every cleared wave and keeps your build moving.` },
  { id: 'trialHero', title: 'Try Hero Vega', tag: 'HERO', cost: 0, have: '6/6', art: 'hero', copy: 'Adds Vega Starborn to this battle: a free orbit hero with a piercing beam and lane aura.' },
];
const MIDGAME_BUYS = [
  { id: 'shipMachine', title: 'Ship Machine', cost: 125, art: 'ship', copy: 'Auto-sends Spark Drones every cycle.' },
  { id: 'starHarvester', title: 'Star Harvester', cost: 110, art: 'harvester', copy: `Adds bonus ${CURRENCY} after every wave.` },
  { id: 'trialHero', title: 'Hire Vega', cost: 180, art: 'hero', copy: 'Hero beam joins the lane instantly.' },
];
const PRESSURE_SENDS = [
  { id: 'swarm', title: 'Spark Drones', cost: 35, mult: 'x5', tag: 'FAST', copy: 'Cheap pressure ships that force early defenses.' },
  { id: 'overload', title: 'Jam Probe', cost: 60, mult: 'x2', tag: 'TACTIC', copy: 'Disrupts the rival lane and punishes weak timing.' },
];

const ENEMIES = {
  driftling: { hp: 16, speed: 0.085, armor: 0, bounty: 4, color: '#7c88c9', r: 9, label: 'Driftling' },
  skiff: { hp: 10, speed: 0.145, armor: 0, bounty: 5, color: '#ff8fb4', r: 7, label: 'Skiff Raider' },
  bulwark: { hp: 60, speed: 0.05, armor: 3, bounty: 12, color: '#c98b4a', r: 12, label: 'Bulwark Hauler' },
  colossus: { hp: 950, speed: 0.032, armor: 6, bounty: 180, color: '#ff4d8d', r: 22, label: 'Voidmaw Colossus', boss: true },
};

const CAMPAIGN_WAVES = [
  [{ type: 'driftling', count: 8, gap: 700 }],
  [{ type: 'driftling', count: 10, gap: 600 }, { type: 'skiff', count: 4, gap: 500, delay: 2000 }],
  [{ type: 'skiff', count: 8, gap: 500 }, { type: 'driftling', count: 6, gap: 650, delay: 1000 }],
  [{ type: 'bulwark', count: 4, gap: 1100 }, { type: 'driftling', count: 8, gap: 550, delay: 800 }],
  [{ type: 'skiff', count: 10, gap: 480 }, { type: 'bulwark', count: 4, gap: 1200, delay: 1500 }],
  [{ type: 'bulwark', count: 6, gap: 1000 }, { type: 'skiff', count: 10, gap: 450, delay: 900 }, { type: 'driftling', count: 6, gap: 600, delay: 1800 }],
  [{ type: 'bulwark', count: 8, gap: 900 }, { type: 'skiff', count: 14, gap: 400, delay: 1200 }],
  [{ type: 'colossus', count: 1, gap: 0 }, { type: 'driftling', count: 10, gap: 500, delay: 600 }],
];
function endlessWave(n) {
  const tier = Math.floor((n - 1) / 3);
  const hpMul = 1 + tier * 0.22;
  const countMul = 1 + Math.floor(tier / 2) * 0.5;
  const entries = [{ type: 'driftling', count: Math.round((6 + tier * 2) * countMul), gap: Math.max(260, 650 - tier * 30) }];
  if (n >= 2) entries.push({ type: 'skiff', count: Math.round((3 + tier * 2) * countMul), gap: Math.max(220, 520 - tier * 25), delay: 800 });
  if (n >= 4) entries.push({ type: 'bulwark', count: Math.round((2 + tier) * countMul), gap: 900, delay: 1400 });
  if (n % 6 === 0) entries.push({ type: 'colossus', count: 1, gap: 0, delay: 400 });
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
const readyStore = $('[data-ready-store]'), readyOptions = $('[data-ready-options]'), readyBank = $('[data-ready-bank]');
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
function priceLabel(cost) { return cost > 0 ? `${cost} ${CURRENCY}` : 'Trial'; }
function buyIcon(kind) {
  return `<span class="sg-buy-art sg-buy-${esc(kind)}" aria-hidden="true"><i></i></span>`;
}
function duelReadyMode(value = mode) { return value === 'skirmish' || value === 'battle'; }
function availablePrebattleOffers(value = mode) {
  return PREBATTLE_OFFERS.filter((offer) => offer.id !== 'shipMachine' || duelReadyMode(value));
}
function availableMidgameBuys(value = mode) {
  return MIDGAME_BUYS.filter((buy) => buy.id !== 'shipMachine' || duelReadyMode(value));
}
function perkOwned(id) {
  if (id === 'shipMachine') return battlePerks.shipMachine;
  if (id === 'starHarvester') return battlePerks.starHarvester;
  if (id === 'trialHero') return battlePerks.hero;
  return false;
}
function activateHero() {
  battlePerks.hero = true;
  hero = { name: 'Vega Starborn', cooldown: 0.25, pulse: 0, x: 0.50 * REF_W, y: 0.50 * REF_H };
}
function buyPerk(id, cost, fromReadyStore) {
  if (perkOwned(id)) { toast('Already active for this battle.'); return; }
  if (id === 'shipMachine' && !duelReadyMode()) { toast('Ship Machine is for duel pressure.'); return; }
  if (gold < cost) { toast(`Need more ${CURRENCY}.`); return; }
  gold -= cost;
  if (id === 'shipMachine') { battlePerks.shipMachine = true; shipMachineTimer = 4; toast('Ship Machine online.'); }
  if (id === 'starHarvester') { battlePerks.starHarvester = true; toast('Star Harvester online.'); }
  if (id === 'trialHero') { activateHero(); toast('Vega joined your lane.'); }
  sfx('upgrade');
  updateHud();
  if (fromReadyStore) renderReadyStore();
  renderDock();
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
let pressureCooldown = 0;
let bot = null;
let shopTab = 'towers';
let preBattleOpen = false;
let battlePerks = { shipMachine: false, starHarvester: false, hero: false };
let shipMachineTimer = 0;
let hero = null;
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
    const kind = Math.random() < 0.5 ? 'swarm' : 'overload';
    applyPressureToPlayer(kind, true);
  }
}
function applyPressureToBot(kind) {
  if (!bot || !bot.alive) return;
  if (kind === 'swarm') { bot.lives = Math.max(0, bot.lives - 2); if (bot.lives <= 0) { bot.alive = false; bot.result = 'defeated'; } }
  if (kind === 'overload') bot.jamStacks = (bot.jamStacks || 0) + 1;
}
function applyPressureToPlayer(kind, fromBot) {
  if (kind === 'swarm') spawnEnemy('skiff', 1);
  if (kind === 'overload') commanderCooldown = Math.min(COMMANDER_COOLDOWN + 8, commanderCooldown + 8);
  sfx('pressure-hit');
  toast(fromBot ? 'Rival AI hit your lane with a pressure power!' : 'Your opponent hit your lane with a pressure power!');
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
function currentStats(s) { return DEFENDERS[s.defId].tiers[s.tier]; }
function dealDamage(enemy, dmg, pierce) {
  const armor = Math.max(0, enemy.armor - (pierce || 0));
  enemy.hp -= Math.max(1, dmg - armor);
}
function spawnEnemy(type, hpMul) {
  const base = ENEMIES[type]; if (!base) return;
  const p = pointAtT(0);
  enemies.push({ id: uid(), type, hp: base.hp * (hpMul || 1), maxHp: base.hp * (hpMul || 1), armor: base.armor, bounty: base.bounty, speed: base.speed, t: 0, x: p.x, y: p.y, alive: true, boss: !!base.boss, slowUntil: 0, slowFactor: 0 });
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
  isBoss = entries.some((e) => e.type === 'colossus');
  waveBanner.hidden = isBoss; bossBanner.hidden = !isBoss;
  if (isBoss) sfx('boss');
  if (!isBoss) { waveBanner.textContent = `Wave ${n}${mode !== 'endless' ? '/' + totalWaves : ''} inbound`; waveBanner.hidden = false; }
  loadWave(entries, hpMul);
  updateHud();
}
function handleWaveCleared() {
  const harvesterBonus = battlePerks.starHarvester ? 24 + Math.min(26, wave * 3) : 0;
  const bonus = 20 + wave * 5 + harvesterBonus;
  gold += bonus; score += wave * 30;
  if (harvesterBonus) toast(`Star Harvester +${harvesterBonus} ${CURRENCY}.`);
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

function findTarget(s, stats) {
  const [sx, sy] = SLOT_PX[s.slotIndex];
  let best = null, bestT = -1;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - sx, e.y - sy);
    if (d <= stats.range && e.t > bestT) { best = e; bestT = e.t; }
  }
  return best;
}
function fire(s, stats, target) {
  const [sx, sy] = SLOT_PX[s.slotIndex];
  const boostDmg = commanderActive ? 1.6 : 1;
  const dmg = stats.dmg * boostDmg;
  dealDamage(target, dmg, stats.pierce || 0);
  particles.push({ type: 'tracer', x1: sx, y1: sy, x2: target.x, y2: target.y, color: DEFENDERS[s.defId].color, life: 0.12, age: 0 });
  fireSfxFor(s.defId);
  if (stats.splash) {
    for (const e of enemies) {
      if (e === target || !e.alive) continue;
      if (Math.hypot(e.x - target.x, e.y - target.y) <= stats.splash) dealDamage(e, dmg * 0.7, 0);
    }
  }
  if (stats.slow) {
    target.slowUntil = simTime + stats.slowDur;
    target.slowFactor = Math.max(target.slowFactor || 0, stats.slow);
  }
}
function fireHero(target) {
  if (!hero || !target) return;
  const dmg = 20 + Math.min(28, wave * 2);
  dealDamage(target, dmg, 1);
  target.slowUntil = Math.max(target.slowUntil || 0, simTime + 0.55);
  target.slowFactor = Math.max(target.slowFactor || 0, 0.18);
  particles.push({ type: 'tracer', x1: hero.x, y1: hero.y, x2: target.x, y2: target.y, color: '#ffe86b', life: 0.16, age: 0 });
  hero.pulse = 0.28;
  tone(980, 0.055, 'triangle', 0.22);
}
function tickHero(dt) {
  if (!hero) return;
  hero.cooldown -= dt;
  hero.pulse = Math.max(0, hero.pulse - dt);
  if (hero.cooldown > 0) return;
  let target = null, bestT = -1;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - hero.x, e.y - hero.y);
    if (d <= 240 && e.t > bestT) { target = e; bestT = e.t; }
  }
  if (target) fireHero(target);
  hero.cooldown = 0.72;
}
function dispatchPressure(kind, label) {
  if (mode === 'skirmish') { applyPressureToBot(kind); toast(`${label || 'Pressure'} sent to Rival AI.`); return; }
  if (mode === 'battle') {
    const entrySeq = ((battle.duel && battle.duel.pressureLog) || []).length + 1;
    const entry = { seq: entrySeq, type: kind, from: battle.amIHost ? 'host' : 'guest', at: Date.now() };
    if (battle.amIHost) {
      const log = [...((battle.duel && battle.duel.pressureLog) || []), entry].slice(-24);
      pushDuelState({ pressureLog: log });
      toast(`${label || 'Pressure'} sent to your opponent.`);
    } else {
      matchAction({ duel: { ...(battle.duel || {}), pressureLog: [...((battle.duel && battle.duel.pressureLog) || []), entry] } }, 'merge');
      toast('Sent — delivery depends on room sync.');
    }
  }
}
function tickBattlePerks(dt) {
  tickHero(dt);
  if (!battlePerks.shipMachine || !duelReadyMode()) return;
  shipMachineTimer -= dt;
  if (shipMachineTimer > 0) return;
  shipMachineTimer = 14;
  sfx('pressure-send');
  dispatchPressure('swarm', 'Ship Machine');
}
let simTime = 0;
function tick(dt) {
  simTime += dt;
  if (commanderCooldown > 0) commanderCooldown = Math.max(0, commanderCooldown - dt);
  if (commanderActive) { commanderTimer -= dt; if (commanderTimer <= 0) commanderActive = false; }
  if (pressureCooldown > 0) pressureCooldown = Math.max(0, pressureCooldown - dt);
  if (spireFlash > 0) spireFlash = Math.max(0, spireFlash - dt);
  updateParticles(dt);
  tickBattlePerks(dt);

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
  for (const e of enemies) {
    if (!e.alive) continue;
    const speedMul = e.slowUntil > simTime ? Math.max(0.15, 1 - e.slowFactor) : 1;
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
    const rofMul = commanderActive ? 1.4 : 1;
    s.cooldown = 1 / (stats.rof * rofMul);
  }
  for (const e of enemies) if (e.hp <= 0 && e.alive) { e.alive = false; gold += e.bounty; score += e.bounty * 2 + (e.boss ? 100 : 0); killCount++; sfx('death'); spawnBurst(e.x, e.y, ENEMIES[e.type].color); }
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
  gold = (m === 'skirmish' || m === 'battle') ? 260 : 220;
  lives = maxLives = 20;
  wave = 0; score = 0; killCount = 0;
  sentinels = []; enemies = []; particles = [];
  spawnQueue = []; waveActive = false; prepRemaining = 0;
  commanderActive = false; commanderCooldown = 0; commanderTimer = 0; pressureCooldown = 0;
  selectedSlot = -1; placingDef = null;
  shopTab = 'towers';
  battlePerks = { shipMachine: false, starHarvester: false, hero: false };
  shipMachineTimer = 0; hero = null;
  preBattleOpen = true;
  lastDockGold = -1; lastDockCooldownLocked = null; lastDockPerkKey = '';
  runCompleted = false; myResult = null; running = true; paused = true;
  totalWaves = m === 'endless' ? Infinity : CAMPAIGN_WAVES.length;
  bot = (m === 'skirmish') ? newBot('standard') : null;
  hud.mode.textContent = { campaign: 'Solo Route', endless: 'Endless Duel Prep', skirmish: '1v1 Star Duel', battle: 'Room Duel' }[m] || m;
  opponentPanel.hidden = !(m === 'skirmish' || m === 'battle');
  overlayResults.hidden = true; overlayPause.hidden = true;
  showScreen('game');
  requestAnimationFrame(resizeCanvas);
  readyStore.hidden = false;
  renderDock(); renderDockSelected(); renderPressureDock(); updateHud(); renderOpponentPanel(); renderReadyStore();
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
  preBattleOpen = false;
  if (readyStore) readyStore.hidden = true;
  overlayPause.hidden = true; overlayResults.hidden = true;
  showScreen('menu');
  renderMenuMeta();
}
function renderReadyStore() {
  if (!readyOptions || !readyBank) return;
  readyBank.textContent = String(gold);
  const offers = availablePrebattleOffers();
  readyOptions.innerHTML = offers.length ? offers.map((offer) => {
    const owned = perkOwned(offer.id);
    const affordable = gold >= offer.cost;
    const disabled = owned || !affordable;
    return `<article class="sg-ready-option ${owned ? 'is-owned' : ''}">
      <div class="sg-ready-art">${buyIcon(offer.art)}</div>
      <div class="sg-ready-have">You have: <b>${esc(owned ? 'ACTIVE' : offer.have)}</b></div>
      <h3>${esc(offer.title)}</h3>
      <p>${esc(offer.copy)}</p>
      <button type="button" data-prebuy="${esc(offer.id)}" ${disabled ? 'disabled' : ''}>
        <span>${esc(owned ? 'Active' : priceLabel(offer.cost))}</span>
      </button>
    </article>`;
  }).join('') : `<article class="sg-ready-option sg-ready-empty">
      <div class="sg-ready-art">${buyIcon('ship')}</div>
      <div class="sg-ready-have">No market cards</div>
      <h3>Skip the shop</h3>
      <p>This mode has no optional pre-battle buys. Start clean and spend in battle.</p>
    </article>`;
  readyOptions.querySelectorAll('[data-prebuy]').forEach((btn) => {
    const offer = offers.find((item) => item.id === btn.dataset.prebuy);
    btn.onclick = () => offer && buyPerk(offer.id, offer.cost, true);
  });
}
function launchFromReadyStore() {
  if (!preBattleOpen) return;
  preBattleOpen = false;
  readyStore.hidden = true;
  paused = false;
  sfx('wave');
  beginPrep(1.5);
  renderPressureDock();
  updateHud();
}
$('[data-ready-start]').addEventListener('click', launchFromReadyStore);
$('[data-ready-skip]').addEventListener('click', launchFromReadyStore);

// ---------------------------------------------------------------------
// 11. HUD / dock rendering
// ---------------------------------------------------------------------
let lastDockGold = -1;
let lastDockCooldownLocked = null;
let lastDockPerkKey = '';
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
  const cooldownLocked = pressureCooldown > 0;
  const perkKey = `${shopTab}|${battlePerks.shipMachine ? 1 : 0}${battlePerks.starHarvester ? 1 : 0}${battlePerks.hero ? 1 : 0}`;
  if (gold !== lastDockGold || cooldownLocked !== lastDockCooldownLocked || perkKey !== lastDockPerkKey) {
    lastDockGold = gold;
    lastDockCooldownLocked = cooldownLocked;
    lastDockPerkKey = perkKey;
    renderDock();
    if (selectedSlot >= 0) renderDockSelected();
  }
}
function renderDock() {
  const unlocked = unlockedSet();
  const duelReady = duelReadyMode();
  if (shopTab === 'sends' && !duelReady) shopTab = 'towers';
  const tabs = [
    ['towers', 'Towers'],
    ...(duelReady ? [['sends', 'Sends']] : []),
    ['boosts', 'Machines + Hero'],
  ];
  let cards = '';
  if (shopTab === 'towers') {
    cards = DEFENDER_ORDER.map((id) => {
      const def = DEFENDERS[id];
      const isUnlocked = unlocked.has(id);
      const affordable = gold >= def.cost;
      const disabled = !isUnlocked || !affordable;
      const sub = isUnlocked ? priceLabel(def.cost) : `Rank ${UNLOCK_RANK[id]}`;
      return `<button type="button" class="sg-def-card sg-shop-card ${placingDef === id ? 'is-selected' : ''}" data-def="${id}" ${disabled ? 'disabled' : ''}>
        <span class="sg-def-icon def-${id}"></span>
        <b>${esc(def.name)}</b>
        <span>${esc(sub)}</span>
      </button>`;
    }).join('');
  } else if (shopTab === 'sends') {
    cards = PRESSURE_SENDS.map((send) => {
      const disabled = !duelReady || gold < send.cost || pressureCooldown > 0;
      return `<button type="button" class="sg-send-card sg-shop-card" data-pressure="${esc(send.id)}" ${disabled ? 'disabled' : ''}>
        <span class="sg-send-mult">${esc(send.mult)}</span>
        <b>${esc(send.title)}</b>
        <i>${esc(priceLabel(send.cost))}</i>
        <small>${esc(send.copy)}</small>
      </button>`;
    }).join('');
  } else {
    const buys = availableMidgameBuys();
    cards = buys.length ? buys.map((buy) => {
      const owned = perkOwned(buy.id);
      const disabled = owned || gold < buy.cost;
      return `<button type="button" class="sg-boost-card sg-shop-card ${owned ? 'is-owned' : ''}" data-boost="${esc(buy.id)}" ${disabled ? 'disabled' : ''}>
        ${buyIcon(buy.art)}
        <b>${esc(buy.title)}</b>
        <i>${esc(owned ? 'Active' : priceLabel(buy.cost))}</i>
        <small>${esc(buy.copy)}</small>
      </button>`;
    }).join('') : `<div class="sg-empty-card sg-shop-card"><b>No machines loaded</b><span>Bring a machine or hero card next run.</span></div>`;
  }
  dockDefenders.innerHTML = `<div class="sg-shop-shell">
    <div class="sg-shop-tabs">${tabs.map(([key, label]) => `<button type="button" data-shop-tab="${key}" class="${shopTab === key ? 'is-on' : ''}">${esc(label)}</button>`).join('')}</div>
    <div class="sg-shop-cards">${cards}</div>
  </div>`;
  dockDefenders.querySelectorAll('[data-shop-tab]').forEach((btn) => btn.onclick = () => { shopTab = btn.dataset.shopTab; renderDock(); });
  dockDefenders.querySelectorAll('[data-def]').forEach((btn) => btn.onclick = () => {
    placingDef = placingDef === btn.dataset.def ? null : btn.dataset.def;
    renderDock();
  });
  dockDefenders.querySelectorAll('[data-pressure]').forEach((btn) => btn.onclick = () => onPressureClick(btn.dataset.pressure));
  dockDefenders.querySelectorAll('[data-boost]').forEach((btn) => {
    const buy = MIDGAME_BUYS.find((item) => item.id === btn.dataset.boost);
    btn.onclick = () => buy && buyPerk(buy.id, buy.cost, false);
  });
}
function renderDockSelected() {
  const s = sentinels.find((x) => x.slotIndex === selectedSlot);
  if (!s) { dockSelected.hidden = true; return; }
  const def = DEFENDERS[s.defId];
  const maxTier = def.tiers.length - 1;
  dockSelected.hidden = false;
  dockSelected.innerHTML = `<b>${esc(def.name)} · T${s.tier + 1}</b>
    ${s.tier < maxTier ? `<button type="button" data-upgrade ${gold < def.upgradeCost ? 'disabled' : ''}>Upgrade (${priceLabel(def.upgradeCost)})</button>` : '<span>Max tier</span>'}
    <button type="button" data-sell>Sell (+${Math.round((s.spent || 0) * 0.6)})</button>
    <button type="button" data-deselect>Close</button>`;
  dockSelected.querySelector('[data-upgrade]')?.addEventListener('click', upgradeSelected);
  dockSelected.querySelector('[data-sell]')?.addEventListener('click', sellSelected);
  dockSelected.querySelector('[data-deselect]')?.addEventListener('click', () => selectSlot(-1));
}
function renderPressureDock() {
  const show = running && duelReadyMode() && !preBattleOpen;
  dockPressure.hidden = !show;
  dockPressure.innerHTML = show ? `<button type="button" class="sg-surrender-card" data-pressure="surrender">Surrender</button>` : '';
  dockPressure.querySelector('[data-pressure="surrender"]')?.addEventListener('click', surrender);
}
function onPressureClick(kind) {
  if (kind === 'surrender') { surrender(); return; }
  const send = PRESSURE_SENDS.find((item) => item.id === kind);
  if (!send) return;
  const cost = send.cost;
  if (gold < cost || pressureCooldown > 0) return;
  gold -= cost; pressureCooldown = 6;
  sfx('pressure-send'); updateHud();
  dispatchPressure(kind, send.title);
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
  if (gold < def.cost) { toast(`Not enough ${CURRENCY}.`); return; }
  gold -= def.cost;
  sentinels.push({ id: uid(), defId: placingDef, tier: 0, slotIndex, cooldown: 0, spent: def.cost });
  sfx('place'); placingDef = null;
  updateHud(); renderDock(); selectSlot(slotIndex);
}
function upgradeSelected() {
  const s = sentinels.find((x) => x.slotIndex === selectedSlot);
  if (!s) return;
  const def = DEFENDERS[s.defId];
  if (s.tier >= def.tiers.length - 1) return;
  if (gold < def.upgradeCost) { toast(`Not enough ${CURRENCY}.`); return; }
  gold -= def.upgradeCost; s.tier += 1; s.spent = (s.spent || 0) + def.upgradeCost;
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
  ctx.fill();
}
function draw() {
  ctx.clearRect(0, 0, cssW, cssH);
  drawBackground();
  drawPath(); drawSlots(); drawSpire(); drawHero(); drawSentinels(); drawEnemies(); drawParticlesOnCanvas();
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
    if (s.slotIndex === selectedSlot) {
      const stats = currentStats(s);
      ctx.beginPath(); ctx.arc(px, py, stats.range * scale, 0, Math.PI * 2);
      ctx.strokeStyle = def.color + '55'; ctx.lineWidth = 1.2 * scale; ctx.stroke();
    }
    drawTowerBase(px, py, def.color, s.tier);
    ctx.save();
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 20 * scale;
    drawShape(px, py - 4 * scale, (s.tier === 1 ? 15 : 12) * scale, def.shape, def.color);
    ctx.restore();
    if (s.tier === 1) { ctx.strokeStyle = '#fff8'; ctx.lineWidth = 1.4 * scale; ctx.beginPath(); ctx.arc(px, py - 4 * scale, 18 * scale, 0, Math.PI * 2); ctx.stroke(); }
  }
}
function drawHero() {
  if (!hero) return;
  const [px, py] = toPx(hero.x, hero.y);
  const pulse = 1 + Math.sin(simTime * 3) * 0.045 + hero.pulse * 0.9;
  ctx.save();
  ctx.translate(px, py);
  ctx.shadowColor = '#ffe86b';
  ctx.shadowBlur = 28 * scale;
  ctx.fillStyle = '#10183a';
  ctx.strokeStyle = '#ffe86b';
  ctx.lineWidth = 2.6 * scale;
  ctx.beginPath();
  ctx.arc(0, 0, 28 * scale * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffe86b';
  ctx.beginPath();
  ctx.moveTo(0, -20 * scale);
  ctx.lineTo(17 * scale, 10 * scale);
  ctx.lineTo(0, 4 * scale);
  ctx.lineTo(-17 * scale, 10 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff7bd';
  ctx.beginPath();
  ctx.arc(0, -5 * scale, 5 * scale, 0, Math.PI * 2);
  ctx.fill();
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
    const r = (tier ? 27 : 23) * scale;
    const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.78;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffffff33';
  ctx.beginPath(); ctx.arc(0, 0, (tier ? 18 : 15) * scale, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
function drawEnemies() {
  for (const e of enemies) {
    const [x, y] = toPx(e.x, e.y);
    const info = ENEMIES[e.type];
    const r = (info.r + (e.boss ? 6 : 0)) * scale;
    const slowed = e.slowUntil > simTime;
    drawEnemyShip(e, x, y, r, slowed ? '#20c8ff' : info.color);
    if (e.boss) { ctx.strokeStyle = '#ff563dcc'; ctx.lineWidth = 2 * scale; ctx.shadowColor = '#ff563d'; ctx.shadowBlur = 18 * scale; ctx.beginPath(); ctx.arc(x, y, r + 12 * scale, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0; }
    const w = 22 * scale, ratio = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = '#1a2050'; ctx.fillRect(x - w / 2, y - r - 8 * scale, w, 3 * scale);
    ctx.fillStyle = ratio > 0.4 ? '#5be6a0' : '#ff5c6c'; ctx.fillRect(x - w / 2, y - r - 8 * scale, w * ratio, 3 * scale);
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
    if (p.type === 'tracer') {
      const [x1, y1] = toPx(p.x1, p.y1), [x2, y2] = toPx(p.x2, p.y2);
      ctx.shadowColor = p.color; ctx.shadowBlur = 18 * scale;
      ctx.strokeStyle = p.color; ctx.lineWidth = 3.5 * scale;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
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
  resultsTitle.textContent = won ? (mode === 'battle' ? 'Duel won' : 'Route held') : (mode === 'battle' ? 'Duel lost' : (surrendered ? 'Surrendered' : 'Core fallen'));
  resultsSub.textContent = mode === 'endless' ? `Endless Duel Prep run — reached wave ${wave}.` : `${{ campaign: 'Solo Route', skirmish: '1v1 Star Duel', battle: 'Room Duel' }[mode] || mode} run finished.`;
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
  { h: 'Welcome, Skyguard', p: 'This is a 1v1 star-lane battle. Build your defense, send pressure to the rival lane, and protect your core longer than they protect theirs.' },
  { h: `${CURRENCY} economy`, p: `Defeating raiders and clearing waves earns ${CURRENCY}. Spend it on towers, sends, machines, upgrades, or a hero.` },
  { h: 'Pre-battle market', p: 'Before launch, buy a Ship Machine, Star Harvester, or trial hero. These are real battle helpers, not cosmetic buttons.' },
  { h: 'Tower shop', p: 'Glare Cannon hits fast. Arc Diffuser splashes. Frost Prism slows. Vane Sniper deletes tough ships from long range.' },
  { h: 'Sends win duels', p: 'Spark Drones and Jam Probes pressure the enemy lane. The Ship Machine keeps sending automatically once it is online.' },
  { h: 'Heroes and boosts', p: 'Vega Starborn fires from the center lane. Overcharge Pulse boosts every tower for a short, dangerous window.' },
  { h: 'Outlast the rival', p: 'Every raider that reaches the end drains your core. Lose it all and the lane falls. In duels, their lane is trying to survive the same storm.' },
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
