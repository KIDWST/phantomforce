# Voice Channels — Design

## Problem

PhantomForce has no voice communication anywhere in the product. Two real
needs, both explicitly requested (no artificial restriction on who can use
either — any authenticated PhantomForce user, not just `developer` role):

1. **In-game party voice.** When players join a PhantomPlay "Together" room
   together (`app/js/phantomplay.js`'s existing private-room flow — create/
   join by code, roster, ready checks, host controls), they should be
   automatically in voice with the other room members for that match. No
   separate "join voice" step, and no dependency on which game is being
   played (games stay dumb, sandboxed rendering surfaces — see Non-goals).
2. **A "mini Discord" inside PhantomForce.** Any authenticated user can
   create a text+voice channel, invite specific other PhantomForce users to
   it (real accounts, not open links), and use it independent of any game —
   a standalone community/team communication surface reachable from the
   sidebar.

Constraint carried into every decision below: **no Discord dependency, no
external accounts, no downloads.** Native WebRTC only; audio is
browser-to-browser (mesh), the server never touches or decodes audio, only
relays the small signaling messages needed to set up each peer connection.

## Architecture rationale

### Signaling transport: reuse the NDJSON-stream + POST pattern, not WebSocket

`server/src/index.ts` has **no WebSocket support at all** — `ws` /
`socket.io` / `@fastify/websocket` are not installed, confirmed by grep
across `server/src/index.ts` imports and `package.json`. This isn't an
oversight: the PhantomPlay Realtime Channel work
(`docs/superpowers/specs/2026-07-17-phantomplay-realtime-channel-design.md`)
already evaluated WebSocket for a very similar problem (server→client push
for room state) and rejected it, because the production path
(`api.phantomforce.online` → local server) goes through a Pangolin tunnel
configured in plain HTTP mode with no `Upgrade` passthrough verified. A raw
WebSocket signaling endpoint would carry that same unverified-tunnel risk
for zero benefit — signaling messages (SDP offers/answers, ICE candidates)
are small, infrequent, and not latency-critical the way game-state sync is
(a few messages at connection setup, occasional renegotiation — nothing
like the 1750ms-poll-replacement problem the realtime channel spec solved).

