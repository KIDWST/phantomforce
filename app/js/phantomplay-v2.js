/* PhantomPlay V2 — the platform experience shell.
   Home / Solo / Friends / Workspace / Library / Dev Hub (+ Admin) over the
   V1 APIs (/api/phantomplay/*) plus the V2 platform layer
   (/api/phantomplay/v2/*). V1's phantomplay.js is untouched; main.js mounts
   this module instead. Every V2 surface degrades honestly: if the V2 routes
   are missing or flagged off, social/community panels say so and every V1
   flow (catalog, play, saves, submissions, moderation) keeps working. */

import {
  currentTenantId, isAdmin, session,
  workspaceStorageGetItem, workspaceStorageSetItem,
} from "./store.js?v=phantom-live-20260714-271";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const FALLBACK_KEY = "pf.phantomplay.offline.v1";
const CATEGORIES = ["All", "Arcade", "Puzzle", "Focus", "Strategy", "Sports", "Creative"];
const GAME_SORTS = ["All", "Solo", "Multiplayer", "Toddler", ...CATEGORIES.filter((cat) => cat !== "All")];
const STATUSES = [["online", "Online"], ["away", "Away"], ["busy", "Busy"], ["invisible", "Invisible"]];
// "Game Rating Exposure" — mirrors server PhantomPlayRating (phantomplay.ts).
// Kept in sync by hand with defaultAllowedRatings() there; no server "give me
// the default for my type" endpoint exists.
const RATING_TIERS = [["toddler", "Toddler"], ["everyone", "Everyone"], ["everyone10", "Everyone 10+"], ["teen", "Teen"], ["mature", "Mature"]];
const ALL_RATING_VALUES = RATING_TIERS.map(([value]) => value);
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

const ui = {
  tab: "solo", loading: true, error: "", offline: false,
  snapshot: null, v2: null, v2Offline: false, discovery: null,
  query: "", category: "All",
  detailId: null, detail: null, detailBusy: false, reviewDraft: { rating: 0, text: "" },
  player: null, playerReady: false, playerPaused: false, resume: null,
  settingsOpen: false, editingSubmissionId: null,
  statusChoice: "online", friendTarget: "",
  analytics: null, leaderboardGameId: "", leaderboard: null,
  policyDraft: null, policyMessage: "", assistMessage: "",
  guardianMessage: "", ratingBusy: false,
};

let mountedRoot = null, playClock = null, playTickAt = 0, heartbeatClock = null, messageBound = false, keyboardBound = false;

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
const tenantQuery = () => `tenant_id=${encodeURIComponent(currentTenantId())}`;

/* ---- offline fallback (built-ins only, local saves) ---- */
const OFFLINE_GAMES = [
  ["neon-drift", "Neon Drift", "Arcade", "/app/games/neon-drift.html?v=1.2.4"],
  ["signal-match", "Signal Match", "Puzzle", "/app/games/signal-match.html"],
  ["focus-stack", "Focus Stack", "Focus", "/app/games/focus-stack.html"],
  ["phantom-rumble", "Phantom Rumble", "Arcade", "/app/games/phantom-rumble.html?v=2.2.3"],
  ["sudoku-signal", "Sudoku Signal", "Focus", "/app/games/sudoku-signal.html"],
].map(([id, title, category, launchUrl]) => ({ id, title, summary: id === "phantom-rumble" ? "Premium local platform fighter with guard, parry, dodge, ledge-save recovery, bots, drops, and touch controls." : "Offline built-in game.", description: "", category, tags: [], contentRating: "everyone", developer: "Tak", kind: "built_in", launchUrl, thumbnail: "", featured: id === "phantom-rumble", version: id === "phantom-rumble" ? "2.2.3" : "1.0.0", controls: id === "phantom-rumble" ? "Keyboard or mobile touch controls." : "", progressSupport: true, scoreSupport: true }));

function offlineState() {
  let saved = {};
  try { saved = JSON.parse(workspaceStorageGetItem(FALLBACK_KEY) || "{}"); } catch {}
  return {
    tenantId: currentTenantId(), actorId: "offline",
    access: { enabled: true, reason: "offline_built_ins", dailyMinuteLimit: 60, usedMinutesToday: 0, remainingMinutesToday: 60, canSubmitGames: false, canModerate: false },
    catalog: OFFLINE_GAMES, favorites: Array.isArray(saved.favorites) ? saved.favorites : [], history: Array.isArray(saved.history) ? saved.history : [],
    preferences: { contentRating: "teen", allowedRatings: [...ALL_RATING_VALUES], sound: saved.sound !== false, reducedMotion: !!saved.reducedMotion, allowCommunityGames: true },
    profileType: "adult", guardianLock: { enabled: false },
    submissions: [], developerSpotlight: "Tak", approvedCommunityCount: 0,
  };
}
function saveOffline(snapshot = ui.snapshot) {
  if (!snapshot) return;
  workspaceStorageSetItem(FALLBACK_KEY, JSON.stringify({ favorites: snapshot.favorites, history: snapshot.history, sound: snapshot.preferences.sound, reducedMotion: !!snapshot.preferences.reducedMotion }));
}

/* ---- hydrate ---- */
async function hydrate() {
  ui.loading = true; ui.error = ""; render();
  try {
    ui.snapshot = await api(`/api/phantomplay?${tenantQuery()}`);
    ui.offline = false;
  } catch (error) {
    if (error?.status === 403) {
      // The server explicitly said no (workspace module disabled or plan
      // restricted) — honor it; do NOT fall back to offline built-ins.
      ui.snapshot = { ...offlineState(), catalog: [], history: [], access: { enabled: false, reason: "restricted", dailyMinuteLimit: 0, usedMinutesToday: 0, remainingMinutesToday: 0, canSubmitGames: false, canModerate: false } };
      ui.offline = false;
      ui.error = error.message;
    } else {
      ui.snapshot = offlineState(); ui.offline = true;
      ui.error = error instanceof Error ? error.message : "PhantomPlay sync is unavailable.";
    }
  }
  try {
    const [v2, discovery] = await Promise.all([api(`/api/phantomplay/v2?${tenantQuery()}`), api(`/api/phantomplay/v2/discovery?${tenantQuery()}`)]);
    ui.v2 = v2; ui.discovery = discovery; ui.v2Offline = false;
  } catch { ui.v2 = null; ui.discovery = null; ui.v2Offline = true; }
  ui.loading = false;
  render();
}

/* ---- presence ---- */
async function heartbeat() {
  if (ui.offline || ui.v2Offline) return;
  try {
    await api("/api/phantomplay/v2/presence", { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), status: ui.player ? "playing" : ui.statusChoice, gameId: ui.player?.game?.id || "", label: ui.v2?.actorLabel || "" }) });
  } catch { /* presence is best-effort */ }
}

