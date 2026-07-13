import {
  currentTenantId, isAdmin, isOwnerOperator, session,
  workspaceStorageGetItem, workspaceStorageSetItem,
} from "./store.js?v=phantom-live-20260712-223";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const FALLBACK_KEY = "pf.phantomplay.offline.v1";
const CATEGORIES = ["All", "Arcade", "Puzzle", "Focus", "Strategy", "Sports", "Creative"];
const TAK_CREATOR = "Tak";
const BUILT_INS = [
  { id: "neon-drift", title: "Neon Drift", summary: "Hard-mode signal drifting with levels, music, and animated hazards.", description: "A harder arcade run with ten escalating levels, original synth tones, animated mines, slicers, sweepers, splitters, shields, pause, restart, touch, and keyboard controls.", category: "Arcade", tags: ["hard", "reaction", "music", "levels", "touch"], contentRating: "everyone", developer: TAK_CREATOR, kind: "built_in", launchUrl: "/app/games/neon-drift.html?v=1.2.0", thumbnail: "/app/assets/poses/mode-dark-video.webp", featured: true, version: "1.2.0", controls: "Arrow keys, A/D, or hold left/right", progressSupport: true, scoreSupport: true },
  { id: "signal-match", title: "Signal Match", summary: "Watch the flash, memorize positions, then match every pair.", description: "A real memory round: the full grid flashes first, then hides so players match symbols from memory with moves, pause, restart, touch, and keyboard support.", category: "Puzzle", tags: ["memory", "flash", "puzzle"], contentRating: "everyone", developer: TAK_CREATOR, kind: "built_in", launchUrl: "/app/games/signal-match.html?v=1.2.0", thumbnail: "/app/assets/poses/mode-dark-image.webp", featured: true, version: "1.2.0", controls: "Click, tap, or use Tab + Enter", progressSupport: true, scoreSupport: true },
  { id: "focus-stack", title: "Focus Stack", summary: "Drop each layer cleanly and build the tallest signal tower.", description: "A focused timing run with a proper start, pause, restart, and resize-safe play field.", category: "Focus", tags: ["timing", "focus", "quick"], contentRating: "everyone", developer: TAK_CREATOR, kind: "built_in", launchUrl: "/app/games/focus-stack.html?v=1.1.0", thumbnail: "/app/assets/poses/mode-dark-website.webp", featured: false, version: "1.1.0", controls: "Space, Enter, click, or tap", progressSupport: true, scoreSupport: true },
  { id: "reflex-grid", title: "Reflex Grid", summary: "Hit the lit cell before the fuse burns out.", description: "A nine-cell reaction test that speeds up as you score. Three misses ends the run.", category: "Arcade", tags: ["reaction", "quick", "touch"], contentRating: "everyone", developer: TAK_CREATOR, kind: "built_in", launchUrl: "/app/games/reflex-grid.html", thumbnail: "/app/assets/poses/mode-dark-ask.webp", featured: true, version: "1.0.0", controls: "Tap/click a cell or press 1-9", progressSupport: true, scoreSupport: true },
  { id: "penalty-kick", title: "Penalty Kick", summary: "Beat the keeper — time your shot past the moving save zone.", description: "Read the sweeping reticle and the keeper's reach, then strike. The keeper gets faster every round.", category: "Sports", tags: ["sports", "timing", "touch"], contentRating: "everyone", developer: TAK_CREATOR, kind: "built_in", launchUrl: "/app/games/penalty-kick.html", thumbnail: "/app/assets/poses/mode-dark-video.webp", featured: true, version: "1.0.0", controls: "Space or tap to shoot", progressSupport: true, scoreSupport: true },
  { id: "color-rush", title: "Color Rush", summary: "Catch only the target color as the tiles fall faster.", description: "Four falling columns and a rotating target color. Catch the right hue, ignore the rest, keep three lives.", category: "Arcade", tags: ["reaction", "color", "touch"], contentRating: "everyone", developer: TAK_CREATOR, kind: "built_in", launchUrl: "/app/games/color-rush.html", thumbnail: "/app/assets/poses/mode-dark-image.webp", featured: false, version: "1.0.0", controls: "A/S/D/F or tap a column", progressSupport: true, scoreSupport: true },
  { id: "word-weld", title: "Word Weld", summary: "Weld the letters into as many words as you can before time runs out.", description: "A 90-second word builder with a real dictionary. Longer words score exponentially higher.", category: "Puzzle", tags: ["word", "vocabulary", "touch"], contentRating: "everyone", developer: TAK_CREATOR, kind: "built_in", launchUrl: "/app/games/word-weld.html", thumbnail: "/app/assets/poses/mode-dark-write.webp", featured: true, version: "1.0.0", controls: "Type letters, Enter to submit, Space to shuffle", progressSupport: true, scoreSupport: true },
  { id: "tile-flow", title: "Tile Flow", summary: "Rotate the pipes to connect the signal end to end.", description: "Eight hand-verified solvable levels. Turn each tile until the flow reaches the exit.", category: "Puzzle", tags: ["logic", "calm", "touch"], contentRating: "everyone", developer: TAK_CREATOR, kind: "built_in", launchUrl: "/app/games/tile-flow.html", thumbnail: "/app/assets/poses/mode-dark-website.webp", featured: false, version: "1.0.0", controls: "Click/tap to rotate, arrows to move", progressSupport: true, scoreSupport: true },
  { id: "tower-tactics", title: "Tower Tactics", summary: "Slide and merge matching tiles to build the highest number.", description: "A tight 4x4 merge puzzle. Plan your slides — the board fills fast when you stop thinking ahead.", category: "Strategy", tags: ["merge", "strategy", "touch"], contentRating: "everyone", developer: TAK_CREATOR, kind: "built_in", launchUrl: "/app/games/tower-tactics.html", thumbnail: "/app/assets/poses/mode-dark-admin.webp", featured: false, version: "1.0.0", controls: "Arrow keys or swipe", progressSupport: true, scoreSupport: true },
  { id: "breath-pacer", title: "Breath Pacer", summary: "Match your breath to the pacer and reset in two minutes.", description: "A box-breathing companion. Follow the expanding ring through inhale, hold, exhale, hold and score your timing.", category: "Focus", tags: ["calm", "breathing", "wellness"], contentRating: "everyone", developer: TAK_CREATOR, kind: "built_in", launchUrl: "/app/games/breath-pacer.html", thumbnail: "/app/assets/poses/mode-dark-ask.webp", featured: false, version: "1.0.0", controls: "Tap or press Space on each phase", progressSupport: true, scoreSupport: true },
  { id: "court-vision", title: "Court Vision", summary: "Read the arc and power to sink the free throw.", description: "A physics free-throw shooter. The distance and rim grow with every make; three misses ends the game.", category: "Sports", tags: ["sports", "physics", "timing"], contentRating: "everyone", developer: TAK_CREATOR, kind: "built_in", launchUrl: "/app/games/court-vision.html", thumbnail: "/app/assets/poses/mode-dark-video.webp", featured: false, version: "1.0.0", controls: "Tap or press Space to shoot", progressSupport: true, scoreSupport: true },
  { id: "pixel-bloom", title: "Pixel Bloom", summary: "Bloom a symmetric neon mandala — no timer, no pressure.", description: "A calm creative toy. Place petals that mirror four ways; build combos as the pattern fills.", category: "Creative", tags: ["calm", "creative", "relax"], contentRating: "everyone", developer: TAK_CREATOR, kind: "built_in", launchUrl: "/app/games/pixel-bloom.html", thumbnail: "/app/assets/poses/mode-dark-image.webp", featured: false, version: "1.0.0", controls: "Tap cells or arrows + Space", progressSupport: true, scoreSupport: true },
];

