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