/* ---- helpers ---- */
const gameById = (id) => ui.snapshot?.catalog?.find((game) => game.id === id) || null;
const historyFor = (gameId) => ui.snapshot?.history?.find((item) => item.gameId === gameId) || null;
const wishlisted = (gameId) => !!ui.v2?.wishlist?.includes(gameId);
const multiplayerGame = (game) => game.localMultiplayer || game.onlineMultiplayer || game.tags?.some((tag) => /multiplayer|friends|party|duel/i.test(tag)) || ["phantom-rumble"].includes(game.id);
const toddlerPick = (game) => game.contentRating === "toddler" || ["focus-stack", "signal-match", "sudoku-signal"].includes(game.id);
const builtInGames = () => ui.snapshot.catalog.filter((game) => game.kind === "built_in");
const visibleMultiplayerGames = () => ui.snapshot.catalog.filter(multiplayerGame);
function sortGames(games, sort = ui.category) {
  if (sort === "Solo") return games.filter((game) => !multiplayerGame(game));
  if (sort === "Multiplayer") return games.filter(multiplayerGame);
  if (sort === "Toddler") return games.filter(toddlerPick);
  if (CATEGORIES.includes(sort) && sort !== "All") return games.filter((game) => game.category === sort);
  return games;
}
function stars(value, interactive = false) {
  const rating = Math.round(Number(value) || 0);
  return `<span class="pp2-stars${interactive ? " is-input" : ""}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" ${interactive ? `data-pp2-star="${n}"` : "disabled"} class="${n <= rating ? "is-on" : ""}">★</button>`).join("")}</span>`;
}
function playTimeLabel(value) {
  return Number(value) >= 10000 ? "Unlimited" : `${Number(value) || 0} min left`;
}
function art(game) {
  if (game.thumbnail) return `<img src="${esc(game.thumbnail)}" alt="" loading="lazy"/>`;
  return `<span class="pp2-art-fallback">${esc((game.title || "?").slice(0, 1))}</span>`;
}

/* ---- cards & rows ---- */
function card(game, opts = {}) {
  const history = historyFor(game.id);
  const heart = wishlisted(game.id);
  return `<article class="pp2-card ${opts.variant || ""}" data-pp2-open="${esc(game.id)}">
    <div class="pp2-art">${art(game)}<span class="pp2-cat">${esc(game.category)}</span>${game.kind === "community" ? '<em class="pp2-community">Community</em>' : ""}</div>
    <div class="pp2-card-body">
      <header><h3>${esc(game.title)}</h3><button type="button" class="pp2-wish ${heart ? "is-on" : ""}" data-pp2-wish="${esc(game.id)}" title="${heart ? "Remove from wishlist" : "Wishlist"}" ${ui.v2Offline ? "disabled" : ""}>♥</button></header>
      <p class="pp2-dev">by ${esc(game.developer)}${opts.note ? ` · <i>${esc(opts.note)}</i>` : ""}</p>
      <p class="pp2-summary">${esc(game.summary)}</p>
      ${history?.canContinue ? `<div class="pp2-progress"><i style="width:${Math.max(3, Math.min(100, history.progress))}%"></i></div>` : ""}
      <div class="pp2-card-actions"><button type="button" class="pp2-play" data-pp2-play="${esc(game.id)}">${history?.canContinue ? "Continue" : "Play"}</button>${history?.score != null ? `<span>Best ${history.score}</span>` : ""}</div>
    </div>
  </article>`;
}
function row(title, games, copy = "", notes = {}) {
  if (!games.length) return "";
  return `<section class="pp2-row"><header><h2>${esc(title)}</h2>${copy ? `<p>${esc(copy)}</p>` : ""}</header><div class="pp2-grid">${games.map((game) => card(game, { note: notes[game.id] })).join("")}</div></section>`;
}
function skeletonRow(title) {
  return `<section class="pp2-row"><header><h2>${esc(title)}</h2></header><div class="pp2-grid">${Array.from({ length: 4 }, () => '<div class="pp2-card pp2-skeleton"><div class="pp2-art"></div><div class="pp2-card-body"><i></i><i style="width:60%"></i></div></div>').join("")}</div></section>`;
}
function empty(title, copy) {
  return `<div class="pp2-empty"><h3>${esc(title)}</h3><p>${esc(copy)}</p></div>`;
}
function v2Note(copy) {
  return `<div class="pp2-banner"><b>Social is offline</b><span>${esc(copy)}</span></div>`;
}

/* ---- HOME ---- */
function mapIds(rows, key = "gameId") { return (rows || []).map((item) => gameById(item[key])).filter(Boolean); }
function renderHome() {
  if (ui.loading) return `${skeletonRow("Featured")}${skeletonRow("Trending this week")}`;
  const featured = ui.snapshot.catalog.filter((game) => game.featured);
  const hero = gameById("phantom-rumble") || featured[0] || ui.snapshot.catalog[0];
  const continuing = ui.snapshot.history.filter((item) => item.canContinue).map((item) => gameById(item.gameId)).filter(Boolean).slice(0, 4);
  const d = ui.discovery;
  const ratingNotes = {};
  for (const item of [...(d?.topRated || []), ...(d?.hiddenGems || [])]) if (item.averageRating) ratingNotes[item.gameId] = `${item.averageRating}★`;
  const friendNotes = {};
  for (const item of d?.friendsPlaying || []) friendNotes[item.gameId] = `${item.label} is playing`;
  return `<div class="pp2-home">
    ${hero ? `<section class="pp2-hero"><div class="pp2-hero-art">${art(hero)}</div><div class="pp2-hero-copy"><p class="pp2-kicker">FEATURED</p><h1>${esc(hero.title)}</h1><p>${esc(hero.summary)}</p><div><button class="pp2-play" data-pp2-play="${esc(hero.id)}">Play now</button><button class="pp2-ghost" data-pp2-open="${esc(hero.id)}">Game page</button></div></div></section>` : ""}
    ${row("Continue playing", continuing, "Pick up exactly where you left off — saves follow your profile.")}
    ${d ? row("Friends playing now", mapIds(d.friendsPlaying), "", friendNotes) : ""}
    ${d ? row("Trending this week", mapIds(d.trending), "Ranked by real plays across this workspace.") : ""}
    ${d ? row("Top rated", mapIds(d.topRated), "", ratingNotes) : ""}
    ${d ? row("Hidden gems", mapIds(d.hiddenGems), "Loved by the few who found them.", ratingNotes) : ""}
    ${d ? row("New community releases", mapIds(d.newReleases)) : ""}
    ${row("Featured", featured)}
    ${ui.v2Offline ? v2Note("Discovery, reviews, friends, and wishlists need the PhantomForce server. Built-in games and saves still work.") : ""}
    <section class="pp2-spotlight"><div><p class="pp2-kicker">DEVELOPER SPOTLIGHT</p><h2>${esc(ui.snapshot.developerSpotlight)}</h2><p>Publish a game to PhantomPlay and PhantomForce becomes your publishing team — analytics, patch notes, art and campaign briefs, all in the Dev Hub.</p><button class="pp2-ghost" data-pp2-tab="developer">Open Dev Hub</button></div></section>
  </div>`;
}

/* ---- SOLO ---- */
function renderSolo() {
  const games = sortGames(builtInGames());
  return `<div class="pp2-solo">
    <section class="pp2-play-header"><div><p class="pp2-kicker">PLAY NOW</p><h2>Games</h2></div><span>${games.length} ready</span></section>
    <div class="pp2-cats">${GAME_SORTS.map((cat) => `<button type="button" class="${ui.category === cat ? "is-active" : ""}" data-pp2-cat="${esc(cat)}">${esc(cat)}</button>`).join("")}</div>
    ${games.length ? `<div class="pp2-grid pp2-grid-wide">${games.map((game) => card(game)).join("")}</div>` : empty("Nothing in this category", "Try another category.")}
  </div>`;
}

/* ---- FRIENDS ---- */
function statusDot(status) { return `<i class="pp2-dot is-${esc(status)}"></i>`; }
function renderFriends() {
  const games = visibleMultiplayerGames();
  if (ui.v2Offline) return `<div class="pp2-friends pp2-multiplayer"><section class="pp2-play-header"><div><p class="pp2-kicker">PLAY TOGETHER</p><h2>Multiplayer</h2></div><span>${games.length} ready</span></section>${row("Multiplayer games", games, "Local keyboard and private-room friendly games.")}${v2Note("Presence and private room sync need the PhantomForce server. Local multiplayer still works.")}</div>`;
  const social = ui.v2.social;
  const feed = ui.v2.feed || [];
  const addable = social.presence.filter((entry) => !social.friends.some((f) => f.actorId === entry.actorId) && !social.outgoing.some((f) => f.actorId === entry.actorId) && !social.incoming.some((f) => f.actorId === entry.actorId));
  return `<div class="pp2-friends pp2-multiplayer">
    <section class="pp2-play-header"><div><p class="pp2-kicker">PLAY TOGETHER</p><h2>Multiplayer</h2></div><label class="pp2-status-pick">My status ${statusDot(ui.statusChoice)}<select data-pp2-status>${STATUSES.map(([value, label]) => `<option value="${value}" ${ui.statusChoice === value ? "selected" : ""}>${label}</option>`).join("")}</select></label></section>
    ${row("Multiplayer games", games, "Local keyboard and private-room friendly games.")}
    <section class="pp2-panel pp2-room-panel"><h3>Private rooms</h3><p>Invite codes, ready checks, host controls, and bot fill-in are available in Classic view for now.</p><button type="button" class="pp2-play" data-pp2-classic>Open room controls</button></section>
    <div class="pp2-cols">
      <section class="pp2-panel"><h3>Friends · ${social.friends.length}</h3>
        ${social.friends.length ? social.friends.map((f) => `<div class="pp2-person">${statusDot(f.status)}<b>${esc(f.label)}</b><span>${f.status === "playing" && f.gameId ? `playing ${esc(gameById(f.gameId)?.title || f.gameId)}` : esc(f.status)}</span><button type="button" class="pp2-ghost" data-pp2-unfriend="${esc(f.actorId)}">Remove</button></div>`).join("") : empty("No friends yet", "Add workspace members from the online list.")}
        ${social.incoming.length ? `<h3>Requests for you</h3>${social.incoming.map((f) => `<div class="pp2-person"><b>${esc(f.actorId)}</b><button type="button" class="pp2-play" data-pp2-accept="${esc(f.actorId)}">Accept</button><button type="button" class="pp2-ghost" data-pp2-decline="${esc(f.actorId)}">Decline</button></div>`).join("")}` : ""}
        ${social.outgoing.length ? `<h3>Sent</h3>${social.outgoing.map((f) => `<div class="pp2-person"><b>${esc(f.actorId)}</b><span>waiting</span><button type="button" class="pp2-ghost" data-pp2-decline="${esc(f.actorId)}">Cancel</button></div>`).join("")}` : ""}
      </section>
      <section class="pp2-panel"><h3>Online in this workspace · ${social.presence.length}</h3>
        ${addable.length ? addable.map((entry) => `<div class="pp2-person">${statusDot(entry.status)}<b>${esc(entry.label)}</b><span>${entry.status === "playing" && entry.gameId ? `playing ${esc(gameById(entry.gameId)?.title || entry.gameId)}` : esc(entry.status)}</span><button type="button" class="pp2-play" data-pp2-befriend="${esc(entry.actorId)}">Add friend</button></div>`).join("") : empty("Nobody else is online", "Presence appears while workspace members have PhantomPlay open.")}
      </section>
    </div>
    ${feed.length ? `<section class="pp2-panel"><h3>Recent activity</h3><ul class="pp2-feed">${feed.slice(0, 8).map((entry) => `<li><b>${esc(entry.actorLabel)}</b> ${entry.kind === "review" ? `reviewed <i>${esc(entry.subject)}</i> ${esc(entry.detail)}` : entry.kind === "wishlist" ? `wishlisted <i>${esc(entry.subject)}</i>` : entry.kind === "follow" ? `followed <i>${esc(entry.subject)}</i>` : `released <i>${esc(entry.subject)}</i>`}<span>${esc((entry.at || "").slice(0, 10))}</span></li>`).join("")}</ul></section>` : ""}
  </div>`;
}

/* ---- WORKSPACE ---- */
function renderWorkspace() {
  const policy = ui.v2?.policy;
  const admin = isAdmin();
  const draft = ui.policyDraft;
  const builtIns = ui.snapshot.catalog.filter((game) => game.kind === "built_in");
  const board = ui.leaderboard;
  return `<div class="pp2-workspace">
    <section class="pp2-lead"><h2>Workspace</h2><p>The safe mode: schools, teams, and clubs. Organization-controlled catalog, ratings ceiling, and time limits — no public discovery, no strangers.</p></section>
    ${ui.v2Offline ? v2Note("Workspace policies and leaderboards need the PhantomForce server.") : `
    <div class="pp2-cols">
      <section class="pp2-panel"><h3>Current policy${ui.v2.policyIsDefault ? " · default" : ""}</h3>
        <ul class="pp2-policy">
          <li><b>Approved games</b><span>${policy.approvedGameIds.length ? `${policy.approvedGameIds.length} allowed` : "All catalog games"}</span></li>
          <li><b>Content ceiling</b><span>${esc(policy.maxContentRating)}</span></li>
          <li><b>Daily minutes</b><span>${policy.dailyMinuteLimit === null ? "Plan default" : policy.dailyMinuteLimit}</span></li>
          <li><b>Community games</b><span>${policy.allowCommunityGames ? "Allowed" : "Blocked"}</span></li>
          <li><b>Private rooms</b><span>${policy.allowRooms ? "Allowed" : "Blocked"}</span></li>
        </ul>
        ${admin && !draft ? `<button type="button" class="pp2-play" data-pp2-policy-edit>Edit policy</button>` : ""}
        ${!admin ? `<p class="pp2-fine">Only workspace admins can change these rules.</p>` : ""}
        ${draft ? `<form data-pp2-policy-form class="pp2-policy-form">
          <label>Content ceiling<select name="maxContentRating">${["everyone", "teen", "mature"].map((r) => `<option value="${r}" ${draft.maxContentRating === r ? "selected" : ""}>${r}</option>`).join("")}</select></label>
          <label>Daily minutes (blank = plan default)<input name="dailyMinuteLimit" type="number" min="0" max="1440" value="${draft.dailyMinuteLimit ?? ""}"/></label>
          <label class="pp2-check"><input type="checkbox" name="allowCommunityGames" ${draft.allowCommunityGames ? "checked" : ""}/> Allow community games</label>
          <label class="pp2-check"><input type="checkbox" name="allowRooms" ${draft.allowRooms ? "checked" : ""}/> Allow private rooms</label>
          <fieldset><legend>Approved games (none checked = all allowed)</legend>${builtIns.map((game) => `<label class="pp2-check"><input type="checkbox" name="approved" value="${esc(game.id)}" ${draft.approvedGameIds.includes(game.id) ? "checked" : ""}/> ${esc(game.title)}</label>`).join("")}</fieldset>
          <div><button type="submit" class="pp2-play">Save policy</button><button type="button" class="pp2-ghost" data-pp2-policy-cancel>Cancel</button></div>
        </form>` : ""}
        ${ui.policyMessage ? `<p class="pp2-fine">${esc(ui.policyMessage)}</p>` : ""}
      </section>
      <section class="pp2-panel"><h3>Leaderboards</h3>
        <label>Game<select data-pp2-board-game><option value="">Pick a game…</option>${builtIns.map((game) => `<option value="${esc(game.id)}" ${ui.leaderboardGameId === game.id ? "selected" : ""}>${esc(game.title)}</option>`).join("")}</select></label>
        ${board ? (board.rows.length ? `<ol class="pp2-board">${board.rows.map((entry) => `<li><b>${esc(entry.label)}</b><span>${entry.bestScore}</span></li>`).join("")}</ol>` : empty("No scores yet", "Scores appear after workspace members finish runs.")) : ""}
      </section>
    </div>`}
  </div>`;
}

/* ---- LIBRARY ---- */
function filteredCatalog() {
  const query = ui.query.toLowerCase();
  return sortGames(ui.snapshot.catalog).filter((game) => !query || `${game.title} ${game.summary} ${game.developer} ${game.tags.join(" ")}`.toLowerCase().includes(query));
}
function renderLibrary() {
  const games = filteredCatalog();
  return `<div class="pp2-library">
    <div class="pp2-tools"><input type="search" data-pp2-search value="${esc(ui.query)}" placeholder="Search games, developers, tags…"/><div class="pp2-cats">${GAME_SORTS.map((cat) => `<button type="button" class="${ui.category === cat ? "is-active" : ""}" data-pp2-cat="${esc(cat)}">${esc(cat)}</button>`).join("")}</div></div>
    ${games.length ? `<div class="pp2-grid pp2-grid-wide">${games.map((game) => card(game)).join("")}</div>` : empty("No matching games", "Try another search or category.")}
  </div>`;
}

/* ---- DEV HUB ---- */
const ASSIST_BRIEFS = {
  icon: (game) => `Design a square game icon for "${game.title}" — ${game.summary} Terminal-inspired, dark background (#05070a), phosphor green accents, no text, crisp at 64px.`,
  trailer: (game) => `Cut a 20-second gameplay trailer for "${game.title}". ${game.summary} Dark terminal aesthetic, fast cuts, end card with the title in monospace green on black.`,
  copy: (game) => `Write a store description for the game "${game.title}" (category: ${game.category}). One-line hook, three feature bullets, and a closing call to play. Tone: confident indie, no hype words. Current summary: ${game.summary}`,
  social: (game) => `Draft 3 short social posts announcing "${game.title}" on PhantomPlay — one playful, one feature-focused, one for game developers. Include the hook: ${game.summary}`,
  patch: (game) => `Write patch notes for the next release of "${game.title}" from these raw notes: [paste your changes]. Keep them player-facing, grouped by Added/Changed/Fixed.`,
};
function renderDeveloper() {
  const snapshot = ui.snapshot;
  if (!snapshot.access.canSubmitGames) return empty("Dev Hub is plan-gated", "This account can play games but cannot publish releases. Owners can enable game submissions per plan.");
  const editing = snapshot.submissions.find((item) => item.id === ui.editingSubmissionId) || null;
  const analytics = ui.analytics;
  const assistGames = [...snapshot.submissions.map((s) => ({ id: `community:${s.id}`, title: s.title, summary: s.summary, category: s.category })), ...(isAdmin() ? snapshot.catalog.filter((g) => g.kind === "built_in") : [])];
  return `<div class="pp2-devhub">
    <section class="pp2-lead"><h2>Dev Hub</h2><p>Publish to PhantomPlay and let PhantomForce act as your publishing team. Analytics below are computed from real play sessions — no vanity numbers.</p></section>
    <section class="pp2-panel"><h3>Analytics</h3>
      ${ui.v2Offline ? v2Note("Analytics need the PhantomForce server.") : analytics ? (analytics.games.length ? `<div class="pp2-table-wrap"><table class="pp2-table"><thead><tr><th>Game</th><th>Plays</th><th>Players</th><th>DAU</th><th>MAU</th><th>Hours</th><th>Avg session</th><th>Returning</th><th>Rating</th><th>Wishlists</th></tr></thead><tbody>${analytics.games.map((row) => `<tr><td>${esc(row.title)}</td><td>${row.plays}</td><td>${row.players}</td><td>${row.dau}</td><td>${row.mau}</td><td>${row.totalHours}</td><td>${row.avgSessionMinutes}m</td><td>${row.returningPlayers}</td><td>${row.averageRating ?? "—"} (${row.reviewCount})</td><td>${row.wishlists}</td></tr>`).join("")}</tbody></table></div>` : empty("No analytics yet", "Numbers appear once your published games are played.")) : `<button type="button" class="pp2-ghost" data-pp2-load-analytics>Load analytics</button>`}
    </section>
    <section class="pp2-panel"><h3>Publishing assists</h3>
      <p class="pp2-fine">Each button copies a production-ready brief to your clipboard — paste it into Media Lab (art, trailers), Content Hub (posts), or Phantom chat (copy, patch notes). Honest by design: nothing is generated behind your back.</p>
      ${assistGames.length ? `<div class="pp2-assist"><select data-pp2-assist-game>${assistGames.map((game) => `<option value="${esc(game.id)}">${esc(game.title)}</option>`).join("")}</select>
      <div class="pp2-assist-buttons">${Object.entries({ icon: "Icon brief", trailer: "Trailer brief", copy: "Store copy brief", social: "Social posts brief", patch: "Patch notes brief" }).map(([key, label]) => `<button type="button" class="pp2-ghost" data-pp2-assist="${key}">${label}</button>`).join("")}</div></div>
      ${ui.assistMessage ? `<p class="pp2-fine">${esc(ui.assistMessage)}</p>` : ""}` : empty("No games yet", "Save a submission below and the assists unlock.")}
    </section>
    <section class="pp2-panel"><h3>${editing ? "Update release" : "New submission"}</h3>
      <form class="pp2-submit" data-pp2-submit>
        <input type="hidden" name="submissionId" value="${esc(editing?.id || "")}"/>
        <div class="pp2-form-grid">
          <label>Title<input name="title" value="${esc(editing?.title || "")}" maxlength="90" required/></label>
          <label>Version<input name="version" value="${esc(editing?.version || "1.0.0")}" required/></label>
          <label>Category<select name="category">${[...CATEGORIES.filter((c) => c !== "All"), "Other"].map((c) => `<option ${editing?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
          <label>Rating<select name="contentRating">${["everyone", "teen", "mature"].map((r) => `<option value="${r}" ${editing?.contentRating === r ? "selected" : ""}>${r}</option>`).join("")}</select></label>
        </div>
        <label>One-line summary<input name="summary" value="${esc(editing?.summary || "")}" maxlength="180" required/></label>
        <label>Description<textarea name="description" rows="4" maxlength="3000" required>${esc(editing?.description || "")}</textarea></label>
        <label>Launch URL<input name="launchUrl" value="${esc(editing?.launchUrl || "")}" placeholder="https://… or /app/games/community/…" required/></label>
        <label>Screenshots (one URL per line)<textarea name="screenshots" rows="2" required>${esc(editing?.screenshots?.join("\n") || "")}</textarea></label>
        <div class="pp2-form-grid">
          <label>Controls<input name="controls" value="${esc(editing?.controls || "")}" maxlength="240" required/></label>
          <label>Tags<input name="tags" value="${esc(editing?.tags?.join(", ") || "")}"/></label>
        </div>
        <label>Player data used<textarea name="dataHandling" rows="2" maxlength="600" required>${esc(editing?.dataHandling || "")}</textarea></label>
        <label>Release notes<textarea name="releaseNotes" rows="2"></textarea></label>
        <div><button type="submit" name="action" value="draft" class="pp2-ghost">Save draft</button><button type="submit" name="action" value="submit" class="pp2-play">${editing ? "Resubmit" : "Submit for review"}</button>${editing ? `<button type="button" class="pp2-ghost" data-pp2-cancel-edit>Cancel</button>` : ""}</div>
        <p data-pp2-form-message class="pp2-fine"></p>
      </form>
    </section>
    <section class="pp2-panel"><h3>Your releases</h3>
      ${snapshot.submissions.length ? snapshot.submissions.map((item) => `<div class="pp2-sub"><header><b>${esc(item.title || "Untitled")}</b><span class="is-${esc(item.status)}">${esc(item.status.replaceAll("_", " "))}</span></header><p>${esc(item.summary || "")}</p><footer><span>v${esc(item.version)} · ${item.versions.length} versions</span>${["draft", "changes_requested", "rejected"].includes(item.status) ? `<button type="button" class="pp2-ghost" data-pp2-edit="${esc(item.id)}">Edit</button>` : ""}</footer>${item.moderationNote ? `<blockquote>${esc(item.moderationNote)}</blockquote>` : ""}</div>`).join("") : empty("No releases yet", "Save a draft or submit a finished game for review.")}
    </section>
  </div>`;
}

/* ---- ADMIN ---- */
function renderAdmin() {
  if (!ui.snapshot.access.canModerate) return empty("Moderation is protected", "Platform admin access is required.");
  return `<section class="pp2-panel"><h3>Review queue · ${ui.snapshot.submissions.length}</h3>
    ${ui.snapshot.submissions.length ? ui.snapshot.submissions.map((item) => `<div class="pp2-sub"><header><b>${esc(item.title || "Untitled")}</b><span class="is-${esc(item.status)}">${esc(item.status.replaceAll("_", " "))}</span></header><p>${esc(item.summary || "")} — ${esc(item.developerName)}</p>
      <div class="pp2-moderate"><input type="text" data-pp2-note="${esc(item.id)}" maxlength="1000" placeholder="Moderation note"/><label class="pp2-check"><input type="checkbox" data-pp2-featured="${esc(item.id)}"/> Feature</label>
      <div>${["approved", "changes_requested", "rejected", "disabled"].map((decision) => `<button type="button" class="pp2-ghost" data-pp2-moderate="${decision}" data-id="${esc(item.id)}">${decision.replaceAll("_", " ")}</button>`).join("")}</div></div></div>`).join("") : empty("Queue clear", "No submissions waiting.")}
  </section>`;
}

/* ---- GAME DETAIL ---- */
function renderDetail() {
  if (!ui.detailId) return "";
  const game = gameById(ui.detailId);
  if (!game) return "";
  const page = ui.detail;
  const my = page?.myReview;
  const draft = ui.reviewDraft;
  return `<div class="pp2-detail-backdrop" data-pp2-close-detail><article class="pp2-detail" role="dialog" aria-modal="true" aria-label="${esc(game.title)}" data-pp2-detail-panel>
    <button type="button" class="pp2-detail-close" data-pp2-close-detail-btn aria-label="Close">×</button>
    <div class="pp2-detail-hero">${art(game)}<div><p class="pp2-kicker">${esc(game.category)} · v${esc(game.version)} · ${esc(game.contentRating)}</p><h1>${esc(game.title)}</h1><p>${esc(game.summary)}</p>
      <div class="pp2-detail-actions"><button class="pp2-play" data-pp2-play="${esc(game.id)}">Play</button>
      <button type="button" class="pp2-ghost ${wishlisted(game.id) ? "is-on" : ""}" data-pp2-wish="${esc(game.id)}" ${ui.v2Offline ? "disabled" : ""}>${wishlisted(game.id) ? "♥ Wishlisted" : "♡ Wishlist"}</button>
      <button type="button" class="pp2-ghost ${page?.developerFollowed ? "is-on" : ""}" data-pp2-follow="${esc(game.developer)}" ${ui.v2Offline ? "disabled" : ""}>${page?.developerFollowed ? "Following" : "Follow"} ${esc(game.developer)}</button></div></div></div>
    ${page ? `<div class="pp2-detail-stats"><span><b>${page.stats.players}</b>players</span><span><b>${page.stats.plays}</b>plays</span><span><b>${page.stats.totalHours}</b>hours</span><span><b>${page.stats.averageRating ?? "—"}</b>${page.stats.reviewCount} reviews</span><span><b>${page.stats.bestScore || "—"}</b>top score</span></div>` : ui.detailBusy ? `<p class="pp2-fine">Loading stats…</p>` : ui.v2Offline ? v2Note("Stats and reviews need the PhantomForce server.") : ""}
    <p class="pp2-detail-desc">${esc(game.description)}</p>
    <p class="pp2-fine">Controls: ${esc(game.controls || "Keyboard and touch")}</p>
    ${page ? `<div class="pp2-cols">
      <section><h3>Reviews</h3>
        <form data-pp2-review class="pp2-review-form">${stars(draft.rating || my?.rating || 0, true)}<textarea name="text" rows="2" maxlength="1200" placeholder="${my ? "Update your review…" : "What did you think?"}">${esc(draft.text || my?.text || "")}</textarea><button type="submit" class="pp2-play">${my ? "Update review" : "Post review"}</button><span data-pp2-review-msg class="pp2-fine"></span></form>
        ${page.reviews.length ? page.reviews.map((entry) => `<div class="pp2-review"><header><b>${esc(entry.actorLabel)}</b>${stars(entry.rating)}</header><p>${esc(entry.text)}</p></div>`).join("") : empty("No reviews yet", "Be the first to review it.")}
      </section>
      <section>
        <h3>Patch notes</h3><ul class="pp2-notes">${page.patchNotes.map((note) => `<li><b>v${esc(note.version)}</b><span>${esc(note.notes)}</span></li>`).join("")}</ul>
        ${page.leaderboard.length ? `<h3>Top scores</h3><ol class="pp2-board">${page.leaderboard.map((entry) => `<li><b>${esc(entry.label)}</b><span>${entry.bestScore}</span></li>`).join("")}</ol>` : ""}
      </section>
    </div>
    ${page.related.length ? row("More like this", page.related) : ""}` : ""}
  </article></div>`;
}

/* ---- SETTINGS / PLAYER ---- */
function settingsMarkup() {
  if (!ui.settingsOpen) return "";
  const p = ui.snapshot.preferences;
  return `<aside class="pp2-settings"><header><h2>Play settings</h2><button data-pp2-settings-close aria-label="Close">×</button></header>
    <label>Content allowed<select data-pp2-pref="contentRating">${["everyone", "teen", "mature"].map((r) => `<option value="${r}" ${p.contentRating === r ? "selected" : ""}>${r}</option>`).join("")}</select></label>
    <label class="pp2-check"><input type="checkbox" data-pp2-pref="sound" ${p.sound ? "checked" : ""}/> Sound</label>
    <label class="pp2-check"><input type="checkbox" data-pp2-pref="reducedMotion" ${p.reducedMotion ? "checked" : ""}/> Reduce motion</label>
    <label class="pp2-check"><input type="checkbox" data-pp2-pref="allowCommunityGames" ${p.allowCommunityGames ? "checked" : ""}/> Show community games</label>
    ${ratingExposureMarkup()}
    <p class="pp2-fine">PhantomPlay never touches your work, agents, files, or business data.</p></aside>`;
}

// Game Rating Exposure — mirrors the V1 panel exactly against the same
// PATCH /api/phantomplay/profile route (updatePhantomPlayProfile). A
// guardian PIN field appears whenever this profile has an enabled guardian
// lock and isn't an adult profile; the server enforces the PIN.
function ratingExposureMarkup() {
  const snapshot = ui.snapshot;
  const allowed = new Set(Array.isArray(snapshot.preferences.allowedRatings) ? snapshot.preferences.allowedRatings : ALL_RATING_VALUES);
  const profileType = snapshot.profileType || "adult";
  const guardianEnabled = !!snapshot.guardianLock?.enabled;
  const needsPin = guardianEnabled && profileType !== "adult";
  return `<div class="pp2-rating-exposure">
    <h3>Game Rating Exposure</h3>
    <p class="pp2-fine">Choose exactly which content tiers can appear in this profile's catalog.</p>
    ${needsPin ? `<label>Guardian PIN<input type="password" inputmode="numeric" maxlength="32" data-pp2-exposure-pin placeholder="Required to change exposure"/></label>` : ""}
    <div class="pp2-rating-toggles">${RATING_TIERS.map(([value, label]) => `<label class="pp2-check"><input type="checkbox" data-pp2-rating-toggle="${value}" ${allowed.has(value) ? "checked" : ""} ${ui.ratingBusy ? "disabled" : ""}/> ${esc(label)}</label>`).join("")}</div>
    <div class="pp2-rating-presets">
      <button type="button" class="pp2-ghost" data-pp2-rating-preset="my-age" ${ui.ratingBusy ? "disabled" : ""}>My age</button>
      <button type="button" class="pp2-ghost" data-pp2-rating-preset="family" ${ui.ratingBusy ? "disabled" : ""}>Family Friendly Only</button>
      <button type="button" class="pp2-ghost" data-pp2-rating-preset="all" ${ui.ratingBusy ? "disabled" : ""}>Show All Allowed Ratings</button>
    </div>
    <label>Profile type<select data-pp2-profile-type><option value="adult" ${profileType === "adult" ? "selected" : ""}>Adult</option><option value="child" ${profileType === "child" ? "selected" : ""}>Child</option><option value="toddler" ${profileType === "toddler" ? "selected" : ""}>Toddler</option></select></label>
    <div class="pp2-guardian-lock">
      <label class="pp2-check"><input type="checkbox" data-pp2-guardian-enabled ${guardianEnabled ? "checked" : ""}/> Guardian PIN lock</label>
      <p class="pp2-fine">When on, a PIN is required to widen this profile's rating exposure or change its profile type.</p>
      <div class="pp2-guardian-pin-row"><input type="password" inputmode="numeric" maxlength="32" data-pp2-guardian-pin-input placeholder="${guardianEnabled ? "Current PIN, to change" : "Set a PIN (4+ digits)"}"/><button type="button" class="pp2-play" data-pp2-guardian-save>Save</button></div>
    </div>
    ${ui.guardianMessage ? `<p class="pp2-fine">${esc(ui.guardianMessage)}</p>` : ""}
  </div>`;
}
function playerMarkup() {
  if (!ui.player) return "";
  const { game, play } = ui.player;
  return `<div class="pp2-player" role="dialog" aria-modal="true" aria-label="Playing ${esc(game.title)}"><header><div><b>${esc(game.title)}</b><i>${esc(game.controls || "")}</i></div><div><button data-pp2-player-restart>Restart</button><button data-pp2-player-pause>${ui.playerPaused ? "Resume" : "Pause"}</button><button data-pp2-player-full>Full screen</button><button data-pp2-player-close aria-label="Close">×</button></div></header>
    <div class="pp2-stage"><div class="pp2-stage-loading" ${ui.playerReady ? "hidden" : ""}><i></i><b>Loading ${esc(game.title)}…</b><span>Opening in a private sandbox.</span></div>
    <iframe src="${esc(game.launchUrl)}" title="${esc(game.title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" allow="fullscreen" data-pp2-frame></iframe></div>
    <footer><span>Session ${esc(String(play.id).slice(-8))}</span><span data-pp2-live-score>Score —</span><span>${ui.resume?.state ? "Resume state loaded" : "Progress saves automatically"}</span></footer></div>`;
}

/* ---- shell ---- */
function render() {
  if (!mountedRoot) return;
  document.body.classList.toggle("phantomplay-playing", !!ui.player);
  if (ui.loading && !ui.snapshot) { mountedRoot.innerHTML = `<div class="pp2-shell">${skeletonRow("PhantomPlay")}</div>`; return; }
  const snapshot = ui.snapshot || offlineState();
  const tabs = [["solo", "Games"], ["friends", "Multiplayer"], ["library", "Library"], ["workspace", "Rules"], ["developer", "Developers"], ...(snapshot.access.canModerate ? [["admin", "Admin"]] : [])];
  const view = { home: renderHome, solo: renderSolo, friends: renderFriends, workspace: renderWorkspace, library: renderLibrary, developer: renderDeveloper, admin: renderAdmin }[ui.tab] || renderSolo;
  mountedRoot.innerHTML = `<div class="pp2-shell">
    <header class="pp2-top"><div><p class="pp2-kicker">PHANTOMFORCE ENTERTAINMENT</p><h1>PhantomPlay</h1><span>Work hard. Take a real break. Come back sharper.</span></div>
      <div class="pp2-top-right"><span class="pp2-access ${snapshot.access.enabled ? "is-on" : "is-off"}">${snapshot.access.enabled ? esc(playTimeLabel(snapshot.access.remainingMinutesToday)) : "Plan restricted"}</span><button class="pp2-ghost" data-pp2-settings aria-label="Play settings">Settings</button><button class="pp2-ghost" data-pp2-classic title="Return to the classic PhantomPlay experience">Classic view</button></div></header>
    ${ui.offline ? `<div class="pp2-banner"><b>Offline mode</b><span>Built-in games still work; saves sync when the server returns.</span><button data-pp2-retry>Retry</button></div>` : ""}
    ${ui.error && !ui.offline ? `<div class="pp2-banner is-error"><b>PhantomPlay needs attention</b><span>${esc(ui.error)}</span><button data-pp2-retry>Retry</button></div>` : ""}
    <nav class="pp2-tabs" aria-label="PhantomPlay experiences">${tabs.map(([id, label]) => `<button type="button" class="${ui.tab === id ? "is-active" : ""}" data-pp2-tab="${id}">${esc(label)}</button>`).join("")}</nav>
    <main class="pp2-content">${snapshot.access.enabled ? view() : empty("PhantomPlay is unavailable", "Ask your business owner to enable PhantomPlay for this plan.")}</main>
    ${renderDetail()}${settingsMarkup()}${playerMarkup()}
  </div>`;
  bind();
}

/* ---- actions ---- */
async function openDetail(gameId) {
  ui.detailId = gameId; ui.detail = null; ui.detailBusy = true; ui.reviewDraft = { rating: 0, text: "" }; render();
  if (!ui.v2Offline) {
    try { ui.detail = await api(`/api/phantomplay/v2/games/${encodeURIComponent(gameId)}?${tenantQuery()}`); } catch { ui.detail = null; }
  }
  ui.detailBusy = false; render();
}
async function toggleWishlist(gameId) {
  if (ui.v2Offline) return;
  const on = !wishlisted(gameId);
  try {
    const result = await api(`/api/phantomplay/v2/games/${encodeURIComponent(gameId)}/wishlist`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), on }) });
    if (ui.v2) ui.v2.wishlist = result.wishlist;
    render();
  } catch (error) { ui.error = error.message; render(); }
}
async function launch(gameId) {
  const game = gameById(gameId);
  if (!game?.launchUrl) { ui.error = "This game is not available to play yet."; render(); return; }
  ui.detailId = null; ui.detail = null;
  try {
    const [result, resume] = await Promise.all([
      ui.offline ? Promise.resolve({ game, play: { id: `offline-${Date.now()}`, gameId, seconds: 0, score: null, progress: historyFor(gameId)?.progress || 0 } }) : api("/api/phantomplay/plays", { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), gameId }) }),
      ui.v2Offline ? Promise.resolve(null) : api(`/api/phantomplay/v2/resume/${encodeURIComponent(gameId)}?${tenantQuery()}`).catch(() => null),
    ]);
    ui.player = { game: result.game || game, play: result.play };
    ui.resume = resume;
    ui.playerReady = false; ui.playerPaused = false; playTickAt = Date.now();
    render(); startClock(); heartbeat();
  } catch (error) { ui.error = error.message; render(); }
}
function startClock() { clearInterval(playClock); playClock = setInterval(() => persistPlay(false), 15000); }
async function persistPlay(ended, detail = {}) {
  if (!ui.player) return;
  const delta = Math.max(0, Math.min(60, Math.round((Date.now() - playTickAt) / 1000)));
  playTickAt = Date.now();
  Object.assign(ui.player.play, { seconds: (ui.player.play.seconds || 0) + delta, score: detail.score ?? ui.player.play.score, progress: detail.progress ?? ui.player.play.progress });
  const existing = historyFor(ui.player.game.id);
  const progress = ui.player.play.progress || 0;
  const rowData = { gameId: ui.player.game.id, lastPlayedAt: new Date().toISOString(), score: Math.max(existing?.score || 0, ui.player.play.score || 0), progress, seconds: (existing?.seconds || 0) + delta, canContinue: progress > 0 && progress < 100 };
  ui.snapshot.history = [rowData, ...ui.snapshot.history.filter((item) => item.gameId !== rowData.gameId)];
  if (ui.offline) { saveOffline(); return; }
  try { await api(`/api/phantomplay/plays/${encodeURIComponent(ui.player.play.id)}`, { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), secondsDelta: delta, score: detail.score, progress: detail.progress, state: detail.state, ended }) }); }
  catch { ui.offline = true; saveOffline(); }
}
async function closePlayer() {
  clearInterval(playClock);
  await persistPlay(true);
  ui.player = null; ui.playerReady = false; ui.playerPaused = false; ui.resume = null;
  document.body.classList.remove("phantomplay-playing");
  heartbeat(); render();
}
function postToGame(type, extra = {}) {
  const frame = mountedRoot?.querySelector("[data-pp2-frame]");
  frame?.contentWindow?.postMessage({ source: "phantomplay-host", type, ...extra }, "*");
  frame?.focus?.({ preventScroll: true });
}
function onGameMessage(event) {
  const frame = mountedRoot?.querySelector("[data-pp2-frame]");
  if (!ui.player || !frame || event.source !== frame.contentWindow || !event.data || event.data.source !== "phantomplay-game") return;
  if (event.data.type === "ready") {
    ui.playerReady = true;
    mountedRoot.querySelector(".pp2-stage-loading")?.setAttribute("hidden", "");
    postToGame("settings", { sound: ui.snapshot.preferences.sound, reducedMotion: ui.snapshot.preferences.reducedMotion });
    if (ui.resume?.state) postToGame("restore", { state: ui.resume.state });
  }
  if (event.data.type === "paused") {
    ui.playerPaused = !!event.data.paused;
    const button = mountedRoot.querySelector("[data-pp2-player-pause]");
    if (button) button.textContent = ui.playerPaused ? "Resume" : "Pause";
  }
  if (event.data.type === "score" || event.data.type === "progress" || event.data.type === "complete") {
    const detail = { score: Number(event.data.score) || undefined, progress: event.data.type === "complete" ? 100 : Number(event.data.progress) || undefined, state: event.data.state };
    const live = mountedRoot.querySelector("[data-pp2-live-score]");
    if (live && detail.score !== undefined) live.textContent = `Score ${detail.score}`;
    persistPlay(event.data.type === "complete", detail);
  }
}

async function friendAction(actorId, action) {
  try {
    await api("/api/phantomplay/v2/friends", { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), actorId, action }) });
    const v2 = await api(`/api/phantomplay/v2?${tenantQuery()}`);
    ui.v2 = v2; render();
  } catch (error) { ui.error = error.message; render(); }
}
async function submitReview(form) {
  const message = form.querySelector("[data-pp2-review-msg]");
  const rating = ui.reviewDraft.rating || ui.detail?.myReview?.rating || 0;
  const text = form.querySelector("textarea").value;
  if (!rating) { message.textContent = "Pick a star rating first."; return; }
  message.textContent = "Saving…";
  try {
    await api(`/api/phantomplay/v2/games/${encodeURIComponent(ui.detailId)}/review`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), rating, text }) });
    await openDetail(ui.detailId);
  } catch (error) { message.textContent = error.message; }
}
async function submitGame(form, submitter) {
  const message = form.querySelector("[data-pp2-form-message]");
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  const submissionId = String(payload.submissionId || "");
  delete payload.submissionId;
  payload.tenantId = currentTenantId();
  payload.submit = submitter?.value === "submit";
  payload.screenshots = String(payload.screenshots || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  payload.tags = String(payload.tags || "").split(",").map((s) => s.trim()).filter(Boolean);
  message.textContent = payload.submit ? "Sending for review…" : "Saving draft…";
  try {
    await api(submissionId ? `/api/phantomplay/submissions/${encodeURIComponent(submissionId)}` : "/api/phantomplay/submissions", { method: submissionId ? "PATCH" : "POST", body: JSON.stringify(payload) });
    message.textContent = payload.submit ? "Submitted for review." : "Draft saved.";
    ui.editingSubmissionId = null;
    await hydrate();
  } catch (error) { message.textContent = error.message; }
}
async function savePolicy(form) {
  const data = new FormData(form);
  const approved = data.getAll("approved").map(String);
  const minutesRaw = String(data.get("dailyMinuteLimit") || "").trim();
  ui.policyMessage = "Saving policy…"; render();
  try {
    const result = await api("/api/phantomplay/v2/workspace-policy", { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), approvedGameIds: approved, maxContentRating: String(data.get("maxContentRating") || "teen"), dailyMinuteLimit: minutesRaw === "" ? null : Number(minutesRaw), allowCommunityGames: data.get("allowCommunityGames") === "on", allowRooms: data.get("allowRooms") === "on" }) });
    if (ui.v2) { ui.v2.policy = result.policy; ui.v2.policyIsDefault = false; }
    ui.policyDraft = null; ui.policyMessage = "Policy saved for this workspace.";
  } catch (error) { ui.policyMessage = error.message; }
  render();
}
async function loadLeaderboard(gameId) {
  ui.leaderboardGameId = gameId; ui.leaderboard = null; render();
  if (!gameId || ui.v2Offline) return;
  try { ui.leaderboard = await api(`/api/phantomplay/v2/leaderboard/${encodeURIComponent(gameId)}?${tenantQuery()}`); } catch { ui.leaderboard = { rows: [] }; }
  render();
}
async function copyAssist(kind) {
  const select = mountedRoot.querySelector("[data-pp2-assist-game]");
  const id = select?.value || "";
  const game = gameById(id) || ui.snapshot.submissions.map((s) => ({ id: `community:${s.id}`, title: s.title, summary: s.summary, category: s.category })).find((g) => g.id === id);
  if (!game) return;
  const brief = ASSIST_BRIEFS[kind]?.(game) || "";
  try { await navigator.clipboard.writeText(brief); ui.assistMessage = `Brief copied — paste it into ${kind === "icon" || kind === "trailer" ? "Media Lab" : kind === "social" ? "Content Hub" : "Phantom chat"}.`; }
  catch { ui.assistMessage = brief; }
  render();
}
async function moderate(button) {
  const featured = mountedRoot.querySelector(`[data-pp2-featured="${CSS.escape(button.dataset.id)}"]`)?.checked || false;
  const note = mountedRoot.querySelector(`[data-pp2-note="${CSS.escape(button.dataset.id)}"]`)?.value.trim() || (button.dataset.pp2Moderate === "approved" ? "Passed PhantomPlay review." : "No note supplied.");
  try {
    await api(`/api/phantomplay/submissions/${encodeURIComponent(button.dataset.id)}/moderate`, { method: "POST", body: JSON.stringify({ decision: button.dataset.pp2Moderate, featured, note }) });
    await hydrate();
  } catch (error) { ui.error = error.message; render(); }
}
async function updatePreferences() {
  if (ui.offline) { saveOffline(); render(); return; }
  try {
    const payload = await api("/api/phantomplay/profile", { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), preferences: ui.snapshot.preferences }) });
    ui.snapshot.preferences = payload.preferences;
    await hydrate();
  } catch (error) { ui.error = error.message; render(); }
}

// A guardian PIN is only ever read from the DOM at call time (never cached
// in `ui`), so each attempt requires re-entering it.
function guardianPinFromDom() {
  return mountedRoot?.querySelector("[data-pp2-exposure-pin]")?.value.trim() || undefined;
}
async function applyRatingExposure(nextRatings) {
  if (ui.offline) { ui.guardianMessage = "Rating exposure needs the PhantomForce server."; render(); return; }
  ui.ratingBusy = true; render();
  try {
    const payload = await api("/api/phantomplay/profile", { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), preferences: { allowedRatings: nextRatings }, guardianPin: guardianPinFromDom() }) });
    ui.snapshot.preferences = payload.preferences;
    ui.guardianMessage = "";
  } catch (error) { ui.guardianMessage = error.message; }
  finally { ui.ratingBusy = false; render(); }
}
async function applyProfileType(nextType) {
  if (ui.offline) { ui.guardianMessage = "Profile type needs the PhantomForce server."; render(); return; }
  ui.ratingBusy = true; render();
  try {
    const payload = await api("/api/phantomplay/profile", { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), profileType: nextType, guardianPin: guardianPinFromDom() }) });
    ui.snapshot.profileType = payload.profileType;
    ui.snapshot.preferences = payload.preferences;
    ui.guardianMessage = "";
  } catch (error) { ui.guardianMessage = error.message; }
  finally { ui.ratingBusy = false; render(); }
}
async function saveGuardianLock() {
  const checkbox = mountedRoot?.querySelector("[data-pp2-guardian-enabled]");
  const pinInput = mountedRoot?.querySelector("[data-pp2-guardian-pin-input]");
  const nextEnabled = !!checkbox?.checked;
  const pin = pinInput?.value.trim() || "";
  if (nextEnabled && pin && pin.length < 4) { ui.guardianMessage = "Choose a PIN with at least 4 digits."; render(); return; }
  if (ui.offline) { ui.guardianMessage = "Guardian lock needs the PhantomForce server."; render(); return; }
  try {
    const payload = await api("/api/phantomplay/profile", { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), guardianLock: { enabled: nextEnabled, pin: pin || undefined }, guardianPin: guardianPinFromDom() }) });
    ui.snapshot.guardianLock = payload.guardianLock;
    ui.guardianMessage = nextEnabled ? "Guardian PIN saved." : "Guardian PIN lock turned off.";
  } catch (error) { ui.guardianMessage = error.message; }
  render();
}

/* ---- bind ---- */
function bind() {
  const on = (selector, event, handler) => mountedRoot.querySelectorAll(selector).forEach((el) => el.addEventListener(event, handler));
  mountedRoot.querySelectorAll("[data-pp2-tab]").forEach((b) => b.onclick = () => { ui.tab = b.dataset.pp2Tab; if (ui.tab === "developer" && !ui.analytics && !ui.v2Offline) loadAnalytics(); render(); });
  mountedRoot.querySelectorAll("[data-pp2-play]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); launch(b.dataset.pp2Play); });
  mountedRoot.querySelectorAll("[data-pp2-open]").forEach((b) => b.addEventListener("click", (e) => { if (e.target.closest("[data-pp2-play],[data-pp2-wish]")) return; openDetail(b.dataset.pp2Open); }));
  mountedRoot.querySelectorAll("[data-pp2-wish]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); toggleWishlist(b.dataset.pp2Wish); });
  mountedRoot.querySelectorAll("[data-pp2-cat]").forEach((b) => b.onclick = () => { ui.category = b.dataset.pp2Cat; render(); });
  on("[data-pp2-search]", "input", (e) => { ui.query = e.target.value; const grid = mountedRoot.querySelector(".pp2-grid-wide"); if (grid) { grid.innerHTML = filteredCatalog().map((game) => card(game)).join("") || ""; bind(); } });
  on("[data-pp2-retry]", "click", hydrate);
  on("[data-pp2-classic]", "click", () => { try { localStorage.setItem("pf.phantomplay.v2", "0"); } catch {} location.reload(); });
  on("[data-pp2-settings]", "click", () => { ui.settingsOpen = true; render(); });
  on("[data-pp2-settings-close]", "click", () => { ui.settingsOpen = false; render(); });
  mountedRoot.querySelectorAll("[data-pp2-pref]").forEach((input) => input.onchange = () => { ui.snapshot.preferences[input.dataset.pp2Pref] = input.type === "checkbox" ? input.checked : input.value; updatePreferences(); });
  mountedRoot.querySelectorAll("[data-pp2-rating-toggle]").forEach((input) => input.onchange = () => {
    const next = [...mountedRoot.querySelectorAll("[data-pp2-rating-toggle]:checked")].map((el) => el.dataset.pp2RatingToggle);
    applyRatingExposure(next);
  });
  mountedRoot.querySelectorAll("[data-pp2-rating-preset]").forEach((b) => b.onclick = () => applyRatingExposure(ratingExposurePreset(b.dataset.pp2RatingPreset, ui.snapshot.profileType || "adult")));
  on("[data-pp2-profile-type]", "change", (e) => applyProfileType(e.target.value));
  on("[data-pp2-guardian-save]", "click", saveGuardianLock);
  on("[data-pp2-status]", "change", (e) => { ui.statusChoice = e.target.value; heartbeat(); });
  mountedRoot.querySelectorAll("[data-pp2-befriend]").forEach((b) => b.onclick = () => friendAction(b.dataset.pp2Befriend, "request"));
  mountedRoot.querySelectorAll("[data-pp2-accept]").forEach((b) => b.onclick = () => friendAction(b.dataset.pp2Accept, "accept"));
  mountedRoot.querySelectorAll("[data-pp2-decline]").forEach((b) => b.onclick = () => friendAction(b.dataset.pp2Decline, "remove"));
  mountedRoot.querySelectorAll("[data-pp2-unfriend]").forEach((b) => b.onclick = () => friendAction(b.dataset.pp2Unfriend, "remove"));
  on("[data-pp2-close-detail]", "click", (e) => { if (e.target === e.currentTarget) { ui.detailId = null; ui.detail = null; render(); } });
  on("[data-pp2-close-detail-btn]", "click", () => { ui.detailId = null; ui.detail = null; render(); });
  mountedRoot.querySelectorAll("[data-pp2-star]").forEach((b) => b.onclick = () => { ui.reviewDraft.rating = Number(b.dataset.pp2Star); ui.reviewDraft.text = mountedRoot.querySelector("[data-pp2-review] textarea")?.value || ""; render(); });
  const reviewForm = mountedRoot.querySelector("[data-pp2-review]");
  if (reviewForm) reviewForm.onsubmit = (e) => { e.preventDefault(); submitReview(reviewForm); };
  mountedRoot.querySelectorAll("[data-pp2-follow]").forEach((b) => b.onclick = async () => {
    if (ui.v2Offline) return;
    const onNow = !ui.detail?.developerFollowed;
    try { const result = await api("/api/phantomplay/v2/follows", { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), developer: b.dataset.pp2Follow, on: onNow }) }); if (ui.v2) ui.v2.follows = result.follows; if (ui.detail) ui.detail.developerFollowed = onNow; render(); } catch (error) { ui.error = error.message; render(); }
  });
  const submitForm = mountedRoot.querySelector("[data-pp2-submit]");
  if (submitForm) submitForm.onsubmit = (e) => { e.preventDefault(); submitGame(submitForm, e.submitter); };
  mountedRoot.querySelectorAll("[data-pp2-edit]").forEach((b) => b.onclick = () => { ui.editingSubmissionId = b.dataset.pp2Edit; render(); });
  on("[data-pp2-cancel-edit]", "click", () => { ui.editingSubmissionId = null; render(); });
  on("[data-pp2-load-analytics]", "click", loadAnalytics);
  mountedRoot.querySelectorAll("[data-pp2-assist]").forEach((b) => b.onclick = () => copyAssist(b.dataset.pp2Assist));
  on("[data-pp2-policy-edit]", "click", () => { ui.policyDraft = { ...ui.v2.policy, approvedGameIds: [...ui.v2.policy.approvedGameIds] }; render(); });
  on("[data-pp2-policy-cancel]", "click", () => { ui.policyDraft = null; render(); });
  const policyForm = mountedRoot.querySelector("[data-pp2-policy-form]");
  if (policyForm) policyForm.onsubmit = (e) => { e.preventDefault(); savePolicy(policyForm); };
  on("[data-pp2-board-game]", "change", (e) => loadLeaderboard(e.target.value));
  mountedRoot.querySelectorAll("[data-pp2-moderate]").forEach((b) => b.onclick = () => moderate(b));
  on("[data-pp2-player-close]", "click", closePlayer);
  on("[data-pp2-player-pause]", "click", () => { if (!ui.playerReady) return; ui.playerPaused = !ui.playerPaused; postToGame(ui.playerPaused ? "pause" : "resume"); const btn = mountedRoot.querySelector("[data-pp2-player-pause]"); if (btn) btn.textContent = ui.playerPaused ? "Resume" : "Pause"; });
  on("[data-pp2-player-restart]", "click", () => { if (ui.playerReady) { ui.playerPaused = false; postToGame("restart"); } });
  on("[data-pp2-player-full]", "click", () => mountedRoot.querySelector(".pp2-stage")?.requestFullscreen?.());
}
async function loadAnalytics() {
  if (ui.v2Offline) return;
  try { ui.analytics = await api(`/api/phantomplay/v2/developer/analytics?${tenantQuery()}`); } catch { ui.analytics = { games: [] }; }
  render();
}

/* ---- mount ---- */
export function renderPhantomPlay(root) {
  mountedRoot = root;
  if (!messageBound) { messageBound = true; window.addEventListener("message", onGameMessage); }
  if (!keyboardBound) {
    keyboardBound = true;
    window.addEventListener("keydown", (event) => {
      if (ui.player) {
        if (event.key === "Escape") { event.preventDefault(); closePlayer(); }
        return;
      }
      if (event.key === "Escape" && ui.detailId) { ui.detailId = null; ui.detail = null; render(); }
    });
  }
  clearInterval(heartbeatClock);
  heartbeatClock = setInterval(heartbeat, 45000);
  render();
  hydrate().then(heartbeat);
  return () => {
    clearInterval(playClock); clearInterval(heartbeatClock);
    document.body.classList.remove("phantomplay-playing");
    mountedRoot = null;
  };
}
