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
  // `let` (not const): drawing helpers all target this binding, so the cached
  // terrain-layer rebuild can temporarily retarget them at an offscreen canvas.
  let ctx = canvas.getContext('2d');
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
    dlgParty: $('[data-ct-dlg-party]'),
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
    partySub: $('[data-ct-party-sub]'),
    partyList: $('[data-ct-party-list]'),
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
    minimap: $('[data-ct-minimap]'),
    worldMap: $('[data-ct-world-map]'),
    mapSub: $('[data-ct-map-sub]'),
    mapLocation: $('[data-ct-map-location]'),
    mapCoords: $('[data-ct-map-coords]'),
    mapLandmarks: $('[data-ct-map-landmarks]'),
    location: $('[data-ct-location]'),
    navNote: $('[data-ct-nav-note]'),
    weather: $('[data-ct-weather]'),
    statDiscovered: $('[data-ct-stat-discovered]'),
    statCaches: $('[data-ct-stat-caches]'),
  };

  // ---------------------------------------------------------------------
  // Constants: world, resources, palette, npcs, cosmetics
  // ---------------------------------------------------------------------
  const GRID = 17;
  const WORLD_SIZE = 128;
  const WORLD_MIN = 8 - WORLD_SIZE / 2;
  const WORLD_MAX = WORLD_MIN + WORLD_SIZE - 1;
  const CHUNK_SIZE = 16;
  const MAX_CHUNK_CACHE = 36;
  const HOME_TILE = { x: 8, y: 8 };
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

  // RPG party layer: companions are not captured monsters. They are small
  // town allies who join through friendship/quests and assist in Wilds fights.
  const COMPANION_DEFS = [
    { id: 'pebbleguard', npcId: 'miro', name: 'Pebbleguard', short: 'Peb', color: '#f2a65a', glyph: '◆', role: 'Shield mason', power: 1, guard: 3, trait: 'Blocks part of incoming Wilds damage and chips enemy armor.' },
    { id: 'threadfox', npcId: 'tally', name: 'Threadfox', short: 'Fox', color: '#c792ea', glyph: '✦', role: 'Quick scout', power: 1, guard: 1, trait: 'Dashes in for fast follow-up hits.' },
    { id: 'tideotter', npcId: 'bo', name: 'Tide Otter', short: 'Tide', color: '#4fd1e8', glyph: '≈', role: 'Field medic', power: 1, guard: 2, heal: 6, trait: 'Splashes enemies and restores Spark after wins.' },
    { id: 'embercub', npcId: 'runa', name: 'Ember Cub', short: 'Cub', color: '#ff6b4a', glyph: '▲', role: 'Trail striker', power: 2, guard: 0, trait: 'Adds heavy strike damage in the Wilds.' },
    { id: 'sprigdoe', npcId: 'ivy', name: 'Sprig Doe', short: 'Sprig', color: '#78d36f', glyph: '☘', role: 'Root healer', power: 1, guard: 2, heal: 8, trait: 'Roots danger and helps recover Spark.' },
    { id: 'gatewisp', npcId: 'fenn', name: 'Gate Wisp', short: 'Wisp', color: '#9bb3d6', glyph: '◎', role: 'Ward guide', power: 1, guard: 4, trait: 'Raises party guard near guardian fights.' },
    { id: 'mapmoth', npcId: 'nova', name: 'Map Moth', short: 'Moth', color: '#b8c8ff', glyph: '◇', role: 'Pathfinder', power: 1, guard: 1, trait: 'Finds weak points and keeps fights moving.' },
    { id: 'relicowl', npcId: 'ori', name: 'Relic Owl', short: 'Owl', color: '#8f7fff', glyph: '◈', role: 'Arcane striker', power: 2, guard: 1, trait: 'Hits hard after relic bonds awaken.' },
    { id: 'seedgolem', npcId: 'sage', name: 'Seed Golem', short: 'Seed', color: '#b6e26f', glyph: '●', role: 'Garden bruiser', power: 1, guard: 3, heal: 4, trait: 'Turns farm energy into steady battle support.' },
  ];
  const COMPANION_BY_ID = Object.fromEntries(COMPANION_DEFS.map((c) => [c.id, c]));
  const COMPANION_BY_NPC = Object.fromEntries(COMPANION_DEFS.map((c) => [c.npcId, c]));
  const PARTY_LIMIT = 3;

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

  // The original 17x17 district remains byte-for-byte compatible in world
  // coordinates 0..16. Around it is a 128x128 region (56.7x the playable
  // area) streamed in deterministic 16x16 chunks. Fixed destinations anchor
  // the procedural country so roads and exploration have a readable purpose.
  const BIOME_DEFS = {
    hearthland: { label: 'Hearthward Vale', ground: '#4f7c4b', map: '#668e58' },
    meadow: { label: 'Windmeadow', ground: '#5d8d53', map: '#78a966' },
    forest: { label: 'Mosswood', ground: '#3f7048', map: '#426f47' },
    highlands: { label: 'Cloudbreak Ridge', ground: '#69746c', map: '#778079' },
    wetlands: { label: 'Reedglass Fen', ground: '#52765d', map: '#548072' },
    sunfields: { label: 'Amber Prairie', ground: '#878348', map: '#a49b52' },
    frostwood: { label: 'Frostbell Wood', ground: '#69848a', map: '#789ca4' },
  };
  const BIOME_REWARDS = {
    meadow: { sunberryseed: 1 }, forest: { grain: 2 }, highlands: { shale: 2 },
    wetlands: { loom: 2 }, sunfields: { stormcornseed: 1 }, frostwood: { frostberryseed: 1 },
  };
  const WORLD_POIS = [
    { id: 'hearthward', name: 'Hearthward', kind: 'home', x: 8, y: 8, biome: 'hearthland', reward: null },
    { id: 'mossmere', name: 'Mossmere Village', kind: 'settlement', x: -34, y: -27, biome: 'forest', reward: { grain: 5, sunberryseed: 2 } },
    { id: 'stonecross', name: 'Stonecross', kind: 'settlement', x: 48, y: -31, biome: 'highlands', reward: { shale: 5, ingot: 1 } },
    { id: 'tidewharf', name: 'Tidelantern Wharf', kind: 'settlement', x: -39, y: 41, biome: 'wetlands', reward: { driftfish: 2, loom: 3 } },
    { id: 'sunstep', name: 'Sunstep Farm', kind: 'farm', x: 43, y: 39, biome: 'sunfields', reward: { grain: 4, stormcornseed: 2 } },
    { id: 'frostbell', name: 'Frostbell Observatory', kind: 'landmark', x: 7, y: -48, biome: 'frostwood', reward: { frostberryseed: 2, lumen: 1 } },
    { id: 'reedglass', name: 'Reedglass Sanctuary', kind: 'landmark', x: -47, y: 5, biome: 'wetlands', reward: { loom: 3, glowgourdseed: 1 } },
    { id: 'starfall', name: 'Starfall Mesa', kind: 'landmark', x: 57, y: 8, biome: 'highlands', reward: { shale: 3, lumen: 1 } },
  ];
  const WORLD_POI_BY_ID = Object.fromEntries(WORLD_POIS.map((poi) => [poi.id, poi]));
  const WORLD_ROUTES = [
    [{ x: 8, y: 8 }, { x: 8, y: 7 }, { x: -34, y: 7 }, { x: -34, y: -27 }],
    [{ x: 8, y: 8 }, { x: 16, y: 8 }, { x: 48, y: 8 }, { x: 48, y: -31 }],
    [{ x: 8, y: 8 }, { x: 8, y: 16 }, { x: 8, y: 41 }, { x: -39, y: 41 }],
    [{ x: 8, y: 8 }, { x: 16, y: 8 }, { x: 43, y: 8 }, { x: 43, y: 39 }],
    [{ x: 8, y: 7 }, { x: 7, y: 7 }, { x: 7, y: -48 }],
    [{ x: 0, y: 7 }, { x: -47, y: 7 }, { x: -47, y: 5 }],
    [{ x: 16, y: 8 }, { x: 57, y: 8 }],
  ];
  const SETTLEMENT_RESIDENTS = [
    { id: 'pippa', name: 'Pippa', poi: 'mossmere', dx: 0, dy: 2, hue: '#dc7f71', line: 'The moss paths remember every season. I like that about them.' },
    { id: 'cal', name: 'Cal', poi: 'stonecross', dx: -2, dy: 0, hue: '#7196c8', line: 'Stonecross keeps its doors open for builders with dust on their sleeves.' },
    { id: 'nell', name: 'Nell', poi: 'tidewharf', dx: 2, dy: 0, hue: '#52b7b0', line: 'The tide road looks long on a map, but the lanterns make it feel close.' },
    { id: 'sol', name: 'Sol', poi: 'sunstep', dx: 0, dy: -2, hue: '#dca64d', line: 'Our field rows are old, but every harvest makes them new again.' },
    { id: 'wren', name: 'Wren', poi: 'frostbell', dx: 1, dy: 2, hue: '#8f91d8', line: 'On clear nights, the whole region fits between two stars.' },
    { id: 'mina', name: 'Mina', poi: 'reedglass', dx: 0, dy: 2, hue: '#62a275', line: 'Walk softly here. Even the reeds have stories in progress.' },
    { id: 'kit', name: 'Kit', poi: 'starfall', dx: -1, dy: 2, hue: '#c97878', line: 'The mesa hums after dusk. No one agrees on the tune.' },
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
  function inLegacyBounds(x, y) { return x >= 0 && y >= 0 && x < GRID && y < GRID; }
  function inBounds(x, y) { return x >= WORLD_MIN && y >= WORLD_MIN && x <= WORLD_MAX && y <= WORLD_MAX; }
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
      for (const n of neighbors4(trial.tile.x, trial.tile.y)) if (inLegacyBounds(n.x, n.y) && !isCore(n.x, n.y)) grid[n.y][n.x] = 'grass';
    }
    grid[GATE_TILE.y][GATE_TILE.x] = 'gate';
    for (const n of neighbors4(GATE_TILE.x, GATE_TILE.y)) if (inLegacyBounds(n.x, n.y)) grid[n.y][n.x] = 'grass';
    grid[TRAILHEAD_TILE.y][TRAILHEAD_TILE.x] = 'trailhead';
    for (const n of neighbors4(TRAILHEAD_TILE.x, TRAILHEAD_TILE.y)) if (inLegacyBounds(n.x, n.y)) grid[n.y][n.x] = 'grass';
    for (let i = 2; i <= 14; i += 2) {
      if (grid[8][i] === 'grass') grid[8][i] = 'trail';
      if (grid[i][8] === 'grass') grid[i][8] = 'trail';
    }
    // Three guaranteed roads connect the preserved district to the larger
    // country. The west route skirts the existing Wilds trailhead at 0,8.
    for (let x = 0; x <= 8; x++) if (!isLandmark(x, 7)) grid[7][x] = 'trail';
    grid[8][16] = 'trail';
    grid[16][8] = 'trail';
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
      for (const n of neighbors4(trial.tile.x, trial.tile.y)) if (inLegacyBounds(n.x, n.y)) grid[n.y][n.x] = 'wgrass';
    }
    grid[WILDS_ENTRANCE.y][WILDS_ENTRANCE.x] = 'wgrass';
    for (const n of neighbors4(WILDS_ENTRANCE.x, WILDS_ENTRANCE.y)) if (inLegacyBounds(n.x, n.y)) grid[n.y][n.x] = 'wgrass';
    if (inLegacyBounds(GUARDIAN_TILE.x, GUARDIAN_TILE.y)) grid[GUARDIAN_TILE.y][GUARDIAN_TILE.x] = 'wgrass';
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
      if (inLegacyBounds(tx, ty) && wildsTerrain[ty][tx] === 'treasure') wildsTerrain[ty][tx] = 'wgrass';
    }
  }
  function findFirstOfType(terrain, type) {
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (terrain[y][x] === type) return { x, y };
    return null;
  }
  function nearestGrass(terrain, x, y) {
    if (inLegacyBounds(x, y) && terrain[y][x] === 'grass') return { x, y };
    for (let r = 1; r < GRID; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (inLegacyBounds(nx, ny) && terrain[ny][nx] === 'grass') return { x: nx, y: ny };
      }
    }
    return { x: 8, y: 8 };
  }
  function adjacentGrassTo(terrain, tile) {
    if (!tile) return { x: 8, y: 8 };
    const opts = [{ x: tile.x + 1, y: tile.y }, { x: tile.x - 1, y: tile.y }, { x: tile.x, y: tile.y + 1 }, { x: tile.x, y: tile.y - 1 }];
    for (const o of opts) if (inLegacyBounds(o.x, o.y) && terrain[o.y][o.x] === 'grass') return o;
    return nearestGrass(terrain, tile.x, tile.y);
  }

  // ---------------------------------------------------------------------
  // Chunked overworld generation
  // ---------------------------------------------------------------------
  const worldChunks = new Map();
  function hashU32(x, y, seed, salt = 0) {
    let h = (seed ^ salt ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
  function hash01(x, y, seed, salt = 0) { return hashU32(x, y, seed, salt) / 4294967295; }
  function smooth01(t) { return t * t * (3 - 2 * t); }
  function valueNoise(x, y, seed, scale, salt) {
    const sx = x / scale, sy = y / scale;
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const fx = smooth01(sx - x0), fy = smooth01(sy - y0);
    const a = hash01(x0, y0, seed, salt), b = hash01(x0 + 1, y0, seed, salt);
    const c = hash01(x0, y0 + 1, seed, salt), d = hash01(x0 + 1, y0 + 1, seed, salt);
    const top = a + (b - a) * fx, bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
  }
  function worldNoise(x, y, seed, salt) {
    return valueNoise(x, y, seed, 28, salt) * 0.58
      + valueNoise(x, y, seed, 13, salt ^ 0x9e3779b9) * 0.29
      + valueNoise(x, y, seed, 6, salt ^ 0x7f4a7c15) * 0.13;
  }
  function poiNear(x, y, radius = 9) {
    let best = null, bestDist = Infinity;
    for (const poi of WORLD_POIS) {
      if (poi.id === 'hearthward') continue;
      const dist = Math.max(Math.abs(x - poi.x), Math.abs(y - poi.y));
      if (dist <= radius && dist < bestDist) { best = poi; bestDist = dist; }
    }
    return best;
  }
  function proceduralBiomeAt(x, y, seed) {
    if (inLegacyBounds(x, y)) return 'hearthland';
    const anchor = poiNear(x, y, 10);
    if (anchor) return anchor.biome;
    const moisture = worldNoise(x, y, seed, 0x31415926);
    const elevation = worldNoise(x, y, seed, 0x27182818);
    const temperature = worldNoise(x, y, seed, 0x6a09e667) - (y - 8) / 390;
    if (elevation > 0.67) return 'highlands';
    if (temperature < 0.31) return 'frostwood';
    if (moisture > 0.64) return 'wetlands';
    if (moisture < 0.36) return 'sunfields';
    if (worldNoise(x + 31, y - 19, seed, 0xbb67ae85) > 0.57) return 'forest';
    return 'meadow';
  }
  function routeAt(x, y) {
    for (const route of WORLD_ROUTES) {
      for (let i = 0; i < route.length - 1; i++) {
        const a = route[i], b = route[i + 1];
        if (a.x === b.x && x === a.x && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) return true;
        if (a.y === b.y && y === a.y && x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x)) return true;
      }
    }
    return false;
  }
  function poiTileAt(x, y) {
    for (const poi of WORLD_POIS) {
      if (poi.id === 'hearthward') continue;
      const dx = x - poi.x, dy = y - poi.y;
      if (dx === 0 && dy === 0) return { type: 'landmark', poiId: poi.id };
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) continue;
      if (dx === 0 || dy === 0) return { type: 'road', poiId: poi.id };
      if ((poi.kind === 'settlement' || poi.kind === 'farm')
          && [[-2, -2], [2, -2], [-2, 2], [2, 2]].some(([px, py]) => dx === px && dy === py)) {
        return { type: 'cottage', poiId: poi.id };
      }
      if (poi.kind === 'farm' && Math.abs(dx) <= 4 && Math.abs(dy) <= 4) return { type: 'field', poiId: poi.id };
      if (poi.kind === 'settlement' && Math.abs(dx) <= 4 && Math.abs(dy) <= 4 && (Math.abs(dx + dy) % 3 === 0)) return { type: 'field', poiId: poi.id };
      if (poi.kind === 'landmark' && Math.max(Math.abs(dx), Math.abs(dy)) <= 2) return { type: 'meadow', poiId: poi.id };
    }
    return null;
  }
  function proceduralWorldTile(x, y, seed) {
    const biome = proceduralBiomeAt(x, y, seed);
    const elevation = worldNoise(x, y, seed, 0x27182818);
    const moisture = worldNoise(x, y, seed, 0x31415926);
    const detail = hash01(x, y, seed, 0xa54ff53a);
    let type = biome === 'meadow' ? 'meadow' : 'grass';

    if (x === WORLD_MIN || y === WORLD_MIN || x === WORLD_MAX || y === WORLD_MAX) type = elevation < 0.5 ? 'water' : 'cliff';
    else if (moisture > 0.665 && elevation < 0.61) type = 'water';
    else if (moisture > 0.625 && elevation < 0.64) type = detail > 0.48 ? 'reed' : 'marsh';
    else if (biome === 'highlands') type = elevation > 0.71 ? 'cliff' : (detail > 0.69 ? 'quarry' : 'stonegrass');
    else if (biome === 'forest') type = detail > 0.56 ? 'grove' : 'forestfloor';
    else if (biome === 'wetlands') type = detail > 0.71 ? 'reed' : 'marsh';
    else if (biome === 'sunfields') type = detail > 0.82 ? 'field' : 'sungrass';
    else if (biome === 'frostwood') type = detail > 0.63 ? 'grove' : 'frostgrass';
    else if (detail > 0.91) type = 'grove';

    const poiTile = poiTileAt(x, y);
    if (poiTile) type = poiTile.type;
    else if (routeAt(x, y)) type = type === 'water' || type === 'marsh' ? 'bridge' : 'road';

    const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE);
    const lx = x - cx * CHUNK_SIZE, ly = y - cy * CHUNK_SIZE;
    const cacheX = 2 + Math.floor(hash01(cx, cy, seed, 0x510e527f) * (CHUNK_SIZE - 4));
    const cacheY = 2 + Math.floor(hash01(cx, cy, seed, 0x1f83d9ab) * (CHUNK_SIZE - 4));
    const cacheChunk = hash01(cx, cy, seed, 0x5be0cd19) > 0.42;
    const passable = ['grass', 'meadow', 'forestfloor', 'stonegrass', 'sungrass', 'frostgrass', 'field'].includes(type);
    const farFromHome = Math.max(Math.abs(x - HOME_TILE.x), Math.abs(y - HOME_TILE.y)) > 11;
    const baseType = type;
    if (cacheChunk && farFromHome && lx === cacheX && ly === cacheY && passable && !poiTile) type = 'cache';

    return {
      type, baseType, biome, elevation, moisture, variant: detail,
      poiId: poiTile ? poiTile.poiId : null,
      cacheId: type === 'cache' ? `c_${x}_${y}` : null,
    };
  }
  function resetWorldChunks() {
    worldChunks.clear();
    if (rt) { rt.mapSeed = null; rt.lastMiniMapKey = ''; }
  }
  function getWorldChunk(cx, cy) {
    const key = `${cx},${cy}`;
    if (worldChunks.has(key)) {
      const cached = worldChunks.get(key);
      worldChunks.delete(key);
      worldChunks.set(key, cached);
      return cached;
    }
    const seed = state ? state.seed : 0;
    const tiles = new Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const x = cx * CHUNK_SIZE + lx, y = cy * CHUNK_SIZE + ly;
      tiles[ly * CHUNK_SIZE + lx] = inBounds(x, y) ? proceduralWorldTile(x, y, seed) : null;
    }
    const chunk = { cx, cy, tiles };
    worldChunks.set(key, chunk);
    while (worldChunks.size > MAX_CHUNK_CACHE) worldChunks.delete(worldChunks.keys().next().value);
    return chunk;
  }
  function worldTileAt(x, y) {
    if (!inBounds(x, y)) return { type: 'void', baseType: 'void', biome: 'hearthland', elevation: 0, moisture: 0, variant: 0, poiId: null, cacheId: null };
    if (inLegacyBounds(x, y)) {
      const type = terrain && terrain[y] ? terrain[y][x] : 'grass';
      return { type, baseType: type, biome: 'hearthland', elevation: 0.48, moisture: 0.5, variant: hash01(x, y, state ? state.seed : 0, 0x3c6ef372), poiId: null, cacheId: null };
    }
    const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE);
    const lx = x - cx * CHUNK_SIZE, ly = y - cy * CHUNK_SIZE;
    return getWorldChunk(cx, cy).tiles[ly * CHUNK_SIZE + lx];
  }
  function isWorldCacheFound(id) {
    return !!(id && state && state.exploration && state.exploration.cachesFound.includes(id));
  }
  function terrainAt(x, y) {
    const tile = worldTileAt(x, y);
    return tile.type === 'cache' && isWorldCacheFound(tile.cacheId) ? tile.baseType : tile.type;
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
    cameraX: HOME_TILE.x, cameraY: HOME_TILE.y,
    facing: 'down',
    gathering: null, // {x,y,t,dur}
    cooking: null,   // {recipe,t,dur}
    particles: [],
    ambience: [],
    // Ambient world life (birds/butterflies) — runtime-only, visual-only,
    // never persisted or synced; fully cleared under reduced motion.
    life: { birds: [], butterflies: [], nextBirdAt: 0, nextButterflyAt: 0 },
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
    waypoint: null, // {x,y,label}; runtime-only trail marker
    mapSeed: null,
    lastMiniMapKey: '',
    heldKeys: new Set(),
    nextHeldMoveAt: 0,
    touchMoveTimer: null,
    // --- Wilds (see the block comment above WILDS_ENTRANCE) — all runtime-only,
    // never persisted: leaving the game always drops you back in town on reload.
    world: 'town', // 'town' | 'wilds'
    wildsGx: WILDS_ENTRANCE.x, wildsGy: WILDS_ENTRANCE.y,
    wildsFromX: WILDS_ENTRANCE.x, wildsFromY: WILDS_ENTRANCE.y, wildsToX: WILDS_ENTRANCE.x, wildsToY: WILDS_ENTRANCE.y,
    wildsMoveT: 1, wildsMoveDur: 150, wildsPx: 0, wildsPy: 0,
    wildsCameraX: WILDS_ENTRANCE.x, wildsCameraY: WILDS_ENTRANCE.y,
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
  function defaultPartyState() {
    return { recruited: [], active: [] };
  }
  function defaultExplorationState() {
    return { discovered: ['hearthward'], biomes: ['hearthland'], cachesFound: [] };
  }
  function newGame(seed) {
    state = {
      version: 5,
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
      party: defaultPartyState(), // local RPG companions: recruited + active follower ids
      tools: { gatherTier: 1 }, // 1 = bare hands, 2 = Sturdy Tool, 3 = Masterwork Tool
      wilds: { treasuresFound: [], guardianDefeated: false }, // local only, never host-synced
      exploration: defaultExplorationState(),
      cosmeticsUnlocked: { hue: ['coral', 'mint', 'slate', 'sand'], topper: ['none', 'cap'], trim: ['soft', 'bold'] },
      tutorialSeen: false,
      stats: {
        gathered: 0, built: 0, demolished: 0, fishCaught: 0, fishTried: 0, dishesCooked: 0, questsCompleted: 0,
        trialsCleared: 0, gatesOpened: 0, secondsPlayed: 0, cropsHarvested: 0,
        enemiesDefeated: 0, treasuresFound: 0, itemsCrafted: 0, eggsCollected: 0,
        regionsDiscovered: 1, cachesFound: 0,
        companionsRecruited: 0,
      },
      completedMilestone: false,
    };
    terrain = genTerrain(state.seed);
    wildsTerrain = genWildsTerrain(state.seed);
    resetWorldChunks();
    clearFoundWildsTreasures();
    npcs = buildNpcRuntime();
  }

  function buildNpcRuntime() {
    // Leisure spot (living-world spec §4): a pond-side stop at dusk, derived
    // from terrain exactly like workplace/square — deterministic per seed.
    const pond = findFirstOfType(terrain, 'water');
    const leisureBase = pond ? adjacentGrassTo(terrain, pond) : nearestGrass(terrain, 8, 7);
    return NPC_DEFS.map((def, i) => {
      const resTile = findFirstOfType(terrain, def.resourceType);
      const workplace = adjacentGrassTo(terrain, resTile);
      const homeHint = NPC_HOME_POINTS[i % NPC_HOME_POINTS.length];
      const home = nearestGrass(terrain, homeHint.x, homeHint.y);
      // Spread residents around the square/pond instead of stacking all nine
      // on one tile — spreads deterministically from the index, and puts
      // pairs adjacent so the idle chat behavior has partners.
      const square = nearestGrass(terrain, 8 + (i % 3) - 1, 7 + (Math.floor(i / 3) % 2));
      const leisure = nearestGrass(terrain, leisureBase.x + (i % 3) - 1, leisureBase.y + (Math.floor(i / 3) % 3) - 1);
      const quest = state.quests[def.id] || { done: false };
      const gx = home.x, gy = home.y;
      return {
        id: def.id, name: def.name, hue: def.hue, def,
        home, workplace, square, leisure, resTile,
        leisureFocus: pond || { x: 8, y: 7 },
        workFace: resTile ? faceToward(workplace.x, workplace.y, resTile.x, resTile.y) : 'down',
        gx, gy, screenPx: 0, screenPy: 0, targetGx: gx, targetGy: gy, moveFrom: { x: gx, y: gy }, moveT: 1, moveDur: 380,
        finalTarget: home,
        segment: 'boot', quest,
        facing: 'down', idlePhase: i * 1.73, idleBucket: -1,
        glanceUntil: 0, wasNearPlayer: false, stretchUntil: 0,
        carrying: null, chatWith: null, stuck: 0, noProgress: 0, pauseUntil: 0, lastChipAt: 0,
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
    rt.tileW = clamp(46 * rt.dpr, 42, 78);
    rt.tileH = rt.tileW / 2;
    rt.originX = rt.W / 2;
    rt.originY = rt.H * 0.57;
    rt.lastMiniMapKey = '';
  }
  addEventListener('resize', size);

  function tileToScreen(gx, gy) {
    const cameraX = rt.world === 'wilds' ? rt.wildsCameraX : rt.cameraX;
    const cameraY = rt.world === 'wilds' ? rt.wildsCameraY : rt.cameraY;
    const lx = gx - cameraX, ly = gy - cameraY;
    return {
      x: rt.originX + (lx - ly) * (rt.tileW / 2),
      y: rt.originY + (lx + ly) * (rt.tileH / 2),
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
  const WORLD_BLOCK_TYPES = new Set(['void', 'water', 'grove', 'quarry', 'reed', 'cliff', 'shrine', 'cottage', 'landmark', 'cache']);
  const BUILDABLE_TYPES = new Set(['grass', 'meadow', 'forestfloor', 'stonegrass', 'sungrass', 'frostgrass']);
  function isBlockedTile(gx, gy) {
    if (!inBounds(gx, gy)) return true;
    const t = terrainAt(gx, gy);
    if (WORLD_BLOCK_TYPES.has(t)) return true;
    if (t === 'gate' && !state.adventure?.gateOpen) return true;
    const piece = townPieceAt(gx, gy, currentTown());
    if (piece && PALETTE_BY_TYPE[piece.type] && PALETTE_BY_TYPE[piece.type].blocking) return true;
    return false;
  }
  function isBuildableGround(gx, gy) {
    if (!inBounds(gx, gy)) return false;
    const t = terrainAt(gx, gy);
    if (!BUILDABLE_TYPES.has(t)) return false;
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
    if (!inLegacyBounds(gx, gy)) return true;
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
  // ---------------------------------------------------------------------
  // Generative soundscape: a soft wind bed, daytime music-box plucks on a
  // pentatonic scale, birdsong by day and crickets by night. Everything is
  // synthesized here, gated by the same masterGain() as the beeps, and it
  // goes fully silent while paused or muted. No loops run until the first
  // user gesture unlocks the AudioContext.
  // ---------------------------------------------------------------------
  const ambient = { started: false, windGain: null, nextPluck: 0, nextChirp: 0 };
  function ensureAmbient() {
    if (ambient.started || !audio.ctx) return;
    ambient.started = true;
    try {
      const ctx = audio.ctx;
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let run = 0;
      for (let i = 0; i < len; i++) { run += (Math.random() * 2 - 1) * 0.02; run *= 0.985; d[i] = run; }
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(lp).connect(g).connect(ctx.destination);
      src.start();
      ambient.windGain = g;
    } catch (e) { ambient.windGain = null; }
  }
  function pluck(freq, dur = 0.9, vol = 0.05) {
    if (!audio.ctx) return;
    const g0 = masterGain(); if (g0 <= 0) return;
    try {
      const ctx = audio.ctx, t0 = ctx.currentTime;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol * g0, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.type = 'sine'; o2.frequency.value = freq * 2; g2.gain.setValueAtTime(vol * g0 * 0.25, t0);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.6);
      osc.connect(gain).connect(ctx.destination); o2.connect(g2).connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.05); o2.start(t0); o2.stop(t0 + dur * 0.6 + 0.05);
    } catch (e) { /* ignore */ }
  }
  const DAY_SCALE = [523.3, 587.3, 659.3, 784, 880, 1046.5];
  const NIGHT_SCALE = [261.6, 293.7, 329.6, 392, 440];
  function stepAmbientAudio(dt) {
    if (!audio.ctx) return;
    ensureAmbient();
    const seg = daySegment(state.minutes);
    const silent = rt.paused || masterGain() <= 0;
    if (ambient.windGain) {
      const target = silent ? 0 : masterGain() * (seg === 'night' ? 0.05 : 0.09) * (weatherForDay(state.day).kind === 'rain' ? 1.8 : 1);
      ambient.windGain.gain.setTargetAtTime(target, audio.ctx.currentTime, 0.6);
    }
    if (silent) return;
    ambient.nextPluck -= dt;
    if (ambient.nextPluck <= 0) {
      const night = seg === 'night' || seg === 'dusk';
      const scale = night ? NIGHT_SCALE : DAY_SCALE;
      pluck(scale[Math.floor(Math.random() * scale.length)], night ? 1.4 : 0.9, night ? 0.035 : 0.05);
      ambient.nextPluck = (night ? 3.4 : 2.1) + Math.random() * (night ? 4 : 2.6);
    }
    ambient.nextChirp -= dt;
    if (ambient.nextChirp <= 0) {
      if (seg === 'day' || seg === 'dawn') {
        const f = 1900 + Math.random() * 900;
        beep(f, 0.06, 'sine', 0.03); setTimeout(() => beep(f * 1.15, 0.05, 'sine', 0.025), 90);
      } else if (seg === 'night') {
        const f = 1450 + Math.random() * 250;
        beep(f, 0.045, 'triangle', 0.022); setTimeout(() => beep(f, 0.045, 'triangle', 0.02), 120);
      }
      ambient.nextChirp = 2.6 + Math.random() * 5;
    }
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
    if (name === 'party') renderPartyPanel();
    if (name === 'map') renderMapPanel();
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
    const weather = weatherForDay(day);
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
    if (weather.kind === 'rain') {
      for (const plot of state.farm) if (plot.crop) plot.watered = true;
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
    renderDialoguePartyButton(npc.id);
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

  // ---------------------------------------------------------------------
  // RPG party companions: Stardew/Animal-Crossing bonding feeds Zelda-style
  // adventure support. Residents introduce companions; they are not captured.
  // ---------------------------------------------------------------------
  function ensurePartyState() {
    if (!state.party || typeof state.party !== 'object') state.party = defaultPartyState();
    if (!Array.isArray(state.party.recruited)) state.party.recruited = [];
    if (!Array.isArray(state.party.active)) state.party.active = [];
    state.party.recruited = Array.from(new Set(state.party.recruited.filter((id) => !!COMPANION_BY_ID[id])));
    state.party.active = Array.from(new Set(state.party.active.filter((id) => state.party.recruited.includes(id) && !!COMPANION_BY_ID[id]))).slice(0, PARTY_LIMIT);
    return state.party;
  }
  function activeCompanions() {
    return ensurePartyState().active.map((id) => COMPANION_BY_ID[id]).filter(Boolean);
  }
  function companionForNpc(npcId) {
    return COMPANION_BY_NPC[npcId] || null;
  }
  function companionReadyForNpc(npcId) {
    const f = friendshipOf(npcId);
    return !!(state.quests?.[npcId]?.done || f.points > 0);
  }
  function recruitCompanionForNpc(npcId, silent = false) {
    const comp = companionForNpc(npcId);
    if (!comp) return false;
    const party = ensurePartyState();
    const newlyRecruited = !party.recruited.includes(comp.id);
    if (newlyRecruited) {
      party.recruited.push(comp.id);
      state.stats.companionsRecruited = Math.max(state.stats.companionsRecruited || 0, party.recruited.length);
    }
    if (!party.active.includes(comp.id) && party.active.length < PARTY_LIMIT) party.active.push(comp.id);
    if (!silent) {
      sfx.quest();
      toast(newlyRecruited
        ? `${comp.name} joined your party. It will help in Wilds fights.`
        : `${comp.name} is traveling with you now.`);
    }
    updateHud();
    schedulePush();
    return newlyRecruited;
  }
  function toggleCompanionActive(id) {
    const comp = COMPANION_BY_ID[id];
    if (!comp) return;
    const party = ensurePartyState();
    if (!party.recruited.includes(id)) return;
    if (party.active.includes(id)) {
      party.active = party.active.filter((x) => x !== id);
      toast(`${comp.name} is resting in town.`);
    } else {
      if (party.active.length >= PARTY_LIMIT) party.active.shift();
      party.active.push(id);
      toast(`${comp.name} joined the active party.`);
    }
    renderPartyPanel();
    updateHud();
    schedulePush();
  }
  function renderDialoguePartyButton(npcId) {
    if (!el.dlgParty) return;
    const comp = companionForNpc(npcId);
    if (!comp) { el.dlgParty.hidden = true; return; }
    const party = ensurePartyState();
    const recruited = party.recruited.includes(comp.id);
    const active = party.active.includes(comp.id);
    if (!companionReadyForNpc(npcId) && !recruited) {
      el.dlgParty.hidden = false;
      el.dlgParty.disabled = true;
      el.dlgParty.textContent = 'Bond first';
      return;
    }
    el.dlgParty.hidden = false;
    el.dlgParty.disabled = false;
    el.dlgParty.textContent = recruited ? (active ? 'Rest companion' : 'Bring companion') : `Invite ${comp.name}`;
  }
  function renderPartyPanel() {
    if (!el.partyList) return;
    const party = ensurePartyState();
    const active = new Set(party.active);
    if (el.partySub) el.partySub.textContent = `${party.active.length}/${PARTY_LIMIT} active · ${party.recruited.length}/${COMPANION_DEFS.length} recruited. Companions assist in Wilds combat and follow you on screen.`;
    el.partyList.innerHTML = COMPANION_DEFS.map((comp) => {
      const npc = NPC_BY_ID[comp.npcId];
      const recruited = party.recruited.includes(comp.id);
      const canRecruit = companionReadyForNpc(comp.npcId);
      const cls = recruited && active.has(comp.id) ? 'is-active' : !recruited ? 'is-locked' : '';
      const button = recruited ? (active.has(comp.id) ? 'Rest' : 'Travel') : canRecruit ? 'Invite' : 'Meet';
      const source = npc ? npc.name.split(' ')[0] : 'Town';
      const status = recruited
        ? `${active.has(comp.id) ? 'Active' : 'Resting'} · ${comp.role}`
        : canRecruit ? `Ready through ${source}` : `Talk with ${source} to bond`;
      return `<div class="party-card ${cls}">
        <i class="party-orb" style="background:${comp.color};color:${comp.color}"></i>
        <div><b>${escapeHtml(comp.name)} <small>by ${escapeHtml(source)}</small></b><span>${escapeHtml(status)} · ${escapeHtml(comp.trait)}</span></div>
        <button type="button" data-ct-party-toggle="${comp.id}" ${(!recruited && !canRecruit) ? 'disabled' : ''}>${button}</button>
      </div>`;
    }).join('');
    $all('[data-ct-party-toggle]').forEach((b) => b.onclick = () => {
      const id = b.dataset.ctPartyToggle;
      const comp = COMPANION_BY_ID[id];
      if (!comp) return;
      if (!ensurePartyState().recruited.includes(id)) recruitCompanionForNpc(comp.npcId);
      else toggleCompanionActive(id);
      renderPartyPanel();
    });
  }
  function partyAssistDamage(enemy) {
    const members = activeCompanions();
    if (!members.length) return { damage: 0, names: [] };
    const names = [];
    let damage = 0;
    for (const comp of members) {
      const bossTaper = enemy.isGuardian && comp.power > 1 ? comp.power - 1 : comp.power;
      damage += Math.max(1, bossTaper);
      names.push(comp.short);
      spawnParticles(enemy.gx, enemy.gy, comp.color);
    }
    return { damage, names };
  }
  function partyGuard(amount) {
    const members = activeCompanions();
    if (!members.length) return { amount, names: [] };
    let block = 0;
    const names = [];
    for (const comp of members) {
      if (!comp.guard) continue;
      block += comp.guard;
      names.push(comp.short);
    }
    return { amount: Math.max(1, amount - Math.min(amount - 1, block)), names };
  }
  function partyVictoryRecovery() {
    const healers = activeCompanions().filter((comp) => comp.heal);
    if (!healers.length) return '';
    const total = healers.reduce((sum, comp) => sum + comp.heal, 0);
    state.spark = clamp(state.spark + total, 0, 100);
    return ` · ${healers.map((comp) => comp.short).join('/')} restored ${total} Spark`;
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
    const joined = recruitCompanionForNpc(npc.id, true);
    toast(joined ? `${npc.name}’s quest complete — ${COMPANION_BY_NPC[npc.id].name} joined your party!` : `${npc.name}’s quest complete!`);
    checkAllQuestsMilestone();
    closePanels();
    updateHud();
    schedulePush();
  };
  if (el.dlgParty) el.dlgParty.onclick = () => {
    const npc = rt.dialogueNpc;
    if (!npc || rt.dialogueMode !== 'npc') return;
    const comp = companionForNpc(npc.id);
    if (!comp) return;
    if (!ensurePartyState().recruited.includes(comp.id)) recruitCompanionForNpc(npc.id);
    else toggleCompanionActive(comp.id);
    renderDialoguePartyButton(npc.id);
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
    if (el.dlgParty) el.dlgParty.hidden = true;
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
      if (el.dlgParty) el.dlgParty.hidden = true;
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
      + (s.enemiesDefeated || 0) * 8 + (s.treasuresFound || 0) * 12 + (s.itemsCrafted || 0) * 6 + (s.eggsCollected || 0) * 2
      + (s.regionsDiscovered || 0) * 20 + (s.cachesFound || 0) * 9 + ensurePartyState().recruited.length * 14;
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
    const pDone = ensurePartyState().recruited.length;
    el.reportTitle.textContent = milestone ? 'Prism Gate Opened!' : 'Town Report';
    el.reportSub.textContent = milestone ? 'The Prism story is complete, while the roads and settlements remain yours to explore and build.' : `Day ${state.day}, ${formatClock(state.minutes)} · ${qDone}/${NPC_DEFS.length} resident arcs · ${pDone}/${COMPANION_DEFS.length} companions · ${tDone}/${ALL_TRIAL_DEFS.length} shrine trials · ${state.exploration.discovered.length}/${WORLD_POIS.length} places.`;
    el.statDay.textContent = state.day;
    el.statBuilt.textContent = state.stats.built;
    el.statFish.textContent = state.stats.fishCaught;
    el.statDish.textContent = state.stats.dishesCooked;
    el.statQuests.textContent = `${qDone}/${NPC_DEFS.length}`;
    el.statScore.textContent = computeScore();
    if (el.statDiscovered) el.statDiscovered.textContent = state.exploration.discovered.length;
    if (el.statCaches) el.statCaches.textContent = state.exploration.cachesFound.length;
    $all('.panel').forEach((panel) => panel.classList.remove('is-open'));
    const reportPanel = document.querySelector('[data-ct-panel="report"]');
    if (reportPanel) reportPanel.classList.add('is-open');
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
    const party = ensurePartyState();
    const partyRows = COMPANION_DEFS.map((comp) => {
      const recruited = party.recruited.includes(comp.id);
      const active = party.active.includes(comp.id);
      return `<div class="quest-row ${recruited ? 'is-done' : ''}">
        <b>${recruited ? '✓' : '□'} ${escapeHtml(comp.name)}</b>
        <span>${active ? 'Active party' : recruited ? 'Resting in town' : `Bond with ${escapeHtml(NPC_BY_ID[comp.npcId]?.name || 'a resident')}`} · ${escapeHtml(comp.trait)}</span>
      </div>`;
    }).join('');
    const guardianStatus = state.wilds?.guardianDefeated ? 'The Wilds Guardian has fallen — its Relic is yours.' : 'A Guardian still watches over the deep Wilds, hoarding a Relic.';
    const gateReady = (state.inventory.keystone || 0) >= 4 && (state.inventory.relic || 0) >= 1;
    const foundPlaces = WORLD_POIS.filter((poi) => state.exploration.discovered.includes(poi.id)).map((poi) => poi.name).join(', ');
    el.questLog.innerHTML = `
      <section class="quest-chapter">
        <h3>Chapter ${state.adventure?.gateOpen ? 'Complete' : gateReady ? 'Final' : 'I'} · The Prism Gate</h3>
        <p>${state.adventure?.gateOpen ? 'The Prism Gate is open. CubeTown is awake.' : gateReady ? 'You have the pieces. Walk to the north gate and open it.' : 'Help residents, clear shrine trials, recover four Keystones, and bring one Relic to the north gate.'}</p>
      </section>
      <section class="quest-chapter"><h3>Residents</h3>${questRows}</section>
      <section class="quest-chapter"><h3>Friendships</h3>${friendRows}</section>
      <section class="quest-chapter"><h3>Travel Party</h3><p>${party.active.length}/${PARTY_LIMIT} active companions. Up to three follow you and assist in Wilds fights.</p>${partyRows}</section>
      <section class="quest-chapter"><h3>Shrine Trials</h3>${trialRows}</section>
      <section class="quest-chapter"><h3>Wilds Trials</h3>${wildsTrialRows}<p>${escapeHtml(guardianStatus)}</p></section>
      <section class="quest-chapter"><h3>Exploration</h3><p>${state.exploration.discovered.length}/${WORLD_POIS.length} places · ${state.exploration.biomes.length}/${Object.keys(BIOME_DEFS).length} biomes · ${state.exploration.cachesFound.length} trail caches. ${escapeHtml(foundPlaces)}</p></section>
      <section class="quest-chapter"><h3>Inventory Clues</h3><p>${state.inventory.keystone || 0}/4 Keystones · ${state.inventory.lumen || 0} Lumen · ${state.inventory.relic || 0}/1 Relic · ${state.stats.built || 0} pieces built · Gathering tool tier ${gatherTier()}</p></section>`;
  }

  // ---------------------------------------------------------------------
  // Overworld exploration, map, weather, and navigation
  // ---------------------------------------------------------------------
  function ensureExplorationState() {
    if (!state.exploration || typeof state.exploration !== 'object') state.exploration = defaultExplorationState();
    for (const key of ['discovered', 'biomes', 'cachesFound']) {
      if (!Array.isArray(state.exploration[key])) state.exploration[key] = [];
      state.exploration[key] = Array.from(new Set(state.exploration[key].filter((v) => typeof v === 'string')));
    }
    if (!state.exploration.discovered.includes('hearthward')) state.exploration.discovered.unshift('hearthward');
    if (!state.exploration.biomes.includes('hearthland')) state.exploration.biomes.unshift('hearthland');
  }
  function rewardText(reward) {
    return Object.entries(reward || {}).map(([key, amount]) => `${amount} ${RES_LABELS[key] || key}`).join(', ');
  }
  function grantExplorationReward(reward) {
    for (const [key, amount] of Object.entries(reward || {})) state.inventory[key] = (state.inventory[key] || 0) + amount;
  }
  function nearestWorldPoi(x, y, maxDistance = Infinity) {
    let nearest = null, distance = Infinity;
    for (const poi of WORLD_POIS) {
      const d = Math.max(Math.abs(x - poi.x), Math.abs(y - poi.y));
      if (d < distance && d <= maxDistance) { nearest = poi; distance = d; }
    }
    return nearest ? { poi: nearest, distance } : null;
  }
  function locationInfoAt(x, y) {
    const close = nearestWorldPoi(x, y, 5);
    const biome = worldTileAt(x, y).biome;
    return {
      name: close ? close.poi.name : (BIOME_DEFS[biome]?.label || 'Open Country'),
      biome,
      detail: close ? (close.poi.kind === 'home' ? 'Home district' : close.poi.kind[0].toUpperCase() + close.poi.kind.slice(1)) : `${x}, ${y}`,
    };
  }
  function weatherForDay(day) {
    const season = seasonOf(day);
    const roll = hash01(day, Math.floor(day / 5), state.seed, 0xc1059ed8);
    if (season === 'winter' && roll < 0.38) return { kind: 'snow', label: 'Soft snow' };
    if (season === 'spring' && roll < 0.34) return { kind: 'rain', label: 'Spring rain' };
    if (season === 'summer' && roll < 0.16) return { kind: 'rain', label: 'Warm shower' };
    if (season === 'autumn' && roll < 0.28) return { kind: 'mist', label: 'Harvest mist' };
    if (roll > 0.84) return { kind: 'wind', label: 'Breezy' };
    return { kind: 'clear', label: 'Clear skies' };
  }
  function directionLabel(dx, dy) {
    const ns = Math.abs(dy) > 2 ? (dy < 0 ? 'N' : 'S') : '';
    const ew = Math.abs(dx) > 2 ? (dx < 0 ? 'W' : 'E') : '';
    return ns + ew || (Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'W' : 'E') : (dy < 0 ? 'N' : 'S'));
  }
  function checkWorldDiscovery() {
    if (rt.world !== 'town') return;
    ensureExplorationState();
    const x = state.player.gx, y = state.player.gy;
    const tile = worldTileAt(x, y);
    const messages = [];
    if (!state.exploration.biomes.includes(tile.biome)) {
      state.exploration.biomes.push(tile.biome);
      const reward = BIOME_REWARDS[tile.biome] || {};
      grantExplorationReward(reward);
      state.spark = clamp(state.spark + 5, 0, 100);
      messages.push(`Discovered ${BIOME_DEFS[tile.biome]?.label || tile.biome}${rewardText(reward) ? ` · ${rewardText(reward)}` : ''}`);
    }
    const close = nearestWorldPoi(x, y, 3);
    if (close && !state.exploration.discovered.includes(close.poi.id)) {
      state.exploration.discovered.push(close.poi.id);
      grantExplorationReward(close.poi.reward);
      state.stats.regionsDiscovered = (state.stats.regionsDiscovered || 1) + 1;
      messages.push(`${close.poi.name} found · ${rewardText(close.poi.reward)}`);
      if (rt.waypoint && rt.waypoint.poiId === close.poi.id) rt.waypoint = null;
    }
    if (messages.length) {
      sfx.quest();
      spawnParticles(x, y, '#ffcf6b');
      toast(messages.join('  '));
      updateHud();
      schedulePush();
    }
  }
  function collectWorldCache(tile, x, y) {
    if (!tile || tile.type !== 'cache' || isWorldCacheFound(tile.cacheId)) return;
    ensureExplorationState();
    state.exploration.cachesFound.push(tile.cacheId);
    const roll = hash01(x, y, state.seed, 0x428a2f98);
    const reward = roll < 0.33 ? { grain: 3 } : roll < 0.66 ? { shale: 2, loom: 1 } : { lumen: 1 };
    grantExplorationReward(reward);
    state.stats.cachesFound = (state.stats.cachesFound || 0) + 1;
    state.spark = clamp(state.spark + 8, 0, 100);
    sfx.quest();
    spawnParticles(x, y, '#ffcf6b');
    toast(`Trail cache opened · ${rewardText(reward)} · +8 Spark`);
    updateHud();
    schedulePush();
  }
  function settlementResidentPosition(resident) {
    const poi = WORLD_POI_BY_ID[resident.poi];
    return { ...resident, gx: poi.x + resident.dx, gy: poi.y + resident.dy };
  }
  function openLocalDialogue(resident) {
    rt.dialogueMode = 'local';
    rt.dialogueNpc = null;
    el.dlgName.textContent = resident.name;
    el.dlgBody.textContent = resident.line;
    el.dlgQuest.hidden = true;
    el.dlgTurnin.hidden = true;
    if (el.dlgParty) el.dlgParty.hidden = true;
    if (el.dlgFriend) el.dlgFriend.hidden = true;
    if (el.dlgGiftList) el.dlgGiftList.innerHTML = '';
    openPanel('dialogue');
  }
  const MAP_TERRAIN_COLOR = {
    water: '#3c82ad', bridge: '#d3b27b', road: '#bd9b69', trail: '#bd9b69', grove: '#285c39', quarry: '#747880', reed: '#5c8661',
    cliff: '#5d6265', cottage: '#d98967', landmark: '#f2cc67', field: '#9e8c43', marsh: '#4c7465', shrine: '#8f7fff', gate: '#6b5d8d', trailhead: '#c49365',
  };
  function mapColorForTile(tile) {
    const effective = tile.type === 'cache' && isWorldCacheFound(tile.cacheId) ? tile.baseType : tile.type;
    return MAP_TERRAIN_COLOR[effective] || BIOME_DEFS[tile.biome]?.map || '#64845d';
  }
  function mapPoint(x, y, size) {
    const unit = size / WORLD_SIZE;
    return { x: (x - WORLD_MIN + 0.5) * unit, y: (y - WORLD_MIN + 0.5) * unit };
  }
  function buildMapBackground() {
    if (rt.mapSeed === state.seed && rt.mapBackground) return;
    const background = document.createElement('canvas');
    background.width = 512; background.height = 512;
    const mctx = background.getContext('2d');
    const unit = background.width / WORLD_SIZE;
    for (let y = WORLD_MIN; y <= WORLD_MAX; y++) for (let x = WORLD_MIN; x <= WORLD_MAX; x++) {
      const tile = inLegacyBounds(x, y) ? worldTileAt(x, y) : proceduralWorldTile(x, y, state.seed);
      mctx.fillStyle = mapColorForTile(tile);
      mctx.fillRect((x - WORLD_MIN) * unit, (y - WORLD_MIN) * unit, Math.ceil(unit), Math.ceil(unit));
    }
    rt.mapBackground = background;
    rt.mapSeed = state.seed;
  }
  function renderWorldMap() {
    if (!el.worldMap) return;
    buildMapBackground();
    const mctx = el.worldMap.getContext('2d');
    mctx.clearRect(0, 0, el.worldMap.width, el.worldMap.height);
    mctx.drawImage(rt.mapBackground, 0, 0, el.worldMap.width, el.worldMap.height);
    for (const poi of WORLD_POIS) {
      if (!state.exploration.discovered.includes(poi.id)) continue;
      const p = mapPoint(poi.x, poi.y, el.worldMap.width);
      mctx.fillStyle = poi.id === 'hearthward' ? '#fbe9d8' : '#ffcf6b';
      mctx.strokeStyle = '#20142f'; mctx.lineWidth = 3;
      mctx.beginPath(); mctx.arc(p.x, p.y, poi.id === 'hearthward' ? 6 : 5, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
    }
    if (rt.waypoint) {
      const p = mapPoint(rt.waypoint.x, rt.waypoint.y, el.worldMap.width);
      mctx.strokeStyle = '#fbe9d8'; mctx.lineWidth = 3;
      mctx.beginPath(); mctx.arc(p.x, p.y, 9, 0, Math.PI * 2); mctx.stroke();
    }
    const player = mapPoint(state.player.gx, state.player.gy, el.worldMap.width);
    mctx.fillStyle = '#ff6b81'; mctx.strokeStyle = '#ffffff'; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(player.x, player.y, 5, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
  }
  function renderMapPanel() {
    ensureExplorationState();
    const info = locationInfoAt(state.player.gx, state.player.gy);
    el.mapSub.textContent = `${WORLD_SIZE} × ${WORLD_SIZE} region · ${(WORLD_SIZE * WORLD_SIZE / (GRID * GRID)).toFixed(1)}× the old district · ${state.exploration.discovered.length}/${WORLD_POIS.length} places found`;
    el.mapLocation.textContent = info.name;
    el.mapCoords.textContent = `${state.player.gx}, ${state.player.gy}`;
    el.mapLandmarks.innerHTML = WORLD_POIS.filter((poi) => state.exploration.discovered.includes(poi.id)).map((poi) => {
      const distance = Math.abs(poi.x - state.player.gx) + Math.abs(poi.y - state.player.gy);
      return `<div class="map-destination"><b>${escapeHtml(poi.name)}</b><span>${poi.x}, ${poi.y} · ${distance} steps</span><button type="button" data-ct-travel="${poi.id}" ${rt.world === 'wilds' ? 'disabled' : ''}>Travel</button></div>`;
    }).join('');
    $all('[data-ct-travel]').forEach((button) => button.onclick = () => fastTravelToPoi(button.dataset.ctTravel));
    renderWorldMap();
  }
  function nearestPassableWorld(x, y) {
    for (let radius = 1; radius <= 7; radius++) {
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny) && !isBlockedTile(nx, ny)) return { x: nx, y: ny };
      }
    }
    return HOME_TILE;
  }
  function fastTravelToPoi(id) {
    const poi = WORLD_POI_BY_ID[id];
    if (!poi || !state.exploration.discovered.includes(id)) return;
    if (rt.world !== 'town') { toast('Return from the Wilds before using the road signs.'); return; }
    const target = id === 'hearthward' ? HOME_TILE : nearestPassableWorld(poi.x, poi.y);
    state.player.gx = target.x; state.player.gy = target.y;
    rt.playerFromX = target.x; rt.playerFromY = target.y; rt.playerToX = target.x; rt.playerToY = target.y; rt.moveT = 1;
    rt.cameraX = target.x; rt.cameraY = target.y;
    state.spark = clamp(state.spark - (id === 'hearthward' ? 0 : 4), 0, 100);
    rt.waypoint = null;
    closePanels();
    checkWorldDiscovery();
    toast(`${poi.name} · arrived by signpost${id === 'hearthward' ? '' : ' · -4 Spark'}`);
    updateHud();
    schedulePush();
  }
  function setWaypoint(x, y, label = 'Trail marker') {
    rt.waypoint = { x: clamp(Math.round(x), WORLD_MIN, WORLD_MAX), y: clamp(Math.round(y), WORLD_MIN, WORLD_MAX), label };
    toast(`Trail marker set · ${rt.waypoint.x}, ${rt.waypoint.y}`);
    updateHud();
    renderWorldMap();
  }
  function renderMiniMap() {
    if (!el.minimap || !state) return;
    const key = `${rt.world}:${state.seed}:${state.player.gx}:${state.player.gy}:${rt.wildsGx}:${rt.wildsGy}:${state.exploration.cachesFound.length}:${rt.waypoint ? `${rt.waypoint.x},${rt.waypoint.y}` : '-'}`;
    if (key === rt.lastMiniMapKey) return;
    rt.lastMiniMapKey = key;
    const mctx = el.minimap.getContext('2d'), w = el.minimap.width, h = el.minimap.height;
    mctx.fillStyle = '#100b1c'; mctx.fillRect(0, 0, w, h);
    const radius = 9, unit = w / (radius * 2 + 1);
    const px = rt.world === 'wilds' ? rt.wildsGx : state.player.gx;
    const py = rt.world === 'wilds' ? rt.wildsGy : state.player.gy;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = px + dx, y = py + dy;
      if (rt.world === 'wilds') {
        if (!inLegacyBounds(x, y)) continue;
        mctx.fillStyle = WILDS_TILE_COLOR[wildsTerrain[y][x]] || WILDS_TILE_COLOR.wgrass;
      } else {
        if (!inBounds(x, y)) continue;
        mctx.fillStyle = mapColorForTile(worldTileAt(x, y));
      }
      mctx.fillRect((dx + radius) * unit, (dy + radius) * unit, Math.ceil(unit), Math.ceil(unit));
    }
    mctx.fillStyle = '#ff6b81'; mctx.strokeStyle = '#ffffff'; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(w / 2, h / 2, 5, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
    if (rt.world === 'town' && rt.waypoint) {
      const dx = rt.waypoint.x - px, dy = rt.waypoint.y - py;
      const edgeX = clamp(dx, -radius, radius), edgeY = clamp(dy, -radius, radius);
      mctx.strokeStyle = '#ffcf6b'; mctx.lineWidth = 3;
      mctx.beginPath(); mctx.arc((edgeX + radius + 0.5) * unit, (edgeY + radius + 0.5) * unit, 5, 0, Math.PI * 2); mctx.stroke();
    }
  }
  function updateNavigationHud() {
    if (!el.location || !state) return;
    if (rt.world === 'wilds') {
      el.location.textContent = 'Deep Wilds';
      el.navNote.textContent = `${rt.wildsGx}, ${rt.wildsGy} · trailhead SE`;
    } else {
      const info = locationInfoAt(state.player.gx, state.player.gy);
      el.location.textContent = info.name;
      if (rt.waypoint) {
        const dx = rt.waypoint.x - state.player.gx, dy = rt.waypoint.y - state.player.gy;
        el.navNote.textContent = `${directionLabel(dx, dy)} · ${Math.abs(dx) + Math.abs(dy)} steps · ${rt.waypoint.label}`;
      } else {
        el.navNote.textContent = `${info.detail} · ${state.player.gx}, ${state.player.gy}`;
      }
    }
    el.weather.textContent = `${SEASON_LABEL[seasonOf(state.day)]} · ${weatherForDay(state.day).label}`;
    renderMiniMap();
  }

  // ---------------------------------------------------------------------
  // Tutorial
  // ---------------------------------------------------------------------
  const TUTORIAL_STEPS = [
    'Explore the 128 × 128 region with WASD / arrow keys, held directions, or the on-screen pad. The camera follows while nearby chunks stream in.',
    'Open Map or press M for roads, coordinates, discovered signpost travel, and a trail marker. Open Quest Log for the resident → shrine → Prism Gate path.',
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
    'Weather changes by day. Spring and summer rain water growing plots for you; mist, wind, and winter snow change the feel of the road.',
    'Talk to residents often and give them gifts from your Inventory to build real friendship over time — favorite gifts count double, and friendship milestones return the favor.',
    'Invite resident companions into your Party. Up to three follow you and jump into Wilds fights with guard, healing, and strike assists — friends, not captured monsters.',
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
    if (m >= 1080 && m < 1170) return 'square';
    if (m >= 1170 && m < 1290) return 'leisure';
    return 'home';
  }
  // Weather-aware override (living-world spec §3): on rain/snow days the
  // residents skip the plaza and pond-side leisure and head home instead.
  // Pure function of (minutes, day) plus the already-shared seed via
  // weatherForDay — co-op guests derive the identical answer with zero new
  // sync messages, same free-consistency property terrain already has.
  function effectiveNpcSegment(minutes, day) {
    const seg = npcSegment(minutes);
    if (seg === 'square' || seg === 'leisure') {
      const w = weatherForDay(day).kind;
      if (w === 'rain' || w === 'snow') return 'home';
    }
    return seg;
  }
  function faceToward(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    if (dx === 0 && dy === 0) return 'down';
    return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
  }

  // ---------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------
  function tryMove(dx, dy) {
    if (rt.world === 'wilds') { tryMoveWilds(dx, dy); return; }
    if (rt.paused || anyPanelOpen() || rt.moveT < 0.72) return;
    const nx = state.player.gx + dx, ny = state.player.gy + dy;
    rt.facing = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
    if (isBlockedTile(nx, ny)) { return; }
    rt.playerFromX = state.player.gx; rt.playerFromY = state.player.gy;
    state.player.gx = nx; state.player.gy = ny;
    rt.playerToX = nx; rt.playerToY = ny;
    rt.moveT = 0; rt.moveDur = rt.reducedMotion ? 40 : 150;
    sfx.step();
    rt.lastMiniMapKey = '';
    checkWorldDiscovery();
    updateNavigationHud();
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
      const t = terrainAt(n.x, n.y);
      if (t === 'shrine') return { kind: 'trial', trial: trialAt(n.x, n.y) };
      if (t === 'gate') return { kind: 'gate' };
      if (t === 'trailhead') return { kind: 'enterWilds' };
      const worldTile = worldTileAt(n.x, n.y);
      if (t === 'cache' && !isWorldCacheFound(worldTile.cacheId)) return { kind: 'worldCache', tile: worldTile, x: n.x, y: n.y };
    }
    // resource node adjacent?
    for (const n of neighbors4(p.gx, p.gy)) {
      if (!inBounds(n.x, n.y)) continue;
      const t = terrainAt(n.x, n.y);
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
    for (const def of SETTLEMENT_RESIDENTS) {
      const resident = settlementResidentPosition(def);
      if (Math.max(Math.abs(resident.gx - p.gx), Math.abs(resident.gy - p.gy)) <= 1 && !(resident.gx === p.gx && resident.gy === p.gy)) {
        return { kind: 'localTalk', resident };
      }
    }
    return null;
  }
  const CONTEXT_LABEL = {
    gather: 'Gather', fish: 'Fish', cook: 'Cook', sleep: 'Sleep', talk: 'Talk', trial: 'Trial', gate: 'Gate',
    harvest: 'Harvest', water: 'Water', plant: 'Plant', feed: 'Feed', collectEgg: 'Collect Eggs',
    enterWilds: 'Into the Wilds', attack: 'Strike', treasure: 'Search', gatherGlimmer: 'Gather', worldCache: 'Open Cache', localTalk: 'Talk',
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
    else if (it.kind === 'localTalk') openLocalDialogue(it.resident);
    else if (it.kind === 'trial') openTrial(it.trial);
    else if (it.kind === 'gate') openGate();
    else if (it.kind === 'harvest') harvestPlot(it.plot);
    else if (it.kind === 'water') waterPlot(it.plot);
    else if (it.kind === 'plant') openPanel('farming');
    else if (it.kind === 'feed') feedCoop(it.livestock);
    else if (it.kind === 'collectEgg') collectEgg(it.livestock);
    else if (it.kind === 'enterWilds') enterWilds();
    else if (it.kind === 'worldCache') collectWorldCache(it.tile, it.x, it.y);
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
    if (rt.paused || anyPanelOpen() || rt.wildsMoveT < 0.72) return;
    const nx = rt.wildsGx + dx, ny = rt.wildsGy + dy;
    rt.facing = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
    if (!inLegacyBounds(nx, ny)) return;
    const enemy = rt.wildsEnemies.find((e) => e.gx === nx && e.gy === ny && e.hp > 0);
    if (enemy) { hitPlayerContact(SPARK_WILDS_HIT); return; }
    if (isBlockedWildsTile(nx, ny)) return;
    rt.wildsFromX = rt.wildsGx; rt.wildsFromY = rt.wildsGy;
    rt.wildsGx = nx; rt.wildsGy = ny;
    rt.wildsToX = nx; rt.wildsToY = ny;
    rt.wildsMoveT = 0; rt.wildsMoveDur = rt.reducedMotion ? 40 : 150;
    sfx.step();
    rt.lastMiniMapKey = '';
    updateNavigationHud();
  }
  function findWildsInteraction() {
    const gx = rt.wildsGx, gy = rt.wildsGy;
    for (const n of neighbors4(gx, gy)) {
      if (!inLegacyBounds(n.x, n.y)) continue;
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
    const assist = partyAssistDamage(enemy);
    enemy.hp -= 1 + assist.damage;
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
          toast(`The Guardian falls with party help${assist.names.length ? ` (${assist.names.join(', ')})` : ''} — a Relic gleams where it stood!`);
        }
      } else {
        const n = 1 + Math.floor(Math.random() * 2);
        const k = ['grain', 'shale', 'loom'][Math.floor(Math.random() * 3)];
        state.inventory[k] = (state.inventory[k] || 0) + n;
        if (Math.random() < 0.2) state.inventory.lumen = (state.inventory.lumen || 0) + 1;
        const recovery = partyVictoryRecovery();
        toast(`The wilds creature scatters${assist.names.length ? ` — ${assist.names.join(', ')} assisted` : ''}.${recovery}`);
      }
    } else if (enemy.isGuardian && Math.random() < 0.5) {
      toast('The Guardian strikes back!');
      hitPlayerContact(Math.round(SPARK_WILDS_HIT / 2));
    } else {
      toast(`Hit${assist.names.length ? ` + ${assist.names.join(', ')}` : ''}! (${Math.max(0, enemy.hp)}/${enemy.maxHp})`);
    }
    updateHud();
    schedulePush();
  }
  function hitPlayerContact(amount) {
    const now = Date.now();
    if (rt.wildsInvulnUntil && now < rt.wildsInvulnUntil) return;
    rt.wildsInvulnUntil = now + 900;
    const guarded = partyGuard(amount);
    state.spark = clamp(state.spark - guarded.amount, 0, 100);
    sfx.fishMiss();
    spawnParticles(rt.wildsGx, rt.wildsGy, '#ff6b81');
    if (guarded.names.length && guarded.amount < amount) toast(`${guarded.names.join(', ')} guarded you — ${guarded.amount} Spark lost.`);
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
    if (!state.wilds.guardianDefeated && inLegacyBounds(GUARDIAN_TILE.x, GUARDIAN_TILE.y)) {
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
    rt.wildsCameraX = rt.wildsGx; rt.wildsCameraY = rt.wildsGy;
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
    rt.cameraX = state.player.gx; rt.cameraY = state.player.gy;
    rt.lastMiniMapKey = '';
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
      if (!inLegacyBounds(nx, ny) || isBlockedWildsTile(nx, ny)) continue;
      if (rt.wildsEnemies.some((o) => o !== en && o.gx === nx && o.gy === ny)) continue;
      en.gx = nx; en.gy = ny;
    }
  }
  function stepWildsMoveInterp(dt) {
    if (rt.wildsMoveT < 1) rt.wildsMoveT = Math.min(1, rt.wildsMoveT + dt * 1000 / (rt.wildsMoveDur || 150));
    const e = rt.wildsMoveT;
    const worldX = rt.wildsFromX + (rt.wildsToX - rt.wildsFromX) * e;
    const worldY = rt.wildsFromY + (rt.wildsToY - rt.wildsFromY) * e;
    rt.wildsCameraX = worldX; rt.wildsCameraY = worldY;
    const screen = tileToScreen(worldX, worldY);
    rt.wildsPx = screen.x; rt.wildsPy = screen.y;
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
    resetWorldChunks();
    clearFoundWildsTreasures();
    npcs = buildNpcRuntime();
    state.player.gx = clamp(state.player.gx, WORLD_MIN, WORLD_MAX);
    state.player.gy = clamp(state.player.gy, WORLD_MIN, WORLD_MAX);
    if (isBlockedTile(state.player.gx, state.player.gy)) { state.player.gx = 8; state.player.gy = 8; }
    rt.playerToX = state.player.gx; rt.playerToY = state.player.gy; rt.moveT = 1;
    rt.cameraX = state.player.gx; rt.cameraY = state.player.gy;
  }
  function onMatchState(d) {
    const wasActive = mp.active;
    mp.active = true;
    mp.participants = Array.isArray(d.participants) ? d.participants : mp.participants;
    const ms = d.matchState && typeof d.matchState === 'object' ? d.matchState : {};
    if (typeof ms.seed === 'number' && ms.seed !== state.seed && !mp.amIHost) adoptSharedSeed(ms.seed);
    if (Array.isArray(ms.town)) mp.sharedTown = ms.town.filter((p) => p && PALETTE_BY_TYPE[p.type] && Number.isFinite(p.gx) && Number.isFinite(p.gy))
      .map((p) => ({ ...p, gx: clamp(Math.floor(p.gx), WORLD_MIN, WORLD_MAX), gy: clamp(Math.floor(p.gy), WORLD_MIN, WORLD_MAX) }));
    if (Array.isArray(ms.farm)) {
      mp.sharedFarm = ms.farm
        .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.crop == null || CROP_BY_KEY[p.crop]))
        .map((p) => ({ x: clamp(Math.floor(p.x), WORLD_MIN, WORLD_MAX), y: clamp(Math.floor(p.y), WORLD_MIN, WORLD_MAX), crop: p.crop || null, prog: Number.isFinite(p.prog) ? Math.max(0, p.prog) : 0, watered: !!p.watered, dryStreak: Number.isFinite(p.dryStreak) ? p.dryStreak : 0, fertileUntilDay: Number.isFinite(p.fertileUntilDay) ? p.fertileUntilDay : 0 }));
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
    el.clockNote.textContent = `${seg[0].toUpperCase() + seg.slice(1)} · ${weatherForDay(state.day).label}${rt.world === 'wilds' ? ' · In the Wilds' : ''}`;
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
    updateNavigationHud();
  }
  function stepHeldMovement(t) {
    if (!rt.heldKeys.size || rt.paused || anyPanelOpen() || t < rt.nextHeldMoveAt) return;
    const ordered = Array.from(rt.heldKeys).reverse();
    let move = null;
    for (const key of ordered) {
      if (key === 'w' || key === 'arrowup') { move = [0, -1]; break; }
      if (key === 's' || key === 'arrowdown') { move = [0, 1]; break; }
      if (key === 'a' || key === 'arrowleft') { move = [-1, 0]; break; }
      if (key === 'd' || key === 'arrowright') { move = [1, 0]; break; }
    }
    if (!move) return;
    tryMove(move[0], move[1]);
    const onRoad = rt.world === 'town' && ['road', 'trail', 'bridge'].includes(terrainAt(state.player.gx, state.player.gy));
    rt.nextHeldMoveAt = t + (rt.reducedMotion ? 70 : onRoad ? 112 : 148);
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
    // Hard cap so burst-heavy moments can never grow the particle array unbounded.
    if (rt.particles.length > 240) rt.particles.splice(0, rt.particles.length - 240);
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
  function diamondPath(cx, cy, w, h) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy);
    ctx.lineTo(cx, cy + h / 2);
    ctx.lineTo(cx - w / 2, cy);
    ctx.closePath();
  }
  function drawDiamond(cx, cy, w, h, fill, stroke) {
    diamondPath(cx, cy, w, h);
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
  function motionPulse(speed, phase = 0, base = 0.6, amount = 0.15) {
    return rt.reducedMotion ? base : base + amount * Math.sin(performance.now() / speed + phase);
  }
  function drawWaterSurface(cx, cy, w, h, variant = 0.5, phase = 0, live = false) {
    const wobble = rt.reducedMotion ? 0 : phase;
    ctx.save();
    diamondPath(cx, cy, w, h);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, cy - h * 0.55, 0, cy + h * 0.55);
    grad.addColorStop(0, live ? '#69dcf4' : '#45bde0');
    grad.addColorStop(0.55, '#2088c1');
    grad.addColorStop(1, '#106194');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    const glow = ctx.createRadialGradient(cx - w * 0.08, cy - h * 0.1, h * 0.02, cx - w * 0.08, cy - h * 0.1, w * 0.5);
    glow.addColorStop(0, live ? 'rgba(240,255,255,0.34)' : 'rgba(240,255,255,0.2)');
    glow.addColorStop(0.45, 'rgba(92,223,255,0.12)');
    glow.addColorStop(1, 'rgba(8,36,78,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, 1.05 * rt.dpr);
    const lineCount = live ? 2 : 1;
    for (let i = 0; i < lineCount; i++) {
      const drift = Math.sin(wobble * (0.7 + i * 0.12) + variant * 5 + i) * w * 0.08;
      const y = cy + (i - 0.5) * h * 0.15 + Math.cos(wobble * 0.6 + i) * h * 0.035;
      ctx.globalAlpha = live ? 0.16 : 0.07;
      ctx.strokeStyle = i % 2 ? '#d8fbff' : '#8defff';
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.38 + drift, y);
      ctx.bezierCurveTo(cx - w * 0.1 + drift * 0.25, y - h * 0.055, cx + w * 0.12 - drift, y + h * 0.055, cx + w * 0.38 - drift * 0.3, y);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawLivingFire(cx, baseY, scale = 1, phase = 0) {
    const u = rt.tileH * scale;
    const flicker = rt.reducedMotion ? 0 : Math.sin(phase * 7.2) * 0.12 + Math.sin(phase * 12.9) * 0.06;
    ctx.save();
    const glow = ctx.createRadialGradient(cx, baseY - u * 0.5, u * 0.05, cx, baseY - u * 0.45, u * 1.35);
    glow.addColorStop(0, 'rgba(255,220,102,0.48)');
    glow.addColorStop(0.35, 'rgba(255,96,48,0.24)');
    glow.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, baseY - u * 0.42, u * 1.35, 0, Math.PI * 2); ctx.fill();
    const flame = (offset, width, height, color, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx + offset - width * 0.5, baseY);
      ctx.bezierCurveTo(cx + offset - width * 0.8, baseY - height * 0.34, cx + offset - width * 0.22, baseY - height * 0.76, cx + offset + flicker * u, baseY - height);
      ctx.bezierCurveTo(cx + offset + width * 0.42, baseY - height * 0.62, cx + offset + width * 0.78, baseY - height * 0.24, cx + offset + width * 0.46, baseY);
      ctx.closePath();
      ctx.fill();
    };
    flame(-u * 0.06, u * 0.62, u * 1.38, '#ff5a2e', 0.9);
    flame(u * 0.1, u * 0.42, u * 1.03, '#ffb32d', 0.86);
    flame(-u * 0.02, u * 0.22, u * 0.66, '#fff1a0', 0.88);
    if (!rt.reducedMotion) {
      for (let i = 0; i < 5; i++) {
        const k = ((phase * 0.7 + i * 0.21) % 1);
        ctx.globalAlpha = (1 - k) * 0.62;
        ctx.fillStyle = i % 2 ? '#ffd45a' : '#ff8054';
        ctx.beginPath();
        ctx.arc(cx + Math.sin(phase * 2 + i * 1.7) * u * 0.42, baseY - u * (0.5 + k * 1.15), Math.max(1.2 * rt.dpr, u * (0.035 + k * 0.015)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  const TERRAIN_COLOR = {
    grass: '#3a6b4a', meadow: '#5d8d53', forestfloor: '#426f47', stonegrass: '#727c73', sungrass: '#878348', frostgrass: '#738f95',
    trail: '#9f7f58', road: '#a9855c', bridge: '#ba9564', grove: '#2f7a4d', quarry: '#7b7f8c', reed: '#6d995e', water: '#3f8ec9',
    marsh: '#557969', cliff: '#646a6e', field: '#8e7a3f', cottage: '#c97b61', landmark: '#b99a59', shrine: '#5b4aa8', gate: '#2f2448', trailhead: '#caa06a', cache: '#7b6847',
  };
  const NATURAL_GROUND_TYPES = new Set(['grass', 'meadow', 'forestfloor', 'stonegrass', 'sungrass', 'frostgrass']);
  function drawTerrainTile(gx, gy, tileInput) {
    const tile = typeof tileInput === 'string' ? { type: tileInput, baseType: tileInput, biome: 'hearthland', variant: 0.5, poiId: null, cacheId: null } : tileInput;
    const t = tile.type === 'cache' && isWorldCacheFound(tile.cacheId) ? tile.baseType : tile.type;
    const s = tileToScreen(gx, gy);
    const biomeGround = BIOME_DEFS[tile.biome]?.ground || TERRAIN_COLOR.grass;
    const top = t === 'grass' ? SEASON_GRASS[seasonOf(state.day)] : NATURAL_GROUND_TYPES.has(t) ? biomeGround : (TERRAIN_COLOR[t] || biomeGround);
    if (t === 'water') {
      drawWaterSurface(s.x, s.y, rt.tileW * 1.12, rt.tileH * 1.12, tile.variant, 0, false);
    } else {
      drawDiamond(s.x, s.y, rt.tileW, rt.tileH, top, 'rgba(0,0,0,0.18)');
    }
    if (t === 'grove') {
      drawBlock(s.x, s.y, rt.tileW * 0.18, rt.tileH * 0.18, rt.tileH * 1.15, '#8c6245', '#68442f', '#4f3427');
      ctx.fillStyle = shade(top, 1.1);
      ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 1.65, rt.tileH * 0.68, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(top, 0.88);
      ctx.beginPath(); ctx.arc(s.x - rt.tileH * 0.36, s.y - rt.tileH * 1.35, rt.tileH * 0.48, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s.x + rt.tileH * 0.4, s.y - rt.tileH * 1.4, rt.tileH * 0.5, 0, Math.PI * 2); ctx.fill();
    } else if (t === 'quarry' || t === 'reed') {
      drawBlock(s.x, s.y, rt.tileW * 0.36, rt.tileH * 0.36, rt.tileH * (t === 'reed' ? 0.85 : 0.7), shade(top, 1.25), shade(top, 0.75), shade(top, 0.55));
    } else if (t === 'cliff') {
      drawBlock(s.x, s.y, rt.tileW * 0.9, rt.tileH * 0.9, rt.tileH * (1.0 + tile.variant * 0.65), shade(top, 1.1), shade(top, 0.72), shade(top, 0.56));
    }
    // NOTE: animated adornments (water shimmer, shrine/landmark/cache/
    // trailhead pulses, cottage windows/smoke) are drawn per-frame by
    // drawAnimatedTiles(); this function renders only the static body so its
    // output can be cached in the offscreen terrain layer.
    if (t === 'marsh') {
      ctx.save(); ctx.strokeStyle = '#9bc6a2'; ctx.lineWidth = 1.5 * rt.dpr; ctx.globalAlpha = 0.7;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(s.x + i * rt.tileW * 0.14, s.y); ctx.lineTo(s.x + i * rt.tileW * 0.1, s.y - rt.tileH * (0.35 + (i + 1) * 0.12)); ctx.stroke();
      }
      ctx.restore();
    }
    if (t === 'field') {
      ctx.save(); ctx.strokeStyle = '#e1c66a'; ctx.globalAlpha = 0.58; ctx.lineWidth = 1.25 * rt.dpr;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(s.x - rt.tileW * 0.28 + i * rt.tileW * 0.08, s.y - rt.tileH * 0.05); ctx.lineTo(s.x + i * rt.tileW * 0.08, s.y + rt.tileH * 0.22); ctx.stroke();
      }
      ctx.restore();
    }
    if (t === 'road' || t === 'trail') {
      ctx.save(); ctx.globalAlpha = 0.32; ctx.fillStyle = '#f2d59a';
      const ox = (tile.variant - 0.5) * rt.tileW * 0.28;
      ctx.beginPath(); ctx.arc(s.x + ox, s.y, 1.5 * rt.dpr, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (t === 'bridge') {
      ctx.save(); ctx.strokeStyle = '#6f4d35'; ctx.lineWidth = 2 * rt.dpr;
      ctx.beginPath(); ctx.moveTo(s.x - rt.tileW * 0.32, s.y - rt.tileH * 0.04); ctx.lineTo(s.x, s.y + rt.tileH * 0.27); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x, s.y - rt.tileH * 0.27); ctx.lineTo(s.x + rt.tileW * 0.32, s.y + rt.tileH * 0.04); ctx.stroke(); ctx.restore();
    }
    if (t === 'cottage') {
      const wall = '#e9c590', roof = tile.variant > 0.5 ? '#c85f5d' : '#5f8f91';
      drawBlock(s.x, s.y, rt.tileW * 0.74, rt.tileH * 0.74, rt.tileH * 1.25, wall, shade(wall, 0.78), shade(wall, 0.62));
      drawBlock(s.x, s.y - rt.tileH * 1.22, rt.tileW * 0.84, rt.tileH * 0.84, rt.tileH * 0.35, shade(roof, 1.08), shade(roof, 0.75), shade(roof, 0.58));
      ctx.fillStyle = '#402b2d'; ctx.fillRect(s.x - 2 * rt.dpr, s.y - rt.tileH * 0.95, 4 * rt.dpr, rt.tileH * 0.62);
    }
    if (t === 'landmark') {
      const poi = WORLD_POI_BY_ID[tile.poiId];
      const discovered = poi && state.exploration.discovered.includes(poi.id);
      const color = poi?.kind === 'farm' ? '#e4b84f' : poi?.kind === 'settlement' ? '#e67d68' : '#8f91d8';
      drawBlock(s.x, s.y, rt.tileW * 0.34, rt.tileH * 0.34, rt.tileH * 1.7, shade(color, 1.15), shade(color, 0.72), shade(color, 0.55));
      void discovered; // discovery ring is animated → drawAnimatedTiles()
    }
    if (tile.type === 'cache' && !isWorldCacheFound(tile.cacheId)) {
      drawBlock(s.x, s.y, rt.tileW * 0.38, rt.tileH * 0.38, rt.tileH * 0.45, '#d2a65f', '#80593d', '#65432f');
    }
    if (NATURAL_GROUND_TYPES.has(t) && tile.variant > 0.965) {
      ctx.save(); ctx.fillStyle = tile.biome === 'frostwood' ? '#d7f4ff' : '#ffd27f'; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(s.x + rt.tileW * 0.16, s.y - rt.tileH * 0.17, 1.6 * rt.dpr, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (t === 'shrine') {
      const trial = trialAt(gx, gy);
      const done = trial && state.adventure?.trials?.[trial.id]?.done;
      drawBlock(s.x, s.y, rt.tileW * 0.58, rt.tileH * 0.58, rt.tileH * 1.55, done ? '#5be3b5' : '#c792ea', '#34255b', '#211638');
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
    if (piece.type === 'hearth') {
      // The hearth should read as flame and warmth, not an orange block.
      const phase = rt.playSecondsAccum + piece.gx * 0.41 + piece.gy * 0.29;
      ctx.save();
      ctx.fillStyle = '#301811';
      ctx.globalAlpha = 0.78;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y - hgt - rt.tileH * 0.08, rt.tileW * 0.18, rt.tileH * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      drawLivingFire(s.x, s.y - hgt - rt.tileH * 0.02, 0.62, phase);
      if (!rt.reducedMotion) drawSmoke(s.x, s.y - hgt - rt.tileH * 0.9, piece.gx * 5 + piece.gy * 11);
    }
    if (piece.type === 'watchtower') {
      // Rippling flag atop the tower.
      const fx = s.x + rt.tileW * 0.06, fy = s.y - hgt - rt.tileH * 0.95;
      ctx.save();
      ctx.strokeStyle = '#6f5a3c'; ctx.lineWidth = 1.6 * rt.dpr;
      ctx.beginPath(); ctx.moveTo(fx, fy + rt.tileH * 0.95); ctx.lineTo(fx, fy); ctx.stroke();
      const rip = rt.reducedMotion ? 0 : Math.sin(rt.playSecondsAccum * 3.1 + piece.gx) * rt.tileH * 0.09;
      ctx.fillStyle = '#ff8a5c';
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + rt.tileW * 0.24, fy + rt.tileH * 0.14 + rip); ctx.lineTo(fx, fy + rt.tileH * 0.3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    if (piece.type === 'coop') {
      const l = currentLivestock().find((x) => x.pieceId === piece.id);
      if (l && l.readyToCollect) {
        ctx.save(); ctx.globalAlpha = motionPulse(300, piece.gx + piece.gy, 0.7, 0.2);
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
        ctx.globalAlpha = motionPulse(320, plot.x + plot.y, 0.55, 0.2);
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
  function characterLook(key) {
    let h = 2166136261;
    for (const ch of String(key || 'resident')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    const skins = ['#f7d7bd', '#e8b88f', '#c98d68', '#8d5d48', '#f0c6a2'];
    const hairs = ['#3a2928', '#6b4635', '#d6a64d', '#202735', '#8a4e35', '#d7d2c6'];
    return { skin: skins[(h >>> 0) % skins.length], hair: hairs[((h >>> 5) >>> 0) % hairs.length], style: ((h >>> 11) >>> 0) % 4 };
  }
  // opts: { facing: 'down'|'left'|'right'|'up', sway: px head-lean for idle
  // weight shifts, stretch: arms-overhead idle pose }. Facing is the fix for
  // the "everyone stares at the player" complaint: 'up' renders the back of
  // the head (no face), left/right render an offset three-quarter profile.
  function drawCharacter(px, py, hueColor, topper, trimColor, label, mini, characterKey = 'resident', expression = 'calm', opts = null) {
    const scale = mini ? 0.72 : 1;
    const u = rt.tileH * scale;
    const look = characterLook(characterKey);
    const face = (opts && opts.facing) || 'down';
    const sway = (opts && opts.sway) || 0;
    const stretch = !!(opts && opts.stretch);
    const bob = rt.reducedMotion ? 0 : Math.sin(rt.playSecondsAccum * 2.4 + (characterKey.length || 1)) * u * 0.025;
    const groundY = py - 2 * rt.dpr + bob;
    const headY = groundY - u * 1.78;
    const headRx = u * 0.48, headRy = u * 0.55;
    const hx = px + sway;
    const shoulderY = groundY - u * 1.24;
    ctx.save();

    // Soft shadow and separate feet/legs keep the silhouette human at tiny scale.
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#08060e';
    ctx.beginPath(); ctx.ellipse(px, py + 2 * rt.dpr, u * 0.56, u * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = shade(hueColor, 0.52); ctx.lineWidth = u * 0.18; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(px - u * 0.18, groundY - u * 0.58); ctx.lineTo(px - u * 0.2, groundY - u * 0.12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + u * 0.18, groundY - u * 0.58); ctx.lineTo(px + u * 0.2, groundY - u * 0.12); ctx.stroke();
    ctx.fillStyle = '#332d3e';
    ctx.beginPath(); ctx.ellipse(px - u * 0.23, groundY - u * 0.04, u * 0.2, u * 0.11, -0.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(px + u * 0.23, groundY - u * 0.04, u * 0.2, u * 0.11, 0.1, 0, Math.PI * 2); ctx.fill();

    // Rounded shoulders, tapered torso, arms, and hands.
    ctx.fillStyle = hueColor;
    ctx.beginPath();
    ctx.moveTo(px - u * 0.5, shoulderY + u * 0.12);
    ctx.quadraticCurveTo(px, shoulderY - u * 0.2, px + u * 0.5, shoulderY + u * 0.12);
    ctx.lineTo(px + u * 0.35, groundY - u * 0.52);
    ctx.quadraticCurveTo(px, groundY - u * 0.38, px - u * 0.35, groundY - u * 0.52);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = trimColor; ctx.lineWidth = 1.5 * rt.dpr; ctx.stroke();
    ctx.strokeStyle = shade(hueColor, 0.78); ctx.lineWidth = u * 0.16;
    if (stretch) {
      // Arms raised overhead — the idle stretch pose.
      ctx.beginPath(); ctx.moveTo(px - u * 0.4, shoulderY + u * 0.16); ctx.lineTo(px - u * 0.34, headY - headRy * 1.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px + u * 0.4, shoulderY + u * 0.16); ctx.lineTo(px + u * 0.34, headY - headRy * 1.05); ctx.stroke();
      ctx.fillStyle = look.skin;
      ctx.beginPath(); ctx.arc(px - u * 0.34, headY - headRy * 1.1, u * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + u * 0.34, headY - headRy * 1.1, u * 0.1, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(px - u * 0.4, shoulderY + u * 0.16); ctx.lineTo(px - u * 0.53, groundY - u * 0.56); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px + u * 0.4, shoulderY + u * 0.16); ctx.lineTo(px + u * 0.53, groundY - u * 0.56); ctx.stroke();
      ctx.fillStyle = look.skin;
      ctx.beginPath(); ctx.arc(px - u * 0.54, groundY - u * 0.5, u * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + u * 0.54, groundY - u * 0.5, u * 0.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = look.skin;
    ctx.fillRect(hx - u * 0.09, shoulderY - u * 0.08, u * 0.18, u * 0.23);

    // Oval head + ears (head leans by `sway` for idle weight shifts).
    ctx.fillStyle = look.skin;
    ctx.beginPath(); ctx.ellipse(hx - headRx * 0.98, headY, headRx * 0.18, headRy * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hx + headRx * 0.98, headY, headRx * 0.18, headRy * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hx, headY, headRx, headRy, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(70,42,40,0.28)'; ctx.lineWidth = 1.2 * rt.dpr; ctx.stroke();
    ctx.fillStyle = look.hair;
    if (face === 'up') {
      // Back of the head: hair covers where the face would be.
      ctx.beginPath(); ctx.ellipse(hx, headY - headRy * 0.04, headRx, headRy * 0.97, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(hx, headY - headRy * 0.2, headRx * 1.02, Math.PI, Math.PI * 2);
      if (look.style === 0) ctx.quadraticCurveTo(hx + headRx * 0.2, headY - headRy * 0.14, hx - headRx * 0.62, headY - headRy * 0.02);
      else if (look.style === 1) ctx.quadraticCurveTo(hx, headY + headRy * 0.05, hx - headRx * 0.82, headY - headRy * 0.05);
      else if (look.style === 2) ctx.quadraticCurveTo(hx - headRx * 0.15, headY - headRy * 0.3, hx - headRx * 0.78, headY + headRy * 0.05);
      else ctx.quadraticCurveTo(hx + headRx * 0.55, headY - headRy * 0.25, hx - headRx * 0.72, headY);
      ctx.closePath(); ctx.fill();
      if (look.style === 1 || look.style === 3) {
        ctx.beginPath(); ctx.ellipse(hx + headRx * 0.86, headY + headRy * 0.1, headRx * 0.2, headRy * 0.55, 0.08, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (face !== 'up') {
      const side = face === 'left' ? -1 : face === 'right' ? 1 : 0;
      const ex = hx + side * headRx * 0.3;
      const spread = side === 0 ? 0.22 : 0.15;
      const eyeY = headY + headRy * 0.06;
      ctx.strokeStyle = shade(look.hair, 0.72); ctx.lineWidth = 1.3 * rt.dpr; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ex - headRx * (spread + 0.1), eyeY - headRy * 0.22); ctx.lineTo(ex - headRx * (spread - 0.08), eyeY - headRy * 0.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex + headRx * (spread - 0.08), eyeY - headRy * 0.2); ctx.lineTo(ex + headRx * (spread + 0.1), eyeY - headRy * 0.22); ctx.stroke();
      ctx.fillStyle = '#fffaf2';
      ctx.beginPath(); ctx.ellipse(ex - headRx * spread, eyeY, headRx * 0.14, headRy * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ex + headRx * spread, eyeY, headRx * 0.14, headRy * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#302538';
      const pupilShift = side * headRx * 0.04;
      ctx.beginPath(); ctx.arc(ex - headRx * spread + pupilShift, eyeY, headRx * 0.065, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + headRx * spread + pupilShift, eyeY, headRx * 0.065, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(224,103,111,0.3)';
      if (side <= 0) { ctx.beginPath(); ctx.ellipse(hx - headRx * 0.48, eyeY + headRy * 0.22, headRx * 0.12, headRy * 0.07, 0, 0, Math.PI * 2); ctx.fill(); }
      if (side >= 0) { ctx.beginPath(); ctx.ellipse(hx + headRx * 0.48, eyeY + headRy * 0.22, headRx * 0.12, headRy * 0.07, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = '#814f55'; ctx.lineWidth = 1.4 * rt.dpr;
      ctx.beginPath();
      if (expression === 'happy' || expression === 'bright') ctx.arc(ex, eyeY + headRy * 0.18, headRx * 0.18, 0.08, Math.PI - 0.08);
      else { ctx.moveTo(ex - headRx * 0.12, eyeY + headRy * 0.28); ctx.quadraticCurveTo(ex, eyeY + headRy * 0.34, ex + headRx * 0.12, eyeY + headRy * 0.27); }
      ctx.stroke();
    }

    const headTopY = headY - headRy;
    const headSize = headRx * 2;
    if (topper === 'cap') {
      ctx.fillStyle = shade(hueColor, 0.6);
      ctx.beginPath(); ctx.ellipse(hx, headTopY + headRy * 0.12, headRx * 0.92, headRy * 0.28, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(hx - headRx * 0.08, headTopY - headRy * 0.24, headRx * 0.8, headRy * 0.13);
    } else if (topper === 'bloom') {
      ctx.fillStyle = '#ff7fb0'; ctx.beginPath(); ctx.arc(hx, headTopY, headSize * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe27a'; ctx.beginPath(); ctx.arc(hx, headTopY, headSize * 0.08, 0, Math.PI * 2); ctx.fill();
    } else if (topper === 'halo') {
      ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 2.5 * rt.dpr; ctx.beginPath(); ctx.ellipse(hx, headTopY - headSize * 0.15, headSize * 0.4, headSize * 0.14, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (topper === 'crest' || topper === 'crown') {
      ctx.fillStyle = '#ffd54f'; ctx.beginPath(); ctx.moveTo(hx - headSize * 0.42, headTopY + headSize * 0.13); ctx.lineTo(hx - headSize * 0.25, headTopY - headSize * 0.25); ctx.lineTo(hx, headTopY + headSize * 0.02); ctx.lineTo(hx + headSize * 0.26, headTopY - headSize * 0.25); ctx.lineTo(hx + headSize * 0.42, headTopY + headSize * 0.13); ctx.closePath(); ctx.fill();
    } else if (topper === 'leaf') {
      ctx.fillStyle = '#78d36f'; ctx.beginPath(); ctx.ellipse(hx, headTopY - headSize * 0.12, headSize * 0.34, headSize * 0.16, -0.55, 0, Math.PI * 2); ctx.fill();
    }
    if (label) {
      ctx.font = `700 ${10 * rt.dpr}px ui-monospace,monospace`; ctx.textAlign = 'center';
      const width = ctx.measureText(label).width + 9 * rt.dpr;
      ctx.fillStyle = 'rgba(25,16,38,0.76)'; roundRect(px - width / 2, headTopY - headSize * 0.72, width, 15 * rt.dpr, 4 * rt.dpr); ctx.fill();
      ctx.fillStyle = '#fbe9d8'; ctx.fillText(label, px, headTopY - headSize * 0.72 + 11 * rt.dpr);
    }
    ctx.restore();
  }
  function drawPartyFollowers(px, py, wilds = false) {
    const members = activeCompanions();
    if (!members.length) return;
    const spread = rt.tileW * (wilds ? 0.34 : 0.28);
    const bobBase = rt.reducedMotion ? 0 : Math.sin(rt.playSecondsAccum * 3.1) * rt.tileH * 0.08;
    const offsets = [
      { x: -spread, y: rt.tileH * 0.46 },
      { x: spread, y: rt.tileH * 0.5 },
      { x: 0, y: rt.tileH * 0.83 },
    ];
    for (let i = 0; i < members.length; i++) {
      const off = offsets[i] || offsets[offsets.length - 1];
      drawCompanion(members[i], px + off.x, py + off.y + bobBase * (i % 2 ? -0.6 : 1), i, wilds);
    }
  }
  function drawCompanion(comp, px, py, index = 0, wilds = false) {
    const u = rt.tileH * (wilds ? 0.78 : 0.68);
    const t = rt.playSecondsAccum + index * 0.9;
    const hover = rt.reducedMotion ? 0 : Math.sin(t * 4.2) * u * 0.08;
    const y = py + hover;
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = '#06040a';
    ctx.beginPath(); ctx.ellipse(px, py + u * 0.28, u * 0.62, u * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    const glow = ctx.createRadialGradient(px, y - u * 0.45, u * 0.05, px, y - u * 0.45, u * 1.1);
    glow.addColorStop(0, `${comp.color}88`);
    glow.addColorStop(1, `${comp.color}00`);
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(px, y - u * 0.42, u * 1.05, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = shade(comp.color, 0.82);
    if (comp.id.includes('moth') || comp.id.includes('wisp')) {
      ctx.beginPath(); ctx.ellipse(px - u * 0.48, y - u * 0.48, u * 0.38, u * 0.24, -0.55, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(px + u * 0.48, y - u * 0.48, u * 0.38, u * 0.24, 0.55, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(px - u * 0.34, y - u * 0.72); ctx.lineTo(px - u * 0.08, y - u * 1.06); ctx.lineTo(px + u * 0.08, y - u * 0.7); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(px + u * 0.34, y - u * 0.72); ctx.lineTo(px + u * 0.08, y - u * 1.06); ctx.lineTo(px - u * 0.08, y - u * 0.7); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = comp.color;
    ctx.beginPath(); ctx.ellipse(px, y - u * 0.52, u * 0.46, u * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.38)'; ctx.lineWidth = 1.2 * rt.dpr; ctx.stroke();
    ctx.fillStyle = '#fbe9d8';
    ctx.beginPath(); ctx.arc(px - u * 0.14, y - u * 0.57, u * 0.045, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + u * 0.14, y - u * 0.57, u * 0.045, 0, Math.PI * 2); ctx.fill();
    ctx.font = `800 ${Math.max(8, 9 * rt.dpr)}px ui-monospace,monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#130c20';
    ctx.fillText(comp.glyph, px, y - u * 0.31);
    if (wilds) {
      ctx.font = `800 ${8 * rt.dpr}px ui-monospace,monospace`;
      ctx.fillStyle = comp.color;
      ctx.fillText(comp.short, px, y - u * 1.06);
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

  // -------------------------------------------------------------------
  // NPC activity props: tools swung at work, carried goods while walking
  // between buildings, and idle chat speech bubbles. All visual-only.
  // -------------------------------------------------------------------
  function spawnWorkChips(x, y, color, count = 3) {
    if (rt.reducedMotion) return;
    for (let i = 0; i < count; i++) {
      rt.particles.push({ x, y, vx: (Math.random() - 0.5) * 46, vy: -Math.random() * 60 - 24, life: 0.35 + Math.random() * 0.25, color });
    }
    if (rt.particles.length > 240) rt.particles.splice(0, rt.particles.length - 240);
  }
  const NPC_ACTIVITY = { grove: 'chop', quarry: 'mine', reed: 'reap', water: 'fish', shrine: 'sweep', gate: 'scribe' };
  function drawChatBubble(px, topY, glyph) {
    ctx.save();
    ctx.font = `700 ${9 * rt.dpr}px ui-monospace,monospace`;
    ctx.textAlign = 'center';
    const w = ctx.measureText(glyph).width + 10 * rt.dpr;
    const h = 13 * rt.dpr;
    ctx.fillStyle = 'rgba(251,233,216,0.92)';
    roundRect(px + 7 * rt.dpr - w / 2, topY - h, w, h, 4 * rt.dpr);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(px + 3 * rt.dpr, topY); ctx.lineTo(px + 9 * rt.dpr, topY); ctx.lineTo(px + 4 * rt.dpr, topY + 4 * rt.dpr); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a2a44';
    ctx.fillText(glyph, px + 7 * rt.dpr, topY - 3.6 * rt.dpr);
    ctx.restore();
  }
  function drawNpcExtras(n) {
    const u = rt.tileH;
    const px = n.screenPx, py = n.screenPy;
    const t = rt.playSecondsAccum;
    const groundY = py - 2 * rt.dpr;
    const idle = npcIsIdle(n);
    if (n.carrying && !idle) {
      // Visible carried bundle while walking goods away from the workplace.
      ctx.save();
      ctx.fillStyle = n.carrying;
      const bx = px + (n.facing === 'left' ? -u * 0.55 : u * 0.55);
      roundRect(bx - u * 0.22, groundY - u * 0.95, u * 0.44, u * 0.4, 2 * rt.dpr); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1 * rt.dpr; ctx.stroke();
      ctx.restore();
    }
    if (n.chatWith) {
      const speakerFirst = n.id < n.chatWith;
      const bucket = Math.floor(t / 2.4);
      if ((bucket % 2 === 0) === speakerFirst) {
        const glyph = ['…', '!', '♪'][hashU32(bucket, n.id.length, state.seed, 0xc4a7) % 3];
        drawChatBubble(px, groundY - u * 2.75, glyph);
      }
    }
    if (!idle || n.segment !== 'work') return;
    const act = NPC_ACTIVITY[n.def.resourceType];
    if (!act) return;
    const side = n.workFace === 'left' ? -1 : 1;
    const swing = rt.reducedMotion ? 0.35 : Math.sin(t * 4.4 + n.idlePhase);
    if (act === 'mine' || act === 'chop') {
      // Pick/axe swing arc toward the resource node, with chips at the apex.
      ctx.save();
      ctx.translate(px + side * u * 0.42, groundY - u * 0.85);
      ctx.rotate(side * (0.55 + swing * 0.65));
      ctx.strokeStyle = '#8a5f3c'; ctx.lineWidth = u * 0.1; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -u * 0.78); ctx.stroke();
      ctx.fillStyle = act === 'mine' ? '#aeb9cf' : '#8f979f';
      if (act === 'mine') { roundRect(-u * 0.3, -u * 0.94, u * 0.6, u * 0.16, 2 * rt.dpr); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(0, -u * 0.92); ctx.lineTo(side * u * 0.34, -u * 0.8); ctx.lineTo(0, -u * 0.62); ctx.closePath(); ctx.fill(); }
      ctx.restore();
      if (!rt.reducedMotion && swing > 0.94 && t - n.lastChipAt > 1.0) {
        n.lastChipAt = t;
        const s2 = n.resTile ? tileToScreen(n.resTile.x, n.resTile.y) : { x: px + side * u, y: py };
        spawnWorkChips(s2.x, s2.y - u * 0.7, act === 'mine' ? '#aeb9cf' : '#caa06a');
      }
    } else if (act === 'fish' && n.resTile) {
      // Rod, line down to the water tile, bobbing float, and lapping ripple.
      const s2 = tileToScreen(n.resTile.x, n.resTile.y);
      const hx2 = px + side * u * 0.5, hy2 = groundY - u * 0.95;
      const tipX = hx2 + side * u * 0.85, tipY = hy2 - u * 0.75;
      ctx.save();
      ctx.strokeStyle = '#8a5f3c'; ctx.lineWidth = u * 0.08; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx2, hy2); ctx.lineTo(tipX, tipY); ctx.stroke();
      const bobY = s2.y + (rt.reducedMotion ? 0 : Math.sin(t * 2.1 + n.idlePhase) * 1.8 * rt.dpr);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1 * rt.dpr;
      ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.quadraticCurveTo(tipX, (tipY + bobY) / 2 + u * 0.3, s2.x, bobY); ctx.stroke();
      ctx.fillStyle = '#ff6b4a';
      ctx.beginPath(); ctx.arc(s2.x, bobY, 1.8 * rt.dpr, 0, Math.PI * 2); ctx.fill();
      if (!rt.reducedMotion) {
        const k = ((t * 0.6 + n.idlePhase) % 2.6) / 2.6;
        if (k < 0.6) {
          ctx.globalAlpha = (1 - k / 0.6) * 0.45;
          ctx.strokeStyle = '#dff4ff';
          ctx.beginPath(); ctx.ellipse(s2.x, s2.y, u * (0.14 + k * 0.5), u * (0.07 + k * 0.25), 0, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.restore();
    } else if (act === 'sweep' || act === 'reap') {
      // Broom / sickle sweep with occasional dust or reed wisps.
      ctx.save();
      ctx.translate(px + side * u * 0.4, groundY - u * 0.7);
      ctx.rotate(side * (0.9 + (rt.reducedMotion ? 0 : Math.sin(t * 3.1 + n.idlePhase) * 0.28)));
      ctx.strokeStyle = '#8a5f3c'; ctx.lineWidth = u * 0.08; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -u * 0.5); ctx.lineTo(0, u * 0.55); ctx.stroke();
      ctx.fillStyle = act === 'sweep' ? '#caa06a' : '#78d36f';
      roundRect(-u * 0.16, u * 0.5, u * 0.32, u * 0.2, 2 * rt.dpr); ctx.fill();
      ctx.restore();
      if (!rt.reducedMotion && t - n.lastChipAt > 2.4) {
        n.lastChipAt = t;
        spawnWorkChips(px + side * u * 0.8, groundY - u * 0.2, act === 'sweep' ? '#cbb691' : '#9fe08f', 2);
      }
    } else if (act === 'scribe') {
      // Open ledger held in front — the archivist reads at his post.
      ctx.save();
      ctx.fillStyle = '#fbe9d8';
      const bx = px + side * u * 0.42;
      roundRect(bx - u * 0.26, groundY - u * 1.05, u * 0.52, u * 0.34, 1.5 * rt.dpr); ctx.fill();
      ctx.strokeStyle = 'rgba(60,40,60,0.6)'; ctx.lineWidth = 1 * rt.dpr;
      ctx.beginPath(); ctx.moveTo(bx, groundY - u * 1.05); ctx.lineTo(bx, groundY - u * 0.71); ctx.stroke();
      ctx.restore();
    }
  }

  // -------------------------------------------------------------------
  // Ambient world life: birds that land, peck, and fly off; butterflies in
  // spring/summer; chimney smoke. Visual-only, reduced-motion aware, never
  // persisted or synced (same standing as the firefly ambience).
  // -------------------------------------------------------------------
  function stepAmbientLife(dt) {
    if (rt.reducedMotion || rt.world !== 'town') {
      rt.life.birds.length = 0;
      rt.life.butterflies.length = 0;
      return;
    }
    const t = rt.playSecondsAccum;
    const camX = rt.cameraX, camY = rt.cameraY;
    if (rt.life.birds.length < 3 && t > rt.life.nextBirdAt) {
      rt.life.nextBirdAt = t + 4 + Math.random() * 6;
      const gx = Math.round(camX + (Math.random() - 0.5) * 12);
      const gy = Math.round(camY + (Math.random() - 0.5) * 12);
      if (inBounds(gx, gy) && NATURAL_GROUND_TYPES.has(terrainAt(gx, gy))) {
        rt.life.birds.push({ gx, gy, phase: Math.random() * 6, state: 'in', t: 0, stay: 3 + Math.random() * 4, hue: Math.random() < 0.5 ? '#5d6a86' : '#8a6b5d' });
      }
    }
    for (const b of rt.life.birds) {
      b.t += dt;
      if (b.state === 'in' && b.t > 1.2) { b.state = 'ground'; b.t = 0; }
      else if (b.state === 'ground' && (b.t > b.stay || Math.max(Math.abs(b.gx - state.player.gx), Math.abs(b.gy - state.player.gy)) <= 2)) {
        b.state = 'out'; b.t = 0; // startled by the player, or just done pecking
      }
    }
    rt.life.birds = rt.life.birds.filter((b) => !(b.state === 'out' && b.t > 1.4));
    const season = seasonOf(state.day);
    if ((season === 'spring' || season === 'summer') && daySegment(state.minutes) === 'day') {
      if (rt.life.butterflies.length < 4 && t > rt.life.nextButterflyAt) {
        rt.life.nextButterflyAt = t + 3 + Math.random() * 5;
        rt.life.butterflies.push({
          gx: camX + (Math.random() - 0.5) * 10, gy: camY + (Math.random() - 0.5) * 10,
          phase: Math.random() * 6.28, born: t,
          hue: ['#ffd54f', '#ff9ecb', '#bfe9ff'][Math.floor(Math.random() * 3)],
        });
      }
      rt.life.butterflies = rt.life.butterflies.filter((bf) => t - bf.born < 26 && Math.abs(bf.gx - camX) < 16 && Math.abs(bf.gy - camY) < 16);
    } else {
      rt.life.butterflies.length = 0;
    }
  }
  function drawBird(b) {
    const t = rt.playSecondsAccum;
    const s = tileToScreen(b.gx, b.gy);
    let x = s.x, y = s.y;
    let airK = 0;
    if (b.state === 'in') { airK = 1 - Math.min(1, b.t / 1.2); x += airK * rt.tileW * 0.9; }
    else if (b.state === 'out') { airK = Math.min(1, b.t / 1.4); x -= airK * rt.tileW * 0.9; }
    y -= airK * rt.tileH * 4.2;
    const u = rt.tileH * 0.3;
    ctx.save();
    if (airK === 0) {
      ctx.globalAlpha = 0.2; ctx.fillStyle = '#08060e';
      ctx.beginPath(); ctx.ellipse(x, y, u * 0.7, u * 0.24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    const peck = airK === 0 && Math.sin(t * 5.2 + b.phase) > 0.45 ? u * 0.4 : 0;
    ctx.fillStyle = b.hue;
    ctx.beginPath(); ctx.ellipse(x, y - u * 0.75, u * 0.62, u * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + u * 0.6, y - u * 1.05 + peck, u * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffcf6b';
    ctx.beginPath(); ctx.moveTo(x + u * 0.85, y - u * 1.05 + peck); ctx.lineTo(x + u * 1.15, y - u * 0.95 + peck); ctx.lineTo(x + u * 0.85, y - u * 0.88 + peck); ctx.closePath(); ctx.fill();
    if (airK > 0) {
      const flap = Math.sin(t * 16 + b.phase) * u * 0.6;
      ctx.strokeStyle = b.hue; ctx.lineWidth = 1.6 * rt.dpr; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - u * 0.1, y - u * 0.85); ctx.lineTo(x - u * 0.75, y - u * 0.95 - flap); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + u * 0.1, y - u * 0.85); ctx.lineTo(x + u * 0.75, y - u * 0.95 - flap); ctx.stroke();
    }
    ctx.restore();
  }
  function drawButterfly(bf) {
    const t = rt.playSecondsAccum;
    const wx = bf.gx + Math.sin(t * 0.45 + bf.phase) * 1.7;
    const wy = bf.gy + Math.cos(t * 0.36 + bf.phase) * 1.3;
    const s = tileToScreen(wx, wy);
    const y = s.y - rt.tileH * 1.05 + Math.sin(t * 2.4 + bf.phase) * rt.tileH * 0.16;
    if (s.x < -20 || s.x > rt.W + 20 || y < 0 || y > rt.H) return;
    const flap = 0.35 + Math.abs(Math.sin(t * 9 + bf.phase)) * 0.65;
    const u = rt.tileH * 0.16;
    ctx.save();
    ctx.fillStyle = bf.hue;
    ctx.beginPath(); ctx.ellipse(s.x - u * flap, y, u * flap, u * 0.55, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s.x + u * flap, y, u * flap, u * 0.55, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawSmoke(x, y, saltPhase) {
    for (let i = 0; i < 3; i++) {
      const k = ((rt.playSecondsAccum * 0.32 + i * 0.34 + saltPhase * 0.077) % 1);
      ctx.globalAlpha = 0.26 * (1 - k);
      ctx.fillStyle = '#cfc9da';
      ctx.beginPath();
      ctx.arc(x + Math.sin(k * 5 + i * 2.1) * rt.tileH * 0.16, y - k * rt.tileH * 1.5, rt.tileH * (0.09 + k * 0.15), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function rawScreenToWorld(px, py, cameraX, cameraY) {
    const relX = px - rt.originX, relY = py - rt.originY;
    return {
      x: cameraX + (relX / (rt.tileW / 2) + relY / (rt.tileH / 2)) / 2,
      y: cameraY + (relY / (rt.tileH / 2) - relX / (rt.tileW / 2)) / 2,
    };
  }
  function visibleWorldBounds(cameraX, cameraY, legacy) {
    const margin = rt.tileW * 3;
    const corners = [
      rawScreenToWorld(-margin, -margin, cameraX, cameraY),
      rawScreenToWorld(rt.W + margin, -margin, cameraX, cameraY),
      rawScreenToWorld(-margin, rt.H + margin, cameraX, cameraY),
      rawScreenToWorld(rt.W + margin, rt.H + margin, cameraX, cameraY),
    ];
    const low = legacy ? 0 : WORLD_MIN, high = legacy ? GRID - 1 : WORLD_MAX;
    return {
      minX: clamp(Math.floor(Math.min(...corners.map((p) => p.x))) - 2, low, high),
      maxX: clamp(Math.ceil(Math.max(...corners.map((p) => p.x))) + 2, low, high),
      minY: clamp(Math.floor(Math.min(...corners.map((p) => p.y))) - 2, low, high),
      maxY: clamp(Math.ceil(Math.max(...corners.map((p) => p.y))) + 2, low, high),
    };
  }
  function tileWithinBounds(x, y, bounds, pad = 0) {
    return x >= bounds.minX - pad && x <= bounds.maxX + pad && y >= bounds.minY - pad && y <= bounds.maxY + pad;
  }
  // Ridge silhouettes are static per (seed, viewport) — bake them once into
  // an offscreen canvas instead of re-tracing three filled paths per frame.
  const ridgeCache = { canvas: null, key: '' };
  function drawDistantLandscape() {
    const horizon = rt.H * 0.39;
    const night = state.minutes < 360 || state.minutes > 1240;
    const celestialX = rt.W * (0.18 + ((state.minutes % 1440) / 1440) * 0.64);
    ctx.save();
    ctx.globalAlpha = night ? 0.72 : 0.82;
    ctx.fillStyle = night ? '#e9e0c7' : '#fff0a8';
    ctx.beginPath(); ctx.arc(celestialX, horizon * 0.5, rt.tileH * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const key = `${rt.W}|${rt.H}|${state.seed}`;
    if (ridgeCache.key !== key) {
      if (!ridgeCache.canvas) ridgeCache.canvas = document.createElement('canvas');
      ridgeCache.canvas.width = Math.max(1, rt.W); ridgeCache.canvas.height = Math.max(1, rt.H);
      const g = ridgeCache.canvas.getContext('2d');
      const ridgeSeed = state.seed % 19;
      for (let layer = 0; layer < 3; layer++) {
        g.globalAlpha = 0.18 + layer * 0.12;
        g.fillStyle = layer === 0 ? '#6f7891' : layer === 1 ? '#485f61' : '#334a48';
        g.beginPath(); g.moveTo(0, horizon + layer * rt.tileH * 0.4);
        const steps = 12;
        for (let i = 0; i <= steps; i++) {
          const x = (i / steps) * rt.W;
          const n = hash01(i + ridgeSeed, layer, state.seed, 0x71374491);
          const y = horizon - n * rt.H * (0.11 + layer * 0.025) + layer * rt.tileH * 0.8;
          g.lineTo(x, y);
        }
        g.lineTo(rt.W, rt.H); g.lineTo(0, rt.H); g.closePath(); g.fill();
      }
      ridgeCache.key = key;
    }
    ctx.drawImage(ridgeCache.canvas, 0, 0);
  }
  function drawWorldLighting() {
    const m = ((state.minutes % 1440) + 1440) % 1440;
    let alpha = 0;
    if (m < 330) alpha = 0.34;
    else if (m < 450) alpha = 0.34 * (450 - m) / 120;
    else if (m > 1260) alpha = 0.34;
    else if (m > 1110) alpha = 0.34 * (m - 1110) / 150;
    if (alpha <= 0) return;
    ctx.save(); ctx.fillStyle = `rgba(23,18,57,${alpha})`; ctx.fillRect(0, 0, rt.W, rt.H); ctx.restore();
  }
  function drawWeather() {
    const weather = weatherForDay(state.day);
    if (weather.kind === 'clear') return;
    const phase = rt.reducedMotion ? 0 : rt.playSecondsAccum;
    ctx.save();
    if (weather.kind === 'mist') {
      const fog = ctx.createLinearGradient(0, rt.H * 0.28, 0, rt.H);
      fog.addColorStop(0, 'rgba(225,235,232,0)'); fog.addColorStop(0.62, 'rgba(225,235,232,0.13)'); fog.addColorStop(1, 'rgba(225,235,232,0.2)');
      ctx.fillStyle = fog; ctx.fillRect(0, 0, rt.W, rt.H);
    } else if (weather.kind === 'rain') {
      ctx.fillStyle = 'rgba(40,68,88,0.09)'; ctx.fillRect(0, 0, rt.W, rt.H);
      ctx.strokeStyle = 'rgba(184,222,238,0.48)'; ctx.lineWidth = 1.2 * rt.dpr;
      const count = rt.reducedMotion ? 24 : 56;
      for (let i = 0; i < count; i++) {
        const seedX = hash01(i, state.day, state.seed, 0xb5c0fbcf);
        const seedY = hash01(state.day, i, state.seed, 0xe9b5dba5);
        const x = ((seedX * rt.W + phase * 90 * rt.dpr) % (rt.W + 40)) - 20;
        const y = ((seedY * rt.H + phase * 270 * rt.dpr) % (rt.H + 60)) - 30;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 8 * rt.dpr, y + 17 * rt.dpr); ctx.stroke();
      }
    } else if (weather.kind === 'snow') {
      ctx.fillStyle = 'rgba(225,241,247,0.76)';
      const count = rt.reducedMotion ? 22 : 48;
      for (let i = 0; i < count; i++) {
        const sx = hash01(i, state.day, state.seed, 0x3956c25b), sy = hash01(state.day, i, state.seed, 0x59f111f1);
        const x = (sx * rt.W + Math.sin(phase * 0.7 + i) * 20 * rt.dpr + rt.W) % rt.W;
        const y = (sy * rt.H + phase * (22 + (i % 5) * 5) * rt.dpr) % rt.H;
        ctx.beginPath(); ctx.arc(x, y, (1.2 + (i % 3) * 0.45) * rt.dpr, 0, Math.PI * 2); ctx.fill();
      }
    } else if (weather.kind === 'wind' && !rt.reducedMotion) {
      ctx.strokeStyle = 'rgba(245,238,218,0.2)'; ctx.lineWidth = 1.5 * rt.dpr;
      for (let i = 0; i < 8; i++) {
        const x = ((hash01(i, state.day, state.seed, 0x923f82a4) * rt.W + phase * 55 * rt.dpr) % (rt.W + 120)) - 60;
        const y = rt.H * (0.3 + hash01(state.day, i, state.seed, 0xab1c5ed5) * 0.58);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 30 * rt.dpr, y - 5 * rt.dpr, x + 62 * rt.dpr, y); ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawWaypointGuide(bounds) {
    if (!rt.waypoint || !tileWithinBounds(rt.waypoint.x, rt.waypoint.y, bounds, 1)) return;
    const s = tileToScreen(rt.waypoint.x, rt.waypoint.y);
    ctx.save(); ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 2 * rt.dpr; ctx.globalAlpha = motionPulse(420, 0, 0.62, 0.18);
    ctx.beginPath(); ctx.moveTo(s.x, s.y - rt.tileH * 0.2); ctx.lineTo(s.x, s.y - rt.tileH * 2.4); ctx.stroke();
    ctx.fillStyle = '#ffcf6b'; ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 2.5, rt.tileH * 0.16, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  // -------------------------------------------------------------------
  // Cached terrain layer: the static terrain (base diamonds, trees, rocks,
  // buildings, roads) is rendered once into an offscreen canvas anchored at
  // an integer camera tile, then re-composited each frame as a single
  // drawImage. It only rebuilds when the camera drifts more than ~1.6 tiles
  // from the anchor or when the world visually changes (season, seed, cache
  // opened, trial cleared, gate opened, resize). This removes thousands of
  // per-frame path fills — the single biggest frame cost in the old build.
  // Animated adornments are re-drawn live by drawAnimatedTiles() from the
  // small list of special tiles collected during the rebuild.
  // -------------------------------------------------------------------
  const terrainLayer = { canvas: null, lctx: null, ax: 0, ay: 0, key: '', padX: 0, padY: 0, animTiles: [] };
  const ANIMATED_TILE_TYPES = new Set(['water', 'shrine', 'landmark', 'trailhead', 'cottage']);
  function terrainLayerKey() {
    const worldBit = rt.world === 'wilds'
      ? `w:${(state.wilds && state.wilds.treasuresFound ? state.wilds.treasuresFound.length : 0)}`
      : `t:${state.exploration.cachesFound.length}:${state.adventure?.gateOpen ? 1 : 0}`;
    return [rt.world, state.seed, seasonOf(state.day), trialDoneCount(), rt.W, rt.H, rt.tileW, rt.dpr, worldBit].join('|');
  }
  function ensureTerrainLayer() {
    const wilds = rt.world === 'wilds';
    const camX = wilds ? rt.wildsCameraX : rt.cameraX;
    const camY = wilds ? rt.wildsCameraY : rt.cameraY;
    const key = terrainLayerKey();
    if (terrainLayer.canvas && terrainLayer.key === key
      && Math.abs(camX - terrainLayer.ax) < 1.6 && Math.abs(camY - terrainLayer.ay) < 1.6) return;
    const padX = Math.ceil(rt.tileW * 2.5), padY = Math.ceil(rt.tileH * 7);
    if (!terrainLayer.canvas) terrainLayer.canvas = document.createElement('canvas');
    const lw = Math.ceil(rt.W + padX * 2), lh = Math.ceil(rt.H + padY * 2);
    if (terrainLayer.canvas.width !== lw || terrainLayer.canvas.height !== lh || !terrainLayer.lctx) {
      terrainLayer.canvas.width = lw; terrainLayer.canvas.height = lh;
      terrainLayer.lctx = terrainLayer.canvas.getContext('2d');
    }
    const ax = Math.round(camX), ay = Math.round(camY);
    // Retarget the shared drawing helpers at the layer, render, then restore.
    const mainCtx = ctx, mainOX = rt.originX, mainOY = rt.originY;
    const mainCamX = rt.cameraX, mainCamY = rt.cameraY;
    const mainWCamX = rt.wildsCameraX, mainWCamY = rt.wildsCameraY;
    ctx = terrainLayer.lctx;
    ctx.clearRect(0, 0, lw, lh);
    rt.originX = mainOX + padX; rt.originY = mainOY + padY;
    if (wilds) { rt.wildsCameraX = ax; rt.wildsCameraY = ay; } else { rt.cameraX = ax; rt.cameraY = ay; }
    terrainLayer.animTiles.length = 0;
    if (wilds) {
      for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
        const t = wildsTerrain[gy][gx];
        drawWildsTile(gx, gy, t);
        if (t === 'glimmer' || t === 'treasure') terrainLayer.animTiles.push({ gx, gy, type: t, variant: 0, poiId: null, cacheId: null });
      }
    } else {
      const bounds = visibleWorldBounds(ax, ay, false);
      const minX = clamp(bounds.minX - 3, WORLD_MIN, WORLD_MAX), maxX = clamp(bounds.maxX + 3, WORLD_MIN, WORLD_MAX);
      const minY = clamp(bounds.minY - 3, WORLD_MIN, WORLD_MAX), maxY = clamp(bounds.maxY + 3, WORLD_MIN, WORLD_MAX);
      const yCut = rt.H * 0.24 + padY - rt.tileH * 2;
      for (let depth = minX + minY; depth <= maxX + maxY; depth++) {
        const startX = Math.max(minX, depth - maxY);
        const endX = Math.min(maxX, depth - minY);
        for (let gx = startX; gx <= endX; gx++) {
          const gy = depth - gx;
          const tile = worldTileAt(gx, gy);
          const s = tileToScreen(gx, gy);
          if (s.x < -rt.tileW * 2 || s.x > lw + rt.tileW * 2 || s.y < yCut || s.y > lh + rt.tileH * 3) continue;
          drawTerrainTile(gx, gy, tile);
          const eff = tile.type === 'cache' && isWorldCacheFound(tile.cacheId) ? tile.baseType : tile.type;
          if (ANIMATED_TILE_TYPES.has(eff) || tile.type === 'cache') {
            terrainLayer.animTiles.push({ gx, gy, type: tile.type === 'cache' ? 'cache' : eff, variant: tile.variant, poiId: tile.poiId, cacheId: tile.cacheId });
          }
        }
      }
    }
    ctx = mainCtx;
    rt.originX = mainOX; rt.originY = mainOY;
    rt.cameraX = mainCamX; rt.cameraY = mainCamY;
    rt.wildsCameraX = mainWCamX; rt.wildsCameraY = mainWCamY;
    terrainLayer.ax = ax; terrainLayer.ay = ay; terrainLayer.key = key;
    terrainLayer.padX = padX; terrainLayer.padY = padY;
  }
  function blitTerrainLayer() {
    const wilds = rt.world === 'wilds';
    const camX = wilds ? rt.wildsCameraX : rt.cameraX;
    const camY = wilds ? rt.wildsCameraY : rt.cameraY;
    const offX = ((terrainLayer.ax - camX) - (terrainLayer.ay - camY)) * (rt.tileW / 2);
    const offY = ((terrainLayer.ax - camX) + (terrainLayer.ay - camY)) * (rt.tileH / 2);
    ctx.drawImage(terrainLayer.canvas, offX - terrainLayer.padX, offY - terrainLayer.padY);
  }
  // Live pulses/shimmer/windows for the handful of special tiles in view.
  function drawAnimatedTiles() {
    const t = rt.playSecondsAccum;
    const seg = daySegment(state.minutes);
    const homeSeg = npcSegment(state.minutes) === 'home';
    const eveningGlow = seg === 'dusk' || seg === 'night';
    for (const a of terrainLayer.animTiles) {
      const s = tileToScreen(a.gx, a.gy);
      if (s.x < -rt.tileW * 2 || s.x > rt.W + rt.tileW * 2 || s.y < -rt.tileH * 4 || s.y > rt.H + rt.tileH * 4) continue;
      if (a.type === 'water') {
        drawWaterSurface(s.x, s.y, rt.tileW * 1.08, rt.tileH * 1.08, a.variant, t + a.gx * 0.27 + a.gy * 0.19, true);
        // Occasional fish ripple on a deterministic subset of water tiles.
        if (!rt.reducedMotion && a.variant > 0.9) {
          const k = ((t * 0.45 + a.variant * 9) % 3.4) / 3.4;
          if (k < 0.75) {
            ctx.globalAlpha = (1 - k / 0.75) * 0.5;
            ctx.strokeStyle = '#dff4ff'; ctx.lineWidth = 1.2 * rt.dpr;
            ctx.beginPath(); ctx.ellipse(s.x, s.y, rt.tileW * 0.08 + k * rt.tileW * 0.26, rt.tileH * 0.08 + k * rt.tileH * 0.26, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      } else if (a.type === 'shrine') {
        const trial = trialAt(a.gx, a.gy);
        const done = trial && state.adventure?.trials?.[trial.id]?.done;
        ctx.globalAlpha = done ? 0.35 : motionPulse(360, a.gx, 0.55, 0.15);
        ctx.fillStyle = done ? '#5be3b5' : '#ffcf6b';
        ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 1.95, rt.tileH * 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (a.type === 'landmark') {
        const poi = WORLD_POI_BY_ID[a.poiId];
        const discovered = poi && state.exploration.discovered.includes(poi.id);
        ctx.globalAlpha = motionPulse(430, a.gx, 0.7, 0.18);
        ctx.strokeStyle = discovered ? '#fbe9d8' : '#ffcf6b'; ctx.lineWidth = 2 * rt.dpr;
        ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 2.0, rt.tileH * 0.28, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        if (poi && poi.kind === 'farm') {
          // Turning windmill blades on the farm spire — visible from afar.
          const cxm = s.x, cym = s.y - rt.tileH * 2.35;
          const rot = rt.reducedMotion ? 0.65 : t * 0.9;
          ctx.strokeStyle = '#f0e2c4'; ctx.lineWidth = 1.6 * rt.dpr;
          for (let i = 0; i < 4; i++) {
            const ang = rot + i * Math.PI / 2;
            ctx.beginPath(); ctx.moveTo(cxm, cym); ctx.lineTo(cxm + Math.cos(ang) * rt.tileH * 0.85, cym + Math.sin(ang) * rt.tileH * 0.85); ctx.stroke();
          }
        }
      } else if (a.type === 'cache') {
        if (!isWorldCacheFound(a.cacheId)) {
          ctx.globalAlpha = motionPulse(300, a.gx + a.gy, 0.68, 0.2);
          ctx.fillStyle = '#ffcf6b';
          ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 0.9, rt.tileH * 0.13, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else if (a.type === 'trailhead') {
        ctx.globalAlpha = motionPulse(400, a.gx, 0.7, 0.2);
        ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 2 * rt.dpr;
        ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 1.6, rt.tileH * 0.32, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (a.type === 'cottage') {
        // Windows warm up at dusk; chimneys smoke while residents are home.
        if (eveningGlow) {
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = '#ffd98a';
          ctx.fillRect(s.x + rt.tileW * 0.1, s.y - rt.tileH * 0.98, 3.4 * rt.dpr, 4.2 * rt.dpr);
          ctx.globalAlpha = 1;
        }
        if (!rt.reducedMotion && (homeSeg || eveningGlow)) {
          drawSmoke(s.x + rt.tileW * 0.16, s.y - rt.tileH * 1.62, a.gx * 7 + a.gy * 13);
        }
      } else if (a.type === 'glimmer') {
        ctx.globalAlpha = motionPulse(280, a.gx + a.gy, 0.5, 0.2);
        ctx.fillStyle = '#c792ea';
        ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 0.9, rt.tileH * 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (a.type === 'treasure') {
        ctx.globalAlpha = motionPulse(240, a.gx, 0.6, 0.2);
        ctx.fillStyle = '#ffcf6b';
        ctx.beginPath(); ctx.arc(s.x, s.y - rt.tileH * 0.6, rt.tileH * 0.22, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
  // Sky gradient cache: rebuilt only when the in-game minute ticks over
  // (~5×/sec) instead of allocating a fresh gradient every frame.
  const skyCache = { key: '', grad: null };
  function fillSky() {
    const m = Math.round(((state.minutes % 1440) + 1440) % 1440);
    const key = `${m}|${rt.H}`;
    if (skyCache.key !== key) {
      const sky = skyColors(state.minutes);
      const grad = ctx.createLinearGradient(0, 0, 0, rt.H);
      grad.addColorStop(0, sky.top); grad.addColorStop(1, sky.hor);
      skyCache.key = key; skyCache.grad = grad;
    }
    ctx.fillStyle = skyCache.grad; ctx.fillRect(0, 0, rt.W, rt.H);
  }

  function draw() {
    if (rt.world === 'wilds') { drawWilds(); return; }
    fillSky();
    drawDistantLandscape();
    drawAmbience();

    // Terrain composites from the cached offscreen layer (see above);
    // animated tile adornments draw live on top.
    ensureTerrainLayer();
    blitTerrainLayer();
    drawAnimatedTiles();
    const bounds = visibleWorldBounds(rt.cameraX, rt.cameraY, false);

    const drawables = [];
    let focusedResidentId = null, focusedDistance = Infinity;
    for (const npc of npcs) {
      const distance = Math.max(Math.abs(npc.gx - state.player.gx), Math.abs(npc.gy - state.player.gy));
      if (distance < focusedDistance && distance <= 3) { focusedResidentId = npc.id; focusedDistance = distance; }
    }
    for (const def of SETTLEMENT_RESIDENTS) {
      const resident = settlementResidentPosition(def);
      const distance = Math.max(Math.abs(resident.gx - state.player.gx), Math.abs(resident.gy - state.player.gy));
      if (distance < focusedDistance && distance <= 3) { focusedResidentId = resident.id; focusedDistance = distance; }
    }
    for (const plot of currentFarm()) {
      if (!tileWithinBounds(plot.x, plot.y, bounds, 2) || tileToScreen(plot.x, plot.y).y < rt.H * 0.22) continue;
      // Guests' own tilled rows are local previews (same rule as guest builds).
      const guestLocal = mp.active && !mp.amIHost && state.farm.includes(plot);
      drawables.push({ depth: plot.x + plot.y + 0.3, kind: 'plot', plot, guestLocal });
    }
    const town = currentTown();
    for (const p of town) {
      if (!tileWithinBounds(p.gx, p.gy, bounds, 2) || tileToScreen(p.gx, p.gy).y < rt.H * 0.22) continue;
      // A guest's own placements (state.town) never sync out to the shared
      // room town under the current host-authoritative match-state protocol
      // (see scheduleTownSync/onMatchState) — tag them so that's visible.
      const guestLocal = mp.active && !mp.amIHost && state.town.includes(p);
      drawables.push({ depth: p.gx + p.gy + 0.4, kind: 'piece', piece: p, guestLocal });
    }
    for (const npc of npcs) if (tileWithinBounds(npc.gx, npc.gy, bounds, 3) && tileToScreen(npc.gx, npc.gy).y >= rt.H * 0.22) drawables.push({ depth: npc.gx + npc.gy + 0.5, kind: 'npc', npc });
    for (const def of SETTLEMENT_RESIDENTS) {
      const resident = settlementResidentPosition(def);
      if (tileWithinBounds(resident.gx, resident.gy, bounds, 2) && tileToScreen(resident.gx, resident.gy).y >= rt.H * 0.22) drawables.push({ depth: resident.gx + resident.gy + 0.5, kind: 'localNpc', resident });
    }
    drawables.push({ depth: rt.playerToX + rt.playerToY + 0.6, kind: 'player' });
    for (const b of rt.life.birds) {
      if (b.state === 'ground' && tileWithinBounds(b.gx, b.gy, bounds, 1)) drawables.push({ depth: b.gx + b.gy + 0.45, kind: 'bird', bird: b });
    }

    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) {
      if (d.kind === 'plot') drawFarmPlot(d.plot, d.guestLocal);
      else if (d.kind === 'piece') drawPiece(d.piece, d.guestLocal);
      else if (d.kind === 'npc') {
        const n = d.npc;
        const idle = npcIsIdle(n);
        const opts = {
          facing: n.facing,
          sway: (!rt.reducedMotion && idle) ? Math.sin(rt.playSecondsAccum * 1.15 + n.idlePhase * 2.3) * rt.tileH * 0.05 : 0,
          stretch: rt.playSecondsAccum < n.stretchUntil,
        };
        drawCharacter(n.screenPx, n.screenPy, n.hue, 'none', 'rgba(255,255,255,0.35)', focusedResidentId === n.id ? n.name.split(' ')[0] : null, false, n.id, n.quest.done ? 'happy' : 'calm', opts);
        drawNpcExtras(n);
      } else if (d.kind === 'localNpc') {
        const n = d.resident, s = tileToScreen(n.gx, n.gy);
        // Settlement folk look around on their own deterministic rhythm and
        // only face the player while actually adjacent (talk range).
        const nearP = Math.max(Math.abs(n.gx - state.player.gx), Math.abs(n.gy - state.player.gy)) <= 1;
        const lb = Math.floor(rt.playSecondsAccum / 4.1 + (n.name.length || 1));
        const lf = nearP
          ? faceToward(n.gx, n.gy, state.player.gx, state.player.gy)
          : ['down', 'left', 'right', 'down'][hashU32(lb, n.name.length, state.seed, 0x5e11a) % 4];
        const lopts = { facing: lf, sway: rt.reducedMotion ? 0 : Math.sin(rt.playSecondsAccum * 1.05 + n.name.length) * rt.tileH * 0.05 };
        drawCharacter(s.x, s.y, n.hue, 'none', 'rgba(255,255,255,0.35)', focusedResidentId === n.id ? n.name : null, false, n.id, 'happy', lopts);
      } else if (d.kind === 'player') {
        drawCharacter(rt.playerPx, rt.playerPy, hueColorOf(state.player.hue), state.player.topper, trimColorOf(state.player.trim), null, false, 'player', 'bright', { facing: rt.facing });
        drawPartyFollowers(rt.playerPx, rt.playerPy, false);
      } else if (d.kind === 'bird') {
        drawBird(d.bird);
      }
    }
    for (const b of rt.life.birds) if (b.state !== 'ground') drawBird(b);
    for (const bf of rt.life.butterflies) drawButterfly(bf);

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
    drawWaypointGuide(bounds);

    // particles
    for (const p of rt.particles) {
      ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2 * rt.dpr, p.y - 2 * rt.dpr, 4 * rt.dpr, 4 * rt.dpr);
      ctx.restore();
    }

    drawWorldLighting();
    drawWeather();

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
    fillSky();
    drawDistantLandscape();
    ctx.save(); ctx.fillStyle = 'rgba(20,4,28,0.22)'; ctx.fillRect(0, 0, rt.W, rt.H); ctx.restore();
    drawAmbience();

    // Static wilds terrain comes from the same cached layer machinery as the
    // town (previously all 289 tiles were re-pathed every frame).
    ensureTerrainLayer();
    blitTerrainLayer();
    drawAnimatedTiles();
    const drawables = [];
    for (const en of rt.wildsEnemies) drawables.push({ depth: en.gx + en.gy + 0.4, kind: 'enemy', enemy: en });
    drawables.push({ depth: rt.wildsGx + rt.wildsGy + 0.6, kind: 'wplayer' });
    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) {
      if (d.kind === 'enemy') drawEnemy(d.enemy);
      else if (d.kind === 'wplayer') {
        drawCharacter(rt.wildsPx, rt.wildsPy, hueColorOf(state.player.hue), state.player.topper, trimColorOf(state.player.trim), null, false, 'player', 'bright', { facing: rt.facing });
        drawPartyFollowers(rt.wildsPx, rt.wildsPy, true);
      }
    }

    for (const p of rt.particles) {
      ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2 * rt.dpr, p.y - 2 * rt.dpr, 4 * rt.dpr, 4 * rt.dpr);
      ctx.restore();
    }
    drawWorldLighting();
    drawWeather();

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
    if (t === 'wshrine') {
      const trial = wildsTrialAt(gx, gy);
      const done = trial && state.adventure?.trials?.[trial.id]?.done;
      drawBlock(s.x, s.y, rt.tileW * 0.58, rt.tileH * 0.58, rt.tileH * 1.6, done ? '#5be3b5' : '#8f7fff', '#34255b', '#211638');
    }
    // glimmer/treasure glow orbs are animated → drawAnimatedTiles()
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
    const t = rt.playSecondsAccum;
    if (!night && !dusk) {
      ctx.save(); ctx.strokeStyle = 'rgba(48,48,68,0.42)'; ctx.lineWidth = 1.5 * rt.dpr; ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const x = ((rt.ambience[i].x * rt.W + t * (8 + i) * rt.dpr) % (rt.W + 80)) - 40;
        const y = rt.H * (0.12 + rt.ambience[i].y * 0.24);
        const wing = 4 * rt.dpr + Math.sin(t * 3 + i) * rt.dpr;
        ctx.beginPath(); ctx.moveTo(x - wing, y + wing * 0.35); ctx.quadraticCurveTo(x, y - wing * 0.35, x, y); ctx.quadraticCurveTo(x, y - wing * 0.35, x + wing, y + wing * 0.35); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    // Fireflies draw from one pre-rendered radial-glow sprite instead of a
    // per-particle shadowBlur (shadowBlur forces a slow blur pass per fill
    // and was one of the most expensive calls in the whole frame).
    const spr = glowSprite();
    ctx.save();
    for (const f of rt.ambience) {
      const x = ((f.x + Math.sin(t * 0.025 * f.drift + f.phase) * 0.02) % 1) * rt.W;
      const y = ((f.y + Math.cos(t * 0.018 * f.drift + f.phase) * 0.018) % 1) * rt.H;
      const a = (night ? 0.55 : 0.22) + Math.sin(t * 2.2 + f.phase) * 0.18;
      ctx.globalAlpha = Math.max(0.05, a);
      const sz = f.size * rt.dpr * 2.6;
      ctx.drawImage(spr, x - sz, y - sz, sz * 2, sz * 2);
    }
    ctx.restore();
  }
  let glowSpriteCanvas = null;
  function glowSprite() {
    if (glowSpriteCanvas) return glowSpriteCanvas;
    const c = document.createElement('canvas');
    const rad = 24;
    c.width = c.height = rad * 2;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(rad, rad, 0, rad, rad, rad);
    grad.addColorStop(0, 'rgba(255,242,168,1)');
    grad.addColorStop(0.35, 'rgba(255,233,138,0.55)');
    grad.addColorStop(1, 'rgba(255,233,138,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(rad, rad, rad, 0, Math.PI * 2); g.fill();
    glowSpriteCanvas = c;
    return c;
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
      stepHeldMovement(t);
      stepMoveInterp(dt);
      stepWildsMoveInterp(dt);
      stepWildsEnemies(dt);
      stepNpcs(dt);
      stepAmbientLife(dt);
      stepGatherCook(dt);
      stepFarm(dtMinutes);
      stepSpark(t);
    }
    stepParticles(dt);
    stepAmbientAudio(dt);
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
    const e = rt.moveT;
    const worldX = rt.playerFromX + (rt.playerToX - rt.playerFromX) * e;
    const worldY = rt.playerFromY + (rt.playerToY - rt.playerFromY) * e;
    rt.cameraX = worldX; rt.cameraY = worldY;
    const screen = tileToScreen(worldX, worldY);
    rt.playerPx = screen.x; rt.playerPy = screen.y;
  }
  // -------------------------------------------------------------------
  // NPC routine engine: residents walk tile-by-tile between their daily
  // stops (home → work → square → leisure → home), face what they're doing
  // (never the player, except a brief glance when the player walks up or
  // talks to them), and get idle variety + paired chatting at stops.
  // -------------------------------------------------------------------
  const NPC_CARRY_COLOR = { grove: '#ffd54f', quarry: '#9bb3d6', reed: '#c792ea', water: '#4fd1e8', shrine: '#c9b8ff', gate: '#e3c27a' };
  function npcWalkable(x, y) {
    if (!inLegacyBounds(x, y)) return false;
    const t = terrain[y][x];
    if (t === 'water' || t === 'grove' || t === 'quarry' || t === 'reed' || t === 'shrine' || t === 'gate') return false;
    const piece = townPieceAt(x, y, state.town);
    if (piece && PALETTE_BY_TYPE[piece.type] && PALETTE_BY_TYPE[piece.type].blocking) return false;
    return true;
  }
  function npcIsIdle(n) {
    return n.moveT >= 1 && !!n.finalTarget && n.gx === n.finalTarget.x && n.gy === n.finalTarget.y;
  }
  function npcGlideTo(n) {
    // Fallback for genuinely stuck residents: the pre-rework direct glide,
    // so nobody can ever be stranded behind a pond or a player-built wall.
    n.moveFrom = { x: n.gx, y: n.gy };
    n.targetGx = n.finalTarget.x; n.targetGy = n.finalTarget.y;
    n.moveT = 0; n.moveDur = rt.reducedMotion ? 260 : 2400;
    n.stuck = 0; n.noProgress = 0;
    n.facing = faceToward(n.gx, n.gy, n.targetGx, n.targetGy);
  }
  function startNextNpcHop(n) {
    if (rt.playSecondsAccum < n.pauseUntil) return;
    const tx = n.finalTarget.x, ty = n.finalTarget.y;
    const adx = Math.abs(tx - n.gx), ady = Math.abs(ty - n.gy);
    const sx = Math.sign(tx - n.gx), sy = Math.sign(ty - n.gy);
    const cand = [];
    if (adx >= ady) {
      if (sx) cand.push([sx, 0]);
      if (sy) cand.push([0, sy]);
      cand.push([0, 1], [0, -1]);
    } else {
      if (sy) cand.push([0, sy]);
      if (sx) cand.push([sx, 0]);
      cand.push([1, 0], [-1, 0]);
    }
    let pick = null;
    for (const c of cand) {
      const nx = n.gx + c[0], ny = n.gy + c[1];
      if (nx === n.moveFrom.x && ny === n.moveFrom.y) continue; // no instant backtrack
      if (npcWalkable(nx, ny)) { pick = c; break; }
    }
    if (!pick) {
      n.stuck += 1;
      if (n.stuck > 2) { npcGlideTo(n); return; }
      n.pauseUntil = rt.playSecondsAccum + 0.5;
      return;
    }
    const nx = n.gx + pick[0], ny = n.gy + pick[1];
    const before = adx + ady;
    const after = Math.abs(tx - nx) + Math.abs(ty - ny);
    n.noProgress = after >= before ? n.noProgress + 1 : 0;
    if (n.noProgress > 6) { npcGlideTo(n); return; }
    n.stuck = 0;
    n.moveFrom = { x: n.gx, y: n.gy };
    n.targetGx = nx; n.targetGy = ny;
    n.moveT = 0;
    n.moveDur = rt.reducedMotion ? 130 : 340 + (hashU32(nx, ny, state.seed, 0x77aa11) % 120);
    n.facing = pick[0] > 0 ? 'right' : pick[0] < 0 ? 'left' : pick[1] > 0 ? 'down' : 'up';
  }
  function stepNpcIdle(n, i, now) {
    // Deterministic idle variety on ~3s buckets: face the work node while
    // working, look around / stretch at other stops. Never player-locked.
    const bucket = Math.floor(now / 3.2 + n.idlePhase);
    if (bucket === n.idleBucket) return;
    n.idleBucket = bucket;
    if (n.segment === 'work') { n.facing = n.workFace; return; }
    const r = hashU32(bucket, i, state.seed, 0x9d2c5680) % 100;
    if (r < 16) { n.stretchUntil = now + 1.2; return; }
    if (n.segment === 'leisure') {
      n.facing = r < 72 ? faceToward(n.gx, n.gy, n.leisureFocus.x, n.leisureFocus.y) : ['left', 'right', 'down'][r % 3];
      return;
    }
    n.facing = ['down', 'left', 'right', 'up'][r % 4];
  }
  function stepNpcs(dt) {
    const seg = effectiveNpcSegment(state.minutes, state.day);
    const now = rt.playSecondsAccum;
    const p = state.player;
    const panelOpen = anyPanelOpen();
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (n.segment !== seg) {
        const prev = n.segment;
        n.segment = seg;
        n.finalTarget = seg === 'work' ? n.workplace : seg === 'square' ? n.square : seg === 'leisure' ? n.leisure : n.home;
        // Visible carried goods while walking away from the workplace.
        n.carrying = prev === 'work' ? (NPC_CARRY_COLOR[n.def.resourceType] || '#ffd54f') : null;
        n.stuck = 0; n.noProgress = 0; n.pauseUntil = 0;
      }
      if (n.moveT < 1) {
        n.moveT = Math.min(1, n.moveT + dt * 1000 / n.moveDur);
        if (n.moveT >= 1) { n.gx = n.targetGx; n.gy = n.targetGy; }
      } else if (!npcIsIdle(n)) {
        startNextNpcHop(n);
      } else {
        n.carrying = null;
        stepNpcIdle(n, i, now);
      }
      // Brief glance when the player walks up (edge-triggered), or while the
      // player is actually talking to them — then back to their own business.
      const near = rt.world === 'town' && Math.max(Math.abs(n.gx - p.gx), Math.abs(n.gy - p.gy)) <= 1;
      if (near && !n.wasNearPlayer) n.glanceUntil = now + 1.5;
      n.wasNearPlayer = near;
      if ((panelOpen && rt.dialogueNpc === n && rt.dialogueMode === 'npc') || now < n.glanceUntil) {
        n.facing = faceToward(n.gx, n.gy, p.gx, p.gy);
      }
      const fx = tileToScreen(n.moveFrom.x, n.moveFrom.y);
      const tx2 = tileToScreen(n.targetGx, n.targetGy);
      n.screenPx = fx.x + (tx2.x - fx.x) * n.moveT;
      n.screenPy = fx.y + (tx2.y - fx.y) * n.moveT;
    }
    // Idle chatting: two idle residents on adjacent tiles face each other and
    // trade little speech-bubble glyphs (skipped while working or glancing).
    for (const n of npcs) n.chatWith = null;
    if (seg !== 'work') {
      for (let i = 0; i < npcs.length; i++) {
        const a = npcs[i];
        if (a.chatWith || !npcIsIdle(a) || now < a.glanceUntil) continue;
        if (panelOpen && rt.dialogueNpc === a) continue;
        for (let j = i + 1; j < npcs.length; j++) {
          const b = npcs[j];
          if (b.chatWith || !npcIsIdle(b) || now < b.glanceUntil) continue;
          if (panelOpen && rt.dialogueNpc === b) continue;
          if (Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy)) === 1) {
            a.chatWith = b.id; b.chatWith = a.id;
            a.facing = faceToward(a.gx, a.gy, b.gx, b.gy);
            b.facing = faceToward(b.gx, b.gy, a.gx, a.gy);
            break;
          }
        }
      }
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
      tools: state.tools, friendship: state.friendship, party: state.party, wilds: state.wilds, exploration: state.exploration,
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
    if (typeof s.seed === 'number') { state.seed = s.seed >>> 0; terrain = genTerrain(state.seed); wildsTerrain = genWildsTerrain(state.seed); resetWorldChunks(); }
    state.day = Number.isFinite(s.day) ? Math.max(1, Math.floor(s.day)) : state.day;
    state.minutes = Number.isFinite(s.minutes) ? clamp(s.minutes, 0, 1439) : state.minutes;
    if (s.player && typeof s.player === 'object') {
      state.player.gx = Number.isFinite(s.player.gx) ? clamp(Math.floor(s.player.gx), WORLD_MIN, WORLD_MAX) : state.player.gx;
      state.player.gy = Number.isFinite(s.player.gy) ? clamp(Math.floor(s.player.gy), WORLD_MIN, WORLD_MAX) : state.player.gy;
      for (const k of ['hue', 'topper', 'trim', 'name']) if (typeof s.player[k] === 'string') state.player[k] = s.player[k];
    }
    if (s.inventory && typeof s.inventory === 'object') {
      for (const k of Object.keys(state.inventory)) if (Number.isFinite(s.inventory[k])) state.inventory[k] = Math.max(0, Math.floor(s.inventory[k]));
    }
    state.spark = Number.isFinite(s.spark) ? clamp(s.spark, 0, 100) : state.spark;
    if (Array.isArray(s.town)) {
      state.town = s.town.filter((p) => p && typeof p === 'object' && PALETTE_BY_TYPE[p.type] && Number.isFinite(p.gx) && Number.isFinite(p.gy))
        .map((p) => ({ id: String(p.id || `p${pieceIdCounter++}`), type: p.type, gx: clamp(Math.floor(p.gx), WORLD_MIN, WORLD_MAX), gy: clamp(Math.floor(p.gy), WORLD_MIN, WORLD_MAX), rot: Number.isFinite(p.rot) ? p.rot % 4 : 0 }));
    }
    if (Array.isArray(s.farm)) {
      const seenPlots = new Set();
      state.farm = s.farm.filter((p) => p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => ({
          x: clamp(Math.floor(p.x), WORLD_MIN, WORLD_MAX), y: clamp(Math.floor(p.y), WORLD_MIN, WORLD_MAX),
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
    // Tools/friendship/party/wilds are top-level fields; state.tools /
    // state.friendship / state.party / state.wilds already hold newGame()'s safe defaults at
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
    if (s.party && typeof s.party === 'object') {
      state.party = {
        recruited: Array.isArray(s.party.recruited) ? s.party.recruited.filter((id) => !!COMPANION_BY_ID[id]) : [],
        active: Array.isArray(s.party.active) ? s.party.active.filter((id) => !!COMPANION_BY_ID[id]) : [],
      };
      ensurePartyState();
    } else {
      ensurePartyState();
    }
    if (s.wilds && typeof s.wilds === 'object') {
      state.wilds.treasuresFound = Array.isArray(s.wilds.treasuresFound) ? s.wilds.treasuresFound.filter((x) => typeof x === 'string') : [];
      state.wilds.guardianDefeated = !!s.wilds.guardianDefeated;
    }
    if (s.exploration && typeof s.exploration === 'object') {
      state.exploration = {
        discovered: Array.isArray(s.exploration.discovered) ? s.exploration.discovered : [],
        biomes: Array.isArray(s.exploration.biomes) ? s.exploration.biomes : [],
        cachesFound: Array.isArray(s.exploration.cachesFound) ? s.exploration.cachesFound : [],
      };
    }
    ensureExplorationState();
    state.stats.regionsDiscovered = Math.max(state.stats.regionsDiscovered || 1, state.exploration.discovered.length);
    state.stats.cachesFound = Math.max(state.stats.cachesFound || 0, state.exploration.cachesFound.length);
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
    rt.cameraX = state.player.gx; rt.cameraY = state.player.gy;
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
    const cameraX = rt.world === 'wilds' ? rt.wildsCameraX : rt.cameraX;
    const cameraY = rt.world === 'wilds' ? rt.wildsCameraY : rt.cameraY;
    const gx = cameraX + (relX / (rt.tileW / 2) + relY / (rt.tileH / 2)) / 2;
    const gy = cameraY + (relY / (rt.tileH / 2) - relX / (rt.tileW / 2)) / 2;
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
    if (rt.world === 'wilds') {
      if (!inLegacyBounds(tile.x, tile.y)) return;
      const dx = tile.x - rt.wildsGx, dy = tile.y - rt.wildsGy;
      if (Math.abs(dx) + Math.abs(dy) === 1) tryMoveWilds(dx, dy);
      else if (dx === 0 && dy === 0) doContextAction();
      return;
    }
    if (!inBounds(tile.x, tile.y)) return;
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
    const k = evt.key.toLowerCase();
    const move = (k === 'w' || k === 'arrowup') ? [0, -1]
      : (k === 's' || k === 'arrowdown') ? [0, 1]
        : (k === 'a' || k === 'arrowleft') ? [-1, 0]
          : (k === 'd' || k === 'arrowright') ? [1, 0] : null;
    if (move) {
      evt.preventDefault();
      rt.heldKeys.add(k);
      if (!evt.repeat && !anyPanelOpen() && !rt.paused) {
        tryMove(move[0], move[1]);
        rt.nextHeldMoveAt = performance.now() + (rt.reducedMotion ? 70 : 155);
      }
      return;
    }
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
    if (k === ' ' || k === 'e') { evt.preventDefault(); doContextAction(); }
    else if (k === 'b') openPanel('build');
    else if (k === 'f') openPanel('farming');
    else if (k === 'c') openPanel('craft');
    else if (k === 'm') openPanel('map');
  });
  addEventListener('keyup', (evt) => rt.heldKeys.delete(evt.key.toLowerCase()));
  addEventListener('blur', () => rt.heldKeys.clear());

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
  function moveFromPad(dir) {
    if (dir === 'up') tryMove(0, -1);
    else if (dir === 'down') tryMove(0, 1);
    else if (dir === 'left') tryMove(-1, 0);
    else if (dir === 'right') tryMove(1, 0);
  }
  function stopTouchMove() {
    if (rt.touchMoveTimer) clearInterval(rt.touchMoveTimer);
    rt.touchMoveTimer = null;
  }
  $all('[data-ct-move]').forEach((button) => {
    const dir = button.dataset.ctMove;
    if (dir === 'act') {
      button.onclick = () => { unlockAudio(); doContextAction(); };
      return;
    }
    button.addEventListener('pointerdown', (evt) => {
      evt.preventDefault();
      unlockAudio();
      stopTouchMove();
      moveFromPad(dir);
      const delay = rt.reducedMotion ? 80 : 160;
      setTimeout(() => {
        if (!button.matches(':active')) return;
        rt.touchMoveTimer = setInterval(() => moveFromPad(dir), delay);
      }, 230);
    });
    button.addEventListener('pointerup', stopTouchMove);
    button.addEventListener('pointercancel', stopTouchMove);
    button.addEventListener('pointerleave', stopTouchMove);
    button.onclick = (evt) => evt.preventDefault();
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
  $('[data-ct-reduced]').onchange = (e) => { rt.reducedMotion = e.target.checked; rt.ambience = []; rt.life.birds.length = 0; rt.life.butterflies.length = 0; };
  $('[data-ct-pause]').onclick = () => setPaused(!rt.paused);
  $('[data-ct-resume]').onclick = () => setPaused(false);
  if (el.returnHome) el.returnHome.onclick = () => { unlockAudio(); exitWilds(); };
  const mapTarget = $('[data-ct-map-target]');
  if (mapTarget && el.worldMap) mapTarget.addEventListener('pointerdown', (evt) => {
    const rect = el.worldMap.getBoundingClientRect();
    const x = WORLD_MIN + ((evt.clientX - rect.left) / rect.width) * WORLD_SIZE;
    const y = WORLD_MIN + ((evt.clientY - rect.top) / rect.height) * WORLD_SIZE;
    setWaypoint(x, y);
  });
  const mapClear = $('[data-ct-map-clear]');
  if (mapClear) mapClear.onclick = () => { rt.waypoint = null; updateHud(); renderWorldMap(); toast('Trail marker cleared.'); };

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
      rt.cameraX = state.player.gx; rt.cameraY = state.player.gy; rt.playerPx = rt.originX; rt.playerPy = rt.originY;
      rt.waypoint = null;
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
  function validateGeneratedWorld() {
    const areaRatio = (WORLD_SIZE * WORLD_SIZE) / (GRID * GRID);
    const biomeSet = new Set(), typeSet = new Set();
    let roadTiles = 0, waterTiles = 0, deterministic = true;
    for (let y = WORLD_MIN; y <= WORLD_MAX; y += 4) for (let x = WORLD_MIN; x <= WORLD_MAX; x += 4) {
      const a = proceduralWorldTile(x, y, state.seed), b = proceduralWorldTile(x, y, state.seed);
      biomeSet.add(a.biome); typeSet.add(a.type);
      if (a.type === 'road' || a.type === 'bridge') roadTiles++;
      if (a.type === 'water') waterTiles++;
      if (a.type !== b.type || a.biome !== b.biome || a.variant !== b.variant) deterministic = false;
    }
    return {
      ok: areaRatio >= 50 && deterministic && biomeSet.size >= 5 && typeSet.size >= 8 && roadTiles > 0 && waterTiles > 0,
      worldSize: WORLD_SIZE, legacySize: GRID, areaRatio, chunkSize: CHUNK_SIZE,
      biomes: Array.from(biomeSet).sort(), terrainTypes: Array.from(typeSet).sort(), roadTiles, waterTiles, deterministic,
      destinations: WORLD_POIS.length,
    };
  }
  window.__CUBETOWN_TEST__ = Object.freeze({
    validateWorld: () => validateGeneratedWorld(),
    sampleTile: (x, y) => ({ ...worldTileAt(clamp(Math.floor(x), WORLD_MIN, WORLD_MAX), clamp(Math.floor(y), WORLD_MIN, WORLD_MAX)) }),
    worldBounds: Object.freeze({ min: WORLD_MIN, max: WORLD_MAX, size: WORLD_SIZE, chunkSize: CHUNK_SIZE }),
    // Living-world/NPC hooks (used by the offline verification harness):
    seasonAt: (day) => seasonOf(day),
    weatherAt: (day) => ({ ...weatherForDay(day) }),
    npcSegmentAt: (minutes, day) => effectiveNpcSegment(minutes, day),
    npcSnapshot: () => npcs.map((n) => ({
      id: n.id, gx: n.gx, gy: n.gy, segment: n.segment, facing: n.facing,
      home: { ...n.home }, workplace: { ...n.workplace }, square: { ...n.square }, leisure: { ...n.leisure },
    })),
    npcWalkable: (x, y) => npcWalkable(x, y),
    stepNpcs: (dt) => { rt.playSecondsAccum += dt; stepNpcs(dt); },
    setClock: (minutes, day) => { state.minutes = minutes; if (Number.isFinite(day)) state.day = day; },
    captureState: () => captureState(),
    applyState: (s) => applyState(s),
    seed: () => state.seed,
  });
  function boot() {
    size();
    try { rt.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { rt.reducedMotion = false; }
    el.reduced.checked = rt.reducedMotion;
    newGame((Math.random() * 1e9) >>> 0);
    rt.playerToX = state.player.gx; rt.playerToY = state.player.gy;
    rt.playerFromX = rt.playerToX; rt.playerFromY = rt.playerToY; rt.moveT = 1;
    rt.cameraX = state.player.gx; rt.cameraY = state.player.gy; rt.playerPx = rt.originX; rt.playerPy = rt.originY;
    const worldCheck = validateGeneratedWorld();
    console.assert(worldCheck.ok, 'CubeTown overworld generation invariant failed', worldCheck);
    canvas.dataset.ctWorldCheck = worldCheck.ok ? 'ok' : 'failed';
    canvas.dataset.ctWorldAreaRatio = worldCheck.areaRatio.toFixed(1);
    updateHud();
    draw();
    requestAnimationFrame(loop);
    setInterval(() => { updateHud(); }, 1000);
    if (!state.tutorialSeen) setTimeout(() => openPanel('tutorial'), 200);
    host('ready');
  }
  boot();
})();
