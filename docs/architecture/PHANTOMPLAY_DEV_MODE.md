# PhantomPlay Dev Mode v1 — design and threat model

**Status: implemented for built-in games.** `phantomPlayDevModeAccess` /
`getPhantomPlayDevModeSource` (`server/src/phantom-ai/phantomplay.ts`), the
`GET /api/phantomplay/dev-mode/:gameId/source` route, and the client entry
point + sandboxed preview panel (`app/js/phantomplay.js`,
`app/phantomplay.css`) all exist and are tested — see
`server/scripts/test-phantomplay-dev-mode.ts` (ownership/gating/path-safety)
and the Dev Mode assertions appended to `scripts/test-phantomplay.mjs`
(entry-point gating, sandbox attribute, no execution primitives). Community
(non-built-in) game source editing and the "save as new version" publish
step are not built yet — see the two gaps called out below.

## Purpose

Let a game's own developer hot-edit that game's code and assets while it runs, in place, next to
the game's card in PhantomPlay — no new sidebar tab. Only that game's developer(s) can ever see
or trigger Dev Mode; consumers never can, and no player-facing session is ever runnable as Dev
Mode. This doc exists because the requester explicitly flagged live code hot-reload as "a
security risk if done wrong" — so the isolation boundary is written down and testable before any
UI is built on top of it, not implied by a docstring.

## Non-goals (explicit — read this before extending)

- **Not multiplayer session hosting.** "Consumers join a dev's live session" is a real-time
  hosting/relay feature that does not exist in this codebase yet (PhantomPlay today is
  single-player-per-tab, static HTML/canvas games — see `app/games/*.html`). Dev Mode v1 is
  local to the developer's own browser tab. Turning a Dev Mode edit into something other players
  can join is a separate, much larger feature (real-time transport, session hosting, plan-gated
  access) and is intentionally out of scope here.
- **Not auto-published.** A Dev Mode edit never becomes what other players see just because the
  developer made it. Publishing follows the exact same moderation path every other PhantomPlay
  submission already goes through (`PhantomPlaySubmission`, `developerId`-scoped,
  `canManageAccess`-reviewed) — see `server/src/phantom-ai/phantomplay.ts`. Dev Mode produces a
  new draft submission version, not a live overwrite.
- **Not distributed via the edge network.** Dev Mode edits are never registered as a signed
  `PhantomStoreEdgeManifest`/leased to other users' desktops. The edge network
  (`docs/architecture/PHANTOMPLAY_EDGE_NETWORK.md`) only ever carries content that already passed
  through the normal publish/review path.
- **Not a general code sandbox product.** This is scoped to one game's own JS/assets, gated to
  that game's own developer(s). It is not a way to run arbitrary code as a platform feature.

## Who is "a dev for this game"

Reuses the ownership model that already exists in `phantomplay.ts` rather than inventing a new
permission system:

- `kind: "community"` games: the owning `PhantomPlaySubmission.developerId` (already how install
  panels, edit rights, and submission visibility work — see the existing check
  `!session.canManageAccess && submission.developerId !== actorId` in `phantomplay.ts`).
- `kind: "built_in"` games (the 32 shipped titles): no per-game developer actor exists in the
  data model today, so Dev Mode for those is gated to `session.canManageAccess` only (the
  workspace owner/admin) — the same bar `registerPhantomPlayEdgeManifest` already uses for
  "workspace manager" actions.

A new server function, `phantomPlayDevModeAccess(session, gameId)`, returns `{ allowed: boolean
}` using exactly this logic. **The gate is server-side.** The client never decides whether to
show the Dev Mode entry point on its own — the catalog snapshot the server already returns
includes a `devModeAvailable: boolean` field per game, computed the same way, and the frontend
only renders the button when that's true. A determined user could still try to hit a Dev Mode
API route directly; every Dev Mode route re-checks `phantomPlayDevModeAccess` itself, exactly
like every other PhantomPlay/edge-network route re-checks `canManage`/`developerId` rather than
trusting a client-supplied flag.

## Isolation mechanism

The running/edited game executes inside an `<iframe sandbox="allow-scripts">` — **`
allow-same-origin` is never added.** This is the load-bearing decision in this whole design:

