import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { AccessSession } from "../src/access/session.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomplay-dev-sandbox-"));
process.env.PHANTOMFORCE_PHANTOMPLAY_PATH = join(root, "phantomplay.json");
process.env.NODE_ENV = "test";

const owner: AccessSession = { id: "owner", userId: "owner-user", label: "Owner", role: "admin", canManageAccess: true, orgId: "org-one", orgRole: "owner" };
const manager: AccessSession = { id: "manager", userId: "manager-user", label: "Manager", role: "admin", canManageAccess: true, orgId: "org-one", orgRole: "admin" };
const player: AccessSession = { id: "player", userId: "player-user", label: "Player", role: "client", canManageAccess: false, orgId: "org-one", orgRole: "member" };

try {
  const play = await import("../src/phantom-ai/phantomplay.js");
  const BUILT_IN_ID = "pixel-bloom";

  // --- Dev Sandbox override (safe default): save/read/discard --------------
  let noOverrideBlocked = false;
  try { await play.savePhantomPlayDevModeOverride(player, BUILT_IN_ID, "<html>hacked</html>"); }
  catch { noOverrideBlocked = true; }
  assert(noOverrideBlocked, "A regular player must never be able to save a Dev Sandbox override.");

  const saved = await play.savePhantomPlayDevModeOverride(manager, BUILT_IN_ID, "<html>manager edit</html>");
  assert(typeof saved.updatedAt === "string" && saved.updatedAt.length > 0, "Saving an override must report when it was saved.");

  const readBack = await play.getPhantomPlayDevModeOverride(manager, BUILT_IN_ID);
  assert(readBack.source === "<html>manager edit</html>", "A saved override must be readable back exactly as saved.");

  let playerCannotReadOverride = false;
  try { await play.getPhantomPlayDevModeOverride(player, BUILT_IN_ID); }
  catch { playerCannotReadOverride = true; }
  assert(playerCannotReadOverride, "A regular player must never be able to read a workspace's Dev Sandbox override.");

  // The real shipped file must be completely untouched by a saved override —
  // this is the core "safe default" guarantee.
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(moduleDir, "..", "..");
  const shippedPath = resolve(repoRoot, "app", "games", `${BUILT_IN_ID}.html`);
  const shippedBefore = await readFile(shippedPath, "utf8");
  assert(!shippedBefore.includes("manager edit"), "Saving a Dev Sandbox override must never modify the real shipped game file.");

  await play.discardPhantomPlayDevModeOverride(manager, BUILT_IN_ID);
  const afterDiscard = await play.getPhantomPlayDevModeOverride(manager, BUILT_IN_ID);
  assert(afterDiscard.source === null, "Discarding a Dev Sandbox override must clear it.");

  // --- Per-game Dev Mode admin toggle ---------------------------------------
  const beforeToggle = await play.phantomPlayDevModeAccess(manager, BUILT_IN_ID);
  assert(beforeToggle.allowed === true, "Dev Mode must default to enabled for a built-in game a manager has never toggled.");

  await play.applyPhantomPlayRatingOverride(owner, { target: "game", gameId: BUILT_IN_ID, devModeEnabled: false, reason: "test_disable" });
  const afterDisable = await play.phantomPlayDevModeAccess(manager, BUILT_IN_ID);
  assert(afterDisable.allowed === false, "An admin must be able to explicitly disable Dev Mode for one specific game.");

  const snapshotDisabled = await play.getPhantomPlaySnapshot(manager, { entitled: true });
  const disabledEntry = snapshotDisabled.catalog.find((game: { id: string }) => game.id === BUILT_IN_ID);
  assert(disabledEntry?.devModeAvailable === false, "The snapshot must reflect a disabled game as Dev Mode unavailable, even for a manager.");
  assert(disabledEntry?.devModeEnabled === false, "The snapshot must expose the raw admin toggle so the UI can render its current state.");

  await play.applyPhantomPlayRatingOverride(owner, { target: "game", gameId: BUILT_IN_ID, devModeEnabled: true, reason: "test_reenable" });
  const afterReenable = await play.phantomPlayDevModeAccess(manager, BUILT_IN_ID);
  assert(afterReenable.allowed === true, "An admin must be able to re-enable Dev Mode for a game they previously disabled.");

  // A game with Dev Mode disabled must also block saving/reading an override,
  // not just the source-fetch/preview path.
  await play.applyPhantomPlayRatingOverride(owner, { target: "game", gameId: BUILT_IN_ID, devModeEnabled: false, reason: "test_disable_again" });
  let saveBlockedWhenDisabled = false;
  try { await play.savePhantomPlayDevModeOverride(manager, BUILT_IN_ID, "<html>should not save</html>"); }
  catch { saveBlockedWhenDisabled = true; }
  assert(saveBlockedWhenDisabled, "Saving a Dev Sandbox override must respect the per-game admin disable switch.");
  await play.applyPhantomPlayRatingOverride(owner, { target: "game", gameId: BUILT_IN_ID, devModeEnabled: true, reason: "test_reenable_again" });

  // --- Publish to live: owner-only, writes the real file --------------------
  let managerCannotPublish = false;
  try { await play.publishPhantomPlayDevModeSource(manager, BUILT_IN_ID, "<html>manager published</html>"); }
  catch { managerCannotPublish = true; }
  assert(managerCannotPublish, "A non-owner manager must never be able to publish a Dev Sandbox edit live, even with full Dev Mode access.");

  let playerCannotPublish = false;
  try { await play.publishPhantomPlayDevModeSource(player, BUILT_IN_ID, "<html>player published</html>"); }
  catch { playerCannotPublish = true; }
  assert(playerCannotPublish, "A regular player must never be able to publish live.");

  const marker = `<!-- dev-sandbox-publish-test-${Date.now()} -->`;
  const publishSource = `${shippedBefore}\n${marker}`;
  const published = await play.publishPhantomPlayDevModeSource(owner, BUILT_IN_ID, publishSource);
  assert(published.gameId === BUILT_IN_ID && typeof published.publishedAt === "string", "Publishing live must report the game and timestamp.");

  const shippedAfter = await readFile(shippedPath, "utf8");
  assert(shippedAfter.includes(marker), "Publishing live must actually write the edited source to the real shipped game file.");

  // Publishing live must clear any pending override, since shipped now equals the edit.
  const overrideAfterPublish = await play.getPhantomPlayDevModeOverride(owner, BUILT_IN_ID);
  assert(overrideAfterPublish.source === null, "Publishing live must clear any pending Dev Sandbox override for that game.");

  // Restore the real file exactly as it was before this test ran, so the test
  // suite never leaves a mutated game file behind.
  await writeFile(shippedPath, shippedBefore, "utf8");
  const restored = await readFile(shippedPath, "utf8");
  assert(restored === shippedBefore, "Test cleanup must restore the shipped game file byte-for-byte.");

  // Path traversal / unknown game must still be rejected for publish, same as source-fetch.
  let traversalBlocked = false;
  try { await play.publishPhantomPlayDevModeSource(owner, "../../../etc/passwd", "<html></html>"); }
  catch { traversalBlocked = true; }
  assert(traversalBlocked, "Publish must reject a gameId that does not resolve to a known built-in game file.");

  let unknownGameBlocked = false;
  try { await play.publishPhantomPlayDevModeSource(owner, "not-a-real-game-id", "<html></html>"); }
  catch { unknownGameBlocked = true; }
  assert(unknownGameBlocked, "Publish must reject an unrecognized gameId.");

  console.log("PASS phantomplay dev sandbox (override + per-game toggle + publish)");
  console.log(JSON.stringify({
    overrideNeverTouchesShippedFile: true,
    overrideGatedToDevModeAccess: true,
    perGameToggleOverridesDefault: true,
    perGameToggleGatesOverrideSaves: true,
    publishOwnerOnly: true,
    publishWritesRealFile: true,
    publishClearsOverride: true,
    publishRejectsTraversalAndUnknownGame: true,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
