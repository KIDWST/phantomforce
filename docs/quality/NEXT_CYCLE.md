# Next Quality Cycle

Last updated: 2026-07-17

## Start Here

Read:

1. `AGENTS.md`
2. `docs/quality/CONTINUOUS_QUALITY_PROGRAM.md`
3. `docs/quality/SITE_INVENTORY.md`
4. `docs/quality/QUALITY_BACKLOG.md`
5. `docs/quality/AUDIT_LOG.md`

Do not restart the audit from zero unless the inventory is invalid.

Continuation is scheduled in this same Codex task by heartbeat automation
`continue-phantomforce-quality-program`.

The 2026-07-17 cycle completed the highest-risk DB-auth organization isolation
proof. The disposable Postgres runner now regenerates Prisma Client, runs the
40-check API boundary suite, and runs a Chrome browser proof that the
ChicagoShots owner only sees/switches ChicagoShots and cannot drift into
PhantomForce through a tampered selector. Do not repeat this as the primary
cycle unless auth, session, org switching, or module cache-busting changes.

## Recommended Cycle 3

Theme: fix customer-facing plan switching and competitor intelligence.

This is now the highest user-visible P1: `app.phantomforce.online` customer
plan switching can hang on "switching", and Competitor Intelligence reported a
502. `npm run test:change-memory` also still lists customer plan switching as a
missing memory-guard implementation.

### Option A — Customer Plan Switching

1. Inspect the active plan docs, `test:customer-plan-switching`, and the
   failing `test:change-memory` expectations.
2. Verify the backend endpoint for changing a customer test org's plan exists,
   updates server entitlements, and never grants platform-admin powers.
3. Verify the settings/account UI updates from Free -> Pro -> Elite and back,
   showing the selected tier as current and enforcing the matching restrictions.
4. Add/repair regression coverage so the user can freely test tiers as
   `.customer1` without a hung "switching" state.
5. Browser-test the flow against a local database-auth app session.

Likely files:

- `server/src/index.ts`
- `server/src/access/entitlements.ts`
- `app/js/orgs.js`
- `app/js/store.js`
- `app/js/settings.js`
- `scripts/test-customer-plan-switching.mjs`
- `docs/quality/CHANGE_MEMORY.json`

### Option B — Competitor Intelligence 502

1. Reproduce the 502 against the local static server + API proxy, not by visual
   guesswork.
2. Inspect `/api/competitor-intelligence` server handling, provider fallback,
   timeout behavior, and frontend error messaging.
3. Make the feature useful even when live intelligence is unavailable: return a
   clear degraded result or guided intake, not a dead red panel.
4. Add a test for successful response and fallback/unavailable response.
5. Browser-test the Research Intelligence panel after the fix.

Likely files:

- `server/src/index.ts`
- `server/src/phantom-ai/*`
- `app/js/competitor-intelligence.js`
- `app/competitor-intelligence.css`
- `scripts/test-competitor-intelligence.mjs`

### Regression Commands To Keep

- `powershell -NoProfile -ExecutionPolicy Bypass -File server\scripts\test-auth-database-live.ps1`
- `npm run test:customer-plan-switching`
- `npm run test:competitor-intelligence`
- `npm run test:change-memory`
- `git diff --check`

## Stop Condition

Stop after one coherent improvement batch, with tests and docs updated. Do not
push, deploy, or sync live admin without explicit authorization.