const ui = {
  tab: "home",
  loading: true,
  error: "",
  notice: "",
  offline: false,
  query: "",
  category: "All",
  snapshot: null,
  player: null,
  playerReady: false,
  playerPaused: false,
  settingsOpen: false,
  editingSubmissionId: null,
};

let mountedRoot = null;
let mountedOpts = null;
let playClock = null;
let playTickAt = 0;
let messageBound = false;
let keyboardBound = false;

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `PhantomPlay request failed (${response.status}).`);
  return payload;
}

function offlineState() {
  let saved = {};
  try { saved = JSON.parse(workspaceStorageGetItem(FALLBACK_KEY) || "{}"); } catch {}
  return {
    tenantId: currentTenantId(),
    actorId: "offline",
    access: { enabled: true, reason: "offline_built_ins", dailyMinuteLimit: 60, usedMinutesToday: 0, remainingMinutesToday: 60, canSubmitGames: false, canModerate: false },
    catalog: BUILT_INS,
    favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
    history: Array.isArray(saved.history) ? saved.history : [],
    leaderboards: { overall: [], byGame: [] },
    preferences: { contentRating: "teen", sound: saved.sound !== false, reducedMotion: !!saved.reducedMotion, allowCommunityGames: true },
    submissions: [],
    developerSpotlight: TAK_CREATOR,
    approvedCommunityCount: 0,
  };
}

