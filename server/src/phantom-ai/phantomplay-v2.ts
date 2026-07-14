/* PhantomForce — PhantomPlay V2: the platform layer.

   V1 (./phantomplay.ts) stays untouched and load-bearing: catalog, play
   sessions, submissions, moderation. This module adds the four-audience
   platform surface on top — social graph + presence, reviews/ratings,
   wishlists, developer follows, an activity feed, workspace (school/company)
   policies, developer analytics computed from V1's real play sessions, and
   discovery rows. It also registers the V2 built-in games into V1's catalog
   at startup (an array push — no V1 source edit), so V1's launch/session
   validation covers them for free.

   Everything persists in its own durable JSON store
   (.phantom/phantomplay-v2.json; PHANTOMFORCE_PHANTOMPLAY_V2_PATH override),
   with the same atomic temp-file write chain V1 uses. The V1 store is only
   ever READ here (analytics/leaderboards/resume) — never written.

   Feature flag: PHANTOMFORCE_PHANTOMPLAY_V2_ENABLED === "false" turns every
   V2 route off (404) and skips game registration; V1 behavior is then
   byte-identical to before this module existed.

   Monetization (Phase 4, architecture only): PriceModel below is the data
   shape submissions/games will carry. No pricing is charged or displayed as
   real anywhere until a billing provider integration exists — policies are
   deliberately not hardcoded here. */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccessSession } from "../access/session.js";
import {
  PHANTOMPLAY_BUILT_IN_GAMES,
  type PhantomPlayGame,
  type PhantomPlayRating,
  type PhantomPlaySubmission,
} from "./phantomplay.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const storePath = process.env.PHANTOMFORCE_PHANTOMPLAY_V2_PATH || resolve(repoRoot, ".phantom", "phantomplay-v2.json");
// V1 store, read-only — same resolution rule as ./phantomplay.ts.
const v1StorePath = () => process.env.PHANTOMFORCE_PHANTOMPLAY_PATH || resolve(repoRoot, ".phantom", "phantomplay.json");

export function phantomPlayV2Enabled() {
  return process.env.PHANTOMFORCE_PHANTOMPLAY_V2_ENABLED !== "false";
}

// ---- Phase-4 monetization architecture (data model only, nothing charges) ----
export type PhantomPlayPriceModel = {
  kind: "free" | "paid" | "donation" | "subscription";
  amountCents: number | null;
  currency: "usd";
  note: string;
};

