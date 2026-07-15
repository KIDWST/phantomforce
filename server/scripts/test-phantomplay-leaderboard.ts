/* Verifies the PhantomPlay global leaderboard (docs/superpowers/specs/
   2026-07-15-phantomplay-global-leaderboard-design.md) against the REAL
   Postgres dev database (using existing dev-seed users -- see
   scripts/test-database-auth.mjs for the seed identities), with an isolated
   V1 play-session JSON store so the percentile math is deterministic. Any
   PlayerHandle rows this script creates are deleted in `finally`. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import "../src/load-env.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomplay-leaderboard-"));
process.env.PHANTOMFORCE_PHANTOMPLAY_PATH = join(root, "phantomplay.json");

const { prisma } = await import("../src/access/prisma-runtime.js");
assert(prisma, "This test requires DATABASE_URL / Prisma repository mode (server/.env).");

const jordan = await prisma.user.findUnique({ where: { email: "jordan@phantomforce.local" } });
const owner = await prisma.user.findUnique({ where: { email: "owner@chicagoshots.local" } });
const employee = await prisma.user.findUnique({ where: { email: "employee@chicagoshots.local" } });
assert(jordan && owner && employee, "Dev-seed users (see test-database-auth.mjs) must exist -- run the seed first.");

// Two different tenants/orgs (owner's org vs employee's org) so the cross-
// tenant leak this feature is deliberately designed to avoid gets exercised.
const store = {
  profiles: {
    "dev-org-chicagoshots::owner": { tenantId: "dev-org-chicagoshots", actorId: owner.id, sessions: [
      { gameId: "neon-drift", score: 900 },
      { gameId: "signal-match", score: 50 },
    ] },
    "dev-org-phantomforce::employee": { tenantId: "dev-org-phantomforce", actorId: employee.id, sessions: [
      { gameId: "neon-drift", score: 100 },
    ] },
    "phantomforce::jordan": { tenantId: "phantomforce", actorId: jordan.id, sessions: [
      { gameId: "neon-drift", score: 500 },
      { gameId: "signal-match", score: 999 },
    ] },
    // A non-database (legacy/demo) session's data must never join a handle.
    "phantomforce::anon-session": { tenantId: "phantomforce", actorId: "demo-session-xyz", sessions: [
      { gameId: "neon-drift", score: 700 },
    ] },
  },
  submissions: [],
};
await writeFile(process.env.PHANTOMFORCE_PHANTOMPLAY_PATH, JSON.stringify(store), "utf8");

const handleModule = await import("../src/phantom-ai/phantomplay-handle.js");
const claimedUserIds: string[] = [];

try {
  // ---- percentile math ----
  // neon-drift best scores: employee=100, jordan=500, owner=900, anon(no handle)=700.
  // owner's 900 beats employee(100), jordan(500), anon(700) -> 3/3 at-or-below -> 1000.
  const ownerNeonPoints = await handleModule.computeGlobalScoreForUser(owner.id);
  // owner also has signal-match=50 vs jordan's 999 (jordan is the only other player) -> 0/1 -> 0.
  assert(ownerNeonPoints === 1000 /* neon-drift alone would be 1000 */ + 0 /* signal-match */, `owner's global score should be 1000, got ${ownerNeonPoints}`);

  const employeeScore = await handleModule.computeGlobalScoreForUser(employee.id);
  // employee's neon-drift 100 is at-or-below only itself among others (0 of 3 others) -> 0.
  assert(employeeScore === 0, `employee's global score should be 0 (lowest of 4 on their only game), got ${employeeScore}`);

  const jordanScore = await handleModule.computeGlobalScoreForUser(jordan.id);
  // neon-drift 500 vs others {100, 900, 700} -> at-or-below: 100 -> 1/3 -> 333.
  // signal-match 999 vs others {50} -> 1/1 -> 1000.
  assert(jordanScore === 333 + 1000, `jordan's global score should be 1333, got ${jordanScore}`);

  // ---- claiming handles ----
  const ownerSession = { id: "owner", userId: owner.id, label: "Owner", role: "client" as const, canManageAccess: false };
  const jordanSession = { id: "jordan", userId: jordan.id, label: "Jordan", role: "admin" as const, canManageAccess: true, isSuperAdmin: true };
  const employeeSession = { id: "employee", userId: employee.id, label: "Employee", role: "client" as const, canManageAccess: false };
  const demoSession = { id: "demo-session-xyz", label: "Demo", role: "client" as const, canManageAccess: false };

  let noHandleRejected = false;
  try { await handleModule.claimPhantomPlayHandle(demoSession, { username: "no_account" }); } catch { noHandleRejected = true; }
  assert(noHandleRejected, "A non-database-auth session must not be able to claim a global handle.");

  let badShapeRejected = false;
  try { await handleModule.claimPhantomPlayHandle(ownerSession, { username: "no" }); } catch { badShapeRejected = true; }
  assert(badShapeRejected, "A too-short username must be rejected.");

  const ownerClaim = await handleModule.claimPhantomPlayHandle(ownerSession, { username: "ChicagoOwner1" });
  claimedUserIds.push(owner.id);
  assert(ownerClaim.username === "ChicagoOwner1" && ownerClaim.globalScore === 1000, `owner's handle should show globalScore 1000, got ${JSON.stringify(ownerClaim)}`);

  let usernameTaken = false;
  try { await handleModule.claimPhantomPlayHandle(jordanSession, { username: "chicagoowner1" }); } catch { usernameTaken = true; }
  assert(usernameTaken, "Usernames must be case-insensitively unique.");

  const jordanClaim = await handleModule.claimPhantomPlayHandle(jordanSession, { username: "JordanPlays" });
  claimedUserIds.push(jordan.id);
  assert(jordanClaim.globalScore === 1333, `jordan's handle should show globalScore 1333, got ${JSON.stringify(jordanClaim)}`);

  const employeeHandleBefore = await handleModule.getPhantomPlayHandle(employeeSession);
  assert(employeeHandleBefore.hasHandle === false, "A player who hasn't claimed a handle should get hasHandle:false.");
  const employeeClaim = await handleModule.claimPhantomPlayHandle(employeeSession, { username: "EmployeeFC" });
  claimedUserIds.push(employee.id);
  assert(employeeClaim.globalScore === 0);

  // ---- global leaderboard: cross-tenant surface, strict field shape ----
  const board = await handleModule.getPhantomPlayGlobalLeaderboard(ownerSession);
  assert(board.top.length === 3, `expected 3 handles on the leaderboard, got ${board.top.length}`);
  assert(board.top[0].username === "JordanPlays" && board.top[0].rank === 1, "Jordan (1333) should rank #1.");
  assert(board.top[1].username === "ChicagoOwner1" && board.top[1].rank === 2, "Owner (1000) should rank #2.");
  assert(board.top[2].username === "EmployeeFC" && board.top[2].rank === 3, "Employee (0) should rank #3.");
  for (const row of board.top) {
    const keys = Object.keys(row).sort().join(",");
    assert(keys === "globalScore,rank,username", `Leaderboard rows must be exactly {rank, username, globalScore}, got keys: ${keys}`);
  }
  assert(board.self?.username === "ChicagoOwner1" && board.self.rank === 2, "The caller's own rank should be included even though they're in the top 5.");

  // ---- recompute keeps globalScore in sync after a new play session ----
  const updatedStore = JSON.parse(await import("node:fs/promises").then((m) => m.readFile(process.env.PHANTOMFORCE_PHANTOMPLAY_PATH!, "utf8")));
  updatedStore.profiles["dev-org-phantomforce::employee"].sessions.push({ gameId: "signal-match", score: 5000 });
  await writeFile(process.env.PHANTOMFORCE_PHANTOMPLAY_PATH, JSON.stringify(updatedStore), "utf8");
  await handleModule.recomputeGlobalScoreForUser(employee.id);
  const employeeAfter = await handleModule.getPhantomPlayHandle(employeeSession);
  // signal-match 5000 vs others {50 (owner), 999 (jordan)} -> 2/2 at-or-below -> 1000. Plus neon-drift's 0 -> 1000 total.
  assert(employeeAfter.globalScore === 1000, `employee's globalScore should update to 1000 after a new best score, got ${employeeAfter.globalScore}`);

  console.log(JSON.stringify({ ok: true, percentileMath: true, handleUniqueness: true, databaseAuthRequired: true, leaderboardFieldsMinimal: true, recomputeOnNewScore: true }));
} finally {
  await prisma.playerHandle.deleteMany({ where: { userId: { in: claimedUserIds } } });
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
}
