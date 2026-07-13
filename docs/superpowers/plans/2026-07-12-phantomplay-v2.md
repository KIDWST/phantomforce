# PhantomPlay V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow PhantomPlay from a break-room module into a four-audience game platform (players, employees, businesses/schools, developers) without breaking any V1 behavior.

**Architecture:** V1 (`server/src/phantom-ai/phantomplay.ts`, JSON store, sandboxed iframe host protocol, `/api/phantomplay/*` routes) stays untouched and load-bearing. V2 adds a sibling server module `phantomplay-v2.ts` with its own JSON store for the new social/community/policy/analytics surface, additive `/api/phantomplay/v2/*` routes gated by an env feature flag, five new built-in solo games speaking the existing game-host protocol, and a rebuilt frontend navigation (Home / Solo / Friends / Workspace / Library / Dev Hub / Admin) in `app/js/phantomplay.js` that degrades honestly when V2 endpoints are absent.

**Tech Stack:** Fastify + zod (server), durable-JSON repository pattern (matches V1), vanilla ES-module frontend (matches app/), single-file sandboxed HTML games with CSP `connect-src 'none'`.

## Global Constraints

- DO NOT remove or change any existing V1 route, export, or store shape. Additive only.
- V1 store path `.phantom/phantomplay.json` is never written by V2 code; V2 reads it read-only for analytics/leaderboards.
- V2 store lives at `.phantom/phantomplay-v2.json` (`PHANTOMFORCE_PHANTOMPLAY_V2_PATH` override).
- Feature flag: every `/api/phantomplay/v2/*` route returns 404 `{ok:false,error:"phantomplay_v2_disabled"}` when `PHANTOMFORCE_PHANTOMPLAY_V2_ENABLED === "false"` (default enabled). Frontend treats missing V2 endpoints as "social offline" and keeps all V1 features working.
- Games keep the V1 sandbox: iframe `sandbox="allow-scripts"`, no `allow-same-origin`, CSP `connect-src 'none'` in built-ins, postMessage protocol marker `phantomplay-game` / `phantomplay-host`.
- Every change under `app/` bumps the cache-bust build id (`phantom-live-YYYYMMDD-N`) in `app/index.html` (PHANTOM_BUILD, meta, every `?v=`) and `app/js/main.js` imports, per AGENTS.md.
- No payment processing anywhere. Monetization is data-model + docs only.
- No pushes to origin (main auto-deploys). Work stays on branch `phantomplay-v2-20260712`.
- Tenant scoping identical to V1: `tenantIdFor(session, requested)` semantics; non-admin sessions are locked to their own tenant.

---

## Phase map (this plan implements Phase 1; later phases get their own plans)

| Phase | Scope | Status |
|---|---|---|
| 1 | Experience nav (Home/Solo/Friends/Workspace/Dev Hub), 5 new solo games with resume-state, game pages (reviews/ratings/patch notes/stats), wishlist/follows/activity feed, friends + presence (same-tenant), workspace policies + leaderboards, developer analytics (real, from V1 sessions), discovery rows, monetization data model, AI publishing-assist links into existing PhantomForce surfaces | THIS PLAN |
| 2 | Text chat (rooms/party, poll-based), party system, richer profiles (banner/badges), spectator hooks, beta channels for submissions | future plan |
| 3 | Cross-organization friends/matchmaking, WebRTC voice (push-to-talk, mute/deafen), screen share flagging, GIF/emoji reactions | future plan |
| 4 | Monetization execution (billing provider integration, payouts, coupons/bundles/keys), marketplace assets, SDK/API keys/webhooks | future plan |
| 5 | Dedicated game-content origin, automated package scanning, controller support, mobile app shell | future plan |

Honesty rule carried from V1: nothing ships pretending to work. Voice chat, GIFs, spatial audio, screen share are explicitly "future" in UI copy or absent — never stubbed with fake UI.

---

### Task 1: V2 server module — store, social graph, presence

**Files:**
- Create: `server/src/phantom-ai/phantomplay-v2.ts`
- Test: `server/scripts/test-phantomplay-v2.ts`

