/* PhantomPlay V2 — the platform experience shell.
   Home / Solo / Friends / Workspace / Library / Developers (+ Admin) over the
   V1 APIs (/api/phantomplay/*) plus the V2 platform layer
   (/api/phantomplay/v2/*). V1's phantomplay.js is untouched; main.js mounts
   this module instead. Every V2 surface degrades honestly: if the V2 routes
   are missing or flagged off, social/community panels say so and every V1
   flow (catalog, play, saves, submissions, moderation) keeps working. */

import {
  currentTenantId, friendlyBackendError, isAdmin, session,
  workspaceStorageGetItem, workspaceStorageSetItem,
} from "./store.js?v=phantom-live-20260715-2";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const FALLBACK_KEY = "pf.phantomplay.offline.v1";
const DEV_SUPPORT_KEY = "pf.phantomplay.developerSupport.v1";
const CATEGORIES = ["All", "Arcade", "Puzzle", "Focus", "Strategy", "Sports", "Creative", "Kids"];
const KIDS_GAME_IDS = new Set(["reflex-grid", "rift-frenzy", "serpent-surge", "color-rush", "circuit-serpent"]);
const STATUSES = [["online", "Online"], ["away", "Away"], ["busy", "Busy"], ["invisible", "Invisible"]];

const ui = {
  tab: "home", loading: true, error: "", offline: false,
  snapshot: null, v2: null, v2Offline: false, discovery: null,
  query: "", category: "All",
  detailId: null, detail: null, detailBusy: false, reviewDraft: { rating: 0, text: "" },
  player: null, playerReady: false, playerPaused: false, resume: null,
  settingsOpen: false, editingSubmissionId: null,
  statusChoice: "online", friendTarget: "",
  analytics: null, leaderboardGameId: "", leaderboard: null,
  policyDraft: null, policyMessage: "", assistMessage: "",
  selectedDeveloperId: "", developerMessage: "",
};

let mountedRoot = null, playClock = null, playTickAt = 0, heartbeatClock = null, messageBound = false, keyboardBound = false;

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) { const err = new Error(friendlyBackendError(response.status, payload?.error, { authMessage: "Sign in to sync PhantomPlay.", fallbackPrefix: "PhantomPlay request failed" })); err.status = response.status; throw err; }
  return payload;
}
const tenantQuery = () => `tenant_id=${encodeURIComponent(currentTenantId())}`;

