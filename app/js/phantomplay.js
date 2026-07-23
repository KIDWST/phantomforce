import {
  currentTenantId, isAdmin, isOwnerOperator, session,
  workspaceStorageGetItem, workspaceStorageSetItem,
} from "./store.js?v=phantom-live-20260723-46";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const mobilePlaySurface = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const controlsCopy = (game) => mobilePlaySurface() ? "" : String(game?.controls || "").trim();
const FALLBACK_KEY = "pf.phantomplay.offline.v1";
const DEV_SUPPORT_KEY = "pf.phantomplay.developerSupport.v1";
const DEV_SANDBOX_AUTOSAVE_KEY = "pf.phantomplay.devSandboxAutosave.v1";
const COLOR_MODE_KEY = "pf.colorMode.v1";
function currentColorMode() {
  const saved = workspaceStorageGetItem(COLOR_MODE_KEY);
  return saved === "light" ? "light" : "dark";
}
function applyColorMode(mode) {
  const next = mode === "light" ? "light" : "dark";
  workspaceStorageSetItem(COLOR_MODE_KEY, next);
  document.documentElement.dataset.orgColorMode = next;
}
applyColorMode(currentColorMode());
const CATEGORIES = ["All", "Kids", "Arcade", "Puzzle", "Focus", "Strategy", "Sports", "Creative"];
const GAME_SORTS = ["All", "Solo", "Multiplayer", "Kids", ...CATEGORIES.filter((category) => category !== "All" && category !== "Kids")];
const KIDS_ONLY_GAME_IDS = new Set([
  "signal-match", "focus-stack", "reflex-grid", "penalty-kick", "rift-frenzy", "serpent-surge",
  "color-rush", "tile-flow", "tower-tactics", "breath-pacer", "court-vision", "pixel-bloom",
  "circuit-serpent", "echo-sequence", "signal-sweeper", "neon-breaker", "type-storm", "logic-lights",
  "sudoku-signal",
]);
const GAME_CONTROL_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  " ", "Spacebar", "Space", "Enter",
  "w", "W", "a", "A", "s", "S", "d", "D",
  "j", "J", "k", "K", "l", "L",
]);
// "Game Rating Exposure" — mirrors server PhantomPlayRating (phantomplay.ts).
// Order matches ratingRank there (gentlest first).
const RATING_TIERS = [["toddler", "Toddler"], ["everyone", "Everyone"], ["everyone10", "Everyone 10+"], ["teen", "Teen"], ["mature", "Mature"]];
const ALL_RATING_VALUES = RATING_TIERS.map(([value]) => value);
// Mirrors defaultAllowedRatings() in server/src/phantom-ai/phantomplay.ts —
// kept in sync by hand since preferences.allowedRatings has no server-side
// "give me the default for my type" endpoint of its own.
function defaultAllowedRatingsFor(profileType) {
  if (profileType === "toddler") return ["toddler", "everyone"];
  if (profileType === "child") return ["toddler", "everyone", "everyone10", "teen"];
  return [...ALL_RATING_VALUES];
}
function ratingExposurePreset(kind, profileType) {
  if (kind === "my-age") return defaultAllowedRatingsFor(profileType);
  if (kind === "family") return ["toddler", "everyone", "everyone10"];
  return [...ALL_RATING_VALUES];
}
const ROOM_POLL_MS = 1750;
// Every Nth poll tick, re-send the participant's own current ready value
// unchanged as a liveness "touch" — the room store only bumps lastSeenAt on
// join/leave/ready, so this keeps the connection-status indicator accurate
// without a dedicated heartbeat route.
const ROOM_POLL_TOUCH_EVERY = 10;
const PHANTOMPLAY_ENGINE = {
  version: "2.2-ascension",
  saveStateBytes: 262144,
  largeMap: { chunkSize: 1024, maxLoadedChunks: 64, streaming: true },
  screenFlow: ["title", "loadout", "match", "results"],
  localMultiplayer: { supported: true, maxPlayers: 6, splitScreen: true },
  updateChannel: { kind: "web_build", checkSeconds: 60, reinstallRequired: false },
  runtimeProfiles: {
    webapp: { installRequired: false, supportsLargeAssets: false },
    desktop_player: { installRequired: true, supportsLargeAssets: true, maxAssetPackGb: 50 },
    developer_full: { installRequired: true, supportsLargeAssets: true, maxAssetPackGb: 250 },
  },
  distributedRuntime: {
    status: "foundation_active",
    userOwnedCompute: true,
    cloudStreamingFromJordan: false,
    directPeerConnectionDefault: false,
    inboundDevicePortsDefault: false,
    activeContributionLane: "asset_cache",
  },
  protocols: ["ready", "score", "progress", "complete", "paused", "exit", "settings", "save-state", "load-state"],
};
const PHANTOMPLAY_ART_VERSION = "phantomplay-art-20260722";
const artUrl = (file) => `/app/assets/phantomplay/${file}?v=${PHANTOMPLAY_ART_VERSION}`;
const TAK_AVATAR = artUrl("tak-avatar.webp");
const GAME_ART_BY_SLUG = {
  "neon-drift": artUrl("neon-drift-cover.webp"),
  "signal-match": artUrl("signal-match-cover.webp"),
  "focus-stack": artUrl("focus-stack-cover.webp"),
  "word-weld": artUrl("word-weld-cover.webp"),
  "reflex-grid": artUrl("reflex-grid-cover.webp"),
  "rift-frenzy": artUrl("rift-frenzy-cover.svg"),
  "serpent-surge": artUrl("serpent-surge-cover.svg"),
  "crown-circuit": artUrl("crown-circuit-cover.svg"),
  "kingdom-breakers": artUrl("kingdom-breakers-cover.svg"),
  "phantom-ages": artUrl("phantom-ages-cover.svg"),
  "tidefront-tactics": artUrl("tidefront-tactics-cover.svg"),
  "skyguard-arena": artUrl("skyguard-arena-cover.svg"),
  "penalty-kick": artUrl("penalty-kick-cover.webp"),
  "cubetown": artUrl("cubetown-cover.svg"),
  "keyboardist-on-tour": artUrl("keyboardist-on-tour-cover.svg"),
  "phantom-grand-prix": artUrl("phantom-grand-prix-cover.svg"),
  "beat-strike": artUrl("beat-strike-cover.svg"),
  "im-baked": artUrl("im-baked-cover.svg"),
  "phantom-strike": artUrl("phantom-strike-cover.svg"),
  "phantom-dash": artUrl("phantom-dash-cover.svg"),
  "color-rush": artUrl("color-rush-cover.svg"),
  "circuit-serpent": artUrl("circuit-serpent-cover.svg"),
  "neon-breaker": artUrl("neon-breaker-cover.svg"),
  "phantom-rumble": artUrl("phantom-rumble-cover.svg"),
  "vespergate": artUrl("vespergate-cover.svg"),
  "court-vision": artUrl("court-vision-cover.svg"),
  "phantom-pizzeria": artUrl("phantom-pizzeria-cover.svg"),
  "tower-tactics": artUrl("tower-tactics-cover.svg"),
  "tile-flow": artUrl("tile-flow-cover.svg"),
  "echo-sequence": artUrl("echo-sequence-cover.svg"),
  "signal-sweeper": artUrl("signal-sweeper-cover.svg"),
  "logic-lights": artUrl("logic-lights-cover.svg"),
  "sudoku-signal": artUrl("sudoku-signal-cover.svg"),
  "pixel-bloom": artUrl("pixel-bloom-cover.svg"),
  "type-storm": artUrl("type-storm-cover.svg"),
  "breath-pacer": artUrl("breath-pacer-cover.svg"),
  "phantom-cube": artUrl("phantom-cube-cover.svg"),
  "phantom-chess": artUrl("phantom-chess-cover.svg"),
};
const CATEGORY_ART = {
  Kids: GAME_ART_BY_SLUG["signal-match"],
  Arcade: GAME_ART_BY_SLUG["neon-drift"],
  Puzzle: GAME_ART_BY_SLUG["signal-match"],
  Focus: GAME_ART_BY_SLUG["focus-stack"],
  Strategy: GAME_ART_BY_SLUG["reflex-grid"],
  Creative: GAME_ART_BY_SLUG["word-weld"],
};
const BUILT_INS = [
  { id: "neon-drift", title: "Neon Drift", summary: "Auto-fire spaceship shooter with waves, powerups, and shield saves.", description: "A real arcade shooter: fly fast, fire nonstop, collect rapid fire, spread shot, shield, magnet, and repair powerups, then push deeper into harder waves.", category: "Arcade", tags: ["shooter", "powerups", "arcade", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/neon-drift.html?v=1.2.5", thumbnail: GAME_ART_BY_SLUG["neon-drift"], featured: true, version: "1.2.5", controls: "WASD/arrow keys to fly. Auto-fire is always on.", progressSupport: true, scoreSupport: true, engine: { tier: "arcade-large-map", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "signal-match", title: "Signal Match", summary: "Find every matching signal with the fewest turns.", description: "A responsive memory grid with clear score, feedback, pause, restart, touch, and keyboard support.", category: "Puzzle", tags: ["memory", "calm", "puzzle"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/signal-match.html?v=1.1.1", thumbnail: GAME_ART_BY_SLUG["signal-match"], featured: true, version: "1.1.1", controls: "Click, tap, or use Tab + Enter", progressSupport: true, scoreSupport: true },
  { id: "focus-stack", title: "Focus Stack", summary: "Drop each layer cleanly and build the tallest signal tower.", description: "A focused timing run with a visible score, proper start, pause, restart, and resize-safe play field.", category: "Focus", tags: ["timing", "focus", "quick"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/focus-stack.html?v=1.1.1", thumbnail: GAME_ART_BY_SLUG["focus-stack"], featured: false, version: "1.1.1", controls: "Space, Enter, click, or tap", progressSupport: true, scoreSupport: true },
  { id: "word-weld", title: "Word Weld", summary: "Daily Wordle-inspired puzzle plus buddy-duel word runs for PhantomForce friends.", description: "A Wordle-inspired daily weld: everyone gets the same five-letter puzzle once per day on this workspace device, or you can start a pass-and-play buddy duel for private PhantomForce friends.", category: "Puzzle", tags: ["word", "daily", "puzzle", "multiplayer", "friends", "touch"], contentRating: "everyone", multiplayerDescriptor: "Buddy Duel is pass-and-play today; ready for private PhantomPlay room relay without public discovery.", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/word-weld.html?v=2.0.0", thumbnail: GAME_ART_BY_SLUG["word-weld"], featured: true, version: "2.0.0", controls: "Keyboard, tap letters, Enter to submit", progressSupport: true, scoreSupport: true },
  { id: "reflex-grid", title: "Reflex Grid", summary: "Hit the live cells before the grid burns out.", description: "A fast aim-and-reaction grid for short focus breaks, with mistakes, streaks, and a real finish.", category: "Strategy", tags: ["reaction", "strategy", "touch", "aim"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/reflex-grid.html?v=1.0.0", thumbnail: GAME_ART_BY_SLUG["reflex-grid"], featured: true, version: "1.0.0", controls: "Click, tap, or use number keys", progressSupport: true, scoreSupport: true },
  { id: "rift-frenzy", title: "Rift Frenzy", summary: "Carry a valuable fish school, steal from rivals, then absorb at the perfect moment to become enormous.", description: "A school-to-grow ocean survival arena: collect smaller neutral fish into a visible school, protect it from rival steals, dash through exposed schools, absorb the school on a 10-second cooldown, grow permanently, survive predators and hazards, and eliminate every rival until one fish remains.", category: "Arcade", tags: ["fish", "arena", "growth", "io", "multiplayer", "school"], contentRating: "everyone10", multiplayerDescriptor: "Solo fills rival slots with bots; local 1-4 player keyboard mode replaces bots with humans.", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/rift-frenzy.html?v=2.0.0", thumbnail: GAME_ART_BY_SLUG["rift-frenzy"], featured: true, version: "2.0.0", controls: "P1 WASD, Shift dash, Space absorb. P2 arrows, / dash, Enter absorb. P3 IJKL, O dash, U absorb. P4 TFGH, Y dash, R absorb.", progressSupport: true, scoreSupport: true, engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "crown-circuit", title: "Crown Circuit", summary: "Solo bot training plus 8-card/4-hand elixir lane duels with battle plans, Obsidian Relay, Oracle slows, Ram sieges, and room support.", description: "A royale-style lane battler: choose Balanced, Siege Push, Split Swarm, Control Lock, or Tempo Cycle before the match, then start Solo Training against Crown Bot to learn lane pressure, elixir timing, card cycling, and tower trades across multiple arenas including Obsidian Relay. Oracle cards apply real slows, Ram cards pressure towers, and Crown Bot cycles plan-biased decks.", category: "Strategy", tags: ["card", "lane", "royale", "solo", "bots", "training", "multiplayer", "pvp", "drag-and-drop", "touch"], contentRating: "everyone10", contentDescriptors: ["strategic_complexity", "competitive_play"], multiplayerDescriptor: "Solo Training fills the rival side with Crown Bot. Room mode supports a two-player private PhantomPlay duel, one device each, with no public matchmaking, chat, or voice.", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/crown-circuit.html?v=1.3.3", thumbnail: GAME_ART_BY_SLUG["crown-circuit"], featured: true, version: "1.3.3", controls: "Choose a battle plan, build an eight-card deck, drag from the four-card hand onto your side, and cycle back to the next card. Solo Training starts immediately against Crown Bot; Room mode waits for player two.", progressSupport: true, scoreSupport: true, engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "kingdom-breakers", title: "Kingdom Breakers", summary: "Physics siege duels with two castles, wardens, Stonefall Orbs, Splinter Lances, and Emberburst shots.", description: "A real castle-breaker: campaign holds, duel mode with one player castle and one bot castle, destructible blocks, ammo choice, and Warden defeat as the core win condition. This restores the hard-work siege game to the main PhantomPlay fallback catalog.", category: "Strategy", tags: ["siege", "destruction", "physics", "artillery", "campaign", "pvp"], contentRating: "everyone10", contentDescriptors: ["cartoon_action", "mild_destruction", "competitive_play"], developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/kingdom-breakers.html?v=1.1.0", thumbnail: GAME_ART_BY_SLUG["kingdom-breakers"], featured: true, version: "1.1.0", controls: "Drag to aim and release to fire. 1/2/3 switch ammo. Space or Enter fires while aiming.", progressSupport: true, scoreSupport: true, engine: { tier: "physics-siege", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "phantom-ages", title: "Phantom Ages", summary: "Age-of-War lane battle: bank gold, deploy real soldiers & archers, upgrade an auto-firing tower, advance five eras.", description: "A real Age-of-War lane battle with detailed troops — helmeted soldiers, hooded archers, gunners, mechs and fliers push down the lane while your upgradeable stone tower auto-fires. Earn gold from your units and spend it across three upgrade tracks (Cannon power/rate/range/multi-shot, Economy, and Fortress), advance through Stone, Bronze, Iron, Industrial and Future eras, and choose a Military or Tech path at the Industrial threshold that reshapes every era after it. Fixed-timestep sim with pooled units/projectiles, DPR-aware rendering that plays cleanly on phones. Break the enemy base before they break yours.", category: "Strategy", tags: ["strategy", "tug-of-war", "eras", "base-defense", "singleplayer"], contentRating: "everyone10", contentDescriptors: ["cartoon_action", "competitive_play"], developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/phantom-ages/index.html?v=2.1.1", thumbnail: GAME_ART_BY_SLUG["phantom-ages"], featured: true, version: "2.1.1", controls: "Tap units to deploy. Buy Cannon/Economy/Fortress upgrades. Space = Overcharge volley. Advance eras for stronger units. Mobile-ready.", progressSupport: false, scoreSupport: true },
  { id: "tidefront-tactics", title: "Tidefront Tactics", summary: "Wind-read artillery battles with angle, power, weapons, skiffs, bots, and room duels.", description: "The spear-like artillery battle you remembered: set angle and power, fire tactical tools across a deformable sea, read wind, crater cover, and beat rival skiffs through campaign, skirmish, or Fleet Room play.", category: "Strategy", tags: ["artillery", "tactics", "turn-based", "battle", "pvp"], contentRating: "everyone10", contentDescriptors: ["strategic_complexity", "mild_destruction", "competitive_play"], developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/tidefront-tactics.html?v=1.1.0", thumbnail: GAME_ART_BY_SLUG["tidefront-tactics"], featured: true, version: "1.1.0", controls: "Arrow keys adjust angle and power. Space fires. 1/2/3 switch tools.", progressSupport: true, scoreSupport: true, engine: { tier: "artillery-large-map", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "skyguard-arena", title: "Skyguard Arena", summary: "Bloons-style tower defense with free off-road Sentinel placement, one winding route, three-path Sentinel upgrades, starter sentries, and Century Watch bosses.", description: "A lane-based tower-defense game rebuilt closer to classic Bloons-style play: one big winding route instead of split lanes, free off-road Sentinel placement, starter sentries, and a first round with one Driftling before air pressure begins. Spend Glint to place Sentinels, then customize each tower through Power, Reach, and Tech upgrade paths with crosspath limits. Century Watch escalates toward round 100, boss mechanics rotate every 10 rounds, and Room Duel support stays network-silent through PhantomPlay rooms.", category: "Strategy", tags: ["tower-defense", "strategy", "endless", "bosses", "pvp", "waves"], contentRating: "everyone10", contentDescriptors: ["cartoon_action", "strategic_complexity", "competitive_play"], developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/skyguard-arena/index.html?v=1.3.3", thumbnail: GAME_ART_BY_SLUG["skyguard-arena"], featured: true, version: "1.3.3", controls: "Click/tap a Sentinel card, build anywhere off the road, then tune Power, Reach, and Tech upgrade paths. Q triggers Overcharge Pulse, P pauses, Escape deselects.", progressSupport: true, scoreSupport: true, engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "serpent-surge", title: "Serpent Surge", summary: "A fast snake arena with rivals, pickups, cutoffs, boost trails, and storm pressure across a sprawling scrollable map.", description: "A PhantomPlay take on snake arena games: orbit energy, grow long, bait rival serpents, use boost carefully, and survive a closing storm ring across a map many times bigger than the screen, with a camera that follows and zooms as you grow, plus a corner minimap.", category: "Strategy", tags: ["snake", "arena", "io", "survival", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/serpent-surge.html?v=1.1.0", thumbnail: GAME_ART_BY_SLUG["serpent-surge"], featured: true, version: "1.1.0", controls: "Steer with mouse, WASD, or arrows. Hold Space to boost.", progressSupport: true, scoreSupport: true, engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "pixel-bloom", title: "Pixel Bloom", summary: "Toddler-friendly neon bloom toy — no timer, no pressure, just gentle pattern play.", description: "A calm toddler-friendly creative toy with mirrored petals, no reading pressure, no timer, and no failure state.", category: "Creative", tags: ["toddler", "calm", "creative", "relax", "touch"], contentRating: "toddler", contentDescriptors: ["no_reading_required"], developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/pixel-bloom.html", thumbnail: GAME_ART_BY_SLUG["pixel-bloom"], featured: false, version: "1.0.0", controls: "Tap cells or arrows + Space", progressSupport: true, scoreSupport: true },
  { id: "type-storm", title: "Type Storm", summary: "Vertical word-rain typing: words actually fall, streaks glow, and the ramp stays readable.", description: "A revamped typing storm where words rain downward in vertical columns. Type the highlighted letters, chase combos, and survive a readable-but-serious speed ramp.", category: "Focus", tags: ["typing", "word-rain", "speed", "keyboard", "words"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/type-storm.html?v=1.1.0", thumbnail: GAME_ART_BY_SLUG["type-storm"], featured: false, version: "1.1.0", controls: "Just type — tap first on mobile", progressSupport: true, scoreSupport: true },
  { id: "phantom-dash", title: "Phantom Dash", summary: "Jump, double-jump, and flip gravity through a neon obstacle gauntlet.", description: "A Geometry Dash-style one-button runner with rising speed, gravity gates, neon hazards, score, levels, and quick restarts.", category: "Arcade", tags: ["runner", "jump", "geometry", "arcade", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/phantom-dash.html?v=1.1.0", thumbnail: GAME_ART_BY_SLUG["phantom-dash"], featured: true, version: "1.1.0", controls: "Space, up arrow, click, or tap to jump.", progressSupport: true, scoreSupport: true },
  { id: "penalty-kick", title: "Penalty Kick", summary: "Pick your lane, time the strike, and beat the keeper.", description: "A touch-friendly sports timing game with five shots, visible score, keeper reads, and saved score.", category: "Sports", tags: ["sports", "timing", "soccer", "touch"], contentRating: "toddler", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/penalty-kick.html?v=1.1.0", thumbnail: GAME_ART_BY_SLUG["penalty-kick"], featured: false, version: "1.1.0", controls: "Choose one of five lanes, read the keeper, then shoot in the sweet spot.", progressSupport: true, scoreSupport: true },
  { id: "color-rush", title: "Color Rush", summary: "Catch target colors through lane sweeps, rush chains, and combo pressure.", description: "Four falling columns with glowing target lanes, lane sweep feedback, target-change surges, catch/miss particle bursts, combo scoring, faster target swaps, audio feedback, and three-life pressure.", category: "Arcade", tags: ["reaction", "color", "keyboard", "touch"], contentRating: "toddler", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/color-rush.html?v=1.2.0", thumbnail: GAME_ART_BY_SLUG["color-rush"], featured: false, version: "1.2.0", controls: "A/S/D/F or tap a column.", progressSupport: true, scoreSupport: true },
  { id: "tile-flow", title: "Tile Flow", summary: "Rotate charged pipes through animated current paths.", description: "A tactile pipe-rotation puzzle with animated current flow, pulsing endpoints, twist feedback, board-wide solve surges, glow trails, and escalating boards.", category: "Puzzle", tags: ["logic", "calm", "keyboard", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/tile-flow.html?v=1.2.0", thumbnail: GAME_ART_BY_SLUG["tile-flow"], featured: false, version: "1.2.0", controls: "Click/tap to rotate, arrows to move.", progressSupport: true, scoreSupport: true },
  { id: "tower-tactics", title: "Tower Tactics", summary: "Slide, merge, and chain combo towers toward 2048.", description: "A sharper 4x4 merge puzzle with combo scoring, impact feedback, and glowing high-value towers.", category: "Strategy", tags: ["merge", "strategy", "keyboard", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/tower-tactics.html?v=1.1.0", thumbnail: GAME_ART_BY_SLUG["tower-tactics"], featured: false, version: "1.1.0", controls: "Arrow keys or swipe.", progressSupport: true, scoreSupport: true },
  { id: "breath-pacer", title: "Breath Pacer", summary: "Box-breathe with phase waves, flow streaks, and calming neon motion.", description: "An immersive breathing companion with expanding light, animated phase waves, timing accuracy, flow streaks, subtle synthesized tones, and a two-minute completion ritual.", category: "Focus", tags: ["calm", "breathing", "wellness", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/breath-pacer.html?v=1.2.0", thumbnail: GAME_ART_BY_SLUG["breath-pacer"], featured: false, version: "1.2.0", controls: "Tap or press Space on each phase.", progressSupport: true, scoreSupport: true },
  { id: "court-vision", title: "Court Vision", summary: "Sink neon free throws with ball trails, rim flashes, and streak heat.", description: "A physics free-throw shooter with growing distance, streak scoring, level scaling, ball trails, rim flash feedback, arena lights, synthesized court sounds, and three-miss pressure.", category: "Sports", tags: ["sports", "physics", "timing", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/court-vision.html?v=1.2.0", thumbnail: GAME_ART_BY_SLUG["court-vision"], featured: false, version: "1.2.0", controls: "Tap or press Space to shoot.", progressSupport: true, scoreSupport: true },
  { id: "circuit-serpent", title: "Circuit Serpent", summary: "Grow the serpent with packet bursts, visible levels, and rising speed.", description: "Classic snake on a circuit board upgraded with packet particle bursts, visible level progression, speed jumps every five packets, and one-crash arcade pressure.", category: "Arcade", tags: ["snake", "classic", "reaction", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/circuit-serpent.html?v=1.1.0", thumbnail: GAME_ART_BY_SLUG["circuit-serpent"], featured: false, version: "1.1.0", controls: "Arrows/WASD, swipe, or tap screen edges.", progressSupport: true, scoreSupport: true },
  { id: "echo-sequence", title: "Echo Sequence", summary: "Echo growing neon patterns with streaks, rings, and pad sparks.", description: "A memory-sequence classic upgraded with four glowing pads, original tones, streak scoring, expanding echo rings, pad sparks, and stronger hit/miss feedback.", category: "Focus", tags: ["memory", "sequence", "sound", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/echo-sequence.html?v=1.2.0", thumbnail: GAME_ART_BY_SLUG["echo-sequence"], featured: true, version: "1.2.0", controls: "Tap pads or press 1-4.", progressSupport: true, scoreSupport: true },
  { id: "signal-sweeper", title: "Signal Sweeper", summary: "Sweep a live signal grid with reveal-chain sparks and flags.", description: "Minesweeper with a guaranteed-safe first reveal, animated chain bursts, flag mode, long-press flagging, reveal-chain scoring, best-chain results, and a race-the-clock score.", category: "Strategy", tags: ["logic", "classic", "mines", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/signal-sweeper.html?v=1.2.0", thumbnail: GAME_ART_BY_SLUG["signal-sweeper"], featured: false, version: "1.2.0", controls: "Tap to reveal, long-press or F to flag.", progressSupport: true, scoreSupport: true },
  { id: "neon-breaker", title: "Neon Breaker", summary: "Break glowing bricks with combo chains, powerups, trails, and clean arcade physics.", description: "Breakout with real deflection physics, combo chains, ball trails, wide/slow powerups, six brick tiers, and levels that speed up as they clear.", category: "Arcade", tags: ["classic", "paddle", "levels", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/neon-breaker.html?v=1.1.0", thumbnail: GAME_ART_BY_SLUG["neon-breaker"], featured: true, version: "1.1.0", controls: "Drag or Arrow keys, Space to launch.", progressSupport: true, scoreSupport: true },
  { id: "logic-lights", title: "Logic Lights", summary: "Clear energized Lights Out boards with flip sparks and score pressure.", description: "Ten guaranteed-solvable Lights Out levels with par scoring, streak bonuses, animated flip sparks, level-clear board surges, audio feedback, and keyboard/touch controls.", category: "Puzzle", tags: ["logic", "lights-out", "calm", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/logic-lights.html?v=1.2.0", thumbnail: GAME_ART_BY_SLUG["logic-lights"], featured: false, version: "1.2.0", controls: "Tap cells or arrows + Enter.", progressSupport: true, scoreSupport: true },
  { id: "phantom-rumble", title: "Phantom Rumble", summary: "Local platform fighter with guard, parry, dodge, recovery, bots, and online room modes.", description: "A PhantomPlay fighter with solo, local multiplayer, Race to the Top, and networked private-room modes.", category: "Arcade", tags: ["fighter", "platform", "multiplayer", "pvp"], contentRating: "everyone10", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/phantom-rumble.html?v=2.2.4", thumbnail: GAME_ART_BY_SLUG["phantom-rumble"], featured: true, version: "2.2.4", controls: "Keyboard controls.", progressSupport: true, scoreSupport: true, engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "sudoku-signal", title: "Sudoku Signal", summary: "A calm Sudoku board with three difficulties and resume support.", description: "Sudoku with difficulty selection, pencil marks, and clean PhantomPlay save-state support.", category: "Puzzle", tags: ["sudoku", "logic", "calm"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/sudoku-signal.html?v=1.0.0", thumbnail: GAME_ART_BY_SLUG["sudoku-signal"], featured: false, version: "1.0.0", controls: "Click cells and number buttons, or use keyboard.", progressSupport: true, scoreSupport: true },
  { id: "cubetown", title: "CubeTown", summary: "A living blocky town — residents work, wander, fish, and chat through their day while you build.", description: "A cozy town-builder where the residents actually live: they walk their own daily routes, swing picks and axes at work, fish the pond, sweep the shrine, pair up to chat, and head home when it rains — with birds, butterflies, chimney smoke, and dusk-lit windows rounding out the town. Gathering, building, cooking, fishing, quests, farming, and safe private-room together play, now running noticeably smoother on big maps, with a gentle generative soundscape — wind, birdsong, crickets, and music-box notes that follow the time of day.", category: "Creative", tags: ["building", "life-sim", "cozy", "farming", "multiplayer", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/cubetown/index.html?v=1.3.0", thumbnail: GAME_ART_BY_SLUG["cubetown"], featured: true, version: "1.3.0", controls: "WASD/arrow keys or tap an adjacent tile. Space/E to interact.", progressSupport: true, scoreSupport: true, engine: { tier: "sandbox-large-map", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "keyboardist-on-tour", title: "Cipher Keep", summary: "A typing roguelike dungeon crawl — type your way through rooms, foes, and vaults.", description: "Type words to move through a shifting procedural dungeon, strike down foes in real-time typing duels, crack sealed vaults before their fuse burns out, and choose relics to empower your run. Every cleared room can recover an evidence fragment for your Clue Journal — and at each chapter gate, Archivist Sable asks you to type your own deduction about the Echo Warden case, with your answers, choices, and final typed verdict (mercy, bind, or teach) steering the story to one of three endings. Typing speed lands harder hits while mistake-free accuracy builds a Combo multiplier and fills Ink for Focus Surges.", category: "Focus", tags: ["typing", "roguelike", "dungeon", "keyboard", "permadeath", "procedural"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/keyboardist-on-tour.html?v=2.1.0", thumbnail: GAME_ART_BY_SLUG["keyboardist-on-tour"], featured: true, version: "2.1.0", controls: "Just type — full keyboard input, no fixed lane keys. Backspace corrects mistakes. P or Esc pauses. On-screen keyboard shown for touch.", progressSupport: true, scoreSupport: true },
  { id: "phantom-grand-prix", title: "Phantom Grand Prix", summary: "8-kart racing with hop-drift mini-turbos, slipstream, six items, four tracks, and a full Cup mode.", description: "An arcade kart racer grown into a real grand prix: hop into drifts to charge tiered mini-turbos, draft rivals for slipstream boosts, and fight an 8-kart field of named CPU racers through Ghostlight, Redwood, Aurora ice, and the new Meltdown Caldera lava track — boost pads, shortcuts, and hazards included. Grab item boxes for boosts, homing bolts, traps, shields, surges, and the field-zapping tempest, then chase the 4-round Grand Prix Cup to a podium finish. Solo or two-player split-screen.", category: "Arcade", tags: ["racing", "kart", "arcade", "drift", "cup", "multiplayer", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/phantom-grand-prix/index.html?v=2.0.0", thumbnail: GAME_ART_BY_SLUG["phantom-grand-prix"], featured: true, version: "2.0.0", controls: "P1: W/S/A/D, Shift drift, Space item, M mute. P2: arrows, slash drift, Enter item.", progressSupport: true, scoreSupport: true },
  { id: "beat-strike", title: "BeatStrike", summary: "Full-keyboard tap/hold rhythm game on a generated 128 BPM beatmap.", description: "Every letter key is live: tap and hold notes falling toward the hit line on a synthesized click track.", category: "Focus", tags: ["rhythm", "music", "keyboard", "timing"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/beat-strike/index.html?v=1.0.0", thumbnail: GAME_ART_BY_SLUG["beat-strike"], featured: false, version: "1.0.0", controls: "Every letter key is live.", progressSupport: false, scoreSupport: false },
  { id: "im-baked", title: "I'm Baked", summary: "Run a future cake shop: read orders, time the oven, decorate showpieces, and grow the shift.", description: "A complete cake-shop day loop with distinct customers, order tickets, bake timing, layered procedural cakes, visual finishes, customer patience, grades, coins, streaks, Story Shift, and Rush Counter modes.", category: "Creative", tags: ["cooking", "cakes", "shop", "creative", "simulation", "touch"], contentRating: "everyone", contentDescriptors: ["simulated_economy"], developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/im-baked.html?v=1.0.0", thumbnail: GAME_ART_BY_SLUG["im-baked"], featured: true, version: "1.0.0", controls: "Choose the ticketed ingredients, stop the oven in the green, decorate, and serve.", progressSupport: true, scoreSupport: true, engine: { tier: "creative-sim", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "vespergate", title: "Vespergate: The Vesper Hand", summary: "A crisp top-down portal adventure with a village to save, two dungeons, stronger combat feedback, and true fullscreen play.", description: "An original top-down action-adventure set across Duskhollow village, an open vale, the Hollow Geometry, and the Glass Ossuary. Strike, fire cinder bolts, and place two linked Vesper Gates that preserve momentum for you, projectiles, enemies, and bell shockwaves. Complete six quests, earn and equip relics, master bank shots and portal folds, defeat Bellmother and the Choir of Glass, then bring evensong home. Version 2.1 adds high-density rendering, a cinematic interface, native fullscreen, clearer objectives, room and threat readouts, combat telegraphs, damage feedback, and Soul Chain scoring.", category: "Arcade", tags: ["action-adventure", "portal", "gothic", "zelda-like", "top-down", "open-world", "gamepad"], contentRating: "teen", contentDescriptors: ["fantasy_conflict", "intense_action"], developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/vespergate/index.html?v=2.1.3", thumbnail: GAME_ART_BY_SLUG["vespergate"], featured: true, version: "2.1.3", controls: "WASD moves, left-click strikes, F fires, right-click places a gate, Q swaps, R vents, Shift rolls, E interacts, Tab opens inventory, and Alt+Enter toggles fullscreen. Full gamepad support.", progressSupport: true, scoreSupport: true },
  { id: "phantom-strike", title: "Phantom Strike", summary: "First-person tactical arena combat with weapon builds, bots, four maps, and real local split-screen.", description: "A network-silent first-person ray-cast shooter with Solo Ops against a bot squad, genuine same-device 1v1 split-screen, four compact maps including Neon Bazaar, rifle/SMG/shotgun/DMR builds, optics, barrels, hit feedback, respawns, and an after-action report.", category: "Arcade", tags: ["fps", "shooter", "first-person", "bots", "multiplayer", "split-screen", "gamepad"], contentRating: "teen", contentDescriptors: ["intense_action", "competitive_play"], multiplayerDescriptor: "Local 1v1 is real same-device split-screen. Solo Ops uses clearly labeled bots. No public matchmaking, chat, voice, or external networking.", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/phantom-strike.html?v=2.2.0", thumbnail: GAME_ART_BY_SLUG["phantom-strike"], featured: true, version: "2.2.0", controls: "Click to lock the mouse and look, WASD moves, click or Space fires. Gamepad: left stick moves, right stick turns, RT or A fires.", progressSupport: true, scoreSupport: true, engine: { tier: "raycast-fps", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "phantom-cube", title: "PhantomCube", summary: "Slide the cube across crumbling isometric tiles, clear the board, then reach the glowing exit.", description: "An original B-Cubed-style puzzle: 12 hand-designed levels, every one solver-proven beatable with a true minimum move count shown as par. Mechanics ramp from plain crumbling tiles to double-pass tiles, teleporter pairs, and combined finales. Numbered level-select grid with beat-one-to-unlock-the-next progression saved locally.", category: "Puzzle", tags: ["puzzle", "isometric", "tile-clearing", "levels"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/phantom-cube/index.html?v=1.0.0", thumbnail: GAME_ART_BY_SLUG["phantom-cube"], featured: true, version: "1.0.0", controls: "Arrows or WASD to slide, R to restart, L for level select", progressSupport: true, scoreSupport: true },
  { id: "phantom-chess", title: "Phantom Chess", summary: "Full-rules chess — local 2-player or against the Phantom AI.", description: "Complete chess with castling (including through-check rules), en passant, all four promotions, and check/checkmate/stalemate detection. The move generator passes the standard published perft node counts on four reference positions. The AI opponent is negamax with alpha-beta pruning at depth 3.", category: "Strategy", tags: ["chess", "board game", "ai", "local multiplayer"], contentRating: "everyone", multiplayerDescriptor: "Local 2-player, same device — no networking", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/phantom-chess/index.html?v=1.0.0", thumbnail: GAME_ART_BY_SLUG["phantom-chess"], featured: true, version: "1.0.0", controls: "Click or tap a piece, then a highlighted square", progressSupport: false, scoreSupport: true },
  { id: "phantom-pizzeria", title: "Phantom Pizzeria", summary: "Read the ticket, build the pie, bake it in the window, serve it hot — five orders a day.", description: "An original pizza-shop time-management game: order tickets with per-topping quantities, a patience meter, click-to-place toppings with undo, an oven timing window that tightens as days pass, and scoring split across topping accuracy, bake timing, and speed. New toppings unlock by day; best run is saved locally.", category: "Creative", tags: ["time-management", "cooking", "arcade", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/phantom-pizzeria/index.html?v=1.0.0", thumbnail: GAME_ART_BY_SLUG["phantom-pizzeria"], featured: false, version: "1.0.0", controls: "Click or tap toppings, then Oven and Pull & Serve", progressSupport: true, scoreSupport: true },
];

const ui = {
  tab: "library",
  loading: true,
  error: "",
  notice: "",
  offline: false,
  query: "",
  category: "All",
  roomMode: "friends",
  roomGameId: "",
  roomMessage: "",
  roomBusy: false,
  snapshot: null,
  player: null,
  playerReady: false,
  playerPaused: false,
  playerError: null,
  settingsOpen: false,
  editingSubmissionId: null,
  selectedDeveloperId: "",
  developerMessage: "",
  guardianMessage: "",
  ratingBusy: false,
  // In-player Dev Sandbox — a live, hot-reloading editor + mod menu drawer
  // over the running game. See openDevSandbox/applyDevSandboxEditLive.
  devSandbox: null,
  // Pre-launch code/mod workbench. The code icon opens this without starting
  // the game; Launch Dev Mode then boots the normal player and hydrates the
  // sandbox from this draft.
  devWorkbench: null,
  devModDockOpen: false,
};
// Set by launchWithDevSandbox(); consumed once the launched game reports
// "ready" (see onGameMessage) to auto-open Dev Sandbox after a normal launch,
// so Dev Sandbox is never a separate, differently-styled experience — it's
// the exact same player, just with the Dev Mode drawer opened automatically.
let pendingDevSandboxGameId = null;
let pendingDevSandboxBootState = null;

let mountedRoot = null;
let mountedOpts = null;
let playClock = null;
let playTickAt = 0;
let messageBound = false;
let keyboardBound = false;
let dragDropBound = false;
let playerClosing = false;
let roomPollTimer = null;
let roomPollTicks = 0;
// Pre-existing dead reference fixed in passing: closePlayer()/onGameMessage()
// already called clearTimeout(readyWatchdog) and launch() already called
// armReadyWatchdog(), but neither the variable nor the function existed
// anywhere in this file (a ReferenceError on every launch()). Restored the
// Games built outside PhantomPlay may not implement its optional ready
// message. The iframe load event and this watchdog both release the loading
// layer so valid uploaded games can never be trapped behind the spinner.
let readyWatchdog = null;
function armReadyWatchdog() {
  clearTimeout(readyWatchdog);
  // A game shows itself by posting the "ready" handshake. Custom/edited Dev Mode
  // code often doesn't implement that protocol; without a short fallback the
  // loading overlay would sit there and the game reads as "nothing happens".
  // Dev Mode gets a snappy lift; shipped games keep a longer grace for slow loads.
  const grace = ui.devSandbox ? 2600 : 6000;
  readyWatchdog = setTimeout(() => {
    if (ui.player && !ui.playerReady) {
      const frame = mountedRoot?.querySelector("[data-pp-frame]");
      markPlayerReady(frame, { protocol: false, focus: false });
    }
  }, grace);
}

function slugifyGame(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/^community:/u, "")
    .replace(/['']/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function slugifyDeveloper(value) {
  return slugifyGame(value) || "developer";
}

function artSlugFor(game) {
  const idSlug = slugifyGame(game?.id);
  if (GAME_ART_BY_SLUG[idSlug]) return idSlug;
  const titleSlug = slugifyGame(game?.title);
  return GAME_ART_BY_SLUG[titleSlug] ? titleSlug : "";
}

function isPlaceholderThumbnail(value) {
  const thumbnail = String(value || "");
  return !thumbnail || thumbnail.includes("/app/assets/poses/") || thumbnail.includes("brand-phantom") || thumbnail.includes("mode-dark");
}

function thumbnailFor(game) {
  const slug = artSlugFor(game);
  if (slug) return GAME_ART_BY_SLUG[slug];
  if (isPlaceholderThumbnail(game?.thumbnail)) return CATEGORY_ART[game?.category] || GAME_ART_BY_SLUG["neon-drift"];
  return game.thumbnail;
}

function developerNameFor(game) {
  return game?.kind === "built_in" || artSlugFor(game) || game?.developer === "Phantom Labs" ? "Tak" : (game?.developer || "Tak");
}

function normalizeGame(game) {
  const developer = developerNameFor(game);
  return {
    ...game,
    developer,
    devModeAvailable: game.devModeAvailable !== false,
    developerAvatar: developer === "Tak" ? (game.developerAvatar || TAK_AVATAR) : game.developerAvatar,
    thumbnail: thumbnailFor(game),
  };
}

function normalizeSnapshot(snapshot) {
  if (!snapshot) return snapshot;
  return {
    ...snapshot,
    catalog: Array.isArray(snapshot.catalog) ? snapshot.catalog.map(normalizeGame) : [],
    engine: snapshot.engine || PHANTOMPLAY_ENGINE,
    developerSpotlight: snapshot.developerSpotlight === "Phantom Labs" ? "Tak" : (snapshot.developerSpotlight || "Tak"),
  };
}

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) { const err = new Error(typeof payload?.error === "string" ? payload.error : `PhantomPlay request failed (${response.status}).`); err.status = response.status; throw err; }
  return payload;
}

async function fetchEditableGameSource(game) {
  const response = await fetch(game.launchUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Game source could not be loaded (${response.status}).`);
  const source = await response.text();
  if (!/<html\b|<!doctype\s+html/iu.test(source)) throw new Error("The game server returned an invalid HTML document.");
  return cleanEditableGameSource(source);
}

function hasWorkspaceSession() {
  const saved = typeof session.get === "function" ? session.get() : null;
  return !!(session.token() || saved?.sessionId || saved?.email || saved?.role || saved?.name || saved?.id);
}

function offlineState() {
  let saved = {};
  try { saved = JSON.parse(workspaceStorageGetItem(FALLBACK_KEY) || "{}"); } catch {}
  const signedInWorkspace = hasWorkspaceSession();
  return {
    tenantId: currentTenantId(),
    actorId: "offline",
    access: { enabled: signedInWorkspace, reason: signedInWorkspace ? "local_play_fallback" : "workspace_session_required", dailyMinuteLimit: 100000, usedMinutesToday: 0, remainingMinutesToday: 100000, canSubmitGames: signedInWorkspace, canModerate: isAdmin() || isOwnerOperator(), isOwner: isOwnerOperator() },
    catalog: BUILT_INS.map(normalizeGame),
    favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
    history: Array.isArray(saved.history) ? saved.history : [],
    leaderboards: { overall: [], byGame: [] },
    preferences: { contentRating: "teen", allowedRatings: [...ALL_RATING_VALUES], sound: saved.sound !== false, reducedMotion: !!saved.reducedMotion, allowCommunityGames: true },
    profileType: "adult",
    guardianLock: { enabled: false },
    engine: PHANTOMPLAY_ENGINE,
    rooms: [],
    submissions: [],
    developerSpotlight: "Tak",
    approvedCommunityCount: 0,
  };
}

function saveOffline(snapshot = ui.snapshot) {
  if (!snapshot) return;
  workspaceStorageSetItem(FALLBACK_KEY, JSON.stringify({ favorites: snapshot.favorites, history: snapshot.history, sound: snapshot.preferences.sound, reducedMotion: snapshot.preferences.reducedMotion }));
}

function loadDeveloperSupport() {
  try {
    const saved = JSON.parse(workspaceStorageGetItem(DEV_SUPPORT_KEY) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function saveDeveloperSupport(records) {
  workspaceStorageSetItem(DEV_SUPPORT_KEY, JSON.stringify(records));
}

async function hydrate() {
  ui.loading = true;
  ui.error = "";
  ui.notice = "";
  render();
  try {
    const payload = await api(`/api/phantomplay?tenant_id=${encodeURIComponent(currentTenantId())}`);
    ui.snapshot = normalizeSnapshot(payload);
    ui.offline = false;
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) {
      ui.snapshot = normalizeSnapshot(offlineState());
      ui.offline = true;
      ui.error = error.status === 401 ? "Sign in again to sync PhantomPlay. Local built-in games are still available." : "This workspace cannot sync PhantomPlay yet. Local built-in games are still available.";
    } else {
      ui.snapshot = normalizeSnapshot(offlineState());
      ui.offline = true;
      ui.error = "";
    }
  } finally {
    ui.loading = false;
    render();
  }
}

function icon(name) {
  const paths = {
    play: '<path d="M6 4l7 4-7 4z"/>', heart: '<path d="M8 13s-5-3-5-7a3 3 0 0 1 5-2 3 3 0 0 1 5 2c0 4-5 7-5 7z"/>',
    search: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>', clock: '<circle cx="8" cy="8" r="5"/><path d="M8 5v3l2 1"/>',
    game: '<rect x="2.5" y="5" width="11" height="7" rx="2"/><path d="M5 7v3M3.5 8.5h3M10.8 7.5h.1M12 9.5h.1"/>',
    dev: '<path d="M5.5 5L3 8l2.5 3M10.5 5L13 8l-2.5 3M9 3.5 7 12.5"/>', settings: '<circle cx="8" cy="8" r="2"/><path d="M8 2.5v1.5M8 12v1.5M2.5 8H4M12 8h1.5"/>',
  };
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.game}</svg>`;
}

function historyFor(gameId) {
  return ui.snapshot?.history?.find((item) => item.gameId === gameId) || null;
}

function fallbackLeaderboards(snapshot = ui.snapshot) {
  const history = Array.isArray(snapshot?.history) ? snapshot.history : [];
  const catalog = generalPlayGames(Array.isArray(snapshot?.catalog) ? snapshot.catalog : []);
  const catalogIds = new Set(catalog.map((game) => game.id));
  const rows = history.filter((item) => item.score != null && catalogIds.has(item.gameId)).map((item) => {
    const game = catalog.find((entry) => entry.id === item.gameId);
    return { gameId: item.gameId, gameTitle: game?.title || item.gameId, player: "You", score: Number(item.score) || 0, seconds: Number(item.seconds) || 0, updatedAt: item.lastPlayedAt, isYou: true };
  }).sort((a, b) => b.score - a.score || a.seconds - b.seconds);
  return { overall: rows.slice(0, 10), byGame: catalog.map((game) => ({ gameId: game.id, gameTitle: game.title, rows: rows.filter((row) => row.gameId === game.id).slice(0, 5) })).filter((board) => board.rows.length) };
}

function playTimeLabel(value, compact = false) {
  return Number(value) >= 10000 ? (compact ? "Unlimited" : "Unlimited play") : `${Number(value) || 0}${compact ? "" : " min left"}`;
}

function developerAvatarFor(game) {
  const developer = developerNameFor(game);
  return game.developerAvatar || (developer === "Tak" ? TAK_AVATAR : "");
}

function devScoreFor(developer, support = {}) {
  const games = Array.isArray(developer.games) ? developer.games : [];
  const releaseScore = Math.min(22, games.length * 5);
  const featuredScore = Math.min(12, Number(developer.featuredCount) * 3);
  const capabilityScore = Math.min(12, games.filter((game) => game.scoreSupport || game.progressSupport).length * 2);
  const communityScore = Math.min(6, games.filter((game) => game.kind === "community").length * 3);
  const supportScore = Math.min(8, (Number(support.supportCount) || 0) * 2 + (Number(support.donationIntentCount) || 0) * 2);
  return Math.max(0, Math.min(100, Math.round(54 + releaseScore + featuredScore + capabilityScore + communityScore + supportScore)));
}

function developerDirectory() {
  const supportRecords = loadDeveloperSupport();
  const directory = new Map();
  for (const game of ui.snapshot?.catalog || []) {
    const name = developerNameFor(game);
    const id = slugifyDeveloper(name);
    const entry = directory.get(id) || { id, name, avatar: "", games: [], categories: new Set(), featuredCount: 0 };
    entry.avatar ||= developerAvatarFor(game);
    entry.games.push(game);
    entry.categories.add(game.category);
    if (game.featured) entry.featuredCount += 1;
    directory.set(id, entry);
  }
  return [...directory.values()].map((developer) => {
    const support = supportRecords[developer.id] || {};
    const notes = Array.isArray(support.notes) ? support.notes : [];
    return {
      ...developer,
      categories: [...developer.categories].filter(Boolean).sort(),
      supportCount: Number(support.supportCount) || 0,
      donationIntentCount: Number(support.donationIntentCount) || 0,
      notes: notes.slice(0, 8),
      supported: !!support.supported,
      score: devScoreFor(developer, support),
    };
  }).sort((a, b) => b.score - a.score || b.games.length - a.games.length || a.name.localeCompare(b.name));
}

function selectedDeveloper() {
  return developerDirectory().find((developer) => developer.id === ui.selectedDeveloperId) || null;
}

function savedDateLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Saved";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const multiplayerGame = (game) => game.localMultiplayer || game.onlineMultiplayer || game.multiplayerDescriptor || game.tags?.some((tag) => /multiplayer|friends|party|duel|arena|io/i.test(tag)) || ["phantom-rumble"].includes(game.id);
const kidsPick = (game) => KIDS_ONLY_GAME_IDS.has(game.id) || String(game.category || "").toLowerCase() === "kids";
const generalPlayGames = (games) => games.filter((game) => !kidsPick(game));
const displayCategoryFor = (game) => kidsPick(game) ? "Kids" : game.category;
function sortGames(games, sort = ui.category) {
  if (sort === "Kids") return games.filter(kidsPick);
  if (sort === "Solo") return generalPlayGames(games).filter((game) => !multiplayerGame(game));
  if (sort === "Multiplayer") return generalPlayGames(games).filter(multiplayerGame);
  if (CATEGORIES.includes(sort) && sort !== "All") return generalPlayGames(games).filter((game) => game.category === sort);
  return generalPlayGames(games);
}

function canLaunchGames(snapshot = ui.snapshot) {
  return !!snapshot?.access?.enabled || (ui.offline && hasWorkspaceSession());
}

function localPlay(game, opts = {}) {
  const existing = historyFor(game.id);
  ui.player = {
    game,
    play: {
      id: `local-${game.id}-${Date.now()}`,
      gameId: game.id,
      seconds: 0,
      score: Number(existing?.score) || 0,
      progress: Number(existing?.progress) || 0,
      startedAt: new Date().toISOString(),
    },
    roomCode: opts.roomCode || null,
    restoreState: existing?.state || null,
  };
  ui.error = "";
  ui.playerReady = false;
  ui.playerPaused = false;
  ui.playerError = null;
  playTickAt = Date.now();
  render();
  startClock();
  armReadyWatchdog();
}

function gameCard(game, variant = "") {
  const favorite = ui.snapshot.favorites.includes(game.id);
  const history = historyFor(game.id);
  const developerAvatar = developerAvatarFor(game);
  const developer = developerNameFor(game);
  const thumbnail = thumbnailFor(game);
  const launchable = canLaunchGames();
  const playLabel = history?.canContinue ? "Continue" : "Play now";
  return `<article class="pp-game ${variant}" data-pp-game-card="${esc(game.id)}">
    <div class="pp-game-art" style="--pp-game-art:url('${esc(thumbnail)}')"><img src="${esc(thumbnail)}" alt="" loading="lazy"/><span>${esc(displayCategoryFor(game))}</span>${game.kind === "community" ? "<em>Prototype</em>" : ""}</div>
    <div class="pp-game-body"><div class="pp-game-title"><p class="pp-game-developer">${developerAvatar ? `<img src="${esc(developerAvatar)}" alt="" loading="lazy"/>` : ""}<span>By ${esc(developer)}</span></p><h3>${esc(game.title)}</h3></div><button type="button" class="pp-favorite ${favorite ? "is-on" : ""}" data-pp-favorite="${esc(game.id)}" aria-label="${favorite ? "Remove from" : "Add to"} favorites">${icon("heart")}</button>
    <p>${esc(game.summary)}</p>
    <div class="pp-game-meta"><span>${esc(game.contentRating === "everyone" ? "Everyone" : game.contentRating)}</span><span>v${esc(game.version)}</span>${history?.score != null ? `<span>Best ${history.score}</span>` : ""}</div>
    ${history?.canContinue ? `<div class="pp-progress"><i style="width:${Math.max(3, Math.min(100, history.progress))}%"></i></div>` : ""}
    <div class="pp-game-actions"><button class="pp-play" type="button" ${launchable ? `data-pp-play="${esc(game.id)}"` : `data-pp-session-required="${esc(game.id)}"`}>${icon("play")} ${launchable ? playLabel : "Plan locked"}</button><button class="pp-support" type="button" data-pp-support="${esc(game.developer)}">Support this creator</button>${game.devModeAvailable ? `<button class="pp-devsandbox-card-open" type="button" ${launchable ? `data-pp-devsandbox-card-open="${esc(game.id)}"` : `data-pp-session-required="${esc(game.id)}"`} aria-label="Open Dev Mode for ${esc(game.title)}" title="Dev Mode — live-edit this game's code and assets while you play, sandboxed and visible only to you">${icon("dev")}<b>Dev Mode</b></button><button class="pp-devsandbox-code-open" type="button" ${launchable ? `data-pp-devsandbox-code-open="${esc(game.id)}"` : `data-pp-session-required="${esc(game.id)}"`} aria-label="Open full source code for ${esc(game.title)}" title="Open the full game source. Edits hot-reload and autosave.">${icon("dev")}<i></i></button>` : ""}</div></div>
  </article>`;
}

function empty(title, copy) {
  return `<div class="pp-empty"><span>${icon("game")}</span><h3>${esc(title)}</h3><p>${esc(copy)}</p></div>`;
}

function gameRows(games, title, copy = "") {
  return `<section class="pp-section"><div class="pp-section-head"><div><h2>${esc(title)}</h2>${copy ? `<p>${esc(copy)}</p>` : ""}</div>${games.length > 3 ? `<button type="button" data-pp-tab="library">View all</button>` : ""}</div>${games.length ? `<div class="pp-game-grid">${games.map((game) => gameCard(game)).join("")}</div>` : empty(`No ${title.toLowerCase()} yet`, "Games will appear here when there is something real to show.")}</section>`;
}

function renderHome() {
  const visibleCatalog = generalPlayGames(ui.snapshot.catalog);
  const featured = visibleCatalog.filter((game) => game.featured);
  const recent = ui.snapshot.history.map((item) => visibleCatalog.find((game) => game.id === item.gameId)).filter(Boolean).slice(0, 4);
  const continuing = ui.snapshot.history.filter((item) => item.canContinue).map((item) => visibleCatalog.find((game) => game.id === item.gameId)).filter(Boolean).slice(0, 4);
  const community = visibleCatalog.filter((game) => game.kind === "community").slice(0, 4);
  const activeGameId = featured[0]?.id || visibleCatalog[0]?.id || "";
  return `<div class="pp-home">
    <section class="pp-hero">
      <div class="pp-console-copy">
        <p class="pp-kicker">GAME SANDBOX</p>
        <h1>Build, playtest, and tune games here.</h1>
        <p>PhantomPlay is not a marketplace. It is a sandbox where indie devs make playable builds, invite feedback, test with people, and export when the game is ready.</p>
        <div class="pp-console-actions">
          <button class="pp-primary" ${canLaunchGames() ? `data-pp-play="${esc(activeGameId)}"` : `data-pp-session-required="${esc(activeGameId)}"`}>${icon("play")} ${canLaunchGames() ? "Run quick session" : "Plan locked"}</button>
          <button class="pp-secondary" data-pp-tab="library">Open play lab</button>
          <button class="pp-secondary" data-pp-tab="together">Play with friends</button>
        </div>
      </div>
      <div class="pp-console-panel" aria-hidden="true">
        <span>STATUS: READY</span>
        <span>PROFILE: ${esc(ui.snapshot.actorId || "local")}</span>
        <span>TENANT: ${esc(ui.snapshot.tenantId || currentTenantId())}</span>
        <span>SANDBOX: PHANTOMPLAY</span>
      </div>
      <img src="/app/assets/poses/mode-dark-ask.webp" alt="Phantom presenting PhantomPlay"/>
    </section>
    <section class="pp-quick-stats"><span><b>${esc(playTimeLabel(ui.snapshot.access.remainingMinutesToday, true))}</b><i>${ui.snapshot.access.remainingMinutesToday >= 10000 ? "internal access" : "minutes left today"}</i></span><span><b>${ui.snapshot.favorites.length}</b><i>saved games</i></span><span><b>${ui.snapshot.history.length}</b><i>played</i></span><span><b>${ui.snapshot.approvedCommunityCount}</b><i>reviewed prototypes</i></span></section>
    ${continuing.length ? gameRows(continuing, "Continue playing", "Pick up from your last saved point.") : ""}
    ${gameRows(featured, "Ready to play", "Fast, polished builds selected for the play lab.")}
    ${recent.length ? gameRows(recent, "Recently played") : ""}
    ${gameRows(community, "Shared prototypes", "Reviewed builds from dev rooms appear here when they are safe to test.")}
    <section class="pp-spotlight"><img src="${esc(TAK_AVATAR)}" alt=""/><div><p class="pp-kicker">SANDBOX BUILDER SPOTLIGHT</p><h2>${esc(ui.snapshot.developerSpotlight)}</h2><p>PhantomPlay is for creators who want a private build room, playtest feedback, version notes, and a clean path to ship later.</p><button class="pp-secondary" data-pp-tab="developer">Open dev rooms</button></div></section>
  </div>`;
}

function leaderboardRows(rows = []) {
  return rows.length ? rows.map((row, index) => `<li class="${row.isYou ? "is-you" : ""}"><b>#${index + 1}</b><span>${esc(row.player)}</span><strong>${Number(row.score).toLocaleString()}</strong><em>${esc(row.gameTitle || "")}</em></li>`).join("") : `<li class="is-empty"><span>No scores yet. Play a game and claim the board.</span></li>`;
}

function renderLeaderboardPreview() {
  const boards = (ui.snapshot.leaderboards?.overall?.length || ui.snapshot.leaderboards?.byGame?.length) ? ui.snapshot.leaderboards : fallbackLeaderboards();
  return `<section class="pp-leaderboard pp-leaderboard-preview"><div class="pp-section-head"><div><h2>Phantom leaderboard</h2><p>Compare scores across players without exposing private game behavior.</p></div><button type="button" data-pp-tab="leaderboard">View board</button></div><ol>${leaderboardRows((boards.overall || []).slice(0, 5))}</ol></section>`;
}

function renderLeaderboard() {
  const boards = (ui.snapshot.leaderboards?.overall?.length || ui.snapshot.leaderboards?.byGame?.length) ? ui.snapshot.leaderboards : fallbackLeaderboards();
  return `<section class="pp-leaderboard"><div class="pp-section-head"><div><h2>Phantom leaderboard</h2><p>Top scores across PhantomPlay creator games.</p></div></div><ol>${leaderboardRows(boards.overall || [])}</ol><div class="pp-board-grid">${(boards.byGame || []).map((board) => `<article><h3>${esc(board.gameTitle)}</h3><ol>${leaderboardRows(board.rows || [])}</ol></article>`).join("") || empty("No leaderboard data yet", "Play a score-enabled game to seed the first leaderboard.")}</div></section>`;
}

function filteredCatalog() {
  return sortGames(ui.snapshot.catalog, "All");
}

function renderLibrary() {
  const games = filteredCatalog();
  return `<section class="pp-library">${games.length ? `<div class="pp-game-grid pp-game-grid-full">${games.map((game) => gameCard(game)).join("")}</div>` : empty("No games ready", "New builds will appear here when they are available.")}</section>`;
}

function renderFavorites() {
  const games = generalPlayGames(ui.snapshot.catalog).filter((game) => ui.snapshot.favorites.includes(game.id));
  return games.length ? `<div class="pp-game-grid pp-game-grid-full">${games.map((game) => gameCard(game)).join("")}</div>` : empty("No favorites yet", "Tap the heart on any game to save it here.");
}

// Connection status derived purely from lastSeenAt age — no separate
// heartbeat route. "Just now" = updated in the last 20s (join/leave/ready or
// the polling loop's periodic ready-touch). "Reconnecting" = stale but still
// inside the room's own reconnectGraceSeconds. "Away" = stale beyond that.
function connectionStatusFor(participant, room) {
  if (participant.status === "left") return { label: "Left", cls: "is-left" };
  const lastSeenMs = Date.parse(participant.lastSeenAt || participant.joinedAt || 0);
  const ageSeconds = Number.isFinite(lastSeenMs) ? Math.max(0, (Date.now() - lastSeenMs) / 1000) : Infinity;
  const grace = Number(room.reconnectGraceSeconds) || 45;
  if (ageSeconds < 20) return { label: "Just now", cls: "is-live" };
  if (ageSeconds < grace) return { label: "Reconnecting", cls: "is-pending" };
  return { label: "Away", cls: "is-away" };
}

function roomRoster(room) {
  const participants = Array.isArray(room.participants) ? room.participants : [];
  if (!participants.length) return "<em>No players joined yet.</em>";
  return participants.map((participant) => {
    const ready = room.readyStates?.[participant.actorId] === true;
    const isMe = participant.actorId === ui.snapshot.actorId;
    const conn = connectionStatusFor(participant, room);
    return `<span class="pp-roster-row ${participant.status === "online" ? "is-online" : ""}">
      <b>${esc(participant.label || "Player")}</b>
      <i>${esc(participant.role === "host" ? "host" : participant.status)}</i>
      <em class="pp-conn-dot ${conn.cls}" title="Connection: ${esc(conn.label)}">${esc(conn.label)}</em>
      ${isMe
        ? `<button type="button" class="pp-ready-toggle ${ready ? "is-ready" : ""}" data-pp-room-ready="${esc(room.code)}" data-pp-ready-next="${ready ? "0" : "1"}">${ready ? "Ready ✓" : "Set ready"}</button>`
        : `<span class="pp-ready-badge ${ready ? "is-ready" : ""}">${ready ? "Ready" : "Not ready"}</span>`}
    </span>`;
  }).join("");
}

function hostControlsMarkup(room) {
  const isHost = room.hostActorId === ui.snapshot.actorId;
  const controls = room.hostControls || { allowBotFill: false, maxHumans: room.maxPlayers };
  if (!isHost) {
    return `<div class="pp-room-hostctl is-readonly"><span>Bot fill ${controls.allowBotFill ? "on" : "off"}</span><span>Max humans ${esc(controls.maxHumans)}</span></div>`;
  }
  return `<div class="pp-room-hostctl">
    <label class="pp-switch"><input type="checkbox" data-pp-room-botfill="${esc(room.code)}" ${controls.allowBotFill ? "checked" : ""}/><span></span>Allow bot fill</label>
    <label>Max humans<input type="number" min="1" max="${esc(room.maxPlayers)}" value="${esc(controls.maxHumans)}" data-pp-room-maxhumans="${esc(room.code)}"/></label>
  </div>`;
}

function botSlotsMarkup(room) {
  const slots = Array.isArray(room.botSlots) ? room.botSlots : [];
  if (!slots.length) return "";
  return `<div class="pp-room-botslots">${slots.map((slot) => `<span class="pp-bot-chip">Bot · ${esc(slot.difficulty || "standard")}</span>`).join("")}</div>`;
}

function roomCard(room) {
  return `<article class="pp-room-card pp-room-live">
    <header><div><p class="pp-kicker">${room.mode === "classroom" ? "CLASSROOM ROOM" : "FRIENDS ROOM"}</p><h3>${esc(room.gameTitle)}</h3></div><strong>${esc(room.code)}</strong></header>
    <p>Workspace-only room. Share the short code with people who are signed into the same workspace.</p>
    <div class="pp-room-roster">${roomRoster(room)}</div>
    ${hostControlsMarkup(room)}
    ${botSlotsMarkup(room)}
    <div class="pp-room-actions"><button type="button" class="pp-primary" data-pp-room-play="${esc(room.gameId)}" data-pp-room-code="${esc(room.code)}">${icon("play")} Launch game</button><button type="button" class="pp-secondary" data-pp-copy-room="${esc(room.code)}">Copy code</button><button type="button" class="pp-secondary" data-pp-room-leave="${esc(room.code)}">Leave</button></div>
  </article>`;
}

function renderTogether() {
  const rooms = Array.isArray(ui.snapshot.rooms) ? ui.snapshot.rooms : [];
  const classroomGames = generalPlayGames(ui.snapshot.catalog).filter((game) => ui.roomMode !== "classroom" || game.contentRating === "everyone");
  const selectedGameId = classroomGames.some((game) => game.id === ui.roomGameId) ? ui.roomGameId : (classroomGames[0]?.id || "");
  return `<div class="pp-together" data-pp-private-rooms>
    <section class="pp-room-hero">
      <div><p class="pp-kicker">MULTIPLAYER</p><h2>Play together with friends in this workspace.</h2><p>Create a private room, invite up to a few friends with a short-lived join code, and jump into a real match — ready checks, host controls, bot fill-in if someone's missing, and reconnect if your connection drops. Built-in games keep their no-internet rule; the app only relays room membership and match state.</p></div>
      <div class="pp-room-principles"><span>No public discovery</span><span>No direct inbound device ports</span><span>No room chat or voice</span><span>Same workspace only</span></div>
    </section>
    <section class="pp-room-layout">
      <form class="pp-room-card" data-pp-create-room-form>
        <header><div><p class="pp-kicker">CREATE</p><h3>Start a private room</h3></div><span>${ui.offline ? "Sync needed" : "Ready"}</span></header>
        <label>Mode<select data-pp-room-mode name="mode"><option value="classroom" ${ui.roomMode === "classroom" ? "selected" : ""}>Classroom</option><option value="friends" ${ui.roomMode === "friends" ? "selected" : ""}>Friends</option></select></label>
        <label>Game<select data-pp-room-game name="gameId" ${classroomGames.length ? "" : "disabled"}>${classroomGames.map((game) => `<option value="${esc(game.id)}" ${game.id === selectedGameId ? "selected" : ""}>${esc(game.title)} · ${esc(game.contentRating === "everyone" ? "Everyone" : game.contentRating)}</option>`).join("")}</select></label>
        <label>Room size<input name="maxPlayers" type="number" min="2" max="${ui.roomMode === "classroom" ? "30" : "8"}" value="${ui.roomMode === "classroom" ? "12" : "6"}"/></label>
        <button type="submit" class="pp-primary" ${ui.offline || !classroomGames.length || ui.roomBusy ? "disabled" : ""}>Create room code</button>
        <p>Classroom mode only allows Everyone-rated games and keeps discovery off.</p>
      </form>
      <form class="pp-room-card" data-pp-join-room-form>
        <header><div><p class="pp-kicker">JOIN</p><h3>Join with a code</h3></div><span>Private</span></header>
        <label>Room code<input name="code" value="" autocomplete="off" inputmode="text" maxlength="12" placeholder="A1B2C3"/></label>
        <button type="submit" class="pp-secondary" ${ui.offline || ui.roomBusy ? "disabled" : ""}>Join room</button>
        <p>Codes do not list public rooms. Users must already have PhantomForce access for this workspace.</p>
      </form>
    </section>
    ${ui.roomMessage ? `<div class="pp-banner ${ui.roomMessage.startsWith("Blocked") ? "is-error" : "is-offline"}"><b>Private room status</b><span>${esc(ui.roomMessage)}</span><button type="button" data-pp-room-clear>Clear</button></div>` : ""}
    <section class="pp-room-safety">
      <div><p class="pp-kicker">SAFE BY DEFAULT</p><h3>Private rooms, workspace-only.</h3><p>Short join codes, no public discovery, classroom mode restricts to Everyone-rated games automatically, and every built-in game still makes zero external network calls of its own — the app relays room and match state, nothing more.</p></div>
      <ul><li>Signed-in same-tenant join policy</li><li>Room invite expires after 90 minutes</li><li>Roster only; no private messaging</li><li>Games still run in script-only iframes</li></ul>
    </section>
    <section class="pp-section"><div class="pp-section-head"><div><h2>Your multiplayer rooms</h2><p>Only rooms you host or have joined are shown here.</p></div><span>${rooms.length} visible</span></div>${rooms.length ? `<div class="pp-room-grid">${rooms.map(roomCard).join("")}</div>` : empty("No rooms yet", "Create a room or join with a code to start playing together.")}</section>
  </div>`;
}

function submissionCard(item, admin = false) {
  const canEdit = !admin && ["draft", "changes_requested", "rejected"].includes(item.status);
  return `<article class="pp-submission"><header><div><p>${esc(item.developerName)} · v${esc(item.version)}</p><h3>${esc(item.title || "Untitled build")}</h3></div><span class="is-${esc(item.status)}">${esc(item.status.replaceAll("_", " "))}</span></header><p>${esc(item.summary || "No summary yet.")}</p><div class="pp-submission-meta"><span>${esc(item.category)}</span><span>${esc(item.contentRating)}</span><span>${item.screenshots.length} screenshots</span><span>${item.versions.length} versions</span></div>${item.moderationNote ? `<blockquote>${esc(item.moderationNote)}</blockquote>` : ""}${canEdit ? `<button type="button" class="pp-secondary" data-pp-edit-submission="${esc(item.id)}">Edit build</button>` : ""}${admin && item.status !== "disabled" ? `<div class="pp-moderate"><input type="text" data-pp-note="${esc(item.id)}" maxlength="1000" placeholder="Review note"/><label><input type="checkbox" data-pp-featured="${esc(item.id)}"/> Add to Play Lab if approved</label><div><button data-pp-moderate="approved" data-id="${esc(item.id)}">Approve</button><button data-pp-moderate="changes_requested" data-id="${esc(item.id)}">Request changes</button><button data-pp-moderate="rejected" data-id="${esc(item.id)}">Reject</button><button data-pp-moderate="disabled" data-id="${esc(item.id)}">Disable</button></div></div>` : ""}</article>`;
}

function selectedSubmission() {
  return ui.snapshot.submissions.find((item) => item.id === ui.editingSubmissionId) || null;
}

function developerCard(developer) {
  const previewGames = developer.games.slice(0, 4);
  return `<article class="pp-dev-card">
    <header>
      <img src="${esc(developer.avatar || TAK_AVATAR)}" alt="" loading="lazy"/>
      <div><p class="pp-kicker">DEV ROOM</p><h3>${esc(developer.name)}</h3><span>${developer.games.length} playable build${developer.games.length === 1 ? "" : "s"}</span></div>
      <strong><b>${developer.score}</b><span>Dev score</span></strong>
    </header>
    <div class="pp-dev-thumbs">${previewGames.map((game) => `<img src="${esc(thumbnailFor(game))}" alt="" loading="lazy"/>`).join("")}</div>
    <p>${esc(developer.categories.join(" / ") || "PhantomPlay")} builder with ${developer.featuredCount} lab-ready build${developer.featuredCount === 1 ? "" : "s"} and ${developer.supportCount} local support mark${developer.supportCount === 1 ? "" : "s"}.</p>
    <div class="pp-dev-tags">${developer.categories.map((category) => `<span>${esc(category)}</span>`).join("")}</div>
    <button type="button" class="pp-secondary" data-pp-open-dev="${esc(developer.id)}">View profile</button>
  </article>`;
}

function renderDeveloperProfile(developer) {
  const notes = developer.notes.length ? developer.notes.map((note) => `<li><span>${esc(savedDateLabel(note.at))}</span><p>${esc(note.text)}</p></li>`).join("") : `<li class="is-empty"><p>No private dev notes yet.</p></li>`;
  return `<div class="pp-developer">
    <section class="pp-dev-profile">
      <button type="button" class="pp-secondary pp-dev-back" data-pp-dev-back>← Dev Rooms</button>
      <header>
        <img src="${esc(developer.avatar || TAK_AVATAR)}" alt="" loading="lazy"/>
        <div><p class="pp-kicker">DEV ROOM</p><h2>${esc(developer.name)}</h2><span>${developer.games.length} playable build${developer.games.length === 1 ? "" : "s"} · ${developer.categories.join(" / ") || "PhantomPlay"}</span></div>
        <strong><b>${developer.score}</b><span>Dev score</span></strong>
      </header>
      <div class="pp-dev-stats">
        <span><b>${developer.games.length}</b><i>Builds</i></span>
        <span><b>${developer.featuredCount}</b><i>Lab ready</i></span>
        <span><b>${developer.supportCount}</b><i>Support</i></span>
        <span><b>${developer.donationIntentCount}</b><i>Collab intent</i></span>
      </div>
      <div class="pp-dev-actions">
        <button type="button" class="pp-primary" data-pp-support-dev="${esc(developer.id)}">${developer.supported ? "Supported" : "Support builder"}</button>
        <button type="button" class="pp-secondary" data-pp-donate-dev="${esc(developer.id)}">Mark collab interest</button>
        <p>No payment starts here. Support and collaboration interest are saved privately in this workspace.</p>
      </div>
      ${ui.developerMessage ? `<div class="pp-banner is-offline"><b>Developer note</b><span>${esc(ui.developerMessage)}</span><button type="button" data-pp-dev-message-clear>Clear</button></div>` : ""}
    </section>
    <section class="pp-dev-profile-grid">
      <div class="pp-dev-notes">
        <header><div><p class="pp-kicker">PRIVATE NOTES</p><h3>Playtest notes</h3></div></header>
        <textarea data-pp-dev-note-text rows="4" maxlength="800" placeholder="Feedback, tuning ideas, bugs, controls, art direction..."></textarea>
        <button type="button" class="pp-secondary" data-pp-save-dev-note="${esc(developer.id)}">Save private note</button>
        <ul>${notes}</ul>
      </div>
      <div class="pp-dev-games">
        <div class="pp-section-head"><div><h2>Playable builds by ${esc(developer.name)}</h2><p>Every reviewed PhantomPlay build currently available to test.</p></div><span>${developer.games.length} builds</span></div>
        <div class="pp-game-grid pp-game-grid-full">${developer.games.map((game) => gameCard(game)).join("")}</div>
      </div>
    </section>
  </div>`;
}

function renderDeveloper() {
  const developers = developerDirectory();
  const developer = selectedDeveloper();
  if (developer) return renderDeveloperProfile(developer);
  return `<div class="pp-developer">
    <section class="pp-dev-guide">
      <div><p class="pp-kicker">DEV ROOMS</p><h2>A private sandbox for people making games.</h2><p>Open builder rooms, test playable prototypes, leave private notes, track versions, and decide what is ready to share. PhantomPlay is where the game gets sharper before it goes anywhere public.</p></div>
      <ul><li>Dev score is based on build quality signals</li><li>Profiles show reviewed playable prototypes</li><li>Support and collaboration intent stay local</li><li>No public payments or public profiles</li></ul>
    </section>
    <section class="pp-dev-directory">
      <div class="pp-section-head"><div><h2>Dev Rooms</h2><p>Ranked by build quality, playtest history, and lab-ready prototypes.</p></div><span>${developers.length} rooms</span></div>
      ${developers.length ? `<div class="pp-dev-list">${developers.map(developerCard).join("")}</div>` : empty("No dev rooms yet", "Reviewed builds will create dev rooms automatically.")}
    </section>
  </div>`;
}

function renderAdmin() {
  if (!ui.snapshot.access.canModerate) return empty("Moderation is protected", "Platform admin access is required.");
  return `<section class="pp-admin"><div class="pp-section-head"><div><h2>Sandbox safety review</h2><p>Approve only playable builds that pass the PhantomPlay security, content, and quality checklist.</p></div><span>${ui.snapshot.submissions.length} builds</span></div><div class="pp-submission-list">${ui.snapshot.submissions.length ? ui.snapshot.submissions.map((item) => submissionCard(item, true)).join("") : empty("Queue clear", "No developer builds are waiting.")}</div></section>`;
}

// Become a developer / submit a build. Deliberately its own tab, separate
// from Dev Rooms (renderDeveloper), which stays the read-only sandbox
// directory/profile flow — see scripts/test-phantomplay.mjs's guardrail
// forbidding the submission form from appearing inside Dev Rooms. Defined
// after renderAdmin (not between renderDeveloper and renderAdmin) so that
// guardrail's own source-slice between those two function names never picks
// up this form by accident. The binding for this exact form (form.onsubmit
// -> submitGame) and its edit/cancel buttons already existed in bind() before
// this form had anywhere to render; this just gives it a home.
function renderSubmit() {
  const editing = selectedSubmission();
  const mine = ui.snapshot.submissions;
  return `<div class="pp-developer">
    <section class="pp-dev-guide">
      <div><p class="pp-kicker">BECOME A DEVELOPER</p><h2>Submit a build for PhantomPlay review.</h2><p>Send a playable prototype through Safety Review. Approved builds appear in Shared prototypes and get their own Dev Room. Nothing here starts a payment or a public listing on its own.</p></div>
      <ul><li>Review checks safety, content rating, and playability</li><li>Save a draft any time and come back to it</li><li>Track status: draft, submitted, changes requested, approved</li><li>Every playable build stays private until it is reviewed</li></ul>
    </section>
    <form class="pp-submit-form" data-pp-submit-form>
      <header><h2>${editing ? "Edit your build" : "New submission"}</h2>${editing ? `<button type="button" class="pp-secondary" data-pp-cancel-edit>Cancel edit</button>` : ""}</header>
      <input type="hidden" name="submissionId" value="${esc(editing?.id || "")}"/>
      <label>Title<input type="text" name="title" maxlength="90" required value="${esc(editing?.title || "")}" placeholder="Your game's title"/></label>
      <label>One-line summary<input type="text" name="summary" maxlength="180" required value="${esc(editing?.summary || "")}" placeholder="A clear, honest one-line pitch"/></label>
      <label>Description<textarea name="description" maxlength="3000" rows="4" required placeholder="Describe the game, audience, and play loop.">${esc(editing?.description || "")}</textarea></label>
      <div class="pp-form-row">
        <label>Category<select name="category">${CATEGORIES.filter((category) => category !== "All").map((category) => `<option value="${esc(category)}" ${editing?.category === category ? "selected" : ""}>${esc(category)}</option>`).join("")}</select></label>
        <label>Content rating<select name="contentRating">${RATING_TIERS.map(([value, label]) => `<option value="${esc(value)}" ${(editing?.contentRating || "everyone") === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
        <label>Version<input type="text" name="version" maxlength="20" value="${esc(editing?.version || "1.0.0")}" placeholder="1.0.0"/></label>
      </div>
      <label>Launch URL<input type="url" name="launchUrl" required value="${esc(editing?.launchUrl || "")}" placeholder="https://..."/></label>
      <label>Screenshots (one URL per line)<textarea name="screenshots" rows="3" placeholder="https://.../screenshot-1.png">${esc((editing?.screenshots || []).join("\n"))}</textarea></label>
      <label>Tags (comma separated)<input type="text" name="tags" value="${esc((editing?.tags || []).join(", "))}" placeholder="arcade, puzzle, touch"/></label>
      <label>Controls<input type="text" name="controls" maxlength="240" required value="${esc(editing?.controls || "")}" placeholder="How does someone play this?"/></label>
      <label>Player data handling<textarea name="dataHandling" rows="2" required placeholder="What player data does this game read or store?">${esc(editing?.dataHandling || "")}</textarea></label>
      <p data-pp-form-message></p>
      <div class="pp-form-actions">
        <button type="submit" value="draft" class="pp-secondary">Save</button>
        <button type="submit" value="submit" class="pp-primary">Submit for review</button>
      </div>
    </form>
    <section class="pp-dev-directory">
      <div class="pp-section-head"><div><h2>Your submissions</h2><p>Status and history for every build you have sent through PhantomPlay review.</p></div><span>${mine.length} build${mine.length === 1 ? "" : "s"}</span></div>
      <div class="pp-submission-list">${mine.length ? mine.map((item) => submissionCard(item, false)).join("") : empty("No submissions yet", "Fill out the form above to send your first build for review.")}</div>
    </section>
  </div>`;
}

// Game Rating Exposure — per-tier toggles + presets, calling PATCH
// /api/phantomplay/profile ({preferences:{allowedRatings}}, guardianPin?)
// per server/src/phantom-ai/phantomplay.ts updatePhantomPlayProfile. A
// guardian PIN field appears whenever this profile has an enabled guardian
// lock and isn't an adult profile — the server enforces the PIN; the client
// only needs to collect and forward it.
function ratingExposureMarkup() {
  const snapshot = ui.snapshot;
  const allowed = new Set(Array.isArray(snapshot.preferences.allowedRatings) ? snapshot.preferences.allowedRatings : ALL_RATING_VALUES);
  const profileType = snapshot.profileType || "adult";
  const guardianEnabled = !!snapshot.guardianLock?.enabled;
  const needsPin = guardianEnabled && profileType !== "adult";
  return `<div class="pp-rating-exposure">
    <h3>Game Rating Exposure</h3>
    <p>Choose exactly which content tiers can appear in this profile's catalog.</p>
    ${needsPin ? `<label>Guardian PIN<input type="password" inputmode="numeric" maxlength="32" data-pp-exposure-pin placeholder="Required to change exposure"/></label>` : ""}
    <div class="pp-rating-toggles">${RATING_TIERS.map(([value, label]) => `<label class="pp-switch"><input type="checkbox" data-pp-rating-toggle="${value}" ${allowed.has(value) ? "checked" : ""} ${ui.ratingBusy ? "disabled" : ""}/><span></span>${esc(label)}</label>`).join("")}</div>
    <div class="pp-rating-presets">
      <button type="button" data-pp-rating-preset="my-age" ${ui.ratingBusy ? "disabled" : ""}>My age</button>
      <button type="button" data-pp-rating-preset="family" ${ui.ratingBusy ? "disabled" : ""}>Family Friendly Only</button>
      <button type="button" data-pp-rating-preset="all" ${ui.ratingBusy ? "disabled" : ""}>Show All Allowed Ratings</button>
    </div>
    <label>Profile type<select data-pp-profile-type><option value="adult" ${profileType === "adult" ? "selected" : ""}>Adult</option><option value="child" ${profileType === "child" ? "selected" : ""}>Child</option><option value="toddler" ${profileType === "toddler" ? "selected" : ""}>Toddler</option></select></label>
    <div class="pp-guardian-lock">
      <label class="pp-switch"><input type="checkbox" data-pp-guardian-enabled ${guardianEnabled ? "checked" : ""}/><span></span>Guardian PIN lock</label>
      <p>When on, a PIN is required to widen this profile's rating exposure or change its profile type.</p>
      <div class="pp-guardian-pin-row"><input type="password" inputmode="numeric" maxlength="32" data-pp-guardian-pin-input placeholder="${guardianEnabled ? "Current PIN, to change" : "Set a PIN (4+ digits)"}"/><button type="button" data-pp-guardian-save>Save</button></div>
    </div>
    ${ui.guardianMessage ? `<p class="pp-guardian-note">${esc(ui.guardianMessage)}</p>` : ""}
  </div>`;
}

function settingsMarkup() {
  const p = ui.snapshot.preferences;
  const colorMode = currentColorMode();
  return `<aside class="pp-settings ${ui.settingsOpen ? "is-open" : ""}" ${ui.settingsOpen ? "" : "hidden"}><header><div><p class="pp-kicker">PLAY SETTINGS</p><h2>Your break, your limits.</h2></div><button data-pp-settings-close aria-label="Close settings">×</button></header><label>Appearance<select data-pp-theme><option value="dark" ${colorMode === "dark" ? "selected" : ""}>Dark</option><option value="light" ${colorMode === "light" ? "selected" : ""}>Light</option></select></label><label>Content allowed<select data-pp-pref="contentRating"><option value="everyone" ${p.contentRating === "everyone" ? "selected" : ""}>Everyone</option><option value="teen" ${p.contentRating === "teen" ? "selected" : ""}>Teen</option><option value="mature" ${p.contentRating === "mature" ? "selected" : ""}>Mature</option></select></label><label class="pp-switch"><input type="checkbox" data-pp-pref="sound" ${p.sound ? "checked" : ""}/><span></span>Sound</label><label class="pp-switch"><input type="checkbox" data-pp-pref="reducedMotion" ${p.reducedMotion ? "checked" : ""}/><span></span>Reduce motion</label><label class="pp-switch"><input type="checkbox" data-pp-pref="allowCommunityGames" ${p.allowCommunityGames ? "checked" : ""}/><span></span>Show reviewed prototypes</label>${ratingExposureMarkup()}<p>PhantomPlay never changes your work, agents, files, or business data while you play.</p></aside>`;
}

function engineFor(game) {
  return { ...PHANTOMPLAY_ENGINE, ...(ui.snapshot?.engine || {}), game: game?.engine || { tier: "standard", minVersion: PHANTOMPLAY_ENGINE.version } };
}

// Admin-only per-game Dev Mode / Dev Sandbox switch — "choose dev mode on a
// certain game" rather than it being on for every built-in by default. Calls
// the same admin rating-override route the content-rating overrides already
// use (server/src/phantom-ai/phantomplay.ts applyPhantomPlayRatingOverride),
// just with a devModeEnabled field instead of contentRating/contentDescriptors.
async function toggleGameDevMode(gameId, nextEnabled) {
  try {
    await api("/api/phantomplay/admin/rating-override", {
      method: "POST",
      body: JSON.stringify({ target: "game", gameId, devModeEnabled: nextEnabled, reason: "admin_devmode_toggle" }),
    });
    await hydrate();
  } catch (error) {
    ui.error = error instanceof Error ? error.message : "Dev Mode could not be updated for this game.";
    render();
  }
}

// Dev Sandbox — the in-player, live-editing "overpowered" mode. This panel
// docks beside the actual running game and hot-reloads that same iframe via
// a blob: URL as the admin types or toggles a mod. The host page itself
// never runs the edited text at all — it only ever builds a Blob and
// reassigns an already-sandboxed iframe's src; execution happens solely
// inside that opaque-origin, script-only sandboxed frame. Mods work the same
// way: they are text patches applied to the source before it becomes a Blob,
// never eval'd or executed by the host.

// Universal — works on ANY game without knowing its internals. Prepended to
// every Dev Sandbox blob. Provides window.__ppMods (live per-mod flags set
// by postMessage, read by the per-game patches below) and a genuine game-
// speed control: it rewrites the timestamp every requestAnimationFrame
// callback receives, so any game's own internal dt = t - lastT math slows
// down or speeds up automatically — no per-game code required.
function modBootstrapScript() {
  return `<script>(function(){
window.__ppMods = window.__ppMods || {};
window.__ppSpeed = 1;
function applyPPUniversalMods(){
  var mods = window.__ppMods || {};
  document.documentElement.style.filter = mods.highContrast ? 'contrast(1.18) saturate(1.25)' : '';
  document.body.style.boxShadow = mods.cinematicGlow ? 'inset 0 0 90px rgba(65,255,161,.28)' : '';
  document.body.style.outline = mods.focusOverlay ? '4px solid rgba(65,255,161,.55)' : '';
  document.body.style.outlineOffset = mods.focusOverlay ? '-4px' : '';
}
var _raf = window.requestAnimationFrame.bind(window);
var _virtualT = null, _lastReal = null;
window.requestAnimationFrame = function(cb){
  return _raf(function(real){
    if (_lastReal === null) { _lastReal = real; _virtualT = real; }
    var delta = real - _lastReal;
    _lastReal = real;
    _virtualT += delta * (window.__ppSpeed || 1);
    cb(_virtualT);
  });
};
window.addEventListener('message', function(e){
  if (!e.data || e.data.source !== 'phantomplay-host') return;
  if (e.data.type === 'mod') { window.__ppMods[e.data.key] = e.data.value; applyPPUniversalMods(); }
  if (e.data.type === 'modspeed') window.__ppSpeed = Number(e.data.value) || 1;
});
// A game whose script throws (missing element, bad selector, syntax slip)
// used to fail completely silently: no ready message, no error, just a
// player that never responds. Surface it instead of leaving the owner to
// guess why a game "does nothing".
function reportPPError(message){
  try { parent.postMessage({ source: 'phantomplay-game', type: 'runtime-error', message: String(message || 'Unknown script error') }, '*'); } catch (err) {}
}
window.addEventListener('error', function(e){ reportPPError(e.message + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '')); });
window.addEventListener('unhandledrejection', function(e){ reportPPError('Unhandled promise rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)); });
})();<\/script>`;
}

// Per-game mods — each patch is a plain text substitution verified against
// that exact game's real source (see the anchor comments below). A patch
// that no longer finds its anchor (e.g. after a manual code edit removed it)
// silently no-ops rather than breaking anything, since .replace() on a
// non-matching string just returns the string unchanged.
const MOD_PRESETS = {
  "neon-drift": [
    { id: "god", label: "God Mode", description: "Hits never register — the ship cannot take damage." },
    { id: "maxPower", label: "Max Power", description: "Rapid fire, spread shot, shield, and magnet are always active." },
  ],
  "rift-frenzy": [
    { id: "god", label: "God Mode", description: "Full HP and permanent invulnerability." },
    { id: "noCooldown", label: "No Cooldowns", description: "Absorb and dash are always ready." },
    { id: "maxGrow", label: "Max Size", description: "Instantly grow to a huge size." },
  ],
  "phantom-rumble": [
    { id: "god", label: "God Mode", description: "Permanent invulnerability to every hit." },
    { id: "noCooldown", label: "No Cooldowns", description: "Attack, dodge, and parry are always ready." },
    { id: "infiniteStocks", label: "Infinite Stocks", description: "Stocks never run out." },
  ],
};
const UNIVERSAL_MOD_PRESETS = [
  { id: "cinematicGlow", label: "Cinematic Glow", description: "Adds an in-game neon glow layer without touching source code.", universal: true },
  { id: "highContrast", label: "High Contrast", description: "Boosts visibility while testing tiny sprites, balls, and hazards.", universal: true },
  { id: "focusOverlay", label: "Focus Frame", description: "Adds a bright playfield border so the active sandbox is obvious.", universal: true },
];
const MOD_PATCHES = {
  "neon-drift": (source) => source
    .replace("function damage(){if(player.invuln>0)return;", "function damage(){if(window.__ppMods&&window.__ppMods.god)return;if(player.invuln>0)return;")
    .replace("function update(dt){const accel=", "function update(dt){if(window.__ppMods&&window.__ppMods.maxPower){player.rapid=6500;player.spread=6500;player.shield=1;player.magnet=6500}const accel="),
  "rift-frenzy": (source) => source
    .replace("function moveTeam(team,dt){if(!team.alive)return;", "function moveTeam(team,dt){if(!team.alive)return;if(window.__ppMods&&team.human){if(window.__ppMods.god){team.hp=team.maxHp;team.invuln=1e9}if(window.__ppMods.noCooldown){team.absorbCd=0;team.dashCd=0}if(window.__ppMods.maxGrow)team.mass=Math.max(team.mass,400)}"),
  "phantom-rumble": (source) => source
    .replace("function step(f,dt){if(f.dead)return;", "function step(f,dt){if(f.dead)return;if(window.__ppMods&&f.human){if(window.__ppMods.god)f.invuln=1e9;if(window.__ppMods.noCooldown){f.attackCd=0;f.dodgeCd=0;f.parry=0}if(window.__ppMods.infiniteStocks)f.stocks=Math.max(f.stocks,99)}"),
};

function modsForGame(game) {
  return [...UNIVERSAL_MOD_PRESETS, ...(MOD_PRESETS[game.id] || [])];
}

function speedLabel(speed = 1) {
  return speed === 0.25 ? "¼x" : speed === 0.5 ? "½x" : speed === 2 ? "2x" : speed === 4 ? "4x" : "1x";
}

// Applied every time a Dev Sandbox blob is (re)built — never applied to what
// gets persisted via Save/Publish, which always read the plain textarea text.
function injectModSupport(source, gameId) {
  const patched = MOD_PATCHES[gameId] ? MOD_PATCHES[gameId](source) : source;
  return patched.replace(/<head>/i, `<head>${modBootstrapScript()}`);
}

function modSectionMarkup(game) {
  const d = ui.devSandbox;
  const presets = modsForGame(game);
  const modState = d.modState || {};
  const speed = d.speed || 1;
  return `<div class="pp-devsandbox-mods">
    <div class="pp-devmod-ai">
      <b>Phantom mod prompt</b>
      <p>Describe the test mod you want. This creates a local starter kit first; code/save/publish stays under your control.</p>
      <div><input data-pp-devsandbox-modprompt value="${esc(d.aiModPrompt || "")}" placeholder="ex: make this easier, brighter, faster, no cooldowns..."/><button type="button" data-pp-devsandbox-modprompt-generate>Build kit</button></div>
      ${d.aiModNote ? `<small>${esc(d.aiModNote)}</small>` : ""}
    </div>
    <div class="pp-devsandbox-mod-row pp-devsandbox-speed-row">
      <label>Game speed<select data-pp-devsandbox-speed>
        <option value="0.25" ${speed === 0.25 ? "selected" : ""}>0.25x — slow-mo</option>
        <option value="0.5" ${speed === 0.5 ? "selected" : ""}>0.5x</option>
        <option value="1" ${speed === 1 ? "selected" : ""}>1x — normal</option>
        <option value="2" ${speed === 2 ? "selected" : ""}>2x</option>
        <option value="4" ${speed === 4 ? "selected" : ""}>4x — fast-forward</option>
      </select></label>
      <i>Live now. No save is needed for temporary speed/testing mods.</i>
    </div>
    ${presets.map((mod) => `
    <label class="pp-switch pp-devsandbox-mod">
      <input type="checkbox" data-pp-devsandbox-mod="${esc(mod.id)}" ${modState[mod.id] ? "checked" : ""}/><span></span>
      <b>${esc(mod.label)}${mod.universal ? " · universal" : ""}</b><i>${esc(mod.description)}</i>
    </label>`).join("")}
  </div>`;
}

function safeDevProjectFileName(value, fallback = "file.txt") {
  const clean = String(value || "").replaceAll("\\", "/").split("/").pop()?.trim() || fallback;
  return /^[a-z0-9][a-z0-9._-]*\.(?:html?|css|m?js)$/iu.test(clean) ? clean : fallback;
}

function cleanEditableGameSource(value) {
  const source = String(value || "");
  const htmlStart = source.search(/<!doctype\s+html|<html\b/iu);
  if (htmlStart <= 0) return source;
  const prefix = source.slice(0, htmlStart).trim();
  return /^(?:internal server error|bad gateway|service unavailable|gateway timeout|phantomplay request failed(?:\s*\(\d+\))?\.?|\{\s*"?(?:error|message)"?\s*:)/iu.test(prefix)
    ? source.slice(htmlStart)
    : source;
}

function devProjectFromSource(source) {
  const files = {};
  let html = cleanEditableGameSource(source);
  html = html.replace(/<style\b[^>]*data-phantomplay-dev-bundled=["']([^"']+)["'][^>]*>([\s\S]*?)<\/style>/giu, (_tag, name, css) => {
    const fileName = safeDevProjectFileName(name, "style.css");
    files[fileName] = css.replace(/^\s*\n/u, "").replace(/\n\s*$/u, "");
    return `<link rel="stylesheet" href="${fileName}">`;
  });
  html = html.replace(/<script\b[^>]*data-phantomplay-dev-bundled=["']([^"']+)["'][^>]*>([\s\S]*?)<\/script>/giu, (_tag, name, js) => {
    const fileName = safeDevProjectFileName(name, "game.js");
    files[fileName] = js.replace(/^\s*\n/u, "").replace(/\n\s*$/u, "");
    return `<script src="${fileName}"></script>`;
  });
  files["index.html"] = html;
  return files;
}

function devProjectSource(files = {}) {
  let html = String(files["index.html"] || "");
  const entries = Object.entries(files).filter(([name]) => name !== "index.html");
  for (const [name, content] of entries) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (/\.css$/iu.test(name)) {
      const tag = `<style data-phantomplay-dev-bundled="${name}">\n${content}\n</style>`;
      const link = new RegExp(`<link\\b[^>]*\\bhref=["'](?:\\.?\\/)?${escaped}(?:[?#][^"']*)?["'][^>]*>`, "iu");
      html = link.test(html) ? html.replace(link, tag) : html.replace(/<\/head>/iu, `${tag}\n</head>`);
    } else if (/\.m?js$/iu.test(name)) {
      const tag = `<script data-phantomplay-dev-bundled="${name}">\n${content}\n<\/script>`;
      const script = new RegExp(`<script\\b[^>]*\\bsrc=["'](?:\\.?\\/)?${escaped}(?:[?#][^"']*)?["'][^>]*>\\s*<\\/script>`, "iu");
      html = script.test(html) ? html.replace(script, tag) : html.replace(/<\/body>/iu, `${tag}\n</body>`);
    }
  }
  return html;
}

function missingDevProjectFiles(files = {}) {
  const html = String(files["index.html"] || "");
  const referenced = [
    ...[...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css(?:[?#][^"']*)?)["'][^>]*>/giu)].map((match) => match[1]),
    ...[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.m?js(?:[?#][^"']*)?)["'][^>]*>/giu)].map((match) => match[1]),
  ];
  return [...new Set(referenced
    .filter((name) => !/^(?:[a-z]+:)?\/\//iu.test(name) && !name.startsWith("/") && !name.startsWith("data:"))
    .map((name) => safeDevProjectFileName(name.split(/[?#]/u)[0], ""))
    .filter((name) => name && files[name] === undefined))];
}

function devProjectProblem(files = {}) {
  const html = String(files["index.html"] || "");
  if (!/<html\b|<!doctype\s+html/iu.test(html)) return "index.html must contain a complete HTML document.";
  const missing = missingDevProjectFiles(files);
  if (missing.length) return `Add the referenced file${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`;
  const bytes = new TextEncoder().encode(devProjectSource(files)).byteLength;
  if (bytes > 2_000_000) return "This project is over the 2 MB safe-save limit.";
  return "";
}

function devWorkbenchFileSource(editor = ui.devWorkbench) {
  const active = editor?.activeFile || "index.html";
  return editor?.files?.[active] ?? "";
}

function devWorkbenchDomSource() {
  const editor = ui.devWorkbench;
  if (!editor) return "";
  const textarea = mountedRoot?.querySelector("[data-pp-devworkbench-source]");
  const files = { ...(editor.files || devProjectFromSource(editor.editedSource || "")) };
  const active = editor.activeFile || "index.html";
  if (typeof textarea?.value === "string") files[active] = textarea.value;
  return devProjectSource(files);
}

function devWorkbenchWithSource(editor, source, activeFile = editor?.activeFile || "index.html") {
  const files = devProjectFromSource(source);
  return { ...editor, editedSource: source, files, activeFile: files[activeFile] !== undefined ? activeFile : "index.html" };
}

async function importDevWorkbenchFiles(fileList, forcedName = "") {
  if (!ui.devWorkbench || ui.devWorkbench.loading) return;
  const gameId = ui.devWorkbench.gameId;
  const selected = [...(fileList || [])];
  const incoming = forcedName ? selected.slice(0, 1) : selected.filter((file) => /\.(?:html?|css|m?js)$/iu.test(file?.name || ""));
  if (!incoming.length) {
    ui.devWorkbench = { ...ui.devWorkbench, error: "Drop HTML, CSS, or JavaScript files only.", status: "No project files were changed." };
    render();
    return;
  }
  const currentSource = devWorkbenchDomSource();
  const current = devProjectFromSource(currentSource);
  const imported = [];
  for (const [index, file] of incoming.entries()) {
    const content = await file.text();
    const name = index === 0 && forcedName
      ? safeDevProjectFileName(forcedName)
      : /\.html?$/iu.test(file.name) ? "index.html" : safeDevProjectFileName(file.name);
    current[name] = content;
    imported.push(name);
  }
  if (ui.devWorkbench?.gameId !== gameId) return;
  const source = devProjectSource(current);
  const next = recordEditorChange(ui.devWorkbench, source);
  const problem = devProjectProblem(current);
  ui.devWorkbench = {
    ...next,
    editedSource: source,
    files: current,
    activeFile: imported[0] || "index.html",
    error: problem,
    status: problem ? `${imported.join(", ")} imported. Complete the project before saving.` : `${imported.join(", ")} replaced. Save when the project is ready.`,
  };
  render();
}

function selectDevWorkbenchFile(fileName) {
  if (!ui.devWorkbench) return;
  const source = devWorkbenchDomSource();
  const files = devProjectFromSource(source);
  if (files[fileName] === undefined) return;
  ui.devWorkbench = { ...ui.devWorkbench, editedSource: source, files, activeFile: fileName, error: "" };
  render();
}

function devWorkbenchModsMarkup(game) {
  const d = ui.devWorkbench;
  const presets = modsForGame(game);
  const modState = d?.modState || {};
  const speed = d?.speed || 1;
  return `<div class="pp-devsandbox-mods">
    <div class="pp-devmod-ai">
      <b>Phantom mod prompt</b>
      <p>Build a starter mod kit before launch. These activate the second you enter Dev Mode.</p>
      <div><input data-pp-devworkbench-modprompt value="${esc(d?.aiModPrompt || "")}" placeholder="ex: make this harder, add glow, slow motion..."/><button type="button" data-pp-devworkbench-modprompt-generate>Build kit</button></div>
      ${d?.aiModNote ? `<small>${esc(d.aiModNote)}</small>` : ""}
    </div>
    <div class="pp-devsandbox-mod-row pp-devsandbox-speed-row">
      <label>Game speed<select data-pp-devworkbench-speed>
        <option value="0.25" ${speed === 0.25 ? "selected" : ""}>0.25x — slow-mo</option>
        <option value="0.5" ${speed === 0.5 ? "selected" : ""}>0.5x</option>
        <option value="1" ${speed === 1 ? "selected" : ""}>1x — normal</option>
        <option value="2" ${speed === 2 ? "selected" : ""}>2x</option>
        <option value="4" ${speed === 4 ? "selected" : ""}>4x — fast-forward</option>
      </select></label>
      <i>Saved in this workbench. Launch Dev Mode to use it in-game.</i>
    </div>
    ${presets.map((mod) => `
    <label class="pp-switch pp-devsandbox-mod">
      <input type="checkbox" data-pp-devworkbench-mod="${esc(mod.id)}" ${modState[mod.id] ? "checked" : ""}/><span></span>
      <b>${esc(mod.label)}${mod.universal ? " · universal" : ""}</b><i>${esc(mod.description)}</i>
    </label>`).join("")}
  </div>`;
}

function devWorkbenchMarkup() {
  const d = ui.devWorkbench;
  if (!d) return "";
  const game = ui.snapshot?.catalog?.find((item) => item.id === d.gameId);
  if (!game) return "";
  const section = d.section || "code";
  const projectFiles = Object.keys(d.files || {}).sort((a, b) => a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b));
  return `<div class="pp-devworkbench" role="dialog" aria-modal="true" aria-label="Configure Dev Mode for ${esc(game.title)}">
    <header>
      <div><b>Code workbench</b><span>${esc(game.title)} · configure before launch</span></div>
      <button type="button" data-pp-devworkbench-close aria-label="Close code workbench">×</button>
    </header>
    <div class="pp-devworkbench-toolbar">
      <label>Section<select data-pp-devworkbench-section><option value="code" ${section === "code" ? "selected" : ""}>Project files</option><option value="mods" ${section === "mods" ? "selected" : ""}>Mod Menu</option></select></label>
      <button type="button" class="pp-secondary" data-pp-devworkbench-undo title="Undo (Ctrl+Z)" ${d.history?.undo?.length ? "" : "disabled"}>Undo</button>
      <button type="button" class="pp-secondary" data-pp-devworkbench-redo title="Redo (Ctrl+Shift+Z)" ${d.history?.redo?.length ? "" : "disabled"}>Redo</button>
      <button type="button" class="pp-secondary" data-pp-devworkbench-revert>Revert to last working</button>
      <button type="button" class="pp-secondary" data-pp-devworkbench-save ${d.saving ? "disabled" : ""}>${d.saving ? "Saving…" : "Save"}</button>
      <button type="button" class="pp-devworkbench-launch" data-pp-devworkbench-launch>${icon("dev")} Save &amp; Launch Dev Mode</button>
      <button type="button" class="pp-secondary" data-pp-devworkbench-start>${icon("play")} Start normal</button>
      <button type="button" class="pp-devworkbench-close-inline" data-pp-devworkbench-close>Close</button>
    </div>
    <p class="pp-devsandbox-note">${section === "mods" ? "Pick the mod menu you want available when the sandbox starts." : "Drop HTML, CSS, and JavaScript together or replace one file at a time. Manual edits, Ctrl+Z, and Ctrl+Shift+Z work in every file."}${d.hasOverride ? " Saved workspace override found." : ""}</p>
    ${d.error ? `<div class="pp-devsandbox-error">${esc(d.error)}</div>` : ""}
    ${d.loading
      ? `<div class="pp-devmode-loading"><i></i><b>Loading source…</b></div>`
      : section === "mods"
        ? devWorkbenchModsMarkup(game)
        : `<div class="pp-devproject">
            <div class="pp-devproject-slots" aria-label="Replace individual game files">
              <label class="pp-devfile-slot is-html"><input type="file" data-pp-devworkbench-file-upload="index.html" accept=".html,.htm"/><span><b>HTML</b><i>index.html</i></span><strong>Choose or replace</strong></label>
              <label class="pp-devfile-slot is-css"><input type="file" data-pp-devworkbench-file-upload="style.css" accept=".css"/><span><b>STYLE</b><i>style.css</i></span><strong>Choose or replace</strong></label>
              <label class="pp-devfile-slot is-js"><input type="file" data-pp-devworkbench-file-upload="game.js" accept=".js,.mjs"/><span><b>GAME</b><i>game.js</i></span><strong>Choose or replace</strong></label>
            </div>
            <label class="pp-devproject-drop" data-pp-devworkbench-drop>
              <input type="file" data-pp-devworkbench-files accept=".html,.htm,.css,.js,.mjs" multiple/>
              <b>Drop the whole game here</b><span>or choose all files at once · HTML, CSS, JavaScript</span>
            </label>
            <nav class="pp-devproject-tabs" aria-label="Game project files">${projectFiles.map((name) => `<button type="button" data-pp-devworkbench-file="${esc(name)}" class="${name === (d.activeFile || "index.html") ? "is-active" : ""}">${esc(name)}</button>`).join("")}</nav>
            <textarea class="pp-devsandbox-source" data-pp-devworkbench-source spellcheck="false" aria-label="Edit ${esc(d.activeFile || "index.html")}">${esc(devWorkbenchFileSource(d))}</textarea>
          </div>`}
    <p class="pp-devsandbox-status">${esc(d.status || "")}</p>
  </div>`;
}

async function openDevWorkbench(gameId, section = "code") {
  const game = ui.snapshot?.catalog?.find((item) => item.id === gameId);
  if (!game?.devModeAvailable) return;
  ui.devWorkbench = { gameId: game.id, source: "", editedSource: "", files: {}, activeFile: "index.html", history: createEditorHistory(), hasOverride: false, overrideUpdatedAt: null, localUpdatedAt: null, loading: true, saving: false, error: "", status: "", section, modState: {}, speed: 1 };
  render();
  try {
    const tenantQuery = `tenant_id=${encodeURIComponent(currentTenantId())}`;
    const [sourceResult, overrideResult] = await Promise.all([
      api(`/api/phantomplay/dev-mode/${encodeURIComponent(game.id)}/source?${tenantQuery}`),
      api(`/api/phantomplay/dev-mode/${encodeURIComponent(game.id)}/override?${tenantQuery}`).catch(() => ({ source: null, updatedAt: null })),
    ]);
    const localDraft = localDevSandboxAutosave(game.id);
    const newestDraft = newestDevSandboxSource(localDraft, overrideResult.source ? { source: overrideResult.source, updatedAt: overrideResult.updatedAt } : null);
    const startingSource = cleanEditableGameSource(newestDraft?.source ?? sourceResult.source);
    ui.devWorkbench = devWorkbenchWithSource({
      gameId: game.id, source: sourceResult.source, editedSource: startingSource,
      hasOverride: !!overrideResult.source, overrideUpdatedAt: overrideResult.updatedAt,
      localUpdatedAt: localDraft?.updatedAt || null,
      loading: false, saving: false, error: "",
      status: newestDraft ? (newestDraft === localDraft ? "Resumed your local autosave." : "Loaded your workspace override.") : "Loaded shipped source.",
      section, modState: {}, speed: 1, history: createEditorHistory(),
    }, startingSource);
  } catch (error) {
    try {
      const localDraft = localDevSandboxAutosave(game.id);
      const source = await fetchEditableGameSource(game).catch((sourceError) => {
        if (localDraft?.source && /<html\b|<!doctype\s+html/iu.test(localDraft.source)) return localDraft.source;
        throw sourceError;
      });
      ui.devWorkbench = devWorkbenchWithSource({
        gameId: game.id, source, editedSource: localDraft?.source || source,
        hasOverride: false, overrideUpdatedAt: null, localUpdatedAt: localDraft?.updatedAt || null,
        loading: false, saving: false, error: "", status: localDraft ? "Resumed your local autosave. Backend sync is waiting." : "Loaded source locally. Dev Mode can still launch from here.",
        section, modState: {}, speed: 1, history: createEditorHistory(),
      }, cleanEditableGameSource(localDraft?.source || source));
    } catch {
      ui.devWorkbench = { ...ui.devWorkbench, loading: false, error: error instanceof Error ? error.message : "Code workbench source could not be loaded." };
    }
  }
  render();
}

function devSandboxMarkup(game) {
  const d = ui.devSandbox;
  if (!d || d.gameId !== game.id) return "";
  if (d.minimized) return `<button type="button" class="pp-devsandbox-minimized" data-pp-devsandbox-restore>${icon("dev")} Dev Code</button>`;
  const section = d.section || "code";
  return `<div class="pp-devsandbox" role="complementary" aria-label="Dev Mode: live editor for ${esc(game.title)}">
    <header>
      <div><b>DEV MODE</b><span>${esc(game.title)}</span></div>
      <div class="pp-devsandbox-window-actions">
        <button type="button" data-pp-devsandbox-minimize aria-label="Minimize Dev Mode code">–</button>
        <button type="button" data-pp-devsandbox-close aria-label="Close Dev Mode code">×</button>
      </div>
    </header>
    <label class="pp-devsandbox-section-picker">Section<select data-pp-devsandbox-section><option value="code" ${section === "code" ? "selected" : ""}>Full Source Code</option><option value="mods" ${section === "mods" ? "selected" : ""}>Mod Menu</option></select></label>
    <p class="pp-devsandbox-note">${section === "mods" ? "These are live testing mods. Use the in-game Mods dock for fast toggles; Save applies to source code." : "Ctrl+Z / Ctrl+Shift+Z work while you type. Preview changes stay private until you publish."} Only visible to you.${d.hasOverride ? " A saved workspace override is currently active for this game." : ""}</p>
    ${d.error ? `<div class="pp-devsandbox-error">${esc(d.error)}</div>` : ""}
    ${d.loading
      ? `<div class="pp-devmode-loading"><i></i><b>Loading source…</b></div>`
      : section === "mods"
        ? modSectionMarkup(game)
        : `<textarea class="pp-devsandbox-source" data-pp-devsandbox-source spellcheck="false">${esc(d.editedSource)}</textarea>`}
    <p class="pp-devsandbox-status" data-pp-devsandbox-status>${esc(d.status || "")}</p>
    <footer>
      <button type="button" data-pp-devsandbox-undo title="Undo (Ctrl+Z)" ${d.history?.undo?.length ? "" : "disabled"}>Undo</button>
      <button type="button" data-pp-devsandbox-redo title="Redo (Ctrl+Shift+Z)" ${d.history?.redo?.length ? "" : "disabled"}>Redo</button>
      <button type="button" class="pp-devsandbox-save" data-pp-devsandbox-save ${d.saving ? "disabled" : ""}>${d.saving ? "Saving…" : "Save"}</button>
      <button type="button" data-pp-devsandbox-revert>Revert to last working</button>
      ${ui.snapshot.access.isOwner ? `<button type="button" class="pp-devsandbox-publish" data-pp-devsandbox-publish ${d.publishing ? "disabled" : ""}>${d.publishing ? "Publishing…" : "Publish to live"}</button>` : ""}
    </footer>
  </div>`;
}

function devModDockMarkup(game) {
  const d = ui.devSandbox;
  if (!d || d.gameId !== game.id) return "";
  const presets = modsForGame(game);
  const modState = d.modState || {};
  const open = !!ui.devModDockOpen;
  const activeCount = Object.values(modState).filter(Boolean).length + ((d.speed || 1) === 1 ? 0 : 1);
  return `<div class="pp-devmod-dock ${open ? "is-open" : ""}">
    <button type="button" class="pp-devmod-toggle" data-pp-devmod-dock-toggle>${icon("dev")} Mods <b>${activeCount || "live"}</b></button>
    <div class="pp-devmod-panel" role="complementary" aria-label="Live game mods">
      <div class="pp-devmod-head"><b>Live mod controls</b><button type="button" data-pp-devmod-dock-toggle aria-label="Close mod controls">×</button></div>
      <label>Speed<select data-pp-devdock-speed>
        <option value="0.25" ${(d.speed || 1) === 0.25 ? "selected" : ""}>0.25x slow</option>
        <option value="0.5" ${(d.speed || 1) === 0.5 ? "selected" : ""}>0.5x</option>
        <option value="1" ${(d.speed || 1) === 1 ? "selected" : ""}>1x normal</option>
        <option value="2" ${(d.speed || 1) === 2 ? "selected" : ""}>2x fast</option>
        <option value="4" ${(d.speed || 1) === 4 ? "selected" : ""}>4x turbo</option>
      </select></label>
      <div class="pp-devmod-pills">${presets.map((mod) => `<button type="button" class="${modState[mod.id] ? "is-on" : ""}" data-pp-devdock-mod="${esc(mod.id)}">${esc(mod.label)}</button>`).join("")}</div>
      <div class="pp-devmod-prompt"><input data-pp-devdock-modprompt value="${esc(d.aiModPrompt || "")}" placeholder="Ask for a quick mod idea..."/><button type="button" data-pp-devdock-modprompt-generate>Build</button></div>
      ${d.aiModNote ? `<small>${esc(d.aiModNote)}</small>` : `<small>Live mods never publish until you edit code and explicitly save.</small>`}
      <div class="pp-devmod-links"><button type="button" data-pp-devsandbox-open-code>Open code</button><button type="button" data-pp-devsandbox-open-mods>Full mod menu</button></div>
    </div>
  </div>`;
}

function playerMarkup() {
  if (!ui.player) return "";
  const { game, play } = ui.player;
  const engine = engineFor(game);
  const controls = controlsCopy(game);
  const sandboxActive = ui.devSandbox?.gameId === game.id;
  const drawerExpanded = sandboxActive && !ui.devSandbox?.minimized;
  // Priority: live Dev Mode blob > this workspace's saved override > shipped file.
  const frameSrc = sandboxActive && ui.devSandbox?.blobUrl ? ui.devSandbox.blobUrl : (ui.player.overrideBlobUrl || game.launchUrl);
  return `<div class="pp-player ${sandboxActive ? "is-devsandbox" : ""} ${drawerExpanded ? "is-split" : ""}" role="dialog" aria-modal="true" aria-label="Playing ${esc(game.title)}"><header><div><img src="${esc(thumbnailFor(game))}" alt=""/><span><b>${esc(game.title)}</b>${controls ? `<i>${esc(controls)}</i>` : ""}</span>${sandboxActive ? `<em class="pp-devsandbox-badge">Dev Mode</em>` : ""}</div><div class="pp-player-actions">${game.devModeAvailable ? `<button class="pp-devsandbox-open" type="button" data-pp-devsandbox-open title="Open the full bundled source. Edits preview live; press Save when done.">Code drawer</button>` : ""}<button data-pp-player-restart title="Restart game">Restart</button><button data-pp-player-pause title="Pause game">${ui.playerPaused ? "Resume" : "Pause"}</button><button data-pp-player-fullscreen title="Full screen">Full screen</button><button class="pp-player-close-game" data-pp-player-close title="Exit the game">Exit game</button></div></header><div class="pp-player-stage"><button class="pp-player-exit" data-pp-player-close type="button" aria-label="Exit game">Exit</button><div class="pp-player-loading" ${ui.playerReady ? "hidden" : ""}><i></i><b>Loading ${esc(game.title)}…</b><span>${sandboxActive ? "Dev Mode is opening your saved project in a private sandbox." : "The game is opening in a private sandbox."}</span></div>${ui.playerError ? `<div class="pp-player-error" data-pp-player-error><b>This game hit a script error and stopped.</b><code>${esc(ui.playerError)}</code><span>${sandboxActive ? "Fix the code in the drawer below, then Save to try again." : "Restart won't fix a script error; this needs a code fix."}</span></div>` : ""}<iframe src="${esc(frameSrc)}" title="${esc(game.title)}" sandbox="allow-scripts allow-pointer-lock" referrerpolicy="no-referrer" allow="fullscreen; gamepad" tabindex="0" data-pp-frame></iframe></div>${sandboxActive ? devModDockMarkup(game) : ""}${devSandboxMarkup(game)}<footer><span>Session <b>${esc(play.id.slice(-8))}</b></span><span data-pp-live-score>Score —</span><span data-pp-live-state>${ui.playerPaused ? "Paused" : "Playing"}</span><span>Engine ${esc(engine.version)}</span><span>Progress saves automatically</span></footer></div>`;
}

function render() {
  if (!mountedRoot) return;
  document.body.classList.toggle("phantomplay-playing", !!ui.player);
  if (ui.loading && !ui.snapshot) {
    mountedRoot.innerHTML = `<div class="pp-loading"><i></i><b>Opening PhantomPlay</b><span>Loading your library and saved progress…</span></div>`;
    return;
  }
  const snapshot = ui.snapshot || offlineState();
  const tabs = [["library", "Games"], ["together", "Multiplayer"], ["favorites", "Saved"], ["developer", "Developers"], ["submit", "Submit your game"], ...(snapshot.access.canModerate ? [["admin", "Safety Review"]] : [])];
  const content = ui.tab === "together" ? renderTogether() : ui.tab === "favorites" ? renderFavorites() : ui.tab === "developer" ? renderDeveloper() : ui.tab === "submit" ? renderSubmit() : ui.tab === "admin" ? renderAdmin() : renderLibrary();
  mountedRoot.innerHTML = `<div class="pp-shell">
    <header class="pp-top"><div class="pp-title"><p class="pp-kicker">PHANTOMFORCE GAME SANDBOX</p><h1>PhantomPlay</h1></div><nav class="pp-tabs" aria-label="PhantomPlay sections">${tabs.map(([id, label]) => `<button type="button" class="${ui.tab === id ? "is-active" : ""}" data-pp-tab="${id}">${esc(label)}</button>`).join("")}</nav><div class="pp-tools"><span class="pp-access ${snapshot.access.enabled ? "is-ready" : "is-blocked"}">${snapshot.access.enabled ? esc(playTimeLabel(snapshot.access.remainingMinutesToday)) : "Plan restricted"}</span><button class="pp-settings-button" data-pp-settings aria-label="Play settings">${icon("settings")}</button></div></header>
      ${ui.offline ? `<div class="pp-banner"><b>Local Play mode</b><span>Games are available locally right now. Cloud saves, rooms, submissions, and analytics will reconnect when the PhantomPlay sync lane answers.</span><button data-pp-retry>Re-check sync</button></div>` : ""}
    ${!ui.offline && ui.error ? `<div class="pp-banner is-error"><b>PhantomPlay needs attention</b><span>${esc(ui.error)}</span><button data-pp-retry>Retry</button></div>` : ""}
    ${ui.notice ? `<div class="pp-banner is-notice"><b>Creator support</b><span>${esc(ui.notice)}</span><button data-pp-clear-notice>OK</button></div>` : ""}
    <main class="pp-content">${content}</main>
    ${settingsMarkup()}${playerMarkup()}${devWorkbenchMarkup()}
  </div>`;
  bind();
  syncRoomPolling();
}

async function updateFavorite(gameId) {
  const favorite = !ui.snapshot.favorites.includes(gameId);
  ui.snapshot.favorites = favorite ? [gameId, ...ui.snapshot.favorites] : ui.snapshot.favorites.filter((id) => id !== gameId);
  render();
  if (ui.offline) { saveOffline(); return; }
  try { await api("/api/phantomplay/profile", { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), gameId, favorite }) }); } catch (error) { ui.error = error.message; }
}

async function updatePreferences() {
  const preferences = ui.snapshot.preferences;
  if (ui.offline) { saveOffline(); render(); return; }
  try {
    const payload = await api("/api/phantomplay/profile", { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), preferences }) });
    ui.snapshot.preferences = payload.preferences;
    await hydrate();
  } catch (error) { ui.error = error.message; render(); }
}

// PATCH /api/phantomplay/profile with an optional guardianPin — the same
// shape/route updatePhantomPlayProfile (server) already accepts. A guardian
// PIN is only ever read from the DOM at call time (never cached in `ui`), so
// each attempt requires re-entering it.
function guardianPinFromDom() {
  return mountedRoot?.querySelector("[data-pp-exposure-pin]")?.value.trim() || undefined;
}

async function applyRatingExposure(nextRatings) {
  if (ui.offline) { ui.guardianMessage = "Rating exposure needs the PhantomForce server."; render(); return; }
  ui.ratingBusy = true;
  render();
  try {
    const payload = await api("/api/phantomplay/profile", { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), preferences: { allowedRatings: nextRatings }, guardianPin: guardianPinFromDom() }) });
    ui.snapshot.preferences = payload.preferences;
    ui.guardianMessage = "";
  } catch (error) {
    ui.guardianMessage = error.message;
  } finally {
    ui.ratingBusy = false;
    render();
  }
}

async function applyProfileType(nextType) {
  if (ui.offline) { ui.guardianMessage = "Profile type needs the PhantomForce server."; render(); return; }
  ui.ratingBusy = true;
  render();
  try {
    const payload = await api("/api/phantomplay/profile", { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), profileType: nextType, guardianPin: guardianPinFromDom() }) });
    ui.snapshot.profileType = payload.profileType;
    ui.snapshot.preferences = payload.preferences;
    ui.guardianMessage = "";
  } catch (error) {
    ui.guardianMessage = error.message;
  } finally {
    ui.ratingBusy = false;
    render();
  }
}

async function saveGuardianLock() {
  const checkbox = mountedRoot?.querySelector("[data-pp-guardian-enabled]");
  const pinInput = mountedRoot?.querySelector("[data-pp-guardian-pin-input]");
  const nextEnabled = !!checkbox?.checked;
  const pin = pinInput?.value.trim() || "";
  if (nextEnabled && pin && pin.length < 4) { ui.guardianMessage = "Choose a PIN with at least 4 digits."; render(); return; }
  if (ui.offline) { ui.guardianMessage = "Guardian lock needs the PhantomForce server."; render(); return; }
  try {
    const payload = await api("/api/phantomplay/profile", { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), guardianLock: { enabled: nextEnabled, pin: pin || undefined }, guardianPin: guardianPinFromDom() }) });
    ui.snapshot.guardianLock = payload.guardianLock;
    ui.guardianMessage = nextEnabled ? "Guardian PIN saved." : "Guardian PIN lock turned off.";
  } catch (error) {
    ui.guardianMessage = error.message;
  }
  render();
}

async function launch(gameId, opts = {}) {
  if (!gameId) return;
  if (!canLaunchGames()) {
    ui.error = "PhantomPlay is blocked by this workspace plan or policy.";
    render();
    return;
  }
  const game = ui.snapshot.catalog.find((item) => item.id === gameId);
  if (!game?.launchUrl) { ui.error = "This game is not available to play yet."; render(); return; }
  if (ui.offline) {
    localPlay(game, opts);
    return;
  }
  revokePlayerOverrideBlob();
  try {
    // Fetch the workspace's saved Dev Mode edit alongside the play session so the
    // first render already mounts it — a plain "Start game" runs the saved code,
    // not the old shipped file. Non-dev players get a 403 and play the shipped file.
    const [result, override] = await Promise.all([
      api("/api/phantomplay/plays", { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), gameId }) }),
      ui.devSandbox?.gameId === gameId ? Promise.resolve(null) : api(`/api/phantomplay/dev-mode/${encodeURIComponent(gameId)}/override?tenant_id=${encodeURIComponent(currentTenantId())}`).catch(() => null),
    ]);
    ui.player = { game: result.game || game, play: result.play, roomCode: opts.roomCode || null, restoreState: result.restoreState || null };
    if (override?.source && ui.devSandbox?.gameId !== gameId) {
      const blob = new Blob([injectModSupport(override.source, gameId)], { type: "text/html" });
      ui.player.overrideBlobUrl = URL.createObjectURL(blob);
    }
    ui.playerReady = false;
    ui.playerPaused = false;
    ui.playerError = null;
    playTickAt = Date.now();
    render();
    startClock();
    armReadyWatchdog();
  } catch (error) {
    ui.offline = true;
    localPlay(game, opts);
  }
}
function revokePlayerOverrideBlob() {
  if (ui.player?.overrideBlobUrl) { URL.revokeObjectURL(ui.player.overrideBlobUrl); ui.player.overrideBlobUrl = ""; }
}

// Dev Sandbox's only entry point: the exact same launch as a normal Play
// click, so it is never a second, differently-styled destination. Once the
// game reports "ready" (see onGameMessage), Dev Sandbox opens automatically.
function launchWithDevSandbox(gameId) {
  pendingDevSandboxGameId = gameId;
  launch(gameId);
}

function launchDevSandboxFromWorkbench() {
  if (!ui.devWorkbench || ui.devWorkbench.loading) return;
  const gameId = ui.devWorkbench.gameId;
  const source = devWorkbenchDomSource();
  const files = devProjectFromSource(source);
  const problem = devProjectProblem(files);
  if (problem) {
    ui.devWorkbench = { ...ui.devWorkbench, editedSource: source, files, error: problem, status: "Project needs attention before it can launch." };
    render();
    return;
  }
  const localDraft = rememberDevSandboxAutosave(gameId, source);
  revokeDevSandboxBlob();
  const nextSource = injectModSupport(source, gameId);
  const blob = new Blob([nextSource], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);
  ui.devSandbox = { ...ui.devWorkbench, editedSource: source, localUpdatedAt: localDraft.updatedAt, blobUrl, hasOverride: true, loading: false, error: "", status: "Saved and running your draft. It will also load on a normal Start.", minimized: false, saving: false, publishing: false };
  pendingDevSandboxBootState = null;
  pendingDevSandboxGameId = null;
  ui.devWorkbench = null;
  // "Save & Launch" — persist so it survives reloads and loads on a normal Start.
  persistDevOverride(gameId, source);
  launch(gameId);
}
async function persistDevOverride(gameId, source) {
  try {
    await api(`/api/phantomplay/dev-mode/${encodeURIComponent(gameId)}/override`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), source }) });
  } catch {
    // The live blob still runs locally, so Dev Mode itself looks fine — but
    // unlike saveDevWorkbench()'s catch block, this path used to just give up
    // silently with no retry at all, which is exactly how Normal Mode ends up
    // stuck on stale code after a "Save & Launch Dev Mode" whose POST failed:
    // nothing ever tried again to persist it. Route through the same retry
    // path saveDevWorkbench() uses so both entry points are equally reliable.
    setDevSandboxStatus("Saving to your account failed — retrying in the background…");
    retryDevProjectSync(gameId, source);
  }
}

function launchNormalFromWorkbench() {
  const gameId = ui.devWorkbench?.gameId;
  ui.devWorkbench = null;
  render();
  if (gameId) launch(gameId);
}

async function saveDevWorkbench() {
  if (!ui.devWorkbench || ui.devWorkbench.loading || ui.devWorkbench.saving) return;
  const gameId = ui.devWorkbench.gameId;
  const source = devWorkbenchDomSource();
  const project = devProjectFromSource(source);
  const problem = devProjectProblem(project);
  if (problem) {
    ui.devWorkbench = { ...ui.devWorkbench, editedSource: source, files: project, error: problem, status: "Project needs attention before it can save." };
    render();
    return;
  }
  const localDraft = rememberDevSandboxAutosave(gameId, source);
  ui.devWorkbench = { ...ui.devWorkbench, editedSource: source, files: project, localUpdatedAt: localDraft.updatedAt, saving: true, error: "", status: "Saving…" };
  render();
  try {
    const result = await api(`/api/phantomplay/dev-mode/${encodeURIComponent(gameId)}/override`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), source }) });
    if (ui.devWorkbench?.gameId !== gameId) return;
    ui.devWorkbench = { ...ui.devWorkbench, saving: false, hasOverride: true, overrideUpdatedAt: result.updatedAt, status: "Saved. This complete project will reopen here and launch in Dev Mode.", error: "" };
  } catch (error) {
    if (ui.devWorkbench?.gameId !== gameId) return;
    ui.devWorkbench = { ...ui.devWorkbench, saving: false, status: "Saved. Workspace sync will retry automatically.", error: "" };
    retryDevProjectSync(gameId, source);
  }
  render();
}

async function revertDevWorkbenchToLastWorking() {
  if (!ui.devWorkbench || ui.devWorkbench.loading || ui.devWorkbench.error) return;
  const { gameId, hasOverride } = ui.devWorkbench;
  if (hasOverride) {
    try { await api(`/api/phantomplay/dev-mode/${encodeURIComponent(gameId)}/override`, { method: "DELETE" }); } catch { /* local recovery still wins */ }
  }
  clearDevSandboxAutosave(gameId);
  ui.devWorkbench = devWorkbenchWithSource({
    ...ui.devWorkbench,
    editedSource: ui.devWorkbench.source,
    history: createEditorHistory(),
    hasOverride: false,
    localUpdatedAt: null,
    status: "Reverted to last working code.",
    error: "",
  }, ui.devWorkbench.source);
  render();
}

function closeDevWorkbench() {
  if (ui.devWorkbench && !ui.devWorkbench.loading && !ui.devWorkbench.error) {
    const source = devWorkbenchDomSource();
    rememberDevSandboxAutosave(ui.devWorkbench.gameId, source);
  }
  ui.devWorkbench = null;
  render();
}

function retryDevProjectSync(gameId, source, attempt = 0) {
  const delays = [1200, 4000, 12000];
  if (attempt >= delays.length) {
    // Every retry failed. This used to just `return` here with no signal to
    // the user at all — Dev Mode kept showing their edits (from the local
    // blob) so everything *looked* fine, while the override never actually
    // reached the server. Normal Mode (and any other device) would silently
    // keep serving the last version that DID save, which is exactly the
    // "dev mode updated, normal mode didn't" desync this is fixing. Make the
    // failure visible and give the user a concrete next step instead.
    const message = "Couldn't save your changes to your account after several tries — Normal Mode will keep showing your last saved version until this succeeds. Click Save to try again.";
    let shouldRender = false;
    for (const target of ["devWorkbench", "devSandbox"]) {
      if (ui[target]?.gameId === gameId) {
        ui[target] = { ...ui[target], saving: false, status: message, error: target === "devWorkbench" ? message : ui[target].error };
        shouldRender ||= target === "devWorkbench";
      }
    }
    if (ui.devSandbox?.gameId === gameId) setDevSandboxStatus(message);
    if (shouldRender) render();
    return;
  }
  setTimeout(async () => {
    try {
      const result = await api(`/api/phantomplay/dev-mode/${encodeURIComponent(gameId)}/override`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), source }) });
      let shouldRender = false;
      for (const target of ["devWorkbench", "devSandbox"]) {
        if (ui[target]?.gameId === gameId) {
          ui[target] = { ...ui[target], hasOverride: true, overrideUpdatedAt: result.updatedAt, saving: false, status: "Saved. Workspace sync is complete.", error: "" };
          shouldRender ||= target === "devWorkbench";
        }
      }
      if (ui.devSandbox?.gameId === gameId) setDevSandboxStatus("Saved. Workspace sync is complete.");
      if (shouldRender) render();
    } catch {
      retryDevProjectSync(gameId, source, attempt + 1);
    }
  }, delays[attempt]);
}

// ---- Private rooms: live sync ----
// Rooms used to refresh only via a full hydrate() after create/join/leave.
// Now those actions apply the room the server already handed back directly
// (no extra round trip), and this polling loop is the ongoing live-sync
// mechanism — it keeps roster/ready-states/matchState current for as long as
// a room view (the "together" tab, or an active room-launched game) is open.
function roomsViewOpen() {
  return ui.tab === "together" || !!ui.player?.roomCode;
}

function activeRoomCodes() {
  const fromList = (ui.snapshot?.rooms || []).map((room) => room.code).filter(Boolean);
  const fromPlayer = ui.player?.roomCode ? [ui.player.roomCode] : [];
  return [...new Set([...fromList, ...fromPlayer])];
}

function upsertRoom(room) {
  if (!room || !ui.snapshot) return;
  const idx = ui.snapshot.rooms.findIndex((item) => item.code === room.code);
  if (idx >= 0) ui.snapshot.rooms[idx] = room; else ui.snapshot.rooms.unshift(room);
}

async function pollRooms() {
  if (!roomsViewOpen() || ui.offline) { stopRoomPolling(); return; }
  roomPollTicks += 1;
  const codes = activeRoomCodes();
  if (!codes.length) return;
  let listChanged = false;
  for (const code of codes) {
    let room;
    try {
      const result = await api(`/api/phantomplay/rooms/${encodeURIComponent(code)}?tenant_id=${encodeURIComponent(currentTenantId())}`);
      room = result.room;
    } catch {
      continue; // transient poll failure — try again next tick
    }
    if (!room) continue;
    const previous = ui.snapshot.rooms.find((item) => item.code === code);
    const changed = JSON.stringify(previous) !== JSON.stringify(room);
    upsertRoom(room);
    if (changed) {
      if (!ui.player) listChanged = true;
      if (ui.player?.roomCode === code) pushMatchStateToGame(room);
    }
    if (roomPollTicks % ROOM_POLL_TOUCH_EVERY === 0) {
      const myReady = room.readyStates?.[ui.snapshot.actorId] === true;
      api(`/api/phantomplay/rooms/${encodeURIComponent(code)}/ready`, { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), ready: myReady }) }).catch(() => {});
    }
  }
  // Never call render() while a game iframe is mounted — it would rebuild
  // the <iframe> element and reload the game. Only the roster/room-list
  // view (no iframe present) is safe to re-render from the poll.
  if (listChanged && ui.tab === "together" && !ui.player) render();
}

function startRoomPolling() {
  if (roomPollTimer) return;
  roomPollTicks = 0;
  roomPollTimer = setInterval(pollRooms, ROOM_POLL_MS);
}

function stopRoomPolling() {
  clearInterval(roomPollTimer);
  roomPollTimer = null;
}

function syncRoomPolling() {
  if (roomsViewOpen() && !ui.offline) startRoomPolling();
  else stopRoomPolling();
}

async function toggleRoomReady(code, ready) {
  try {
    const result = await api(`/api/phantomplay/rooms/${encodeURIComponent(code)}/ready`, { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), ready }) });
    upsertRoom(result.room);
  } catch (error) {
    ui.roomMessage = `Blocked: ${error.message}`;
  }
  render();
}

async function updateHostControls(code, patch) {
  try {
    const result = await api(`/api/phantomplay/rooms/${encodeURIComponent(code)}/match-state`, { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), hostControls: patch }) });
    upsertRoom(result.room);
  } catch (error) {
    ui.roomMessage = `Blocked: ${error.message}`;
  }
  render();
}

async function createPrivateRoom(form) {
  const data = new FormData(form);
  ui.roomBusy = true;
  ui.roomMessage = "Creating a private room code…";
  render();
  try {
    const result = await api("/api/phantomplay/rooms", { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), mode: String(data.get("mode") || "classroom"), gameId: String(data.get("gameId") || ""), maxPlayers: Number(data.get("maxPlayers")) || undefined }) });
    ui.roomMode = result.room?.mode || ui.roomMode;
    ui.roomGameId = result.room?.gameId || ui.roomGameId;
    ui.roomMessage = `Room ${result.room?.code || ""} is ready. Share the code only with signed-in people in this workspace.`;
    upsertRoom(result.room);
  } catch (error) {
    ui.roomMessage = `Blocked: ${error.message}`;
  } finally {
    ui.roomBusy = false;
    render();
  }
}

async function joinPrivateRoom(form) {
  const data = new FormData(form);
  const code = String(data.get("code") || "").trim();
  if (!code) { ui.roomMessage = "Blocked: enter a room code first."; render(); return; }
  ui.roomBusy = true;
  ui.roomMessage = "Checking private room code…";
  render();
  try {
    const result = await api(`/api/phantomplay/rooms/${encodeURIComponent(code)}/join`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId() }) });
    ui.roomMessage = `Joined room ${result.room?.code || code}. Launch the game when your group is ready.`;
    upsertRoom(result.room);
  } catch (error) {
    ui.roomMessage = `Blocked: ${error.message}`;
  } finally {
    ui.roomBusy = false;
    render();
  }
}

async function leavePrivateRoom(code) {
  try {
    const result = await api(`/api/phantomplay/rooms/${encodeURIComponent(code)}/leave`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId() }) });
    ui.roomMessage = `Left room ${code}.`;
    upsertRoom(result.room);
    if (ui.player?.roomCode === code) ui.player.roomCode = null;
  } catch (error) {
    ui.roomMessage = `Blocked: ${error.message}`;
  }
  render();
}

function startClock() {
  clearInterval(playClock);
  playClock = setInterval(() => persistPlay(false), 15000);
}

async function persistPlay(ended, detail = {}) {
  if (!ui.player) return;
  const delta = Math.max(0, Math.min(60, Math.round((Date.now() - playTickAt) / 1000)));
  playTickAt = Date.now();
  Object.assign(ui.player.play, { seconds: (ui.player.play.seconds || 0) + delta, score: detail.score ?? ui.player.play.score, progress: detail.progress ?? ui.player.play.progress });
  const existing = historyFor(ui.player.game.id);
  const progress = ui.player.play.progress || 0;
  const row = { gameId: ui.player.game.id, lastPlayedAt: new Date().toISOString(), score: Math.max(existing?.score || 0, ui.player.play.score || 0), progress, seconds: (existing?.seconds || 0) + delta, canContinue: progress > 0 && progress < 100 };
  ui.snapshot.history = [row, ...ui.snapshot.history.filter((item) => item.gameId !== row.gameId)];
  if (ui.offline) { saveOffline(); return; }
  try { await api(`/api/phantomplay/plays/${encodeURIComponent(ui.player.play.id)}`, { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), secondsDelta: delta, score: detail.score, progress: detail.progress, state: detail.state, ended }) }); } catch { ui.offline = true; saveOffline(); }
}

async function closePlayer() {
  if (playerClosing) return;
  playerClosing = true;
  const closing = ui.player;
  snapshotDevSandboxLocalDraft();
  postToGame("exit", { focus: false });
  if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => undefined);
  clearInterval(playClock);
  clearTimeout(readyWatchdog);
  clearTimeout(devSandboxApplyTimer);
  clearTimeout(devSandboxAutosaveTimer);
  revokeDevSandboxBlob();
  revokePlayerOverrideBlob();
  ui.devSandbox = null;
  await persistPlay(true);
  // persistPlay awaits the network; if a new game launched meanwhile, don't wipe it.
  if (ui.player && ui.player !== closing) { playerClosing = false; return; }
  ui.player = null;
  ui.playerReady = false;
  ui.playerPaused = false;
  ui.playerError = null;
  document.body.classList.remove("phantomplay-playing");
  playerClosing = false;
  render();
}

// Dev Sandbox: the in-player live editor. See docs/architecture/
// PHANTOMPLAY_DEV_MODE.md — the entry point only ever renders when the
// server already said `devModeAvailable` for this exact game (see
// `gameCard`/`playerMarkup`), and every fetch below hits a route that
// re-checks that server-side, so this is UX convenience, not the actual
// security boundary. The panel's own preview reuses the real player iframe
// (see the shared safety assertion in scripts/test-phantomplay.mjs guarding
// against origin/form/popup grants) — same opaque-origin isolation, just
// loading a blob: URL of the in-progress edit instead of the reviewed
// launchUrl. This replaced an earlier separate full-screen Dev Mode modal
// that duplicated the whole play surface — Dev Sandbox is just the normal
// player with a drawer, never a second, differently-styled destination.
let devSandboxApplyTimer = null;
let devSandboxAutosaveTimer = null;

function revokeDevSandboxBlob() {
  if (ui.devSandbox?.blobUrl) URL.revokeObjectURL(ui.devSandbox.blobUrl);
}

function loadDevSandboxAutosaves() {
  try { return JSON.parse(workspaceStorageGetItem(DEV_SANDBOX_AUTOSAVE_KEY) || "{}") || {}; }
  catch { return {}; }
}

function saveDevSandboxAutosaves(records) {
  workspaceStorageSetItem(DEV_SANDBOX_AUTOSAVE_KEY, JSON.stringify(records || {}));
}

function localDevSandboxAutosave(gameId) {
  const records = loadDevSandboxAutosaves();
  const record = records?.[gameId];
  return record && typeof record.source === "string" ? record : null;
}

function rememberDevSandboxAutosave(gameId, source) {
  const records = loadDevSandboxAutosaves();
  records[gameId] = { source, updatedAt: new Date().toISOString() };
  saveDevSandboxAutosaves(records);
  return records[gameId];
}

function clearDevSandboxAutosave(gameId) {
  const records = loadDevSandboxAutosaves();
  delete records[gameId];
  saveDevSandboxAutosaves(records);
}

function newestDevSandboxSource(...candidates) {
  const updatedMs = (item) => {
    const parsed = Date.parse(item?.updatedAt || "");
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return candidates
    .filter((item) => item && typeof item.source === "string")
    .sort((a, b) => updatedMs(b) - updatedMs(a))[0] || null;
}

function devSandboxDomSource() {
  const textarea = mountedRoot?.querySelector("[data-pp-devsandbox-source]");
  return typeof textarea?.value === "string" ? textarea.value : ui.devSandbox?.editedSource || "";
}

function snapshotDevSandboxLocalDraft() {
  if (!ui.devSandbox || ui.devSandbox.loading || ui.devSandbox.error) return;
  const source = devSandboxDomSource();
  ui.devSandbox = { ...ui.devSandbox, editedSource: source };
  rememberDevSandboxAutosave(ui.devSandbox.gameId, source);
}

function setDevSandboxStatus(message) {
  const status = mountedRoot?.querySelector("[data-pp-devsandbox-status]");
  if (status) status.textContent = message;
}

// Keep a lightweight app-level editor history in addition to the browser's
// textarea history. Rebuilding a live preview must never make Ctrl+Z lose the
// user's prior code, and the bounded stack keeps even a large game source safe
// to edit without unbounded memory growth.
const EDITOR_HISTORY_LIMIT = 60;
function createEditorHistory() {
  return { undo: [], redo: [] };
}

function normalizedEditorHistory(history) {
  return {
    undo: Array.isArray(history?.undo) ? history.undo : [],
    redo: Array.isArray(history?.redo) ? history.redo : [],
  };
}

function recordEditorChange(editor, source) {
  if (!editor || source === editor.editedSource) return editor;
  const history = normalizedEditorHistory(editor.history);
  return {
    ...editor,
    editedSource: source,
    history: { undo: [...history.undo, editor.editedSource].slice(-EDITOR_HISTORY_LIMIT), redo: [] },
  };
}

function replaceEditorText(selector, source) {
  const textarea = mountedRoot?.querySelector(selector);
  if (!textarea) return;
  const cursor = Math.min(textarea.selectionStart ?? source.length, source.length);
  textarea.value = source;
  textarea.setSelectionRange?.(cursor, cursor);
}

function syncEditorHistoryControls(target) {
  const history = normalizedEditorHistory(ui[target]?.history);
  const prefix = target === "devSandbox" ? "[data-pp-devsandbox" : "[data-pp-devworkbench";
  const undo = mountedRoot?.querySelector(`${prefix}-undo]`);
  const redo = mountedRoot?.querySelector(`${prefix}-redo]`);
  if (undo) undo.disabled = !history.undo.length;
  if (redo) redo.disabled = !history.redo.length;
}

function moveEditorHistory(target, direction) {
  const editor = ui[target];
  if (!editor) return false;
  const history = normalizedEditorHistory(editor.history);
  const from = direction === "undo" ? history.undo : history.redo;
  if (!from.length) return false;
  const source = from[from.length - 1];
  const current = target === "devSandbox" ? devSandboxDomSource() : devWorkbenchDomSource();
  const nextHistory = direction === "undo"
    ? { undo: history.undo.slice(0, -1), redo: [...history.redo, current].slice(-EDITOR_HISTORY_LIMIT) }
    : { undo: [...history.undo, current].slice(-EDITOR_HISTORY_LIMIT), redo: history.redo.slice(0, -1) };
  ui[target] = { ...editor, editedSource: source, history: nextHistory, status: direction === "undo" ? "Undid the last code edit." : "Redid the code edit." };
  if (target === "devSandbox") {
    replaceEditorText("[data-pp-devsandbox-source]", source);
    applyDevSandboxEditLive();
    snapshotDevSandboxLocalDraft();
    syncEditorHistoryControls(target);
  } else {
    ui.devWorkbench = devWorkbenchWithSource(ui.devWorkbench, source, ui.devWorkbench.activeFile);
    render();
  }
  return true;
}

function handleEditorShortcut(event, target) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  const direction = key === "y" || (key === "z" && event.shiftKey) ? "redo" : key === "z" ? "undo" : "";
  if (!direction) return;
  event.preventDefault();
  moveEditorHistory(target, direction);
}

function trackDevSandboxEditorInput() {
  if (!ui.devSandbox) return;
  ui.devSandbox = recordEditorChange(ui.devSandbox, devSandboxDomSource());
  syncEditorHistoryControls("devSandbox");
  scheduleDevSandboxApply();
}

function trackDevWorkbenchEditorInput() {
  if (!ui.devWorkbench) return;
  const source = devWorkbenchDomSource();
  const next = recordEditorChange(ui.devWorkbench, source);
  ui.devWorkbench = { ...next, editedSource: source, files: devProjectFromSource(source), status: "Unsaved changes. Press Save when ready." };
  syncEditorHistoryControls("devWorkbench");
}

function applyDevSandboxModStateToGame({ focus = false } = {}) {
  if (!ui.devSandbox) return;
  postToGame("modspeed", { value: ui.devSandbox.speed || 1, focus });
  for (const [key, value] of Object.entries(ui.devSandbox.modState || {})) {
    postToGame("mod", { key, value: !!value, focus: false });
  }
}

// Rebuilds the Dev Sandbox blob from `nextSource` with mod support injected,
// and points the real player iframe at it. Every path that changes what's
// shown (open, live edits, revert) goes through this so mods are always
// present in whatever's currently loaded — never applied to the plain text
// held in editedSource, which is exactly what Save/Publish read and send.
function rebuildDevSandboxFrame(source) {
  if (!ui.devSandbox) return;
  const frame = mountedRoot?.querySelector("[data-pp-frame]");
  revokeDevSandboxBlob();
  const nextSource = injectModSupport(source, ui.devSandbox.gameId);
  const blob = new Blob([nextSource], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);
  ui.devSandbox = { ...ui.devSandbox, blobUrl };
  if (frame) frame.src = blobUrl;
}

async function openDevSandbox() {
  if (!ui.player) return;
  const { game } = ui.player;
  if (!game.devModeAvailable) return;
  if (pendingDevSandboxBootState?.gameId === game.id) {
    const boot = pendingDevSandboxBootState;
    pendingDevSandboxBootState = null;
    revokeDevSandboxBlob();
    ui.devSandbox = { ...boot, blobUrl: "", saving: false, publishing: false };
    render();
    rebuildDevSandboxFrame(ui.devSandbox.editedSource);
    applyDevSandboxModStateToGame({ focus: false });
    return;
  }
  revokeDevSandboxBlob();
  ui.devSandbox = { gameId: game.id, source: "", editedSource: "", history: createEditorHistory(), blobUrl: "", hasOverride: false, overrideUpdatedAt: null, localUpdatedAt: null, loading: true, error: "", status: "", saving: false, publishing: false, section: "code", modState: {}, speed: 1 };
  render();
  try {
    const tenantQuery = `tenant_id=${encodeURIComponent(currentTenantId())}`;
    const [sourceResult, overrideResult] = await Promise.all([
      api(`/api/phantomplay/dev-mode/${encodeURIComponent(game.id)}/source?${tenantQuery}`),
      api(`/api/phantomplay/dev-mode/${encodeURIComponent(game.id)}/override?${tenantQuery}`).catch(() => ({ source: null, updatedAt: null })),
    ]);
    const localDraft = localDevSandboxAutosave(game.id);
    const newestDraft = newestDevSandboxSource(
      localDraft,
      overrideResult.source ? { source: overrideResult.source, updatedAt: overrideResult.updatedAt } : null,
    );
    const startingSource = cleanEditableGameSource(newestDraft?.source ?? sourceResult.source);
    const status = newestDraft
      ? (newestDraft === localDraft ? "Resumed your local autosave." : "Resumed your saved workspace override.")
      : "Loaded the full shipped project. Edits preview live; press Save when done.";
    ui.devSandbox = {
      gameId: game.id, source: sourceResult.source, editedSource: startingSource, blobUrl: "",
      hasOverride: !!overrideResult.source, overrideUpdatedAt: overrideResult.updatedAt,
      localUpdatedAt: localDraft?.updatedAt || null,
      loading: false, error: "", status, saving: false, publishing: false,
      section: "code", modState: {}, speed: 1, history: createEditorHistory(),
    };
  } catch (error) {
    try {
      const localDraft = localDevSandboxAutosave(game.id);
      const source = await fetchEditableGameSource(game).catch((sourceError) => {
        if (localDraft?.source && /<html\b|<!doctype\s+html/iu.test(localDraft.source)) return localDraft.source;
        throw sourceError;
      });
      const startingSource = cleanEditableGameSource(localDraft?.source || source);
      ui.devSandbox = {
        gameId: game.id, source, editedSource: startingSource, blobUrl: "",
        hasOverride: false, overrideUpdatedAt: null, localUpdatedAt: localDraft?.updatedAt || null,
        loading: false, error: "", status: localDraft ? "Resumed your local project. Workspace sync is waiting." : "Loaded the complete game project locally. Autosave stays on this PC until you press Save.",
        saving: false, publishing: false, section: "code", modState: {}, speed: 1, history: createEditorHistory(),
      };
    } catch {
      ui.devSandbox = { ...ui.devSandbox, loading: false, error: error instanceof Error ? error.message : "Dev Sandbox source could not be loaded." };
    }
  }
  const sourceForFrame = ui.devSandbox && !ui.devSandbox.loading && !ui.devSandbox.error ? ui.devSandbox.editedSource : "";
  render();
  if (sourceForFrame) rebuildDevSandboxFrame(sourceForFrame);
}

// Called on a debounced textarea input — this is the "see the code update in
// front of your face" loop. Deliberately does NOT call render(): re-building
// the whole panel's innerHTML on every keystroke would blow away the
// textarea's cursor position and focus. Instead it reads the DOM directly
// and updates just the small status line in place. State
// (ui.devSandbox.editedSource) is still kept in sync so Save/Publish/Revert/
// close read the latest text correctly.
function applyDevSandboxEditLive() {
  if (!ui.devSandbox) return;
  const nextSource = devSandboxDomSource();
  ui.devSandbox = { ...ui.devSandbox, editedSource: nextSource };
  rebuildDevSandboxFrame(nextSource);
  setDevSandboxStatus("Live preview updated. Your project will autosave locally; press Save when done.");
}

function scheduleDevSandboxApply() {
  clearTimeout(devSandboxApplyTimer);
  clearTimeout(devSandboxAutosaveTimer);
  devSandboxApplyTimer = setTimeout(applyDevSandboxEditLive, 350);
  devSandboxAutosaveTimer = setTimeout(snapshotDevSandboxLocalDraft, 1000);
}

// Mods apply instantly with no reload — the running blob already has every
// mod's patch baked in (inert until window.__ppMods[key] is true), so
// toggling one is just a live postMessage. onGameMessage() re-sends the
// current mod/speed state after any reload this panel triggers.
function toggleDevSandboxMod(modId, checked) {
  if (!ui.devSandbox) return;
  ui.devSandbox = { ...ui.devSandbox, modState: { ...(ui.devSandbox.modState || {}), [modId]: checked }, status: `${checked ? "Enabled" : "Disabled"} ${modId}. Live in this sandbox only.` };
  postToGame("mod", { key: modId, value: checked, focus: false });
  setDevSandboxStatus(ui.devSandbox.status);
}

function setDevSandboxSpeed(speed) {
  if (!ui.devSandbox) return;
  ui.devSandbox = { ...ui.devSandbox, speed, status: `Speed set to ${speedLabel(speed)} live. No resync needed.` };
  postToGame("modspeed", { value: speed, focus: false });
  setDevSandboxStatus(ui.devSandbox.status);
}

function generateDevModPlan(target) {
  const editor = ui[target];
  if (!editor) return;
  const selector = target === "devSandbox" ? "[data-pp-devsandbox-modprompt], [data-pp-devdock-modprompt]" : "[data-pp-devworkbench-modprompt]";
  const prompt = String(mountedRoot?.querySelector(selector)?.value || editor.aiModPrompt || "").trim();
  const lower = prompt.toLowerCase();
  const modState = { ...(editor.modState || {}) };
  let speed = editor.speed || 1;
  if (/turbo|super fast|4x|very fast/.test(lower)) speed = 4;
  else if (/fast|speed|quick/.test(lower)) speed = 2;
  else if (/slow|easy|assist/.test(lower)) speed = 0.5;
  if (/glow|neon|cool|pretty|visual/.test(lower)) modState.cinematicGlow = true;
  if (/bright|contrast|visible|see|paddle|ball/.test(lower)) modState.highContrast = true;
  if (/focus|border|frame/.test(lower)) modState.focusOverlay = true;
  const game = ui.snapshot?.catalog?.find((item) => item.id === editor.gameId) || BUILT_IN_GAMES.find((item) => item.id === editor.gameId) || { id: editor.gameId };
  const available = new Set(modsForGame(game).map((mod) => mod.id));
  if (/god|invincible|no damage|easy/.test(lower) && available.has("god")) modState.god = true;
  if (/cooldown|spam|rapid/.test(lower) && available.has("noCooldown")) modState.noCooldown = true;
  if (/power|weapon|max/.test(lower) && available.has("maxPower")) modState.maxPower = true;
  if (/stock|lives/.test(lower) && available.has("infiniteStocks")) modState.infiniteStocks = true;
  if (/grow|huge|size/.test(lower) && available.has("maxGrow")) modState.maxGrow = true;
  const note = prompt ? `Starter kit built from: “${prompt.slice(0, 90)}”.` : "Starter visibility kit built. Add a prompt for deeper game-specific ideas.";
  ui[target] = { ...editor, aiModPrompt: prompt, aiModNote: note, speed, modState, section: "mods" };
  if (target === "devSandbox") {
    render();
    applyDevSandboxModStateToGame({ focus: false });
  } else {
    render();
  }
}

function toggleDevModDock() {
  ui.devModDockOpen = !ui.devModDockOpen;
  mountedRoot?.querySelector(".pp-devmod-dock")?.classList.toggle("is-open", ui.devModDockOpen);
}

function openDevSandboxSection(section) {
  if (!ui.devSandbox) return;
  const source = devSandboxDomSource();
  ui.devSandbox = { ...ui.devSandbox, minimized: false, section: section === "mods" ? "mods" : "code", editedSource: source };
  render();
  rebuildDevSandboxFrame(source);
}

function setDevSandboxSection(section) {
  if (!ui.devSandbox) return;
  const source = devSandboxDomSource();
  ui.devSandbox = { ...ui.devSandbox, section: section === "mods" ? "mods" : "code", editedSource: source };
  render();
  rebuildDevSandboxFrame(source);
}

async function persistDevSandboxOverride({ silent = false } = {}) {
  if (!ui.devSandbox || ui.devSandbox.saving) return;
  const gameId = ui.devSandbox.gameId;
  const source = devSandboxDomSource();
  const localDraft = rememberDevSandboxAutosave(gameId, source);
  ui.devSandbox = { ...ui.devSandbox, editedSource: source, localUpdatedAt: localDraft.updatedAt, saving: true };
  const saveButton = mountedRoot?.querySelector("[data-pp-devsandbox-save]");
  if (saveButton) { saveButton.disabled = true; saveButton.textContent = "Saving…"; }
  setDevSandboxStatus("Saving…");
  try {
    const result = await api(`/api/phantomplay/dev-mode/${encodeURIComponent(gameId)}/override`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), source }) });
    ui.devSandbox = { ...ui.devSandbox, editedSource: source, hasOverride: true, overrideUpdatedAt: result.updatedAt, saving: false, status: "Saved & resynced. Only visible to workspace managers until published live.", error: "" };
    setDevSandboxStatus("Saved. Your running game was not reloaded.");
  } catch (error) {
    ui.devSandbox = { ...ui.devSandbox, saving: false, status: "Saved. Workspace sync will retry automatically.", error: "" };
    retryDevProjectSync(gameId, source);
    setDevSandboxStatus("Saved. Workspace sync will retry automatically.");
  }
  if (saveButton) { saveButton.disabled = false; saveButton.textContent = "Save"; }
}

async function saveDevSandboxOverride() {
  applyDevSandboxEditLive();
  await persistDevSandboxOverride({ silent: false });
}

async function revertDevSandboxToShipped() {
  if (!ui.devSandbox) return;
  const { gameId, source, hasOverride } = ui.devSandbox;
  if (hasOverride) {
    try { await api(`/api/phantomplay/dev-mode/${encodeURIComponent(gameId)}/override`, { method: "DELETE" }); } catch { /* best effort */ }
  }
  clearDevSandboxAutosave(gameId);
  ui.devSandbox = { ...ui.devSandbox, editedSource: source, history: createEditorHistory(), hasOverride: false, overrideUpdatedAt: null, status: "Reverted to last working code.", error: "" };
  rebuildDevSandboxFrame(source);
  render();
}

async function publishDevSandboxLive() {
  if (!ui.devSandbox || ui.devSandbox.publishing) return;
  const source = devSandboxDomSource();
  if (!window.confirm("Publish this edit LIVE? This immediately overwrites the real shipped game file for every player. Your local editor can still undo unpublished changes.")) return;
  ui.devSandbox = { ...ui.devSandbox, publishing: true };
  render();
  try {
    await api(`/api/phantomplay/dev-mode/${encodeURIComponent(ui.devSandbox.gameId)}/publish`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), source, confirm: true }) });
    clearDevSandboxAutosave(ui.devSandbox.gameId);
    ui.devSandbox = { ...ui.devSandbox, source, editedSource: source, history: createEditorHistory(), hasOverride: false, overrideUpdatedAt: null, publishing: false, status: "Published live. Every player now gets this version." };
  } catch (error) {
    ui.devSandbox = { ...ui.devSandbox, publishing: false, error: error instanceof Error ? error.message : "This edit could not be published live." };
  }
  render();
}

function closeDevSandbox() {
  snapshotDevSandboxLocalDraft();
  clearTimeout(devSandboxApplyTimer);
  clearTimeout(devSandboxAutosaveTimer);
  pendingDevSandboxBootState = null;
  revokeDevSandboxBlob();
  const frame = mountedRoot?.querySelector("[data-pp-frame]");
  if (frame && ui.player) frame.src = ui.player.game.launchUrl;
  ui.devSandbox = null;
  render();
}

function minimizeDevSandbox() {
  snapshotDevSandboxLocalDraft();
  if (!ui.devSandbox) return;
  ui.devSandbox = { ...ui.devSandbox, minimized: true };
  render();
}

function restoreDevSandbox() {
  if (!ui.devSandbox) return;
  ui.devSandbox = { ...ui.devSandbox, minimized: false };
  render();
}

// `data` may include `focus: false` to skip stealing focus (e.g. a
// background match-state push); every other key is spread onto the posted
// message as-is.
function postToGame(type, data = {}) {
  const { focus, ...payload } = data;
  const frame = mountedRoot?.querySelector("[data-pp-frame]");
  frame?.contentWindow?.postMessage({ source: "phantomplay-host", type, engine: ui.player ? engineFor(ui.player.game) : PHANTOMPLAY_ENGINE, ...payload }, "*");
  if (focus !== false) frame?.focus?.({ preventScroll: true });
}

function focusGameFrame() {
  mountedRoot?.querySelector("[data-pp-frame]")?.focus?.({ preventScroll: true });
}

function isGameControlKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return GAME_CONTROL_KEYS.has(event.key) || GAME_CONTROL_KEYS.has(event.code);
}

// Global game-control keys (letters, space, arrows, enter, r-to-restart) are
// deliberately common characters in source code, so this listener must never
// fire while the user is typing somewhere editable (e.g. the Dev Mode source
// textarea) — otherwise every "a"/"s"/"r"/space keystroke steals focus back
// to the game iframe mid-edit, which is what breaks Ctrl+A/Backspace there.
function isEditableTarget(event) {
  const el = event.target;
  if (!el || typeof el.closest !== "function") return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return true;
  return Boolean(el.closest("input, textarea, [contenteditable='true'], [contenteditable='']"));
}

// host -> game "match-state": the host pushes the latest polled matchState +
// readyStates + botSlots (+ hostControls, for a game that wants to react to
// bot-fill/maxHumans) down to the active iframe whenever the room changes.
function pushMatchStateToGame(room) {
  if (!ui.player) return;
  postToGame("match-state", {
    matchState: room.matchState ?? null,
    readyStates: room.readyStates || {},
    botSlots: room.botSlots || [],
    hostControls: room.hostControls || null,
    participants: room.participants || [],
    focus: false,
  });
}

// game -> host "match-action": a game reports a player's local action. Only
// the current room host may write authoritative matchState server-side
// (updatePhantomPlayRoomMatchState enforces this), so a non-host participant's
// action has no transport to reach the true host today — it is intentionally
// dropped here rather than attempted-and-rejected on every keystroke. Games
// built against this contract should treat matchState (pushed back down via
// "match-state") as the source of truth, not their own local action echo.
async function handleMatchAction(action, mode) {
  const roomCode = ui.player?.roomCode;
  if (!roomCode) return;
  const room = ui.snapshot.rooms.find((item) => item.code === roomCode);
  if (!room || room.hostActorId !== ui.snapshot.actorId) return;
  try {
    const result = await api(`/api/phantomplay/rooms/${encodeURIComponent(roomCode)}/match-state`, { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), matchState: action, mode: mode === "replace" ? "replace" : "merge" }) });
    if (result.room) {
      upsertRoom(result.room);
      pushMatchStateToGame(result.room);
    }
  } catch {
    // Rate-limited (max 10 match-state writes / 2s / room) or transiently
    // blocked — the next poll tick resyncs authoritative state either way.
  }
}

function togglePlayerPause() {
  if (!ui.playerReady) return;
  ui.playerPaused = !ui.playerPaused;
  postToGame(ui.playerPaused ? "pause" : "resume");
  const pauseButton = mountedRoot?.querySelector("[data-pp-player-pause]");
  if (pauseButton) pauseButton.textContent = ui.playerPaused ? "Resume" : "Pause";
  const state = mountedRoot?.querySelector("[data-pp-live-state]");
  if (state) state.textContent = ui.playerPaused ? "Paused" : "Playing";
}

function restartPlayer() {
  if (!ui.playerReady) return;
  ui.playerPaused = false;
  ui.playerError = null;
  postToGame("restart");
  const pauseButton = mountedRoot?.querySelector("[data-pp-player-pause]");
  if (pauseButton) pauseButton.textContent = "Pause";
  const score = mountedRoot?.querySelector("[data-pp-live-score]");
  if (score) score.textContent = "Score 0";
  const state = mountedRoot?.querySelector("[data-pp-live-state]");
  if (state) state.textContent = "Playing";
  mountedRoot?.querySelector("[data-pp-player-error]")?.remove();
}

function markPlayerReady(frame, { protocol = true, focus = true } = {}) {
  if (!ui.player || !frame) return;
  const firstReady = !ui.playerReady;
  ui.playerReady = true;
  clearTimeout(readyWatchdog);
  mountedRoot?.querySelector(".pp-player-loading")?.setAttribute("hidden", "");
  if (firstReady) {
    frame.contentWindow?.postMessage({ source: "phantomplay-host", type: "settings", sound: ui.snapshot.preferences.sound, reducedMotion: ui.snapshot.preferences.reducedMotion, engine: engineFor(ui.player.game) }, "*");
    // Hand back whatever this game last reported in its own state:{} payload
    // (score/complete) so a game that keeps meta-progress there — persistent
    // upgrade levels, rank/XP, best-run records — can restore it on boot
    // instead of starting fresh every launch.
    if (ui.player.restoreState && Object.keys(ui.player.restoreState).length) {
      frame.contentWindow?.postMessage({ source: "phantomplay-host", type: "restore", state: ui.player.restoreState }, "*");
    }
    if (focus) frame.focus?.({ preventScroll: true });
    if (ui.player.roomCode) {
      const room = ui.snapshot.rooms.find((item) => item.code === ui.player.roomCode);
      if (room) pushMatchStateToGame(room);
    }
    if (pendingDevSandboxGameId === ui.player.game.id) {
      pendingDevSandboxGameId = null;
      openDevSandbox();
    } else if (ui.devSandbox?.gameId === ui.player.game.id) {
      // Any reload this panel triggered (a live edit, a revert) resets the
      // modded page's own window.__ppMods to {} — restore whatever the
      // drawer's toggles/speed currently say so mods don't silently drop.
      applyDevSandboxModStateToGame({ focus: false });
    }
  }
  if (!protocol) {
    const liveState = mountedRoot?.querySelector("[data-pp-live-state]");
    if (liveState) liveState.textContent = "Playing";
  }
}

function onGameMessage(event) {
  const frame = mountedRoot?.querySelector("[data-pp-frame]");
  if (!ui.player || !frame || event.source !== frame.contentWindow || !event.data || event.data.source !== "phantomplay-game") return;
  if (event.data.type === "exit") {
    closePlayer();
    return;
  }
  if (event.data.type === "ready") {
    markPlayerReady(frame, { protocol: true, focus: true });
  }
  if (event.data.type === "paused") {
    ui.playerPaused = !!event.data.paused;
    const pauseButton = mountedRoot.querySelector("[data-pp-player-pause]");
    if (pauseButton) pauseButton.textContent = ui.playerPaused ? "Resume" : "Pause";
    const state = mountedRoot.querySelector("[data-pp-live-state]");
    if (state) state.textContent = ui.playerPaused ? "Paused" : "Playing";
  }
  if (event.data.type === "score" || event.data.type === "progress" || event.data.type === "complete") {
    const detail = { score: Number(event.data.score) || undefined, progress: event.data.type === "complete" ? 100 : Number(event.data.progress) || undefined, state: event.data.state };
    const score = mountedRoot.querySelector("[data-pp-live-score]");
    if (score && detail.score !== undefined) score.textContent = `Score ${detail.score}`;
    persistPlay(event.data.type === "complete", detail);
  }
  if (event.data.type === "match-action") {
    handleMatchAction(event.data.action, event.data.mode);
  }
  if (event.data.type === "runtime-error") {
    ui.playerError = String(event.data.message || "This game hit a script error and stopped responding.");
    // A script that threw before calling ready never clears the spinner;
    // an error is more useful than an infinite "Loading…".
    if (!ui.playerReady) markPlayerReady(frame, { protocol: false, focus: false });
    render();
  }
}

async function submitGame(form, submitter) {
  const message = form.querySelector("[data-pp-form-message]");
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  const submissionId = String(payload.submissionId || "");
  delete payload.submissionId;
  payload.tenantId = currentTenantId();
  payload.submit = submitter?.value === "submit";
  payload.screenshots = String(payload.screenshots || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  payload.tags = String(payload.tags || "").split(",").map((item) => item.trim()).filter(Boolean);
  message.textContent = payload.submit ? "Sending for review…" : "Saving draft…";
  try {
    await api(submissionId ? `/api/phantomplay/submissions/${encodeURIComponent(submissionId)}` : "/api/phantomplay/submissions", { method: submissionId ? "PATCH" : "POST", body: JSON.stringify(payload) });
    message.textContent = payload.submit ? "Submitted for review." : "Draft saved.";
    form.reset();
    ui.editingSubmissionId = null;
    await hydrate();
  } catch (error) { message.textContent = error.message; }
}

async function moderate(button) {
  const featured = mountedRoot.querySelector(`[data-pp-featured="${CSS.escape(button.dataset.id)}"]`)?.checked || false;
  const note = mountedRoot.querySelector(`[data-pp-note="${CSS.escape(button.dataset.id)}"]`)?.value.trim() || (button.dataset.ppModerate === "approved" ? "Passed initial PhantomPlay review." : "No moderation note supplied.");
  try {
    await api(`/api/phantomplay/submissions/${encodeURIComponent(button.dataset.id)}/moderate`, { method: "POST", body: JSON.stringify({ decision: button.dataset.ppModerate, featured, note }) });
    await hydrate();
  } catch (error) { ui.error = error.message; render(); }
}

function updateDeveloperRecord(devId, updater) {
  const records = loadDeveloperSupport();
  const saved = records[devId] && typeof records[devId] === "object" && !Array.isArray(records[devId]) ? records[devId] : {};
  const record = {
    supportCount: Number(saved.supportCount) || 0,
    donationIntentCount: Number(saved.donationIntentCount) || 0,
    supported: !!saved.supported,
    notes: Array.isArray(saved.notes) ? saved.notes : [],
  };
  updater(record);
  records[devId] = record;
  saveDeveloperSupport(records);
}

function supportDeveloper(devId) {
  updateDeveloperRecord(devId, (record) => {
    if (!record.supported) {
      record.supported = true;
      record.supportCount += 1;
      record.lastSupportedAt = new Date().toISOString();
      ui.developerMessage = "Support saved locally for this developer.";
    } else {
      ui.developerMessage = "You already marked local support for this developer.";
    }
  });
  render();
}

function logDeveloperDonationIntent(devId) {
  updateDeveloperRecord(devId, (record) => {
    record.donationIntentCount += 1;
    record.lastDonationIntentAt = new Date().toISOString();
    ui.developerMessage = "Collaboration interest saved locally. No payment was started.";
  });
  render();
}

function saveDeveloperNote(devId, text) {
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    ui.developerMessage = "Write a note before saving it.";
    render();
    return;
  }
  updateDeveloperRecord(devId, (record) => {
    record.notes = [{ id: `${Date.now()}`, text: cleanText.slice(0, 800), at: new Date().toISOString() }, ...record.notes].slice(0, 12);
    ui.developerMessage = "Private developer note saved locally.";
  });
  render();
}

function bind() {
  mountedRoot.querySelectorAll("[data-pp-tab]").forEach((button) => button.onclick = () => { ui.tab = button.dataset.ppTab; render(); });
  mountedRoot.querySelectorAll("[data-pp-support]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); ui.notice = `${button.dataset.ppSupport || "This creator"} support is queued for the creator profile/payments layer. For now, favorites and leaderboard plays help boost discovery.`; render(); });
  mountedRoot.querySelector("[data-pp-clear-notice]")?.addEventListener("click", () => { ui.notice = ""; render(); });
  mountedRoot.querySelectorAll("[data-pp-play]").forEach((button) => button.onclick = () => launch(button.dataset.ppPlay));
  mountedRoot.querySelectorAll("[data-pp-session-required]").forEach((button) => button.onclick = () => {
    ui.error = "This workspace plan or policy is blocking play.";
    render();
  });
  mountedRoot.querySelectorAll("[data-pp-devsandbox-card-open]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); launchWithDevSandbox(button.dataset.ppDevsandboxCardOpen); });
  mountedRoot.querySelectorAll("[data-pp-devsandbox-code-open]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); openDevWorkbench(button.dataset.ppDevsandboxCodeOpen, "code"); });
  mountedRoot.querySelector("[data-pp-devsandbox-open]")?.addEventListener("click", openDevSandbox);
  mountedRoot.querySelector("[data-pp-devsandbox-close]")?.addEventListener("click", closeDevSandbox);
  mountedRoot.querySelector("[data-pp-devsandbox-minimize]")?.addEventListener("click", minimizeDevSandbox);
  mountedRoot.querySelector("[data-pp-devsandbox-restore]")?.addEventListener("click", restoreDevSandbox);
  mountedRoot.querySelector("[data-pp-devsandbox-section]")?.addEventListener("change", (event) => setDevSandboxSection(event.target.value));
  mountedRoot.querySelector("[data-pp-devsandbox-source]")?.addEventListener("input", trackDevSandboxEditorInput);
  mountedRoot.querySelector("[data-pp-devsandbox-source]")?.addEventListener("keydown", (event) => handleEditorShortcut(event, "devSandbox"));
  mountedRoot.querySelector("[data-pp-devsandbox-undo]")?.addEventListener("click", () => moveEditorHistory("devSandbox", "undo"));
  mountedRoot.querySelector("[data-pp-devsandbox-redo]")?.addEventListener("click", () => moveEditorHistory("devSandbox", "redo"));
  mountedRoot.querySelector("[data-pp-devsandbox-save]")?.addEventListener("click", saveDevSandboxOverride);
  mountedRoot.querySelector("[data-pp-devsandbox-revert]")?.addEventListener("click", revertDevSandboxToShipped);
  mountedRoot.querySelector("[data-pp-devsandbox-publish]")?.addEventListener("click", publishDevSandboxLive);
  mountedRoot.querySelector("[data-pp-devsandbox-speed]")?.addEventListener("change", (event) => setDevSandboxSpeed(Number(event.target.value) || 1));
  mountedRoot.querySelectorAll("[data-pp-devsandbox-mod]").forEach((input) => input.addEventListener("change", () => toggleDevSandboxMod(input.dataset.ppDevsandboxMod, input.checked)));
  mountedRoot.querySelector("[data-pp-devsandbox-modprompt-generate]")?.addEventListener("click", () => generateDevModPlan("devSandbox"));
  mountedRoot.querySelectorAll("[data-pp-devmod-dock-toggle]").forEach((button) => button.addEventListener("click", toggleDevModDock));
  mountedRoot.querySelector("[data-pp-devdock-speed]")?.addEventListener("change", (event) => setDevSandboxSpeed(Number(event.target.value) || 1));
  mountedRoot.querySelectorAll("[data-pp-devdock-mod]").forEach((button) => button.addEventListener("click", () => {
    const next = !(ui.devSandbox?.modState || {})[button.dataset.ppDevdockMod];
    toggleDevSandboxMod(button.dataset.ppDevdockMod, next);
    button.classList.toggle("is-on", next);
  }));
  mountedRoot.querySelector("[data-pp-devdock-modprompt-generate]")?.addEventListener("click", () => generateDevModPlan("devSandbox"));
  mountedRoot.querySelector("[data-pp-devsandbox-open-code]")?.addEventListener("click", () => openDevSandboxSection("code"));
  mountedRoot.querySelector("[data-pp-devsandbox-open-mods]")?.addEventListener("click", () => openDevSandboxSection("mods"));
  mountedRoot.querySelectorAll("[data-pp-devworkbench-close]").forEach((button) => button.addEventListener("click", closeDevWorkbench));
  mountedRoot.querySelector("[data-pp-devworkbench-undo]")?.addEventListener("click", () => moveEditorHistory("devWorkbench", "undo"));
  mountedRoot.querySelector("[data-pp-devworkbench-redo]")?.addEventListener("click", () => moveEditorHistory("devWorkbench", "redo"));
  mountedRoot.querySelector("[data-pp-devworkbench-revert]")?.addEventListener("click", revertDevWorkbenchToLastWorking);
  mountedRoot.querySelector("[data-pp-devworkbench-save]")?.addEventListener("click", saveDevWorkbench);
  mountedRoot.querySelector("[data-pp-devworkbench-launch]")?.addEventListener("click", launchDevSandboxFromWorkbench);
  mountedRoot.querySelector("[data-pp-devworkbench-start]")?.addEventListener("click", launchNormalFromWorkbench);
  mountedRoot.querySelectorAll("[data-pp-devworkbench-file]").forEach((button) => button.addEventListener("click", () => selectDevWorkbenchFile(button.dataset.ppDevworkbenchFile)));
  mountedRoot.querySelector("[data-pp-devworkbench-files]")?.addEventListener("change", (event) => importDevWorkbenchFiles(event.target.files));
  mountedRoot.querySelectorAll("[data-pp-devworkbench-file-upload]").forEach((input) => input.addEventListener("change", () => importDevWorkbenchFiles(input.files, input.dataset.ppDevworkbenchFileUpload)));
  const projectDrop = mountedRoot.querySelector("[data-pp-devworkbench-drop]");
  if (projectDrop) {
    projectDrop.addEventListener("dragenter", (event) => { event.preventDefault(); projectDrop.classList.add("is-dragging"); });
    projectDrop.addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; projectDrop.classList.add("is-dragging"); });
    projectDrop.addEventListener("dragleave", (event) => { if (!projectDrop.contains(event.relatedTarget)) projectDrop.classList.remove("is-dragging"); });
    projectDrop.addEventListener("drop", (event) => { event.preventDefault(); projectDrop.classList.remove("is-dragging"); importDevWorkbenchFiles(event.dataTransfer.files); });
  }
  mountedRoot.querySelector("[data-pp-devworkbench-section]")?.addEventListener("change", (event) => {
    const source = devWorkbenchDomSource();
    ui.devWorkbench = { ...ui.devWorkbench, editedSource: source, files: devProjectFromSource(source), section: event.target.value === "mods" ? "mods" : "code" };
    render();
  });
  mountedRoot.querySelector("[data-pp-devworkbench-source]")?.addEventListener("input", trackDevWorkbenchEditorInput);
  mountedRoot.querySelector("[data-pp-devworkbench-source]")?.addEventListener("keydown", (event) => handleEditorShortcut(event, "devWorkbench"));
  mountedRoot.querySelector("[data-pp-devworkbench-speed]")?.addEventListener("change", (event) => {
    if (!ui.devWorkbench) return;
    ui.devWorkbench = { ...ui.devWorkbench, speed: Number(event.target.value) || 1, status: "Mod kit updated. Launch Dev Mode to test it live." };
  });
  mountedRoot.querySelectorAll("[data-pp-devworkbench-mod]").forEach((input) => input.addEventListener("change", () => {
    if (!ui.devWorkbench) return;
    ui.devWorkbench = { ...ui.devWorkbench, modState: { ...(ui.devWorkbench.modState || {}), [input.dataset.ppDevworkbenchMod]: input.checked }, status: "Mod kit updated. Launch Dev Mode to test it live." };
  }));
  mountedRoot.querySelector("[data-pp-devworkbench-modprompt-generate]")?.addEventListener("click", () => generateDevModPlan("devWorkbench"));
  mountedRoot.querySelectorAll("[data-pp-favorite]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); updateFavorite(button.dataset.ppFavorite); });
  mountedRoot.querySelector("[data-pp-settings]")?.addEventListener("click", () => { ui.settingsOpen = true; render(); });
  mountedRoot.querySelector("[data-pp-settings-close]")?.addEventListener("click", () => { ui.settingsOpen = false; render(); });
  mountedRoot.querySelector("[data-pp-theme]")?.addEventListener("change", (event) => { applyColorMode(event.target.value); render(); });
  mountedRoot.querySelectorAll("[data-pp-pref]").forEach((input) => input.onchange = () => { ui.snapshot.preferences[input.dataset.ppPref] = input.type === "checkbox" ? input.checked : input.value; updatePreferences(); });
  mountedRoot.querySelector("[data-pp-retry]")?.addEventListener("click", hydrate);
  mountedRoot.querySelector("[data-pp-room-mode]")?.addEventListener("change", (event) => { ui.roomMode = event.target.value === "friends" ? "friends" : "classroom"; render(); });
  mountedRoot.querySelector("[data-pp-room-game]")?.addEventListener("change", (event) => { ui.roomGameId = event.target.value; });
  mountedRoot.querySelector("[data-pp-create-room-form]")?.addEventListener("submit", (event) => { event.preventDefault(); createPrivateRoom(event.currentTarget); });
  mountedRoot.querySelector("[data-pp-join-room-form]")?.addEventListener("submit", (event) => { event.preventDefault(); joinPrivateRoom(event.currentTarget); });
  mountedRoot.querySelector("[data-pp-room-clear]")?.addEventListener("click", () => { ui.roomMessage = ""; render(); });
  mountedRoot.querySelectorAll("[data-pp-copy-room]").forEach((button) => button.onclick = async () => { try { await navigator.clipboard?.writeText(button.dataset.ppCopyRoom || ""); ui.roomMessage = `Room ${button.dataset.ppCopyRoom} code copied locally.`; } catch { ui.roomMessage = `Room code: ${button.dataset.ppCopyRoom}`; } render(); });
  mountedRoot.querySelectorAll("[data-pp-room-play]").forEach((button) => button.onclick = () => launch(button.dataset.ppRoomPlay, { roomCode: button.dataset.ppRoomCode }));
  mountedRoot.querySelectorAll("[data-pp-room-leave]").forEach((button) => button.onclick = () => leavePrivateRoom(button.dataset.ppRoomLeave));
  mountedRoot.querySelectorAll("[data-pp-room-ready]").forEach((button) => button.onclick = () => toggleRoomReady(button.dataset.ppRoomReady, button.dataset.ppReadyNext === "1"));
  mountedRoot.querySelectorAll("[data-pp-room-botfill]").forEach((input) => input.onchange = () => updateHostControls(input.dataset.ppRoomBotfill, { allowBotFill: input.checked }));
  mountedRoot.querySelectorAll("[data-pp-room-maxhumans]").forEach((input) => input.onchange = () => updateHostControls(input.dataset.ppRoomMaxhumans, { maxHumans: Number(input.value) || 1 }));
  mountedRoot.querySelectorAll("[data-pp-rating-toggle]").forEach((input) => input.onchange = () => {
    const next = [...mountedRoot.querySelectorAll("[data-pp-rating-toggle]:checked")].map((el) => el.dataset.ppRatingToggle);
    applyRatingExposure(next);
  });
  mountedRoot.querySelectorAll("[data-pp-rating-preset]").forEach((button) => button.onclick = () => applyRatingExposure(ratingExposurePreset(button.dataset.ppRatingPreset, ui.snapshot.profileType || "adult")));
  mountedRoot.querySelector("[data-pp-profile-type]")?.addEventListener("change", (event) => applyProfileType(event.target.value));
  mountedRoot.querySelector("[data-pp-guardian-save]")?.addEventListener("click", saveGuardianLock);
  mountedRoot.querySelectorAll("[data-pp-open-dev]").forEach((button) => button.onclick = () => { ui.selectedDeveloperId = button.dataset.ppOpenDev; ui.developerMessage = ""; render(); });
  mountedRoot.querySelector("[data-pp-dev-back]")?.addEventListener("click", () => { ui.selectedDeveloperId = ""; ui.developerMessage = ""; render(); });
  mountedRoot.querySelector("[data-pp-dev-message-clear]")?.addEventListener("click", () => { ui.developerMessage = ""; render(); });
  mountedRoot.querySelectorAll("[data-pp-support-dev]").forEach((button) => button.onclick = () => supportDeveloper(button.dataset.ppSupportDev));
  mountedRoot.querySelectorAll("[data-pp-donate-dev]").forEach((button) => button.onclick = () => logDeveloperDonationIntent(button.dataset.ppDonateDev));
  mountedRoot.querySelectorAll("[data-pp-save-dev-note]").forEach((button) => button.onclick = () => saveDeveloperNote(button.dataset.ppSaveDevNote, mountedRoot.querySelector("[data-pp-dev-note-text]")?.value));
  mountedRoot.querySelectorAll("[data-pp-player-close]").forEach((button) => button.addEventListener("click", closePlayer));
  const playerFrame = mountedRoot.querySelector("[data-pp-frame]");
  playerFrame?.addEventListener("load", () => {
    setTimeout(() => {
      if (mountedRoot?.querySelector("[data-pp-frame]") === playerFrame && ui.player && !ui.playerReady) {
        markPlayerReady(playerFrame, { protocol: false, focus: false });
      }
    }, 250);
  });
  mountedRoot.querySelector("[data-pp-player-pause]")?.addEventListener("click", togglePlayerPause);
  mountedRoot.querySelector("[data-pp-player-restart]")?.addEventListener("click", restartPlayer);
  mountedRoot.querySelector("[data-pp-player-fullscreen]")?.addEventListener("click", () => mountedRoot.querySelector(".pp-player-stage")?.requestFullscreen?.());
  const form = mountedRoot.querySelector("[data-pp-submit-form]");
  if (form) form.onsubmit = (event) => { event.preventDefault(); submitGame(form, event.submitter); };
  mountedRoot.querySelectorAll("[data-pp-edit-submission]").forEach((button) => button.onclick = () => { ui.editingSubmissionId = button.dataset.ppEditSubmission; render(); mountedRoot.querySelector("[data-pp-submit-form]")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  mountedRoot.querySelector("[data-pp-cancel-edit]")?.addEventListener("click", () => { ui.editingSubmissionId = null; render(); });
  mountedRoot.querySelectorAll("[data-pp-moderate]").forEach((button) => button.onclick = () => moderate(button));
  const copyProtocol = mountedRoot.querySelector("[data-pp-copy-protocol]");
  if (copyProtocol) copyProtocol.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(PROTOCOL_SNIPPET); copyProtocol.textContent = "Copied to clipboard ✓"; }
    catch { copyProtocol.textContent = "Select the snippet below and copy"; }
    setTimeout(() => { copyProtocol.textContent = "Copy protocol snippet"; }, 2200);
  });
}

export function renderPhantomPlay(root, opts = {}) {
  mountedRoot = root;
  mountedOpts = opts;
  if (!messageBound) { messageBound = true; window.addEventListener("message", onGameMessage); }
  if (!keyboardBound) {
    keyboardBound = true;
    window.addEventListener("keydown", (event) => {
      if (!ui.player) return;
      if (isEditableTarget(event)) return;
      if (event.key === "Escape") { event.preventDefault(); closePlayer(); }
      if ((event.key === "r" || event.key === "R") && !event.ctrlKey && !event.metaKey) { event.preventDefault(); restartPlayer(); }
      if (isGameControlKey(event)) { event.preventDefault(); focusGameFrame(); }
    });
  }
  if (!dragDropBound) {
    // The dedicated drop zone in devWorkbenchMarkup() only covers its own
    // small strip ([data-pp-devworkbench-drop]) — a drop landing anywhere
    // else in the modal (the textarea, the file slots, the header) had no
    // handler at all, so the browser's default action fired instead: it
    // navigates the tab to the dropped file, which blows away the whole
    // admin SPA session and looks like a crash/error to the user. This
    // window-level fallback only engages while the workbench modal is open
    // (ui.devWorkbench truthy), prevents that default navigation regardless
    // of where in the modal the drop lands, and still imports the files —
    // skipping the dedicated drop zone's own target so files dropped there
    // aren't imported twice.
    dragDropBound = true;
    window.addEventListener("dragover", (event) => { if (ui.devWorkbench) event.preventDefault(); });
    window.addEventListener("drop", (event) => {
      if (!ui.devWorkbench) return;
      event.preventDefault();
      if (event.target.closest?.("[data-pp-devworkbench-drop]")) return;
      if (event.dataTransfer?.files?.length) importDevWorkbenchFiles(event.dataTransfer.files);
    });
  }
  render();
  hydrate();
  return () => { clearInterval(playClock); stopRoomPolling(); document.body.classList.remove("phantomplay-playing"); mountedRoot = null; mountedOpts = null; };
}
