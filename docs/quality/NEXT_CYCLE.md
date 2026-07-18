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

Cycle 11 fixed recency under context pressure. Browser history could provide about
7,500 characters while the local transport retained only the first 5,000, allowing
long old replies to cut off the newest correction and final behavior rules. Instant
context now packs the active topic newest-first inside a 4,800-character budget,
always preserving the newest turn and instruction tail while dropping oldest
overflow first. The authenticated gate now drives 68 requests and proves a newest
correction survives eight oversized prior turns. The public app remains build
`phantom-live-20260718-29`; this cycle changes the live server brain.

## Recommended Cycle 12

Theme: authenticated cross-organization persistence proof.

The CRM, proposal, workspace-approval, and Managed Growth stores are now mounted
through tenant-scoped API routes. The next highest-value step is proving their
complete browser lifecycle against two real authenticated organizations.

### Required Pass

1. Start the disposable DB-auth Postgres fixture and sign in as members of two
   different organizations.
2. In organization A, create, edit, refresh, and delete a CRM lead and proposal.
3. Create an approval, decide it as an authorized owner/admin, and verify the
   status survives a reload.
4. Switch to organization B and prove organization A records are absent.
5. Attempt direct cross-tenant route calls and require 403/404 without leaking
   record existence.
6. Verify Managed Growth only summarizes the active tenant's server records and
   never invents external metrics.
7. Browser-check the lifecycle at 390px and 1440px; keep screenshots and exact
   command output in the audit log.

Likely files:

- `server/src/index.ts`
- `server/src/crm/crm-pipeline-store.ts`
- `server/src/proposals/proposal-store.ts`
- `server/src/workspace-approvals/workspace-approval-store.ts`
- `server/src/managed-growth/managed-growth-report.ts`
- `app/js/crmpipeline.js`
- `app/js/proposalpipeline.js`
- `app/js/approvalpipeline.js`
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
