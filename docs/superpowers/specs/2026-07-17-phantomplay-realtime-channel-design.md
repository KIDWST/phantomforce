# PhantomPlay Realtime Channel — Design

## Problem

PhantomPlay's game-room multiplayer (`server/src/phantom-ai/phantomplay.ts`,
routes in `server/src/index.ts` ~5031-5117) is polling-based: clients GET
`/api/phantomplay/rooms/:code` every 1750ms (`ROOM_POLL_MS` in
`app/js/phantomplay.js`) and only the room host's action is written
server-side via `PATCH .../match-state`; a non-host participant's action is
relayed only on the *next* poll. Round trip for a non-host action to be seen
by everyone else can be up to ~3.5s (poll-to-reach-host + poll-to-see-result).

That's acceptable for the turn-paced games currently using rooms
(`kingdom-breakers.html`, `tidefront-tactics.html`, `crown-circuit.html`), but
it's unusable for a real-time twitch fighter like Phantom Rumble, which is
about to grow networked 1v1/2v2/FFA modes (see the Phantom Rumble Ninja
Polish spec). Rather than build one-off fast networking inside Phantom
Rumble, this is a platform capability: every current and future PhantomPlay
game should get fast sync through the same generic room contract, without
each game inventing its own transport.

## Decision: SSE push + POST actions, not WebSocket

Considered full WebSocket (`@fastify/websocket`) vs Server-Sent Events (SSE)
for server→client push, paired with a plain POST for client→server actions
either way. Went with **SSE + POST**:

- The server is a single Fastify process (`server/src/index.ts:476-486`,
  `listen()` at `:9314`) reachable only through a Pangolin tunnel
  (`api.phantomforce.online → 127.0.0.1:5190`, `mode: http`,
  path-prefix proxy, per
  `C:\Users\jorda\Documents\PhantomForce-Infrastructure\windows-host-pangolin-ai\phantomforce-ai-blueprint.yaml`).
  That tunnel config has no explicit `Upgrade`/WebSocket handling configured.
  SSE is a plain long-lived HTTP response — it works through any HTTP-mode
  reverse proxy with zero config changes. WebSocket would need the tunnel's
  upgrade passthrough verified (and possibly fixed) before it could be
  trusted in production.
- No new server dependency (`ws`/`socket.io`/`@fastify/websocket` are not
  currently installed; SSE needs none).
- For this workload (state-sync messages, not voice/video), SSE + POST is
  latency-equivalent in practice to WebSocket — both are effectively
  "instant" (network RTT) compared to the current 1750ms poll. The
  bidirectional-single-connection advantage of WebSocket doesn't matter here.
- Same session/workspace-scoped auth model as every existing room route
  either way — this decision doesn't change the privacy/trust boundary,
  only delivery timing.

## Transport detail: fetch-streamed NDJSON, not native EventSource

`requireAccessSession` (`server/src/access/session.ts:576`) resolves the
caller from a bearer token read off the `Authorization` header
(`readBearerToken`). Browser `EventSource` cannot set custom headers, so a
native `EventSource` client would need the token in the URL's query string
— which then lands in server logs, browser history, and any tunnel access
log. That's a real regression on the "most private for our customers" bar,
not just a style choice, so it's out.

