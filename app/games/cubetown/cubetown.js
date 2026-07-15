'use strict';
/* CubeTown — a cozy geometric-block life-sim/building game for PhantomPlay.
 * Original visual identity: "Lumen Blocks" — warm coral/plum/mint palette,
 * soft rounded isometric blocks. Not Minecraft, not Sims: single-tile
 * blocks, no crafting-grid, no simulated needs beyond one gentle "Spark"
 * meter, and its own cosmetic/vocabulary system (Hue/Topper/Trim, Grain/
 * Shale/Loom, Driftfish, Hearth). See the platform-owner self report at the
 * end of this project for an honest list of what is simplified.
 */
(function () {
  // ---------------------------------------------------------------------
  // Host protocol helper (every PhantomPlay game hand-rolls this the same way)
  // ---------------------------------------------------------------------
  const host = (type, data = {}) => parent.postMessage({ source: 'phantomplay-game', type, ...data }, '*');

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const $ = (sel) => document.querySelector(sel);
  const $all = (sel) => Array.from(document.querySelectorAll(sel));

  const el = {
    clock: $('[data-ct-clock]'),
    clockNote: $('[data-ct-clock-note]'),
    spark: $('[data-ct-spark]'),
    resGrain: $('[data-ct-res-grain]'),
    resShale: $('[data-ct-res-shale]'),
    resLoom: $('[data-ct-res-loom]'),
    resFish: $('[data-ct-res-fish]'),
    togetherBtn: $('[data-ct-together-btn]'),
    toast: $('[data-ct-toast]'),
    context: $('[data-ct-context]'),
    pieceList: $('[data-ct-piece-list]'),
    buildNote: $('[data-ct-build-note]'),
    invList: $('[data-ct-inv-list]'),
    hueRow: $('[data-ct-hue-row]'),
    topperRow: $('[data-ct-topper-row]'),
    trimRow: $('[data-ct-trim-row]'),
    dlgName: $('[data-ct-dlg-name]'),
    dlgBody: $('[data-ct-dlg-body]'),
    dlgQuest: $('[data-ct-dlg-quest]'),
    dlgTurnin: $('[data-ct-dlg-turnin]'),
    fishZone: $('[data-ct-fish-zone]'),
    fishMarker: $('[data-ct-fish-marker]'),
    togetherSub: $('[data-ct-together-sub]'),
    roster: $('[data-ct-roster]'),
    hostControls: $('[data-ct-host-controls]'),
    reportTitle: $('[data-ct-report-title]'),
    reportSub: $('[data-ct-report-sub]'),
    statDay: $('[data-ct-stat-day]'),
    statBuilt: $('[data-ct-stat-built]'),
    statFish: $('[data-ct-stat-fish]'),
    statDish: $('[data-ct-stat-dish]'),
    statQuests: $('[data-ct-stat-quests]'),
    statScore: $('[data-ct-stat-score]'),
    volume: $('[data-ct-volume]'),
    mute: $('[data-ct-mute]'),
    reduced: $('[data-ct-reduced]'),
    tutSteps: $('[data-ct-tut-steps]'),
    tutDots: $('[data-ct-tut-dots]'),
    questLog: $('[data-ct-quest-log]'),
    trialName: $('[data-ct-trial-name]'),
    trialBody: $('[data-ct-trial-body]'),
    trialSeq: $('[data-ct-trial-seq]'),
    trialInput: $('[data-ct-trial-input]'),
  };

  // ---------------------------------------------------------------------
  // Constants: world, resources, palette, npcs, cosmetics
  // ---------------------------------------------------------------------
  const GRID = 17;
  const CORE = { x0: 7, x1: 9, y0: 7, y1: 9 }; // always-grass buildable core
  const DAY_LENGTH_MS = 5 * 60 * 1000; // one full in-game day per 5 real minutes
  const SPARK_DECAY_EVERY_MS = 45000;
  const SPARK_DECAY_AMOUNT = 2;

  const PALETTE = [
    { type: 'floor', label: 'Floor Tile', cost: { grain: 1 }, blocking: false, protect: false, color: '#e3c27a' },
    { type: 'path', label: 'Garden Path', cost: { shale: 1 }, blocking: false, protect: false, color: '#b79b74' },
    { type: 'rug', label: 'Rug', cost: { loom: 1 }, blocking: false, protect: false, color: '#c792ea' },
    { type: 'fence', label: 'Fence', cost: { grain: 1 }, blocking: true, protect: false, color: '#caa06a' },
    { type: 'lamp', label: 'Lumen Lamp', cost: { shale: 1 }, blocking: false, protect: false, color: '#ffcf6b' },
    { type: 'wall', label: 'Wall Block', cost: { shale: 2 }, blocking: true, protect: true, color: '#8fa3c7' },
    { type: 'door', label: 'Door Frame', cost: { shale: 1, grain: 1 }, blocking: false, protect: true, color: '#c7a37a' },
    { type: 'table', label: 'Table', cost: { grain: 2 }, blocking: true, protect: false, color: '#d99b6c' },
    { type: 'chair', label: 'Chair', cost: { grain: 1 }, blocking: false, protect: false, color: '#e0ac7c' },
    { type: 'chest', label: 'Chest', cost: { shale: 2 }, blocking: true, protect: true, color: '#b98a4e' },
    { type: 'bed', label: 'Rest Nook', cost: { grain: 3, loom: 2 }, blocking: true, protect: true, color: '#7fd6b8' },
    { type: 'hearth', label: 'Hearth', cost: { shale: 3 }, blocking: true, protect: true, color: '#ff8a5c' },
    { type: 'garden', label: 'Garden Plot', cost: { loom: 2 }, blocking: true, protect: false, color: '#6fbf7a' },
  ];
  const PALETTE_BY_TYPE = Object.fromEntries(PALETTE.map((p) => [p.type, p]));

  const RECIPES = [
    { key: 'cake', label: 'Grove Cake', cost: { grain: 2 }, spark: 18, ms: 1400, requiresQuest: null },
    { key: 'skewer', label: 'Ember Skewer', cost: { grain: 1, driftfish: 1 }, spark: 32, ms: 2200, requiresQuest: null },
    { key: 'chowder', label: 'Tide Chowder', cost: { driftfish: 2, loom: 1 }, spark: 45, ms: 3200, requiresQuest: 'bo' },
  ];

  const HUES = [
    { key: 'coral', label: 'Coral', color: '#ff9466', lockedBy: null },
    { key: 'mint', label: 'Mint', color: '#5be3b5', lockedBy: null },
    { key: 'slate', label: 'Slate', color: '#8fa3c7', lockedBy: null },
    { key: 'sand', label: 'Sand', color: '#e3c27a', lockedBy: null },
    { key: 'gold', label: 'Gold', color: '#ffd54f', lockedBy: 'miro' },
    { key: 'violet', label: 'Violet', color: '#c792ea', lockedBy: 'tally' },
    { key: 'aqua', label: 'Aqua', color: '#4fd1e8', lockedBy: 'bo' },
    { key: 'ember', label: 'Ember', color: '#ff6b4a', lockedBy: 'runa' },
    { key: 'moss', label: 'Moss', color: '#78d36f', lockedBy: 'ivy' },
    { key: 'moon', label: 'Moon', color: '#b8c8ff', lockedBy: 'nova' },
    { key: 'void', label: 'Void', color: '#2b213f', lockedBy: 'ori' },
  ];
  const TOPPERS = [
    { key: 'none', label: 'None', lockedBy: null },
    { key: 'cap', label: 'Cap', lockedBy: null },
    { key: 'bloom', label: 'Bloom', lockedBy: 'tally' },
    { key: 'halo', label: 'Halo', lockedBy: 'bo' },
    { key: 'crest', label: 'Crest', lockedBy: 'fenn' },
    { key: 'leaf', label: 'Leaf', lockedBy: 'ivy' },
    { key: 'crown', label: 'Crown', lockedBy: 'elder' },
  ];
  const TRIMS = [
    { key: 'soft', label: 'Soft', color: '#ffffff55', lockedBy: null },
    { key: 'bold', label: 'Bold', color: '#ffffffb0', lockedBy: null },
    { key: 'prism', label: 'Prism', color: '#5be3b5', lockedBy: 'all' },
  ];

  const NPC_DEFS = [
    { id: 'miro', name: 'Miro the Mason', hue: '#f2a65a', resourceType: 'quarry', quest: { need: { shale: 5 }, unlockHue: 'gold', unlockTopper: null, reward: { keystone: 1 }, text: 'Bring me 5 Shale and I’ll square off your plot foundations for good. I found a Sun Keystone in the old blockworks.' } },
    { id: 'tally', name: 'Tally the Weaver', hue: '#c792ea', resourceType: 'reed', quest: { need: { loom: 4 }, unlockHue: 'violet', unlockTopper: 'bloom', reward: { keystone: 1 }, text: 'Four bundles of Loom would finish my loom-frame. Worth a nice hat, and I hid a Moon Keystone in the thread box.' } },
    { id: 'bo', name: 'Bo the Angler', hue: '#4fd1e8', resourceType: 'water', quest: { need: { driftfish: 3 }, unlockHue: 'aqua', unlockTopper: 'halo', reward: { keystone: 1 }, text: 'Catch me 3 Driftfish and I’ll teach you my chowder recipe. The Tide Keystone likes a good meal.' } },
    { id: 'runa', name: 'Runa the Ranger', hue: '#ff6b4a', resourceType: 'grove', quest: { need: { grain: 8 }, unlockHue: 'ember', unlockTopper: null, reward: { lumen: 1 }, text: 'The north trail is wider than it looks. Bring 8 Grain and I’ll mark the safe bends on your map.' } },
    { id: 'ivy', name: 'Ivy the Gardener', hue: '#78d36f', resourceType: 'reed', quest: { need: { grain: 5, loom: 3 }, unlockHue: 'moss', unlockTopper: 'leaf', reward: { lumen: 1 }, text: 'The town needs gardens before it needs walls. Bring 5 Grain and 3 Loom and I’ll wake the meadow path.' } },
    { id: 'fenn', name: 'Fenn the Gatekeeper', hue: '#9bb3d6', resourceType: 'shrine', quest: { need: { lumen: 2 }, unlockHue: null, unlockTopper: 'crest', reward: { keystone: 1 }, text: 'Clear two shrine trials and bring me 2 Lumen. Then I’ll hand over the Star Keystone for the Prism Gate.' } },
    { id: 'nova', name: 'Nova the Cartographer', hue: '#b8c8ff', resourceType: 'shrine', quest: { need: { driftfish: 5, lumen: 1 }, unlockHue: 'moon', unlockTopper: null, reward: { relic: 1 }, text: 'I’m mapping the tide ruins. Bring 5 Driftfish and 1 Lumen and I’ll give you a relic compass.' } },
    { id: 'ori', name: 'Ori the Archivist', hue: '#8f7fff', resourceType: 'gate', quest: { need: { relic: 1, keystone: 4 }, unlockHue: 'void', unlockTopper: 'crown', reward: { relic: 1 }, text: 'When four Keystones and one Relic are yours, come back. The Prism Gate only opens for a town that helped its people.' } },
  ];

  const TRIAL_DEFS = [
    { id: 'grove', name: 'Grove Echo Trial', tile: { x: 2, y: 3 }, seq: ['up', 'right', 'down'], reward: { lumen: 1 }, text: 'Repeat the old trail rhythm to calm the grove shrine.' },
    { id: 'quarry', name: 'Quarry Switch Trial', tile: { x: 14, y: 3 }, seq: ['left', 'up', 'right', 'right'], reward: { lumen: 1 }, text: 'Strike the switches in order before the stone hum fades.' },
    { id: 'tide', name: 'Tide Lantern Trial', tile: { x: 2, y: 13 }, seq: ['down', 'right', 'up', 'left'], reward: { lumen: 1 }, text: 'Guide the lantern around the tide line without breaking the glow.' },
    { id: 'spire', name: 'Spire Heart Trial', tile: { x: 14, y: 13 }, seq: ['up', 'left', 'down', 'right', 'up'], reward: { lumen: 1, relic: 1 }, text: 'Match the full heart-pattern to wake the path toward the Prism Gate.' },
  ];
  const TRIAL_BY_ID = Object.fromEntries(TRIAL_DEFS.map((trial) => [trial.id, trial]));
  const GATE_TILE = { x: 8, y: 1 };
  const NPC_HOME_POINTS = [
    { x: 6, y: 6 }, { x: 10, y: 6 }, { x: 6, y: 10 }, { x: 10, y: 10 },
    { x: 3, y: 7 }, { x: 13, y: 7 }, { x: 4, y: 13 }, { x: 12, y: 13 },
  ];

  // ---------------------------------------------------------------------
  // Deterministic RNG + terrain generation (seed lives in save data, the
  // 81-tile terrain grid itself never needs to be persisted).
  // ---------------------------------------------------------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function isCore(x, y) { return x >= CORE.x0 && x <= CORE.x1 && y >= CORE.y0 && y <= CORE.y1; }
  function inBounds(x, y) { return x >= 0 && y >= 0 && x < GRID && y < GRID; }
  function isLandmark(x, y) {
    return (x === GATE_TILE.x && y === GATE_TILE.y) || TRIAL_DEFS.some((trial) => trial.tile.x === x && trial.tile.y === y);
  }
  function genTerrain(seed) {
    const rnd = mulberry32(seed);
    const grid = [];
    for (let y = 0; y < GRID; y++) grid.push(new Array(GRID).fill('grass'));
    const ponds = [
      { x: 1, y: 9, w: 4, h: 5, chance: 0.74 },
      { x: 12, y: 6, w: 4, h: 4, chance: 0.58 },
    ];
    for (const pond of ponds) for (let dy = 0; dy < pond.h; dy++) for (let dx = 0; dx < pond.w; dx++) {
      const x = pond.x + dx, y = pond.y + dy;
      if (rnd() < pond.chance && !isCore(x, y) && !isLandmark(x, y)) grid[y][x] = 'water';
    }
    function scatter(type, count) {
      let placed = 0, guard = 0;
      while (placed < count && guard < 500) {
        guard++;
        const x = Math.floor(rnd() * GRID), y = Math.floor(rnd() * GRID);
        if (isCore(x, y) || isLandmark(x, y) || grid[y][x] !== 'grass') continue;
        grid[y][x] = type; placed++;
      }
    }
    scatter('grove', 22); scatter('quarry', 18); scatter('reed', 18);
    for (const trial of TRIAL_DEFS) {
      grid[trial.tile.y][trial.tile.x] = 'shrine';
      for (const n of neighbors4(trial.tile.x, trial.tile.y)) if (inBounds(n.x, n.y) && !isCore(n.x, n.y)) grid[n.y][n.x] = 'grass';
    }
    grid[GATE_TILE.y][GATE_TILE.x] = 'gate';
    for (const n of neighbors4(GATE_TILE.x, GATE_TILE.y)) if (inBounds(n.x, n.y)) grid[n.y][n.x] = 'grass';
    for (let i = 2; i <= 14; i += 2) {
      if (grid[8][i] === 'grass') grid[8][i] = 'trail';
      if (grid[i][8] === 'grass') grid[i][8] = 'trail';
    }
    return grid;
  }
  function findFirstOfType(terrain, type) {
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (terrain[y][x] === type) return { x, y };
    return null;
  }
  function nearestGrass(terrain, x, y) {
    if (inBounds(x, y) && terrain[y][x] === 'grass') return { x, y };
    for (let r = 1; r < GRID; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (inBounds(nx, ny) && terrain[ny][nx] === 'grass') return { x: nx, y: ny };
      }
    }
    return { x: 8, y: 8 };
  }
  function adjacentGrassTo(terrain, tile) {
    if (!tile) return { x: 8, y: 8 };
    const opts = [{ x: tile.x + 1, y: tile.y }, { x: tile.x - 1, y: tile.y }, { x: tile.x, y: tile.y + 1 }, { x: tile.x, y: tile.y - 1 }];
    for (const o of opts) if (inBounds(o.x, o.y) && terrain[o.y][o.x] === 'grass') return o;
    return nearestGrass(terrain, tile.x, tile.y);
  }

  // ---------------------------------------------------------------------
  // Game state (persisted) + runtime (not persisted)
  // ---------------------------------------------------------------------
  let state = null;   // set by newGame() or applyState()
  let terrain = null; // regenerated from state.seed, never persisted directly
  let npcs = [];       // runtime NPC objects (schedule targets derived from terrain + state.quests)

  const rt = {
    playerPx: 0, playerPy: 0, playerFromX: 0, playerFromY: 0, playerToX: 0, playerToY: 0, moveT: 1, moveDur: 160,
    facing: 'down',
    gathering: null, // {x,y,t,dur}
    cooking: null,   // {recipe,t,dur}
    particles: [],
    lastFrame: 0,
    dpr: 1, W: 0, H: 0, tileW: 48, tileH: 24, originX: 0, originY: 0,
    paused: false,
    reducedMotion: false,
    hostSound: true,
    running: true,
    lastSparkTick: 0,
    lastPushAt: 0,
    lastAutoPush: 0,
    playSecondsAccum: 0,
    dialogueNpc: null,
    dialogueMode: null, // 'npc' | 'cook'
    fishing: { open: false, zoneStart: 0.4, zoneWidth: 0.22, marker: 0, dir: 1, speed: 0.55 },
    build: { open: false, tool: 'place', selected: null, rotation: 0, placing: false },
    tutorial: { step: 0 },
    trial: null, // {trial,input:[]}
  };

  const mp = {
    active: false, participants: [], sharedTown: [], openBuilding: 'host_only',
    amIHost: false, hostStatus: 'n/a', probeSent: false, pendingNonce: null, hostCheckAt: 0,
    lastSyncAt: 0,
  };

  function defaultQuestState() {
    return Object.fromEntries(NPC_DEFS.map((npc) => [npc.id, { done: false }]));
  }
  function defaultAdventureState() {
    return {
      gateOpen: false,
      trials: Object.fromEntries(TRIAL_DEFS.map((trial) => [trial.id, { done: false }])),
    };
  }
  function newGame(seed) {
    state = {
      version: 2,
      seed: seed >>> 0,
      day: 1,
      minutes: 400, // ~6:40am
      player: { gx: 8, gy: 8, hue: 'coral', topper: 'none', trim: 'soft', name: 'Resident' },
      inventory: { grain: 3, shale: 2, loom: 1, driftfish: 0, lumen: 0, keystone: 0, relic: 0, cake: 0, skewer: 0, chowder: 0 },
      spark: 78,
      town: [], // {id,type,gx,gy,rot}
      quests: defaultQuestState(),
      adventure: defaultAdventureState(),
      cosmeticsUnlocked: { hue: ['coral', 'mint', 'slate', 'sand'], topper: ['none', 'cap'], trim: ['soft', 'bold'] },
      tutorialSeen: false,
      stats: { gathered: 0, built: 0, demolished: 0, fishCaught: 0, fishTried: 0, dishesCooked: 0, questsCompleted: 0, trialsCleared: 0, gatesOpened: 0, secondsPlayed: 0 },
      completedMilestone: false,
    };
    terrain = genTerrain(state.seed);
    npcs = buildNpcRuntime();
  }

  function buildNpcRuntime() {
    return NPC_DEFS.map((def, i) => {
      const resTile = findFirstOfType(terrain, def.resourceType);
      const workplace = adjacentGrassTo(terrain, resTile);
      const homeHint = NPC_HOME_POINTS[i % NPC_HOME_POINTS.length];
      const home = nearestGrass(terrain, homeHint.x, homeHint.y);
      const square = nearestGrass(terrain, 8, 7);
      const quest = state.quests[def.id] || { done: false };
      const gx = home.x, gy = home.y;
      return {
        id: def.id, name: def.name, hue: def.hue, def,
        home, workplace, square,
        gx, gy, screenPx: 0, screenPy: 0, targetGx: gx, targetGy: gy, moveFrom: { x: gx, y: gy }, moveT: 1, moveDur: 3000,
        segment: 'night', quest,
      };
    });
  }

  // ---------------------------------------------------------------------
  // Sizing / iso projection
  // ---------------------------------------------------------------------
  function size() {
    rt.dpr = Math.min(2, window.devicePixelRatio || 1);
    rt.W = canvas.width = Math.max(640, innerWidth * rt.dpr);
    rt.H = canvas.height = Math.max(420, innerHeight * rt.dpr);
    rt.tileW = Math.max(30, Math.min(64, rt.W / (GRID * 1.05))) ;
    rt.tileH = rt.tileW / 2;
    rt.originX = rt.W / 2;
    rt.originY = rt.H * 0.24;
  }
  addEventListener('resize', size);

  function tileToScreen(gx, gy) {
    return {
      x: rt.originX + (gx - gy) * (rt.tileW / 2),
      y: rt.originY + (gx + gy) * (rt.tileH / 2),
    };
  }

  // ---------------------------------------------------------------------
  // World queries
  // ---------------------------------------------------------------------
  function townPieceAt(gx, gy, town) {
    for (const p of town) if (p.gx === gx && p.gy === gy) return p;
    return null;
  }
  function currentTown() {
    if (!mp.active || mp.amIHost) return state.town;
    return state.town.concat(mp.sharedTown);
  }
  function isBlockedTile(gx, gy) {
    if (!inBounds(gx, gy)) return true;
    const t = terrain[gy][gx];
    if (t === 'water' || t === 'grove' || t === 'quarry' || t === 'reed' || t === 'shrine') return true;
    if (t === 'gate' && !state.adventure?.gateOpen) return true;
    const piece = townPieceAt(gx, gy, currentTown());
    if (piece && PALETTE_BY_TYPE[piece.type] && PALETTE_BY_TYPE[piece.type].blocking) return true;
    return false;
  }
  function isBuildableGround(gx, gy) {
    if (!inBounds(gx, gy)) return false;
    const t = terrain[gy][gx];
    if (t !== 'grass') return false;
    if (gx === state.player.gx && gy === state.player.gy) return false;
    if (townPieceAt(gx, gy, state.town)) return false;
    if (mp.active && !mp.amIHost && townPieceAt(gx, gy, mp.sharedTown)) return false;
    return true;
  }
  function neighbors4(gx, gy) {
    return [{ x: gx + 1, y: gy }, { x: gx - 1, y: gy }, { x: gx, y: gy + 1 }, { x: gx, y: gy - 1 }];
  }

  // ---------------------------------------------------------------------
  // Audio (Web Audio synth — no external/commercial samples)
  // ---------------------------------------------------------------------
  const audio = { ctx: null, volume: 0.7, mute: false, unlocked: false };
  function unlockAudio() {
    if (audio.unlocked) {
      if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
      return;
    }
    audio.unlocked = true;
    try {
      audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
    } catch (e) { audio.ctx = null; }
  }
  function masterGain() {
    return (audio.mute || !rt.hostSound) ? 0 : audio.volume;
  }
  function beep(freq, dur, type = 'sine', vol = 0.2) {
    if (!audio.ctx) return;
    const g = masterGain();
    if (g <= 0) return;
    try {
      const osc = audio.ctx.createOscillator();
      const gain = audio.ctx.createGain();
      osc.type = type; osc.frequency.value = freq;
      gain.gain.value = 0;
      osc.connect(gain).connect(audio.ctx.destination);
      const t0 = audio.ctx.currentTime;
      gain.gain.linearRampToValueAtTime(vol * g, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  const sfx = {
    gather: () => beep(520, 0.18, 'triangle', 0.22),
    place: () => beep(340, 0.14, 'square', 0.16),
    demolish: () => beep(180, 0.22, 'sawtooth', 0.14),
    fishCast: () => beep(260, 0.3, 'sine', 0.15),
    fishCatch: () => { beep(660, 0.16, 'triangle', 0.22); setTimeout(() => beep(880, 0.2, 'triangle', 0.2), 90); },
    fishMiss: () => beep(140, 0.3, 'sawtooth', 0.14),
    cookDone: () => { beep(500, 0.14, 'sine', 0.2); setTimeout(() => beep(700, 0.18, 'sine', 0.2), 100); },
    quest: () => { beep(440, 0.16, 'triangle', 0.24); setTimeout(() => beep(660, 0.16, 'triangle', 0.24), 120); setTimeout(() => beep(880, 0.22, 'triangle', 0.24), 240); },
    step: () => beep(220, 0.05, 'square', 0.05),
  };

  // ---------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 2600);
  }

  // ---------------------------------------------------------------------
  // Panels
  // ---------------------------------------------------------------------
  function openPanel(name) {
    $all('.panel').forEach((p) => p.classList.remove('is-open'));
    const p = document.querySelector(`[data-ct-panel="${name}"]`);
    if (p) p.classList.add('is-open');
    if (name === 'build') renderBuildPanel();
    if (name === 'inventory') renderInventoryPanel();
    if (name === 'customize') renderCustomizePanel();
    if (name === 'together') renderTogetherPanel();
    if (name === 'report') renderReportPanel(false);
    if (name === 'questlog') renderQuestLogPanel();
    if (name === 'tutorial') { rt.tutorial.step = 0; renderTutorial(); }
  }
  function closePanels() {
    $all('.panel').forEach((p) => p.classList.remove('is-open'));
    rt.build.placing = false;
    if (rt.fishing.open) { rt.fishing.open = false; if (fishRaf) cancelAnimationFrame(fishRaf); }
  }
  function anyPanelOpen() {
    return $all('.panel.is-open').length > 0;
  }

  // ---------------------------------------------------------------------
  // Build panel
  // ---------------------------------------------------------------------
  function renderBuildPanel() {
    el.pieceList.innerHTML = PALETTE.map((p) => {
      const afford = canAfford(p.cost);
      const sel = rt.build.selected === p.type ? 'is-selected' : '';
      const costTxt = Object.entries(p.cost).map(([k, v]) => `${v}${k[0].toUpperCase()}`).join(' ');
      return `<button type="button" class="piece-btn ${sel} ${afford ? '' : 'is-locked'}" data-ct-pick="${p.type}">
        <span class="piece-swatch" style="background:${p.color}"></span>
        <span>${p.label}</span>
        <span class="piece-cost">${costTxt}${p.protect ? ' · sturdy' : ''}</span>
      </button>`;
    }).join('');
    $all('[data-ct-pick]').forEach((b) => b.onclick = () => {
      const type = b.dataset.ctPick;
      if (!canAfford(PALETTE_BY_TYPE[type].cost)) { toast('Not enough resources for that yet.'); return; }
      if (mp.active && !mp.amIHost && mp.openBuilding === 'host_only') { toast('The host has building locked for visitors right now.'); return; }
      closePanels();
      rt.build.selected = type;
      rt.build.tool = 'place';
      rt.build.placing = true;
      toast(`Placing ${PALETTE_BY_TYPE[type].label} — tap an open tile. Esc cancels.`);
    });
    updateBuildNote();
  }
  function updateBuildNote() {
    let note = 'Tap Demolish, then tap one of your own pieces to remove it (you get half the resources back).';
    if (mp.active && !mp.amIHost) note = mp.openBuilding === 'everyone' ? 'The host has building open — your placements stay local to your visit, layered over the host’s shared town.' : 'Only the room host can build the shared town right now. Ask them to open it from Together.';
    el.buildNote.textContent = note;
  }

  // ---------------------------------------------------------------------
  // Inventory panel
  // ---------------------------------------------------------------------
  const FOOD_TYPES = { cake: 'Grove Cake', skewer: 'Ember Skewer', chowder: 'Tide Chowder' };
  const RES_LABELS = { grain: 'Grain', shale: 'Shale', loom: 'Loom', driftfish: 'Driftfish', lumen: 'Lumen', keystone: 'Keystone', relic: 'Relic' };
  function renderInventoryPanel() {
    const rows = [];
    for (const [k, label] of Object.entries(RES_LABELS)) rows.push({ key: k, label, count: state.inventory[k] || 0, food: false });
    for (const [k, label] of Object.entries(FOOD_TYPES)) rows.push({ key: k, label, count: state.inventory[k] || 0, food: true });
    el.invList.innerHTML = rows.map((r) => `<div class="inv-item"><span>${r.label} × ${r.count}</span>${r.food ? `<button type="button" data-ct-eat="${r.key}" ${r.count > 0 ? '' : 'disabled'}>Eat</button>` : ''}</div>`).join('');
    $all('[data-ct-eat]').forEach((b) => b.onclick = () => eatFood(b.dataset.ctEat));
  }
  function eatFood(key) {
    const recipe = RECIPES.find((r) => r.key === key);
    if (!recipe || (state.inventory[key] || 0) <= 0) return;
    state.inventory[key] -= 1;
    state.spark = clamp(state.spark + recipe.spark, 0, 100);
    sfx.cookDone();
    toast(`Ate a ${recipe.label} — +${recipe.spark} Spark.`);
    renderInventoryPanel();
    updateHud();
    schedulePush();
  }

  // ---------------------------------------------------------------------
  // Customize panel
  // ---------------------------------------------------------------------
  function renderCustomizePanel() {
    el.hueRow.innerHTML = HUES.map((h) => swatch(h, state.player.hue, 'hue', h.color)).join('');
    el.topperRow.innerHTML = TOPPERS.map((t) => swatch(t, state.player.topper, 'topper', '#33244f')).join('');
    el.trimRow.innerHTML = TRIMS.map((t) => swatch(t, state.player.trim, 'trim', t.color)).join('');
    $all('[data-ct-cos]').forEach((b) => b.onclick = () => {
      const [cat, key] = b.dataset.ctCos.split('|');
      if (!isCosmeticUnlocked(cat, key)) { toast('Finish that resident’s quest to unlock it.'); return; }
      state.player[cat] = key;
      renderCustomizePanel();
      schedulePush();
    });
  }
  function isCosmeticUnlocked(cat, key) {
    return (state.cosmeticsUnlocked[cat] || []).includes(key);
  }
  function swatch(def, current, cat, color) {
    const unlocked = isCosmeticUnlocked(cat, def.key);
    const cls = ['swatch', current === def.key ? 'is-selected' : '', unlocked ? '' : 'is-locked'].join(' ');
    return `<button type="button" class="${cls}" title="${def.label}" data-ct-cos="${cat}|${def.key}" style="background:${color}"></button>`;
  }
  function unlockCosmetic(cat, key) {
    if (!state.cosmeticsUnlocked[cat].includes(key)) state.cosmeticsUnlocked[cat].push(key);
  }

  // ---------------------------------------------------------------------
  // Dialogue / cook prompt (shared panel)
  // ---------------------------------------------------------------------
  function openNpcDialogue(npc) {
    rt.dialogueMode = 'npc';
    rt.dialogueNpc = npc;
    el.dlgName.textContent = npc.name;
    const q = npc.quest;
    const def = npc.def.quest;
    if (q.done) {
      el.dlgBody.textContent = 'Thanks again for the help — the town looks better for it.';
      el.dlgQuest.hidden = true;
      el.dlgTurnin.hidden = true;
    } else {
      el.dlgBody.textContent = def.text;
      const needTxt = Object.entries(def.need).map(([k, v]) => `${v} ${RES_LABELS[k] || k}`).join(', ');
      const rewardTxt = def.reward ? ` Reward: ${Object.entries(def.reward).map(([k, v]) => `${v} ${RES_LABELS[k] || k}`).join(', ')}.` : '';
      const haveOk = questReady(def.need);
      el.dlgQuest.hidden = false;
      el.dlgQuest.textContent = `Needs: ${needTxt} — you have ${Object.entries(def.need).map(([k]) => state.inventory[k] || 0).join('/')}.${rewardTxt}`;
      el.dlgTurnin.hidden = !haveOk;
    }
    openPanel('dialogue');
  }
  function questReady(need) {
    return Object.entries(need).every(([k, v]) => (state.inventory[k] || 0) >= v);
  }
  el.dlgTurnin.onclick = () => {
    const npc = rt.dialogueNpc;
    if (!npc || npc.quest.done) return;
    const def = npc.def.quest;
    if (!questReady(def.need)) return;
    for (const [k, v] of Object.entries(def.need)) state.inventory[k] -= v;
    npc.quest.done = true;
    if (!state.quests[npc.id]) state.quests[npc.id] = { done: false };
    state.quests[npc.id].done = true;
    if (def.reward) for (const [k, v] of Object.entries(def.reward)) state.inventory[k] = (state.inventory[k] || 0) + v;
    if (def.unlockHue) unlockCosmetic('hue', def.unlockHue);
    if (def.unlockTopper) unlockCosmetic('topper', def.unlockTopper);
    state.stats.questsCompleted += 1;
    state.spark = clamp(state.spark + 15, 0, 100);
    sfx.quest();
    toast(`${npc.name}’s quest complete!`);
    checkAllQuestsMilestone();
    closePanels();
    updateHud();
    schedulePush();
  };
  function checkAllQuestsMilestone() {
    const done = Object.values(state.quests).every((q) => q.done);
    if (done && !state.adventure?.gateOpen && !state.completedMilestone) {
      toast('Every resident is with you. Take the Keystones to the Prism Gate.');
    }
  }
  function openCookPrompt() {
    rt.dialogueMode = 'cook';
    el.dlgName.textContent = 'Hearth';
    el.dlgQuest.hidden = true;
    el.dlgTurnin.hidden = true;
    const rows = RECIPES.filter((r) => !r.requiresQuest || state.quests[r.requiresQuest].done).map((r) => {
      const afford = canAfford(r.cost);
      const costTxt = Object.entries(r.cost).map(([k, v]) => `${v} ${RES_LABELS[k] || k}`).join(', ');
      return `<div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0"><span>${r.label} <i style="color:var(--text-dim);font-size:11px">(${costTxt} · +${r.spark} Spark)</i></span><button type="button" data-ct-cook="${r.key}" ${afford ? '' : 'disabled'} style="background:var(--coral);border:none;color:#2a1608;border-radius:8px;padding:5px 10px;font-weight:800;font-size:11px">Cook</button></div>`;
    }).join('');
    el.dlgBody.innerHTML = rows || '<p>No recipes available yet.</p>';
    openPanel('dialogue');
    $all('[data-ct-cook]').forEach((b) => b.onclick = () => startCooking(b.dataset.ctCook));
  }
  function startCooking(key) {
    const r = RECIPES.find((x) => x.key === key);
    if (!r || !canAfford(r.cost)) return;
    for (const [k, v] of Object.entries(r.cost)) state.inventory[k] -= v;
    closePanels();
    toast(`Cooking ${r.label}…`);
    rt.cooking = { recipe: r, t: 0, dur: rt.reducedMotion ? 250 : r.ms };
  }
  function finishCooking() {
    const r = rt.cooking.recipe;
    state.inventory[r.key] = (state.inventory[r.key] || 0) + 1;
    state.stats.dishesCooked += 1;
    sfx.cookDone();
    toast(`${r.label} is ready!`);
    rt.cooking = null;
    updateHud();
    schedulePush();
  }

  // ---------------------------------------------------------------------
  // Fishing minigame
  // ---------------------------------------------------------------------
  function openFishing() {
    rt.fishing.open = true;
    rt.fishing.zoneStart = 0.14 + Math.random() * 0.55;
    rt.fishing.zoneWidth = 0.18 + Math.random() * 0.08;
    rt.fishing.marker = 0;
    rt.fishing.dir = 1;
    rt.fishing.speed = 0.5 + Math.random() * 0.3;
    el.fishZone.style.left = `${rt.fishing.zoneStart * 100}%`;
    el.fishZone.style.width = `${rt.fishing.zoneWidth * 100}%`;
    sfx.fishCast();
    openPanel('fishing');
    state.stats.fishTried += 1;
    requestAnimationFrame(fishLoop);
  }
  let fishRaf = null;
  function fishLoop(t) {
    if (!rt.fishing.open) return;
    rt.fishing.marker += rt.fishing.dir * rt.fishing.speed * 0.016;
    if (rt.fishing.marker > 1) { rt.fishing.marker = 1; rt.fishing.dir = -1; }
    if (rt.fishing.marker < 0) { rt.fishing.marker = 0; rt.fishing.dir = 1; }
    el.fishMarker.style.left = `calc(${rt.fishing.marker * 100}% - 3px)`;
    fishRaf = requestAnimationFrame(fishLoop);
  }
  function fishCatch() {
    if (!rt.fishing.open) return;
    const hit = rt.fishing.marker >= rt.fishing.zoneStart && rt.fishing.marker <= rt.fishing.zoneStart + rt.fishing.zoneWidth;
    if (hit) {
      state.inventory.driftfish = (state.inventory.driftfish || 0) + 1;
      state.stats.fishCaught += 1;
      sfx.fishCatch();
      spawnParticles(rt.playerToX, rt.playerToY, '#4fd1e8');
      toast('Caught a Driftfish!');
    } else {
      sfx.fishMiss();
      toast('It slipped away — try again.');
    }
    rt.fishing.open = false;
    if (fishRaf) cancelAnimationFrame(fishRaf);
    closePanels();
    updateHud();
    schedulePush();
  }
  function fishLeave() {
    rt.fishing.open = false;
    if (fishRaf) cancelAnimationFrame(fishRaf);
    closePanels();
  }

  // ---------------------------------------------------------------------
  // Shrine trials / Prism Gate adventure layer
  // ---------------------------------------------------------------------
  const DIR_LABEL = { up: '▲', down: '▼', left: '◀', right: '▶' };
  function openTrial(trial) {
    if (!trial) return;
    const done = state.adventure?.trials?.[trial.id]?.done;
    rt.trial = { trial, input: [] };
    el.trialName.textContent = done ? `${trial.name} cleared` : trial.name;
    el.trialBody.textContent = done
      ? 'The shrine is calm now. Its Lumen is already part of your town story.'
      : trial.text;
    el.trialSeq.innerHTML = trial.seq.map((dir) => `<span>${DIR_LABEL[dir]}</span>`).join('');
    el.trialInput.innerHTML = done
      ? '<p class="small-note">You already solved this shrine.</p>'
      : ['up', 'left', 'right', 'down'].map((dir) => `<button type="button" data-ct-trial-dir="${dir}">${DIR_LABEL[dir]}</button>`).join('');
    openPanel('trial');
    $all('[data-ct-trial-dir]').forEach((button) => button.onclick = () => trialStep(button.dataset.ctTrialDir));
  }
  function trialStep(dir) {
    if (!rt.trial) return;
    const { trial, input } = rt.trial;
    input.push(dir);
    const expected = trial.seq.slice(0, input.length).join('|');
    if (input.join('|') !== expected) {
      rt.trial.input = [];
      state.spark = clamp(state.spark - 5, 0, 100);
      sfx.fishMiss();
      toast('Wrong pattern — the shrine resets. Watch the arrows and try again.');
      updateHud();
      return;
    }
    el.trialInput.querySelectorAll('button').forEach((button, index) => {
      button.classList.toggle('is-on', index < input.length);
    });
    if (input.length < trial.seq.length) return;
    if (!state.adventure.trials[trial.id]) state.adventure.trials[trial.id] = { done: false };
    if (!state.adventure.trials[trial.id].done) {
      state.adventure.trials[trial.id].done = true;
      for (const [k, v] of Object.entries(trial.reward || {})) state.inventory[k] = (state.inventory[k] || 0) + v;
      state.stats.trialsCleared = (state.stats.trialsCleared || 0) + 1;
      state.spark = clamp(state.spark + 10, 0, 100);
      sfx.quest();
      spawnParticles(trial.tile.x, trial.tile.y, '#5be3b5');
      toast(`${trial.name} cleared — Lumen recovered.`);
    }
    closePanels();
    updateHud();
    schedulePush();
  }
  function openGate() {
    if (state.adventure?.gateOpen) {
      renderReportPanel(true);
      return;
    }
    const hasKeys = (state.inventory.keystone || 0) >= 4;
    const hasRelic = (state.inventory.relic || 0) >= 1;
    if (!hasKeys || !hasRelic) {
      el.dlgName.textContent = 'Prism Gate';
      el.dlgBody.textContent = 'The gate hums, but it needs four Keystones and one Relic. Help the residents, clear shrines, and return when the town story is ready.';
      el.dlgQuest.hidden = false;
      el.dlgQuest.textContent = `Needed: 4 Keystones and 1 Relic — you have ${state.inventory.keystone || 0} Keystones and ${state.inventory.relic || 0} Relic.`;
      el.dlgTurnin.hidden = true;
      openPanel('dialogue');
      return;
    }
    state.adventure.gateOpen = true;
    state.stats.gatesOpened = (state.stats.gatesOpened || 0) + 1;
    state.completedMilestone = true;
    unlockCosmetic('trim', 'prism');
    unlockCosmetic('topper', 'crown');
    state.spark = 100;
    const score = computeScore();
    sfx.quest();
    host('score', { score });
    host('complete', { score, progress: 100, state: captureState() });
    toast('The Prism Gate opens. CubeTown is awake.');
    updateHud();
    schedulePush();
    setTimeout(() => renderReportPanel(true), 450);
  }

  // ---------------------------------------------------------------------
  // Together / multiplayer panel
  // ---------------------------------------------------------------------
  function renderTogetherPanel() {
    if (!mp.active) {
      el.togetherSub.textContent = 'Join or host a PhantomPlay room from the lobby to visit a town together.';
      el.roster.innerHTML = '';
      el.hostControls.hidden = true;
      return;
    }
    const statusTxt = mp.hostStatus === 'host' ? 'You are hosting — your builds are the shared town.' : mp.hostStatus === 'guest' ? 'You are visiting — your builds stay local to you.' : 'Working out your role in this room…';
    el.togetherSub.textContent = statusTxt;
    el.roster.innerHTML = mp.participants.map((p) => `<div class="roster-row"><span>${escapeHtml(p.label || 'Resident')}</span><span class="badge">${p.role === 'host' ? 'Host' : 'Player'} · ${p.status || 'online'}</span></div>`).join('') || '<p class="small-note">No one else has joined yet.</p>';
    el.hostControls.hidden = mp.hostStatus !== 'host';
    $all('[data-ct-ob]').forEach((b) => b.classList.toggle('is-on', b.dataset.ctOb === mp.openBuilding));
  }

  // ---------------------------------------------------------------------
  // Report / results panel
  // ---------------------------------------------------------------------
  function questDoneCount() {
    return NPC_DEFS.filter((npc) => state.quests?.[npc.id]?.done).length;
  }
  function trialDoneCount() {
    return TRIAL_DEFS.filter((trial) => state.adventure?.trials?.[trial.id]?.done).length;
  }
  function computeScore() {
    const s = state.stats;
    return s.built * 5 + questDoneCount() * 55 + trialDoneCount() * 35 + (s.gatesOpened || 0) * 180 + s.fishCaught * 4 + s.dishesCooked * 5 + (state.day - 1) * 10;
  }
  function computeProgress() {
    if (state.completedMilestone) return 100;
    const questPart = (questDoneCount() / NPC_DEFS.length) * 48;
    const trialPart = (trialDoneCount() / TRIAL_DEFS.length) * 24;
    const buildPart = Math.min(state.stats.built, 24) / 24 * 18;
    const gatePart = state.adventure?.gateOpen ? 10 : 0;
    return Math.min(99, Math.round(questPart + trialPart + buildPart + gatePart));
  }
  function renderReportPanel(milestone) {
    const qDone = questDoneCount();
    const tDone = trialDoneCount();
    el.reportTitle.textContent = milestone ? 'Prism Gate Opened!' : 'Town Report';
    el.reportSub.textContent = milestone ? 'The full CubeTown playthrough is complete. Keep building, fishing, and hosting friends as long as you like.' : `Day ${state.day}, ${formatClock(state.minutes)} · ${qDone}/${NPC_DEFS.length} resident arcs · ${tDone}/${TRIAL_DEFS.length} shrine trials.`;
    el.statDay.textContent = state.day;
    el.statBuilt.textContent = state.stats.built;
    el.statFish.textContent = state.stats.fishCaught;
    el.statDish.textContent = state.stats.dishesCooked;
    el.statQuests.textContent = `${qDone}/${NPC_DEFS.length}`;
    el.statScore.textContent = computeScore();
    openPanel('report');
  }
  function renderQuestLogPanel() {
    const rewardLine = (reward) => reward ? Object.entries(reward).map(([k, v]) => `${v} ${RES_LABELS[k] || k}`).join(', ') : 'Town trust';
    const questRows = NPC_DEFS.map((npc) => {
      const done = state.quests?.[npc.id]?.done;
      const need = Object.entries(npc.quest.need).map(([k, v]) => `${v} ${RES_LABELS[k] || k}`).join(', ');
      return `<div class="quest-row ${done ? 'is-done' : ''}">
        <b>${done ? '✓' : '□'} ${escapeHtml(npc.name)}</b>
        <span>${escapeHtml(need)} → ${escapeHtml(rewardLine(npc.quest.reward))}</span>
      </div>`;
    }).join('');
    const trialRows = TRIAL_DEFS.map((trial) => {
      const done = state.adventure?.trials?.[trial.id]?.done;
      return `<div class="quest-row ${done ? 'is-done' : ''}">
        <b>${done ? '✓' : '□'} ${escapeHtml(trial.name)}</b>
        <span>${trial.seq.map((dir) => DIR_LABEL[dir]).join(' ')} → ${escapeHtml(rewardLine(trial.reward))}</span>
      </div>`;
    }).join('');
    const gateReady = (state.inventory.keystone || 0) >= 4 && (state.inventory.relic || 0) >= 1;
    el.questLog.innerHTML = `
      <section class="quest-chapter">
        <h3>Chapter ${state.adventure?.gateOpen ? 'Complete' : gateReady ? 'Final' : 'I'} · The Prism Gate</h3>
        <p>${state.adventure?.gateOpen ? 'The Prism Gate is open. CubeTown is awake.' : gateReady ? 'You have the pieces. Walk to the north gate and open it.' : 'Help residents, clear shrine trials, recover four Keystones, and bring one Relic to the north gate.'}</p>
      </section>
      <section class="quest-chapter"><h3>Residents</h3>${questRows}</section>
      <section class="quest-chapter"><h3>Shrine Trials</h3>${trialRows}</section>
      <section class="quest-chapter"><h3>Inventory Clues</h3><p>${state.inventory.keystone || 0}/4 Keystones · ${state.inventory.lumen || 0} Lumen · ${state.inventory.relic || 0}/1 Relic · ${state.stats.built || 0} pieces built</p></section>`;
  }

  // ---------------------------------------------------------------------
  // Tutorial
  // ---------------------------------------------------------------------
  const TUTORIAL_STEPS = [
    'Move around the expanded island with WASD / arrow keys, or the on-screen pad on touch devices.',
    'Open Quest Log when you need direction. The full playthrough is residents → shrine trials → Prism Gate.',
    'Walk next to a Grove, Quarry, or Reed patch and press the glowing action button to gather Grain, Shale, or Loom.',
    'Open Build to spend resources on floors, walls, furniture, and a Hearth. Pick a piece, then tap an open tile to place it — Demolish removes your own pieces for half the cost back.',
    'Find shrine blocks around the edges of the map. Each one has a short pattern trial that rewards Lumen, Relics, or story progress.',
    'Visit the pond and press the action button to fish for Driftfish. Tap Catch when the marker crosses the glowing zone.',
    'Cook at a Hearth to turn resources into dishes that refill your Spark meter. Spark drifts down slowly over time — it’s a gentle nudge, never a fail state.',
    'Talk to the residents around town. Each has a quest that unlocks looks, Keystones, or adventure rewards.',
    'When four Keystones and a Relic are yours, walk to the north Prism Gate and open the finale.',
    'CubeTown saves through PhantomPlay automatically, and you can invite up to two friends to visit your town together from the Together panel.',
  ];
  function renderTutorial() {
    el.tutSteps.innerHTML = TUTORIAL_STEPS.map((s, i) => `<p class="tut-step ${i === rt.tutorial.step ? 'is-active' : ''}">${s}</p>`).join('');
    el.tutDots.innerHTML = TUTORIAL_STEPS.map((_, i) => `<i class="${i === rt.tutorial.step ? 'is-active' : ''}"></i>`).join('');
    $('[data-ct-tut-next]').textContent = rt.tutorial.step >= TUTORIAL_STEPS.length - 1 ? 'Let’s go' : 'Next';
  }
  function tutorialNext() {
    if (rt.tutorial.step >= TUTORIAL_STEPS.length - 1) { finishTutorial(); return; }
    rt.tutorial.step += 1;
    renderTutorial();
  }
  function finishTutorial() {
    state.tutorialSeen = true;
    closePanels();
    schedulePush();
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function canAfford(cost) { return Object.entries(cost).every(([k, v]) => (state.inventory[k] || 0) >= v); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function formatClock(minutes) {
    const h = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }
  function daySegment(minutes) {
    const m = minutes % 1440;
    if (m >= 300 && m < 420) return 'dawn';
    if (m >= 420 && m < 1080) return 'day';
    if (m >= 1080 && m < 1200) return 'dusk';
    return 'night';
  }
  function npcSegment(minutes) {
    const m = minutes % 1440;
    if (m >= 420 && m < 1080) return 'work';
    if (m >= 1080 && m < 1260) return 'square';
    return 'home';
  }

  // ---------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------
  function tryMove(dx, dy) {
    if (rt.paused || anyPanelOpen()) return;
    const nx = state.player.gx + dx, ny = state.player.gy + dy;
    rt.facing = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
    if (isBlockedTile(nx, ny)) { return; }
    rt.playerFromX = state.player.gx; rt.playerFromY = state.player.gy;
    state.player.gx = nx; state.player.gy = ny;
    rt.playerToX = nx; rt.playerToY = ny;
    rt.moveT = 0; rt.moveDur = rt.reducedMotion ? 40 : 150;
    sfx.step();
  }

  // ---------------------------------------------------------------------
  // Gathering / interaction detection
  // ---------------------------------------------------------------------
  const NODE_RESOURCE = { grove: 'grain', quarry: 'shale', reed: 'loom' };
  function trialAt(gx, gy) {
    return TRIAL_DEFS.find((trial) => trial.tile.x === gx && trial.tile.y === gy) || null;
  }
  function findInteraction() {
    const p = state.player;
    if (rt.cooking) return { kind: 'cooking' };
    // adventure landmark adjacent?
    for (const n of neighbors4(p.gx, p.gy)) {
      if (!inBounds(n.x, n.y)) continue;
      const t = terrain[n.y][n.x];
      if (t === 'shrine') return { kind: 'trial', trial: trialAt(n.x, n.y) };
      if (t === 'gate') return { kind: 'gate' };
    }
    // resource node adjacent?
    for (const n of neighbors4(p.gx, p.gy)) {
      if (!inBounds(n.x, n.y)) continue;
      const t = terrain[n.y][n.x];
      if (t === 'water') return { kind: 'fish' };
      if (NODE_RESOURCE[t]) return { kind: 'gather', resource: NODE_RESOURCE[t] };
    }
    // hearth adjacent (or standing near own)
    for (const n of [{ x: p.gx, y: p.gy }, ...neighbors4(p.gx, p.gy)]) {
      const piece = townPieceAt(n.x, n.y, currentTown());
      if (piece && piece.type === 'hearth') return { kind: 'cook' };
      if (piece && piece.type === 'bed' && daySegment(state.minutes) === 'night') return { kind: 'sleep' };
    }
    // npc adjacent
    for (const npc of npcs) {
      if (Math.max(Math.abs(npc.gx - p.gx), Math.abs(npc.gy - p.gy)) <= 1 && !(npc.gx === p.gx && npc.gy === p.gy)) {
        return { kind: 'talk', npc };
      }
    }
    return null;
  }
  const CONTEXT_LABEL = { gather: 'Gather', fish: 'Fish', cook: 'Cook', sleep: 'Sleep', talk: 'Talk', trial: 'Trial', gate: 'Gate' };
  function doContextAction() {
    if (rt.build.placing) return; // handled via canvas tap while placing
    const it = findInteraction();
    if (!it) return;
    if (it.kind === 'gather') doGather(it.resource);
    else if (it.kind === 'fish') openFishing();
    else if (it.kind === 'cook') openCookPrompt();
    else if (it.kind === 'sleep') doSleep();
    else if (it.kind === 'talk') openNpcDialogue(it.npc);
    else if (it.kind === 'trial') openTrial(it.trial);
    else if (it.kind === 'gate') openGate();
  }
  function doGather(resource) {
    if (rt.gathering) return;
    rt.gathering = { t: 0, dur: rt.reducedMotion ? 250 : 650, resource };
  }
  function finishGather() {
    const resource = rt.gathering.resource;
    state.inventory[resource] = (state.inventory[resource] || 0) + 1;
    state.stats.gathered += 1;
    sfx.gather();
    spawnParticles(rt.playerToX, rt.playerToY, resource === 'grain' ? '#ffd54f' : resource === 'shale' ? '#9bb3d6' : '#c792ea');
    rt.gathering = null;
    updateHud();
    schedulePush();
  }
  function doSleep() {
    state.spark = 100;
    state.day += 1;
    state.minutes = 380;
    toast('Slept well — a new day begins.');
    updateHud();
    schedulePush();
  }

  // ---------------------------------------------------------------------
  // Build placement / demolish
  // ---------------------------------------------------------------------
  let pieceIdCounter = 1;
  function placeAt(gx, gy) {
    const type = rt.build.selected;
    if (!type) return;
    if (mp.active && !mp.amIHost && mp.openBuilding === 'host_only') { toast('Building is host-only right now.'); return; }
    if (!isBuildableGround(gx, gy)) { toast('That tile can’t be built on.'); return; }
    const def = PALETTE_BY_TYPE[type];
    if (!canAfford(def.cost)) { toast('Not enough resources.'); return; }
    for (const [k, v] of Object.entries(def.cost)) state.inventory[k] -= v;
    const piece = { id: `p${Date.now().toString(36)}${pieceIdCounter++}`, type, gx, gy, rot: rt.build.rotation };
    state.town.push(piece);
    state.stats.built += 1;
    sfx.place();
    spawnParticles(gx, gy, def.color);
    updateHud();
    schedulePush();
    scheduleTownSync();
  }
  function demolishAt(gx, gy) {
    const idx = state.town.findIndex((p) => p.gx === gx && p.gy === gy);
    if (idx === -1) {
      if (mp.active && townPieceAt(gx, gy, mp.sharedTown)) toast('That belongs to the room host’s shared town — visitors can’t remove it.');
      else toast('Nothing to remove there.');
      return;
    }
    const piece = state.town[idx];
    const def = PALETTE_BY_TYPE[piece.type];
    state.town.splice(idx, 1);
    for (const [k, v] of Object.entries(def.cost)) state.inventory[k] = (state.inventory[k] || 0) + Math.floor(v / 2);
    state.stats.demolished += 1;
    sfx.demolish();
    updateHud();
    schedulePush();
    scheduleTownSync();
  }

  // ---------------------------------------------------------------------
  // Multiplayer sync (host-authoritative match-state)
  // ---------------------------------------------------------------------
  let townSyncTimer = null;
  function scheduleTownSync() {
    if (!mp.active) return;
    if (townSyncTimer) return;
    townSyncTimer = setTimeout(() => { townSyncTimer = null; sendTownSync(); }, 350);
  }
  function sendTownSync() {
    if (!mp.active) return;
    const compactTown = state.town.map((p) => ({ id: p.id, type: p.type, gx: p.gx, gy: p.gy, rot: p.rot }));
    host('match-action', { action: { town: compactTown, seed: state.seed, openBuilding: mp.openBuilding, hostProbe: mp.pendingNonce || mp.confirmedNonce || null }, mode: 'merge' });
    mp.lastSyncAt = Date.now();
  }
  function sendHostProbe() {
    if (mp.probeSent) return;
    mp.probeSent = true;
    mp.pendingNonce = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    mp.hostCheckAt = Date.now();
    host('match-action', { action: { hostProbe: mp.pendingNonce }, mode: 'merge' });
  }
  function adoptSharedSeed(seed) {
    state.seed = seed >>> 0;
    terrain = genTerrain(state.seed);
    npcs = buildNpcRuntime();
    state.player.gx = clamp(state.player.gx, 0, GRID - 1);
    state.player.gy = clamp(state.player.gy, 0, GRID - 1);
    if (isBlockedTile(state.player.gx, state.player.gy)) { state.player.gx = 8; state.player.gy = 8; }
    rt.playerToX = state.player.gx; rt.playerToY = state.player.gy; rt.moveT = 1;
  }
  function onMatchState(d) {
    const wasActive = mp.active;
    mp.active = true;
    mp.participants = Array.isArray(d.participants) ? d.participants : mp.participants;
    const ms = d.matchState && typeof d.matchState === 'object' ? d.matchState : {};
    if (typeof ms.seed === 'number' && ms.seed !== state.seed && !mp.amIHost) adoptSharedSeed(ms.seed);
    if (Array.isArray(ms.town)) mp.sharedTown = ms.town.filter((p) => p && PALETTE_BY_TYPE[p.type]);
    if (ms.openBuilding === 'host_only' || ms.openBuilding === 'everyone') mp.openBuilding = ms.openBuilding;
    if (mp.pendingNonce && ms.hostProbe === mp.pendingNonce) {
      mp.amIHost = true; mp.hostStatus = 'host'; mp.confirmedNonce = mp.pendingNonce; mp.pendingNonce = null;
      sendTownSync();
    } else if (!mp.amIHost && mp.hostCheckAt && Date.now() - mp.hostCheckAt > 4200) {
      mp.hostStatus = 'guest';
    }
    if (!wasActive) sendHostProbe();
    renderTogetherPanel();
  }
  function setOpenBuilding(mode) {
    mp.openBuilding = mode;
    scheduleTownSync();
    renderTogetherPanel();
  }

  // ---------------------------------------------------------------------
  // HUD updates
  // ---------------------------------------------------------------------
  function updateHud() {
    el.clock.textContent = `Day ${state.day} · ${formatClock(state.minutes)}`;
    const seg = daySegment(state.minutes);
    el.clockNote.textContent = seg[0].toUpperCase() + seg.slice(1);
    el.spark.style.width = `${clamp(state.spark, 0, 100)}%`;
    el.resGrain.textContent = state.inventory.grain || 0;
    el.resShale.textContent = state.inventory.shale || 0;
    el.resLoom.textContent = state.inventory.loom || 0;
    el.resFish.textContent = state.inventory.driftfish || 0;
    el.togetherBtn.hidden = !mp.active;
    const it = rt.build.placing ? null : findInteraction();
    if (it && CONTEXT_LABEL[it.kind]) {
      el.context.textContent = CONTEXT_LABEL[it.kind];
      el.context.classList.add('is-visible');
    } else {
      el.context.classList.remove('is-visible');
    }
  }

  // ---------------------------------------------------------------------
  // Particles
  // ---------------------------------------------------------------------
  function spawnParticles(gx, gy, color) {
    if (rt.reducedMotion) return;
    const s = tileToScreen(gx, gy);
    for (let i = 0; i < 10; i++) {
      rt.particles.push({ x: s.x, y: s.y - rt.tileH, vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 90 - 20, life: 0.5 + Math.random() * 0.3, color });
    }
  }
  function stepParticles(dt) {
    for (const p of rt.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 140 * dt; p.life -= dt; }
    rt.particles = rt.particles.filter((p) => p.life > 0);
  }

  // ---------------------------------------------------------------------
  // Sky colors
  // ---------------------------------------------------------------------
  function lerpColor(a, b, t) {
    const pa = hexToRgb(a), pb = hexToRgb(b);
    const r = Math.round(pa.r + (pb.r - pa.r) * t), g = Math.round(pa.g + (pb.g - pa.g) * t), bch = Math.round(pa.b + (pb.b - pa.b) * t);
    return `rgb(${r},${g},${bch})`;
  }
  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const SKY_STOPS = [
    { m: 0, top: '#120a20', hor: '#241c3a' },
    { m: 300, top: '#120a20', hor: '#241c3a' },
    { m: 420, top: '#4a3560', hor: '#ff9466' },
    { m: 600, top: '#7d93d1', hor: '#ffe3b0' },
    { m: 1080, top: '#7d93d1', hor: '#ffe3b0' },
    { m: 1200, top: '#5a3a6b', hor: '#ff7f66' },
    { m: 1320, top: '#221336', hor: '#3a2550' },
    { m: 1440, top: '#120a20', hor: '#241c3a' },
  ];
  function skyColors(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440;
    for (let i = 0; i < SKY_STOPS.length - 1; i++) {
      const a = SKY_STOPS[i], b = SKY_STOPS[i + 1];
      if (m >= a.m && m <= b.m) {
        const t = (m - a.m) / (b.m - a.m || 1);
        return { top: lerpColor(a.top, b.top, t), hor: lerpColor(a.hor, b.hor, t) };
      }
    }
    return { top: SKY_STOPS[0].top, hor: SKY_STOPS[0].hor };
  }

  // ---------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------
  function drawDiamond(cx, cy, w, h, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy);
    ctx.lineTo(cx, cy + h / 2);
    ctx.lineTo(cx - w / 2, cy);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1 * rt.dpr; ctx.stroke(); }
  }
  function drawBlock(cx, topY, w, h, height, topColor, sideColorL, sideColorR) {
    // topY is the screen y of the tile's top-face center; height extrudes upward
    const hw = w / 2, hh = h / 2;
    ctx.beginPath();
    ctx.moveTo(cx, topY - hh - height); ctx.lineTo(cx - hw, topY - height); ctx.lineTo(cx, topY + hh - height); ctx.lineTo(cx + hw, topY - height); ctx.closePath();
    ctx.fillStyle = topColor; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - hw, topY - height); ctx.lineTo(cx, topY + hh - height); ctx.lineTo(cx, topY + hh); ctx.lineTo(cx - hw, topY); ctx.closePath();
    ctx.fillStyle = sideColorL; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + hw, topY - height); ctx.lineTo(cx, topY + hh - height); ctx.lineTo(cx, topY + hh); ctx.lineTo(cx + hw, topY); ctx.closePath();
    ctx.fillStyle = sideColorR; ctx.fill();
  }
  function shade(hex, amt) {
    const c = hexToRgb(hex);
    const f = (v) => clamp(Math.round(v * amt), 0, 255);
    return `rgb(${f(c.r)},${f(c.g)},${f(c.b)})`;
  }
  const TERRAIN_COLOR = { grass: '#3a6b4a', trail: '#9f7f58', grove: '#2f7a4d', quarry: '#7b7f8c', reed: '#7fae59', water: '#3f8ec9', shrine: '#5b4aa8', gate: '#2f2448' };
  function drawTerrainTile(gx, gy, t) {
    const s = tileToScreen(gx, gy);
    const top = TERRAIN_COLOR[t] || TERRAIN_COLOR.grass;
    drawDiamond(s.x, s.y, rt.tileW, rt.tileH, top, 'rgba(0,0,0,0.18)');
    if (t === 'grove' || t === 'quarry' || t === 'reed') {
      drawBlock(s.x, s.y, rt.tileW * 0.36, rt.tileH * 0.36, rt.tileH * (t === 'grove' ? 1.6 : 0.7), shade(top, 1.25), shade(top, 0.75), shade(top, 0.55));
    }
    if (t === 'water') {
      ctx.save(); ctx.globalAlpha = 0.35 + 0.1 * Math.sin(performance.now() / 500 + gx + gy);
      drawDiamond(s.x, s.y, rt.tileW * 0.7, rt.tileH * 0.7, '#bfe9ff', null);
      ctx.restore();
    }
    if (t === 'shrine') {
      const trial = trialAt(gx, gy);
      const done = trial && state.adventure?.trials?.[trial.id]?.done;
      drawBlock(s.x, s.y, rt.tileW * 0.58, rt.tileH * 0.58, rt.tileH * 1.55, done ? '#5be3b5' : '#c792ea', '#34255b', '#211638');
      ctx.save();
      ctx.globalAlpha = done ? 0.35 : 0.55 + 0.15 * Math.sin(performance.now() / 360 + gx);
      ctx.fillStyle = done ? '#5be3b5' : '#ffcf6b';
      ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 1.95, rt.tileH * 0.28, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (t === 'gate') {
      const open = state.adventure?.gateOpen;
      drawBlock(s.x, s.y, rt.tileW * 0.88, rt.tileH * 0.88, rt.tileH * 2.0, open ? '#5be3b5' : '#3d345f', '#221936', '#130d22');
      ctx.save();
      ctx.strokeStyle = open ? '#fbe9d8' : '#ffcf6b';
      ctx.lineWidth = 2 * rt.dpr;
      ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 2.25, rt.tileH * 0.52, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  function drawPiece(piece, unsynced) {
    const def = PALETTE_BY_TYPE[piece.type];
    if (!def) return;
    const s = tileToScreen(piece.gx, piece.gy);
    const hgt = def.blocking ? rt.tileH * (piece.type === 'wall' || piece.type === 'hearth' || piece.type === 'bed' || piece.type === 'chest' ? 1.5 : 1.0) : rt.tileH * 0.18;
    const color = def.color;
    if (def.blocking) {
      drawBlock(s.x, s.y, rt.tileW * 0.82, rt.tileH * 0.82, hgt, shade(color, 1.15), shade(color, 0.72), shade(color, 0.52));
    } else {
      drawDiamond(s.x, s.y - hgt, rt.tileW * 0.86, rt.tileH * 0.86, color, 'rgba(0,0,0,0.2)');
    }
    if (piece.type === 'lamp' && daySegment(state.minutes) !== 'day') {
      ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#ffe6a3';
      ctx.beginPath(); ctx.arc(s.x, s.y - hgt - rt.tileH * 0.4, rt.tileH * 1.1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (unsynced) {
      // Marks a guest's own local-only placement that hasn't (and, under the
      // current room protocol, structurally can't) sync out to the shared town.
      ctx.save(); ctx.fillStyle = '#ffcf6b'; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(s.x, s.y - hgt - rt.tileH * 1.3, 3 * rt.dpr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  function drawCharacter(px, py, hueColor, topper, trimColor, label, mini) {
    const scale = mini ? 0.72 : 1;
    const bw = rt.tileW * 0.42 * scale, bh = rt.tileH * 1.3 * scale;
    ctx.save();
    ctx.globalAlpha = 0.28;
    drawDiamond(px, py + 3 * rt.dpr, rt.tileW * 0.5 * scale, rt.tileH * 0.4 * scale, '#000000', null);
    ctx.globalAlpha = 1;
    // body
    const bx = px, by = py - bh * 0.5;
    ctx.fillStyle = hueColor;
    roundRect(bx - bw / 2, by - bh / 2, bw, bh, 6 * rt.dpr);
    ctx.fill();
    ctx.strokeStyle = trimColor; ctx.lineWidth = 2 * rt.dpr; ctx.stroke();
    // head
    const headSize = bw * 1.05;
    ctx.fillStyle = hueColor;
    roundRect(bx - headSize / 2, by - bh / 2 - headSize * 0.9, headSize, headSize * 0.9, 5 * rt.dpr);
    ctx.fill();
    ctx.strokeStyle = trimColor; ctx.lineWidth = 1.5 * rt.dpr; ctx.stroke();
    // topper
    const headTopY = by - bh / 2 - headSize * 0.9;
    if (topper === 'cap') {
      ctx.fillStyle = shade(hueColor, 0.6);
      ctx.beginPath(); ctx.moveTo(bx - headSize / 2, headTopY + 4 * rt.dpr); ctx.lineTo(bx + headSize / 2, headTopY + 4 * rt.dpr); ctx.lineTo(bx, headTopY - headSize * 0.4); ctx.closePath(); ctx.fill();
    } else if (topper === 'bloom') {
      ctx.fillStyle = '#ff7fb0';
      ctx.beginPath(); ctx.arc(bx, headTopY, headSize * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath(); ctx.arc(bx, headTopY, headSize * 0.08, 0, Math.PI * 2); ctx.fill();
    } else if (topper === 'halo') {
      ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 2.5 * rt.dpr;
      ctx.beginPath(); ctx.ellipse(bx, headTopY - headSize * 0.15, headSize * 0.4, headSize * 0.14, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (topper === 'crest') {
      ctx.fillStyle = '#ffcf6b';
      ctx.beginPath(); ctx.moveTo(bx - headSize * 0.38, headTopY + headSize * 0.08); ctx.lineTo(bx - headSize * 0.12, headTopY - headSize * 0.38); ctx.lineTo(bx + headSize * 0.12, headTopY + headSize * 0.08); ctx.lineTo(bx + headSize * 0.38, headTopY - headSize * 0.3); ctx.lineTo(bx + headSize * 0.3, headTopY + headSize * 0.18); ctx.lineTo(bx - headSize * 0.38, headTopY + headSize * 0.18); ctx.closePath(); ctx.fill();
    } else if (topper === 'leaf') {
      ctx.fillStyle = '#78d36f';
      ctx.beginPath(); ctx.ellipse(bx, headTopY - headSize * 0.12, headSize * 0.34, headSize * 0.16, -0.55, 0, Math.PI * 2); ctx.fill();
    } else if (topper === 'crown') {
      ctx.fillStyle = '#ffd54f';
      ctx.beginPath(); ctx.moveTo(bx - headSize * 0.46, headTopY + headSize * 0.16); ctx.lineTo(bx - headSize * 0.28, headTopY - headSize * 0.28); ctx.lineTo(bx, headTopY + headSize * 0.04); ctx.lineTo(bx + headSize * 0.28, headTopY - headSize * 0.28); ctx.lineTo(bx + headSize * 0.46, headTopY + headSize * 0.16); ctx.closePath(); ctx.fill();
    }
    if (label) {
      ctx.fillStyle = '#fbe9d8'; ctx.font = `700 ${11 * rt.dpr}px ui-monospace,monospace`; ctx.textAlign = 'center';
      ctx.fillText(label, bx, headTopY - headSize * 0.55);
    }
    ctx.restore();
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    const sky = skyColors(state.minutes);
    const grad = ctx.createLinearGradient(0, 0, 0, rt.H);
    grad.addColorStop(0, sky.top); grad.addColorStop(1, sky.hor);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, rt.W, rt.H);

    // draw order: terrain back-to-front, then pieces+npcs+player interleaved by depth
    const drawables = [];
    for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
      drawables.push({ depth: gx + gy, kind: 'terrain', gx, gy });
    }
    const town = currentTown();
    for (const p of town) {
      // A guest's own placements (state.town) never sync out to the shared
      // room town under the current host-authoritative match-state protocol
      // (see scheduleTownSync/onMatchState) — tag them so that's visible.
      const guestLocal = mp.active && !mp.amIHost && state.town.includes(p);
      drawables.push({ depth: p.gx + p.gy + 0.4, kind: 'piece', piece: p, guestLocal });
    }
    for (const npc of npcs) drawables.push({ depth: npc.gx + npc.gy + 0.5, kind: 'npc', npc });
    drawables.push({ depth: rt.playerToX + rt.playerToY + 0.6, kind: 'player' });

    drawables.sort((a, b) => a.depth - b.depth);
    // terrain must be drawn strictly first regardless of interleave for correctness of base layer
    for (const d of drawables) if (d.kind === 'terrain') drawTerrainTile(d.gx, d.gy, terrain[d.gy][d.gx]);
    for (const d of drawables) {
      if (d.kind === 'piece') drawPiece(d.piece, d.guestLocal);
      else if (d.kind === 'npc') {
        const n = d.npc;
        drawCharacter(n.screenPx, n.screenPy, n.hue, 'none', 'rgba(255,255,255,0.35)', n.name.split(' ')[0]);
      } else if (d.kind === 'player') {
        drawCharacter(rt.playerPx, rt.playerPy, hueColorOf(state.player.hue), state.player.topper, trimColorOf(state.player.trim), null);
      }
    }

    // build placement ghost
    if (rt.build.placing && rt.build.hoverTile) {
      const ok = isBuildableGround(rt.build.hoverTile.x, rt.build.hoverTile.y);
      const s = tileToScreen(rt.build.hoverTile.x, rt.build.hoverTile.y);
      ctx.save(); ctx.globalAlpha = 0.55;
      drawDiamond(s.x, s.y, rt.tileW, rt.tileH, ok ? '#5be3b5' : '#ff6b81', null);
      ctx.restore();
    }

    // gather/cook progress ring
    if (rt.gathering) drawProgressRing(rt.playerToX, rt.playerToY, rt.gathering.t / rt.gathering.dur, '#ffd54f');
    if (rt.cooking) drawProgressRing(rt.playerToX, rt.playerToY, rt.cooking.t / rt.cooking.dur, '#ff8a5c');

    // particles
    for (const p of rt.particles) {
      ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2 * rt.dpr, p.y - 2 * rt.dpr, 4 * rt.dpr, 4 * rt.dpr);
      ctx.restore();
    }

    // low-spark vignette
    if (state.spark < 25) {
      const vg = ctx.createRadialGradient(rt.W / 2, rt.H / 2, rt.H * 0.25, rt.W / 2, rt.H / 2, rt.H * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(20,8,30,${(25 - state.spark) / 60})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, rt.W, rt.H);
    }

    if (rt.paused) {
      ctx.fillStyle = 'rgba(10,6,20,0.45)'; ctx.fillRect(0, 0, rt.W, rt.H);
    }
  }
  function drawProgressRing(gx, gy, t, color) {
    const s = tileToScreen(gx, gy);
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 4 * rt.dpr; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 1.6, rt.tileH * 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(t, 0, 1));
    ctx.stroke();
    ctx.restore();
  }
  function hueColorOf(key) { return (HUES.find((h) => h.key === key) || HUES[0]).color; }
  function trimColorOf(key) { return (TRIMS.find((t) => t.key === key) || TRIMS[0]).color; }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  function loop(t) {
    requestAnimationFrame(loop);
    if (!rt.lastFrame) rt.lastFrame = t;
    let dt = (t - rt.lastFrame) / 1000;
    rt.lastFrame = t;
    dt = Math.min(dt, 0.05);
    if (!rt.paused && !anyPanelOpenBlocking()) {
      state.minutes += (dt * 1000) * (1440 / DAY_LENGTH_MS);
      if (state.minutes >= 1440) { state.minutes -= 1440; state.day += 1; }
      state.stats.secondsPlayed += dt;
      stepMoveInterp(dt);
      stepNpcs(dt);
      stepGatherCook(dt);
      stepSpark(t);
    }
    stepParticles(dt);
    draw();
    maybeAutoPush(t);
  }
  function anyPanelOpenBlocking() {
    // fishing/dialogue/build panels shouldn't freeze the whole town; only pause overlay truly blocks.
    return false;
  }
  function stepMoveInterp(dt) {
    if (rt.moveT < 1) {
      rt.moveT = Math.min(1, rt.moveT + dt * 1000 / rt.moveDur);
    }
    const fx = tileToScreen(rt.playerFromX, rt.playerFromY);
    const tx = tileToScreen(rt.playerToX, rt.playerToY);
    const e = rt.moveT;
    rt.playerPx = fx.x + (tx.x - fx.x) * e;
    rt.playerPy = fx.y + (tx.y - fx.y) * e;
  }
  function stepNpcs(dt) {
    const seg = npcSegment(state.minutes);
    for (const n of npcs) {
      if (n.segment !== seg) {
        n.segment = seg;
        const target = seg === 'work' ? n.workplace : seg === 'square' ? n.square : n.home;
        n.moveFrom = { x: n.gx, y: n.gy };
        n.targetGx = target.x; n.targetGy = target.y;
        n.moveT = 0; n.moveDur = rt.reducedMotion ? 300 : 3200;
      }
      if (n.moveT < 1) {
        n.moveT = Math.min(1, n.moveT + dt * 1000 / n.moveDur);
        if (n.moveT >= 1) { n.gx = n.targetGx; n.gy = n.targetGy; }
      }
      const fx = tileToScreen(n.moveFrom.x, n.moveFrom.y);
      const tx = tileToScreen(n.targetGx, n.targetGy);
      n.screenPx = fx.x + (tx.x - fx.x) * n.moveT;
      n.screenPy = fx.y + (tx.y - fx.y) * n.moveT;
    }
  }
  function stepGatherCook(dt) {
    if (rt.gathering) {
      rt.gathering.t += dt * 1000;
      if (rt.gathering.t >= rt.gathering.dur) finishGather();
    }
    if (rt.cooking) {
      rt.cooking.t += dt * 1000;
      if (rt.cooking.t >= rt.cooking.dur) finishCooking();
    }
  }
  function stepSpark(t) {
    if (!rt.lastSparkTick) rt.lastSparkTick = t;
    if (t - rt.lastSparkTick >= SPARK_DECAY_EVERY_MS) {
      rt.lastSparkTick = t;
      state.spark = clamp(state.spark - SPARK_DECAY_AMOUNT, 0, 100);
      updateHud();
    }
  }

  // ---------------------------------------------------------------------
  // Progress / score push to host
  // ---------------------------------------------------------------------
  function captureState() {
    return JSON.parse(JSON.stringify({
      version: state.version, seed: state.seed, day: state.day, minutes: state.minutes,
      player: state.player, inventory: state.inventory, spark: state.spark, town: state.town,
      quests: state.quests, adventure: state.adventure, cosmeticsUnlocked: state.cosmeticsUnlocked, tutorialSeen: state.tutorialSeen,
      stats: state.stats, completedMilestone: state.completedMilestone,
    }));
  }
  function schedulePush() {
    const now = Date.now();
    if (now - rt.lastPushAt > 2200) { pushProgress(); }
  }
  function maybeAutoPush(t) {
    if (t - rt.lastAutoPush > 12000) { rt.lastAutoPush = t; pushProgress(); }
  }
  function pushProgress() {
    rt.lastPushAt = Date.now();
    host('progress', { progress: computeProgress(), score: computeScore(), state: captureState() });
  }

  function applyState(s) {
    if (!s || typeof s !== 'object') return;
    if (!state) newGame((Math.random() * 1e9) >>> 0);
    if (typeof s.seed === 'number') { state.seed = s.seed >>> 0; terrain = genTerrain(state.seed); }
    state.day = Number.isFinite(s.day) ? Math.max(1, Math.floor(s.day)) : state.day;
    state.minutes = Number.isFinite(s.minutes) ? clamp(s.minutes, 0, 1439) : state.minutes;
    if (s.player && typeof s.player === 'object') {
      state.player.gx = Number.isFinite(s.player.gx) ? clamp(Math.floor(s.player.gx), 0, GRID - 1) : state.player.gx;
      state.player.gy = Number.isFinite(s.player.gy) ? clamp(Math.floor(s.player.gy), 0, GRID - 1) : state.player.gy;
      for (const k of ['hue', 'topper', 'trim', 'name']) if (typeof s.player[k] === 'string') state.player[k] = s.player[k];
    }
    if (s.inventory && typeof s.inventory === 'object') {
      for (const k of Object.keys(state.inventory)) if (Number.isFinite(s.inventory[k])) state.inventory[k] = Math.max(0, Math.floor(s.inventory[k]));
    }
    state.spark = Number.isFinite(s.spark) ? clamp(s.spark, 0, 100) : state.spark;
    if (Array.isArray(s.town)) {
      state.town = s.town.filter((p) => p && typeof p === 'object' && PALETTE_BY_TYPE[p.type] && Number.isFinite(p.gx) && Number.isFinite(p.gy))
        .map((p) => ({ id: String(p.id || `p${pieceIdCounter++}`), type: p.type, gx: clamp(Math.floor(p.gx), 0, GRID - 1), gy: clamp(Math.floor(p.gy), 0, GRID - 1), rot: Number.isFinite(p.rot) ? p.rot % 4 : 0 }));
    }
    if (s.quests && typeof s.quests === 'object') {
      for (const k of Object.keys(state.quests)) if (s.quests[k] && typeof s.quests[k] === 'object') state.quests[k].done = !!s.quests[k].done;
    }
    const defaultAdventure = defaultAdventureState();
    state.adventure = state.adventure || defaultAdventure;
    if (s.adventure && typeof s.adventure === 'object') {
      state.adventure.gateOpen = !!s.adventure.gateOpen;
      if (s.adventure.trials && typeof s.adventure.trials === 'object') {
        for (const trial of TRIAL_DEFS) {
          if (!state.adventure.trials[trial.id]) state.adventure.trials[trial.id] = { done: false };
          state.adventure.trials[trial.id].done = !!s.adventure.trials[trial.id]?.done;
        }
      }
    }
    if (s.cosmeticsUnlocked && typeof s.cosmeticsUnlocked === 'object') {
      for (const cat of ['hue', 'topper', 'trim']) if (Array.isArray(s.cosmeticsUnlocked[cat])) state.cosmeticsUnlocked[cat] = Array.from(new Set([...state.cosmeticsUnlocked[cat], ...s.cosmeticsUnlocked[cat].filter((x) => typeof x === 'string')]));
    }
    state.tutorialSeen = !!s.tutorialSeen;
    if (state.tutorialSeen) {
      // A restore/load-state arriving after the first-launch tutorial auto-
      // opened (it opens 200ms after boot if a brand-new save looks unseen)
      // should close it rather than leave a returning player staring at it.
      const tp = document.querySelector('[data-ct-panel="tutorial"]');
      if (tp) tp.classList.remove('is-open');
    }
    if (s.stats && typeof s.stats === 'object') {
      for (const k of Object.keys(state.stats)) if (Number.isFinite(s.stats[k])) state.stats[k] = s.stats[k];
    }
    state.completedMilestone = !!(s.completedMilestone && state.adventure.gateOpen);
    npcs = buildNpcRuntime();
    for (const npc of npcs) npc.quest.done = state.quests[npc.id] ? state.quests[npc.id].done : false;
    rt.playerToX = state.player.gx; rt.playerToY = state.player.gy;
    rt.playerFromX = rt.playerToX; rt.playerFromY = rt.playerToY; rt.moveT = 1;
    updateHud();
  }

  // ---------------------------------------------------------------------
  // Canvas pointer input (move-to-tap / gather-tap / build-tap)
  // ---------------------------------------------------------------------
  function screenToTile(px, py) {
    // invert iso projection
    const relX = px - rt.originX, relY = py - rt.originY;
    const gx = (relX / (rt.tileW / 2) + relY / (rt.tileH / 2)) / 2;
    const gy = (relY / (rt.tileH / 2) - relX / (rt.tileW / 2)) / 2;
    return { x: Math.round(gx), y: Math.round(gy) };
  }
  function canvasPointFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    const cx = (evt.clientX - rect.left) / rect.width * rt.W;
    const cy = (evt.clientY - rect.top) / rect.height * rt.H;
    return { x: cx, y: cy };
  }
  canvas.addEventListener('pointerdown', (evt) => {
    unlockAudio();
    if (anyPanelOpen() && !rt.build.placing) return;
    const pt = canvasPointFromEvent(evt);
    const tile = screenToTile(pt.x, pt.y);
    if (!inBounds(tile.x, tile.y)) return;
    if (rt.build.placing) {
      placeAt(tile.x, tile.y);
      rt.build.placing = false;
      updateHud();
      return;
    }
    if (rt.build.tool === 'demolish' && rt.build.demolishArmed) {
      demolishAt(tile.x, tile.y);
      return;
    }
    // tap-to-step toward tile (single-step, adjacency only, keeps controls simple/predictable)
    const dx = tile.x - state.player.gx, dy = tile.y - state.player.gy;
    if (Math.abs(dx) + Math.abs(dy) === 1) tryMove(dx, dy);
    else if (dx === 0 && dy === 0) doContextAction();
  });
  canvas.addEventListener('pointermove', (evt) => {
    if (!rt.build.placing) return;
    const pt = canvasPointFromEvent(evt);
    rt.build.hoverTile = screenToTile(pt.x, pt.y);
  });

  // ---------------------------------------------------------------------
  // Keyboard input
  // ---------------------------------------------------------------------
  addEventListener('keydown', (evt) => {
    unlockAudio();
    if (evt.repeat) return;
    if (evt.key === 'Escape') {
      if (rt.build.placing) { rt.build.placing = false; toast('Placement canceled.'); updateHud(); return; }
      if (anyPanelOpen()) { closePanels(); return; }
    }
    if (anyPanelOpen()) {
      if (evt.key === ' ' && document.querySelector('[data-ct-panel="fishing"]').classList.contains('is-open')) { evt.preventDefault(); fishCatch(); }
      return;
    }
    if (rt.paused) return;
    const k = evt.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') tryMove(0, -1);
    else if (k === 's' || k === 'arrowdown') tryMove(0, 1);
    else if (k === 'a' || k === 'arrowleft') tryMove(-1, 0);
    else if (k === 'd' || k === 'arrowright') tryMove(1, 0);
    else if (k === ' ' || k === 'e') { evt.preventDefault(); doContextAction(); }
    else if (k === 'b') openPanel('build');
  });

  // ---------------------------------------------------------------------
  // DOM bindings
  // ---------------------------------------------------------------------
  $all('[data-ct-open]').forEach((b) => b.onclick = () => { unlockAudio(); openPanel(b.dataset.ctOpen); });
  $all('[data-ct-close]').forEach((b) => b.onclick = () => closePanels());
  $('[data-ct-context]').onclick = () => { unlockAudio(); doContextAction(); };
  $all('[data-ct-move]').forEach((b) => b.onclick = () => {
    unlockAudio();
    const dir = b.dataset.ctMove;
    if (dir === 'up') tryMove(0, -1);
    else if (dir === 'down') tryMove(0, 1);
    else if (dir === 'left') tryMove(-1, 0);
    else if (dir === 'right') tryMove(1, 0);
    else if (dir === 'act') doContextAction();
  });
  $all('[data-ct-buildmode]').forEach((b) => b.onclick = () => {
    rt.build.tool = b.dataset.ctBuildmode;
    rt.build.demolishArmed = rt.build.tool === 'demolish';
    $all('[data-ct-buildmode]').forEach((x) => x.classList.toggle('is-on', x === b));
    if (rt.build.tool === 'demolish') { closePanels(); rt.build.placing = false; toast('Demolish armed — tap one of your own pieces.'); }
  });
  $('[data-ct-rotate]').onclick = () => { rt.build.rotation = (rt.build.rotation + 1) % 4; toast(`Rotation ${rt.build.rotation * 90}°`); };
  $('[data-ct-fish-catch]').onclick = () => fishCatch();
  $('[data-ct-fish-leave]').onclick = () => fishLeave();
  $all('[data-ct-ob]').forEach((b) => b.onclick = () => setOpenBuilding(b.dataset.ctOb));
  $('[data-ct-tut-next]').onclick = () => tutorialNext();
  $all('[data-ct-tut-skip]').forEach((b) => b.onclick = () => finishTutorial());
  $('[data-ct-replay-tutorial]').onclick = () => openPanel('tutorial');
  $('[data-ct-volume]').oninput = (e) => { audio.volume = Number(e.target.value) / 100; };
  $('[data-ct-mute]').onchange = (e) => { audio.mute = e.target.checked; };
  $('[data-ct-reduced]').onchange = (e) => { rt.reducedMotion = e.target.checked; };
  $('[data-ct-pause]').onclick = () => setPaused(!rt.paused);
  $('[data-ct-resume]').onclick = () => setPaused(false);

  function setPaused(p) {
    if (rt.paused === p) return;
    rt.paused = p;
    document.querySelector('[data-ct-panel="pause"]').classList.toggle('is-open', p);
    $('[data-ct-pause]').textContent = p ? 'Resume' : 'Pause';
    host('paused', { paused: p });
  }

  // ---------------------------------------------------------------------
  // Host <-> game protocol
  // ---------------------------------------------------------------------
  addEventListener('message', (evt) => {
    const d = evt.data;
    if (!d || d.source !== 'phantomplay-host') return;
    if (d.type === 'settings') {
      rt.hostSound = d.sound !== false;
      if (typeof d.reducedMotion === 'boolean') { rt.reducedMotion = rt.reducedMotion || d.reducedMotion; el.reduced.checked = rt.reducedMotion; }
    } else if (d.type === 'pause') {
      setPaused(true);
    } else if (d.type === 'resume') {
      setPaused(false);
    } else if (d.type === 'exit') {
      pushProgress();
    } else if (d.type === 'restart') {
      newGame((Math.random() * 1e9) >>> 0);
      closePanels();
      rt.playerToX = state.player.gx; rt.playerToY = state.player.gy; rt.playerFromX = rt.playerToX; rt.playerFromY = rt.playerToY; rt.moveT = 1;
      updateHud();
      if (!state.tutorialSeen) openPanel('tutorial');
    } else if (d.type === 'save-state') {
      pushProgress();
    } else if (d.type === 'load-state' || d.type === 'restore') {
      applyState(d.state);
    } else if (d.type === 'match-state') {
      onMatchState(d);
    }
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function boot() {
    size();
    try { rt.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { rt.reducedMotion = false; }
    el.reduced.checked = rt.reducedMotion;
    newGame((Math.random() * 1e9) >>> 0);
    rt.playerToX = state.player.gx; rt.playerToY = state.player.gy;
    rt.playerFromX = rt.playerToX; rt.playerFromY = rt.playerToY; rt.moveT = 1;
    updateHud();
    draw();
    requestAnimationFrame(loop);
    setInterval(() => { updateHud(); }, 1000);
    if (!state.tutorialSeen) setTimeout(() => openPanel('tutorial'), 200);
    host('ready');
  }
  boot();
})();
