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