function saveOffline(snapshot = ui.snapshot) {
  if (!snapshot) return;
  workspaceStorageSetItem(FALLBACK_KEY, JSON.stringify({ favorites: snapshot.favorites, history: snapshot.history, sound: snapshot.preferences.sound, reducedMotion: snapshot.preferences.reducedMotion }));
}

async function hydrate() {
  ui.loading = true;
  ui.error = "";
  render();
  try {
    const payload = await api(`/api/phantomplay?tenant_id=${encodeURIComponent(currentTenantId())}`);
    ui.snapshot = payload;
    ui.offline = false;
  } catch (error) {
    ui.snapshot = offlineState();
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

function fallbackLeaderboards(snapshot = ui.snapshot) {
  const history = Array.isArray(snapshot?.history) ? snapshot.history : [];
  const catalog = Array.isArray(snapshot?.catalog) ? snapshot.catalog : [];
  const rows = history.filter((item) => item.score != null).map((item) => {
    const game = catalog.find((entry) => entry.id === item.gameId);
    return { gameId: item.gameId, gameTitle: game?.title || item.gameId, player: "You", score: Number(item.score) || 0, seconds: Number(item.seconds) || 0, updatedAt: item.lastPlayedAt, isYou: true };
  }).sort((a, b) => b.score - a.score || a.seconds - b.seconds);
  return { overall: rows.slice(0, 10), byGame: catalog.map((game) => ({ gameId: game.id, gameTitle: game.title, rows: rows.filter((row) => row.gameId === game.id).slice(0, 5) })).filter((board) => board.rows.length) };
}

function playTimeLabel(value, compact = false) {
  return Number(value) >= 10000 ? (compact ? "Unlimited" : "Unlimited play") : `${Number(value) || 0}${compact ? "" : " min left"}`;
}

function gameCard(game, variant = "") {
  const favorite = ui.snapshot.favorites.includes(game.id);
  const history = historyFor(game.id);
  return `<article class="pp-game ${variant}" data-pp-game-card="${esc(game.id)}">
    <div class="pp-game-art"><img src="${esc(game.thumbnail)}" alt="" loading="lazy"/><span>${esc(game.category)}</span>${game.kind === "community" ? "<em>Community</em>" : ""}</div>
    <div class="pp-game-body"><div><p>By ${esc(game.developer)}</p><h3>${esc(game.title)}</h3></div><button type="button" class="pp-favorite ${favorite ? "is-on" : ""}" data-pp-favorite="${esc(game.id)}" aria-label="${favorite ? "Remove from" : "Add to"} favorites">${icon("heart")}</button>
    <p>${esc(game.summary)}</p>
    <div class="pp-game-meta"><span>${esc(game.contentRating === "everyone" ? "Everyone" : game.contentRating)}</span><span>v${esc(game.version)}</span>${history?.score != null ? `<span>Best ${history.score}</span>` : ""}</div>
    ${history?.canContinue ? `<div class="pp-progress"><i style="width:${Math.max(3, Math.min(100, history.progress))}%"></i></div>` : ""}
    <div class="pp-game-actions"><button class="pp-play" type="button" data-pp-play="${esc(game.id)}">${icon("play")} ${history?.canContinue ? "Continue" : "Play now"}</button><button class="pp-support" type="button" data-pp-support="${esc(game.developer)}">Support this creator</button></div></div>
  </article>`;
}

function empty(title, copy) {
  return `<div class="pp-empty"><span>${icon("game")}</span><h3>${esc(title)}</h3><p>${esc(copy)}</p></div>`;
}

function gameRows(games, title, copy = "") {
  return `<section class="pp-section"><div class="pp-section-head"><div><h2>${esc(title)}</h2>${copy ? `<p>${esc(copy)}</p>` : ""}</div>${games.length > 3 ? `<button type="button" data-pp-tab="library">View all</button>` : ""}</div>${games.length ? `<div class="pp-game-grid">${games.map((game) => gameCard(game)).join("")}</div>` : empty(`No ${title.toLowerCase()} yet`, "Games will appear here when there is something real to show.")}</section>`;
}

function renderHome() {
  const featured = ui.snapshot.catalog.filter((game) => game.featured);
  const recent = ui.snapshot.history.map((item) => ui.snapshot.catalog.find((game) => game.id === item.gameId)).filter(Boolean).slice(0, 4);
  const continuing = ui.snapshot.history.filter((item) => item.canContinue).map((item) => ui.snapshot.catalog.find((game) => game.id === item.gameId)).filter(Boolean).slice(0, 4);
  const community = ui.snapshot.catalog.filter((game) => game.kind === "community").slice(0, 4);
  const quickGame = featured[0]?.id || ui.snapshot.catalog[0]?.id || "";
  return `<div class="pp-home">
    <section class="pp-home-actions" aria-label="PhantomPlay quick actions"><button class="pp-primary" data-pp-play="${esc(quickGame)}">${icon("play")} Play a quick game</button><button class="pp-secondary" data-pp-tab="library">Browse library</button><span>Quick breaks, saved progress, approved browser games.</span></section>
    <section class="pp-quick-stats"><span><b>${esc(playTimeLabel(ui.snapshot.access.remainingMinutesToday, true))}</b><i>${ui.snapshot.access.remainingMinutesToday >= 10000 ? "internal access" : "minutes left today"}</i></span><span><b>${ui.snapshot.favorites.length}</b><i>saved games</i></span><span><b>${ui.snapshot.history.length}</b><i>played</i></span><span><b>${ui.snapshot.approvedCommunityCount}</b><i>approved community</i></span></section>
    ${renderLeaderboardPreview()}
    ${continuing.length ? gameRows(continuing, "Continue playing", "Pick up from your last saved point.") : ""}
    ${gameRows(featured, "Featured", "Fast, polished games selected for PhantomPlay.")}
    ${recent.length ? gameRows(recent, "Recently played") : ""}
    ${gameRows(community, "Approved community games", "Only reviewed releases appear here.")}
    <section class="pp-spotlight"><img src="/app/assets/poses/mode-dark-website.webp" alt=""/><div><p class="pp-kicker">CREATOR SPOTLIGHT</p><h2>${esc(ui.snapshot.developerSpotlight || TAK_CREATOR)}</h2><p>Independent browser games published through PhantomPlay. PhantomForce hosts the platform; creators own the work.</p><button class="pp-secondary" data-pp-support="${esc(ui.snapshot.developerSpotlight || TAK_CREATOR)}">Support this creator</button></div></section>
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
  const query = ui.query.toLowerCase();
  return ui.snapshot.catalog.filter((game) => (ui.category === "All" || game.category === ui.category) && (!query || `${game.title} ${game.summary} ${game.developer} ${game.tags.join(" ")}`.toLowerCase().includes(query)));
}

function renderLibrary() {
  const games = filteredCatalog();
  return `<section class="pp-library"><div class="pp-library-tools"><label>${icon("search")}<input type="search" data-pp-search value="${esc(ui.query)}" placeholder="Search games, categories, developers…"/></label><div class="pp-categories">${CATEGORIES.map((category) => `<button type="button" class="${ui.category === category ? "is-active" : ""}" data-pp-category="${esc(category)}">${esc(category)}</button>`).join("")}</div></div>${games.length ? `<div class="pp-game-grid pp-game-grid-full">${games.map((game) => gameCard(game)).join("")}</div>` : empty("No matching games", "Try a different search or category.")}</section>`;
}

function renderFavorites() {
  const games = ui.snapshot.catalog.filter((game) => ui.snapshot.favorites.includes(game.id));
  return games.length ? `<div class="pp-game-grid pp-game-grid-full">${games.map((game) => gameCard(game)).join("")}</div>` : empty("No favorites yet", "Tap the heart on any game to save it here.");
}

function submissionCard(item, admin = false) {
  const canEdit = !admin && ["draft", "changes_requested", "rejected"].includes(item.status);
  return `<article class="pp-submission"><header><div><p>${esc(item.developerName)} · v${esc(item.version)}</p><h3>${esc(item.title || "Untitled game")}</h3></div><span class="is-${esc(item.status)}">${esc(item.status.replaceAll("_", " "))}</span></header><p>${esc(item.summary || "No summary yet.")}</p><div class="pp-submission-meta"><span>${esc(item.category)}</span><span>${esc(item.contentRating)}</span><span>${item.screenshots.length} screenshots</span><span>${item.versions.length} versions</span></div>${item.moderationNote ? `<blockquote>${esc(item.moderationNote)}</blockquote>` : ""}${canEdit ? `<button type="button" class="pp-secondary" data-pp-edit-submission="${esc(item.id)}">Edit release</button>` : ""}${admin && item.status !== "disabled" ? `<div class="pp-moderate"><input type="text" data-pp-note="${esc(item.id)}" maxlength="1000" placeholder="Moderation note"/><label><input type="checkbox" data-pp-featured="${esc(item.id)}"/> Feature if approved</label><div><button data-pp-moderate="approved" data-id="${esc(item.id)}">Approve</button><button data-pp-moderate="changes_requested" data-id="${esc(item.id)}">Request changes</button><button data-pp-moderate="rejected" data-id="${esc(item.id)}">Reject</button><button data-pp-moderate="disabled" data-id="${esc(item.id)}">Disable</button></div></div>` : ""}</article>`;
}

function selectedSubmission() {
  return ui.snapshot.submissions.find((item) => item.id === ui.editingSubmissionId) || null;
}

function renderDeveloper() {
  if (!ui.snapshot.access.canSubmitGames) return empty("Submissions are unavailable", "This account or plan can play games but cannot submit releases.");
  const editing = selectedSubmission();
  return `<div class="pp-developer"><section class="pp-dev-guide"><div><p class="pp-kicker">DEVELOPER DISTRIBUTION</p><h2>Bring a finished browser game to PhantomPlay.</h2><p>Submissions are reviewed for quality, age rating, privacy, controls, responsiveness, and sandbox compatibility. Approval never happens automatically.</p></div><ul><li>HTTPS or approved PhantomPlay path</li><li>Responsive keyboard + touch controls</li><li>No hidden trackers, popups, payments, or account access</li><li>Clear version and player-data disclosure</li></ul></section>
    <section class="pp-dev-layout"><form class="pp-submit-form" data-pp-submit-form><header><h2>${editing ? "Update release" : "New submission"}</h2>${editing ? `<button type="button" class="pp-secondary" data-pp-cancel-edit>Cancel edit</button>` : ""}</header><input type="hidden" name="submissionId" value="${esc(editing?.id || "")}"/><label>Game title<input name="title" value="${esc(editing?.title || "")}" maxlength="90" required/></label><label>One-line summary<input name="summary" value="${esc(editing?.summary || "")}" maxlength="180" required/></label><label>Full description<textarea name="description" rows="5" maxlength="3000" required>${esc(editing?.description || "")}</textarea></label><div class="pp-form-row"><label>Category<select name="category">${[...CATEGORIES.filter((c) => c !== "All"), "Other"].map((c) => `<option ${editing?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label>Content rating<select name="contentRating"><option value="everyone" ${editing?.contentRating === "everyone" ? "selected" : ""}>Everyone</option><option value="teen" ${editing?.contentRating === "teen" ? "selected" : ""}>Teen</option><option value="mature" ${editing?.contentRating === "mature" ? "selected" : ""}>Mature</option></select></label><label>Version<input name="version" value="${esc(editing?.version || "1.0.0")}" pattern="\\d+\\.\\d+\\.\\d+.*" required/></label></div><label>Launch URL<input name="launchUrl" value="${esc(editing?.launchUrl || "")}" placeholder="https://… or /app/games/community/…" required/></label><label>Screenshot URLs<textarea name="screenshots" rows="3" placeholder="One HTTPS URL per line" required>${esc(editing?.screenshots?.join("\n") || "")}</textarea></label><label>Controls<input name="controls" value="${esc(editing?.controls || "")}" maxlength="240" placeholder="Keyboard, touch, controller…" required/></label><label>Player data used or stored<textarea name="dataHandling" rows="3" maxlength="600" placeholder="Be specific. 'None' is acceptable when true." required>${esc(editing?.dataHandling || "")}</textarea></label><label>Tags<input name="tags" value="${esc(editing?.tags?.join(", ") || "")}" placeholder="puzzle, touch, quick"/></label><label>Release notes<textarea name="releaseNotes" rows="2"></textarea></label><div class="pp-form-actions"><button type="submit" name="action" value="draft" class="pp-secondary">Save draft</button><button type="submit" name="action" value="submit" class="pp-primary">${editing ? "Resubmit for review" : "Submit for review"}</button></div><p data-pp-form-message></p></form><section><h2>Your submissions</h2><div class="pp-submission-list">${ui.snapshot.submissions.length ? ui.snapshot.submissions.map((item) => submissionCard(item)).join("") : empty("No submissions yet", "Save a draft or send a completed game for review.")}</div></section></section>
  </div>`;
}

function renderAdmin() {
  if (!ui.snapshot.access.canModerate) return empty("Moderation is protected", "Platform admin access is required.");
  return `<section class="pp-admin"><div class="pp-section-head"><div><h2>Game review queue</h2><p>Approve only releases that pass the PhantomPlay security and quality checklist.</p></div><span>${ui.snapshot.submissions.length} submissions</span></div><div class="pp-submission-list">${ui.snapshot.submissions.length ? ui.snapshot.submissions.map((item) => submissionCard(item, true)).join("") : empty("Queue clear", "No developer submissions are waiting.")}</div></section>`;
}

function settingsMarkup() {
  const p = ui.snapshot.preferences;
  return `<aside class="pp-settings ${ui.settingsOpen ? "is-open" : ""}" ${ui.settingsOpen ? "" : "hidden"}><header><div><p class="pp-kicker">PLAY SETTINGS</p><h2>Your break, your limits.</h2></div><button data-pp-settings-close aria-label="Close settings">×</button></header><label>Content allowed<select data-pp-pref="contentRating"><option value="everyone" ${p.contentRating === "everyone" ? "selected" : ""}>Everyone</option><option value="teen" ${p.contentRating === "teen" ? "selected" : ""}>Teen</option><option value="mature" ${p.contentRating === "mature" ? "selected" : ""}>Mature</option></select></label><label class="pp-switch"><input type="checkbox" data-pp-pref="sound" ${p.sound ? "checked" : ""}/><span></span>Sound</label><label class="pp-switch"><input type="checkbox" data-pp-pref="reducedMotion" ${p.reducedMotion ? "checked" : ""}/><span></span>Reduce motion</label><label class="pp-switch"><input type="checkbox" data-pp-pref="allowCommunityGames" ${p.allowCommunityGames ? "checked" : ""}/><span></span>Show approved community games</label><p>PhantomPlay never changes your work, agents, files, or business data while you play.</p></aside>`;
}

function playerMarkup() {
  if (!ui.player) return "";
  const { game, play } = ui.player;
  return `<div class="pp-player" role="dialog" aria-modal="true" aria-label="Playing ${esc(game.title)}"><header><div><img src="${esc(game.thumbnail)}" alt=""/><span><b>${esc(game.title)}</b><i>${esc(game.controls)}</i></span></div><div class="pp-player-actions"><button data-pp-player-restart title="Restart game">Restart</button><button data-pp-player-pause title="Pause game">${ui.playerPaused ? "Resume" : "Pause"}</button><button data-pp-player-fullscreen title="Full screen">Full screen</button><button data-pp-player-close aria-label="Close game">×</button></div></header><div class="pp-player-stage"><div class="pp-player-loading" ${ui.playerReady ? "hidden" : ""}><i></i><b>Loading ${esc(game.title)}…</b><span>The game is opening in a private sandbox.</span></div><iframe src="${esc(game.launchUrl)}" title="${esc(game.title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" allow="fullscreen" tabindex="0" data-pp-frame></iframe></div><footer><span>Session <b>${esc(play.id.slice(-8))}</b></span><span data-pp-live-score>Score —</span><span data-pp-live-state>${ui.playerPaused ? "Paused" : "Playing"}</span><span>Progress saves automatically</span></footer></div>`;
}

function render() {
  if (!mountedRoot) return;
  document.body.classList.toggle("phantomplay-playing", !!ui.player);
  if (ui.loading && !ui.snapshot) {
    mountedRoot.innerHTML = `<div class="pp-loading"><i></i><b>Opening PhantomPlay</b><span>Loading your library and saved progress…</span></div>`;
    return;
  }
  const snapshot = ui.snapshot || offlineState();
  const tabs = [["home", "Home"], ["library", "Library"], ["leaderboard", "Leaderboard"], ["favorites", "Favorites"], ["developer", "Developers"], ...(snapshot.access.canModerate ? [["admin", "Admin"]] : [])];
  const content = ui.tab === "library" ? renderLibrary() : ui.tab === "leaderboard" ? renderLeaderboard() : ui.tab === "favorites" ? renderFavorites() : ui.tab === "developer" ? renderDeveloper() : ui.tab === "admin" ? renderAdmin() : renderHome();
  mountedRoot.innerHTML = `<div class="pp-shell">
    <header class="pp-top"><div></div><div><span class="pp-access ${snapshot.access.enabled ? "is-ready" : "is-blocked"}">${snapshot.access.enabled ? esc(playTimeLabel(snapshot.access.remainingMinutesToday)) : "Plan restricted"}</span><button class="pp-settings-button" data-pp-settings aria-label="Play settings">${icon("settings")}</button></div></header>
    ${ui.offline ? `<div class="pp-banner is-offline"><b>Offline mode</b><span>Built-in games still work. Favorites and progress will sync after the server returns.</span><button data-pp-retry>Retry</button></div>` : ""}
    ${ui.error && !ui.offline ? `<div class="pp-banner is-error"><b>PhantomPlay needs attention</b><span>${esc(ui.error)}</span><button data-pp-retry>Retry</button></div>` : ""}
    ${ui.notice ? `<div class="pp-banner is-notice"><b>Creator support</b><span>${esc(ui.notice)}</span><button data-pp-clear-notice>OK</button></div>` : ""}
    <nav class="pp-tabs" aria-label="PhantomPlay sections">${tabs.map(([id, label]) => `<button type="button" class="${ui.tab === id ? "is-active" : ""}" data-pp-tab="${id}">${esc(label)}</button>`).join("")}</nav>
    <main class="pp-content">${snapshot.access.enabled ? content : empty("PhantomPlay is unavailable", "This optional workspace module is separate from core PhantomForce operations. Ask a workspace owner to enable access if your team uses it.")}</main>
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

async function launch(gameId) {
  if (!gameId) return;
  const game = ui.snapshot.catalog.find((item) => item.id === gameId);
  if (!game?.launchUrl) { ui.error = "This game is not available to play yet."; render(); return; }
  try {
    const result = ui.offline ? offlinePlay(game) : await api("/api/phantomplay/plays", { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), gameId }) });
    ui.player = { game: result.game || game, play: result.play };
    ui.playerReady = false;
    ui.playerPaused = false;
    playTickAt = Date.now();
    render();
    startClock();
  } catch (error) { ui.error = error.message; render(); }
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
  clearInterval(playClock);
  await persistPlay(true);
  ui.player = null;
  ui.playerReady = false;
  ui.playerPaused = false;
  document.body.classList.remove("phantomplay-playing");
  render();
}

function postToGame(type) {
  const frame = mountedRoot?.querySelector("[data-pp-frame]");
  frame?.contentWindow?.postMessage({ source: "phantomplay-host", type }, "*");
  frame?.focus?.({ preventScroll: true });
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
  if (event.data.type === "ready") {
    ui.playerReady = true;
    mountedRoot.querySelector(".pp-player-loading")?.setAttribute("hidden", "");
    frame.contentWindow?.postMessage({ source: "phantomplay-host", type: "settings", sound: ui.snapshot.preferences.sound, reducedMotion: ui.snapshot.preferences.reducedMotion }, "*");
    frame.focus?.({ preventScroll: true });
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

function bind() {
  mountedRoot.querySelectorAll("[data-pp-tab]").forEach((button) => button.onclick = () => { ui.tab = button.dataset.ppTab; render(); });
  mountedRoot.querySelectorAll("[data-pp-support]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); ui.notice = `${button.dataset.ppSupport || "This creator"} support is queued for the creator profile/payments layer. For now, favorites and leaderboard plays help boost discovery.`; render(); });
  mountedRoot.querySelector("[data-pp-clear-notice]")?.addEventListener("click", () => { ui.notice = ""; render(); });
  mountedRoot.querySelectorAll("[data-pp-play]").forEach((button) => button.onclick = () => launch(button.dataset.ppPlay));
  mountedRoot.querySelectorAll("[data-pp-favorite]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); updateFavorite(button.dataset.ppFavorite); });
  mountedRoot.querySelectorAll("[data-pp-category]").forEach((button) => button.onclick = () => { ui.category = button.dataset.ppCategory; render(); });
  mountedRoot.querySelector("[data-pp-search]")?.addEventListener("input", (event) => { ui.query = event.target.value; const list = mountedRoot.querySelector(".pp-game-grid-full"); if (list) list.innerHTML = filteredCatalog().map((game) => gameCard(game)).join("") || empty("No matching games", "Try a different search or category."); bind(); });
  mountedRoot.querySelector("[data-pp-settings]")?.addEventListener("click", () => { ui.settingsOpen = true; render(); });
  mountedRoot.querySelector("[data-pp-settings-close]")?.addEventListener("click", () => { ui.settingsOpen = false; render(); });
  mountedRoot.querySelectorAll("[data-pp-pref]").forEach((input) => input.onchange = () => { ui.snapshot.preferences[input.dataset.ppPref] = input.type === "checkbox" ? input.checked : input.value; updatePreferences(); });
  mountedRoot.querySelector("[data-pp-retry]")?.addEventListener("click", hydrate);
  mountedRoot.querySelector("[data-pp-player-close]")?.addEventListener("click", closePlayer);
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
  return () => { clearInterval(playClock); document.body.classList.remove("phantomplay-playing"); mountedRoot = null; mountedOpts = null; };
}