So voice signaling reuses the **exact same transport shape already proven
and shipped** for PhantomPlay rooms: a `GET .../stream` endpoint that
`reply.hijack()`s the connection and writes newline-delimited JSON
(`{"type":"...","...":...}\n` per line, not SSE `event:`/`data:` framing,
not a WebSocket upgrade), read on the client via `fetch()` +
`response.body.getReader()` + `TextDecoder`. Same reasons apply unchanged:
`fetch()` can set `Authorization: Bearer <token>` (every other PhantomForce
route's auth model); native `EventSource` cannot set custom headers, so a
token would have to ride in the URL query string and leak into logs/tunnel
access records — unacceptable. Outbound signaling messages (this peer's
offer/answer/ICE candidate) are sent via plain `POST` calls, mirroring
`POST /api/phantomplay/rooms/:code/actions`.

Concretely: `GET /api/voice/sessions/:sessionId/stream` (NDJSON, one
connection per participant, relays messages addressed to that participant)
and `POST /api/voice/sessions/:sessionId/signal` (one participant's outbound
offer/answer/ICE candidate, addressed to a specific peer's `actorId`). This
is a pure relay — the server reads a `{ to, kind, payload }` envelope and
forwards it verbatim to the addressed peer's open stream connection; it
never inspects or interprets `payload` (which is opaque SDP/ICE JSON to the
server). Same in-memory-subscriber-map pattern already shipped in
`server/src/phantom-ai/phantomplay.ts` (`subscribeToRoom`/`broadcastRoom`)
— new code, but a proven shape, not a new architectural idea.

**Single-process assumption carries over unchanged** from the realtime
channel spec: the in-memory per-session connection map only works because
one Node process serves all traffic today. Flagged again here so a future
multi-process migration doesn't silently break voice signaling the same way
it would silently break room state sync.

### Topology: STUN-only mesh — explicit known limitation, not silently shipped

Every voice session (in-game party or standalone channel) uses a **mesh**
topology: every participant opens a direct `RTCPeerConnection` to every
other participant and sends/receives audio peer-to-peer. This matches both
use cases' actual room sizes (PhantomPlay private rooms cap at 6-8 players
for "friends" mode; a "mini Discord" channel is a small team/community
space, not a large public server) — mesh becomes bandwidth-expensive above
roughly 6-8 simultaneous speakers, but neither use case is architected for
more than that today, so a Selective Forwarding Unit (SFU) is unwarranted
complexity for this iteration. See Non-goals.

ICE configuration is **STUN-only** (a public STUN server, e.g.
`stun:stun.l.google.com:19302`, or a self-hosted `coturn` in STUN-only mode
if avoiding a third-party dependency matters more than convenience — a
concrete follow-up decision, not resolved here). **This is a known, real
limitation, called out honestly rather than shipped as if solved:** STUN
alone lets two peers discover their public IP:port and connect directly
when at least one side is behind a NAT that does simple endpoint-independent
mapping. It does **not** work when a peer is behind a **symmetric NAT** or
certain **CGNAT** configurations common on some mobile/corporate networks —
those require a **TURN** relay server (which relays the actual audio
bytes, unlike STUN which only helps with address discovery) to complete the
connection at all. Without TURN, some fraction of users — impossible to
predict in advance, but well-documented in the WebRTC ecosystem as a
non-trivial minority — will see a connection attempt silently fail or hang
in "connecting" state with no way to recover. This is flagged as
`docs/quality/QUALITY_BACKLOG.md` Q-0020 for Jordan's review and is
explicit, tracked follow-up work: standing up a TURN relay (self-hosted
`coturn` or a paid provider) is the fix, and it's a real infrastructure
decision (bandwidth cost, another exposed service) that shouldn't be made
silently inside a feature-implementation pass.

The frontend surfaces this honestly rather than pretending every connection
will succeed: a peer connection that doesn't reach `connected` ICE state
within a bounded timeout is shown as "Couldn't connect" per-participant in
the UI, not silently hidden — see "Never fabricate presence" in Non-goals/
Testing.

### Shared voice-session code path

In-game party voice and standalone channels are **the same underlying
concept with different lifecycles**, not two implementations. A "voice
session" is: a set of participants, a signaling stream per participant, and
a mesh of peer connections between them. The only difference:

- **Standalone channel voice**: the session's membership is whatever users
  are currently connected to a *persisted* channel (created once, exists
  until deleted, has a name/invite list/text history that outlives any
  single voice session).
- **In-game party voice**: the session's membership is exactly a
  PhantomPlay room's current participants, and the session's lifecycle is
  tied 1:1 to that room — created implicitly when a room-launched game
  opens with 2+ participants, torn down when the room is left/the player
  chrome closes. Nothing is persisted (no name, no invite list, no chat
  history beyond the existing room roster).

Both paths construct a voice session through the same `app/js/voicecore.js`
module (peer-connection manager, mute, speaking indicator, connect/
disconnect lifecycle) and the same server-side signaling relay
(`server/src/phantom-ai/voicechannels.ts` + the `/api/voice/*` routes in
`server/src/index.ts`). A game-room voice session is modeled server-side as
a voice session row with `kind: "game_room"`, `sourceRoomCode` set, and
`persisted: false`; a standalone channel's voice session is `kind:
"channel"`, `channelId` set, `persisted: true` (the channel itself, not the
live voice session, is what's persisted — presence/who's-currently-
connected is always live, never stored past disconnect).

## Data model

New JSON-file store, following the exact pattern already used by
`server/src/phantom-ai/phantomplay.ts` (`readStore`/`writeStore` with
temp-file-then-rename, not Prisma) and `server/src/crm/crm-pipeline-store.ts`
— this codebase does not put every feature in Postgres; PhantomPlay's own
rooms/profiles/submissions are local JSON, and this feature's shape (small
channel list, membership, short recent-message history) fits that
established local-store convention rather than requiring a new Prisma
migration. Path: `.phantom/voicechannels.json`
(`PHANTOMFORCE_VOICECHANNELS_PATH` override, mirroring
`PHANTOMFORCE_PHANTOMPLAY_PATH`). Flagged as Q-0021 in the backlog — this is
a judgment call (JSON store vs. extending the Prisma schema) that Jordan may
want revisited once channel counts/history grow, the same way PhantomPlay's
own store may eventually need it.

```ts
type VoiceChannel = {
  id: string;
  tenantId: string;            // same org/tenant scoping as every other module
  name: string;
  createdBy: string;           // actorId (session.userId || session.id), same identity convention as phantomplay.ts
  createdByLabel: string;
  visibility: "public" | "invite_only"; // "public" = any authenticated user in this tenant can join; "invite_only" = membership required
  memberIds: string[];         // actorIds; creator is always a member
  invitedIds: string[];        // actorIds invited but not yet joined (invite_only channels only)
  createdAt: string;
  updatedAt: string;
};

type VoiceMessage = {
  id: string;
  channelId: string;
  authorId: string;
  authorLabel: string;
  text: string;                // length-capped, plain text only (no HTML/markdown rendering — see Non-goals)
  createdAt: string;
};

type VoiceSessionKind = "channel" | "game_room";
type VoiceSession = {
  id: string;
  tenantId: string;
  kind: VoiceSessionKind;
  channelId?: string;          // set when kind === "channel"
  sourceRoomCode?: string;     // set when kind === "game_room" (the PhantomPlay room code)
  participants: Array<{ actorId: string; label: string; connectedAt: string; muted: boolean }>;
};

type VoiceStore = {
  version: 1;
  channels: VoiceChannel[];
  // Recent-N messages per channel, capped (e.g. last 200) — "at least
  // recent-N persisted" per the requirement, not unbounded history.
  messages: Record<string /* channelId */, VoiceMessage[]>;
};
```

`VoiceSession` rows are **in-memory only** (a `Map<sessionId, VoiceSession>`
alongside the signaling-subscriber map), not written to
`voicechannels.json` — presence is inherently transient and must never be
reconstructed from a stale disk write after a crash (see "Never fabricate
presence" below). A `game_room` session is derived from the PhantomPlay
room's own live participant list (already tracked in
`server/src/phantom-ai/phantomplay.ts`) rather than duplicating membership
tracking — the voice layer asks "who is currently in room X" and treats
that as the voice session's membership, so there's a single source of truth
for "who's in this party," not two lists that can drift.

### Identity: reuses the existing session/user model, no parallel concept

Members and invites are real PhantomForce accounts, identified exactly the
way `server/src/phantom-ai/phantomplay.ts` identifies players:
`actorId = session.userId || session.id` (`actorIdFor`), `label =
session.label || session.userId || session.id`. The invite-search UI calls
`listOrgMembers(orgId)` (`server/src/access/user-accounts.ts:836`) — the
same real-account directory the CRM/access layer already exposes for
picking a real user — rather than free-text email invites. **Scoping note
(flagged as part of Q-0022):** `listOrgMembers` is org/tenant-scoped, so in
practice "invite a specific PhantomForce user" today means "invite a user
who shares your org/tenant," consistent with how every other module in this
app (PhantomPlay rooms included, `joinPolicy: "signed_in_same_tenant_code"`)
scopes identity. A user in a different tenant/org cannot currently be
searched or invited — cross-tenant invites are out of scope for this pass
and would need a new directory endpoint if Jordan wants them.

### Presence

Who's currently connected to a voice channel's session is tracked purely
in-memory (the `VoiceSession.participants` array above) and broadcast to
every open signaling stream for that session as a `{"type":"presence",
"participants":[...]}\n` line whenever someone joins/leaves/mutes. The REST
snapshot endpoint (`GET /api/voice/channels/:id`) also returns current
presence for the initial render, sourced from the same in-memory map — one
source of truth, never reconstructed from the persisted store (which has no
presence field at all, by design).

## Component breakdown

### Backend (`server/src/`)

- `server/src/phantom-ai/voicechannels.ts` — new module, shaped like
  `phantomplay.ts`: `readStore`/`writeStore` (JSON file, temp-then-rename),
  `createChannel`, `listChannels` (public channels in tenant + invite-only
  channels the caller is a member/invitee of — mirrors
  `roomsForSnapshot`'s visibility filter), `inviteToChannel`,
  `joinChannel`, `leaveChannel`, `postMessage`, `listMessages`,
  `startVoiceSession` / `joinVoiceSession` / `leaveVoiceSession` (in-memory
  `VoiceSession` map + subscriber map for the signaling stream, same shape
  as `subscribeToRoom`/`broadcastRoom`), `relaySignal` (looks up the target
  participant's open stream connection and writes the envelope, doing
  **zero** interpretation of `payload`).
- `server/src/index.ts` — new routes, all behind `requireAccessSession`
  only (no entitlement/module-plan gate — matches the explicit "no
  restriction, any authenticated user" requirement; contrast with
  `phantomPlayAccess()`'s plan-gating, which is deliberately **not**
  reused here):
  - `POST /api/voice/channels` — create.
  - `GET /api/voice/channels` — list (tenant-scoped).
  - `GET /api/voice/channels/:id` — snapshot (channel + members + live
    presence).
  - `POST /api/voice/channels/:id/invite` — invite a real user by
    `actorId`/`userId` (from the `listOrgMembers` search, not free text).
  - `POST /api/voice/channels/:id/join` / `/leave`
  - `GET /api/voice/channels/:id/messages` / `POST .../messages` — text
    chat, capped length, recent-N persisted (matches "simpler than voice,
    build it the same way this app already does chat" — see below).
  - `POST /api/voice/sessions` — start/join a voice session for a channel
    or (internally, called by the PhantomPlay room-join path) a game room.
  - `GET /api/voice/sessions/:id/stream` — NDJSON signaling stream,
    `reply.hijack()`, identical shape to
    `GET /api/phantomplay/rooms/:code/stream`.
  - `POST /api/voice/sessions/:id/signal` — relay one outbound
    offer/answer/ICE message to a specific peer.
  - `POST /api/voice/sessions/:id/leave` — leave, broadcasts updated
    presence.
  - Rate limiting on `/signal` mirrors
    `phantomPlayMatchStateRateLimited` (same fixed-window-counter
    approach) — a runaway/misbehaving client renegotiating in a loop
    should not be able to flood every other peer's stream.

Text chat backend follows this codebase's existing chat-adjacent
conventions where they exist: response/error shape matches
`{ ok: true, ... }` / `{ ok: false, error }` used everywhere in
`server/src/index.ts`, and message objects are the plain
`{ id, authorId, authorLabel, text, createdAt }` shape — there's no
existing *persisted, multi-user* chat feature elsewhere in this codebase to
copy wholesale (the AI assistant chat in `app/js/main.js`/`command.js` is a
single-user-to-AI conversation with a different shape — `{ say, cards,
open, intent }` — not a multi-user channel), so this is new but
deliberately minimal: plain text only, no markdown/HTML rendering, capped
length, capped history (200 most recent per channel).

### Frontend — shared voice core (`app/js/voicecore.js`)

New module, following this codebase's per-file convention (plain ES
module, named exports, no framework). Exports a `VoiceCore` session object
constructed with `{ sessionId, myActorId, myLabel, signalingBase }`:

- Opens the NDJSON signaling stream (`fetch()` + `getReader()` +
  `TextDecoder`, same loop shape as `openRoomStream()` in
  `app/js/phantomplay.js:891-968`, including the stall-watchdog/
  reconnect-budget pattern already proven there).
- On a `presence` message, creates an `RTCPeerConnection` per newly-seen
  peer (mesh — every participant connects to every other), tears one down
  per peer that leaves.
- Standard WebRTC offer/answer/ICE-candidate exchange over `POST
  .../signal`, addressed by `actorId`.
- `getUserMedia({ audio: true })` once, attaches the local track to every
  peer connection.
- `setMuted(bool)` — disables the local audio track (`track.enabled =
  false`), broadcasts a `{"type":"mute", muted}` presence update so other
  participants see an accurate mute indicator (never a locally-guessed one
  — see Non-goals).
- Basic speaking indicator: a `Web Audio` `AnalyserNode` on each track
  (local and remote), polled on a short interval, thresholded — not VAD,
  just "is this track's audio level above a floor right now," matching the
  "basic audio-level detection... not fancy VAD" requirement.
- `destroy()` — closes every peer connection, stops local tracks, aborts
  the signaling stream. Called on both consumers' teardown paths.

Both the in-game integration and the standalone workspace construct a
`VoiceCore` instance and drive the same API — this is the literal shared
code path described above, not two parallel implementations.

### In-game party voice (`app/js/phantomplay.js`)

- When `ui.player.roomCode` is set (a game was launched from a room —
  existing hook, `launch(gameId, { roomCode })`) and the room has 2+
  participants, auto-start a `game_room`-kind voice session via `POST
  /api/voice/sessions` keyed to that room code, then construct a
  `VoiceCore` instance. Hooked into `upsertRoom()` (`:802-806`), the single
  funnel every join/leave/poll/stream update already passes through, per
  the existing code's own established pattern — not duplicated across the
  4 call sites that call it.
- Mic-mute button added to `.pp-player-actions` (`playerMarkup()`,
  `app/js/phantomplay.js:662`), same bare-`<button data-pp-*>` markup
  style as Restart/Pause/Fullscreen/the gamepad toggle, positioned after
  the gamepad button. A small participant/speaking-indicator strip
  (mirrors `roomRoster()`'s per-participant chip pattern) is added to the
  player header, showing each connected participant's label, mute state,
  and a live speaking-indicator dot.
- Voice session lifecycle is tied to **room join/leave**, not to the app
  being open: starts in `joinPrivateRoom`'s success path (mirroring where
  `upsertRoom` already gets called), tears down in `leavePrivateRoom`
  and `closePlayer()`'s room-exit branch (`:1050-1094`).
- The room-principles copy (`app/js/phantomplay.js:506`, currently `"No
  room chat or voice"`) and the room-view `safety` contract
  (`roomView()`, `phantomplay.ts:1163-1182`, currently `chat: false,
  voice: false, directPeerConnection: false`) are updated to reflect
  reality once voice ships: `voice: true`, `directPeerConnection: true`
  (mesh WebRTC genuinely opens direct peer connections for audio — leaving
  this flag `false` after shipping voice would be exactly the kind of
  fabricated/stale safety claim the verification requirements call out).
  `chat: false` is left unchanged — this pass does not add text chat
  inside game rooms, only inside standalone channels (see Non-goals).

### Standalone "mini Discord" workspace

New sidebar entry (exact placement finalized against `app/js/main.js`'s
`BASE_NAV`/department-grouping and `app/js/workspaces.js`'s `DEPARTMENTS`,
following the same pattern the Planner workspace used to become reachable
— `docs/quality/QUALITY_BACKLOG.md` Q-0018 — rather than inventing a new
nav mechanism). New `app/js/voicechannels.js` workspace module:

- Channel list (public + invited-into invite-only channels), grouped
  simply (no further nesting needed at this scale).
- Create-channel form: name, public vs. invite-only toggle.
- Invite flow: search box over `listOrgMembers`-backed
  `GET /api/voice/... ` user search (real accounts, matching how RBAC/CRM
  user-selection UI already works in this app rather than raw email
  invites), select, invite.
- Per-channel view: text chat (message list + send box, same
  `esc()`-safe/`textContent`-set rendering discipline used elsewhere in
  this codebase, e.g. `app/js/main.js`'s `msgHtml`) and a "Join voice"
  button that constructs a `VoiceCore` instance scoped to that channel's
  persistent voice session, with the same mute/speaking-indicator/
  participant-strip UI as the in-game version (literally shared markup
  helpers where practical, since it's the same underlying `VoiceCore`).

## Non-goals

- **No TURN server / no guaranteed connectivity for every network
  topology.** STUN-only mesh is explicit, tracked follow-up work
  (Q-0020), not silently shipped as flawless. Users behind symmetric NAT
  or restrictive CGNAT may fail to connect peer-to-peer; the UI reports
  this honestly per-participant rather than hiding it.
- **No SFU / no support for large rooms.** Mesh topology only; this is
  fine for both current use cases' actual sizes (PhantomPlay room caps,
  small community channels) but does not scale past roughly 6-8
  simultaneous participants. Not attempted here.
- **No video.** Audio only, matching the explicit ask ("real voice chat").
- **No text chat inside PhantomPlay game rooms.** Only the standalone
  channel workspace gets text chat in this pass; the room-principles copy
  update reflects `voice: true` but leaves `chat: false` for rooms.
- **No markdown/HTML rendering in channel chat.** Plain text only, capped
  length — reduces attack surface for a first pass; rich text is a
  reasonable future addition, not attempted here.
- **No cross-tenant invites.** `listOrgMembers` is org-scoped; inviting a
  user outside your tenant isn't wired up (see Q-0022).
- **No recording, transcription, or moderation tooling** beyond what
  already exists at the platform level (no new safety/moderation surface
  is introduced by this spec).
- **No Discord bridge, no external accounts, no downloads.** This was a
  deliberate, already-settled decision — not revisited here.

## Testing approach

- **Signaling handshake, without physical microphone hardware in this
  environment:** two browser contexts (via the available browser-
  automation tooling) both join the same channel/session, confirm both
  NDJSON streams receive the same `presence` events, confirm `POST
  .../signal` offer → answer → ICE-candidate exchange completes and both
  sides' `RTCPeerConnection.connectionState` reaches `"connected"`. This
  is meaningful verification of the signaling relay and peer-connection
  setup even without confirming real audio quality end-to-end.
- **Never fabricate presence/participant data:** every UI surface (in-game
  strip, standalone channel view) renders only from a real
  `VoiceSession.participants` snapshot delivered over the signaling
  stream or the REST snapshot endpoint — never a locally-assumed
  "connected" state before the corresponding ICE/ready event actually
  fires. A peer that hasn't reached `connected` shows as connecting/failed,
  not silently omitted or silently shown as live.
- **Mute toggle:** verified by confirming the local track's `enabled`
  flag flips and the corresponding `{"type":"mute"}` presence broadcast is
  observed on a second connected peer's stream.
- **Existing regression coverage** (`npm run typecheck`,
  `node --check` on every touched `.js` file, existing PhantomPlay/CRM
  test scripts) re-run to confirm nothing in the shared files
  (`phantomplay.js`, `main.js`, `server/src/index.ts`) regressed.
- **What this pass cannot verify:** real two-person audio quality/latency
  over an actual network path with real microphones, and real-world STUN
  traversal success rate across varied NAT types — both require hardware/
  network conditions not available in this environment. Stated plainly
  rather than claimed.