**Interfaces:**
- Consumes from `./phantomplay.js`: `PHANTOMPLAY_BUILT_IN_GAMES`, `PhantomPlayGame` type (export them if not already), plus read-only access to the V1 store file for sessions.
- Produces (used by Tasks 2-4 routes and frontend):
  - `getV2Snapshot(session, {tenantId}) => { tenantId, actorId, social: {friends, incoming, outgoing, presence[]}, wishlist: string[], follows: string[], feed: ActivityEntry[], policy: WorkspacePolicy }`
  - `heartbeatPresence(session, {tenantId, status, gameId, label})` — status: `"online"|"away"|"busy"|"invisible"|"playing"`; entries expire after 120s.
  - `mutateFriend(session, {tenantId, actorId, action})` — action: `"request"|"accept"|"decline"|"remove"`.
  - `WorkspacePolicy = { approvedGameIds: string[] (empty = all), maxContentRating, dailyMinuteLimit: number|null, allowCommunityGames: boolean, allowRooms: boolean, updatedAt }`
  - `getWorkspacePolicy(tenantId)`, `updateWorkspacePolicy(session, {tenantId, ...})` (admin-gated at route).
- Store shape v1: `{ version: 1, social: Record<tenant, {friendships: [], presence: []}>, reviews: [], wishlists: Record<key,string[]>, follows: Record<key,string[]>, feed: [], policies: Record<tenant, WorkspacePolicy> }` — atomic temp-file writes exactly like V1 (`writes` promise chain).

Steps: write failing test (`npx tsx scripts/test-phantomplay-v2.ts` with in-memory store override via env temp path), implement, pass, commit `feat(phantomplay): v2 social/presence/policy module`.

### Task 2: Reviews, wishlist, follows, game pages, discovery, leaderboards

**Files:**
- Modify: `server/src/phantom-ai/phantomplay-v2.ts`
- Test: extend `server/scripts/test-phantomplay-v2.ts`

**Interfaces (produced):**
- `upsertReview(session, gameId, {tenantId, rating(1-5), text(<=1200)})` — one review per actor per game, edit allowed; `helpful` counter reserved.
- `setWishlist(session, gameId, {tenantId, on})`, `setFollow(session, developer, {tenantId, on})` — follows append feed entries `{kind:"follow"|"review"|"release", actor, subject, at}` capped at 200/tenant.
- `getGamePage(session, gameId, {tenantId}) => { game, stats: {players, plays, totalHours, averageRating, reviewCount, bestScore}, reviews: [...latest 25], patchNotes: [{version, notes, at}] (from V1 submission versions for community; built-ins get static seed), related: PhantomPlayGame[] (same category, minus self), wishlisted, developerFollowed }` — stats computed from V1 store sessions read-only.
- `getDiscovery(session, {tenantId}) => { trending: [gameIds by plays last 7d], topRated: [by avg rating, >=2 reviews], hiddenGems: [rating>=4, plays<10], newReleases: [community by approval date], friendsPlaying: [{gameId, actors}] }`
- `getLeaderboard(session, gameId, {tenantId}) => [{actorId, label, bestScore, seconds}] top 20, tenant-scoped` — from V1 sessions.
- Monetization data model (types + validation only, stored on V2 review of submissions): `PriceModel = { kind: "free"|"paid"|"donation"|"subscription", amountCents: number|null, currency: "usd", note: string }` with doc comment pointing at Phase 4.

Commit `feat(phantomplay): v2 community + discovery + leaderboards`.

### Task 3: V2 routes in `server/src/index.ts` (additive block after V1 phantomplay routes)

**Files:**
- Modify: `server/src/index.ts` (immediately after existing `/api/phantomplay` route block, ~line 3630)
- Test: extend `server/scripts/test-phantomplay-v2.ts` route-level checks via `app.inject` if the existing test does; else follow existing test conventions (direct module calls + one live-route smoke in `scripts/test-phantomplay.mjs` style).

