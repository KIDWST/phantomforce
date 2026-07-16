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
let pressureCooldown = 0;
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
let simTime = 0;
function tick(dt) {
  simTime += dt;
  if (commanderCooldown > 0) commanderCooldown = Math.max(0, commanderCooldown - dt);
  if (commanderActive) { commanderTimer -= dt; if (commanderTimer <= 0) commanderActive = false; }
  if (pressureCooldown > 0) pressureCooldown = Math.max(0, pressureCooldown - dt);
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
  gold = m === 'endless' ? 180 : 150;
  lives = maxLives = 20;
  wave = 0; score = 0; killCount = 0;
  sentinels = []; enemies = []; particles = [];
  spawnQueue = []; waveActive = false; prepRemaining = 0;
  commanderActive = false; commanderCooldown = 0; commanderTimer = 0; pressureCooldown = 0;
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
    const sub = isUnlocked ? `${def.cost} Glint` : `Rank ${UNLOCK_RANK[id]} required`;
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
  const maxTier = def.tiers.length - 1;
  dockSelected.hidden = false;
  dockSelected.innerHTML = `<b>${esc(def.name)} · T${s.tier + 1}</b>
    ${s.tier < maxTier ? `<button type="button" data-upgrade ${gold < def.upgradeCost ? 'disabled' : ''}>Upgrade (${def.upgradeCost})</button>` : '<span>Max tier</span>'}
    <button type="button" data-sell>Sell (+${Math.round((s.spent || 0) * 0.6)})</button>
    <button type="button" data-deselect>Close</button>`;
  dockSelected.querySelector('[data-upgrade]')?.addEventListener('click', upgradeSelected);
  dockSelected.querySelector('[data-sell]')?.addEventListener('click', sellSelected);
  dockSelected.querySelector('[data-deselect]')?.addEventListener('click', () => selectSlot(-1));
}
function renderPressureDock() {
  const show = running && (mode === 'battle' || mode === 'skirmish');
  dockPressure.hidden = !show;
  if (!show) return;
  dockPressure.innerHTML = `
    <button type="button" class="sg-pressure-btn" data-pressure="swarm" ${gold < 40 || pressureCooldown > 0 ? 'disabled' : ''}>Swarm Ping · 40</button>
    <button type="button" class="sg-pressure-btn" data-pressure="overload" ${gold < 60 || pressureCooldown > 0 ? 'disabled' : ''}>Jam Signal · 60</button>
    <button type="button" class="sg-pressure-btn" data-pressure="surrender">Surrender</button>`;
  dockPressure.querySelectorAll('[data-pressure]').forEach((b) => b.onclick = () => onPressureClick(b.dataset.pressure));
}
function onPressureClick(kind) {
  if (kind === 'surrender') { surrender(); return; }
  const costs = { swarm: 40, overload: 60 };
  const cost = costs[kind];
  if (gold < cost || pressureCooldown > 0) return;
  gold -= cost; pressureCooldown = 6;
  sfx('pressure-send'); updateHud();
  if (mode === 'skirmish') { applyPressureToBot(kind); toast('Sent to Rival AI.'); return; }
  if (mode === 'battle') {
    const entrySeq = ((battle.duel && battle.duel.pressureLog) || []).length + 1;
    const entry = { seq: entrySeq, type: kind, from: battle.amIHost ? 'host' : 'guest', at: Date.now() };
    if (battle.amIHost) {
      const log = [...((battle.duel && battle.duel.pressureLog) || []), entry].slice(-24);
      pushDuelState({ pressureLog: log });
      toast('Pressure sent to your opponent.');
    } else {
      matchAction({ duel: { ...(battle.duel || {}), pressureLog: [...((battle.duel && battle.duel.pressureLog) || []), entry] } }, 'merge');
      toast('Sent — delivery depends on room sync.');
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
  sentinels.push({ id: uid(), defId: placingDef, tier: 0, slotIndex, cooldown: 0, spent: def.cost });
  sfx('place'); placingDef = null;
  updateHud(); renderDock(); selectSlot(slotIndex);
}
function upgradeSelected() {
  const s = sentinels.find((x) => x.slotIndex === selectedSlot);
  if (!s) return;
  const def = DEFENDERS[s.defId];
  if (s.tier >= def.tiers.length - 1) return;
  if (gold < def.upgradeCost) { toast('Not enough Glint.'); return; }
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
  ctx.fillStyle = '#080a1e'; ctx.fillRect(0, 0, cssW, cssH);
  drawEnergyGrid();
  drawPath(); drawSlots(); drawSpire(); drawSentinels(); drawEnemies(); drawParticlesOnCanvas();
  if (spireFlash > 0) { ctx.fillStyle = `rgba(255,77,141,${spireFlash * 0.35})`; ctx.fillRect(0, 0, cssW, cssH); }
}
function drawEnergyGrid() {
  const pulse = (Math.sin(simTime * 1.8) + 1) / 2;
  ctx.save();
  ctx.globalAlpha = 0.18 + pulse * 0.08;
  ctx.strokeStyle = '#4ddbff33'; ctx.lineWidth = 1 * scale;
  for (let x = offX % (48 * scale); x < cssW; x += 48 * scale) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cssH); ctx.stroke(); }
  for (let y = offY % (48 * scale); y < cssH; y += 48 * scale) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cssW, y); ctx.stroke(); }
  ctx.globalAlpha = 0.22 + pulse * 0.22;
  ctx.strokeStyle = commanderActive ? '#ffb84d99' : '#5be6a066';
  ctx.lineWidth = (1.5 + pulse * 1.5) * scale;
  ctx.beginPath();
  PATH_PX.forEach(([x, y], i) => { const [px, py] = toPx(x, y); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); });
  ctx.stroke();
  ctx.restore();
}
function drawPath() {
  ctx.lineWidth = 26 * scale; ctx.strokeStyle = '#141a3d'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  PATH_PX.forEach(([x, y], i) => { const [px, py] = toPx(x, y); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); });
  ctx.stroke();
  ctx.lineWidth = 2 * scale; ctx.strokeStyle = '#ffb84d33';
  ctx.stroke();
}
function drawSlots() {
  for (let i = 0; i < SLOT_PX.length; i++) {
    const [x, y] = toPx(SLOT_PX[i][0], SLOT_PX[i][1]);
    const occupied = sentinels.find((s) => s.slotIndex === i);
    const isSelected = i === selectedSlot;
    const isValidDrop = placingDef && !occupied;
    ctx.beginPath(); ctx.arc(x, y, 15 * scale, 0, Math.PI * 2);
    ctx.strokeStyle = isSelected ? '#ffb84d' : isValidDrop ? '#4ddbff' : '#2b3372';
    ctx.lineWidth = (isSelected || isValidDrop ? 2.4 : 1.4) * scale;
    ctx.stroke();
  }
}
function drawSpire() {
  const [x, y] = toPx(PATH_PX[PATH_PX.length - 1][0], PATH_PX[PATH_PX.length - 1][1]);
  const grad = ctx.createRadialGradient(x, y, 2 * scale, x, y, 22 * scale);
  grad.addColorStop(0, '#8a6bff'); grad.addColorStop(1, '#4ddbff11');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, 18 * scale, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4ddbff'; ctx.lineWidth = 2 * scale; ctx.stroke();
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
    drawShape(px, py, (s.tier === 1 ? 13 : 11) * scale, def.shape, def.color);
    if (s.tier === 1) { ctx.strokeStyle = '#fff8'; ctx.lineWidth = 1.4 * scale; ctx.beginPath(); ctx.arc(px, py, (s.tier === 1 ? 13 : 11) * scale + 2 * scale, 0, Math.PI * 2); ctx.stroke(); }
  }
}
function drawEnemies() {
  for (const e of enemies) {
    const [x, y] = toPx(e.x, e.y);
    const info = ENEMIES[e.type];
    const r = (info.r + (e.boss ? 6 : 0)) * scale;
    const slowed = e.slowUntil > simTime;
    drawShape(x, y, r, e.type === 'skiff' ? 'tri' : e.type === 'bulwark' ? 'square' : 'circle', slowed ? '#4ddbff' : info.color);
    if (e.boss) { ctx.strokeStyle = '#ff4d8d88'; ctx.lineWidth = 2 * scale; ctx.beginPath(); ctx.arc(x, y, r + 6 * scale, 0, Math.PI * 2); ctx.stroke(); }
    const w = 22 * scale, ratio = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = '#1a2050'; ctx.fillRect(x - w / 2, y - r - 8 * scale, w, 3 * scale);
    ctx.fillStyle = ratio > 0.4 ? '#5be6a0' : '#ff5c6c'; ctx.fillRect(x - w / 2, y - r - 8 * scale, w * ratio, 3 * scale);
  }
}
function drawParticlesOnCanvas() {
  for (const p of particles) {
    const t = Math.max(0, 1 - p.age / p.life);
    ctx.globalAlpha = t;
    if (p.type === 'tracer') {
      const [x1, y1] = toPx(p.x1, p.y1), [x2, y2] = toPx(p.x2, p.y2);
      ctx.strokeStyle = p.color; ctx.lineWidth = 2 * scale;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    } else {
      const [x, y] = toPx(p.x, p.y);
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, 3 * scale, 0, Math.PI * 2); ctx.fill();
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
  { h: 'Four Sentinels', p: 'Glare Cannon hits fast and single-target. Arc Diffuser splashes a small area. Frost Prism slows a raider down. Vane Sniper hits hard at long range and cuts through armor.' },
  { h: 'Upgrades', p: 'Tap a placed Sentinel to see its Tier 2 upgrade — more damage, more range, and a stronger effect for a one-time Glint cost.' },
  { h: 'Overcharge Pulse', p: "Your commander ability boosts every Sentinel's damage and fire rate for a few seconds. Use it on a tough wave, then wait out its cooldown." },
  { h: 'Hold the Spire', p: 'Every raider that reaches the end drains your Spire’s integrity. Lose it all and the route falls. Clear every wave, including the boss, to win a Campaign run.' },
  { h: 'Duels', p: 'Skirmish and Room Duel add an opposing lane. Spend Glint on Pressure Powers to hit your rival’s lane while defending your own.' },
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