// ---- V2 built-in games ------------------------------------------------------
// Self-contained SVG covers (data URIs) so no binary asset is required.
const cover = (label: string, glyph: string, hue: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#05070a"/><rect x="8" y="8" width="304" height="164" rx="10" fill="none" stroke="${hue}" stroke-opacity=".35"/><text x="24" y="108" font-family="monospace" font-size="64" fill="${hue}">${glyph}</text><text x="24" y="150" font-family="monospace" font-size="17" fill="#9fe8b8">${label}</text><text x="24" y="40" font-family="monospace" font-size="12" fill="#3f6e4f">PHANTOMPLAY</text></svg>`,
  )}`;

// Only games that don't duplicate an existing main-catalog concept ship here.
// (Snake, 2048, minesweeper, and typing already exist on main as
// circuit-serpent, tower-tactics, signal-sweeper, and type-storm.)
export const PHANTOMPLAY_V2_GAMES: PhantomPlayGame[] = [
  { id: "phantom-rumble", title: "Phantom Rumble", summary: "A premium local platform fighter with guard, parry, dodge, ledge-save recovery, bots, drops, and touch controls.", description: "A full PhantomPlay platform fighter: up to four players or bots brawl across a dynamic arena with percent knockback, double jumps, charge smashes, Phantom Burst, guard/parry, dodge, ledge-save recovery, camera focus, and reality-bending drops. Local keyboard and mobile touch play are both supported without external networking.", category: "Arcade", tags: ["platform fighter", "multiplayer", "action", "local", "touch"], contentRating: "everyone", developer: "Tak", kind: "built_in", launchUrl: "/app/games/phantom-rumble.html?v=2.2.1", thumbnail: cover("PHANTOM RUMBLE", "⚔", "#4ade80"), featured: true, version: "2.2.1", controls: "P1: WASD, Shift guard, Q dodge, Space tap/hold. P2: arrows, I guard, O dodge, Enter tap/hold. Touch controls on mobile.", progressSupport: true, scoreSupport: true },
  { id: "sudoku-signal", title: "Sudoku Signal", summary: "Generated sudoku with pencil marks — resumes exactly where you stopped.", description: "Every puzzle is generated with a unique solution. Three difficulties, conflict highlighting, pencil marks, and full cloud resume.", category: "Focus", tags: ["logic", "calm", "resume"], contentRating: "everyone", developer: "Tak", kind: "built_in", launchUrl: "/app/games/sudoku-signal.html?v=1.0.0", thumbnail: cover("SUDOKU SIGNAL", "⌗", "#a7f3d0"), featured: false, version: "1.0.0", controls: "Arrows + 1-9, or tap + number pad", progressSupport: true, scoreSupport: true },
];

let gamesRegistered = false;
export function registerPhantomPlayV2Games() {
  if (gamesRegistered) return;
  gamesRegistered = true;
  for (const game of PHANTOMPLAY_V2_GAMES) {
    if (!PHANTOMPLAY_BUILT_IN_GAMES.some((item) => item.id === game.id)) PHANTOMPLAY_BUILT_IN_GAMES.push(game);
  }
}

// ---- shared helpers (same conventions as V1) --------------------------------
const clean = (value: unknown, max = 500) => String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
const now = () => new Date().toISOString();
const clamp = (value: unknown, min: number, max: number) => Math.max(min, Math.min(max, Number(value) || 0));
const ratingRank: Record<PhantomPlayRating, number> = { everyone: 0, teen: 1, mature: 2 };
const safeRating = (value: unknown): PhantomPlayRating => value === "mature" || value === "teen" ? value : "everyone";

function tenantIdFor(session: AccessSession, requested?: unknown) {
  const own = session.orgId || session.clientId || session.id || "phantomforce";
  if (!session.canManageAccess) return clean(own, 100) || "phantomforce";
  return clean(requested, 100) || clean(own, 100) || "phantomforce";
}
function actorIdFor(session: AccessSession) {
  return clean(session.userId || session.id, 120) || "anonymous";
}
function actorLabelFor(session: AccessSession) {
  return clean(session.label, 90) || actorIdFor(session);
}
const profileKey = (tenantId: string, actorId: string) => `${tenantId}::${actorId}`;

// ---- store ------------------------------------------------------------------
export type PhantomPlayPresenceStatus = "online" | "away" | "busy" | "invisible" | "playing";
type Friendship = { key: string; a: string; b: string; requestedBy: string; status: "pending" | "accepted"; at: string };
type PresenceEntry = { actorId: string; label: string; status: PhantomPlayPresenceStatus; gameId: string; at: string };
type Review = { id: string; tenantId: string; gameId: string; actorId: string; actorLabel: string; rating: number; text: string; createdAt: string; updatedAt: string };
type ActivityEntry = { kind: "review" | "wishlist" | "follow" | "release"; actorLabel: string; subject: string; detail: string; at: string };
export type WorkspacePolicy = {
  approvedGameIds: string[]; // empty = every catalog game allowed
  maxContentRating: PhantomPlayRating;
  dailyMinuteLimit: number | null; // null = plan default
  allowCommunityGames: boolean;
  allowRooms: boolean;
  updatedAt: string;
};
type V2Store = {
  version: 1;
  social: Record<string, { friendships: Friendship[]; presence: PresenceEntry[] }>;
  reviews: Review[];
  wishlists: Record<string, string[]>;
  follows: Record<string, string[]>;
  feed: Record<string, ActivityEntry[]>;
  policies: Record<string, WorkspacePolicy>;
};

async function readStore(): Promise<V2Store> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as Partial<V2Store>;
    return {
      version: 1,
      social: parsed.social && typeof parsed.social === "object" ? parsed.social : {},
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
      wishlists: parsed.wishlists && typeof parsed.wishlists === "object" ? parsed.wishlists : {},
      follows: parsed.follows && typeof parsed.follows === "object" ? parsed.follows : {},
      feed: parsed.feed && typeof parsed.feed === "object" ? parsed.feed : {},
      policies: parsed.policies && typeof parsed.policies === "object" ? parsed.policies : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, social: {}, reviews: [], wishlists: {}, follows: {}, feed: {}, policies: {} };
    throw error;
  }
}

let writes = Promise.resolve();
async function writeStore(store: V2Store) {
  writes = writes.then(async () => {
    await mkdir(dirname(storePath), { recursive: true });
    const temp = `${storePath}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
    await rename(temp, storePath);
  });
  await writes;
}

