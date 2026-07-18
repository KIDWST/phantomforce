# Next Quality Cycle

Last updated: 2026-07-18

## Start Here

Read:

1. `AGENTS.md`
2. `docs/quality/CONTINUOUS_QUALITY_PROGRAM.md`
3. `docs/quality/SITE_INVENTORY.md`
4. `docs/quality/QUALITY_BACKLOG.md`
5. `docs/quality/AUDIT_LOG.md`

Do not restart the audit from zero unless the inventory is invalid. Continuation
is scheduled in this same Codex task by heartbeat automation
`continue-phantomforce-quality-program`.

Cycle 18 closed a real cross-organization browser-context defect. Database and
local-customer sessions now scope browser memory and temporary history to the
active `orgId`, successful switches clear the old visible transcript, and
database membership names render correctly. A legitimate two-organization
user passed 20 mixed chat turns, reload persistence, two-way organization
switches, request/model isolation, forged non-member rejection, and desktop
plus mobile browser checks. The module graph is cache-busted as
`phantom-live-20260718-34`.

## Recommended Cycle 19

Theme: full business-record organization-isolation browser proof.

Memory and chat now have strong authenticated browser evidence. Extend the
same proof to records that could cause business harm if crossed: CRM leads,
proposals, approvals, assets, accounting transactions, and connector state.

### Required Pass

1. Use one database-auth user with legitimate memberships in two organizations.
2. Create distinct CRM leads, proposals, approvals, assets, and accounting
   transactions in A and B through real UI/API paths.
3. Require every module to rerender on switch and show only the active tenant.
4. Capture network requests and require every tenant-aware request to carry or
   resolve the active organization, never a legacy global workspace.
5. Attempt URL, body, local-storage, and switcher tampering for a non-member
   organization and require fail-closed 401/403 behavior.
6. Reload in each organization and prove persistence without contamination.
7. Browser-check desktop and mobile module states with zero overflow, stale
   labels, stale counts, console errors, or fake records.

Likely files:

- `server/src/index.ts`
- `app/js/store.js`
- `app/js/serverrecords.js`
- `app/js/crmpipeline.js`
- `app/js/workspaces.js`
- `scripts/test-database-auth-org-browser.mjs`

## Regression Commands To Keep

- `powershell -NoProfile -ExecutionPolicy Bypass -File server\scripts\test-auth-database-live.ps1`
- `npm run test:client-setup-audit`
- `npm run test:dashboard-chat`
- `npm run test:release-critical`
- `npm run test:change-memory`
- `npm run test:auth-boundaries`
- `npm run build`
- `git diff --check`

## Stop Condition

Stop after one coherent improvement batch with tests and docs updated. The user
has explicitly authorized commit, push, and live deployment; still fetch/rebase
first, preserve concurrent work, and verify the deployed commit/build id before
reporting completion.
