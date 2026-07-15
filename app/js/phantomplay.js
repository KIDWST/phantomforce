import {
  currentTenantId, friendlyBackendError, isAdmin, isOwnerOperator, session,
  workspaceStorageGetItem, workspaceStorageSetItem,
} from "./store.js?v=phantom-live-20260715-3";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const FALLBACK_KEY = "pf.phantomplay.offline.v1";
const DEV_SUPPORT_KEY = "pf.phantomplay.developerSupport.v1";
const CATEGORIES = ["All", "Arcade", "Puzzle", "Focus", "Strategy", "Sports", "Creative", "Kids"];
const KIDS_GAME_IDS = new Set(["reflex-grid", "rift-frenzy", "serpent-surge", "color-rush", "circuit-serpent"]);
const PHANTOMPLAY_ENGINE = {
  version: "2.0-large-map",
  saveStateBytes: 262144,
  largeMap: { chunkSize: 1024, maxLoadedChunks: 64, streaming: true },
  protocols: ["ready", "score", "progress", "complete", "paused", "exit", "settings", "save-state", "load-state", "match-action", "match-state"],
};
const PHANTOMPLAY_ART_VERSION = "phantomplay-art-20260712";
const artUrl = (file) => `/app/assets/phantomplay/${file}?v=${PHANTOMPLAY_ART_VERSION}`;
const TAK_AVATAR = artUrl("tak-avatar.webp");
const GAME_ART_BY_SLUG = {
  "neon-drift": artUrl("neon-drift-cover.webp"),
  "phantom-rumble": artUrl("kingdom-breakers-cover.svg"),
  "signal-match": artUrl("signal-match-cover.webp"),
  "focus-stack": artUrl("focus-stack-cover.webp"),
  "word-weld": artUrl("word-weld-cover.webp"),
  "reflex-grid": artUrl("reflex-grid-cover.webp"),
  "penalty-kick": artUrl("penalty-kick-cover.webp"),
  "rift-frenzy": artUrl("neon-drift-cover.webp"),
  "serpent-surge": artUrl("reflex-grid-cover.webp"),
  "crown-circuit": artUrl("reflex-grid-cover.webp"),
};
const CATEGORY_ART = {
  Arcade: GAME_ART_BY_SLUG["neon-drift"],
  Puzzle: GAME_ART_BY_SLUG["signal-match"],
  Focus: GAME_ART_BY_SLUG["focus-stack"],
  Strategy: GAME_ART_BY_SLUG["reflex-grid"],
  Sports: GAME_ART_BY_SLUG["penalty-kick"],
  Creative: GAME_ART_BY_SLUG["word-weld"],
};
const BUILT_INS = [
  { id: "neon-drift", title: "Neon Drift", summary: "Auto-fire spaceship shooter with waves, powerups, and shield saves.", description: "A real arcade shooter: fly fast, fire nonstop, collect rapid fire, spread shot, shield, magnet, and repair powerups, then push deeper into harder waves.", category: "Arcade", tags: ["shooter", "powerups", "arcade", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/neon-drift.html?v=1.3.0", thumbnail: GAME_ART_BY_SLUG["neon-drift"], featured: true, version: "1.3.0", controls: "WASD/arrow keys to fly. Auto-fire is always on.", progressSupport: true, scoreSupport: true, engine: { tier: "arcade-large-map", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "phantom-rumble", title: "Phantom Rumble", summary: "A premium local platform fighter with guard, parry, dodge, ledge-save recovery, bots, drops, and touch controls.", description: "A full PhantomPlay platform fighter: up to four players or bots brawl across a dynamic arena with percent knockback, double jumps, charge smashes, Phantom Burst, guard/parry, dodge, ledge-save recovery, camera focus, and reality-bending drops. Local keyboard and mobile touch play are both supported without external networking.", category: "Arcade", tags: ["platform fighter", "multiplayer", "action", "local", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/phantom-rumble.html?v=2.2.3", thumbnail: GAME_ART_BY_SLUG["phantom-rumble"], featured: true, version: "2.2.3", controls: "P1: WASD, Shift guard, Q dodge, Space tap/hold. P2: arrows, I guard, O dodge, Enter tap/hold. Touch controls on mobile.", progressSupport: true, scoreSupport: true, localMultiplayer: true, minPlayers: 1, maxPlayers: 4, engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "signal-match", title: "Signal Match", summary: "Find every matching signal with the fewest turns.", description: "A responsive memory grid with clear score, feedback, pause, restart, touch, and keyboard support.", category: "Puzzle", tags: ["memory", "calm", "puzzle"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/signal-match.html?v=1.1.1", thumbnail: GAME_ART_BY_SLUG["signal-match"], featured: true, version: "1.1.1", controls: "Click, tap, or use Tab + Enter", progressSupport: true, scoreSupport: true },
  { id: "focus-stack", title: "Focus Stack", summary: "Drop each layer cleanly and build the tallest signal tower.", description: "A focused timing run with a visible score, proper start, pause, restart, and resize-safe play field.", category: "Focus", tags: ["timing", "focus", "quick"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/focus-stack.html?v=1.1.1", thumbnail: GAME_ART_BY_SLUG["focus-stack"], featured: false, version: "1.1.1", controls: "Space, Enter, click, or tap", progressSupport: true, scoreSupport: true },
  { id: "word-weld", title: "Word Weld", summary: "Build as many words as you can from one shifting signal rack.", description: "A quick word-building game with tap, keyboard, score, timer, and clean reset controls.", category: "Creative", tags: ["word", "creative", "quick", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/word-weld.html?v=1.0.0", thumbnail: GAME_ART_BY_SLUG["word-weld"], featured: true, version: "1.0.0", controls: "Keyboard, tap letters, Enter to submit", progressSupport: true, scoreSupport: true },
  { id: "reflex-grid", title: "Reflex Grid", summary: "Hit the live cells before the grid burns out.", description: "A fast aim-and-reaction grid for short focus breaks, with mistakes, streaks, and a real finish.", category: "Kids", tags: ["reaction", "strategy", "touch", "aim", "kids"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/reflex-grid.html?v=1.0.0", thumbnail: GAME_ART_BY_SLUG["reflex-grid"], featured: false, version: "1.0.0", controls: "Click, tap, or use number keys", progressSupport: true, scoreSupport: true },
  { id: "penalty-kick", title: "Penalty Kick", summary: "Pick your lane, hit the green zone, and beat the keeper.", description: "A readable, touch-friendly sports timing game with five shots, tap-to-aim lanes, visible timing feedback, keeper reads, and a clean final whistle.", category: "Sports", tags: ["sports", "timing", "soccer", "touch"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/penalty-kick.html?v=1.0.3", thumbnail: GAME_ART_BY_SLUG["penalty-kick"], featured: false, version: "1.0.3", controls: "Tap a lane or use arrows. Shoot when the meter says LOCKED.", progressSupport: true, scoreSupport: true, active: false },
  { id: "rift-frenzy", title: "Rift Frenzy", summary: "Grow from reef bait to apex hunter in a neon multiplayer-style fish arena.", description: "A modern eat-smaller-fish arena with rival schools, growth stages, boost windows, danger reads, and touch-friendly movement. It feels like a live arena even when running as a safe built-in sandbox.", category: "Kids", tags: ["fish", "arena", "growth", "io", "touch", "kids"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/rift-frenzy.html?v=1.0.4", thumbnail: GAME_ART_BY_SLUG["rift-frenzy"], featured: false, version: "1.0.4", controls: "Move with WASD/arrow keys or touch-drag. Eat smaller fish, avoid bigger rivals, boost with Space.", progressSupport: true, scoreSupport: true, engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "serpent-surge", title: "Serpent Surge", summary: "A fast snake arena with rivals, pickups, cutoffs, boost trails, and storm pressure.", description: "A PhantomPlay take on snake arena games: orbit energy, grow long, bait rival serpents, use boost carefully, and survive a closing storm ring without any external networking.", category: "Kids", tags: ["snake", "arena", "io", "survival", "touch", "kids"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/serpent-surge.html?v=1.0.4", thumbnail: GAME_ART_BY_SLUG["serpent-surge"], featured: false, version: "1.0.4", controls: "Steer with mouse, touch, WASD, or arrows. Hold Space or touch pressure to boost.", progressSupport: true, scoreSupport: true, engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version } },
  { id: "crown-circuit", title: "Crown Circuit", summary: "A two-player-only lane card battle with towers, elixir, counters, and sudden death.", description: "A strictly multiplayer tower duel: two players draft from four unit cards, spend elixir, choose lanes, break towers, and win the crown. No solo mode, no bots, no fake opponents - local keyboard duels or PhantomPlay private rooms only.", category: "Strategy", tags: ["multiplayer-only", "tower duel", "cards", "lanes", "keyboard", "rooms"], contentRating: "everyone", developer: "Tak", developerAvatar: TAK_AVATAR, kind: "built_in", launchUrl: "/app/games/crown-circuit.html?v=1.0.0", thumbnail: GAME_ART_BY_SLUG["crown-circuit"], featured: true, version: "1.0.0", controls: "Local: P1 uses 1-4 then Q/W/E. P2 uses 7-0 then I/O/P. Online: create a PhantomPlay room, join with two players, then launch.", progressSupport: false, scoreSupport: true, multiplayerOnly: true, localMultiplayer: true, onlineMultiplayer: true, minPlayers: 2, maxPlayers: 2, engine: { tier: "arena-multiplayer-relay", minVersion: PHANTOMPLAY_ENGINE.version } },
];

const ui = {
  tab: "home",
  loading: true,
  error: "",
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
  settingsOpen: false,
  editingSubmissionId: null,
  selectedDeveloperId: "",
  developerMessage: "",
};

let mountedRoot = null;
let mountedOpts = null;
let playClock = null;
let matchClock = null;
let playTickAt = 0;
let messageBound = false;
let keyboardBound = false;
let playerClosing = false;

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

function firstPresent(...values) {
  return values.find((value) => String(value ?? "").trim()) ?? "";
}

function stableKeyPart(value) {
  const text = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  let hash = 0;
  for (const char of text) hash = ((hash * 31) + (char.codePointAt(0) || 0)) >>> 0;
  return `${slugifyDeveloper(text)}-${hash.toString(36)}`;
}

function genericDeveloperName(value) {
  const name = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  return !name || name === "developer" || name === "phantom labs";
}

function developerIdentityFor(game) {
  const displayName = developerNameFor(game);
  if (game?.kind === "built_in" || displayName.toLowerCase() === "tak") return { id: "developer:tak", name: "Tak" };
  const explicitId = firstPresent(game?.developerId, game?.developer_id, game?.ownerId, game?.owner_id, game?.accountId, game?.authorId, game?.submittedById);
  if (explicitId) return { id: `developer:${stableKeyPart(explicitId)}`, name: displayName };
  const gameIdentity = firstPresent(game?.id, game?.submissionId, game?.title, displayName);
  if (game?.kind === "community" || genericDeveloperName(displayName)) return { id: `community:${stableKeyPart(gameIdentity)}`, name: displayName };
  return { id: `developer:${stableKeyPart(displayName)}`, name: displayName };
}

function normalizeGame(game) {
  const developer = developerNameFor(game);
  return {
    ...game,
    developer,
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
  if (!response.ok) throw new Error(friendlyBackendError(response.status, payload?.error, { authMessage: "Sign in to sync PhantomPlay.", fallbackPrefix: "PhantomPlay request failed" }));
  return payload;
}

function offlineState() {
  let saved = {};
  try { saved = JSON.parse(workspaceStorageGetItem(FALLBACK_KEY) || "{}"); } catch {}
  return {
    tenantId: currentTenantId(),
    actorId: "offline",
    access: { enabled: true, reason: "offline_built_ins", dailyMinuteLimit: 60, usedMinutesToday: 0, remainingMinutesToday: 60, canSubmitGames: false, canModerate: false },
    catalog: BUILT_INS.filter((game) => game.active !== false).map(normalizeGame),
    favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
    history: Array.isArray(saved.history) ? saved.history : [],
    preferences: { contentRating: "teen", sound: saved.sound !== false, reducedMotion: !!saved.reducedMotion, allowCommunityGames: true },
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
  render();
  try {
    const payload = await api(`/api/phantomplay?tenant_id=${encodeURIComponent(currentTenantId())}`);
    ui.snapshot = normalizeSnapshot(payload);
    ui.offline = false;
  } catch (error) {
    ui.snapshot = normalizeSnapshot(offlineState());
    ui.offline = true;
    ui.error = error instanceof Error ? error.message : "PhantomPlay sync is unavailable.";
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

function isKidsGame(game) {
  return game?.category === "Kids" || KIDS_GAME_IDS.has(game?.id);
}

function visibleByCategory(game) {
  return ui.category === "Kids" ? isKidsGame(game) : ui.category === "All" ? !isKidsGame(game) : game.category === ui.category && !isKidsGame(game);
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
    const { id, name } = developerIdentityFor(game);
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

function gameCard(game, variant = "") {
  const favorite = ui.snapshot.favorites.includes(game.id);
  const history = historyFor(game.id);
  const developerAvatar = developerAvatarFor(game);
  const developer = developerNameFor(game);
  const thumbnail = thumbnailFor(game);
  return `<article class="pp-game ${variant}" data-pp-game-card="${esc(game.id)}">
    <div class="pp-game-art"><img src="${esc(thumbnail)}" alt="" loading="lazy"/><span>${esc(game.category)}</span>${game.kind === "community" ? "<em>Prototype</em>" : ""}</div>
    <div class="pp-game-body"><div class="pp-game-title"><p class="pp-game-developer">${developerAvatar ? `<img src="${esc(developerAvatar)}" alt="" loading="lazy"/>` : ""}<span>By ${esc(developer)}</span></p><h3>${esc(game.title)}</h3></div><button type="button" class="pp-favorite ${favorite ? "is-on" : ""}" data-pp-favorite="${esc(game.id)}" aria-label="${favorite ? "Remove from" : "Add to"} favorites">${icon("heart")}</button>
    <p>${esc(game.summary)}</p>
    <div class="pp-game-meta"><span>${esc(game.contentRating === "everyone" ? "Everyone" : game.contentRating)}</span><span>v${esc(game.version)}</span>${history?.score != null ? `<span>Best ${history.score}</span>` : ""}</div>
    ${history?.canContinue ? `<div class="pp-progress"><i style="width:${Math.max(3, Math.min(100, history.progress))}%"></i></div>` : ""}
    <button class="pp-play" type="button" data-pp-play="${esc(game.id)}">${icon("play")} ${history?.canContinue ? "Continue" : "Play now"}</button></div>
  </article>`;
}

function empty(title, copy) {
  return `<div class="pp-empty"><span>${icon("game")}</span><h3>${esc(title)}</h3><p>${esc(copy)}</p></div>`;
}

function gameRows(games, title, copy = "") {
  return `<section class="pp-section"><div class="pp-section-head"><div><h2>${esc(title)}</h2>${copy ? `<p>${esc(copy)}</p>` : ""}</div>${games.length > 3 ? `<button type="button" data-pp-tab="library">View all</button>` : ""}</div>${games.length ? `<div class="pp-game-grid">${games.map((game) => gameCard(game)).join("")}</div>` : empty(`No ${title.toLowerCase()} yet`, "Games will appear here when there is something real to show.")}</section>`;
}

function renderHome() {
  const visibleCatalog = ui.snapshot.catalog.filter((game) => !isKidsGame(game));
  const featured = visibleCatalog.filter((game) => game.featured);
  const recent = ui.snapshot.history.map((item) => visibleCatalog.find((game) => game.id === item.gameId)).filter(Boolean).slice(0, 4);
  const continuing = ui.snapshot.history.filter((item) => item.canContinue).map((item) => visibleCatalog.find((game) => game.id === item.gameId)).filter(Boolean).slice(0, 4);
  const community = ui.snapshot.catalog.filter((game) => game.kind === "community").slice(0, 4);
  const activeGameId = featured[0]?.id || visibleCatalog[0]?.id || "";
  return `<div class="pp-home">
    <section class="pp-hero">
      <div class="pp-console-copy">
        <p class="pp-kicker">GAME SANDBOX</p>
        <h1>Build, playtest, and tune games here.</h1>
        <p>PhantomPlay is not a marketplace. It is a sandbox where indie devs make playable builds, invite feedback, test with people, and export when the game is ready.</p>
        <div class="pp-console-actions">
          <button class="pp-primary" data-pp-play="${esc(activeGameId)}">${icon("play")} Run quick session</button>
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
    ${gameRows(community, "Shared prototypes", "Reviewed builds from developers appear here when they are safe to test.")}
    <section class="pp-spotlight"><img src="${esc(TAK_AVATAR)}" alt=""/><div><p class="pp-kicker">DEVELOPER SPOTLIGHT</p><h2>${esc(ui.snapshot.developerSpotlight)}</h2><p>PhantomPlay is for creators who want a private build room, playtest feedback, version notes, and a clean path to ship later.</p><button class="pp-secondary" data-pp-tab="developer">Open Developers</button></div></section>
  </div>`;
}

function filteredCatalog() {
  const query = ui.query.toLowerCase();
  return ui.snapshot.catalog.filter((game) => visibleByCategory(game) && (!query || `${game.title} ${game.summary} ${developerNameFor(game)} ${game.tags.join(" ")}`.toLowerCase().includes(query)));
}

function renderLibrary() {
  const games = filteredCatalog();
  return `<section class="pp-library"><div class="pp-library-tools"><label>${icon("search")}<input type="search" data-pp-search value="${esc(ui.query)}" placeholder="Search playable builds, categories, builders…"/></label><div class="pp-categories">${CATEGORIES.map((category) => `<button type="button" class="${ui.category === category ? "is-active" : ""}" data-pp-category="${esc(category)}">${esc(category)}</button>`).join("")}</div></div>${games.length ? `<div class="pp-game-grid pp-game-grid-full">${games.map((game) => gameCard(game)).join("")}</div>` : empty("No matching builds", "Try a different search or category.")}</section>`;
}

function renderFavorites() {
  const games = ui.snapshot.catalog.filter((game) => ui.snapshot.favorites.includes(game.id) && !isKidsGame(game));
  return games.length ? `<div class="pp-game-grid pp-game-grid-full">${games.map((game) => gameCard(game)).join("")}</div>` : empty("No favorites yet", "Tap the heart on any game to save it here.");
}

function roomRoster(room) {
  const participants = Array.isArray(room.participants) ? room.participants : [];
  return participants.length ? participants.map((participant) => `<span class="${participant.status === "online" ? "is-online" : ""}"><b>${esc(participant.label || "Player")}</b><i>${esc(participant.role === "host" ? "host" : participant.status)}</i></span>`).join("") : "<em>No players joined yet.</em>";
}

function roomCard(room) {
  return `<article class="pp-room-card pp-room-live">
    <header><div><p class="pp-kicker">${room.mode === "classroom" ? "CLASSROOM ROOM" : "FRIENDS ROOM"}</p><h3>${esc(room.gameTitle)}</h3></div><strong>${esc(room.code)}</strong></header>
    <p>Workspace-only room. Share the short code with people who are signed into the same workspace.</p>
    <div class="pp-room-roster">${roomRoster(room)}</div>
    <div class="pp-room-actions"><button type="button" class="pp-primary" data-pp-room-play="${esc(room.gameId)}" data-pp-room-code="${esc(room.code)}">${icon("play")} Launch game</button><button type="button" class="pp-secondary" data-pp-copy-room="${esc(room.code)}">Copy code</button><button type="button" class="pp-secondary" data-pp-room-leave="${esc(room.code)}">Leave</button></div>
  </article>`;
}

function renderTogether() {
  const rooms = Array.isArray(ui.snapshot.rooms) ? ui.snapshot.rooms : [];
  const classroomGames = ui.snapshot.catalog.filter((game) => ui.roomMode === "classroom" ? game.contentRating === "everyone" : !isKidsGame(game));
  const selectedGameId = classroomGames.some((game) => game.id === ui.roomGameId) ? ui.roomGameId : (classroomGames[0]?.id || "");
  return `<div class="pp-together" data-pp-private-rooms>
    <section class="pp-room-hero">
      <div><p class="pp-kicker">MULTIPLAYER</p><h2>Play together with friends in this workspace.</h2><p>Create a private room, invite a few friends with a short-lived join code, and jump into a real match together. Built-in games keep their no-internet rule; the app only relays room membership and progress state.</p></div>
      <div class="pp-room-principles"><span>No public discovery</span><span>No direct inbound device ports</span><span>No room chat or voice</span><span>Same workspace only</span></div>
    </section>
    <section class="pp-room-layout">
      <form class="pp-room-card" data-pp-create-room-form>
        <header><div><p class="pp-kicker">CREATE</p><h3>Start a private room</h3></div><span>${ui.offline ? "Server needed" : "Ready"}</span></header>
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
      <div><p class="pp-kicker">SAFE BY DEFAULT</p><h3>Private rooms, workspace-only.</h3><p>Short join codes, no public discovery, classroom mode restricts to Everyone-rated games automatically, and every built-in game still makes zero external network calls of its own — the app relays room and progress state, nothing more.</p></div>
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
      <div><p class="pp-kicker">DEVELOPER</p><h3>${esc(developer.name)}</h3><span>${developer.games.length} playable build${developer.games.length === 1 ? "" : "s"}</span></div>
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
      <button type="button" class="pp-secondary pp-dev-back" data-pp-dev-back>← Developers</button>
      <header>
        <img src="${esc(developer.avatar || TAK_AVATAR)}" alt="" loading="lazy"/>
        <div><p class="pp-kicker">DEVELOPER PROFILE</p><h2>${esc(developer.name)}</h2><span>${developer.games.length} playable build${developer.games.length === 1 ? "" : "s"} · ${developer.categories.join(" / ") || "PhantomPlay"}</span></div>
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
      <div><p class="pp-kicker">DEVELOPERS</p><h2>Browse the people building PhantomPlay games.</h2><p>Open developer profiles, test playable prototypes, leave private notes, track versions, and decide what is ready to support or share. PhantomPlay is where the game gets sharper before it goes anywhere public.</p></div>
      <ul><li>Dev score is based on build quality signals</li><li>Profiles show reviewed playable prototypes</li><li>Support and collaboration intent stay local</li><li>No public payments or public profiles</li></ul>
    </section>
    <section class="pp-dev-directory">
      <div class="pp-section-head"><div><h2>Developers</h2><p>Ranked by build quality, playtest history, and lab-ready prototypes.</p></div><span>${developers.length} developer${developers.length === 1 ? "" : "s"}</span></div>
      ${developers.length ? `<div class="pp-dev-list">${developers.map(developerCard).join("")}</div>` : empty("No developers yet", "Reviewed builds will create developer profiles automatically.")}
    </section>
  </div>`;
}

function renderAdmin() {
  if (!ui.snapshot.access.canModerate) return empty("Moderation is protected", "Platform admin access is required.");
  return `<section class="pp-admin"><div class="pp-section-head"><div><h2>Sandbox safety review</h2><p>Approve only playable builds that pass the PhantomPlay security, content, and quality checklist.</p></div><span>${ui.snapshot.submissions.length} builds</span></div><div class="pp-submission-list">${ui.snapshot.submissions.length ? ui.snapshot.submissions.map((item) => submissionCard(item, true)).join("") : empty("Queue clear", "No developer builds are waiting.")}</div></section>`;
}

function settingsMarkup() {
  const p = ui.snapshot.preferences;
  return `<aside class="pp-settings ${ui.settingsOpen ? "is-open" : ""}" ${ui.settingsOpen ? "" : "hidden"}><header><div><p class="pp-kicker">PLAY SETTINGS</p><h2>Your break, your limits.</h2></div><button data-pp-settings-close aria-label="Close settings">×</button></header><label>Content allowed<select data-pp-pref="contentRating"><option value="everyone" ${p.contentRating === "everyone" ? "selected" : ""}>Everyone</option><option value="teen" ${p.contentRating === "teen" ? "selected" : ""}>Teen</option><option value="mature" ${p.contentRating === "mature" ? "selected" : ""}>Mature</option></select></label><label class="pp-switch"><input type="checkbox" data-pp-pref="sound" ${p.sound ? "checked" : ""}/><span></span>Sound</label><label class="pp-switch"><input type="checkbox" data-pp-pref="reducedMotion" ${p.reducedMotion ? "checked" : ""}/><span></span>Reduce motion</label><label class="pp-switch"><input type="checkbox" data-pp-pref="allowCommunityGames" ${p.allowCommunityGames ? "checked" : ""}/><span></span>Show reviewed prototypes</label><p>PhantomPlay never changes your work, agents, files, or business data while you play.</p></aside>`;
}

function engineFor(game) {
  return { ...PHANTOMPLAY_ENGINE, ...(ui.snapshot?.engine || {}), game: game?.engine || { tier: "standard", minVersion: PHANTOMPLAY_ENGINE.version } };
}

function playerMarkup() {
  if (!ui.player) return "";
  const { game, play } = ui.player;
  const engine = engineFor(game);
  const roomCode = ui.player.room?.code || "";
  return `<div class="pp-player" role="dialog" aria-modal="true" aria-label="Playing ${esc(game.title)}"><header><div><img src="${esc(thumbnailFor(game))}" alt=""/><span><b>${esc(game.title)}</b><i>${esc(game.controls)}</i></span></div><div class="pp-player-actions"><button data-pp-player-restart title="Restart game">Restart</button><button data-pp-player-pause title="Pause game">${ui.playerPaused ? "Resume" : "Pause"}</button><button data-pp-player-fullscreen title="Full screen">Full screen</button><button data-pp-player-close aria-label="Close game">×</button></div></header><div class="pp-player-stage"><button class="pp-player-exit" data-pp-player-close type="button" aria-label="Exit game">Exit</button><div class="pp-player-loading" ${ui.playerReady ? "hidden" : ""}><i></i><b>Loading ${esc(game.title)}…</b><span>${roomCode ? `Joining room ${esc(roomCode)}.` : "The game is opening in a private sandbox."}</span></div><iframe src="${esc(game.launchUrl)}" title="${esc(game.title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" allow="fullscreen" tabindex="0" data-pp-frame></iframe></div><footer><span>${roomCode ? `Room <b>${esc(roomCode)}</b>` : `Session <b>${esc(play.id.slice(-8))}</b>`}</span><span data-pp-live-score>Score —</span><span data-pp-live-state>${ui.playerPaused ? "Paused" : "Playing"}</span><span>Engine ${esc(engine.version)}</span><span>${game.multiplayerOnly ? "Multiplayer only" : "Progress saves automatically"}</span></footer></div>`;
}

function render() {
  if (!mountedRoot) return;
  document.body.classList.toggle("phantomplay-playing", !!ui.player);
  if (ui.loading && !ui.snapshot) {
    mountedRoot.innerHTML = `<div class="pp-loading"><i></i><b>Opening PhantomPlay</b><span>Loading your library and saved progress…</span></div>`;
    return;
  }
  const snapshot = ui.snapshot || offlineState();
  const tabs = [["home", "Sandbox"], ["library", "Play Lab"], ["together", "Multiplayer"], ["favorites", "Saved"], ["developer", "Developers"], ...(snapshot.access.canModerate ? [["admin", "Safety Review"]] : [])];
  const content = ui.tab === "library" ? renderLibrary() : ui.tab === "together" ? renderTogether() : ui.tab === "favorites" ? renderFavorites() : ui.tab === "developer" ? renderDeveloper() : ui.tab === "admin" ? renderAdmin() : renderHome();
  mountedRoot.innerHTML = `<div class="pp-shell">
    <header class="pp-top"><div><p class="pp-kicker">PHANTOMFORCE GAME SANDBOX</p><h1>PhantomPlay</h1><span>Play, build, test, and return to work sharper.</span></div><div><span class="pp-access ${snapshot.access.enabled ? "is-ready" : "is-blocked"}">${snapshot.access.enabled ? esc(playTimeLabel(snapshot.access.remainingMinutesToday)) : "Plan restricted"}</span><button class="pp-settings-button" data-pp-settings aria-label="Play settings">${icon("settings")}</button></div></header>
    ${ui.offline ? `<div class="pp-banner is-offline"><b>Offline mode</b><span>Built-in games still work. Favorites and progress will sync after the server returns.</span><button data-pp-retry>Retry</button></div>` : ""}
    ${ui.error && !ui.offline ? `<div class="pp-banner is-error"><b>PhantomPlay needs attention</b><span>${esc(ui.error)}</span><button data-pp-retry>Retry</button></div>` : ""}
    <nav class="pp-tabs" aria-label="PhantomPlay sections">${tabs.map(([id, label]) => `<button type="button" class="${ui.tab === id ? "is-active" : ""}" data-pp-tab="${id}">${esc(label)}</button>`).join("")}</nav>
    <main class="pp-content">${snapshot.access.enabled ? content : empty("PhantomPlay is unavailable", "Ask your business owner to enable PhantomPlay for this plan.")}</main>
    ${settingsMarkup()}${playerMarkup()}
  </div>`;
  bind();
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

function offlinePlay(game) {
  const play = { id: `offline-${Date.now()}`, gameId: game.id, startedAt: new Date().toISOString(), seconds: 0, score: null, progress: historyFor(game.id)?.progress || 0 };
  return { game, play };
}

async function launch(gameId, roomCode = "") {
  if (!gameId) return;
  const game = ui.snapshot.catalog.find((item) => item.id === gameId);
  if (!game?.launchUrl) { ui.error = "This game is not available to play yet."; render(); return; }
  try {
    const result = ui.offline ? offlinePlay(game) : await api("/api/phantomplay/plays", { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), gameId }) });
    const room = roomCode ? (ui.snapshot.rooms || []).find((item) => item.code === roomCode) || { code: roomCode, gameId } : null;
    ui.player = { game: result.game || game, play: result.play, room };
    ui.playerReady = false;
    ui.playerPaused = false;
    playTickAt = Date.now();
    render();
    startClock();
    startMatchPolling();
  } catch (error) { ui.error = error.message; render(); }
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
    await hydrate();
  } catch (error) {
    ui.roomMessage = `Blocked: ${error.message}`;
    render();
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
    await hydrate();
  } catch (error) {
    ui.roomMessage = `Blocked: ${error.message}`;
    render();
  } finally {
    ui.roomBusy = false;
    render();
  }
}

async function leavePrivateRoom(code) {
  try {
    await api(`/api/phantomplay/rooms/${encodeURIComponent(code)}/leave`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId() }) });
    ui.roomMessage = `Left room ${code}.`;
    await hydrate();
  } catch (error) {
    ui.roomMessage = `Blocked: ${error.message}`;
    render();
  }
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
  postToGame("exit", { focus: false });
  if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => undefined);
  clearInterval(playClock);
  clearInterval(matchClock);
  await persistPlay(true);
  ui.player = null;
  ui.playerReady = false;
  ui.playerPaused = false;
  document.body.classList.remove("phantomplay-playing");
  playerClosing = false;
  render();
}

function postToGame(type, options = {}) {
  const frame = mountedRoot?.querySelector("[data-pp-frame]");
  frame?.contentWindow?.postMessage({ source: "phantomplay-host", type, engine: ui.player ? engineFor(ui.player.game) : PHANTOMPLAY_ENGINE }, "*");
  if (options.focus !== false) frame?.focus?.({ preventScroll: true });
}

function postSettingsToGame() {
  const frame = mountedRoot?.querySelector("[data-pp-frame]");
  if (!frame || !ui.player) return;
  frame.contentWindow?.postMessage({
    source: "phantomplay-host",
    type: "settings",
    sound: ui.snapshot.preferences.sound,
    reducedMotion: ui.snapshot.preferences.reducedMotion,
    engine: engineFor(ui.player.game),
    actorId: ui.snapshot.actorId,
    room: ui.player.room || null,
  }, "*");
}

async function pollMatchState() {
  const code = ui.player?.room?.code;
  if (!code || ui.offline) return;
  try {
    const payload = await api(`/api/phantomplay/rooms/${encodeURIComponent(code)}?tenant_id=${encodeURIComponent(currentTenantId())}`);
    if (payload.room) {
      ui.player.room = payload.room;
      const frame = mountedRoot?.querySelector("[data-pp-frame]");
      frame?.contentWindow?.postMessage({ source: "phantomplay-host", type: "match-state", room: payload.room, match: payload.room.match || null, actorId: ui.snapshot.actorId }, "*");
    }
  } catch {}
}

function startMatchPolling() {
  clearInterval(matchClock);
  if (!ui.player?.room?.code) return;
  pollMatchState();
  matchClock = setInterval(pollMatchState, 900);
}

async function sendMatchAction(action = {}) {
  const code = ui.player?.room?.code;
  if (!code || ui.offline) return;
  try {
    const payload = await api(`/api/phantomplay/rooms/${encodeURIComponent(code)}/match`, {
      method: "POST",
      body: JSON.stringify({ tenantId: currentTenantId(), gameId: ui.player.game.id, action }),
    });
    if (payload.room) {
      ui.player.room = payload.room;
      const frame = mountedRoot?.querySelector("[data-pp-frame]");
      frame?.contentWindow?.postMessage({ source: "phantomplay-host", type: "match-state", room: payload.room, match: payload.room.match || null, actorId: ui.snapshot.actorId }, "*");
    }
  } catch (error) {
    ui.error = error.message;
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
  postToGame("restart");
  const pauseButton = mountedRoot?.querySelector("[data-pp-player-pause]");
  if (pauseButton) pauseButton.textContent = "Pause";
  const score = mountedRoot?.querySelector("[data-pp-live-score]");
  if (score) score.textContent = "Score 0";
  const state = mountedRoot?.querySelector("[data-pp-live-state]");
  if (state) state.textContent = "Playing";
}

function onGameMessage(event) {
  const frame = mountedRoot?.querySelector("[data-pp-frame]");
  if (!ui.player || !frame || event.source !== frame.contentWindow || !event.data || event.data.source !== "phantomplay-game") return;
  if (event.data.type === "exit") {
    closePlayer();
    return;
  }
  if (event.data.type === "ready") {
    ui.playerReady = true;
    mountedRoot.querySelector(".pp-player-loading")?.setAttribute("hidden", "");
    postSettingsToGame();
    frame.focus?.({ preventScroll: true });
  }
  if (event.data.type === "match-action") {
    sendMatchAction(event.data.action || {});
  }
  if (event.data.type === "paused") {
    ui.playerPaused = !!event.data.paused;
    const pauseButton = mountedRoot.querySelector("[data-pp-player-pause]");
    if (pauseButton) pauseButton.textContent = ui.playerPaused ? "Resume" : "Pause";
    const state = mountedRoot.querySelector("[data-pp-live-state]");
    if (state) state.textContent = ui.playerPaused ? "Paused" : "Playing";
  }
  if (event.data.type === "score" || event.data.type === "progress" || event.data.type === "complete") {
    const scoreValue = Number(event.data.score);
    const progressValue = Number(event.data.progress);
    const detail = { score: Number.isFinite(scoreValue) ? scoreValue : undefined, progress: event.data.type === "complete" ? 100 : Number.isFinite(progressValue) ? progressValue : undefined, state: event.data.state };
    const score = mountedRoot.querySelector("[data-pp-live-score]");
    if (score && detail.score !== undefined) score.textContent = `Score ${detail.score}`;
    persistPlay(event.data.type === "complete", detail);
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
  mountedRoot.querySelectorAll("[data-pp-tab]").forEach((button) => button.onclick = () => {
    ui.selectedDeveloperId = "";
    ui.developerMessage = "";
    ui.tab = button.dataset.ppTab;
    render();
  });
  mountedRoot.querySelectorAll("[data-pp-play]").forEach((button) => button.onclick = () => launch(button.dataset.ppPlay));
  mountedRoot.querySelectorAll("[data-pp-favorite]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); updateFavorite(button.dataset.ppFavorite); });
  mountedRoot.querySelectorAll("[data-pp-category]").forEach((button) => button.onclick = () => { ui.category = button.dataset.ppCategory; render(); });
  mountedRoot.querySelector("[data-pp-search]")?.addEventListener("input", (event) => { ui.query = event.target.value; const list = mountedRoot.querySelector(".pp-game-grid-full"); if (list) list.innerHTML = filteredCatalog().map((game) => gameCard(game)).join("") || empty("No matching builds", "Try a different search or category."); bind(); });
  mountedRoot.querySelector("[data-pp-settings]")?.addEventListener("click", () => { ui.settingsOpen = true; render(); });
  mountedRoot.querySelector("[data-pp-settings-close]")?.addEventListener("click", () => { ui.settingsOpen = false; render(); });
  mountedRoot.querySelectorAll("[data-pp-pref]").forEach((input) => input.onchange = () => { ui.snapshot.preferences[input.dataset.ppPref] = input.type === "checkbox" ? input.checked : input.value; updatePreferences(); });
  mountedRoot.querySelector("[data-pp-retry]")?.addEventListener("click", hydrate);
  mountedRoot.querySelector("[data-pp-room-mode]")?.addEventListener("change", (event) => { ui.roomMode = event.target.value === "friends" ? "friends" : "classroom"; render(); });
  mountedRoot.querySelector("[data-pp-room-game]")?.addEventListener("change", (event) => { ui.roomGameId = event.target.value; });
  mountedRoot.querySelector("[data-pp-create-room-form]")?.addEventListener("submit", (event) => { event.preventDefault(); createPrivateRoom(event.currentTarget); });
  mountedRoot.querySelector("[data-pp-join-room-form]")?.addEventListener("submit", (event) => { event.preventDefault(); joinPrivateRoom(event.currentTarget); });
  mountedRoot.querySelector("[data-pp-room-clear]")?.addEventListener("click", () => { ui.roomMessage = ""; render(); });
  mountedRoot.querySelectorAll("[data-pp-copy-room]").forEach((button) => button.onclick = async () => { try { await navigator.clipboard?.writeText(button.dataset.ppCopyRoom || ""); ui.roomMessage = `Room ${button.dataset.ppCopyRoom} code copied locally.`; } catch { ui.roomMessage = `Room code: ${button.dataset.ppCopyRoom}`; } render(); });
  mountedRoot.querySelectorAll("[data-pp-room-play]").forEach((button) => button.onclick = () => launch(button.dataset.ppRoomPlay, button.dataset.ppRoomCode || ""));
  mountedRoot.querySelectorAll("[data-pp-room-leave]").forEach((button) => button.onclick = () => leavePrivateRoom(button.dataset.ppRoomLeave));
  mountedRoot.querySelectorAll("[data-pp-open-dev]").forEach((button) => button.onclick = () => { ui.selectedDeveloperId = button.dataset.ppOpenDev; ui.developerMessage = ""; render(); });
  mountedRoot.querySelector("[data-pp-dev-back]")?.addEventListener("click", () => { ui.selectedDeveloperId = ""; ui.developerMessage = ""; render(); });
  mountedRoot.querySelector("[data-pp-dev-message-clear]")?.addEventListener("click", () => { ui.developerMessage = ""; render(); });
  mountedRoot.querySelectorAll("[data-pp-support-dev]").forEach((button) => button.onclick = () => supportDeveloper(button.dataset.ppSupportDev));
  mountedRoot.querySelectorAll("[data-pp-donate-dev]").forEach((button) => button.onclick = () => logDeveloperDonationIntent(button.dataset.ppDonateDev));
  mountedRoot.querySelectorAll("[data-pp-save-dev-note]").forEach((button) => button.onclick = () => saveDeveloperNote(button.dataset.ppSaveDevNote, mountedRoot.querySelector("[data-pp-dev-note-text]")?.value));
  mountedRoot.querySelectorAll("[data-pp-player-close]").forEach((button) => button.addEventListener("click", closePlayer));
  mountedRoot.querySelector("[data-pp-player-pause]")?.addEventListener("click", togglePlayerPause);
  mountedRoot.querySelector("[data-pp-player-restart]")?.addEventListener("click", restartPlayer);
  mountedRoot.querySelector("[data-pp-player-fullscreen]")?.addEventListener("click", () => mountedRoot.querySelector(".pp-player-stage")?.requestFullscreen?.());
  const form = mountedRoot.querySelector("[data-pp-submit-form]");
  if (form) form.onsubmit = (event) => { event.preventDefault(); submitGame(form, event.submitter); };
  mountedRoot.querySelectorAll("[data-pp-edit-submission]").forEach((button) => button.onclick = () => { ui.editingSubmissionId = button.dataset.ppEditSubmission; render(); mountedRoot.querySelector("[data-pp-submit-form]")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  mountedRoot.querySelector("[data-pp-cancel-edit]")?.addEventListener("click", () => { ui.editingSubmissionId = null; render(); });
  mountedRoot.querySelectorAll("[data-pp-moderate]").forEach((button) => button.onclick = () => moderate(button));
}

export function renderPhantomPlay(root, opts = {}) {
  mountedRoot = root;
  mountedOpts = opts;
  if (!messageBound) { messageBound = true; window.addEventListener("message", onGameMessage); }
  if (!keyboardBound) {
    keyboardBound = true;
    window.addEventListener("keydown", (event) => {
      if (!ui.player) return;
      if (event.key === "Escape") { event.preventDefault(); closePlayer(); }
      if ((event.key === "p" || event.key === "P") && !event.ctrlKey && !event.metaKey) { event.preventDefault(); togglePlayerPause(); }
      if ((event.key === "r" || event.key === "R") && !event.ctrlKey && !event.metaKey) { event.preventDefault(); restartPlayer(); }
    });
  }
  render();
  hydrate();
  return () => { clearInterval(playClock); clearInterval(matchClock); document.body.classList.remove("phantomplay-playing"); mountedRoot = null; mountedOpts = null; };
}