// V1 store, read-only. Shape documented in ./phantomplay.ts.
type V1Session = { id: string; gameId: string; startedAt: string; updatedAt: string; endedAt: string | null; seconds: number; score: number | null; progress: number; state: Record<string, string | number | boolean | null> };
type V1Profile = { tenantId: string; actorId: string; favorites: string[]; sessions: V1Session[] };
async function readV1Store(): Promise<{ profiles: Record<string, V1Profile>; submissions: PhantomPlaySubmission[] }> {
  try {
    const parsed = JSON.parse(await readFile(v1StorePath(), "utf8")) as { profiles?: Record<string, V1Profile>; submissions?: PhantomPlaySubmission[] };
    return { profiles: parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {}, submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [] };
  } catch {
    return { profiles: {}, submissions: [] };
  }
}

function fullCatalog(submissions: PhantomPlaySubmission[]): PhantomPlayGame[] {
  const community = submissions.filter((item) => item.status === "approved" && item.launchUrl).map((item) => ({
    id: `community:${item.id}`, title: item.title, summary: item.summary, description: item.description,
    category: item.category, tags: item.tags, contentRating: item.contentRating, developer: item.developerName,
    kind: "community" as const, launchUrl: item.launchUrl, thumbnail: item.screenshots[0] || "", featured: item.featured,
    version: item.version, controls: item.controls, progressSupport: true, scoreSupport: true,
  }));
  return [...PHANTOMPLAY_BUILT_IN_GAMES, ...community];
}

function tenantSocial(store: V2Store, tenantId: string) {
  const bucket = store.social[tenantId] || { friendships: [], presence: [] };
  bucket.friendships = Array.isArray(bucket.friendships) ? bucket.friendships : [];
  bucket.presence = Array.isArray(bucket.presence) ? bucket.presence : [];
  store.social[tenantId] = bucket;
  return bucket;
}

const PRESENCE_TTL_MS = 120_000;
function livePresence(bucket: { presence: PresenceEntry[] }) {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  return bucket.presence.filter((entry) => Date.parse(entry.at) >= cutoff);
}

function pushFeed(store: V2Store, tenantId: string, entry: ActivityEntry) {
  const list = Array.isArray(store.feed[tenantId]) ? store.feed[tenantId] : [];
  list.unshift(entry);
  store.feed[tenantId] = list.slice(0, 200);
}

export function defaultWorkspacePolicy(): WorkspacePolicy {
  return { approvedGameIds: [], maxContentRating: "teen", dailyMinuteLimit: null, allowCommunityGames: true, allowRooms: true, updatedAt: now() };
}

