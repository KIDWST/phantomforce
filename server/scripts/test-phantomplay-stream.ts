import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomplay-stream-"));
process.env.PHANTOMFORCE_PHANTOMPLAY_PATH = join(root, "phantomplay.json");
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.NODE_ENV = "development";

const play = await import("../src/phantom-ai/phantomplay.js");

assert(play.roomSubscriberCount("NOPE00") === 0, "Unknown room codes start with zero subscribers.");

let received: unknown[] = [];
const unsubscribe = play.subscribeToRoom("TEST01", (room) => { received.push(room); });
assert(play.roomSubscriberCount("TEST01") === 1, "Subscribing should register exactly one listener.");

unsubscribe();
assert(play.roomSubscriberCount("TEST01") === 0, "Unsubscribing should remove the listener.");
assert(received.length === 0, "No room was ever broadcast in this test, so the listener should never have fired.");

console.log("PASS: room subscriber registry");

import type { AccessSession } from "../src/access/session.js";

const host: AccessSession = { id: "host", userId: "host-user", label: "Host", role: "client", canManageAccess: false, orgId: "org-broadcast", orgRole: "member" };
const guest: AccessSession = { id: "guest", userId: "guest-user", label: "Guest", role: "client", canManageAccess: false, orgId: "org-broadcast", orgRole: "member" };

const createdRoom = await play.createPhantomPlayRoom(host, { gameId: "neon-drift", mode: "friends", maxPlayers: 4 }, { entitled: true });
const roomCode = createdRoom.room.code;

const broadcasts: unknown[] = [];
const stopListening = play.subscribeToRoom(roomCode, (room) => { broadcasts.push(room); });

await play.joinPhantomPlayRoom(guest, { code: roomCode, tenantId: "org-broadcast" }, { entitled: true });
assert(broadcasts.length === 1, `A join should trigger exactly one broadcast; got ${broadcasts.length}.`);

await play.setPhantomPlayRoomReady(guest, { code: roomCode, tenantId: "org-broadcast", ready: true });
assert(broadcasts.length === 2, `A ready toggle should trigger a second broadcast; got ${broadcasts.length}.`);

await play.updatePhantomPlayRoomMatchState(host, { code: roomCode, tenantId: "org-broadcast", matchState: { phase: "active" } });
assert(broadcasts.length === 3, `A match-state update should trigger a third broadcast; got ${broadcasts.length}.`);

stopListening();
await play.leavePhantomPlayRoom(guest, { code: roomCode, tenantId: "org-broadcast" });
assert(broadcasts.length === 3, "After unsubscribing, further room changes must not reach the old listener.");

console.log("PASS: broadcastRoom fires on every room mutation");

const room2 = await play.createPhantomPlayRoom(host, { gameId: "neon-drift", mode: "friends", maxPlayers: 4 }, { entitled: true });
const code2 = room2.room.code;
await play.joinPhantomPlayRoom(guest, { code: code2, tenantId: "org-broadcast" }, { entitled: true });

const events: Array<{ kind: string; payload: unknown }> = [];
const stop2 = play.subscribeToRoom(code2, (room) => { events.push({ kind: "state", payload: room }); });
const stopActions2 = play.subscribeToRoomActions(code2, (entry) => { events.push({ kind: "action", payload: entry }); });

const queued = await play.queuePhantomPlayRoomAction(guest, { code: code2, tenantId: "org-broadcast", action: { ping: true }, mode: "merge" });
assert(queued?.queued === true, "Queuing a non-host action should succeed for a real participant.");
assert(events.some((e) => e.kind === "action" && (e.payload as any).actorId === "guest-user"), "The action should be relayed to subscribers, tagged with the submitting actor's id.");

const outsider: AccessSession = { id: "outsider", userId: "outsider-user", label: "Outsider", role: "client", canManageAccess: false, orgId: "org-elsewhere", orgRole: "member" };
const outsiderResult = await play.queuePhantomPlayRoomAction(outsider, { code: code2, tenantId: "org-elsewhere", action: { ping: true } }).catch(() => null);
assert(outsiderResult === null, "A caller outside the room's tenant must not be able to queue an action.");

stop2(); stopActions2();
console.log("PASS: non-host action queue + relay");

// Finding 3 (final review): the action relay must reuse the same size guard
// updatePhantomPlayRoomMatchState already enforces on matchState (same
// ROOM_MATCH_STATE_MAX_BYTES budget) — an oversized action must be rejected,
// not silently relayed.
let oversizedRejected = false;
try {
  await play.queuePhantomPlayRoomAction(guest, { code: code2, tenantId: "org-broadcast", action: { blob: "x".repeat(200_000) } });
} catch (error) {
  oversizedRejected = true;
  assert(error instanceof Error && /too large/i.test(error.message), `An oversized action should be rejected with a size-limit error; got: ${error instanceof Error ? error.message : error}`);
}
assert(oversizedRejected, "An oversized action payload must be rejected, not queued.");

console.log("PASS: oversized action payload is rejected by the shared size guard");