Instead, the client opens the stream with `fetch()` (which *can* set
`Authorization: Bearer <token>` exactly like every other call in
`authHeaders()`/`api()`, `app/js/phantomplay.js:179-189`) and reads the
response body as newline-delimited JSON (NDJSON) via
`response.body.getReader()` + `TextDecoder`, splitting on `\n`. The server
writes one JSON object per line (`{"type":"state",...}` /
`{"type":"action",...}` / `{"type":"ping"}`) instead of SSE's `event:`/
`data:` framing — simpler to produce and parse when neither side is using
a built-in `EventSource`/SSE library anyway. Same guarantee of working
through a plain HTTP-mode tunnel (it's still just a chunked HTTP response),
same zero-new-dependency property.

## Server changes

`server/src/phantom-ai/phantomplay.ts`:

- Add an in-memory `Map<roomCode, Set<StreamConnection>>` of open NDJSON
  stream connections per room. This is new state — `phantomplay.ts` has no
  in-memory room registry today (every mutation does a full
  `readStore()`/`writeStore()` round trip against `.phantom/phantomplay.json`,
  `server/src/phantom-ai/phantomplay.ts:896-950`) — so this map exists
  purely to track open server responses, not as a room cache.
- Add `broadcastRoom(code, store)`: builds the same `roomView(room)`
  snapshot already used for the poll response and writes it as one
  `{"type":"state",...}\n` line to every open connection for that room
  code. Call this explicitly after the `await writeStore(store)` line in
  each of the five mutating functions: `createPhantomPlayRoom` (~L1352),
  `joinPhantomPlayRoom` (~L1390), `leavePhantomPlayRoom` (~L1409),
  `updatePhantomPlayRoomMatchState` (~L1481), `setPhantomPlayRoomReady`
  (~L1506) — these are the exhaustive set of places a room changes.
- Add a short per-room pending-action queue for non-host `POST .../actions`
  submissions, flushed to the host's own stream connection as a
  `{"type":"action",...}\n` line. The host's client resolves and PATCHes
  match-state exactly as it does today (still the sole write authority —
  this preserves the existing host-authoritative trust model, it just
  removes the poll-interval tax on getting the action *to* the host and the
  result *back out*).
- **Single-process assumption**: this in-memory connection map only works
  if one Node process serves all traffic (true today per
  `server/src/index.ts:9314`, `app.listen(...)` — a single Fastify
  instance). If this ever moves to multiple worker processes, a
  connection's room could be broadcast-from by a different process than
  the one holding the client's live connection. Out of scope to solve here
  — noted so a future multi-process migration doesn't silently break this.

`server/src/index.ts`:

- `GET /api/phantomplay/rooms/:code/stream` — NDJSON streaming endpoint.
  Auth identical to the existing `GET /api/phantomplay/rooms/:code`
  (`requireAccessSession`, reading the `Authorization: Bearer` header —
  works because the client uses `fetch()`, not `EventSource`), plus the
  same participant-of-this-room check `getPhantomPlayRoom` already does.
  On connect: write an immediate `{"type":"state",...}\n` snapshot, then
  hold the response open, relying on `broadcastRoom`. Heartbeat
  `{"type":"ping"}\n` every ~20s to keep intermediate proxies from idling
  the connection out.
- `POST /api/phantomplay/rooms/:code/actions` — same auth + the existing
  rate limit (10 writes/2s/room, currently enforced on the PATCH route)
  applied here too, since this is the new entry point for non-host writes
  in practice.
- The existing `POST /rooms`, `GET /rooms/:code` (poll), `POST
  /rooms/:code/join`, `/leave`, `PATCH /match-state`, `PATCH /ready` routes
  are **unchanged**. Nothing about this design modifies or deprecates them.

## Client changes

`app/js/phantomplay.js`:

- When a room view is open, replace the `setInterval(pollRooms, ROOM_POLL_MS)`
  loop (`syncRoomPolling`/`startRoomPolling`/`stopRoomPolling`,
  `app/js/phantomplay.js:834-848`) with a `fetch()` call to the new
  `/stream` route (same `authHeaders()` as every other call) whose response
  body is read incrementally via `getReader()`, split on `\n`, each line
  `JSON.parse`d. On a `type: "state"` line, apply exactly the same handling
  `pollRooms()` already does today (`upsertRoom` + `pushMatchStateToGame` —
  same downstream code path, this is a trigger-source swap, not a new
  state-handling path).
- If the stream errors out or closes repeatedly (a small retry budget,
  e.g. 3 failures), fall back to the existing polling loop automatically
  and log a warning — belt-and-suspenders for any network/proxy that
  mishandles a long-lived chunked response.
- Non-host outgoing actions switch from "queue until next poll tick" to an
  immediate `POST .../actions` call.
- The `match-state` / `match-action` postMessage contract to the game
  iframe is **unchanged**. Games do not know or care whether the host shell
  is polling or streaming underneath — this is a transport swap behind the
  existing protocol. Existing games (kingdom-breakers, tidefront-tactics,
  crown-circuit) get the latency improvement automatically with no code
  changes on their side.

## Non-goals

- No WebSocket, no voice/video, no P2P — server remains the sole relay,
  same as today.
- No changes to room lifecycle semantics (`ROOM_TTL_MINUTES=90`,
  `ROOM_RECONNECT_GRACE_SECONDS=45`, `ROOM_MATCH_STATE_MAX_BYTES=65536` all
  carry over unchanged).
- No migration requirement for the three existing room-using games — they
  keep working on the old polling path indefinitely; adopting the stream is
  opt-in per game (in practice: automatic once `phantomplay.js`'s room view
  switches transport, since the host shell change is generic).

## Verification before calling this done

The one real unknown is SSE behavior through the actual Pangolin tunnel (not
just localhost) — chunked/buffered responses through some proxies can delay
or batch SSE frames. Before shipping: open a room through
`https://app.phantomforce.online`, confirm `event: state` messages arrive
promptly (not just on tunnel flush/close), and confirm the connection
survives at least one heartbeat interval without dropping. If the tunnel
mishandles SSE, the polling fallback keeps the platform functional while
that gets debugged — this is not a blocking dependency for the rest of the
room feature to ship.