Routes (all `requireAccessSession`; admin ones `requireAdminAccessSession` or `session.canManageAccess`, matching how V1 moderation gates):
- `GET  /api/phantomplay/v2` → `getV2Snapshot`
- `POST /api/phantomplay/v2/presence`
- `POST /api/phantomplay/v2/friends`
- `GET  /api/phantomplay/v2/games/:id` → `getGamePage`
- `POST /api/phantomplay/v2/games/:id/review`
- `POST /api/phantomplay/v2/games/:id/wishlist`
- `POST /api/phantomplay/v2/follows`
- `GET  /api/phantomplay/v2/discovery`
- `GET  /api/phantomplay/v2/leaderboard/:gameId`
- `GET  /api/phantomplay/v2/developer/analytics` → per-developer real metrics `{games: [{gameId,title,plays,players,dau,mau,totalHours,avgSessionMinutes,returningPlayers,averageRating,reviewCount,wishlists}]}` from V1 sessions + V2 reviews/wishlists; developers see own games (matched by submission developerId or built-ins when canManageAccess).
- `PATCH /api/phantomplay/v2/workspace-policy` (admin)
- Every route first checks the feature flag env; zod schemas for bodies; tenant forced like V1.
- Workspace policy enforcement: modify NOTHING in V1 routes; instead `getV2Snapshot` returns policy and the FRONTEND filters catalog for non-admin actors (honest scope: server-side enforcement of policy on V1 launch route is Phase 2, noted in docs).

Commit `feat(phantomplay): v2 API routes behind feature flag`.

### Task 4: Five new solo games (parallel subagents, one file each)

**Files (create):**
- `app/games/phantom-snake.html` — Snake; arrows/WASD/touch swipe; speed ramps; score = length.
- `app/games/terminal-2048.html` — 2048; arrows/WASD/swipe; state = board array (resume).
- `app/games/mine-sweep.html` — Minesweeper 9x9/16x16; left/right click + long-press flag; state = board+revealed.
- `app/games/sudoku-signal.html` — Sudoku with 3 difficulties, pencil marks; state = puzzle+entries.
- `app/games/ghost-typer.html` — typing sprint; WPM score; rounds of PhantomForce-flavored phrases.

