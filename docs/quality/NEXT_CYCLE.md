# Next Quality Cycle

Last updated: 2026-07-17 (session 2)

## Start Here

Read:

1. `AGENTS.md`
2. `docs/quality/CONTINUOUS_QUALITY_PROGRAM.md`
3. `docs/quality/SITE_INVENTORY.md`
4. `docs/quality/QUALITY_BACKLOG.md`
5. `docs/quality/AUDIT_LOG.md`

Do not restart the audit from zero unless the inventory is invalid.

`npm run test:change-memory` now passes clean (78/78). Do not let it regress —
if it fails again, check `git log` for merge commits first; the last failure
was caused by a merge (`24d8e3a0`) silently dropping already-shipped work from
the losing side instead of 3-way-merging it, not by careless edits.

## Immediate priorities

### Priority 1 — Q-0013: local-customer login/registration routes

The customer plan simulator backend (`/customer/plan-preview` GET/POST),
`/auth/me` enrichment, and Settings → Plan & access UI are real and tested
(`npm run test:customer-plan-switching` passes), but there is still no route
that lets a real local customer test account sign in — `local-customer-accounts.ts`'s
`loginLocalCustomer`/`registerLocalCustomer`/password-reset functions are not
called from anywhere. Add them as **new, additive routes** (do not edit the
working database-only `/auth/login`) — the previously-lost implementation used
`/auth/register`, `/auth/password-reset/request`, `/auth/password-reset/complete`,
and a combined `/auth/login` (see commit `7920549c` for reference, but a fresh
non-colliding route design is safer than resurrecting the exact old shape).
Add a regression test and a browser pass proving a customer signs in and
switches tiers end-to-end.

### Priority 2 — Q-0014: Phantom Rumble redesign decision

`git stash list` has an entry `WIP: Phantom Rumble chicken-coop redesign
(conflicts with locked ledge-recovery decision, held for owner review)`. This
needs an explicit owner call, not an agent guess: accept the redesign (update
`docs/quality/CHANGE_MEMORY.json`'s `phantom-rumble-clean-start-and-recovery`
rule to match it) or drop the stash and keep the current ledge-recovery arena.

### Priority 3 — DB-Auth Organization Isolation (Option B, still blocked)

Docker Desktop's Linux engine is still not running as of 2026-07-17 (session
2). Re-check `docker ps`; if available, resume immediately per
`docs/DATABASE_SETUP.md` / `docs/ADMIN_RECOVERY.md`. If still blocked, record
it and move on rather than stalling — this has now been the blocker for three
consecutive cycles (2026-07-16, 2026-07-17 session 1, 2026-07-17 session 2).

### Priority 4 — Responsive/Mobile Interaction Harness (Option C, partially done)

`scripts/test-responsive-viewports.mjs` now has an `INTERACTIONS` map and runs
a phone (375px) + desktop (1440px) interaction pass for `settings` (Plan &
access tab) and `media` (Edit tab) on top of the 42-case static baseline — 46
cases total, all passing, including a keyboard-focus-traversal probe. Extend
`INTERACTIONS` with more real actions instead of writing a new harness:
- PhantomPlay game launch/resume (open a built-in game, verify no overlay
  overflow, verify resume state on relaunch).
- Media Lab layer panel: with an active edit session, click the new
  align/distribute/select-all/reset buttons this cycle added and verify no
  overflow.
- Content Hub editor controls.
- Dialogs/popovers/modals opening from a workspace page.
- A real touch-target minimum-size audit (this cycle deliberately did not add
  one — a first pass would likely surface many pre-existing small targets
  across the whole app, which is a separate, larger fix than this cycle's
  scope; decide whether to gate on it or just report it before adding).

## Known pre-existing test failures (not regressions, confirmed via `git stash` against `HEAD`)

- `npm run test:command-surface` — looks for `data-command-widgets`, not
  present.
- `npm run test:auth-boundaries` — multiple stale assertions against
  `app/js/main.js`'s current auth gate markup.
- server `npm run test:competitor-intelligence` — `/auth/demo-login` does not
  return 200 for `sessionId: "admin-jordan"` in this test harness's env.
- `npm run test:medialab-editor` — expects a much larger Media Lab layer
  surface (drag-reorder, lock/unlock, clipboard copy/paste, arrow-key nudge,
  blend modes, snap guides, keyboard shortcuts) than the change-memory-tracked
  subset restored this cycle. Real, scoped work for a future cycle — the code
  exists in git history (see `AUDIT_LOG.md` 2026-07-17 session 2 for the
  investigation method: diff against the commit that introduced each feature,
  check ancestry, distinguish real regressions from stale test expectations).

None of these were touched this cycle — they were already failing at `HEAD`
before this session started. Worth a dedicated cycle, not a quick add-on.

## Stop Condition

Stop after one coherent improvement batch, with tests and docs updated. Do not
push, deploy, or sync live admin without explicit authorization.
