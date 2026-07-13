# PhantomPlay

PhantomPlay is PhantomForce's entertainment and game-discovery module. It gives members an intentional break room without granting games access to business data, agents, files, Media Lab, or internal services.

## Product Surface

- Home, featured games, Continue Playing, Recently Played, favorites, library search, and categories.
- Three network-free built-in games: Neon Drift, Signal Match, and Focus Stack.
- Tenant- and actor-scoped preferences, favorites, sessions, scores, progress, and play history.
- Plan-controlled daily play limits and game-submission limits.
- Developer drafts, validation, review status, version history, release updates, and resubmission.
- Platform-admin moderation for approve, request changes, reject, feature, and disable.
- Honest loading, empty, offline, restricted, unavailable-game, and failure states.

## Security Boundary

Games open in an iframe with `sandbox="allow-scripts"`. PhantomPlay does not grant `allow-same-origin`, forms, popups, downloads, or top navigation. Built-in games also use a restrictive Content Security Policy with `connect-src 'none'`.

The host accepts messages only from the currently active game frame and only when the message contains the PhantomPlay protocol marker. The host exposes settings and accepts score/progress events; it does not expose session tokens, internal API paths, tenant records, or infrastructure details.

Community releases appear only after platform moderation and only when their launch URL is HTTPS or an approved `/app/games/community/` path. Approval is a distribution decision, not a promise that third-party code is trusted. A future standalone release should move community games behind a dedicated game-content origin and automated package scanning.

## Persistence

The first production-shaped implementation follows PhantomForce's existing durable JSON service pattern. The default store is `.phantom/phantomplay.json`; production can set `PHANTOMFORCE_PHANTOMPLAY_PATH` to a durable private path. Writes are atomic and no secrets are stored.

The service boundary in `server/src/phantom-ai/phantomplay.ts` is intentionally separate from the UI. A later database adapter can replace the JSON repository without changing the API or game-host contract.

## API

- `GET /api/phantomplay`
- `PATCH /api/phantomplay/profile`
- `POST /api/phantomplay/plays`
- `PATCH /api/phantomplay/plays/:id`
- `POST /api/phantomplay/submissions`
- `PATCH /api/phantomplay/submissions/:id`
- `POST /api/phantomplay/submissions/:id/moderate` (platform admin only)

All routes require an access session. Tenant selection is forced to the signed-in tenant unless the session has platform access-management authority.

## What Is Real

- The three included games are playable browser games, not preview cards.
- Built-in games work offline after their app files are available.
- Favorites, preferences, progress, scores, history, time limits, submissions, versions, and moderation persist through the backend store.
- Approved community games enter the catalog; rejected, change-requested, and disabled games do not.

## External Requirements

No provider credentials are needed for the built-in catalog. Real community distribution still requires developers to provide finished game content or HTTPS hosting. Before broad public distribution, add a dedicated game-content origin, automated archive/malware review, legal/content policy, and production database adapter.

---

# PhantomPlay V2 — the platform layer

V2 grows PhantomPlay into a four-audience platform (players, employees, businesses/schools, developers) without changing any V1 behavior. Full plan and phase roadmap: `docs/superpowers/plans/2026-07-12-phantomplay-v2.md`.

## Opt-in shell

The V2 experience shell (`app/js/phantomplay-v2.js`) is opt-in while it hardens: set localStorage `pf.phantomplay.v2` to `"1"` and reopen PhantomPlay. The shell has a "Classic view" button to switch back. The classic module (`app/js/phantomplay.js`) stays the default and is untouched.

Surfaces in the V2 shell: **Home** (discovery rows computed from real plays and reviews: trending, top rated, hidden gems, new community releases, friends playing), **Solo** (built-ins with cloud progress; Sudoku Signal restores the exact mid-run board via the new `restore` host message), **Friends** (same-workspace presence, friend requests, activity feed — no strangers), **Workspace** (per-tenant policy: approved game list, content ceiling, daily minutes, community/rooms toggles; real leaderboards), **Library**, **Dev Hub** (real analytics from actual sessions — plays, players, DAU/MAU, hours, average session, returning players, rating, wishlists — plus publishing-assist briefs for Media Lab/Content Hub and the existing submission pipeline), and per-game pages (stats, star reviews, wishlist, follow developer, patch notes, related games, top scores).

## V2 built-in games

- **Phantom Rumble** — local-multiplayer platform fighter: two humans on one keyboard (WASD+F/G vs arrows+K/L) plus bots, percent-based knockback, pickups, stocks.
- **Sudoku Signal** — generated unique-solution puzzles, pencil marks, full cloud resume.

Both use the standard sandbox (script-only iframe, CSP `connect-src 'none'`) and register into the V1 catalog at server startup via `registerPhantomPlayV2Games()` — no V1 source edits, and V1 launch validation/time limits cover them automatically. Snake/2048/minesweeper/typing were deliberately NOT added: `circuit-serpent`, `tower-tactics`, `signal-sweeper`, and `type-storm` already cover those concepts.

## API (additive, feature-flagged)

`GET /api/phantomplay/v2` · `POST /v2/presence` · `POST /v2/friends` · `GET /v2/games/:id` · `POST /v2/games/:id/review` · `POST /v2/games/:id/wishlist` · `POST /v2/follows` · `GET /v2/discovery` · `GET /v2/leaderboard/:gameId` · `GET /v2/resume/:gameId` · `GET /v2/developer/analytics` · `GET|PATCH /v2/workspace-policy`

All require an access session; the policy PATCH additionally requires a workspace admin/owner role. `PHANTOMFORCE_PHANTOMPLAY_V2_ENABLED=false` turns every V2 route off (404) and skips game registration — V1 is then byte-identical to before V2 existed. Store: `.phantom/phantomplay-v2.json` (`PHANTOMFORCE_PHANTOMPLAY_V2_PATH` override), atomic writes; the V1 store is only ever read (analytics/leaderboards/resume).

## Honesty boundaries

- Voice chat, text chat, parties, cross-organization play, spectating: not implemented and never faked — they are roadmap phases in the plan doc.
- Monetization: data model only (`PhantomPlayPriceModel`); nothing charges or displays prices as real.
- Workspace policy is enforced in the V2 client experience; server-side enforcement on the V1 launch route is a planned follow-up kept out of this change to leave V1 untouched.
- The V2 shell degrades honestly: if the V2 API is absent or flagged off, social/community panels say so and every V1 flow keeps working.

## Tests

`server/scripts/test-phantomplay-v2.ts` (module + route coverage, feature flag, tenant isolation) alongside the untouched `test-phantomplay.ts`.