/* ---- offline fallback (built-ins only, local saves) ---- */
const OFFLINE_GAMES = [
  ["neon-drift", "Neon Drift", "Arcade", "/app/games/neon-drift.html"],
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
    preferences: { contentRating: "teen", sound: saved.sound !== false, reducedMotion: !!saved.reducedMotion, allowCommunityGames: true },
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
function isKidsGame(game) {
  return game?.category === "Kids" || KIDS_GAME_IDS.has(game?.id);
}
function visibleByCategory(game) {
  return ui.category === "Kids" ? isKidsGame(game) : ui.category === "All" ? !isKidsGame(game) : game.category === ui.category && !isKidsGame(game);
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
function slugifyDeveloper(value) {
  return String(value || "developer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "developer";
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
  const displayName = String(game?.developer || "Developer").trim() || "Developer";
  if (game?.kind === "built_in" || displayName.toLowerCase() === "tak") return { id: "developer:tak", name: "Tak" };
  const explicitId = firstPresent(game?.developerId, game?.developer_id, game?.ownerId, game?.owner_id, game?.accountId, game?.authorId, game?.submittedById);
  if (explicitId) return { id: `developer:${stableKeyPart(explicitId)}`, name: displayName };
  const gameIdentity = firstPresent(game?.id, game?.submissionId, game?.title, displayName);
  if (game?.kind === "community" || genericDeveloperName(displayName)) return { id: `community:${stableKeyPart(gameIdentity)}`, name: displayName };
  return { id: `developer:${stableKeyPart(displayName)}`, name: displayName };
}
function playableResume(resume) {
  const progress = Number(resume?.progress);
  if (!resume?.state || !Number.isFinite(progress) || progress <= 0 || progress >= 100) return null;
  return resume;
}
function loadDeveloperSupport() {
  try {
    const parsed = JSON.parse(workspaceStorageGetItem(DEV_SUPPORT_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
function saveDeveloperSupport(records) {
  workspaceStorageSetItem(DEV_SUPPORT_KEY, JSON.stringify(records || {}));
}
function developerAvatarFor(developer) {
  const game = developer?.games?.find((item) => item.thumbnail) || developer?.games?.[0];
  return game?.developerAvatar || game?.thumbnail || "";
}
function devScoreFor(developer, support = {}) {
  const games = Array.isArray(developer.games) ? developer.games : [];
  const base = 64;
  const gameScore = Math.min(16, games.length * 3);
  const featuredScore = Math.min(10, Number(developer.featuredCount || 0) * 2);
  const communityScore = Math.min(6, Number(developer.communityCount || 0) * 2);
  const supportScore = Math.min(8, Number(support.supportCount || 0) * 2);
  const noteScore = Math.min(4, Array.isArray(support.notes) ? support.notes.length : 0);
  return Math.max(0, Math.min(100, base + gameScore + featuredScore + communityScore + supportScore + noteScore));
}
function developerDirectory() {
  const directory = new Map();
  for (const game of ui.snapshot?.catalog || []) {
    const { id, name } = developerIdentityFor(game);
    if (!directory.has(id)) directory.set(id, { id, name, games: [], categories: new Set(), featuredCount: 0, communityCount: 0 });
    const entry = directory.get(id);
    entry.games.push(game);
    if (game.category) entry.categories.add(game.category);
    if (game.featured) entry.featuredCount += 1;
    if (game.kind === "community") entry.communityCount += 1;
  }
  const supportRecords = loadDeveloperSupport();
  return [...directory.values()].map((developer) => {
    const support = supportRecords[developer.id] || {};
    const normalized = {
      ...developer,
      categories: [...developer.categories].sort(),
      supportCount: Number(support.supportCount || 0),
      donationIntentCount: Number(support.donationIntentCount || 0),
      notes: Array.isArray(support.notes) ? support.notes : [],
      supported: Boolean(support.supportedAt),
      avatar: developerAvatarFor(developer),
    };
    return { ...normalized, score: devScoreFor(normalized, support) };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
function selectedDeveloper() {
  return developerDirectory().find((developer) => developer.id === ui.selectedDeveloperId) || null;
}
function dateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function developerCard(developer) {
  const previews = developer.games.slice(0, 4);
  return `<article class="pp2-dev-card" data-pp2-open-dev="${esc(developer.id)}">
    <header>
      <div class="pp2-dev-avatar">${developer.avatar ? `<img src="${esc(developer.avatar)}" alt="" loading="lazy"/>` : `<span>${esc(developer.name.slice(0, 1))}</span>`}</div>
      <div><p class="pp2-kicker">DEVELOPER</p><h3>${esc(developer.name)}</h3><span>${developer.games.length} game${developer.games.length === 1 ? "" : "s"} in PhantomPlay</span></div>
      <strong class="pp2-dev-score"><b>${developer.score}</b><span>Dev score</span></strong>
    </header>
    <p>${esc(developer.categories.join(" / ") || "PhantomPlay")} creator with ${developer.featuredCount} featured build${developer.featuredCount === 1 ? "" : "s"} and ${developer.supportCount} local support mark${developer.supportCount === 1 ? "" : "s"}.</p>
    <div class="pp2-dev-tags">${developer.categories.map((category) => `<span>${esc(category)}</span>`).join("")}</div>
    <div class="pp2-dev-thumbs">${previews.map((game) => `<span title="${esc(game.title)}">${art(game)}</span>`).join("")}</div>
    <button type="button" class="pp2-ghost" data-pp2-open-dev="${esc(developer.id)}">View profile</button>
  </article>`;
}
function renderDeveloperProfile(developer) {
  const notes = developer.notes.length ? developer.notes.map((note) => `<li><span>${esc(dateLabel(note.at))}</span><p>${esc(note.text)}</p></li>`).join("") : `<li class="is-empty"><p>No private dev notes yet.</p></li>`;
  return `<div class="pp2-dev-profile">
    <button type="button" class="pp2-ghost" data-pp2-dev-back>Back to developers</button>
    <section class="pp2-panel pp2-dev-hero">
      <div class="pp2-dev-avatar is-large">${developer.avatar ? `<img src="${esc(developer.avatar)}" alt="" loading="lazy"/>` : `<span>${esc(developer.name.slice(0, 1))}</span>`}</div>
      <div><p class="pp2-kicker">DEVELOPER PROFILE</p><h2>${esc(developer.name)}</h2><p>${developer.games.length} playable game${developer.games.length === 1 ? "" : "s"} · ${esc(developer.categories.join(" / ") || "PhantomPlay")}</p></div>
      <strong class="pp2-dev-score is-large"><b>${developer.score}</b><span>Dev score</span></strong>
    </section>
    <section class="pp2-dev-stats">
      <span><b>${developer.games.length}</b><i>Games</i></span>
      <span><b>${developer.featuredCount}</b><i>Featured</i></span>
      <span><b>${developer.supportCount}</b><i>Support</i></span>
      <span><b>${developer.donationIntentCount}</b><i>Collab intent</i></span>
    </section>
    <section class="pp2-panel pp2-dev-actions">
      <button type="button" class="pp2-play" data-pp2-support-dev="${esc(developer.id)}">${developer.supported ? "Supported" : "Support developer"}</button>
      <button type="button" class="pp2-ghost" data-pp2-donate-dev="${esc(developer.id)}">Mark donate / collab intent</button>
      <p class="pp2-fine">This records private local intent only. No payment, outreach, or external service starts here.</p>
    </section>
    ${ui.developerMessage ? `<div class="pp2-banner"><b>Developer note</b><span>${esc(ui.developerMessage)}</span><button type="button" data-pp2-dev-message-clear>Clear</button></div>` : ""}
    <section class="pp2-panel pp2-dev-notes">
      <h3>Private notes</h3>
      <textarea data-pp2-dev-note="${esc(developer.id)}" rows="3" maxlength="800" placeholder="Leave yourself a note about this developer, their games, or support ideas."></textarea>
      <button type="button" class="pp2-ghost" data-pp2-save-dev-note="${esc(developer.id)}">Save private note</button>
      <ul>${notes}</ul>
    </section>
    <section class="pp2-row pp2-dev-games">
      <header><h2>Games by ${esc(developer.name)}</h2><p>Every playable PhantomPlay build currently available for this developer.</p></header>
      <div class="pp2-grid pp2-grid-wide">${developer.games.map((game) => card(game)).join("")}</div>
    </section>
  </div>`;
}

/* ---- HOME ---- */
function mapIds(rows, key = "gameId") { return (rows || []).map((item) => gameById(item[key])).filter((game) => game && !isKidsGame(game)); }
function renderHome() {
  if (ui.loading) return `${skeletonRow("Featured")}${skeletonRow("Trending this week")}`;
  const visibleCatalog = ui.snapshot.catalog.filter((game) => !isKidsGame(game));
  const featured = visibleCatalog.filter((game) => game.featured);
  const hero = gameById("phantom-rumble") || featured[0] || visibleCatalog[0];
  const continuing = ui.snapshot.history.filter((item) => item.canContinue).map((item) => gameById(item.gameId)).filter((game) => game && !isKidsGame(game)).slice(0, 4);
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
    <section class="pp2-spotlight"><div><p class="pp2-kicker">DEVELOPER SPOTLIGHT</p><h2>${esc(ui.snapshot.developerSpotlight)}</h2><p>Browse developers, see every game they have in PhantomPlay, and keep private support notes without turning play into a marketplace.</p><button class="pp2-ghost" data-pp2-tab="developer">Open Developers</button></div></section>
  </div>`;
}

/* ---- SOLO ---- */
function renderSolo() {
  const games = ui.snapshot.catalog.filter((game) => game.kind === "built_in" && visibleByCategory(game));
  return `<div class="pp2-solo">
    <section class="pp2-lead"><h2>Solo</h2><p>Offline-capable games with cloud progress. Close anything mid-run — Terminal 2048 and Sudoku Signal restore the exact board on any device.</p></section>
    <div class="pp2-cats">${CATEGORIES.map((cat) => `<button type="button" class="${ui.category === cat ? "is-active" : ""}" data-pp2-cat="${esc(cat)}">${esc(cat)}</button>`).join("")}</div>
    ${games.length ? `<div class="pp2-grid pp2-grid-wide">${games.map((game) => card(game)).join("")}</div>` : empty("Nothing in this category", "Try another category.")}
  </div>`;
}

/* ---- FRIENDS ---- */
function statusDot(status) { return `<i class="pp2-dot is-${esc(status)}"></i>`; }
function renderFriends() {
  if (ui.v2Offline) return `<div class="pp2-friends">${v2Note("Friends, presence, and the activity feed need the PhantomForce server.")}${row("Play on one keyboard right now", [gameById("phantom-rumble")].filter(Boolean), "Phantom Rumble is built for two players side by side — no server needed.")}</div>`;
  const social = ui.v2.social;
  const feed = ui.v2.feed || [];
  const addable = social.presence.filter((entry) => !social.friends.some((f) => f.actorId === entry.actorId) && !social.outgoing.some((f) => f.actorId === entry.actorId) && !social.incoming.some((f) => f.actorId === entry.actorId));
  return `<div class="pp2-friends">
    <section class="pp2-lead"><div><h2>Friends</h2><p>Everyone here is a signed-in member of this workspace. No strangers, no public matchmaking.</p></div>
      <label class="pp2-status-pick">My status ${statusDot(ui.statusChoice)}<select data-pp2-status>${STATUSES.map(([value, label]) => `<option value="${value}" ${ui.statusChoice === value ? "selected" : ""}>${label}</option>`).join("")}</select></label></section>
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
    ${row("Made for playing together", [gameById("phantom-rumble")].filter(Boolean), "Two players on one keyboard, bots to fill the arena. Voice and online parties are on the roadmap — nothing here fakes them.")}
    <section class="pp2-panel"><h3>Workspace activity</h3>${feed.length ? `<ul class="pp2-feed">${feed.slice(0, 20).map((entry) => `<li><b>${esc(entry.actorLabel)}</b> ${entry.kind === "review" ? `reviewed <i>${esc(entry.subject)}</i> ${esc(entry.detail)}` : entry.kind === "wishlist" ? `wishlisted <i>${esc(entry.subject)}</i>` : entry.kind === "follow" ? `followed <i>${esc(entry.subject)}</i>` : `released <i>${esc(entry.subject)}</i>`}<span>${esc((entry.at || "").slice(0, 10))}</span></li>`).join("")}</ul>` : empty("Quiet so far", "Reviews, wishlists, and follows will show up here.")}</section>
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
  return ui.snapshot.catalog.filter((game) => visibleByCategory(game) && (!query || `${game.title} ${game.summary} ${game.developer} ${game.tags.join(" ")}`.toLowerCase().includes(query)));
}
function renderLibrary() {
  const games = filteredCatalog();
  return `<div class="pp2-library">
    <div class="pp2-tools"><input type="search" data-pp2-search value="${esc(ui.query)}" placeholder="Search games, developers, tags…"/><div class="pp2-cats">${CATEGORIES.map((cat) => `<button type="button" class="${ui.category === cat ? "is-active" : ""}" data-pp2-cat="${esc(cat)}">${esc(cat)}</button>`).join("")}</div></div>
    ${games.length ? `<div class="pp2-grid pp2-grid-wide">${games.map((game) => card(game)).join("")}</div>` : empty("No matching games", "Try another search or category.")}
  </div>`;
}

/* ---- DEVELOPERS ---- */
const ASSIST_BRIEFS = {
  icon: (game) => `Design a square game icon for "${game.title}" — ${game.summary} Terminal-inspired, dark background (#05070a), phosphor green accents, no text, crisp at 64px.`,
  trailer: (game) => `Cut a 20-second gameplay trailer for "${game.title}". ${game.summary} Dark terminal aesthetic, fast cuts, end card with the title in monospace green on black.`,
  copy: (game) => `Write a store description for the game "${game.title}" (category: ${game.category}). One-line hook, three feature bullets, and a closing call to play. Tone: confident indie, no hype words. Current summary: ${game.summary}`,
  social: (game) => `Draft 3 short social posts announcing "${game.title}" on PhantomPlay — one playful, one feature-focused, one for game developers. Include the hook: ${game.summary}`,
  patch: (game) => `Write patch notes for the next release of "${game.title}" from these raw notes: [paste your changes]. Keep them player-facing, grouped by Added/Changed/Fixed.`,
};
function developerBuilderTools() {
  const snapshot = ui.snapshot;
  if (!snapshot.access.canSubmitGames) return `<section class="pp2-panel pp2-builder-tools"><h3>Release tools locked</h3><p class="pp2-fine">This account can browse and support developers. Owners can enable build submissions per plan.</p></section>`;
  const editing = snapshot.submissions.find((item) => item.id === ui.editingSubmissionId) || null;
  const analytics = ui.analytics;
  const assistGames = [...snapshot.submissions.map((s) => ({ id: `community:${s.id}`, title: s.title, summary: s.summary, category: s.category })), ...(isAdmin() ? snapshot.catalog.filter((g) => g.kind === "built_in") : [])];
  return `<details class="pp2-panel pp2-builder-tools">
    <summary>Release tools for builders</summary>
    <p class="pp2-fine">Use these when a developer is actually preparing a build. The main Developers tab stays focused on profiles, games, support, and notes.</p>
    <section class="pp2-subpanel"><h3>Release analytics</h3>
      ${ui.v2Offline ? v2Note("Analytics need the PhantomForce server.") : analytics ? (analytics.games.length ? `<div class="pp2-table-wrap"><table class="pp2-table"><thead><tr><th>Game</th><th>Plays</th><th>Players</th><th>DAU</th><th>MAU</th><th>Hours</th><th>Avg session</th><th>Returning</th><th>Rating</th><th>Wishlists</th></tr></thead><tbody>${analytics.games.map((row) => `<tr><td>${esc(row.title)}</td><td>${row.plays}</td><td>${row.players}</td><td>${row.dau}</td><td>${row.mau}</td><td>${row.totalHours}</td><td>${row.avgSessionMinutes}m</td><td>${row.returningPlayers}</td><td>${row.averageRating ?? "—"} (${row.reviewCount})</td><td>${row.wishlists}</td></tr>`).join("")}</tbody></table></div>` : empty("No analytics yet", "Numbers appear once your published games are played.")) : `<button type="button" class="pp2-ghost" data-pp2-load-analytics>Load analytics</button>`}
    </section>
    <section class="pp2-subpanel"><h3>Creative assists</h3>
      <p class="pp2-fine">Each button copies a production-ready brief to your clipboard — paste it into Media Lab (art, trailers), Content Hub (posts), or Phantom chat (copy, patch notes). Honest by design: nothing is generated behind your back.</p>
      ${assistGames.length ? `<div class="pp2-assist"><select data-pp2-assist-game>${assistGames.map((game) => `<option value="${esc(game.id)}">${esc(game.title)}</option>`).join("")}</select>
      <div class="pp2-assist-buttons">${Object.entries({ icon: "Icon brief", trailer: "Trailer brief", copy: "Store copy brief", social: "Social posts brief", patch: "Patch notes brief" }).map(([key, label]) => `<button type="button" class="pp2-ghost" data-pp2-assist="${key}">${label}</button>`).join("")}</div></div>
      ${ui.assistMessage ? `<p class="pp2-fine">${esc(ui.assistMessage)}</p>` : ""}` : empty("No games yet", "Save a submission below and the assists unlock.")}
    </section>
    <section class="pp2-subpanel"><h3>${editing ? "Update release" : "Draft build"}</h3>
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
    <section class="pp2-subpanel"><h3>Your releases</h3>
      ${snapshot.submissions.length ? snapshot.submissions.map((item) => `<div class="pp2-sub"><header><b>${esc(item.title || "Untitled")}</b><span class="is-${esc(item.status)}">${esc(item.status.replaceAll("_", " "))}</span></header><p>${esc(item.summary || "")}</p><footer><span>v${esc(item.version)} · ${item.versions.length} versions</span>${["draft", "changes_requested", "rejected"].includes(item.status) ? `<button type="button" class="pp2-ghost" data-pp2-edit="${esc(item.id)}">Edit</button>` : ""}</footer>${item.moderationNote ? `<blockquote>${esc(item.moderationNote)}</blockquote>` : ""}</div>`).join("") : empty("No releases yet", "Save a draft or submit a finished game for review.")}
    </section>
  </details>`;
}
function renderDeveloper() {
  const developers = developerDirectory();
  const developer = selectedDeveloper();
  if (developer) return renderDeveloperProfile(developer);
  return `<div class="pp2-developers">
    <section class="pp2-lead"><div><h2>Developers</h2><p>Browse every PhantomPlay developer, inspect their games, track Dev score, and keep private support or collaboration notes.</p></div><span class="pp2-access is-on">${developers.length} developer${developers.length === 1 ? "" : "s"}</span></section>
    ${developers.length ? `<div class="pp2-dev-list">${developers.map(developerCard).join("")}</div>` : empty("No developers yet", "Playable games will create developer profiles automatically.")}
    ${developerBuilderTools()}
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
    <p class="pp2-fine">PhantomPlay never touches your work, agents, files, or business data.</p></aside>`;
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
  const tabs = [["home", "Home"], ["solo", "Solo"], ["friends", "Friends"], ["workspace", "Workspace"], ["library", "Library"], ["developer", "Developers"], ...(snapshot.access.canModerate ? [["admin", "Admin"]] : [])];
  const view = { home: renderHome, solo: renderSolo, friends: renderFriends, workspace: renderWorkspace, library: renderLibrary, developer: renderDeveloper, admin: renderAdmin }[ui.tab] || renderHome;
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
    ui.resume = playableResume(resume);
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
    const scoreValue = Number(event.data.score);
    const progressValue = Number(event.data.progress);
    const detail = { score: Number.isFinite(scoreValue) ? scoreValue : undefined, progress: event.data.type === "complete" ? 100 : Number.isFinite(progressValue) ? progressValue : undefined, state: event.data.state };
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
function supportDeveloper(id) {
  const records = loadDeveloperSupport();
  const record = records[id] || {};
  if (record.supportedAt) {
    ui.developerMessage = "Support was already marked for this developer.";
    render();
    return;
  }
  records[id] = { ...record, supportedAt: new Date().toISOString(), supportCount: Number(record.supportCount || 0) + 1 };
  saveDeveloperSupport(records);
  ui.developerMessage = "Support saved locally for this developer.";
  render();
}
function logDeveloperDonationIntent(id) {
  const records = loadDeveloperSupport();
  const record = records[id] || {};
  records[id] = { ...record, donationIntentAt: new Date().toISOString(), donationIntentCount: Number(record.donationIntentCount || 0) + 1 };
  saveDeveloperSupport(records);
  ui.developerMessage = "Donation or collaboration interest saved locally. No payment was started.";
  render();
}
function saveDeveloperNote(id) {
  const field = mountedRoot.querySelector(`[data-pp2-dev-note="${CSS.escape(id)}"]`);
  const text = String(field?.value || "").trim();
  if (!text) {
    ui.developerMessage = "Write a note before saving it.";
    render();
    return;
  }
  const records = loadDeveloperSupport();
  const record = records[id] || {};
  const notes = Array.isArray(record.notes) ? record.notes : [];
  records[id] = { ...record, notes: [{ text: text.slice(0, 800), at: new Date().toISOString() }, ...notes].slice(0, 25) };
  saveDeveloperSupport(records);
  ui.developerMessage = "Private developer note saved locally.";
  render();
}

/* ---- bind ---- */
function bind() {
  const on = (selector, event, handler) => mountedRoot.querySelectorAll(selector).forEach((el) => el.addEventListener(event, handler));
  mountedRoot.querySelectorAll("[data-pp2-tab]").forEach((b) => b.onclick = () => {
    ui.selectedDeveloperId = "";
    ui.developerMessage = "";
    ui.tab = b.dataset.pp2Tab;
    if (ui.tab === "developer" && !ui.analytics && !ui.v2Offline) loadAnalytics();
    render();
  });
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
  mountedRoot.querySelectorAll("[data-pp2-open-dev]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); ui.selectedDeveloperId = b.dataset.pp2OpenDev; ui.developerMessage = ""; render(); });
  on("[data-pp2-dev-back]", "click", () => { ui.selectedDeveloperId = ""; ui.developerMessage = ""; render(); });
  on("[data-pp2-dev-message-clear]", "click", () => { ui.developerMessage = ""; render(); });
  mountedRoot.querySelectorAll("[data-pp2-support-dev]").forEach((b) => b.onclick = () => supportDeveloper(b.dataset.pp2SupportDev));
  mountedRoot.querySelectorAll("[data-pp2-donate-dev]").forEach((b) => b.onclick = () => logDeveloperDonationIntent(b.dataset.pp2DonateDev));
  mountedRoot.querySelectorAll("[data-pp2-save-dev-note]").forEach((b) => b.onclick = () => saveDeveloperNote(b.dataset.pp2SaveDevNote));
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
