import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AccessSession } from "../src/access/session.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomplay-dev-mode-"));
process.env.PHANTOMFORCE_PHANTOMPLAY_PATH = join(root, "phantomplay.json");
process.env.NODE_ENV = "test";

const manager: AccessSession = { id: "manager", userId: "manager-user", label: "Owner", role: "admin", canManageAccess: true, orgId: "org-one", orgRole: "owner" };
const player: AccessSession = { id: "player", userId: "player-user", label: "Player", role: "client", canManageAccess: false, orgId: "org-one", orgRole: "member" };
const developer: AccessSession = { id: "dev", userId: "dev-user", label: "Developer", role: "client", canManageAccess: false, orgId: "org-one", orgRole: "member" };
const otherDeveloper: AccessSession = { id: "other-dev", userId: "other-dev-user", label: "Other Developer", role: "client", canManageAccess: false, orgId: "org-one", orgRole: "member" };

try {
  const play = await import("../src/phantom-ai/phantomplay.js");

  const BUILT_IN_ID = "pixel-bloom";

  // Built-in games: only a workspace manager may Dev-Mode them.
  const playerAccess = await play.phantomPlayDevModeAccess(player, BUILT_IN_ID);
  assert(playerAccess.allowed === false && playerAccess.kind === "built_in", "A regular player must never get Dev Mode access to a built-in game.");
  const managerAccess = await play.phantomPlayDevModeAccess(manager, BUILT_IN_ID);
  assert(managerAccess.allowed === true && managerAccess.kind === "built_in", "A workspace manager should have Dev Mode access to built-in games.");

  let playerSourceBlocked = false;
  try { await play.getPhantomPlayDevModeSource(player, BUILT_IN_ID); }
  catch { playerSourceBlocked = true; }
  assert(playerSourceBlocked, "A non-manager must never be able to fetch built-in game source.");

  const source = await play.getPhantomPlayDevModeSource(manager, BUILT_IN_ID);
  assert(source.source.includes("<canvas"), "The fetched source should be the game's real HTML/JS, not a stub.");
  assert(source.launchUrl.startsWith("/app/games/pixel-bloom.html"), "The source route should report the game's real launch URL.");

  let traversalBlocked = false;
  try { await play.getPhantomPlayDevModeSource(manager, "../../../etc/passwd"); }
  catch { traversalBlocked = true; }
  assert(traversalBlocked, "A gameId that is not a known built-in must never resolve to an arbitrary file.");

  let unknownGameBlocked = false;
  try { await play.getPhantomPlayDevModeSource(manager, "not-a-real-game-id"); }
  catch { unknownGameBlocked = true; }
  assert(unknownGameBlocked, "An unrecognized gameId must be rejected, not silently allowed.");

  // Community games: the submission's own developer may Dev-Mode it; nobody else can, even a
  // different developer with no relationship to that submission.
  const submissionResult = await play.createPhantomPlaySubmission(developer, {
    title: "Test Community Game", summary: "A test game.", description: "A test game for Dev Mode ownership checks.",
    category: "arcade", contentRating: "everyone", launchUrl: "https://example.com/game.html",
    tags: ["test"], controls: "Arrow keys", dataHandling: "No data collected.", version: "1.0.0",
  });
  const communityId = `community:${submissionResult.submission.id}`;

  const ownerAccess = await play.phantomPlayDevModeAccess(developer, communityId);
  assert(ownerAccess.allowed === true && ownerAccess.kind === "community", "A submission's own developer should have Dev Mode access to it.");
  const otherDevAccess = await play.phantomPlayDevModeAccess(otherDeveloper, communityId);
  assert(otherDevAccess.allowed === false, "A different developer must never get Dev Mode access to someone else's submission.");
  const managerCommunityAccess = await play.phantomPlayDevModeAccess(manager, communityId);
  assert(managerCommunityAccess.allowed === true, "A workspace manager should retain Dev Mode access to any community submission for moderation.");

  let communitySourceBlocked = false;
  try { await play.getPhantomPlayDevModeSource(developer, communityId); }
  catch { communitySourceBlocked = true; }
  assert(communitySourceBlocked, "Community games have no stored source in this data model yet — the route must fail closed, not serve nothing as if it were empty source.");

  // The snapshot catalog must reflect this server-side gate exactly — the client is never
  // trusted to decide this on its own.
  const managerSnapshot = await play.getPhantomPlaySnapshot(manager, { entitled: true, canSubmitGames: true });
  const playerSnapshot = await play.getPhantomPlaySnapshot(player, { entitled: true, canSubmitGames: false });
  const managerEntry = managerSnapshot.catalog.find((game) => game.id === BUILT_IN_ID);
  const playerEntry = playerSnapshot.catalog.find((game) => game.id === BUILT_IN_ID);
  assert(managerEntry?.devModeAvailable === true, "The snapshot catalog should mark Dev Mode available for a manager.");
  assert(playerEntry?.devModeAvailable === false, "The snapshot catalog should mark Dev Mode unavailable for a regular player.");

  console.log("PASS phantomplay dev mode");
  console.log(JSON.stringify({
    builtInGatedToManager: true,
    communityGatedToOwnerOrManager: true,
    pathTraversalBlocked: true,
    unknownGameBlocked: true,
    communitySourceFailsClosed: true,
    snapshotReflectsServerGate: true,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
