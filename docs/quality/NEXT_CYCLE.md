# Next Quality Cycle

Last updated: 2026-07-14

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

Cycle 1B fixed the Phantom Rumble stale victory overlay and hardened
PhantomPlay resume state. Do not repeat that work unless a new regression is
observed. Continue with the highest-risk open proof below.

## Recommended Cycle 2

Theme: prove organization isolation with database-auth users.

This is the highest-risk remaining P1 because cross-organization CRM, memory,
asset, proposal, or approval leakage would be a real business and security
failure. If safe database-auth fixtures cannot be created in this environment,
record the blocker and immediately switch to Option B instead of stalling.

### Option A — DB-Auth Organization Isolation

1. Inspect `docs/DATABASE_SETUP.md`, `docs/ADMIN_RECOVERY.md`, and auth tests.
2. Create or reuse safe local DB-auth fixtures for PhantomForce and ChicagoShots.
3. Verify each user sees only their own CRM, proposals, approvals, memory, and
   assets.
4. Browser-test the org switch/profile selector.
5. Add regression coverage for any leak or stale-org UI state.

Likely files:

- `server/src/access/user-accounts.ts`
- `server/src/index.ts`
- `app/js/orgs.js`
- `app/js/store.js`
- `app/js/main.js`
- `scripts/test-auth-boundaries.mjs`
- `server/scripts/test-auth-*.ps1`

### Option B — Responsive/Mobile Harness

1. Add a local browser test dependency or use an available browser runner.
2. Login locally and sweep 320, 375, 768, 1024, 1440, and 1920px.
3. Check each nav destination for horizontal overflow, clipped text, hidden
   controls, inaccessible dialogs, and unusable touch targets.
4. Fix the highest-impact module batch.

Likely files:

- `app/phantom.css`
- `app/js/main.js`
- `app/js/medialab.js`
- `app/js/contenthub.js`
- `app/js/settings.js`
- `scripts/`

## Stop Condition

Stop after one coherent improvement batch, with tests and docs updated. Do not
push, deploy, or sync live admin without explicit authorization.
