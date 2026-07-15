# PhantomPlay Global Leaderboard & Unified Community — Design

## Problem

PhantomPlay feels solo. The game catalog has no popularity ordering, there is
no cross-player ranking, and the existing "dev score" is a cosmetic,
per-browser number with no real persistence. Players have no personal
identity beyond their account's display name (often a business name, not a
person). The owner wants PhantomPlay to feel like one connected community —
players and developers ranked together — instead of a pile of solo games.

## Decisions (confirmed with the owner)

1. **V2 becomes the default PhantomPlay experience for everyone.** Classic
   stays reachable as a fallback but is no longer what new sessions land on.
   V2 already has presence, per-game leaderboards, and discovery — this reuses
   that instead of building parallel infrastructure into classic.
2. **The leaderboard is global**, across every PhantomForce business — not
   per-workspace like every other V2 social feature today. This is the first
   cross-tenant-visible surface in the app. It exposes **only**
   `{ username, globalScore, rank }` — never business identity, email, or any
   other tenant data. This constraint is load-bearing: a cross-tenant data
   leak was found and fixed elsewhere in this codebase earlier in this same
   work session (`server/src/phantom-ai/approval-queue.ts` /
   `vacation-mode.ts`), so the query and route backing this feature must be
   reviewed with that failure mode specifically in mind.
3. **Real usernames.** First PhantomPlay visit (post V2-default flip) prompts
   for a unique personal username if the account doesn't have one yet. Stored
   on the account, used everywhere player identity is shown.
4. **Score aggregation is normalized, not raw-summed.** Each game awards
   0–1000 points based on the player's percentile rank within that game's
   scores; `globalScore` is the sum of per-game points across every game
   they've played at least once.
5. **Dev score stays Phase 2 (not built now).** It remains the existing
   client-only cosmetic number. It will render as a second "Top Developers"
   list next to the player leaderboard on the same page (visually unified,
   "Community Rankings"), but is not mathematically combined with player
   score — they measure unrelated things, and unifying the underlying
   identity (a real person tied to games they built) is a separate, larger
   piece of work.

## Data model changes

**New Prisma model `PlayerHandle`** (one per `User`, database-auth accounts
only — global identity only makes sense for real accounts, not legacy
demo/session-based ones):

```prisma
model PlayerHandle {
  id         String   @id @default(cuid())
  userId     String   @unique
  user       User     @relation(fields: [userId], references: [id])
  username   String   @unique
  globalScore Int     @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

Username constraints: 3–20 chars, `[a-zA-Z0-9_]`, case-insensitive
uniqueness (store a lowercased `usernameKey` alongside `username` for the
unique index — display case is preserved, collisions are case-insensitive).

`globalScore` is a **denormalized cache**, recomputed whenever a game
session's best score changes (not read from an aggregation on every
leaderboard fetch — a global leaderboard is read far more often than scores
change).

**Per-game normalized points**: computed at score-update time from the V1
`PlaySession` store (existing, untouched) — percentile of the new best score
against all other players' best scores for that `gameId`, scaled 0–1000,
rounded. Recorded as `PlayerHandle.globalScore = Σ(per-game points)` by
recomputing all of that player's per-game points on each update (cheap: one
player touches at most ~30 games).

## API changes

- `POST /api/phantomplay/handle` — claim a username (409 if taken,
  400 if invalid shape). Requires a database-auth session.
- `GET /api/phantomplay/handle` — get the caller's current handle (or
  `{ hasHandle: false }` so the frontend knows to show the picker).
- `GET /api/phantomplay/leaderboard/global` — top 5 by `globalScore`, plus
  the caller's own rank/score if not in the top 5. Response shape is strictly
  `{ rank, username, globalScore }[]` — enforced by the response schema, not
  just by convention, so a future field addition can't accidentally leak
  tenant data through this route.
- Catalog sort: extend the existing trending computation
  (`phantomplay-v2.ts` `getPhantomPlayDiscovery`) from a 7-day window to an
  all-time `playCount` per game, and expose it as a sort key the frontend
  catalog/library view applies by default (most-played first), instead of
  only feeding one homepage row.

## Frontend changes

- One-time username picker modal, triggered on PhantomPlay entry when
  `GET /api/phantomplay/handle` returns `hasHandle: false`.
- Catalog/library default sort switches to most-played (existing
  category/search filters unchanged, just the default order).
- New "Best Player" hero callout (top-of-page, shows #1 username + score)
  and a top-5 list, both reading `/api/phantomplay/leaderboard/global`.
- "Community Rankings" section: the new global player top-5 alongside the
  existing (client-computed) developer directory, presented together but not
  combined.
- `pf.phantomplay.v2` localStorage flag default flips from unset/`"0"` to
  effectively always-on; the classic module and its toggle button remain in
  the codebase as a fallback path, not deleted.

## Non-goals (this phase)

- Real, server-persisted dev score.
- Cross-org friends/matchmaking/chat (unrelated V2 Phase 2/3 items).
- Retroactively backfilling `globalScore` for accounts that played games
  before this shipped is in scope (a one-time migration script), but
  historical per-session percentile snapshots are not — points are computed
  from current standings at migration time.

## Risks / open edge cases

- **Username squatting / offensive names**: out of scope for validation
  logic beyond the character-class + length rule above; no profanity filter
  in this phase. Flagging so it's a known gap, not an oversight.
- **Legacy demo/session-based accounts** (non-database auth) have no `User`
  row, so they cannot claim a handle or appear on the global leaderboard.
  Given the site is mid-migration to database auth (separate work item, same
  session), this is acceptable for now — demo sessions were never meant to
  represent real distinct people. Applies to `game.developer` client
  identities too — see note above (Phase 2 will need to answer where a
  developer's `User` row comes from at all).
