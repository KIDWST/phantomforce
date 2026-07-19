'use strict';
/* CubeTown — a cozy geometric-block adventure/building game for PhantomPlay.
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
    seedList: $('[data-ct-seed-list]'),
    farmNote: $('[data-ct-farm-note]'),
    craftList: $('[data-ct-craft-list]'),
    dlgFriend: $('[data-ct-dlg-friend]'),
    dlgGiftList: $('[data-ct-dlg-gift-list]'),
    returnHome: $('[data-ct-return-home]'),
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
    { type: 'coop', label: 'Coop', cost: { grain: 3, shale: 1 }, blocking: true, protect: true, color: '#e8c27a' },
    { type: 'watchtower', label: 'Watchtower', cost: { ingot: 3, plank: 1 }, blocking: true, protect: true, color: '#9bb3d6' },
  ];
  const PALETTE_BY_TYPE = Object.fromEntries(PALETTE.map((p) => [p.type, p]));
  // Extra draw height (in tileH units) for blocking pieces that should read
  // taller than the standard furniture block; anything absent defaults to 1.0.
  const TALL_PIECES = { wall: 1.5, hearth: 1.5, bed: 1.5, chest: 1.5, watchtower: 2.4, coop: 1.1 };

  const RECIPES = [
    { key: 'cake', label: 'Grove Cake', cost: { grain: 2 }, spark: 18, ms: 1400, requiresQuest: null },
    { key: 'skewer', label: 'Ember Skewer', cost: { grain: 1, driftfish: 1 }, spark: 32, ms: 2200, requiresQuest: null },
    { key: 'chowder', label: 'Tide Chowder', cost: { driftfish: 2, loom: 1 }, spark: 45, ms: 3200, requiresQuest: 'bo' },
    { key: 'sunjam', label: 'Sunberry Jam', cost: { sunberry: 2 }, spark: 22, ms: 1600, requiresQuest: null },
    { key: 'moonloaf', label: 'Moonwheat Loaf', cost: { moonwheat: 2, grain: 1 }, spark: 34, ms: 2400, requiresQuest: null },
    { key: 'gourdstew', label: 'Glowgourd Stew', cost: { glowgourd: 1, driftfish: 1 }, spark: 50, ms: 3000, requiresQuest: 'sage' },
    { key: 'omelet', label: 'Sunrise Omelet', cost: { egg: 2 }, spark: 40, ms: 2000, requiresQuest: null },
  ];

  // Crafting: combine gathered resources into intermediate materials (Plank,
  // Ingot), spend those on Fertilizer or on permanent gathering-tool tiers.
  // Tool tiers are one-time purchases (state.tools.gatherTier) that must be
  // bought in order — this is CubeTown's stand-in for a Minecraft-style
  // crafting/tool-tier ladder without introducing a crafting grid.
  const CRAFT_RECIPES = [
    { key: 'plank', label: 'Plank Bundle', cost: { grain: 3 }, yields: { plank: 1 }, note: 'A sturdy building material milled from Grain stalks.' },
    { key: 'ingot', label: 'Shale Ingot', cost: { shale: 3 }, yields: { ingot: 1 }, note: 'Smelted stone — strong enough for a tower or a tool.' },
    { key: 'fertilizer', label: 'Rich Fertilizer', cost: { plank: 1, loom: 1 }, yields: { fertilizer: 1 }, note: 'Feeds a soil plot: faster growth and safe from wilting for a few days.' },
    { key: 'tool2', label: 'Sturdy Tool', cost: { ingot: 2, plank: 2 }, unlockTool: 2, note: 'Gather faster and pull extra resources from every node.' },
    { key: 'tool3', label: 'Masterwork Tool', cost: { ingot: 4, plank: 3, lumen: 1 }, unlockTool: 3, note: 'The finest gathering tool in CubeTown.' },
  ];
  const CRAFT_BY_KEY = Object.fromEntries(CRAFT_RECIPES.map((r) => [r.key, r]));
  function gatherTier() { return (state.tools && state.tools.gatherTier) || 1; }
  function gatherYieldN() { const t = gatherTier(); return t >= 3 ? 3 : t === 2 ? 2 : 1; }
  function gatherDurationMs() { const t = gatherTier(); const base = 650; return Math.round(base * (t >= 3 ? 0.5 : t === 2 ? 0.75 : 1)); }

  // Farming: till grass into soil plots, plant seeds, water daily, harvest.
  // Growth is measured in in-game minutes (one full day = 1440). Watering
  // speeds a crop up; fertilizer speeds it up further and shields it from
  // wilting; an unwatered, unfertilized crop left dry across two day-turns
  // wilts and is lost — a real (if forgiving) fail-state.
  const CROPS = [
    { key: 'sunberry', label: 'Sunberry', seed: 'sunberryseed', dur: 1200, color: '#ffb347', yieldN: 2, days: '~1 day', season: 'summer' },
    { key: 'moonwheat', label: 'Moonwheat', seed: 'moonwheatseed', dur: 2600, color: '#cfd8ff', yieldN: 2, days: '~2 days', season: 'autumn' },
    { key: 'glowgourd', label: 'Glowgourd', seed: 'glowgourdseed', dur: 4200, color: '#a5f26f', yieldN: 1, days: '~3 days', season: 'spring' },
    { key: 'stormcorn', label: 'Stormcorn', seed: 'stormcornseed', dur: 900, color: '#ffe27a', yieldN: 2, days: '~0.6 day', season: 'summer' },
    { key: 'frostberry', label: 'Frostberry', seed: 'frostberryseed', dur: 3800, color: '#bfe9ff', yieldN: 3, days: '~2.6 days', season: 'winter' },
  ];
  const CROP_BY_KEY = Object.fromEntries(CROPS.map((c) => [c.key, c]));
  const FARM_WATERED_RATE = 1.6;
  const FARM_DRY_RATE = 1.0;
  const FERTILIZER_RATE_BONUS = 1.35;
  const FERTILIZER_DAYS = 3;
  const WILT_THRESHOLD = 2; // consecutive unwatered, unfertilized day-turns before a crop wilts

  // Seasons: a simple 4-season rotation tied to the day counter. Shifts crop
  // growth rate (favored season grows fastest, opposite season slowest), the
  // color of grass tiles in both town and wilds terrain, and a small line of
  // resident small-talk (see SEASON_SMALLTALK / openNpcDialogue).
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const SEASON_LEN_DAYS = 6;
  const SEASON_LABEL = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
  const SEASON_GRASS = { spring: '#3f7a4a', summer: '#3a6b4a', autumn: '#7a6b3a', winter: '#7f93a0' };
  const SEASON_WGRASS = { spring: '#3f6a40', summer: '#3a5a3a', autumn: '#6d5c34', winter: '#6f8290' };
  const SEASON_SMALLTALK = {
    spring: 'Everything’s budding again — good season for tilling a new plot.',
    summer: 'This summer heat has the fields growing fast.',
    autumn: 'Harvest air always makes me a little sentimental.',
    winter: 'Cold season. Good for staying by the Hearth and telling stories.',
  };
  function seasonOf(day) { return SEASONS[Math.floor(Math.max(0, day - 1) / SEASON_LEN_DAYS) % SEASONS.length]; }
  function seasonGrowthMultiplier(cropKey, season) {
    const c = CROP_BY_KEY[cropKey];
    if (!c || !c.season) return 1;
    const idx = SEASONS.indexOf(c.season), cur = SEASONS.indexOf(season);
    if (idx < 0 || cur < 0) return 1;
    const dist = Math.min(Math.abs(idx - cur), SEASONS.length - Math.abs(idx - cur));
    return dist === 0 ? 1.25 : dist === 1 ? 1.0 : 0.7;
  }

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
    { id: 'sage', name: 'Sage the Sower', hue: '#b6e26f', resourceType: 'grove', quest: { need: { sunberry: 3, moonwheat: 2 }, unlockHue: null, unlockTopper: null, reward: { glowgourdseed: 2, moonwheatseed: 1 }, text: 'A town grows best from its own soil. Till a plot, grow 3 Sunberries and 2 Moonwheat, and I’ll trade you my rare Glowgourd seeds — and teach you my stew.' } },
  ];
  const NPC_BY_ID = Object.fromEntries(NPC_DEFS.map((n) => [n.id, n]));

  // Harvest-Moon-style friendship: each resident also has a favorite gift —
  // giving it back a bonus over a generic resource or cooked dish.
  const GIFT_LOVED = { miro: 'shale', tally: 'loom', bo: 'driftfish', runa: 'grain', ivy: 'loom', fenn: 'lumen', nova: 'lumen', ori: 'relic', sage: 'grain' };
  const FRIEND_LEVELS = [
    { at: 20, label: 'Warm', reward: { lumen: 1 } },
    { at: 50, label: 'Trusted', reward: { lumen: 2 } },
    { at: 100, label: 'Beloved', reward: { lumen: 3 } },
  ];

  const TRIAL_DEFS = [
    { id: 'grove', name: 'Grove Echo Trial', tile: { x: 2, y: 3 }, seq: ['up', 'right', 'down'], reward: { lumen: 1 }, text: 'Repeat the old trail rhythm to calm the grove shrine.' },
    { id: 'quarry', name: 'Quarry Switch Trial', tile: { x: 14, y: 3 }, seq: ['left', 'up', 'right', 'right'], reward: { lumen: 1 }, text: 'Strike the switches in order before the stone hum fades.' },
    { id: 'tide', name: 'Tide Lantern Trial', tile: { x: 2, y: 13 }, seq: ['down', 'right', 'up', 'left'], reward: { lumen: 1 }, text: 'Guide the lantern around the tide line without breaking the glow.' },
    { id: 'spire', name: 'Spire Heart Trial', tile: { x: 14, y: 13 }, seq: ['up', 'left', 'down', 'right', 'up'], reward: { lumen: 1, relic: 1 }, text: 'Match the full heart-pattern to wake the path toward the Prism Gate.' },
  ];
  const TRIAL_BY_ID = Object.fromEntries(TRIAL_DEFS.map((trial) => [trial.id, trial]));
  const GATE_TILE = { x: 8, y: 1 };
  const TRAILHEAD_TILE = { x: 0, y: 8 }; // town-side doorway into the Wilds
  const NPC_HOME_POINTS = [
    { x: 6, y: 6 }, { x: 10, y: 6 }, { x: 6, y: 10 }, { x: 10, y: 10 },
    { x: 3, y: 7 }, { x: 13, y: 7 }, { x: 4, y: 13 }, { x: 12, y: 13 },
    { x: 5, y: 5 },
  ];

  // ---------------------------------------------------------------------
  // The Wilds — a separate, optional 17x17 exploration layer reached via the
  // town trailhead. Real hazards (Thorn Sprites, a stationary Guardian),
  // hidden treasure, and two tougher shrine trials live here; the peaceful
  // town loop (build/farm/NPCs) is completely untouched while visiting.
  // Spark doubles as a "health" meter out here — it only ever drifted down
  // gently in town, but enemy contact hits it hard, and hitting 0 sends you
  // straight back to town to recover.
  // ---------------------------------------------------------------------
  const WILDS_ENTRANCE = { x: 8, y: 8 };
  const GUARDIAN_TILE = { x: 15, y: 1 };
  const SPARK_WILDS_HIT = 9;
  const WILDS_TRIAL_DEFS = [
    { id: 'emberpeak', name: 'Ember Peak Trial', tile: { x: 1, y: 1 }, seq: ['up', 'right', 'up', 'left', 'down'], reward: { lumen: 2, shale: 3 }, text: 'A tougher rhythm echoes off the wilds — five beats, no mistakes.' },
    { id: 'moonhollow', name: 'Moonhollow Trial', tile: { x: 15, y: 15 }, seq: ['down', 'left', 'down', 'right', 'up', 'left'], reward: { lumen: 2, keystone: 1 }, text: 'The deepest hollow remembers a six-step pattern. Get it right and it remembers you back — with a Keystone.' },
  ];
  const ALL_TRIAL_DEFS = TRIAL_DEFS.concat(WILDS_TRIAL_DEFS);
  const WILDS_BLOCK_TYPES = new Set(['thicket', 'crag', 'glimmer', 'wshrine', 'treasure']);

  // ---------------------------------------------------------------------
  // Deterministic RNG + terrain generation (seed lives in save data, the
  // larger terrain grid itself never needs to be persisted).
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
    return (x === GATE_TILE.x && y === GATE_TILE.y) || (x === TRAILHEAD_TILE.x && y === TRAILHEAD_TILE.y) || TRIAL_DEFS.some((trial) => trial.tile.x === x && trial.tile.y === y);
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
    grid[TRAILHEAD_TILE.y][TRAILHEAD_TILE.x] = 'trailhead';
    for (const n of neighbors4(TRAILHEAD_TILE.x, TRAILHEAD_TILE.y)) if (inBounds(n.x, n.y)) grid[n.y][n.x] = 'grass';
    for (let i = 2; i <= 14; i += 2) {
      if (grid[8][i] === 'grass') grid[8][i] = 'trail';
      if (grid[i][8] === 'grass') grid[i][8] = 'trail';
    }
    return grid;
  }
  function wildsTrialAt(x, y) {
    return WILDS_TRIAL_DEFS.find((trial) => trial.tile.x === x && trial.tile.y === y) || null;
  }
  function genWildsTerrain(seed) {
    // A separate deterministic layer from the same seed (offset so it never
    // matches the town's own scatter), regenerated on demand and never
    // persisted — exactly like genTerrain() for the town.
    const rnd = mulberry32((seed ^ 0x51ed270b) >>> 0);
    const grid = [];
    for (let y = 0; y < GRID; y++) grid.push(new Array(GRID).fill('wgrass'));
    function nearEntrance(x, y, minDist) {
      return Math.max(Math.abs(x - WILDS_ENTRANCE.x), Math.abs(y - WILDS_ENTRANCE.y)) < minDist;
    }
    function scatterWilds(type, count, minDist) {
      let placed = 0, guard = 0;
      while (placed < count && guard < 600) {
        guard++;
        const x = Math.floor(rnd() * GRID), y = Math.floor(rnd() * GRID);
        if (nearEntrance(x, y, minDist) || grid[y][x] !== 'wgrass') continue;
        grid[y][x] = type; placed++;
      }
    }
    scatterWilds('thicket', 26, 1);
    scatterWilds('crag', 16, 1);
    scatterWilds('glimmer', 6, 2);
    scatterWilds('treasure', 6, 3);
    for (const trial of WILDS_TRIAL_DEFS) {
      grid[trial.tile.y][trial.tile.x] = 'wshrine';
      for (const n of neighbors4(trial.tile.x, trial.tile.y)) if (inBounds(n.x, n.y)) grid[n.y][n.x] = 'wgrass';
    }
    grid[WILDS_ENTRANCE.y][WILDS_ENTRANCE.x] = 'wgrass';
    for (const n of neighbors4(WILDS_ENTRANCE.x, WILDS_ENTRANCE.y)) if (inBounds(n.x, n.y)) grid[n.y][n.x] = 'wgrass';
    if (inBounds(GUARDIAN_TILE.x, GUARDIAN_TILE.y)) grid[GUARDIAN_TILE.y][GUARDIAN_TILE.x] = 'wgrass';
    return grid;
  }
  // genWildsTerrain() is a pure function of the seed, so a treasure the
  // player already looted (tracked in state.wilds.treasuresFound, which IS
  // persisted) would otherwise re-glow as an untouched 'treasure' tile every
  // time the Wilds layer is regenerated (new session, seed change, or
  // reloading a save). collectTreasure() already clears the live grid at
  // pickup time; this replays that same clearing against a freshly
  // generated grid so it stays consistent across reloads. Call this every
  // time `wildsTerrain = genWildsTerrain(...)` runs.
  function clearFoundWildsTreasures() {
    const found = state && state.wilds && Array.isArray(state.wilds.treasuresFound) ? state.wilds.treasuresFound : [];
    for (const id of found) {
      const m = /^t_(\d+)_(\d+)$/.exec(id);
      if (!m) continue;
      const tx = Number(m[1]), ty = Number(m[2]);
      if (inBounds(tx, ty) && wildsTerrain[ty][tx] === 'treasure') wildsTerrain[ty][tx] = 'wgrass';
    }
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
  let wildsTerrain = null; // regenerated from state.seed, never persisted directly
  let npcs = [];       // runtime NPC objects (schedule targets derived from terrain + state.quests)

  const rt = {
    playerPx: 0, playerPy: 0, playerFromX: 0, playerFromY: 0, playerToX: 0, playerToY: 0, moveT: 1, moveDur: 160,
    facing: 'down',
    gathering: null, // {x,y,t,dur}
    cooking: null,   // {recipe,t,dur}
    particles: [],
    ambience: [],
    lastFrame: 0,
    dpr: 1, W: 0, H: 0, tileW: 48, tileH: 24, originX: 0, originY: 0,
    paused: false,
    reducedMotion: false,
    hostSound: true,
    gpEnabled: false, // captured from the host 'settings' message (d.gamepad)
    gp: { // edge-detection state for the gamepad poll, mirrors keydown's evt.repeat guard
      prevDir: { up: false, down: false, left: false, right: false },
      prevA: false, prevB: false, prevStart: false,
    },
    running: true,
    lastSparkTick: 0,
    lastPushAt: 0,
    lastAutoPush: 0,
    playSecondsAccum: 0,
    dialogueNpc: null,
    dialogueMode: null, // 'npc' | 'cook'
    fishing: { open: false, zoneStart: 0.4, zoneWidth: 0.22, marker: 0, dir: 1, speed: 0.55 },
    build: { open: false, tool: 'place', selected: null, rotation: 0, placing: false },
    farmTool: null, // null | {mode:'till'} | {mode:'plant', crop} | {mode:'fertilize'}
    tutorial: { step: 0 },
    trial: null, // {trial,input:[]}
    // --- Wilds (see the block comment above WILDS_ENTRANCE) — all runtime-only,
    // never persisted: leaving the game always drops you back in town on reload.
    world: 'town', // 'town' | 'wilds'
    wildsGx: WILDS_ENTRANCE.x, wildsGy: WILDS_ENTRANCE.y,
    wildsFromX: WILDS_ENTRANCE.x, wildsFromY: WILDS_ENTRANCE.y, wildsToX: WILDS_ENTRANCE.x, wildsToY: WILDS_ENTRANCE.y,
    wildsMoveT: 1, wildsMoveDur: 150, wildsPx: 0, wildsPy: 0,
    wildsEnemies: [],
    wildsInvulnUntil: 0,
    lastAttackAt: 0,
  };

  const mp = {
    active: false, participants: [], sharedTown: [], sharedFarm: [], openBuilding: 'host_only',
    amIHost: false, hostStatus: 'n/a', probeSent: false, pendingNonce: null, hostCheckAt: 0,
    lastSyncAt: 0,
  };

  function defaultQuestState() {
    return Object.fromEntries(NPC_DEFS.map((npc) => [npc.id, { done: false }]));
  }
  function defaultAdventureState() {
    return {
      gateOpen: false,
      trials: Object.fromEntries(ALL_TRIAL_DEFS.map((trial) => [trial.id, { done: false }])),
    };
  }
  function defaultFriendshipState() {
    return Object.fromEntries(NPC_DEFS.map((npc) => [npc.id, { points: 0, lastChatDay: 0, claimed: [] }]));
  }
  function newGame(seed) {
    state = {
      version: 4,
      seed: seed >>> 0,
      day: 1,
      minutes: 400, // ~6:40am
      player: { gx: 8, gy: 8, hue: 'coral', topper: 'none', trim: 'soft', name: 'Resident' },
      inventory: {
        grain: 3, shale: 2, loom: 1, driftfish: 0, lumen: 0, keystone: 0, relic: 0,
        cake: 0, skewer: 0, chowder: 0, sunjam: 0, moonloaf: 0, gourdstew: 0, omelet: 0,
        sunberry: 0, moonwheat: 0, glowgourd: 0, stormcorn: 0, frostberry: 0,
        sunberryseed: 2, moonwheatseed: 1, glowgourdseed: 0, stormcornseed: 0, frostberryseed: 0,
        plank: 0, ingot: 0, fertilizer: 0, egg: 0,
      },
      spark: 78,
      town: [], // {id,type,gx,gy,rot}
      farm: [], // {x,y,crop:null|cropKey,prog:in-game minutes grown,watered:bool,dryStreak:int,fertileUntilDay:int}
      livestock: [], // {id,pieceId,gx,gy,fedToday:bool,readyToCollect:bool} — one per placed Coop
      quests: defaultQuestState(),
      adventure: defaultAdventureState(),
      friendship: defaultFriendshipState(), // per-NPC {points,lastChatDay,claimed[]} — local only, never host-synced
      tools: { gatherTier: 1 }, // 1 = bare hands, 2 = Sturdy Tool, 3 = Masterwork Tool
      wilds: { treasuresFound: [], guardianDefeated: false }, // local only, never host-synced
      cosmeticsUnlocked: { hue: ['coral', 'mint', 'slate', 'sand'], topper: ['none', 'cap'], trim: ['soft', 'bold'] },
      tutorialSeen: false,
      stats: {
        gathered: 0, built: 0, demolished: 0, fishCaught: 0, fishTried: 0, dishesCooked: 0, questsCompleted: 0,
        trialsCleared: 0, gatesOpened: 0, secondsPlayed: 0, cropsHarvested: 0,
        enemiesDefeated: 0, treasuresFound: 0, itemsCrafted: 0, eggsCollected: 0,
      },
      completedMilestone: false,
    };
    terrain = genTerrain(state.seed);
    wildsTerrain = genWildsTerrain(state.seed);
    clearFoundWildsTreasures();
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
  function currentFarm() {
    // Mirrors currentTown(): the host's farm is the shared one; a guest's own
    // tilled rows stay local previews layered over the host's shared farm.
    if (!mp.active || mp.amIHost) return state.farm;
    return state.farm.concat(mp.sharedFarm);
  }
  function farmPlotAt(x, y, farm) {
    for (const p of farm) if (p.x === x && p.y === y) return p;
    return null;
  }
  function cropReady(plot) {
    return !!(plot.crop && CROP_BY_KEY[plot.crop] && plot.prog >= CROP_BY_KEY[plot.crop].dur);
  }
  function cropStage(plot) {
    const c = CROP_BY_KEY[plot.crop];
    if (!c) return 0;
    if (plot.prog >= c.dur) return 3;
    return Math.min(2, Math.floor((plot.prog / c.dur) * 3));
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
    if (farmPlotAt(gx, gy, currentFarm())) return false;
    return true;
  }
  function neighbors4(gx, gy) {
    return [{ x: gx + 1, y: gy }, { x: gx - 1, y: gy }, { x: gx, y: gy + 1 }, { x: gx, y: gy - 1 }];
  }
  function isBlockedWildsTile(gx, gy) {
    if (!inBounds(gx, gy)) return true;
    return WILDS_BLOCK_TYPES.has(wildsTerrain[gy][gx]);
  }
  function currentLivestock() {
    // Livestock follows the exact same rule as farm plots: a coop you placed
    // yourself is a locally-owned entry you can feed/collect; a coop that
    // came from the host's shared town (currentTown()) renders fine but has
    // no matching entry in your own state.livestock, so it just isn't
    // interactive for a guest — mirroring how guests can see but not
    // water/harvest the host's shared farm rows.
    return state.livestock;
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
    till: () => beep(240, 0.16, 'triangle', 0.16),
    water: () => { beep(430, 0.14, 'sine', 0.16); setTimeout(() => beep(320, 0.18, 'sine', 0.12), 80); },
    harvest: () => { beep(560, 0.14, 'triangle', 0.22); setTimeout(() => beep(760, 0.18, 'triangle', 0.2), 100); },
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
    if (rt.world === 'wilds' && (name === 'build' || name === 'farming' || name === 'craft')) {
      toast('Return to town first — building, farming, and crafting stay there.');
      return;
    }
    $all('.panel').forEach((p) => p.classList.remove('is-open'));
    const p = document.querySelector(`[data-ct-panel="${name}"]`);
    if (p) p.classList.add('is-open');
    if (name === 'build') renderBuildPanel();
    if (name === 'farming') renderFarmPanel();
    if (name === 'craft') renderCraftPanel();
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
    let note = 'Tap Demolish, then tap one of your own pieces to remove it (you get half the resources back). The Watchtower needs crafted Ingot and Plank — open Craft first.';
    if (mp.active && !mp.amIHost) note = mp.openBuilding === 'everyone' ? 'The host has building open — your placements stay local to your visit, layered over the host’s shared town.' : 'Only the room host can build the shared town right now. Ask them to open it from Together.';
    el.buildNote.textContent = note;
  }

  // ---------------------------------------------------------------------
  // Craft panel — resources into intermediate materials, tools, fertilizer
  // ---------------------------------------------------------------------
  function renderCraftPanel() {
    if (!el.craftList) return;
    el.craftList.innerHTML = CRAFT_RECIPES.map((r) => {
      const tier = gatherTier();
      const owned = r.unlockTool && tier >= r.unlockTool;
      const locked = r.unlockTool && !owned && tier !== r.unlockTool - 1;
      const afford = canAfford(r.cost);
      const costTxt = Object.entries(r.cost).map(([k, v]) => `${v} ${RES_LABELS[k] || k}`).join(', ');
      const disabled = owned || locked || !afford;
      const status = owned ? 'Owned' : locked ? 'Craft the previous tier first' : costTxt;
      return `<div class="inv-item" style="flex-direction:column;align-items:stretch;gap:4px">
        <span><b>${r.label}</b></span>
        <span style="color:var(--text-dim);font-size:11px">${r.note}</span>
        <span style="color:var(--text-dim);font-size:11px">${status}</span>
        <button type="button" data-ct-craft="${r.key}" ${disabled ? 'disabled' : ''}>${owned ? 'Owned' : 'Craft'}</button>
      </div>`;
    }).join('');
    $all('[data-ct-craft]').forEach((b) => b.onclick = () => craftItem(b.dataset.ctCraft));
  }
  function craftItem(key) {
    const r = CRAFT_BY_KEY[key];
    if (!r) return;
    if (r.unlockTool) {
      const tier = gatherTier();
      if (tier >= r.unlockTool) { toast('You already own that tool tier.'); return; }
      if (tier !== r.unlockTool - 1) { toast('Craft the previous tool tier first.'); return; }
    }
    if (!canAfford(r.cost)) { toast('Not enough materials for that yet.'); return; }
    for (const [k, v] of Object.entries(r.cost)) state.inventory[k] -= v;
    if (r.yields) for (const [k, v] of Object.entries(r.yields)) state.inventory[k] = (state.inventory[k] || 0) + v;
    if (r.unlockTool) state.tools.gatherTier = r.unlockTool;
    state.stats.itemsCrafted = (state.stats.itemsCrafted || 0) + 1;
    sfx.place();
    toast(`Crafted ${r.label}.`);
    renderCraftPanel();
    updateHud();
    schedulePush();
  }

  // ---------------------------------------------------------------------
  // Farm panel + tilling / planting / watering / fertilizing / harvest
  // ---------------------------------------------------------------------
  function renderFarmPanel() {
    const season = seasonOf(state.day);
    el.seedList.innerHTML = CROPS.map((c) => {
      const seeds = state.inventory[c.seed] || 0;
      const grown = state.inventory[c.key] || 0;
      const favored = c.season === season ? ' · favored this season' : '';
      return `<button type="button" class="piece-btn ${seeds > 0 ? '' : 'is-locked'}" data-ct-seed="${c.key}">
        <span class="piece-swatch" style="background:${c.color}"></span>
        <span>${c.label}</span>
        <span class="piece-cost">${seeds} seeds · ${c.days}${grown ? ` · ${grown} grown` : ''}${favored}</span>
      </button>`;
    }).join('');
    $all('[data-ct-seed]').forEach((b) => b.onclick = () => {
      const crop = CROP_BY_KEY[b.dataset.ctSeed];
      if (!crop) return;
      if ((state.inventory[crop.seed] || 0) <= 0) { toast(`No ${crop.label} seeds yet — look for them while gathering, or trade with Sage.`); return; }
      closePanels();
      rt.farmTool = { mode: 'plant', crop: crop.key };
      toast(`Planting ${crop.label} — tap a tilled soil plot. Esc or ● puts the seeds away.`);
    });
    const tillBtn = $('[data-ct-till]');
    if (tillBtn) tillBtn.onclick = () => {
      closePanels();
      rt.farmTool = { mode: 'till' };
      toast('Tilling — tap open grass to make a soil plot. Esc or ● puts the hoe away.');
    };
    const fertBtn = $('[data-ct-fertilize]');
    if (fertBtn) {
      const have = state.inventory.fertilizer || 0;
      fertBtn.disabled = have <= 0;
      fertBtn.textContent = `Use Fertilizer (${have})`;
      fertBtn.onclick = () => {
        if (have <= 0) { toast('Craft Rich Fertilizer first — open Craft.'); return; }
        closePanels();
        rt.farmTool = { mode: 'fertilize' };
        toast('Fertilizing — tap a planted soil plot. Esc or ● puts it away.');
      };
    }
    let note = `It's ${SEASON_LABEL[season]}. Water daily to speed growth; fertilize to speed it further and guard against wilting. Leave a crop dry (and unfertilized) for ${WILT_THRESHOLD} days running and it wilts away — a real fail-state, so don't wander off for too long.`;
    if (mp.active && !mp.amIHost) note = 'You’re visiting — your garden rows stay local previews on this device. The host’s farm is the shared one everyone sees.';
    el.farmNote.textContent = note;
  }
  function canTillAt(gx, gy) {
    return isBuildableGround(gx, gy);
  }
  function canPlantAt(gx, gy) {
    if (!rt.farmTool || rt.farmTool.mode !== 'plant') return false;
    const crop = CROP_BY_KEY[rt.farmTool.crop];
    if (!crop || (state.inventory[crop.seed] || 0) <= 0) return false;
    const plot = farmPlotAt(gx, gy, state.farm);
    return !!(plot && !plot.crop);
  }
  function canFertilizeAt(gx, gy) {
    if ((state.inventory.fertilizer || 0) <= 0) return false;
    const plot = farmPlotAt(gx, gy, state.farm);
    return !!(plot && plot.crop);
  }
  function farmTapAt(gx, gy) {
    if (!rt.farmTool) return;
    if (rt.farmTool.mode === 'till') {
      if (!canTillAt(gx, gy)) { toast('Soil needs open grass — try another tile.'); return; }
      state.farm.push({ x: gx, y: gy, crop: null, prog: 0, watered: false, dryStreak: 0, fertileUntilDay: 0 });
      sfx.till();
      spawnParticles(gx, gy, '#8a5f3c');
      toast('Tilled a soil plot. Plant a seed from the Farm panel!');
    } else if (rt.farmTool.mode === 'plant') {
      const crop = CROP_BY_KEY[rt.farmTool.crop];
      const plot = farmPlotAt(gx, gy, state.farm);
      if (!plot) { toast('Seeds need tilled soil — till a grass tile first.'); return; }
      if (plot.crop) { toast('Something is already growing there.'); return; }
      if (!crop || (state.inventory[crop.seed] || 0) <= 0) { rt.farmTool = null; updateHud(); return; }
      state.inventory[crop.seed] -= 1;
      plot.crop = crop.key;
      plot.prog = 0;
      plot.dryStreak = 0;
      sfx.place();
      spawnParticles(gx, gy, crop.color);
      toast(`Planted ${crop.label} — ${crop.days} to grow. Water it to hurry it along.`);
      if ((state.inventory[crop.seed] || 0) <= 0) { rt.farmTool = null; toast(`Planted the last ${crop.label} seed.`); }
    } else if (rt.farmTool.mode === 'fertilize') {
      if (!canFertilizeAt(gx, gy)) { toast('Fertilizer needs a plot with something already growing.'); return; }
      const plot = farmPlotAt(gx, gy, state.farm);
      state.inventory.fertilizer -= 1;
      plot.fertileUntilDay = state.day + FERTILIZER_DAYS;
      sfx.water();
      spawnParticles(gx, gy, '#78d36f');
      toast(`Fertilized — faster growth and safe from wilting for ${FERTILIZER_DAYS} days.`);
      if ((state.inventory.fertilizer || 0) <= 0) { rt.farmTool = null; }
    }
    updateHud();
    schedulePush();
    scheduleTownSync();
  }
  function waterPlot(plot) {
    if (plot.watered) return;
    plot.watered = true;
    sfx.water();
    spawnParticles(plot.x, plot.y, '#4fd1e8');
    toast('Watered — it will grow faster until tomorrow.');
    updateHud();
    schedulePush();
    scheduleTownSync();
  }
  function harvestPlot(plot) {
    const crop = CROP_BY_KEY[plot.crop];
    if (!crop || !cropReady(plot)) return;
    state.inventory[crop.key] = (state.inventory[crop.key] || 0) + crop.yieldN;
    state.inventory[crop.seed] = (state.inventory[crop.seed] || 0) + 1;
    plot.crop = null;
    plot.prog = 0;
    plot.watered = false;
    plot.dryStreak = 0;
    state.stats.cropsHarvested = (state.stats.cropsHarvested || 0) + 1;
    state.spark = clamp(state.spark + 4, 0, 100);
    sfx.harvest();
    spawnParticles(plot.x, plot.y, crop.color);
    toast(`Harvested ${crop.yieldN} ${crop.label}${crop.yieldN > 1 ? 's' : ''} — and found a spare seed!`);
    updateHud();
    schedulePush();
    scheduleTownSync();
  }
  function plotGrowthRate(plot, season) {
    const base = plot.watered ? FARM_WATERED_RATE : FARM_DRY_RATE;
    const seasonMult = seasonGrowthMultiplier(plot.crop, season);
    const fertilized = (plot.fertileUntilDay || 0) >= state.day;
    return base * seasonMult * (fertilized ? FERTILIZER_RATE_BONUS : 1);
  }
  function stepFarm(dtMinutes) {
    const season = seasonOf(state.day);
    for (const plot of state.farm) {
      if (!plot.crop) continue;
      const c = CROP_BY_KEY[plot.crop];
      if (!c || plot.prog >= c.dur) continue;
      plot.prog += dtMinutes * plotGrowthRate(plot, season);
      if (plot.prog >= c.dur) {
        sfx.cookDone();
        toast(`A ${c.label} is ready to harvest!`);
      }
    }
  }
  // Called once per in-game day turn (from both the real-time loop rollover
  // and doSleep's fast-forward) — resets watering and checks for wilting.
  function farmNewDay() {
    const day = state.day;
    for (const plot of state.farm) {
      if (!plot.crop) { plot.watered = false; plot.dryStreak = 0; continue; }
      const fertilized = (plot.fertileUntilDay || 0) >= day;
      if (plot.watered || fertilized) {
        plot.dryStreak = 0;
      } else {
        plot.dryStreak = (plot.dryStreak || 0) + 1;
        if (plot.dryStreak >= WILT_THRESHOLD) {
          const c = CROP_BY_KEY[plot.crop];
          toast(`Your ${c ? c.label : 'crop'} wilted from neglect.`);
          plot.crop = null;
          plot.prog = 0;
          plot.dryStreak = 0;
        }
      }
      plot.watered = false;
    }
    for (const l of state.livestock) {
      if (l.fedToday) l.readyToCollect = true;
      l.fedToday = false;
    }
  }

  // ---------------------------------------------------------------------
  // Livestock (Coop) — a real Grain sink with a daily feed→collect loop
  // ---------------------------------------------------------------------
  function feedCoop(l) {
    if (l.fedToday) return;
    if ((state.inventory.grain || 0) < 2) { toast('Need 2 Grain to feed the coop.'); return; }
    state.inventory.grain -= 2;
    l.fedToday = true;
    sfx.place();
    toast('Fed the coop — check back tomorrow for eggs.');
    updateHud();
    schedulePush();
  }
  function collectEgg(l) {
    if (!l.readyToCollect) return;
    const n = 1 + (Math.random() < 0.3 ? 1 : 0);
    state.inventory.egg = (state.inventory.egg || 0) + n;
    l.readyToCollect = false;
    state.stats.eggsCollected = (state.stats.eggsCollected || 0) + n;
    sfx.harvest();
    toast(`Collected ${n} Egg${n > 1 ? 's' : ''}!`);
    updateHud();
    schedulePush();
  }

  // ---------------------------------------------------------------------
  // Inventory panel
  // ---------------------------------------------------------------------
  const FOOD_TYPES = { cake: 'Grove Cake', skewer: 'Ember Skewer', chowder: 'Tide Chowder', sunjam: 'Sunberry Jam', moonloaf: 'Moonwheat Loaf', gourdstew: 'Glowgourd Stew', omelet: 'Sunrise Omelet' };
  const RES_LABELS = {
    grain: 'Grain', shale: 'Shale', loom: 'Loom', driftfish: 'Driftfish', lumen: 'Lumen', keystone: 'Keystone', relic: 'Relic',
    sunberry: 'Sunberry', moonwheat: 'Moonwheat', glowgourd: 'Glowgourd', stormcorn: 'Stormcorn', frostberry: 'Frostberry',
    sunberryseed: 'Sunberry Seed', moonwheatseed: 'Moonwheat Seed', glowgourdseed: 'Glowgourd Seed', stormcornseed: 'Stormcorn Seed', frostberryseed: 'Frostberry Seed',
    plank: 'Plank', ingot: 'Ingot', fertilizer: 'Fertilizer', egg: 'Egg',
  };
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
    chatWithNpc(npc.id);
    const q = npc.quest;
    const def = npc.def.quest;
    if (q.done) {
      const f = friendshipOf(npc.id);
      const flavor = f.points >= 100 ? ' You’ve become one of my dearest friends in this town.' : f.points >= 50 ? ' I always look forward to seeing you.' : f.points >= 20 ? ' Good to see a friendly face.' : '';
      const seasonLine = ` ${SEASON_SMALLTALK[seasonOf(state.day)]}`;
      el.dlgBody.textContent = `Thanks again for the help — the town looks better for it.${flavor}${seasonLine}`;
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
    if (el.dlgFriend) {
      const f = friendshipOf(npc.id);
      el.dlgFriend.hidden = false;
      el.dlgFriend.textContent = `Friendship: ${friendshipLabel(f.points)} (${f.points} pts) — gifts they especially love: ${RES_LABELS[GIFT_LOVED[npc.id]] || GIFT_LOVED[npc.id]}.`;
    }
    renderGiftList(npc.id);
    openPanel('dialogue');
  }
  function questReady(need) {
    return Object.entries(need).every(([k, v]) => (state.inventory[k] || 0) >= v);
  }

  // ---------------------------------------------------------------------
  // Harvest-Moon-style friendship: repeated chat (once/day) + gifts (using
  // existing inventory) raise a per-NPC points total; milestones grant a
  // one-time bonus. Entirely local/per-player — never part of the host-
  // synced match-state, unlike town/farm (see the note above sendTownSync).
  // ---------------------------------------------------------------------
  function friendshipOf(npcId) {
    if (!state.friendship) state.friendship = defaultFriendshipState();
    if (!state.friendship[npcId]) state.friendship[npcId] = { points: 0, lastChatDay: 0, claimed: [] };
    return state.friendship[npcId];
  }
  function friendshipLabel(points) {
    if (points >= 100) return 'Beloved';
    if (points >= 50) return 'Trusted';
    if (points >= 20) return 'Warm';
    return 'Acquaintance';
  }
  function maybeGrantFriendMilestones(npcId) {
    const f = friendshipOf(npcId);
    for (const lvl of FRIEND_LEVELS) {
      if (f.points >= lvl.at && !f.claimed.includes(lvl.at)) {
        f.claimed.push(lvl.at);
        for (const [k, v] of Object.entries(lvl.reward)) state.inventory[k] = (state.inventory[k] || 0) + v;
        const name = (NPC_BY_ID[npcId] && NPC_BY_ID[npcId].name) || 'A resident';
        toast(`${name} feels ${lvl.label.toLowerCase()} toward you! (+${Object.entries(lvl.reward).map(([k, v]) => `${v} ${RES_LABELS[k] || k}`).join(', ')})`);
        sfx.quest();
      }
    }
  }
  function chatWithNpc(npcId) {
    const f = friendshipOf(npcId);
    if (f.lastChatDay === state.day) return;
    f.lastChatDay = state.day;
    f.points += 1;
    maybeGrantFriendMilestones(npcId);
  }
  const GIFTABLE_KEYS = ['grain', 'shale', 'loom', 'driftfish', 'sunberry', 'moonwheat', 'glowgourd', 'stormcorn', 'frostberry', 'egg', 'cake', 'skewer', 'chowder', 'sunjam', 'moonloaf', 'gourdstew', 'omelet'];
  function renderGiftList(npcId) {
    if (!el.dlgGiftList) return;
    const items = GIFTABLE_KEYS.filter((k) => (state.inventory[k] || 0) > 0);
    if (!items.length) { el.dlgGiftList.innerHTML = '<p class="small-note">You have nothing to gift right now.</p>'; return; }
    el.dlgGiftList.innerHTML = items.map((k) => `<div class="inv-item"><span>${RES_LABELS[k] || FOOD_TYPES[k] || k} × ${state.inventory[k]}</span><button type="button" data-ct-gift="${k}">Gift</button></div>`).join('');
    $all('[data-ct-gift]').forEach((b) => b.onclick = () => giveGift(npcId, b.dataset.ctGift));
  }
  function giveGift(npcId, itemKey) {
    if ((state.inventory[itemKey] || 0) <= 0) return;
    state.inventory[itemKey] -= 1;
    const f = friendshipOf(npcId);
    const isFood = !!FOOD_TYPES[itemKey];
    const loved = GIFT_LOVED[npcId] === itemKey;
    const gain = loved ? 6 : isFood ? 4 : 2;
    f.points += gain;
    sfx.quest();
    toast(loved ? `They love this gift! (+${gain} friendship)` : `A gift given. (+${gain} friendship)`);
    maybeGrantFriendMilestones(npcId);
    if (rt.dialogueNpc && rt.dialogueNpc.id === npcId) {
      if (el.dlgFriend) el.dlgFriend.textContent = `Friendship: ${friendshipLabel(f.points)} (${f.points} pts) — gifts they especially love: ${RES_LABELS[GIFT_LOVED[npcId]] || GIFT_LOVED[npcId]}.`;
      renderGiftList(npcId);
    }
    updateHud();
    schedulePush();
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
    if (el.dlgFriend) el.dlgFriend.hidden = true;
    if (el.dlgGiftList) el.dlgGiftList.innerHTML = '';
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
    return ALL_TRIAL_DEFS.filter((trial) => state.adventure?.trials?.[trial.id]?.done).length;
  }
  function computeScore() {
    const s = state.stats;
    return s.built * 5 + questDoneCount() * 55 + trialDoneCount() * 35 + (s.gatesOpened || 0) * 180 + s.fishCaught * 4 + s.dishesCooked * 5 + (s.cropsHarvested || 0) * 4 + (state.day - 1) * 10
      + (s.enemiesDefeated || 0) * 8 + (s.treasuresFound || 0) * 12 + (s.itemsCrafted || 0) * 6 + (s.eggsCollected || 0) * 2;
  }
  function computeProgress() {
    if (state.completedMilestone) return 100;
    const questPart = (questDoneCount() / NPC_DEFS.length) * 48;
    const trialPart = (trialDoneCount() / ALL_TRIAL_DEFS.length) * 24;
    const buildPart = Math.min(state.stats.built, 24) / 24 * 18;
    const gatePart = state.adventure?.gateOpen ? 10 : 0;
    return Math.min(99, Math.round(questPart + trialPart + buildPart + gatePart));
  }
  function renderReportPanel(milestone) {
    const qDone = questDoneCount();
    const tDone = trialDoneCount();
    el.reportTitle.textContent = milestone ? 'Prism Gate Opened!' : 'Town Report';
    el.reportSub.textContent = milestone ? 'The full CubeTown playthrough is complete. Keep building, fishing, and hosting friends as long as you like.' : `Day ${state.day}, ${formatClock(state.minutes)} · ${qDone}/${NPC_DEFS.length} resident arcs · ${tDone}/${ALL_TRIAL_DEFS.length} shrine trials.`;
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
    const trialRow = (trial) => {
      const done = state.adventure?.trials?.[trial.id]?.done;
      return `<div class="quest-row ${done ? 'is-done' : ''}">
        <b>${done ? '✓' : '□'} ${escapeHtml(trial.name)}</b>
        <span>${trial.seq.map((dir) => DIR_LABEL[dir]).join(' ')} → ${escapeHtml(rewardLine(trial.reward))}</span>
      </div>`;
    };
    const trialRows = TRIAL_DEFS.map(trialRow).join('');
    const wildsTrialRows = WILDS_TRIAL_DEFS.map(trialRow).join('');
    const friendRows = NPC_DEFS.map((npc) => {
      const f = friendshipOf(npc.id);
      return `<div class="quest-row"><b>${escapeHtml(npc.name)}</b><span>${friendshipLabel(f.points)} · ${f.points} pts</span></div>`;
    }).join('');
    const guardianStatus = state.wilds?.guardianDefeated ? 'The Wilds Guardian has fallen — its Relic is yours.' : 'A Guardian still watches over the deep Wilds, hoarding a Relic.';
    const gateReady = (state.inventory.keystone || 0) >= 4 && (state.inventory.relic || 0) >= 1;
    el.questLog.innerHTML = `
      <section class="quest-chapter">
        <h3>Chapter ${state.adventure?.gateOpen ? 'Complete' : gateReady ? 'Final' : 'I'} · The Prism Gate</h3>
        <p>${state.adventure?.gateOpen ? 'The Prism Gate is open. CubeTown is awake.' : gateReady ? 'You have the pieces. Walk to the north gate and open it.' : 'Help residents, clear shrine trials, recover four Keystones, and bring one Relic to the north gate.'}</p>
      </section>
      <section class="quest-chapter"><h3>Residents</h3>${questRows}</section>
      <section class="quest-chapter"><h3>Friendships</h3>${friendRows}</section>
      <section class="quest-chapter"><h3>Shrine Trials</h3>${trialRows}</section>
      <section class="quest-chapter"><h3>Wilds Trials</h3>${wildsTrialRows}<p>${escapeHtml(guardianStatus)}</p></section>
      <section class="quest-chapter"><h3>Inventory Clues</h3><p>${state.inventory.keystone || 0}/4 Keystones · ${state.inventory.lumen || 0} Lumen · ${state.inventory.relic || 0}/1 Relic · ${state.stats.built || 0} pieces built · Gathering tool tier ${gatherTier()}</p></section>`;
  }

  // ---------------------------------------------------------------------
  // Tutorial
  // ---------------------------------------------------------------------
  const TUTORIAL_STEPS = [
    'Move around the expanded island with WASD / arrow keys, or the on-screen pad on touch devices.',
    'Open Quest Log when you need direction. The full playthrough is residents → shrine trials → Prism Gate.',
    'Walk next to a Grove, Quarry, or Reed patch and press the glowing action button to gather Grain, Shale, or Loom.',
    'Open Build to spend resources on floors, walls, furniture, and a Hearth. Pick a piece, then tap an open tile to place it — Demolish removes your own pieces for half the cost back.',
    'Open Farm to till open grass into soil plots and plant seeds. Water daily to hurry things along, but don’t neglect a plot too long — an unwatered, unfertilized crop can wilt and die. Harvest when it sparkles.',
    'Find shrine blocks around the edges of the map. Each one has a short pattern trial that rewards Lumen, Relics, or story progress.',
    'Visit the pond and press the action button to fish for Driftfish. Tap Catch when the marker crosses the glowing zone.',
    'Cook at a Hearth to turn resources into dishes that refill your Spark meter. Spark drifts down slowly over time — it’s a gentle nudge, never a fail state in town.',
    'Talk to the residents around town. Each has a quest that unlocks looks, Keystones, or adventure rewards.',
    'Open Craft to turn Grain and Shale into Plank and Ingot, then spend those on Rich Fertilizer, a Sturdy or Masterwork gathering tool, and the crafted-material Watchtower in Build.',
    'Build a Coop straight from Grain and Shale, feed it 2 Grain, then come back the next day to collect Eggs for the Sunrise Omelet recipe.',
    'CubeTown’s seasons turn every few days, shifting the grass color and which crops grow fastest — plant with the season for a real bonus.',
    'Talk to residents often and give them gifts from your Inventory to build real friendship over time — favorite gifts count double, and friendship milestones return the favor.',
    'Follow the trailhead at the town’s west edge into the Wilds for real risk: hostile creatures, hidden treasure, and two tougher shrine trials guarding rare rewards. Spark doubles as your health out there, and you can retreat to town anytime from the HUD button.',
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
    if (rt.world === 'wilds') { tryMoveWilds(dx, dy); return; }
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
    if (rt.world === 'wilds') return findWildsInteraction();
    const p = state.player;
    if (rt.cooking) return { kind: 'cooking' };
    // adventure landmark adjacent?
    for (const n of neighbors4(p.gx, p.gy)) {
      if (!inBounds(n.x, n.y)) continue;
      const t = terrain[n.y][n.x];
      if (t === 'shrine') return { kind: 'trial', trial: trialAt(n.x, n.y) };
      if (t === 'gate') return { kind: 'gate' };
      if (t === 'trailhead') return { kind: 'enterWilds' };
    }
    // resource node adjacent?
    for (const n of neighbors4(p.gx, p.gy)) {
      if (!inBounds(n.x, n.y)) continue;
      const t = terrain[n.y][n.x];
      if (t === 'water') return { kind: 'fish' };
      if (NODE_RESOURCE[t]) return { kind: 'gather', resource: NODE_RESOURCE[t] };
    }
    // hearth / bed / coop adjacent (or standing near own)
    for (const n of [{ x: p.gx, y: p.gy }, ...neighbors4(p.gx, p.gy)]) {
      const piece = townPieceAt(n.x, n.y, currentTown());
      if (piece && piece.type === 'hearth') return { kind: 'cook' };
      if (piece && piece.type === 'bed' && daySegment(state.minutes) === 'night') return { kind: 'sleep' };
      if (piece && piece.type === 'coop') {
        const l = currentLivestock().find((x) => x.pieceId === piece.id);
        if (l) {
          if (l.readyToCollect) return { kind: 'collectEgg', livestock: l };
          if (!l.fedToday) return { kind: 'feed', livestock: l };
        }
      }
    }
    // own farm plot adjacent (or underfoot): harvest > water > plant
    for (const n of [{ x: p.gx, y: p.gy }, ...neighbors4(p.gx, p.gy)]) {
      const plot = farmPlotAt(n.x, n.y, state.farm);
      if (!plot) continue;
      if (plot.crop && cropReady(plot)) return { kind: 'harvest', plot };
      if (plot.crop && !plot.watered) return { kind: 'water', plot };
      if (!plot.crop) return { kind: 'plant' };
    }
    // npc adjacent
    for (const npc of npcs) {
      if (Math.max(Math.abs(npc.gx - p.gx), Math.abs(npc.gy - p.gy)) <= 1 && !(npc.gx === p.gx && npc.gy === p.gy)) {
        return { kind: 'talk', npc };
      }
    }
    return null;
  }
  const CONTEXT_LABEL = {
    gather: 'Gather', fish: 'Fish', cook: 'Cook', sleep: 'Sleep', talk: 'Talk', trial: 'Trial', gate: 'Gate',
    harvest: 'Harvest', water: 'Water', plant: 'Plant', feed: 'Feed', collectEgg: 'Collect Eggs',
    enterWilds: 'Into the Wilds', attack: 'Strike', treasure: 'Search', gatherGlimmer: 'Gather',
  };
  function doContextAction() {
    if (rt.world === 'wilds') { doWildsContextAction(); return; }
    if (rt.build.placing) return; // handled via canvas tap while placing
    if (rt.farmTool) { rt.farmTool = null; toast('Farm tools put away.'); updateHud(); return; }
    const it = findInteraction();
    if (!it) return;
    if (it.kind === 'gather') doGather(it.resource);
    else if (it.kind === 'fish') openFishing();
    else if (it.kind === 'cook') openCookPrompt();
    else if (it.kind === 'sleep') doSleep();
    else if (it.kind === 'talk') openNpcDialogue(it.npc);
    else if (it.kind === 'trial') openTrial(it.trial);
    else if (it.kind === 'gate') openGate();
    else if (it.kind === 'harvest') harvestPlot(it.plot);
    else if (it.kind === 'water') waterPlot(it.plot);
    else if (it.kind === 'plant') openPanel('farming');
    else if (it.kind === 'feed') feedCoop(it.livestock);
    else if (it.kind === 'collectEgg') collectEgg(it.livestock);
    else if (it.kind === 'enterWilds') enterWilds();
  }
  function doGather(resource) {
    if (rt.gathering) return;
    rt.gathering = { t: 0, dur: rt.reducedMotion ? 250 : gatherDurationMs(), resource };
  }
  function finishGather() {
    const resource = rt.gathering.resource;
    state.inventory[resource] = (state.inventory[resource] || 0) + gatherYieldN();
    state.stats.gathered += 1;
    sfx.gather();
    spawnParticles(rt.playerToX, rt.playerToY, resource === 'grain' ? '#ffd54f' : resource === 'shale' ? '#9bb3d6' : '#c792ea');
    // Seeds hide in the greenery: grove and reed gathers sometimes turn one up.
    if ((resource === 'grain' || resource === 'loom') && Math.random() < 0.35) {
      const roll = Math.random();
      const seedKey = roll < 0.32 ? 'sunberryseed' : roll < 0.56 ? 'moonwheatseed' : roll < 0.72 ? 'glowgourdseed' : roll < 0.86 ? 'stormcornseed' : 'frostberryseed';
      state.inventory[seedKey] = (state.inventory[seedKey] || 0) + 1;
      toast(`Found a ${RES_LABELS[seedKey]} tucked in the greenery!`);
    }
    rt.gathering = null;
    updateHud();
    schedulePush();
  }
  function doSleep() {
    // Crops keep growing overnight — advance them by the skipped in-game
    // minutes using the same season/fertilizer-aware rate as stepFarm — then
    // run the shared day-turn logic (watering reset + wilt check + coop cycle).
    const nowMin = ((state.minutes % 1440) + 1440) % 1440;
    const skipped = nowMin > 380 ? (1440 - nowMin) + 380 : (380 - nowMin);
    const season = seasonOf(state.day);
    for (const plot of state.farm) {
      if (plot.crop && CROP_BY_KEY[plot.crop]) plot.prog += skipped * plotGrowthRate(plot, season);
    }
    state.day += 1;
    farmNewDay();
    state.spark = 100;
    state.minutes = 380;
    const gardenReady = state.farm.some((plot) => cropReady(plot));
    toast(gardenReady ? 'Slept well — and something in the garden looks ready!' : 'Slept well — a new day begins.');
    updateHud();
    schedulePush();
    scheduleTownSync();
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
    if (type === 'coop') state.livestock.push({ id: `l${piece.id}`, pieceId: piece.id, gx, gy, fedToday: false, readyToCollect: false });
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
    state.livestock = state.livestock.filter((l) => l.pieceId !== piece.id);
    for (const [k, v] of Object.entries(def.cost)) state.inventory[k] = (state.inventory[k] || 0) + Math.floor(v / 2);
    state.stats.demolished += 1;
    sfx.demolish();
    updateHud();
    schedulePush();
    scheduleTownSync();
  }

  // ---------------------------------------------------------------------
  // The Wilds — movement, interaction, enemies, treasure, entry/exit
  // ---------------------------------------------------------------------
  function tryMoveWilds(dx, dy) {
    if (rt.paused || anyPanelOpen()) return;
    const nx = rt.wildsGx + dx, ny = rt.wildsGy + dy;
    rt.facing = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
    if (!inBounds(nx, ny)) return;
    const enemy = rt.wildsEnemies.find((e) => e.gx === nx && e.gy === ny && e.hp > 0);
    if (enemy) { hitPlayerContact(SPARK_WILDS_HIT); return; }
    if (isBlockedWildsTile(nx, ny)) return;
    rt.wildsFromX = rt.wildsGx; rt.wildsFromY = rt.wildsGy;
    rt.wildsGx = nx; rt.wildsGy = ny;
    rt.wildsToX = nx; rt.wildsToY = ny;
    rt.wildsMoveT = 0; rt.wildsMoveDur = rt.reducedMotion ? 40 : 150;
    sfx.step();
  }
  function findWildsInteraction() {
    const gx = rt.wildsGx, gy = rt.wildsGy;
    for (const n of neighbors4(gx, gy)) {
      if (!inBounds(n.x, n.y)) continue;
      const t = wildsTerrain[n.y][n.x];
      if (t === 'wshrine') { const trial = wildsTrialAt(n.x, n.y); if (trial) return { kind: 'trial', trial }; }
      if (t === 'glimmer') return { kind: 'gatherGlimmer' };
      if (t === 'treasure') {
        const id = `t_${n.x}_${n.y}`;
        if (!(state.wilds.treasuresFound || []).includes(id)) return { kind: 'treasure', tx: n.x, ty: n.y, id };
      }
    }
    for (const en of rt.wildsEnemies) {
      if (en.hp > 0 && Math.max(Math.abs(en.gx - gx), Math.abs(en.gy - gy)) <= 1 && !(en.gx === gx && en.gy === gy)) return { kind: 'attack', enemy: en };
    }
    return null;
  }
  function doWildsContextAction() {
    const it = findWildsInteraction();
    if (!it) return;
    if (it.kind === 'trial') openTrial(it.trial);
    else if (it.kind === 'gatherGlimmer') doGatherGlimmer();
    else if (it.kind === 'treasure') collectTreasure(it.tx, it.ty, it.id);
    else if (it.kind === 'attack') attackEnemy(it.enemy);
  }
  function doGatherGlimmer() {
    state.inventory.lumen = (state.inventory.lumen || 0) + 1;
    sfx.gather();
    spawnParticles(rt.wildsGx, rt.wildsGy, '#c792ea');
    toast('Found a glimmer of Lumen in the wilds!');
    updateHud();
    schedulePush();
  }
  function collectTreasure(tx, ty, id) {
    if ((state.wilds.treasuresFound || []).includes(id)) return;
    state.wilds.treasuresFound.push(id);
    wildsTerrain[ty][tx] = 'wgrass';
    const roll = Math.random();
    let msg;
    if (roll < 0.5) {
      const n = 1 + Math.floor(Math.random() * 2);
      const k = ['grain', 'shale', 'loom'][Math.floor(Math.random() * 3)];
      state.inventory[k] = (state.inventory[k] || 0) + n;
      msg = `Found ${n} ${RES_LABELS[k] || k} in a hidden cache!`;
    } else if (roll < 0.8) {
      state.inventory.lumen = (state.inventory.lumen || 0) + 1;
      msg = 'Found a hidden Lumen shard!';
    } else {
      const seeds = ['sunberryseed', 'moonwheatseed', 'glowgourdseed', 'stormcornseed', 'frostberryseed'];
      const s = seeds[Math.floor(Math.random() * seeds.length)];
      state.inventory[s] = (state.inventory[s] || 0) + 1;
      msg = `Found a rare ${RES_LABELS[s] || s}!`;
    }
    state.stats.treasuresFound = (state.stats.treasuresFound || 0) + 1;
    sfx.quest();
    spawnParticles(tx, ty, '#ffcf6b');
    toast(msg);
    updateHud();
    schedulePush();
  }
  function attackEnemy(enemy) {
    const now = Date.now();
    if (rt.lastAttackAt && now - rt.lastAttackAt < 260) return;
    rt.lastAttackAt = now;
    enemy.hp -= 1;
    spawnParticles(enemy.gx, enemy.gy, '#ff6b81');
    sfx.demolish();
    if (enemy.hp <= 0) {
      rt.wildsEnemies = rt.wildsEnemies.filter((e) => e !== enemy);
      state.stats.enemiesDefeated = (state.stats.enemiesDefeated || 0) + 1;
      if (enemy.isGuardian) {
        if (!state.wilds.guardianDefeated) {
          state.wilds.guardianDefeated = true;
          state.inventory.relic = (state.inventory.relic || 0) + 1;
          sfx.quest();
          toast('The Guardian falls — a Relic gleams where it stood!');
        }
      } else {
        const n = 1 + Math.floor(Math.random() * 2);
        const k = ['grain', 'shale', 'loom'][Math.floor(Math.random() * 3)];
        state.inventory[k] = (state.inventory[k] || 0) + n;
        if (Math.random() < 0.2) state.inventory.lumen = (state.inventory.lumen || 0) + 1;
        toast('The wilds creature scatters, dropping some resources.');
      }
    } else if (enemy.isGuardian && Math.random() < 0.5) {
      toast('The Guardian strikes back!');
      hitPlayerContact(Math.round(SPARK_WILDS_HIT / 2));
    } else {
      toast(`Hit! (${Math.max(0, enemy.hp)}/${enemy.maxHp})`);
    }
    updateHud();
    schedulePush();
  }
  function hitPlayerContact(amount) {
    const now = Date.now();
    if (rt.wildsInvulnUntil && now < rt.wildsInvulnUntil) return;
    rt.wildsInvulnUntil = now + 900;
    state.spark = clamp(state.spark - amount, 0, 100);
    sfx.fishMiss();
    spawnParticles(rt.wildsGx, rt.wildsGy, '#ff6b81');
    updateHud();
    if (state.spark <= 0) defeatedInWilds();
  }
  function defeatedInWilds() {
    toast('The wilds overwhelm you — you stumble back to town to rest.');
    exitWilds();
    state.spark = 30;
    updateHud();
    schedulePush();
  }
  function spawnWildsEnemies() {
    rt.wildsEnemies = [];
    let placed = 0, guard = 0;
    while (placed < 6 && guard < 400) {
      guard++;
      const x = Math.floor(Math.random() * GRID), y = Math.floor(Math.random() * GRID);
      if (Math.max(Math.abs(x - WILDS_ENTRANCE.x), Math.abs(y - WILDS_ENTRANCE.y)) < 3) continue;
      if (wildsTerrain[y][x] !== 'wgrass') continue;
      rt.wildsEnemies.push({ gx: x, gy: y, hp: 2, maxHp: 2, cooldown: Math.random() * 0.6, isGuardian: false, stationary: false });
      placed++;
    }
    if (!state.wilds.guardianDefeated && inBounds(GUARDIAN_TILE.x, GUARDIAN_TILE.y)) {
      rt.wildsEnemies.push({ gx: GUARDIAN_TILE.x, gy: GUARDIAN_TILE.y, hp: 6, maxHp: 6, cooldown: 0, isGuardian: true, stationary: true });
    }
  }
  function enterWilds() {
    if (rt.world === 'wilds') return;
    rt.world = 'wilds';
    rt.build.placing = false;
    rt.farmTool = null;
    rt.wildsGx = WILDS_ENTRANCE.x; rt.wildsGy = WILDS_ENTRANCE.y;
    rt.wildsFromX = rt.wildsGx; rt.wildsFromY = rt.wildsGy;
    rt.wildsToX = rt.wildsGx; rt.wildsToY = rt.wildsGy;
    rt.wildsMoveT = 1;
    rt.wildsInvulnUntil = 0;
    const p0 = tileToScreen(rt.wildsGx, rt.wildsGy);
    rt.wildsPx = p0.x; rt.wildsPy = p0.y;
    spawnWildsEnemies();
    closePanels();
    toast('You step into the wilds. Watch your Spark — leave anytime from the HUD.');
    updateHud();
  }
  function exitWilds() {
    if (rt.world !== 'wilds') return;
    rt.world = 'town';
    rt.wildsEnemies = [];
    toast('Back in town, safe and sound.');
    updateHud();
  }
  function stepWildsEnemies(dt) {
    if (rt.world !== 'wilds') return;
    for (const en of rt.wildsEnemies) {
      if (en.stationary) continue;
      en.cooldown -= dt;
      if (en.cooldown > 0) continue;
      en.cooldown = 0.8 + Math.random() * 0.6;
      const dist = Math.max(Math.abs(en.gx - rt.wildsGx), Math.abs(en.gy - rt.wildsGy));
      let dx = 0, dy = 0;
      if (dist <= 3 && Math.random() < 0.7) {
        dx = Math.sign(rt.wildsGx - en.gx); dy = Math.sign(rt.wildsGy - en.gy);
        if (dx !== 0 && dy !== 0) { if (Math.random() < 0.5) dy = 0; else dx = 0; }
      } else if (Math.random() < 0.4) {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const d = dirs[Math.floor(Math.random() * 4)];
        dx = d[0]; dy = d[1];
      }
      if (dx === 0 && dy === 0) continue;
      const nx = en.gx + dx, ny = en.gy + dy;
      if (nx === rt.wildsGx && ny === rt.wildsGy) { hitPlayerContact(SPARK_WILDS_HIT); continue; }
      if (!inBounds(nx, ny) || isBlockedWildsTile(nx, ny)) continue;
      if (rt.wildsEnemies.some((o) => o !== en && o.gx === nx && o.gy === ny)) continue;
      en.gx = nx; en.gy = ny;
    }
  }
  function stepWildsMoveInterp(dt) {
    if (rt.wildsMoveT < 1) rt.wildsMoveT = Math.min(1, rt.wildsMoveT + dt * 1000 / (rt.wildsMoveDur || 150));
    const fx = tileToScreen(rt.wildsFromX, rt.wildsFromY), tx = tileToScreen(rt.wildsToX, rt.wildsToY);
    const e = rt.wildsMoveT;
    rt.wildsPx = fx.x + (tx.x - fx.x) * e;
    rt.wildsPy = fx.y + (tx.y - fx.y) * e;
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
    // Farm plot fertility/dry-streak follow the exact same shared pattern as
    // the rest of the farm row (see currentFarm()) — physical world state,
    // host-authoritative, guest placements stay local. Livestock/friendship/
    // tools/wilds progress are deliberately NOT here: they're per-player
    // local (see the comments on state.livestock's feed/collect lookup,
    // defaultFriendshipState, and state.wilds in newGame()).
    const compactFarm = state.farm.map((p) => ({ x: p.x, y: p.y, crop: p.crop || null, prog: Math.round(p.prog || 0), watered: !!p.watered, dryStreak: p.dryStreak || 0, fertileUntilDay: p.fertileUntilDay || 0 }));
    host('match-action', { action: { town: compactTown, farm: compactFarm, seed: state.seed, openBuilding: mp.openBuilding, hostProbe: mp.pendingNonce || mp.confirmedNonce || null }, mode: 'merge' });
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
    wildsTerrain = genWildsTerrain(state.seed);
    clearFoundWildsTreasures();
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
    if (Array.isArray(ms.farm)) {
      mp.sharedFarm = ms.farm
        .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.crop == null || CROP_BY_KEY[p.crop]))
        .map((p) => ({ x: clamp(Math.floor(p.x), 0, GRID - 1), y: clamp(Math.floor(p.y), 0, GRID - 1), crop: p.crop || null, prog: Number.isFinite(p.prog) ? Math.max(0, p.prog) : 0, watered: !!p.watered, dryStreak: Number.isFinite(p.dryStreak) ? p.dryStreak : 0, fertileUntilDay: Number.isFinite(p.fertileUntilDay) ? p.fertileUntilDay : 0 }));
    }
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
    const seg = daySegment(state.minutes);
    el.clock.textContent = `Day ${state.day} · ${formatClock(state.minutes)}`;
    el.clockNote.textContent = `${seg[0].toUpperCase() + seg.slice(1)} · ${SEASON_LABEL[seasonOf(state.day)]}${rt.world === 'wilds' ? ' · In the Wilds' : ''}`;
    el.spark.style.width = `${clamp(state.spark, 0, 100)}%`;
    el.resGrain.textContent = state.inventory.grain || 0;
    el.resShale.textContent = state.inventory.shale || 0;
    el.resLoom.textContent = state.inventory.loom || 0;
    el.resFish.textContent = state.inventory.driftfish || 0;
    el.togetherBtn.hidden = !mp.active;
    if (el.returnHome) el.returnHome.hidden = rt.world !== 'wilds';
    const it = (rt.build.placing || rt.farmTool) ? null : findInteraction();
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
  const TERRAIN_COLOR = { grass: '#3a6b4a', trail: '#9f7f58', grove: '#2f7a4d', quarry: '#7b7f8c', reed: '#7fae59', water: '#3f8ec9', shrine: '#5b4aa8', gate: '#2f2448', trailhead: '#caa06a' };
  function drawTerrainTile(gx, gy, t) {
    const s = tileToScreen(gx, gy);
    const top = t === 'grass' ? SEASON_GRASS[seasonOf(state.day)] : (TERRAIN_COLOR[t] || TERRAIN_COLOR.grass);
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
    if (t === 'trailhead') {
      drawBlock(s.x, s.y, rt.tileW * 0.5, rt.tileH * 0.5, rt.tileH * 1.2, shade(top, 1.2), shade(top, 0.72), shade(top, 0.5));
      ctx.save();
      ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 2 * rt.dpr; ctx.globalAlpha = 0.7 + 0.2 * Math.sin(performance.now() / 400 + gx);
      ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 1.6, rt.tileH * 0.32, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  function drawPiece(piece, unsynced) {
    const def = PALETTE_BY_TYPE[piece.type];
    if (!def) return;
    const s = tileToScreen(piece.gx, piece.gy);
    const hgt = def.blocking ? rt.tileH * (TALL_PIECES[piece.type] || 1.0) : rt.tileH * 0.18;
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
    if (piece.type === 'coop') {
      const l = currentLivestock().find((x) => x.pieceId === piece.id);
      if (l && l.readyToCollect) {
        ctx.save(); ctx.globalAlpha = 0.7 + 0.2 * Math.sin(performance.now() / 300);
        ctx.fillStyle = '#ffe98a';
        ctx.beginPath(); ctx.arc(s.x, s.y - hgt - rt.tileH * 0.6, rt.tileH * 0.22, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    if (unsynced) {
      // Marks a guest's own local-only placement that hasn't (and, under the
      // current room protocol, structurally can't) sync out to the shared town.
      ctx.save(); ctx.fillStyle = '#ffcf6b'; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(s.x, s.y - hgt - rt.tileH * 1.3, 3 * rt.dpr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  function drawFarmPlot(plot, guestLocal) {
    const s = tileToScreen(plot.x, plot.y);
    // soil bed: darker when watered
    drawDiamond(s.x, s.y, rt.tileW * 0.92, rt.tileH * 0.92, plot.watered ? '#4a3324' : '#6d4c33', 'rgba(0,0,0,0.25)');
    ctx.save();
    ctx.globalAlpha = 0.35;
    drawDiamond(s.x, s.y, rt.tileW * 0.55, rt.tileH * 0.55, plot.watered ? '#3a2719' : '#5b3e28', null);
    ctx.restore();
    if (plot.crop && CROP_BY_KEY[plot.crop]) {
      const c = CROP_BY_KEY[plot.crop];
      const stage = cropStage(plot);
      const stageColor = stage === 0 ? '#8fd97f' : stage === 1 ? '#66b45e' : stage === 2 ? shade(c.color, 0.8) : c.color;
      const w = rt.tileW * (0.2 + stage * 0.07);
      const hgt = rt.tileH * (0.35 + stage * 0.35);
      drawBlock(s.x, s.y, w, w / 2, hgt, stageColor, shade(stageColor, 0.7), shade(stageColor, 0.5));
      if (stage >= 3) {
        // ready-to-harvest sparkle, same gentle pulse language as the shrines
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.2 * Math.sin(performance.now() / 320 + plot.x + plot.y);
        ctx.fillStyle = '#ffe98a';
        ctx.beginPath(); ctx.arc(s.x, s.y - hgt - rt.tileH * 0.4, rt.tileH * 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    if (guestLocal) {
      // Same gold-dot marker as guest-local build pieces: this plot is a local
      // preview that can't sync into the host's shared farm under the protocol.
      ctx.save(); ctx.fillStyle = '#ffcf6b'; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 1.2, 3 * rt.dpr, 0, Math.PI * 2); ctx.fill();
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
    if (rt.world === 'wilds') { drawWilds(); return; }
    const sky = skyColors(state.minutes);
    const grad = ctx.createLinearGradient(0, 0, 0, rt.H);
    grad.addColorStop(0, sky.top); grad.addColorStop(1, sky.hor);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, rt.W, rt.H);
    drawAmbience();

    // draw order: terrain back-to-front, then pieces+npcs+player interleaved by depth
    const drawables = [];
    for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
      drawables.push({ depth: gx + gy, kind: 'terrain', gx, gy });
    }
    for (const plot of currentFarm()) {
      // Guests' own tilled rows are local previews (same rule as guest builds).
      const guestLocal = mp.active && !mp.amIHost && state.farm.includes(plot);
      drawables.push({ depth: plot.x + plot.y + 0.3, kind: 'plot', plot, guestLocal });
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
      if (d.kind === 'plot') drawFarmPlot(d.plot, d.guestLocal);
      else if (d.kind === 'piece') drawPiece(d.piece, d.guestLocal);
      else if (d.kind === 'npc') {
        const n = d.npc;
        drawCharacter(n.screenPx, n.screenPy, n.hue, 'none', 'rgba(255,255,255,0.35)', n.name.split(' ')[0]);
      } else if (d.kind === 'player') {
        drawCharacter(rt.playerPx, rt.playerPy, hueColorOf(state.player.hue), state.player.topper, trimColorOf(state.player.trim), null);
      }
    }

    // build / farm placement ghost
    if ((rt.build.placing || rt.farmTool) && rt.build.hoverTile) {
      const hx = rt.build.hoverTile.x, hy = rt.build.hoverTile.y;
      const ok = rt.farmTool
        ? (rt.farmTool.mode === 'till' ? canTillAt(hx, hy) : canPlantAt(hx, hy))
        : isBuildableGround(hx, hy);
      const s = tileToScreen(hx, hy);
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

  // Wilds render pass — a distinct frame kept parallel to draw() rather than
  // interleaved with it, so the well-tested town rendering path above is
  // untouched. Reuses the same sky/particle/vignette/pause conventions so it
  // still reads as "CubeTown", just a wilder corner of it.
  function drawWilds() {
    const sky = skyColors(state.minutes);
    const grad = ctx.createLinearGradient(0, 0, 0, rt.H);
    grad.addColorStop(0, sky.top); grad.addColorStop(1, sky.hor);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, rt.W, rt.H);
    ctx.save(); ctx.fillStyle = 'rgba(20,4,28,0.22)'; ctx.fillRect(0, 0, rt.W, rt.H); ctx.restore();
    drawAmbience();

    const drawables = [];
    for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) drawables.push({ depth: gx + gy, kind: 'wterrain', gx, gy });
    for (const en of rt.wildsEnemies) drawables.push({ depth: en.gx + en.gy + 0.4, kind: 'enemy', enemy: en });
    drawables.push({ depth: rt.wildsGx + rt.wildsGy + 0.6, kind: 'wplayer' });
    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) if (d.kind === 'wterrain') drawWildsTile(d.gx, d.gy, wildsTerrain[d.gy][d.gx]);
    for (const d of drawables) {
      if (d.kind === 'enemy') drawEnemy(d.enemy);
      else if (d.kind === 'wplayer') drawCharacter(rt.wildsPx, rt.wildsPy, hueColorOf(state.player.hue), state.player.topper, trimColorOf(state.player.trim), null);
    }

    for (const p of rt.particles) {
      ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2 * rt.dpr, p.y - 2 * rt.dpr, 4 * rt.dpr, 4 * rt.dpr);
      ctx.restore();
    }

    if (state.spark < 25) {
      const vg = ctx.createRadialGradient(rt.W / 2, rt.H / 2, rt.H * 0.2, rt.W / 2, rt.H / 2, rt.H * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(60,0,10,${(25 - state.spark) / 50})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, rt.W, rt.H);
    }
    if (rt.paused) { ctx.fillStyle = 'rgba(10,6,20,0.45)'; ctx.fillRect(0, 0, rt.W, rt.H); }
  }
  const WILDS_TILE_COLOR = { wgrass: '#3a5a3a', thicket: '#2c4a2f', crag: '#6b6a70', glimmer: '#5b4aa8', wshrine: '#8f7fff', treasure: '#caa06a' };
  function drawWildsTile(gx, gy, t) {
    const s = tileToScreen(gx, gy);
    const top = t === 'wgrass' ? SEASON_WGRASS[seasonOf(state.day)] : (WILDS_TILE_COLOR[t] || WILDS_TILE_COLOR.wgrass);
    drawDiamond(s.x, s.y, rt.tileW, rt.tileH, top, 'rgba(0,0,0,0.22)');
    if (t === 'thicket' || t === 'crag') {
      drawBlock(s.x, s.y, rt.tileW * 0.4, rt.tileH * 0.4, rt.tileH * (t === 'thicket' ? 1.3 : 0.9), shade(top, 1.2), shade(top, 0.7), shade(top, 0.5));
    }
    if (t === 'glimmer') {
      ctx.save(); ctx.globalAlpha = 0.5 + 0.2 * Math.sin(performance.now() / 280 + gx + gy);
      ctx.fillStyle = '#c792ea';
      ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 0.9, rt.tileH * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (t === 'wshrine') {
      const trial = wildsTrialAt(gx, gy);
      const done = trial && state.adventure?.trials?.[trial.id]?.done;
      drawBlock(s.x, s.y, rt.tileW * 0.58, rt.tileH * 0.58, rt.tileH * 1.6, done ? '#5be3b5' : '#8f7fff', '#34255b', '#211638');
    }
    if (t === 'treasure') {
      ctx.save(); ctx.globalAlpha = 0.6 + 0.2 * Math.sin(performance.now() / 240 + gx);
      ctx.fillStyle = '#ffcf6b';
      ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 0.6, rt.tileH * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  function drawEnemy(en) {
    const s = tileToScreen(en.gx, en.gy);
    const color = en.isGuardian ? '#ff6b4a' : '#ff6b81';
    drawBlock(s.x, s.y, rt.tileW * 0.5, rt.tileH * 0.5, rt.tileH * (en.isGuardian ? 1.4 : 0.9), shade(color, 1.15), shade(color, 0.7), shade(color, 0.5));
    ctx.save();
    ctx.fillStyle = '#fbe9d8'; ctx.font = `700 ${9 * rt.dpr}px ui-monospace,monospace`; ctx.textAlign = 'center';
    ctx.fillText(`${Math.max(0, en.hp)}/${en.maxHp}`, s.x, s.y - rt.tileH * (en.isGuardian ? 2.2 : 1.6));
    ctx.restore();
  }

  function drawAmbience() {
    if (rt.reducedMotion) return;
    if (!rt.ambience.length) {
      for (let i = 0; i < 28; i++) rt.ambience.push({
        x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2,
        size: 1.5 + Math.random() * 2.4, drift: 0.7 + Math.random() * 1.8,
      });
    }
    const night = state.minutes < 360 || state.minutes > 1120;
    const dusk = state.minutes > 980 || state.minutes < 480;
    if (!night && !dusk) return;
    const t = rt.playSecondsAccum;
    ctx.save();
    for (const f of rt.ambience) {
      const x = ((f.x + Math.sin(t * 0.025 * f.drift + f.phase) * 0.02) % 1) * rt.W;
      const y = ((f.y + Math.cos(t * 0.018 * f.drift + f.phase) * 0.018) % 1) * rt.H;
      const a = (night ? 0.55 : 0.22) + Math.sin(t * 2.2 + f.phase) * 0.18;
      ctx.globalAlpha = Math.max(0.05, a);
      ctx.shadowBlur = 12 * rt.dpr; ctx.shadowColor = '#ffe98a';
      ctx.fillStyle = '#fff2a8';
      ctx.beginPath(); ctx.arc(x, y, f.size * rt.dpr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
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
    pollGamepad();
    if (!rt.paused && !anyPanelOpenBlocking()) {
      const dtMinutes = (dt * 1000) * (1440 / DAY_LENGTH_MS);
      state.minutes += dtMinutes;
      if (state.minutes >= 1440) { state.minutes -= 1440; state.day += 1; farmNewDay(); }
      state.stats.secondsPlayed += dt;
      rt.playSecondsAccum += dt;
      stepMoveInterp(dt);
      stepWildsMoveInterp(dt);
      stepWildsEnemies(dt);
      stepNpcs(dt);
      stepGatherCook(dt);
      stepFarm(dtMinutes);
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
      player: state.player, inventory: state.inventory, spark: state.spark, town: state.town, farm: state.farm,
      livestock: state.livestock,
      quests: state.quests, adventure: state.adventure, cosmeticsUnlocked: state.cosmeticsUnlocked, tutorialSeen: state.tutorialSeen,
      stats: state.stats, completedMilestone: state.completedMilestone,
      tools: state.tools, friendship: state.friendship, wilds: state.wilds,
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
    if (typeof s.seed === 'number') { state.seed = s.seed >>> 0; terrain = genTerrain(state.seed); wildsTerrain = genWildsTerrain(state.seed); }
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
    if (Array.isArray(s.farm)) {
      const seenPlots = new Set();
      state.farm = s.farm.filter((p) => p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => ({
          x: clamp(Math.floor(p.x), 0, GRID - 1), y: clamp(Math.floor(p.y), 0, GRID - 1),
          crop: (typeof p.crop === 'string' && CROP_BY_KEY[p.crop]) ? p.crop : null,
          prog: Number.isFinite(p.prog) ? Math.max(0, p.prog) : 0,
          watered: !!p.watered,
          // Missing on any save from before fertilizer/wilting shipped — 0 is
          // the correct, safe default (not fertilized, no dry streak yet).
          dryStreak: Number.isFinite(p.dryStreak) ? Math.max(0, Math.floor(p.dryStreak)) : 0,
          fertileUntilDay: Number.isFinite(p.fertileUntilDay) ? Math.max(0, Math.floor(p.fertileUntilDay)) : 0,
        }))
        .filter((p) => {
          const key = `${p.x},${p.y}`;
          if (seenPlots.has(key)) return false;
          seenPlots.add(key);
          return true;
        });
    }
    if (Array.isArray(s.livestock)) {
      state.livestock = s.livestock.filter((l) => l && typeof l === 'object' && typeof l.pieceId === 'string' && state.town.some((p) => p.id === l.pieceId))
        .map((l) => ({ id: String(l.id || `l${pieceIdCounter++}`), pieceId: l.pieceId, gx: Number.isFinite(l.gx) ? l.gx : 0, gy: Number.isFinite(l.gy) ? l.gy : 0, fedToday: !!l.fedToday, readyToCollect: !!l.readyToCollect }));
    } else {
      // Old saves never had livestock at all — keep it empty rather than undefined.
      state.livestock = Array.isArray(state.livestock) ? state.livestock : [];
    }
    if (s.quests && typeof s.quests === 'object') {
      for (const k of Object.keys(state.quests)) if (s.quests[k] && typeof s.quests[k] === 'object') state.quests[k].done = !!s.quests[k].done;
    }
    const defaultAdventure = defaultAdventureState();
    state.adventure = state.adventure || defaultAdventure;
    if (s.adventure && typeof s.adventure === 'object') {
      state.adventure.gateOpen = !!s.adventure.gateOpen;
      if (s.adventure.trials && typeof s.adventure.trials === 'object') {
        // ALL_TRIAL_DEFS covers both the original town shrines and the newer
        // Wilds trials — an old save's adventure.trials simply lacks the
        // wilds ids, so they fall through to the {done:false} default below.
        for (const trial of ALL_TRIAL_DEFS) {
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
    // Tools/friendship/wilds are all brand-new top-level fields; state.tools /
    // state.friendship / state.wilds already hold newGame()'s safe defaults at
    // this point, so an old save (missing these entirely) simply keeps them.
    if (s.tools && typeof s.tools === 'object' && [1, 2, 3].includes(s.tools.gatherTier)) {
      state.tools.gatherTier = s.tools.gatherTier;
    }
    if (s.friendship && typeof s.friendship === 'object') {
      for (const npc of NPC_DEFS) {
        const fs = s.friendship[npc.id];
        if (fs && typeof fs === 'object') {
          state.friendship[npc.id] = {
            points: Number.isFinite(fs.points) ? Math.max(0, fs.points) : 0,
            lastChatDay: Number.isFinite(fs.lastChatDay) ? fs.lastChatDay : 0,
            claimed: Array.isArray(fs.claimed) ? fs.claimed.filter((x) => typeof x === 'number') : [],
          };
        }
      }
    }
    if (s.wilds && typeof s.wilds === 'object') {
      state.wilds.treasuresFound = Array.isArray(s.wilds.treasuresFound) ? s.wilds.treasuresFound.filter((x) => typeof x === 'string') : [];
      state.wilds.guardianDefeated = !!s.wilds.guardianDefeated;
    }
    state.completedMilestone = !!(s.completedMilestone && state.adventure.gateOpen);
    // Re-clear any already-looted Wilds treasure tiles now that
    // state.wilds.treasuresFound reflects the just-loaded save (a seed change
    // above regenerates wildsTerrain from scratch, which would otherwise make
    // previously-found treasure glow again).
    clearFoundWildsTreasures();
    npcs = buildNpcRuntime();
    for (const npc of npcs) npc.quest.done = state.quests[npc.id] ? state.quests[npc.id].done : false;
    rt.playerToX = state.player.gx; rt.playerToY = state.player.gy;
    rt.playerFromX = rt.playerToX; rt.playerFromY = rt.playerToY; rt.moveT = 1;
    // A loaded/restored save always resumes in town — the Wilds are a
    // runtime-only visit that never persists (see the comment on rt.world).
    rt.world = 'town';
    rt.wildsEnemies = [];
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
    if (anyPanelOpen() && !rt.build.placing && !rt.farmTool) return;
    const pt = canvasPointFromEvent(evt);
    const tile = screenToTile(pt.x, pt.y);
    if (!inBounds(tile.x, tile.y)) return;
    if (rt.world === 'wilds') {
      const dx = tile.x - rt.wildsGx, dy = tile.y - rt.wildsGy;
      if (Math.abs(dx) + Math.abs(dy) === 1) tryMoveWilds(dx, dy);
      else if (dx === 0 && dy === 0) doContextAction();
      return;
    }
    if (rt.farmTool) {
      // Farm tools stay armed (like Demolish) so rows can be worked tile by
      // tile; Esc, B, or the ● action button puts them away.
      farmTapAt(tile.x, tile.y);
      return;
    }
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
    if (!rt.build.placing && !rt.farmTool) return;
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
      if (rt.farmTool) { rt.farmTool = null; toast('Farm tools put away.'); updateHud(); return; }
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
    else if (k === 'f') openPanel('farming');
    else if (k === 'c') openPanel('craft');
  });

  // ---------------------------------------------------------------------
  // Gamepad input (Standard layout — DualSense/DualShock/Xbox alike)
  // Left stick / d-pad = movement, A/Cross = interact, B/Circle = cancel,
  // Start = pause. Movement is edge-triggered per press, exactly like the
  // keydown handler above (tryMove is a discrete single-tile step, so a
  // held direction must not repeat every frame).
  // ---------------------------------------------------------------------
  function gpPad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected !== false) return p;
    return null;
  }
  function pollGamepad() {
    if (!rt.gpEnabled) return;
    const pad = gpPad();
    if (!pad) return;
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const AXIS_DEAD = 0.5;
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    const dir = {
      up: btn(12) || ay < -AXIS_DEAD,
      down: btn(13) || ay > AXIS_DEAD,
      left: btn(14) || ax < -AXIS_DEAD,
      right: btn(15) || ax > AXIS_DEAD,
    };
    const a = btn(0), b = btn(1), start = btn(9);

    // Start toggles pause regardless of open panels, mirroring the on-screen Pause button.
    if (start && !rt.gp.prevStart) setPaused(!rt.paused);
    rt.gp.prevStart = start;

    // B cancels an in-progress placement or closes an open panel, mirroring Escape.
    if (b && !rt.gp.prevB) {
      if (rt.farmTool) { rt.farmTool = null; toast('Farm tools put away.'); updateHud(); }
      else if (rt.build.placing) { rt.build.placing = false; toast('Placement canceled.'); updateHud(); }
      else if (anyPanelOpen()) closePanels();
    }
    rt.gp.prevB = b;

    // A mirrors Space/E: catches fish while the fishing panel is open,
    // otherwise triggers the context action — same gating as the keydown handler.
    if (a && !rt.gp.prevA) {
      if (anyPanelOpen()) { if (rt.fishing.open) fishCatch(); }
      else if (!rt.paused) doContextAction();
    }
    rt.gp.prevA = a;

    if (!anyPanelOpen() && !rt.paused) {
      if (dir.up && !rt.gp.prevDir.up) tryMove(0, -1);
      if (dir.down && !rt.gp.prevDir.down) tryMove(0, 1);
      if (dir.left && !rt.gp.prevDir.left) tryMove(-1, 0);
      if (dir.right && !rt.gp.prevDir.right) tryMove(1, 0);
    }
    rt.gp.prevDir = dir;
  }

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
  if (el.returnHome) el.returnHome.onclick = () => { unlockAudio(); exitWilds(); };

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
      rt.gpEnabled = !!d.gamepad;
    } else if (d.type === 'pause') {
      setPaused(true);
    } else if (d.type === 'resume') {
      setPaused(false);
    } else if (d.type === 'exit') {
      pushProgress();
    } else if (d.type === 'restart') {
      newGame((Math.random() * 1e9) >>> 0);
      closePanels();
      rt.world = 'town';
      rt.wildsEnemies = [];
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
