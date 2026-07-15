/* PhantomPlay global player identity + leaderboard.

   Per docs/superpowers/specs/2026-07-15-phantomplay-global-leaderboard-design.md.
   This is the first cross-tenant-visible surface in the app: the leaderboard
   route below returns ONLY { rank, username, globalScore } for entries other
   than the caller, never business/tenant identity. A cross-tenant data leak
   was found and fixed elsewhere in this codebase (approval-queue.ts /
   vacation-mode.ts) -- treat any change here with that failure mode in mind.

   Handles only exist for database-auth accounts (a real User row). Legacy
   demo/session-based accounts have no userId and cannot claim a handle or
   appear on the leaderboard -- see the design doc's non-goals.

   globalScore is a denormalized cache on PlayerHandle, recomputed here
   whenever a player's best score in some game changes (called from the
   /api/phantomplay/plays/:id route in index.ts, not from ./phantomplay.ts,
   so V1 stays untouched per this codebase's existing convention). */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccessSession } from "../access/session.js";
import { prisma } from "../access/prisma-runtime.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
// V1 store, read-only -- same resolution rule as ./phantomplay.ts and ./phantomplay-v2.ts.
const v1StorePath = () => process.env.PHANTOMFORCE_PHANTOMPLAY_PATH || resolve(repoRoot, ".phantom", "phantomplay.json");

type V1Session = { gameId: string; score: number | null };
type V1Profile = { tenantId: string; actorId: string; sessions: V1Session[] };

async function readAllProfiles(): Promise<V1Profile[]> {
  try {
    const parsed = JSON.parse(await readFile(v1StorePath(), "utf8")) as { profiles?: Record<string, V1Profile> };
    const profiles = parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {};
    return Object.values(profiles);
  } catch {
    return [];
  }
}

/* Built from character codes rather than a \u escape literal, same reasoning
   as ./phantomstore.ts: avoids an editor/pipeline re-interpreting the escape
   sequence as a raw control byte. */
const CONTROL_CHARS = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]", "g");

const clean = (value: unknown, max = 500) => String(value ?? "").trim().replace(CONTROL_CHARS, " ").slice(0, max);

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

function requirePrisma() {
  if (!prisma) throw new Error("The global PhantomPlay leaderboard requires database auth (DATABASE_URL / Prisma repository mode).");
  return prisma;
}

function requireUserId(session: AccessSession): string {
  const userId = session.userId;
  if (!userId) throw new Error("A database-auth account is required for a global PhantomPlay handle.");
  return userId;
}

/* Best score per gameId across every tenant, for one actor. actorId equals
   session.userId for database-auth sessions (see actorIdFor in
   ./phantomplay.ts / ./phantomplay-v2.ts), so this joins cleanly on userId
   without any extra identity table. */
function bestScoresByGame(profiles: V1Profile[], actorId: string): Map<string, number> {
  const best = new Map<string, number>();
  for (const profile of profiles) {
    if (profile.actorId !== actorId) continue;
    for (const item of profile.sessions || []) {
      if (item.score === null || item.score === undefined) continue;
      const current = best.get(item.gameId);
      if (current === undefined || item.score > current) best.set(item.gameId, item.score);
    }
  }
  return best;
}

/* All other players' best scores for one gameId, across every tenant. */
function othersBestScoresForGame(profiles: V1Profile[], gameId: string, excludeActorId: string): number[] {
  const byActor = new Map<string, number>();
  for (const profile of profiles) {
    if (profile.actorId === excludeActorId) continue;
    for (const item of profile.sessions || []) {
      if (item.gameId !== gameId || item.score === null || item.score === undefined) continue;
      const current = byActor.get(profile.actorId);
      if (current === undefined || item.score > current) byActor.set(profile.actorId, item.score);
    }
  }
  return [...byActor.values()];
}

function percentilePoints(myScore: number, others: number[]): number {
  if (!others.length) return 1000;
  const countAtOrBelow = others.filter((score) => score <= myScore).length;
  return Math.max(0, Math.min(1000, Math.round((1000 * countAtOrBelow) / others.length)));
}

export async function computeGlobalScoreForUser(userId: string): Promise<number> {
  const profiles = await readAllProfiles();
  const mine = bestScoresByGame(profiles, userId);
  let total = 0;
  for (const [gameId, myScore] of mine) {
    total += percentilePoints(myScore, othersBestScoresForGame(profiles, gameId, userId));
  }
  return total;
}

export async function recomputeGlobalScoreForUser(userId: string): Promise<void> {
  const db = prisma;
  if (!db) return;
  const handle = await db.playerHandle.findUnique({ where: { userId } });
  if (!handle) return; // no handle claimed yet -- nothing to keep in sync
  const globalScore = await computeGlobalScoreForUser(userId);
  if (globalScore === handle.globalScore) return;
  await db.playerHandle.update({ where: { userId }, data: { globalScore } });
}

export async function getPhantomPlayHandle(session: AccessSession) {
  const userId = session.userId;
  if (!userId) return { hasHandle: false as const };
  const db = requirePrisma();
  const handle = await db.playerHandle.findUnique({ where: { userId } });
  if (!handle) return { hasHandle: false as const };
  return { hasHandle: true as const, username: handle.username, globalScore: handle.globalScore };
}

export async function claimPhantomPlayHandle(session: AccessSession, input: Record<string, unknown>) {
  const userId = requireUserId(session);
  const db = requirePrisma();
  const username = clean(input.username, 20);
  if (!USERNAME_PATTERN.test(username)) {
    throw Object.assign(new Error("Usernames are 3-20 characters: letters, numbers, and underscores only."), { statusCode: 400 });
  }
  const usernameKey = username.toLowerCase();
  const taken = await db.playerHandle.findUnique({ where: { usernameKey } });
  if (taken && taken.userId !== userId) {
    throw Object.assign(new Error("That username is already taken."), { statusCode: 409 });
  }
  const globalScore = await computeGlobalScoreForUser(userId);
  const handle = await db.playerHandle.upsert({
    where: { userId },
    create: { userId, username, usernameKey, globalScore },
    update: { username, usernameKey },
  });
  return { hasHandle: true as const, username: handle.username, globalScore: handle.globalScore };
}

export async function getPhantomPlayGlobalLeaderboard(session: AccessSession) {
  // An empty leaderboard is a valid, honest state during the ongoing
  // database-auth migration (see the design doc's non-goals) -- unlike
  // claimPhantomPlayHandle, a read here should degrade quietly rather than
  // 500 on every page load while Prisma repository mode isn't configured.
  const db = prisma;
  if (!db) return { top: [], self: null };
  const ranked = await db.playerHandle.findMany({ orderBy: [{ globalScore: "desc" }, { createdAt: "asc" }] });
  const top5 = ranked.slice(0, 5).map((row, index) => ({ rank: index + 1, username: row.username, globalScore: row.globalScore }));
  const userId = session.userId;
  if (!userId) return { top: top5, self: null };
  const selfIndex = ranked.findIndex((row) => row.userId === userId);
  const self = selfIndex === -1 ? null : { rank: selfIndex + 1, username: ranked[selfIndex].username, globalScore: ranked[selfIndex].globalScore };
  return { top: top5, self };
}
