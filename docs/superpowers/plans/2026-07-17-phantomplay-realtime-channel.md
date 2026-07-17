# PhantomPlay Realtime Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PhantomPlay's 1750ms room polling with a push-based NDJSON stream, so a non-host participant's action reaches the host and comes back in roughly one network round trip instead of up to ~3.5s.

**Architecture:** A new `GET /api/phantomplay/rooms/:code/stream` route holds a chunked HTTP response open per connected client and writes one JSON object per line whenever the room changes; a new `POST /api/phantomplay/rooms/:code/actions` route lets non-host participants submit actions immediately instead of waiting for a poll tick, relayed to the host over that same stream. Existing REST routes (create/join/leave/match-state PATCH/ready, and the old polling GET) are untouched — this is additive.

**Tech Stack:** Fastify (server, `server/src/index.ts`), TypeScript, `server/src/phantom-ai/phantomplay.ts` room store (disk-persisted JSON, `.phantom/phantomplay.json`), vanilla JS client (`app/js/phantomplay.js`), `tsx` test scripts run directly with `node`/`tsx` (no test framework — see `server/scripts/test-phantomplay.ts` for the existing convention: import the module directly, spin up an isolated temp store dir via env vars, assert with a hand-rolled `assert()` helper).

## Global Constraints

- No new npm dependency (no `ws`, `socket.io`, `@fastify/websocket`) — stream transport is a chunked HTTP response, nothing else.
- Auth on every new route must use the existing `requireAccessSession(request, reply)` pattern (`server/src/access/session.ts:576`) — same `if (!session) return reply;` short-circuit as every existing route.
- Client must use `fetch()` for the stream, never `EventSource` — `EventSource` cannot send the `Authorization: Bearer` header this app's auth requires, and putting the token in a URL query string is a privacy regression (logs/history) that's explicitly out per the design doc.
- Existing routes (`POST /rooms`, `GET /rooms/:code`, `POST /rooms/:code/join`, `/leave`, `PATCH /match-state`, `PATCH /ready`) must not change behavior — existing games (`kingdom-breakers.html`, `tidefront-tactics.html`, `crown-circuit.html`) must keep working unmodified.
- The `match-state` postMessage payload shape sent to game iframes must stay exactly `{matchState, readyStates, botSlots, hostControls, participants}` (`pushMatchStateToGame`, `app/js/phantomplay.js:967-977`) — this is a trigger-source swap (poll-detected diff → stream-detected diff), not a payload change.
- Rate limit on match-state writes (10/2s/room, `server/src/index.ts:5138-5155`) is untouched and applies regardless of how the write was triggered.
- Reference spec: `docs/superpowers/specs/2026-07-17-phantomplay-realtime-channel-design.md`.

---

## Task 1: Room-change broadcast registry in `phantomplay.ts`

**Files:**
- Modify: `server/src/phantom-ai/phantomplay.ts` (add near the top-level module state, after the existing `let writes = Promise.resolve();` around line 913)
- Test: `server/scripts/test-phantomplay-stream.ts` (new)

**Interfaces:**
- Produces: `export type PhantomPlayRoomView = ReturnType<typeof roomView>` — the client-safe shape (adds `participantCount`, resolved `status`) already returned by every existing room route; the broadcast registry deals exclusively in this type, never the raw internal `PhantomPlayRoom`, so nothing downstream ever sees a room shape different from what polling already returns.
- Produces: `export function subscribeToRoom(code: string, listener: (room: PhantomPlayRoomView) => void): () => void` — registers a listener for a room code, returns an unsubscribe function.
- Produces: `export function roomSubscriberCount(code: string): number` — for tests to assert subscribe/unsubscribe actually adds/removes.
- Consumes: the existing module-private `roomView(room: PhantomPlayRoom)` function (`server/src/phantom-ai/phantomplay.ts:1065-1084`) — stays module-private, only its return type is exported via the `PhantomPlayRoomView` alias.

- [ ] **Step 1: Write the failing test**