- Without `allow-same-origin`, the browser gives the iframe a unique **opaque origin** (`null`).
  It cannot read `document.cookie`, `localStorage`, `sessionStorage`, or IndexedDB for the real
  `admin.phantomforce.online` / `app.phantomforce.online` origin, and cannot reach into the
  parent page's DOM or JS globals (no session token, no in-memory app state).
- An opaque origin sending `fetch`/`XHR` to our own API gets **no CORS response at all**: this
  server's CORS config (`server/src/index.ts`, `app.register(cors, { origin: [...] })`) is an
  explicit allowlist of `127.0.0.1`/`localhost`/the public web origins — a `null` origin matches
  none of those regexes, so `@fastify/cors` never sends back `Access-Control-Allow-Origin` and
  the browser blocks the response from ever being read by the sandboxed script. This was verified
  against the actual running config, not assumed.
- All communication between the host PhantomPlay page and the sandboxed game runs over
  `postMessage` with a small, explicit message schema (`devmode:load`, `devmode:input`,
  `devmode:asset-swap`, `devmode:error`, `devmode:ready`) — the host never `eval`s anything the
  iframe sends it, and only ever sends the iframe the specific source text/asset the developer
  is actively editing.
- `sandbox` also omits `allow-top-navigation`, `allow-popups`, and `allow-forms` by default —
  a compromised or buggy dev script cannot navigate the parent tab or spawn popups.

**Why `eval`/`new Function` inside the iframe is acceptable here when it would not be acceptable
in the host page:** the danger of dynamic code execution is entirely a function of what
privileges the executing context holds. A same-origin `eval` in the real PhantomForce page could
read the session token and call any API as the logged-in user. An `eval` inside a
`sandbox="allow-scripts"`, opaque-origin iframe with no CORS-reachable API and no access to the
parent's storage or DOM has almost nothing to steal — worst case it can misbehave within its own
canvas/DOM, which the host can always discard by removing/reloading the iframe. This is why the
worker in `packages/phantomplay-edge-worker` (a *privileged*, credential-holding context) is
held to a zero-execution-primitives bar while this sandbox is allowed to `eval` freely inside
itself.

## What a dev can actually do in v1

1. **Hot-edit the game's JS.** The dev-mode panel shows the game's current source (for
   `kind: "community"` games, from their own submission; for built-ins, a read/copy-first flow —
   built-in source becomes the seed for a new community-style draft, it is never edited in
   place). Saving in the panel posts the new source into the sandboxed iframe via
   `devmode:load`; the iframe reloads with that source. No server round-trip is required to see
   a change — this is a local edit/preview loop.
2. **Swap textures/assets.** Drag-and-drop or paste an image; it's handed to the iframe as a
   data URL over `postMessage` (`devmode:asset-swap`) and the game's asset-loading layer (already
   abstracted in the existing games — see the `PhantomPlayEngineProfile` asset conventions)
   substitutes it for the named asset key. No filesystem access is involved on either side.
3. **Publish as a new draft.** An explicit "Save as new version" action calls the existing
   `updatePhantomPlaySubmission`-style flow to create a new pending version tied to the
   developer's own submission, which then goes through the same review path as any other
   PhantomPlay change. Dev Mode never writes directly to what players are served.

What v1 does **not** do: this is not "Unreal Engine inside PhantomPlay." There's no node-graph
editor, no physics/lighting authoring, no asset pipeline beyond direct texture substitution, no
live multiplayer co-editing. Those are legitimate future directions, but each is its own
scoped design — bolting them onto this pass would be exactly the kind of undersized security
review the requester was right to worry about.

## Testing obligations before this ships

- Server: `phantomPlayDevModeAccess` denies a non-owner/non-manager for both `community` and
  `built_in` games, and allows the correct owner/manager — mirroring
  `server/scripts/test-phantomplay-edge-storage.ts`'s ownership-boundary style.
- Client: dev-mode entry point never renders when the server snapshot's `devModeAvailable` is
  false, even if local state is tampered with (static assertion, matching
  `scripts/test-phantomplay.mjs`'s existing safety-check style).
- Sandbox: an automated check that the dev-mode iframe element always has `sandbox="allow-scripts"`
  and never gains `allow-same-origin` anywhere in the codebase (a static grep-style guard, same
  pattern as the edge worker's no-execution-primitives test).
