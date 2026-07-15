import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AccessSession } from "../src/access/session.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomplay-v2-"));
process.env.PHANTOMFORCE_PHANTOMPLAY_PATH = join(root, "phantomplay.json");
process.env.PHANTOMFORCE_PHANTOMPLAY_V2_PATH = join(root, "phantomplay-v2.json");
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";

const owner: AccessSession = { id: "owner", userId: "owner-user", label: "Owner Studio", role: "admin", canManageAccess: true, orgId: "org-owner", orgRole: "owner", isSuperAdmin: true };
const playerA: AccessSession = { id: "player-a", userId: "player-a", label: "Player A", role: "client", canManageAccess: false, orgId: "org-a", orgRole: "member" };
const playerB: AccessSession = { id: "player-b", userId: "player-b", label: "Player B", role: "client", canManageAccess: false, orgId: "org-a", orgRole: "member" };
const outsider: AccessSession = { id: "player-c", userId: "player-c", label: "Outsider", role: "client", canManageAccess: false, orgId: "org-z", orgRole: "member" };

try {
  const v1 = await import("../src/phantom-ai/phantomplay.js");
  const v2 = await import("../src/phantom-ai/phantomplay-v2.js");

  // Game registration is explicit, idempotent, and additive.
  const before = v1.PHANTOMPLAY_BUILT_IN_GAMES.length;
  v2.registerPhantomPlayV2Games();
  v2.registerPhantomPlayV2Games();
  const after = v1.PHANTOMPLAY_BUILT_IN_GAMES.length;
  assert(after === before + v2.PHANTOMPLAY_V2_GAMES.length, "V2 games should register exactly once into the V1 catalog.");
  assert(v2.PHANTOMPLAY_V2_GAMES.length === 2, "Two V2 built-in games should ship (Phantom Rumble + Sudoku Signal; the rest already exist on main).");
  const rumbleCatalogEntry = v2.PHANTOMPLAY_V2_GAMES.find((game) => game.id === "phantom-rumble");
  assert(rumbleCatalogEntry, "Phantom Rumble must be registered as a V2 built-in game.");
  assert(rumbleCatalogEntry.version === "2.2.3" && rumbleCatalogEntry.launchUrl.endsWith("phantom-rumble.html?v=2.2.3"), "Phantom Rumble V2 metadata must point at the upgraded build.");
  assert(/guard|parry|dodge/i.test(`${rumbleCatalogEntry.summary} ${rumbleCatalogEntry.controls}`), "Phantom Rumble catalog copy must expose guard, parry, and dodge controls.");

  // V2 games are playable through V1's real session pipeline (validation included).
  const started = await v1.startPhantomPlaySession(playerA, { gameId: "sudoku-signal" }, { entitled: true, dailyMinuteLimit: 60 });
  await v1.updatePhantomPlaySession(playerA, started.play.id, { secondsDelta: 120, score: 512, progress: 40, state: { puzzle: "530070000600195000098000060800060003400803001700020006060000280000419005000080079", difficulty: "calm" } });
  const resume = await v2.getPhantomPlayResumeState(playerA, "sudoku-signal");
  assert(typeof resume.state?.puzzle === "string" && resume.progress === 40, "Resume state should surface the latest saved session state.");

  // Presence + friends (same workspace).
  await v2.heartbeatPhantomPlayPresence(playerA, { status: "online" });
  await v2.heartbeatPhantomPlayPresence(playerB, { status: "playing", gameId: "sudoku-signal" });
  await v2.mutatePhantomPlayFriend(playerA, { actorId: "player-b", action: "request" });
  let doubleRequestBlocked = false;
  try { await v2.mutatePhantomPlayFriend(playerA, { actorId: "player-b", action: "request" }); } catch { doubleRequestBlocked = true; }
  assert(doubleRequestBlocked, "Duplicate friend requests must be rejected.");
  let selfAcceptBlocked = false;
  try { await v2.mutatePhantomPlayFriend(playerA, { actorId: "player-b", action: "accept" }); } catch { selfAcceptBlocked = true; }
  assert(selfAcceptBlocked, "The requester must not be able to accept their own request.");
  await v2.mutatePhantomPlayFriend(playerB, { actorId: "player-a", action: "accept" });
  const snapA = await v2.getPhantomPlayV2Snapshot(playerA);
  assert(snapA.social.friends.length === 1 && snapA.social.friends[0].actorId === "player-b", "Accepted friendships should appear in the snapshot.");
  assert(snapA.social.friends[0].status === "playing" && snapA.social.friends[0].gameId === "sudoku-signal", "Friend presence should include live status and game.");
  const snapOutsider = await v2.getPhantomPlayV2Snapshot(outsider);
  assert(snapOutsider.social.friends.length === 0 && snapOutsider.social.presence.length === 0, "Social graphs must stay isolated by tenant.");

  // Reviews: validated, one per actor per game, editable, tenant-scoped.
  let badGameBlocked = false;
  try { await v2.upsertPhantomPlayReview(playerA, "not-a-game", { rating: 5, text: "great" }); } catch { badGameBlocked = true; }
  assert(badGameBlocked, "Reviews must only attach to real catalog games.");
  await v2.upsertPhantomPlayReview(playerA, "sudoku-signal", { rating: 4, text: "Clean merge puzzle, love the resume." });
  await v2.upsertPhantomPlayReview(playerA, "sudoku-signal", { rating: 5, text: "Even better after the resume save worked across devices." });
  await v2.upsertPhantomPlayReview(playerB, "sudoku-signal", { rating: 4, text: "Great break game between tickets." });
  const page = await v2.getPhantomPlayGamePage(playerA, "sudoku-signal");
  assert(page !== null, "Game pages should resolve for catalog games.");
  assert(page!.stats.reviewCount === 2 && page!.stats.averageRating === 4.5, "One review per actor; average should reflect the edit.");
  assert(page!.myReview?.rating === 5, "The caller's own review should be surfaced.");
  assert(page!.patchNotes.length >= 1 && page!.related.every((game) => game.id !== "sudoku-signal"), "Game pages need patch notes and related games.");
  assert(page!.stats.players === 1 && page!.stats.plays === 1, "Game page stats must come from real V1 sessions.");

  // Wishlist + follows + feed.
  await v2.setPhantomPlayWishlist(playerA, "phantom-rumble", { on: true });
  await v2.setPhantomPlayFollow(playerA, { developer: "Tak", on: true });
  const snapA2 = await v2.getPhantomPlayV2Snapshot(playerA);
  assert(snapA2.wishlist.includes("phantom-rumble") && snapA2.follows.includes("Tak"), "Wishlist and follows should persist.");
  assert(snapA2.feed.some((entry) => entry.kind === "review") && snapA2.feed.some((entry) => entry.kind === "follow"), "The activity feed should record community actions.");

  // Leaderboard from real sessions.
  const board = await v2.getPhantomPlayLeaderboard(playerA, "sudoku-signal");
  assert(board.rows.length === 1 && board.rows[0].bestScore === 512, "Leaderboards must reflect real best scores.");

  // Discovery rows.
  const discovery = await v2.getPhantomPlayDiscovery(playerA);
  assert(discovery.trending[0]?.gameId === "sudoku-signal", "Trending should rank this week's real plays.");
  assert(discovery.topRated.some((row) => row.gameId === "sudoku-signal"), "Top rated needs >=2 reviews and a high average.");
  assert(discovery.friendsPlaying.some((row) => row.actorId === "player-b" && row.gameId === "sudoku-signal"), "Friends-playing should combine friendships and presence.");
  const finished = await v1.startPhantomPlaySession(playerA, { gameId: "phantom-rumble" }, { entitled: true, dailyMinuteLimit: 60 });
  await v1.updatePhantomPlaySession(playerA, finished.play.id, { secondsDelta: 10, score: 900, progress: 100, ended: true, state: { wins: 1, matches: 1, bestKos: 4 } });
  const completedResume = await v2.getPhantomPlayResumeState(playerA, "phantom-rumble");
  assert(completedResume.state === null && completedResume.progress === 100, "Completed sessions must not restore stale game state.");

  // Developer analytics: real numbers, admin sees built-ins, players see only their own submissions.
  const ownerAnalytics = await v2.getPhantomPlayDeveloperAnalytics(owner, { tenantId: "org-a" });
  const rumbleRow = ownerAnalytics.games.find((row) => row.gameId === "sudoku-signal");
  assert(rumbleRow && rumbleRow.plays === 1 && rumbleRow.players === 1 && rumbleRow.dau === 1 && rumbleRow.reviewCount === 2, "Admin analytics must be computed from real sessions and reviews.");
  const playerAnalytics = await v2.getPhantomPlayDeveloperAnalytics(playerA);
  assert(playerAnalytics.games.length === 0, "Players without submissions should see no analytics rows.");

  // Workspace policy: defaults, updates, and catalog filtering.
  const defaultPolicy = await v2.getPhantomPlayWorkspacePolicy(playerA);
  assert(defaultPolicy.isDefault && defaultPolicy.policy.approvedGameIds.length === 0, "Workspaces start on the permissive default policy.");
  await v2.updatePhantomPlayWorkspacePolicy(owner, { tenantId: "org-a", approvedGameIds: ["sudoku-signal", "phantom-rumble"], maxContentRating: "everyone", dailyMinuteLimit: 30, allowCommunityGames: false, allowRooms: false });
  const updatedPolicy = await v2.getPhantomPlayWorkspacePolicy(playerA);
  assert(!updatedPolicy.isDefault && updatedPolicy.policy.dailyMinuteLimit === 30 && updatedPolicy.policy.allowRooms === false, "Policy updates should persist per workspace.");
  const filtered = v2.applyWorkspacePolicy(v1.PHANTOMPLAY_BUILT_IN_GAMES, updatedPolicy.policy);
  assert(filtered.length === 2 && filtered.every((game) => ["sudoku-signal", "phantom-rumble"].includes(game.id)), "The approved-game list must filter the catalog.");

  // Routes: flag off -> 404; flag on -> real data; auth required.
  const { app } = await import("../src/index.js");
  const noAuth = await app.inject({ method: "GET", url: "/api/phantomplay/v2" });
  assert(noAuth.statusCode === 401, "V2 routes must require a session.");
  const login = async (sessionId: string) => {
    const response = await app.inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId } });
    assert(response.statusCode === 200, `${sessionId} should obtain a local test token.`);
    return (response.json() as { token: string }).token;
  };
  const ownerToken = await login("admin-jordan");
  process.env.PHANTOMFORCE_PHANTOMPLAY_V2_ENABLED = "false";
  const flaggedOff = await app.inject({ method: "GET", url: "/api/phantomplay/v2", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(flaggedOff.statusCode === 404 && flaggedOff.json().error === "phantomplay_v2_disabled", "The feature flag must disable every V2 route.");
  delete process.env.PHANTOMFORCE_PHANTOMPLAY_V2_ENABLED;
  const snapshotRoute = await app.inject({ method: "GET", url: "/api/phantomplay/v2", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(snapshotRoute.statusCode === 200 && snapshotRoute.json().ok === true, "The V2 snapshot route should answer for signed-in sessions.");
  // PhantomPlay is an optional workspace module on main — enable it for a
  // workspace first (same flow test-phantomplay.ts exercises), then confirm
  // the V1 catalog served by the route includes the registered V2 games.
  const moduleEnable = await app.inject({
    method: "PATCH",
    url: "/phantom-ai/customization/workspace-modules",
    headers: { Authorization: `Bearer ${ownerToken}` },
    payload: { tenant_id: "client-sports-demo", module_id: "phantomplay", enabled: true, accessMode: "entire_organization", allowedMemberIds: [], activityEnabled: true, challengesEnabled: true },
  });
  // Some trunk lines gate PhantomPlay as an optional workspace module; when
  // the enable route is absent (404), the catalog route is open directly.
  const moduleGated = moduleEnable.statusCode === 200;
  const v1Route = await app.inject({ method: "GET", url: moduleGated ? "/api/phantomplay?tenant_id=client-sports-demo" : "/api/phantomplay", headers: { Authorization: `Bearer ${ownerToken}` } });
  const v1Catalog = v1Route.statusCode === 200 ? (v1Route.json().catalog as Array<{ id: string; launchUrl?: string; version?: string }>) : [];
  assert(v1Route.statusCode === 200 && v1Catalog.some((game) => game.id === "phantom-rumble" && game.launchUrl?.endsWith("phantom-rumble.html?v=2.2.3") && game.version === "2.2.3") && v1Catalog.some((game) => game.id === "sudoku-signal"), "The V1 catalog route should include registered V2 games.");
  const gamePageRoute = await app.inject({ method: "GET", url: "/api/phantomplay/v2/games/phantom-rumble", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(gamePageRoute.statusCode === 200 && gamePageRoute.json().game.id === "phantom-rumble", "Game-page route should resolve V2 games.");
  const policyForbidden = await app.inject({ method: "PATCH", url: "/api/phantomplay/v2/workspace-policy", payload: { dailyMinuteLimit: 10 } });
  assert(policyForbidden.statusCode === 401, "Policy updates must require a session.");
  await app.close();

  console.log(JSON.stringify({ ok: true, registered: after - before, friends: snapA.social.friends.length, reviewsAverage: page!.stats.averageRating, leaderboardTop: board.rows[0].bestScore, trending: discovery.trending[0]?.gameId, policyFiltered: filtered.length, flagWorks: true, routesWired: true }));
} finally {
  await rm(root, { recursive: true, force: true });
}