Create `server/scripts/test-phantomplay-stream.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx tsx scripts/test-phantomplay-stream.ts`
Expected: FAIL — `play.subscribeToRoom is not a function` (it doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `server/src/phantom-ai/phantomplay.ts`, add after the existing `let writes = Promise.resolve();` (around line 913):

```ts
// In-memory subscriber registry for the realtime stream (Task 1 of the
// PhantomPlay Realtime Channel plan). This is NOT a room-state cache — the
// disk-backed store (readStore/writeStore above) remains the single source
// of truth. This map only tracks which open server responses want to be
// notified when a given room code changes, so broadcastRoom() (added in
// Task 2) has someone to write to. Single-process only: see the plan's
// Global Constraints for why this doesn't span multiple worker processes.
export type PhantomPlayRoomView = ReturnType<typeof roomView>;
const roomSubscribers = new Map<string, Set<(room: PhantomPlayRoomView) => void>>();

export function subscribeToRoom(code: string, listener: (room: PhantomPlayRoomView) => void): () => void {
  let set = roomSubscribers.get(code);
  if (!set) {
    set = new Set();
    roomSubscribers.set(code, set);
  }
  set.add(listener);
  return () => {
    const current = roomSubscribers.get(code);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) roomSubscribers.delete(code);
  };
}

export function roomSubscriberCount(code: string): number {
  return roomSubscribers.get(code)?.size ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx tsx scripts/test-phantomplay-stream.ts`
Expected: PASS — prints `PASS: room subscriber registry`.

- [ ] **Step 5: Commit**

```bash
git add server/src/phantom-ai/phantomplay.ts server/scripts/test-phantomplay-stream.ts
git commit -m "feat(phantomplay): add in-memory room-change subscriber registry"
```

---

## Task 2: `broadcastRoom` + wire it into the five mutating functions

**Files:**
- Modify: `server/src/phantom-ai/phantomplay.ts` (add `broadcastRoom`, call it in `createPhantomPlayRoom`, `joinPhantomPlayRoom`, `leavePhantomPlayRoom`, `updatePhantomPlayRoomMatchState`, `setPhantomPlayRoomReady`)
- Test: `server/scripts/test-phantomplay-stream.ts` (extend)

**Interfaces:**
- Consumes: `subscribeToRoom`/`roomSubscriberCount` from Task 1; `roomView(room)` (existing, `server/src/phantom-ai/phantomplay.ts:1065-1084`); `createPhantomPlayRoom`, `joinPhantomPlayRoom`, `leavePhantomPlayRoom`, `updatePhantomPlayRoomMatchState`, `setPhantomPlayRoomReady` (existing exported functions, signatures documented in the spec's research).
- Produces: `function broadcastRoom(room: PhantomPlayRoom): void` (module-private — nothing outside this file calls it directly, Task 3's route only calls `subscribeToRoom`).

- [ ] **Step 1: Write the failing test**

Append to `server/scripts/test-phantomplay-stream.ts` (before the final `console.log`):

```ts
import type { AccessSession } from "../src/access/session.js";

const host: AccessSession = { id: "host", userId: "host-user", label: "Host", role: "client", canManageAccess: false, orgId: "org-broadcast", orgRole: "member" };
const guest: AccessSession = { id: "guest", userId: "guest-user", label: "Guest", role: "client", canManageAccess: false, orgId: "org-broadcast", orgRole: "member" };

const createdRoom = await play.createPhantomPlayRoom(host, { gameId: "phantom-rumble", mode: "friends", maxPlayers: 4 }, { entitled: true });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx tsx scripts/test-phantomplay-stream.ts`
Expected: FAIL — `broadcasts.length` stays `0` after the join (no broadcast wired up yet).

- [ ] **Step 3: Write minimal implementation**

In `server/src/phantom-ai/phantomplay.ts`, add directly below the `roomSubscriberCount` function from Task 1:

```ts
function broadcastRoom(room: PhantomPlayRoom): void {
  const listeners = roomSubscribers.get(room.code);
  if (!listeners || listeners.size === 0) return;
  const view = roomView(room);
  for (const listener of listeners) listener(view);
}
```

Then add one `broadcastRoom(room);` call immediately after each of the five `await writeStore(store);` lines that finish a room mutation. Each site already has `room` in scope as the mutated object:

In `createPhantomPlayRoom` (ends around line 1352-1354), after `await writeStore(store);` and before the function's `return`:
```ts
  await writeStore(store);
  broadcastRoom(room);
  return { room: roomView(room) };
```

In `joinPhantomPlayRoom` (ends around line 1388-1392), same pattern — find its `await writeStore(store);` line and add `broadcastRoom(room);` directly after it, before the `return`.

In `leavePhantomPlayRoom` (ends around line 1407-1411), same pattern.

In `updatePhantomPlayRoomMatchState` (`server/src/phantom-ai/phantomplay.ts:1480-1483`):
```ts
  room.updatedAt = now();
  await writeStore(store);
  broadcastRoom(room);
  return { room: roomView(room) };
```

In `setPhantomPlayRoomReady` (`server/src/phantom-ai/phantomplay.ts:1505-1508`):
```ts
  room.updatedAt = now();
  await writeStore(store);
  broadcastRoom(room);
  return { room: roomView(room) };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx tsx scripts/test-phantomplay-stream.ts`
Expected: PASS — prints both `PASS:` lines.

- [ ] **Step 5: Commit**

```bash
git add server/src/phantom-ai/phantomplay.ts server/scripts/test-phantomplay-stream.ts
git commit -m "feat(phantomplay): broadcast room changes to subscribers on every mutation"
```

---

## Task 3: Pending-action queue for non-host `POST .../actions`

**Files:**
- Modify: `server/src/phantom-ai/phantomplay.ts` (add pending-action queue + `queueRoomAction`/`drainRoomActions`)
- Test: `server/scripts/test-phantomplay-stream.ts` (extend)

**Interfaces:**
- Consumes: `PhantomPlayRoom` type, `findRoom`, `tenantIdFor`, `actorIdFor`, `roomStatus` (existing internal helpers already used by `updatePhantomPlayRoomMatchState` and friends — reuse them, don't reimplement).
- Produces: `export async function queuePhantomPlayRoomAction(session: AccessSession, input: Record<string, unknown>): Promise<{ queued: true } | null>` — validates the room exists/is active/caller is a participant, appends `{ actorId, action: input.action, mode: input.mode, queuedAt }` to that room's pending-action list, then immediately calls `broadcastAction(room.code, entry)` (new, parallel to `broadcastRoom` but a distinct event type so Task 4's route can tell state pushes and action relays apart).
- Produces: `function broadcastAction(code: string, entry: { actorId: string; action: unknown; mode: "merge" | "replace"; queuedAt: string }): void` — same subscriber map as `broadcastRoom`, but listeners need to distinguish the two; see Step 3 for how.

- [ ] **Step 1: Write the failing test**

Append to `server/scripts/test-phantomplay-stream.ts`:

```ts
const room2 = await play.createPhantomPlayRoom(host, { gameId: "phantom-rumble", mode: "friends", maxPlayers: 4 }, { entitled: true });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx tsx scripts/test-phantomplay-stream.ts`
Expected: FAIL — `play.subscribeToRoomActions is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `server/src/phantom-ai/phantomplay.ts`, add below the `broadcastRoom` function from Task 2:

```ts
type PhantomPlayRoomActionEntry = { actorId: string; action: unknown; mode: "merge" | "replace"; queuedAt: string };
const roomActionSubscribers = new Map<string, Set<(entry: PhantomPlayRoomActionEntry) => void>>();

export function subscribeToRoomActions(code: string, listener: (entry: PhantomPlayRoomActionEntry) => void): () => void {
  let set = roomActionSubscribers.get(code);
  if (!set) {
    set = new Set();
    roomActionSubscribers.set(code, set);
  }
  set.add(listener);
  return () => {
    const current = roomActionSubscribers.get(code);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) roomActionSubscribers.delete(code);
  };
}

function broadcastAction(code: string, entry: PhantomPlayRoomActionEntry): void {
  const listeners = roomActionSubscribers.get(code);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) listener(entry);
}

// Non-host action intake: a participant who is NOT the room host cannot
// write authoritative matchState directly (updatePhantomPlayRoomMatchState
// enforces that), so this is their only path to influence the match — the
// action is relayed to subscribers (in practice, the host's open stream
// connection) rather than applied to the store here. The host's own client
// decides whether/how to fold it into matchState via the existing
// updatePhantomPlayRoomMatchState route, exactly as it does today when a
// game calls sendMatchAction() and phantomplay.js's handleMatchAction()
// forwards it — this function only removes the poll-interval delay in
// getting the action from a non-host participant to the host in the first
// place.
export async function queuePhantomPlayRoomAction(session: AccessSession, input: Record<string, unknown>): Promise<{ queued: true } | null> {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const room = findRoom(store, tenantId, input.code as string | undefined);
  if (!room) return null;
  const status = roomStatus(room);
  if (status === "ended" || status === "expired") throw new Error("This room is no longer active.");
  if (!room.participants.some((participant) => participant.actorId === actorId)) {
    throw new Error("You are not a participant in this room.");
  }
  const entry: PhantomPlayRoomActionEntry = {
    actorId,
    action: input.action ?? null,
    mode: input.mode === "replace" ? "replace" : "merge",
    queuedAt: now(),
  };
  broadcastAction(room.code, entry);
  return { queued: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx tsx scripts/test-phantomplay-stream.ts`
Expected: PASS — three `PASS:` lines total.

- [ ] **Step 5: Commit**

```bash
git add server/src/phantom-ai/phantomplay.ts server/scripts/test-phantomplay-stream.ts
git commit -m "feat(phantomplay): add non-host action queue relayed to room subscribers"
```

---

## Task 4: `GET .../stream` and `POST .../actions` Fastify routes

**Files:**
- Modify: `server/src/index.ts` (add two routes directly after the existing `PATCH /api/phantomplay/rooms/:code/ready` route, i.e. after line 5188)
- Test: `server/scripts/test-phantomplay-stream-routes.ts` (new — this one talks to a real listening Fastify instance, since it needs to exercise actual HTTP streaming; the other tests in this plan call the module functions directly)

**Interfaces:**
- Consumes: `subscribeToRoom`, `subscribeToRoomActions`, `queuePhantomPlayRoomAction`, `getPhantomPlayRoom` (existing, for the initial snapshot + auth check), `requireAccessSession` (existing).
- Produces: two live HTTP routes. `GET /api/phantomplay/rooms/:code/stream` never returns a normal JSON body — it holds the connection and writes raw NDJSON lines via `reply.raw.write(...)`. `POST /api/phantomplay/rooms/:code/actions` returns `{ ok: true }` or a `403`/`404` matching the existing route error-shape conventions.

**Design note on the test's auth:** the demo-auth persona set (`server/src/access/session.ts:55-87`) is a fixed list of 4 named sessions (`admin-jordan`, `client-chicagoshots`, `client-sports-demo`, `client-past-due`), each tied to a fixed `clientId`/tenant — there's no way to log in via real HTTP as two arbitrary, independently-chosen actors sharing one tenant (that's exactly why `server/scripts/test-phantomplay.ts` and this plan's Tasks 1-3 build `AccessSession` objects by hand instead of logging in). For a real-HTTP test of the stream/actions routes, this task uses the single `admin-jordan` persona throughout (an admin can pass an explicit `tenantId` in the request body per `tenantIdFor`, `server/src/phantom-ai/phantomplay.ts:838-842`) and triggers broadcasts via a second request from the same session — that's sufficient to prove the HTTP/NDJSON wiring (auth extraction, line framing, broadcast-on-change, action relay) end-to-end. Cross-tenant/cross-actor authorization is already covered by Tasks 1-3's direct function calls with distinct synthetic sessions.

- [ ] **Step 1: Write the failing test**

Create `server/scripts/test-phantomplay-stream-routes.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomplay-stream-routes-"));
process.env.PHANTOMFORCE_PHANTOMPLAY_PATH = join(root, "phantomplay.json");
process.env.PHANTOMFORCE_CUSTOMIZATION_DIR = join(root, "customization");
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.HOST = "127.0.0.1";
process.env.PORT = "0"; // OS-assigned free port — this test needs a real listening socket for genuine incremental streaming reads, unlike the other tests in this plan which call module functions directly

const { app } = await import("../src/index.js"); // top-level await in index.ts already calls app.listen() on import, gated only by PHANTOMFORCE_SERVER_LISTEN !== "false" (left unset here, so it listens)
const address = app.server.address();
if (typeof address !== "object" || !address) throw new Error("Server did not report a listen address after import.");
const base = `http://127.0.0.1:${address.port}`;

const loginRes = await fetch(`${base}/auth/demo-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "admin-jordan" }) });
assert(loginRes.ok, `Demo login should succeed; got ${loginRes.status}.`);
const { token } = (await loginRes.json()) as { token: string };
const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const createRes = await fetch(`${base}/api/phantomplay/rooms`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ gameId: "phantom-rumble", mode: "friends", maxPlayers: 4, tenantId: "stream-route-test" }),
});
assert(createRes.ok, `Room creation should succeed; got ${createRes.status}.`);
const created = (await createRes.json()) as { room: { code: string } };
const code = created.room.code;

const streamRes = await fetch(`${base}/api/phantomplay/rooms/${code}/stream?tenant_id=stream-route-test`, { headers: authHeaders });
assert(streamRes.ok, `Stream route should respond 200; got ${streamRes.status}.`);
assert(streamRes.body, "Stream response must have a readable body.");
const reader = streamRes.body!.getReader();
const decoder = new TextDecoder();

let buffer = "";
async function nextLine(timeoutMs = 3000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim()) return JSON.parse(line);
      continue;
    }
    const { value, done } = await reader.read();
    if (done) throw new Error("Stream closed before a line arrived.");
    buffer += decoder.decode(value, { stream: true });
  }
  throw new Error("Timed out waiting for a stream line.");
}

const first = await nextLine();
assert(first.type === "state", `First stream line should be an initial state snapshot; got ${JSON.stringify(first)}.`);

const patchRes = await fetch(`${base}/api/phantomplay/rooms/${code}/match-state`, {
  method: "PATCH",
  headers: authHeaders,
  body: JSON.stringify({ tenantId: "stream-route-test", matchState: { phase: "active" } }),
});
assert(patchRes.ok, `Match-state PATCH should succeed; got ${patchRes.status}.`);
const afterPatch = await nextLine();
assert(afterPatch.type === "state", "A match-state PATCH should push a second state line to the open stream.");
assert((afterPatch.room as any)?.matchState?.phase === "active", "The pushed state should reflect the new matchState.");

const actionRes = await fetch(`${base}/api/phantomplay/rooms/${code}/actions`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ tenantId: "stream-route-test", action: { ping: true } }),
});
assert(actionRes.ok, `Action POST should succeed; got ${actionRes.status}.`);
const actionLine = await nextLine();
assert(actionLine.type === "action" && typeof (actionLine as any).actorId === "string", "An action POST should relay to the open stream as an 'action' line.");

reader.cancel().catch(() => {});
await app.close();
console.log("PASS: stream + actions routes");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx tsx scripts/test-phantomplay-stream-routes.ts`
Expected: FAIL — `streamRes.ok` is falsy (404, route doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `server/src/index.ts`, first extend the import from `./phantom-ai/phantomplay.js` (find the existing multi-line import that already includes `createPhantomPlayRoom, getPhantomPlayRoom, joinPhantomPlayRoom, leavePhantomPlayRoom, updatePhantomPlayRoomMatchState, setPhantomPlayRoomReady` and add three more names to it: `subscribeToRoom, subscribeToRoomActions, queuePhantomPlayRoomAction`.

Then add the two new routes directly after the existing `PATCH /api/phantomplay/rooms/:code/ready` route (`server/src/index.ts:5178-5188`, immediately before whatever route currently follows it):

```ts
// Realtime push for room state — additive alongside the polling GET above.
// Writes newline-delimited JSON (NOT SSE's event:/data: framing, and NOT a
// WebSocket) because the client uses fetch() + a streamed body reader so it
// can send the same Authorization: Bearer header every other route uses;
// EventSource cannot set that header, and putting the token in the URL
// would leak it into logs/history. See docs/superpowers/specs/2026-07-17-
// phantomplay-realtime-channel-design.md for the full rationale.
app.get("/api/phantomplay/rooms/:code/stream", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { code?: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const initial = await getPhantomPlayRoom(session, { code: params.code, tenantId: query.tenant_id });
  if (!initial) return reply.code(404).send({ ok: false, error: "Private room was not found." });

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  reply.raw.write(`${JSON.stringify({ type: "state", room: initial })}\n`);

  const code = String(params.code);
  const unsubscribeState = subscribeToRoom(code, (room) => {
    reply.raw.write(`${JSON.stringify({ type: "state", room })}\n`);
  });
  const unsubscribeActions = subscribeToRoomActions(code, (entry) => {
    reply.raw.write(`${JSON.stringify({ type: "action", ...entry })}\n`);
  });
  const heartbeat = setInterval(() => {
    reply.raw.write(`${JSON.stringify({ type: "ping" })}\n`);
  }, 20_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribeState();
    unsubscribeActions();
  };
  request.raw.on("close", cleanup);
  request.raw.on("error", cleanup);
});

app.post("/api/phantomplay/rooms/:code/actions", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { code?: string };
  try {
    const result = await queuePhantomPlayRoomAction(session, { ...((request.body ?? {}) as Record<string, unknown>), code: params.code });
    return result ? { ok: true, session, ...result } : reply.code(404).send({ ok: false, error: "Private room was not found." });
  } catch (error) {
    return reply.code(403).send({ ok: false, error: error instanceof Error ? error.message : "Action was blocked." });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx tsx scripts/test-phantomplay-stream-routes.ts`
Expected: PASS — prints `PASS: stream + actions routes`.

- [ ] **Step 5: Run the full existing phantomplay test to confirm no regression, then commit**

Run: `cd server && npx tsx scripts/test-phantomplay.ts`
Expected: PASS — this is the existing room/catalog/submission test from before this plan; it must still pass unchanged, since Task 2 only added a side effect (`broadcastRoom`/`broadcastAction` calls) to functions it already exercises, not a behavior change.

```bash
git add server/src/index.ts server/scripts/test-phantomplay-stream-routes.ts
git commit -m "feat(phantomplay): add NDJSON room stream + non-host action POST routes"
```

---

## Task 5: Client — swap room polling for a streamed reader in `phantomplay.js`

**Files:**
- Modify: `app/js/phantomplay.js` (replace the body of `startRoomPolling`/`stopRoomPolling`/`syncRoomPolling` with a streaming equivalent; replace `handleMatchAction`'s PATCH call with a POST to the new `/actions` route)

**Interfaces:**
- Consumes: `authHeaders()` (existing, `app/js/phantomplay.js:179-181`), `roomsViewOpen()`, `activeRoomCodes()`, `upsertRoom()`, `pushMatchStateToGame()` (all existing, unchanged signatures).
- Produces: `function syncRoomStream()` replacing `syncRoomPolling()` as the function called at the end of `render()` (`app/js/phantomplay.js:679`); internally manages one `AbortController`-backed `fetch()` stream per active room code, falling back to the existing `startRoomPolling()`/`pollRooms()` path after repeated stream failures.

This task has no isolated unit test — `phantomplay.js` is a browser client with no existing test harness of its own (confirmed: no `test-phantomplay*.{js,ts}` under `app/`, only server-side `.ts` scripts). Verification is manual, via the browser (Step 3 below), consistent with how the rest of this vanilla-JS admin app's client code is verified elsewhere in this repo.

- [ ] **Step 1: Locate the exact code being replaced**

Confirm current line numbers (they may have shifted slightly if other work has touched this file — search for these exact strings rather than trusting the line numbers below blindly):
- `const ROOM_POLL_MS = 1750;` (`app/js/phantomplay.js:30`)
- `function pollRooms()` through `function syncRoomPolling()` (`app/js/phantomplay.js:801-848`)
- `handleMatchAction` (`app/js/phantomplay.js:986-1001`)
- The call site `bind(); syncRoomPolling();` inside `render()` (`app/js/phantomplay.js:679`)

- [ ] **Step 2: Add the streaming reader alongside the existing polling functions**

Add directly after the existing `stopRoomPolling()` function (`app/js/phantomplay.js:840-843`), before `syncRoomPolling()`:

```js
// ---- Private rooms: live sync via streamed NDJSON (replaces polling) ----
// Falls back to the original poll loop (startRoomPolling/pollRooms, above)
// after STREAM_FAILURE_LIMIT consecutive failures, so a network/proxy that
// mishandles a long-lived chunked response degrades to the old behavior
// instead of breaking room sync outright.
const roomStreams = new Map(); // code -> AbortController
let roomStreamFailures = 0;
const STREAM_FAILURE_LIMIT = 3;

async function openRoomStream(code) {
  if (roomStreams.has(code)) return;
  const controller = new AbortController();
  roomStreams.set(code, controller);
  try {
    const response = await fetch(`/api/phantomplay/rooms/${encodeURIComponent(code)}/stream?tenant_id=${encodeURIComponent(currentTenantId())}`, {
      headers: authHeaders(),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`Room stream failed (${response.status}).`);
    roomStreamFailures = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type === "state" && message.room) {
          const previous = ui.snapshot.rooms.find((item) => item.code === message.room.code);
          const changed = JSON.stringify(previous) !== JSON.stringify(message.room);
          upsertRoom(message.room);
          if (changed) {
            if (!ui.player) render();
            if (ui.player?.roomCode === message.room.code) pushMatchStateToGame(message.room);
          }
        }
        // "action" and "ping" lines require no client-side handling here —
        // "action" lines are consumed by the ROOM HOST's stream to decide
        // whether to fold the action into matchState (a follow-up call to
        // updateHostControls-style match-state PATCH, left as a game-level
        // concern the same way handleMatchAction's poll-era version was);
        // "ping" is purely a keep-alive.
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      roomStreamFailures += 1;
      if (roomStreamFailures >= STREAM_FAILURE_LIMIT) {
        console.warn("PhantomPlay room stream failed repeatedly, falling back to polling.", error);
        startRoomPolling();
      }
    }
  } finally {
    roomStreams.delete(code);
  }
}

function closeRoomStream(code) {
  const controller = roomStreams.get(code);
  if (controller) controller.abort();
  roomStreams.delete(code);
}

function syncRoomStream() {
  if (roomStreamFailures >= STREAM_FAILURE_LIMIT) { syncRoomPolling(); return; }
  if (!roomsViewOpen() || ui.offline) {
    for (const code of [...roomStreams.keys()]) closeRoomStream(code);
    return;
  }
  const desired = new Set(activeRoomCodes());
  for (const code of [...roomStreams.keys()]) if (!desired.has(code)) closeRoomStream(code);
  for (const code of desired) if (!roomStreams.has(code)) openRoomStream(code);
}
```

- [ ] **Step 3: Swap the call site and the outgoing-action call**

Replace the render()-driven call (`app/js/phantomplay.js:679`):
```js
bind(); syncRoomPolling();
```
with:
```js
bind(); syncRoomStream();
```

Replace `handleMatchAction`'s body (`app/js/phantomplay.js:986-1001`) — the PATCH-to-match-state call becomes a POST to the new `/actions` route, since this is exactly the non-host-action-relay path the new route exists for (the existing PATCH-based path stays reachable for direct host writes elsewhere, e.g. `updateHostControls`, which is unchanged):

```js
async function handleMatchAction(action, mode) {
  const roomCode = ui.player?.roomCode;
  if (!roomCode) return;
  const room = ui.snapshot.rooms.find((item) => item.code === roomCode);
  if (!room) return;
  if (room.hostActorId === ui.snapshot.actorId) {
    // The host still writes matchState directly and authoritatively —
    // unchanged from the polling-era behavior.
    try {
      const result = await api(`/api/phantomplay/rooms/${encodeURIComponent(roomCode)}/match-state`, { method: "PATCH", body: JSON.stringify({ tenantId: currentTenantId(), matchState: action, mode: mode === "replace" ? "replace" : "merge" }) });
      if (result.room) {
        upsertRoom(result.room);
        pushMatchStateToGame(result.room);
      }
    } catch {
      // Rate-limited or transiently blocked — the next stream/poll event resyncs authoritative state either way.
    }
    return;
  }
  // Non-host: relay via the new instant action route instead of waiting on
  // the next poll tick to even reach the host.
  api(`/api/phantomplay/rooms/${encodeURIComponent(roomCode)}/actions`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), action, mode: mode === "replace" ? "replace" : "merge" }) }).catch(() => {});
}
```

- [ ] **Step 4: Manual verification in a browser**

Run: `cd server && PHANTOMFORCE_AUTH_PROVIDER=demo npx tsx src/index.ts` (starts the API on port 5190), then in another terminal `node ops/admin-live/admin-static-server.mjs --root . --port 5281 --api http://127.0.0.1:5190` (per the existing local-preview recipe used elsewhere in this worktree), then in a browser:
1. Open two browser windows/profiles to `http://127.0.0.1:5281`, log in as two different demo sessions.
2. In window A, open PhantomPlay → Together → create a private room for any room-capable game (e.g. `kingdom-breakers`).
3. In window B, join with the room code.
4. Confirm window A's roster updates to show the second participant in well under 1750ms (visibly instant, not "wait a moment then it appears").
5. Open the browser devtools Network tab in window A and confirm a request to `.../stream` is present and stays pending (status "pending"/no fixed content-length) rather than a burst of repeated `.../rooms/:code` GETs — this confirms polling was actually replaced, not just supplemented.

- [ ] **Step 5: Commit**

```bash
git add app/js/phantomplay.js
git commit -m "feat(phantomplay): swap room polling for a streamed reader, action relay for non-hosts"
```

---

## Task 6: Verify the stream survives the real Pangolin tunnel

**Files:** none (verification-only task, no code changes)

This is the one real unknown flagged in the design doc: whether the Pangolin tunnel (`api.phantomforce.online → 127.0.0.1:5190`, plain `mode: http`) buffers or chunks a long-lived streamed response in a way that delays delivery. This must be checked against the actual public tunnel, not just `127.0.0.1`, before this feature is considered done.

- [ ] **Step 1:** With the main-trunk worktree's live stack running (per this repo's `CLAUDE.md` — confirm `https://admin.phantomforce.online/health` reports `root` matching this worktree before testing), open `https://app.phantomforce.online` in two browser sessions and repeat Task 5 Step 4's manual verification against the public URL instead of `127.0.0.1`.
- [ ] **Step 2:** If state changes arrive promptly (sub-second) through the tunnel: done, no further action.
- [ ] **Step 3:** If state changes are delayed or batched through the tunnel: this is expected to trip `STREAM_FAILURE_LIMIT`'s fallback only if the connection actually errors/closes, not merely if it's slow — a slow-but-open stream will not fall back automatically. Note the actual observed behavior in a follow-up task/issue rather than silently shipping degraded behavior; the polling fallback path already exists as a manual mitigation (temporarily reverting the `render()` call site from `syncRoomStream()` back to `syncRoomPolling()`) while the tunnel behavior gets investigated.