// ---- snapshot ----------------------------------------------------------------
export async function getPhantomPlayV2Snapshot(session: AccessSession, options: { tenantId?: unknown } = {}) {
  const tenantId = tenantIdFor(session, options.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const bucket = tenantSocial(store, tenantId);
  const key = profileKey(tenantId, actorId);
  const presence = livePresence(bucket).filter((entry) => entry.status !== "invisible" || entry.actorId === actorId);
  const accepted = bucket.friendships.filter((item) => item.status === "accepted" && (item.a === actorId || item.b === actorId));
  const pending = bucket.friendships.filter((item) => item.status === "pending" && (item.a === actorId || item.b === actorId));
  const presenceFor = (id: string) => presence.find((entry) => entry.actorId === id) || null;
  const other = (item: Friendship) => (item.a === actorId ? item.b : item.a);
  return {
    tenantId,
    actorId,
    actorLabel: actorLabelFor(session),
    social: {
      friends: accepted.map((item) => { const id = other(item); const live = presenceFor(id); return { actorId: id, label: live?.label || id, status: live?.status || "offline", gameId: live?.gameId || "", since: item.at }; }),
      incoming: pending.filter((item) => item.requestedBy !== actorId).map((item) => ({ actorId: other(item), at: item.at })),
      outgoing: pending.filter((item) => item.requestedBy === actorId).map((item) => ({ actorId: other(item), at: item.at })),
      presence: presence.filter((entry) => entry.actorId !== actorId).map((entry) => ({ actorId: entry.actorId, label: entry.label, status: entry.status, gameId: entry.gameId })),
    },
    wishlist: Array.isArray(store.wishlists[key]) ? store.wishlists[key] : [],
    follows: Array.isArray(store.follows[key]) ? store.follows[key] : [],
    feed: (store.feed[tenantId] || []).slice(0, 50),
    policy: store.policies[tenantId] || defaultWorkspacePolicy(),
    policyIsDefault: !store.policies[tenantId],
  };
}

// ---- presence -----------------------------------------------------------------
export async function heartbeatPhantomPlayPresence(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const status = ((): PhantomPlayPresenceStatus => {
    const value = clean(input.status, 20);
    return value === "away" || value === "busy" || value === "invisible" || value === "playing" ? value : "online";
  })();
  const store = await readStore();
  const bucket = tenantSocial(store, tenantId);
  bucket.presence = livePresence(bucket).filter((entry) => entry.actorId !== actorId);
  bucket.presence.push({ actorId, label: clean(input.label, 90) || actorLabelFor(session), status, gameId: clean(input.gameId, 180), at: now() });
  bucket.presence = bucket.presence.slice(-500);
  await writeStore(store);
  return { status, expiresInSeconds: PRESENCE_TTL_MS / 1000 };
}

// ---- friends -------------------------------------------------------------------
export async function mutatePhantomPlayFriend(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const target = clean(input.actorId, 120);
  const action = clean(input.action, 20);
  if (!target || target === actorId) throw new Error("Pick another member of this workspace.");
  if (!["request", "accept", "decline", "remove"].includes(action)) throw new Error("Unsupported friend action.");
  const store = await readStore();
  const bucket = tenantSocial(store, tenantId);
  const [a, b] = [actorId, target].sort();
  const key = `${a}::${b}`;
  const existing = bucket.friendships.find((item) => item.key === key);
  if (action === "request") {
    if (existing?.status === "accepted") throw new Error("You are already friends.");
    if (existing?.status === "pending") throw new Error("A request is already waiting.");
    bucket.friendships.push({ key, a, b, requestedBy: actorId, status: "pending", at: now() });
  } else if (action === "accept") {
    if (!existing || existing.status !== "pending" || existing.requestedBy === actorId) throw new Error("No incoming request from that member.");
    existing.status = "accepted";
    existing.at = now();
  } else {
    bucket.friendships = bucket.friendships.filter((item) => item.key !== key);
  }
  bucket.friendships = bucket.friendships.slice(-2000);
  await writeStore(store);
  return { ok: true };
}

// ---- reviews / wishlist / follows ------------------------------------------------
export async function upsertPhantomPlayReview(session: AccessSession, gameId: string, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const rating = Math.round(clamp(input.rating, 1, 5));
  const text = clean(input.text, 1200);
  const v1 = await readV1Store();
  const game = fullCatalog(v1.submissions).find((item) => item.id === gameId);
  if (!game) throw new Error("That game is not in the catalog.");
  if (text.length < 3) throw new Error("Write at least a few words.");
  const store = await readStore();
  const existing = store.reviews.find((item) => item.tenantId === tenantId && item.gameId === gameId && item.actorId === actorId);
  const stamp = now();
  if (existing) {
    Object.assign(existing, { rating, text, updatedAt: stamp, actorLabel: actorLabelFor(session) });
  } else {
    store.reviews.unshift({ id: `review-${randomUUID()}`, tenantId, gameId, actorId, actorLabel: actorLabelFor(session), rating, text, createdAt: stamp, updatedAt: stamp });
    pushFeed(store, tenantId, { kind: "review", actorLabel: actorLabelFor(session), subject: game.title, detail: `${rating}/5`, at: stamp });
  }
  store.reviews = store.reviews.slice(0, 10_000);
  await writeStore(store);
  return { rating, text };
}

export async function setPhantomPlayWishlist(session: AccessSession, gameId: string, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const key = profileKey(tenantId, actorId);
  const store = await readStore();
  const list = Array.isArray(store.wishlists[key]) ? store.wishlists[key] : [];
  const on = input.on !== false;
  store.wishlists[key] = on ? [gameId, ...list.filter((id) => id !== gameId)].slice(0, 200) : list.filter((id) => id !== gameId);
  if (on && !list.includes(gameId)) {
    const v1 = await readV1Store();
    const game = fullCatalog(v1.submissions).find((item) => item.id === gameId);
    if (game) pushFeed(store, tenantId, { kind: "wishlist", actorLabel: actorLabelFor(session), subject: game.title, detail: "", at: now() });
  }
  await writeStore(store);
  return { wishlist: store.wishlists[key] };
}

export async function setPhantomPlayFollow(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const developer = clean(input.developer, 90);
  if (!developer) throw new Error("Pick a developer to follow.");
  const key = profileKey(tenantId, actorId);
  const store = await readStore();
  const list = Array.isArray(store.follows[key]) ? store.follows[key] : [];
  const on = input.on !== false;
  store.follows[key] = on ? [developer, ...list.filter((name) => name !== developer)].slice(0, 200) : list.filter((name) => name !== developer);
  if (on && !list.includes(developer)) pushFeed(store, tenantId, { kind: "follow", actorLabel: actorLabelFor(session), subject: developer, detail: "", at: now() });
  await writeStore(store);
  return { follows: store.follows[key] };
}

// ---- stats helpers (V1 sessions, read-only) --------------------------------------
function tenantProfiles(profiles: Record<string, V1Profile>, tenantId: string) {
  return Object.entries(profiles).filter(([key]) => key.startsWith(`${tenantId}::`)).map(([, profile]) => profile);
}

function gameStats(profiles: V1Profile[], gameId: string) {
  let plays = 0, totalSeconds = 0, bestScore = 0;
  const players = new Set<string>(), today = new Set<string>(), month = new Set<string>(), returning = new Set<string>();
  const dayNow = new Date().toISOString().slice(0, 10);
  const monthCutoff = Date.now() - 30 * 86400_000;
  for (const profile of profiles) {
    const sessions = (profile.sessions || []).filter((item) => item.gameId === gameId);
    if (!sessions.length) continue;
    players.add(profile.actorId);
    if (sessions.length > 1) returning.add(profile.actorId);
    for (const item of sessions) {
      plays += 1;
      totalSeconds += item.seconds || 0;
      bestScore = Math.max(bestScore, item.score || 0);
      if (item.startedAt.startsWith(dayNow)) today.add(profile.actorId);
      if (Date.parse(item.startedAt) >= monthCutoff) month.add(profile.actorId);
    }
  }
  return { plays, players: players.size, dau: today.size, mau: month.size, totalHours: Math.round(totalSeconds / 360) / 10, avgSessionMinutes: plays ? Math.round(totalSeconds / plays / 6) / 10 : 0, returningPlayers: returning.size, bestScore };
}

function ratingSummary(reviews: Review[], tenantId: string, gameId: string) {
  const relevant = reviews.filter((item) => item.tenantId === tenantId && item.gameId === gameId);
  const average = relevant.length ? Math.round((relevant.reduce((sum, item) => sum + item.rating, 0) / relevant.length) * 10) / 10 : null;
  return { averageRating: average, reviewCount: relevant.length, reviews: relevant.slice(0, 25) };
}

// ---- game page ---------------------------------------------------------------------
export async function getPhantomPlayGamePage(session: AccessSession, gameId: string, options: { tenantId?: unknown } = {}) {
  const tenantId = tenantIdFor(session, options.tenantId);
  const actorId = actorIdFor(session);
  const [store, v1] = await Promise.all([readStore(), readV1Store()]);
  const catalog = fullCatalog(v1.submissions);
  const game = catalog.find((item) => item.id === gameId);
  if (!game) return null;
  const profiles = tenantProfiles(v1.profiles, tenantId);
  const stats = gameStats(profiles, gameId);
  const ratings = ratingSummary(store.reviews, tenantId, gameId);
  const submission = gameId.startsWith("community:") ? v1.submissions.find((item) => `community:${item.id}` === gameId) : null;
  const patchNotes = submission
    ? submission.versions.map((item) => ({ version: item.version, notes: item.notes || "No notes provided.", at: item.submittedAt }))
    : [{ version: game.version, notes: "Built-in PhantomPlay release.", at: "" }];
  const key = profileKey(tenantId, actorId);
  return {
    game,
    stats: { ...stats, ...ratings },
    reviews: ratings.reviews,
    myReview: store.reviews.find((item) => item.tenantId === tenantId && item.gameId === gameId && item.actorId === actorId) || null,
    patchNotes,
    related: catalog.filter((item) => item.category === game.category && item.id !== gameId).slice(0, 4),
    wishlisted: (store.wishlists[key] || []).includes(gameId),
    developerFollowed: (store.follows[key] || []).includes(game.developer),
    leaderboard: leaderboardRows(profiles, store, tenantId, gameId).slice(0, 5),
  };
}

// ---- leaderboards ---------------------------------------------------------------------
function leaderboardRows(profiles: V1Profile[], store: V2Store, tenantId: string, gameId: string) {
  const presence = tenantSocial(store, tenantId).presence;
  const labelFor = (actorId: string) => presence.find((entry) => entry.actorId === actorId)?.label || actorId;
  return profiles
    .map((profile) => {
      const sessions = (profile.sessions || []).filter((item) => item.gameId === gameId);
      if (!sessions.length) return null;
      return {
        actorId: profile.actorId,
        label: labelFor(profile.actorId),
        bestScore: Math.max(...sessions.map((item) => item.score || 0)),
        seconds: sessions.reduce((sum, item) => sum + (item.seconds || 0), 0),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null && row.bestScore > 0)
    .sort((a, b) => b.bestScore - a.bestScore)
    .slice(0, 20);
}

export async function getPhantomPlayLeaderboard(session: AccessSession, gameId: string, options: { tenantId?: unknown } = {}) {
  const tenantId = tenantIdFor(session, options.tenantId);
  const [store, v1] = await Promise.all([readStore(), readV1Store()]);
  return { gameId, rows: leaderboardRows(tenantProfiles(v1.profiles, tenantId), store, tenantId, gameId) };
}

// ---- discovery ---------------------------------------------------------------------------
export async function getPhantomPlayDiscovery(session: AccessSession, options: { tenantId?: unknown } = {}) {
  const tenantId = tenantIdFor(session, options.tenantId);
  const actorId = actorIdFor(session);
  const [store, v1] = await Promise.all([readStore(), readV1Store()]);
  const catalog = fullCatalog(v1.submissions);
  const profiles = tenantProfiles(v1.profiles, tenantId);
  const weekCutoff = Date.now() - 7 * 86400_000;
  const playCounts = new Map<string, number>();
  for (const profile of profiles) for (const item of profile.sessions || []) {
    if (Date.parse(item.startedAt) >= weekCutoff) playCounts.set(item.gameId, (playCounts.get(item.gameId) || 0) + 1);
  }
  const avg = (gameId: string) => ratingSummary(store.reviews, tenantId, gameId);
  const known = (id: string) => catalog.some((game) => game.id === id);
  const bucket = tenantSocial(store, tenantId);
  const friends = bucket.friendships.filter((item) => item.status === "accepted" && (item.a === actorId || item.b === actorId)).map((item) => (item.a === actorId ? item.b : item.a));
  const friendsPlaying = livePresence(bucket)
    .filter((entry) => friends.includes(entry.actorId) && entry.gameId && entry.status !== "invisible")
    .map((entry) => ({ gameId: entry.gameId, actorId: entry.actorId, label: entry.label }));
  return {
    trending: [...playCounts.entries()].filter(([id]) => known(id)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([gameId, plays]) => ({ gameId, plays })),
    topRated: catalog.map((game) => ({ gameId: game.id, ...avg(game.id) })).filter((row) => row.reviewCount >= 2 && (row.averageRating ?? 0) >= 3.5).sort((a, b) => (b.averageRating ?? 0) - (a.averageRating ?? 0)).slice(0, 6).map(({ gameId, averageRating }) => ({ gameId, averageRating })),
    hiddenGems: catalog.map((game) => ({ gameId: game.id, plays: playCounts.get(game.id) || 0, ...avg(game.id) })).filter((row) => (row.averageRating ?? 0) >= 4 && row.plays < 10).slice(0, 6).map(({ gameId, averageRating }) => ({ gameId, averageRating })),
    newReleases: v1.submissions.filter((item) => item.status === "approved").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map((item) => ({ gameId: `community:${item.id}` })),
    friendsPlaying,
  };
}

// ---- resume state (V1 sessions, read-only) --------------------------------------------------
export async function getPhantomPlayResumeState(session: AccessSession, gameId: string, options: { tenantId?: unknown } = {}) {
  const tenantId = tenantIdFor(session, options.tenantId);
  const actorId = actorIdFor(session);
  const v1 = await readV1Store();
  const profile = v1.profiles[profileKey(tenantId, actorId)];
  if (!profile) return { gameId, state: null };
  const latest = (profile.sessions || []).filter((item) => item.gameId === gameId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const canResume = !!latest && !latest.endedAt && latest.progress > 0 && latest.progress < 100 && !!latest.state && Object.keys(latest.state).length > 0;
  return { gameId, state: canResume ? latest.state : null, progress: latest?.progress ?? null, updatedAt: latest?.updatedAt || null };
}

// ---- developer analytics ---------------------------------------------------------------------
export async function getPhantomPlayDeveloperAnalytics(session: AccessSession, options: { tenantId?: unknown } = {}) {
  const tenantId = tenantIdFor(session, options.tenantId);
  const actorId = actorIdFor(session);
  const [store, v1] = await Promise.all([readStore(), readV1Store()]);
  const profiles = tenantProfiles(v1.profiles, tenantId);
  const own = v1.submissions.filter((item) => item.developerId === actorId).map((item) => ({ gameId: `community:${item.id}`, title: item.title, status: item.status }));
  const builtIns = session.canManageAccess ? PHANTOMPLAY_BUILT_IN_GAMES.map((game) => ({ gameId: game.id, title: game.title, status: "approved" })) : [];
  const wishlistCounts = new Map<string, number>();
  for (const list of Object.values(store.wishlists)) for (const id of list) wishlistCounts.set(id, (wishlistCounts.get(id) || 0) + 1);
  return {
    tenantId,
    games: [...own, ...builtIns].map((entry) => ({
      ...entry,
      ...gameStats(profiles, entry.gameId),
      ...(({ reviews: _reviews, ...rest }) => rest)(ratingSummary(store.reviews, tenantId, entry.gameId)),
      wishlists: wishlistCounts.get(entry.gameId) || 0,
    })),
  };
}

// ---- workspace policy --------------------------------------------------------------------------
export async function getPhantomPlayWorkspacePolicy(session: AccessSession, options: { tenantId?: unknown } = {}) {
  const tenantId = tenantIdFor(session, options.tenantId);
  const store = await readStore();
  return { tenantId, policy: store.policies[tenantId] || defaultWorkspacePolicy(), isDefault: !store.policies[tenantId] };
}

export async function updatePhantomPlayWorkspacePolicy(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const store = await readStore();
  const policy = store.policies[tenantId] || defaultWorkspacePolicy();
  if (Array.isArray(input.approvedGameIds)) policy.approvedGameIds = input.approvedGameIds.map((id) => clean(id, 180)).filter(Boolean).slice(0, 500);
  if (input.maxContentRating !== undefined) policy.maxContentRating = safeRating(input.maxContentRating);
  if (input.dailyMinuteLimit === null) policy.dailyMinuteLimit = null;
  else if (input.dailyMinuteLimit !== undefined) policy.dailyMinuteLimit = Math.round(clamp(input.dailyMinuteLimit, 0, 1440));
  if (typeof input.allowCommunityGames === "boolean") policy.allowCommunityGames = input.allowCommunityGames;
  if (typeof input.allowRooms === "boolean") policy.allowRooms = input.allowRooms;
  policy.updatedAt = now();
  store.policies[tenantId] = policy;
  await writeStore(store);
  return { tenantId, policy };
}

// Applies the workspace policy to a catalog. Exposed so the V1 snapshot route
// (or the frontend, until the route adopts it) can honor school/company rules.
export function applyWorkspacePolicy(catalog: PhantomPlayGame[], policy: WorkspacePolicy): PhantomPlayGame[] {
  return catalog.filter((game) => {
    if (ratingRank[game.contentRating] > ratingRank[policy.maxContentRating]) return false;
    if (!policy.allowCommunityGames && game.kind === "community") return false;
    if (policy.approvedGameIds.length && !policy.approvedGameIds.includes(game.id)) return false;
    return true;
  });
}

export async function getPhantomPlayV2StoreStatus() {
  const store = await readStore();
  return {
    provider: "local_json",
    pathConfigured: Boolean(process.env.PHANTOMFORCE_PHANTOMPLAY_V2_PATH),
    tenantsWithSocial: Object.keys(store.social).length,
    reviews: store.reviews.length,
    policies: Object.keys(store.policies).length,
  };
}