**Contract every game MUST implement (copy from `app/games/neon-drift.html` conventions):**
- Single self-contained HTML file, `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;">` (match existing games' CSP exactly — read the file first).
- Dark terminal aesthetic: `#05070a` background, phosphor-green `#4ade80`/`#22c55e` accents, monospace headings, subtle scanline/glow, respects `reducedMotion` setting.
- postMessage OUT (`window.parent.postMessage({source:"phantomplay-game", type, ...}, "*")`): `ready` (once assets/init done), `score {score}`, `progress {progress: 0-100, state: {...flat map <=30 keys}}`, `complete {score, progress:100}`, `paused {paused}`.
- postMessage IN (from `phantomplay-host`): `settings {sound, reducedMotion}`, `pause`, `resume`, `restart`, and NEW `restore {state}` — apply saved state if valid, else start fresh.
- Keyboard + touch both fully playable; visible pause overlay; no external network calls, no localStorage (sandbox has no origin).

Each subagent gets: this contract, the full text of one existing game as reference, one game assignment. Verify each: file exists, contains `phantomplay-game`, contains `restore`, no `fetch(`/`XMLHttpRequest`/`localStorage`. Commit `feat(phantomplay): five new built-in solo games`.

### Task 5: Register new games + resume-state in V1 catalog/host (minimal V1 touch, additive)

**Files:**
- Modify: `server/src/phantom-ai/phantomplay.ts` — append 5 entries to `PHANTOMPLAY_BUILT_IN_GAMES` (categories: Arcade/Puzzle/Puzzle/Focus/Creative; new art keys fall back to category art until covers exist); include `state` of latest session in `historySummary` rows (`resumeState`).
- Modify: `app/js/phantomplay.js` — BUILT_INS offline list gets the same 5 entries; host sends `restore` message with `resumeState` after `ready`.
- Test: extend `server/scripts/test-phantomplay.ts` snapshot assertions (catalog length 8, resumeState present after a session PATCH with state).

Commit `feat(phantomplay): register solo games + resume-state protocol`.

### Task 6: Frontend V2 — experience navigation and new surfaces

**Files:**
- Modify: `app/js/phantomplay.js` (grows; if >1200 lines split `app/js/phantomplay-views.js`)
- Modify: `app/phantomplay.css`
- Modify: `app/index.html` + `app/js/main.js` (cache-bust bump only)

Nav becomes: `Home | Solo | Friends | Workspace | Library | Dev Hub` (+ `Admin` when canModerate). Mapping:
- **Home**: discovery rows (trending/top rated/hidden gems/new releases/friends playing → from `/v2/discovery`, falling back to V1 featured/recent rows when V2 offline), continue-playing, developer spotlight.
- **Solo**: offline-capable catalog (all built-ins), category chips, resume badges — this is V1 library filtered to `kind==="built_in"` plus copy about cloud saves.
- **Friends**: presence list + status picker (online/away/busy/invisible), friend requests (same workspace), friends-mode rooms (moved from "Play Together"), recently-played-together, activity feed.
- **Workspace**: classroom rooms, join-code UI (existing), leaderboards per game, and (admin only) policy editor: approved game list, rating ceiling, daily minutes, community toggle, rooms toggle.
- **Library**: full V1 library (search + categories + community).
- **Dev Hub**: submissions (V1) + analytics table (real numbers from `/v2/developer/analytics`) + patch-notes editor (versions exist in V1 submissions) + "Publishing assists" panel — buttons that navigate to existing PhantomForce workspaces with a prefilled brief (Media Lab for icon/trailer/screenshots, Content Hub for posts, AI chat for patch notes/store copy). Navigation uses the same mechanism main.js uses to switch workspaces (read main.js `data-*` hooks; dispatch the existing workspace-switch event rather than inventing one). NO fake "AI did it" states: buttons open the real tool with a real prompt prefilled where the tool supports it, otherwise plain navigation + copied brief to clipboard.
- **Game pages**: clicking any card opens an in-module detail view (not the player): hero art, stats, review list + write-review form (1-5 stars + text), wishlist toggle, follow-developer toggle, patch notes, related games, Play button.
- Presence heartbeat: every 45s while PhantomPlay is mounted (status "playing" while player open); stops on unmount.
- All V2 fetches: on failure set `ui.v2Offline = true` and hide/replace V2 surfaces with honest "Social features need the server" copy. V1 flows never blocked.
- CSS: loading skeletons for rows, card hover lift + glow, animated hero, stars, presence dots, policy editor — reuse existing `pp-` variables/patterns; respect `prefers-reduced-motion`.

Commit `feat(phantomplay): V2 experience navigation, game pages, dev hub` then cache-bust bump commit `chore: bump build id`.

### Task 7: Verification + docs

- `npm run typecheck` (server) clean.
- `npx tsx scripts/test-phantomplay.ts` and `test-phantomplay-v2.ts` pass; run `node scripts/test-phantomplay.mjs` if it is wired to a running server, else note.
- Launch local stack (API + `admin-static-server.mjs --root <worktree>` on free ports), owner-login, drive: open PhantomPlay → all six tabs render → play one new game end-to-end (score + resume) → write a review → wishlist → check dev analytics shows the play.
- Update `docs/PHANTOMPLAY.md` with V2 sections (surfaces, API list, feature flag, honesty notes, phase map).
- Final commit; report. No push.

## Self-review notes

- Spec coverage: nav split ✔ (T6), solo games w/ cloud progress ✔ (T4/T5), friends/presence ✔ (T1/T6, same-tenant Phase-1 scope; cross-org = Phase 3), workspace safe mode ✔ (T1/T3/T6 policy + classroom rooms; server-side launch enforcement noted Phase 2), dev hub analytics ✔ real-data (T3), AI publishing assists ✔ honest links (T6), community (follows/wishlist/reviews/feed) ✔ (T2), game pages ✔ (T2/T6), discovery ✔ (T2), voice/text chat — explicitly Phase 2/3, never faked; profiles — basic (presence label + stats) Phase 1, rich profiles Phase 2; monetization — data model only ✔ (T2).
- Types consistent: `WorkspacePolicy`, `PriceModel`, snapshot shapes defined once in T1/T2 and consumed by T3/T6.
