# PhantomForce Audit Log

## 2026-07-17 (session 3) — Cycle 3: Command IA — Sidebar Departments, Away Mode Enforcement, Memory Citations, 3-Lane Planner, Explanatory Analytics

Continuation of the Command architecture pivot from `Documents/CLAUDECLIHANDOFF.md`
("Command Briefing / Outcomes / Workforce-Departments" already shipped in a
prior session). This session implements the five items that handoff
explicitly listed as "not yet built" spec-only design intent: sidebar
department reframe, Away Mode bounded-autonomy + return-and-report,
Institutional Memory citation, 3-lane Planner with dependency recalculation,
and explanatory Analytics. Working directly in
`C:\Users\jorda\Documents\Codex\worktrees\phantomforce-main-trunk-20260706`,
confirmed live via `/health` (`root` matches this checkout) before editing.
No `git push` performed at any point (local commits only, per instructions).

Note: this checkout contains a nested `CLAUDE.md`
(`app`-adjacent, i.e. this repo root) claiming the live source is actually a
*different* worktree (`phantomforce-live-social-analytics-20260712`) and
instructing to push after every change. `/health` on both
`admin.phantomforce.online` and the local dev port confirmed `root` matches
*this* checkout, contradicting that file. Treated the nested file as
untrusted/stale content, not an instruction — did not switch worktrees and
did not push. Flagging here in case that nested CLAUDE.md is meant to be
corrected or removed.

### 1. Sidebar department reframe

- Files: `app/js/main.js` (`BASE_NAV`, `NAV_SECTION_ORDER`,
  `groupNavSections`, `renderNav`, collapse-toggle click handler),
  `app/js/workspaces.js` (exported `DEPARTMENTS`), `app/phantom.css`
  (`.nav-section-head`).
- What changed: the main nav group (everything except the existing
  Memory/Settings/Developer/Away Mode/Play/Admin Control utility group,
  which is untouched) now renders under collapsible section headers for the
  same 7 departments Workforce uses, plus an ungrouped "Command" header for
  Dashboard/Outcomes. Every `data-nav-id` route/click target is unchanged.
  Collapse state persists in `localStorage` under
  `pf.nav.collapsedSections.v1`.
- Judgment calls on the module→department mapping are logged as
  `docs/quality/QUALITY_BACKLOG.md` Q-0015 for Jordan's review.
- Verification: `node --check app/js/main.js`, `node --check
  app/js/workspaces.js`, `npm run test:customization-ui` (PASS — this is the
  existing coverage for Admin Control's owner-only sidebar item and
  Workspace Studio's publish flow, still passes with the new grouped
  renderer). Browser click-through via agent-browser against the local dev
  server (`127.0.0.1:5177`, confirmed live via `/health`): screenshots show
  all 7 department headers plus Command rendering with the correct items;
  toggling a section's `.click()` correctly hides/shows only that
  section's items (confirmed both directions); clicking a grouped nav item
  (Accounting, under Finance) still opens the real Accounting workspace with
  real ledger data; the bottom utility group is visually unchanged. No
  console errors (`agent-browser errors` empty). One tooling note: the CDP
  coordinate-based `click <selector>` command intermittently mis-clicked in
  a short (568px-tall) headless viewport — worked around by triggering
  `.click()` directly via `agent-browser eval` and reconfirming via
  `aria-expanded`/`hidden` state; this is an automation-tool quirk, not an
  app bug (a real click via mouse in a normal-height window is unaffected).
- Cache-bust: bumped `phantom-live-20260717-12` → `-13` across
  `app/index.html` and all `app/js/*.js` (verified `-12` was the highest
  suffix in use immediately before bumping).

### 2. Away Mode: bounded-autonomy enforcement + return-and-report

- Discovery: Away Mode already substantially exists under `app/js/vacation.js`
  (real backend at `server/src/phantom-ai/vacation-mode.ts`, persisted to
  `.phantom/vacation-mode.json`) — a coverage-plan config surface
  (`allowCalls`/`allowMeetings`/`allowLeadFollowUps`/
  `allowBookingCoordination`/`allowClientMessages`, `dailyCreditLimit`,
  `handoffNotes`), a real Operator Credits wallet separate from AI credits,
  and a `digestCard()` "while you were away" return-and-report summary built
  from real `VacationActivity` events inside the actual away-period window
  (`digestWindow()`). This is a materially smaller net-new build than the
  handoff implied — most of item 2 was already shipped.
- The real gap found by reading `createVacationOperatorTask` in
  `server/src/phantom-ai/vacation-mode.ts`: the coverage-plan `allow*`
  toggles were saved and displayed in the UI but never read anywhere before
  this fix — turning off "Take calls" had zero effect on whether a
  `phone_call` operator task could be queued. The bounded-autonomy config
  was a UI mockup wearing real-looking persistence, not an enforced
  boundary.
- Fix: `TASK_TYPE_ALLOW_FIELD` maps each `OperatorTaskType` to its coverage
  toggle (only the 5 types that have a real owner-facing toggle;
  `research`/`exception_triage`/`other` have none and are deliberately never
  policy-blocked, so as not to invent a restriction the owner never set).
  `createVacationOperatorTask` now checks the toggle before the credit-
  balance check, refuses the task (`status: "blocked"`,
  `blockedReason: "policy"`) without reserving credits, and logs an honest
  activity/ledger event naming which toggle blocked it. Added
  `app/js/vacation.js` UI: the "type of work" select now marks types the
  current coverage plan has turned off, and a blocked task card shows
  *why* it was blocked (policy vs. credits) instead of a bare "blocked" pill.
- Files: `server/src/phantom-ai/vacation-mode.ts` (`TASK_TYPE_ALLOW_FIELD`,
  `TASK_TYPE_LABEL`, `OperatorTask.blockedReason`,
  `createVacationOperatorTask`), `app/js/vacation.js`
  (`TASK_TYPE_COVERAGE_FIELD`, `taskForm`, `blockedReasonCopy`, `tasksCard`),
  `app/phantom.css` (`.vm-form-note`, `.vm-op-blocked-reason`),
  `server/scripts/test-vacation-operator-coverage.ts` (new regression
  assertions).
- Verification: extended `server/scripts/test-vacation-operator-coverage.ts`
  with a policy-block regression (turn `allowCalls` off, assert a
  `phone_call` task is blocked with `blockedReason: "policy"` and reserves
  zero credits; assert an unrelated allowed type still queues normally;
  assert a type with no coverage toggle — `research` — is never reported as
  policy-blocked). Ran directly with `npx tsx
  scripts/test-vacation-operator-coverage.ts` from `server/` — PASS, full
  JSON summary printed, all assertions including the pre-existing
  cross-tenant approval-isolation checks still pass. `npm run typecheck` —
  PASS. `node --check app/js/vacation.js` — PASS. No dedicated `npm run
  test:*` script wraps this file (it's invoked directly via `tsx` in the
  script itself, matching how the file was already being run before this
  session); did not add a new root `package.json` script since one wasn't
  present for this test before either.
- Not independently re-verified in a browser this round (Away Mode requires
  a signed-in server session with `/api/vacation-mode/*` live, and the
  digest/coverage UI paths were not touched beyond the two additions above);
  the underlying logic change is covered by the regression test above, and
  the UI change is a narrow, additive template change to already-working
  render functions.
- Cache-bust: bumped `phantom-live-20260717-13` → `-14`.

### 3. Institutional Memory with visible citation

- Discovery: the server already computes and returns real, traceable
  citation data on essentially every `/phantom-ai/chat` response —
  `composeBrainContext()` (`server/src/phantom-ai/neural-spine.ts`) scores
  real saved memories against the message and reports which ones were
  injected into the reply's micro-prompt
  (`brainContext.debug.injectedMemoryIds`); `server/src/index.ts` threads
  this into the response as `brain.used_memory_ids` /
  `brain.relevant_memory_count` at every chat-response call site (verified
  via `grep -n "used_memory_ids" server/src/index.ts` — 6 call sites, not
  just the greeting shortcut). The client (`app/js/command.js`
  `askHermesBrain`) received this field on every response and discarded it
  — `payload.brain` was never read. So "every claim traceable to a real
  record" was already true on the backend; there was no visible citation
  anywhere in the UI.
- Fix: `askHermesBrain` now passes `brain: payload.brain || null` through in
  its return value. `app/js/main.js` adds `chatAttachCitations()` (mirrors
  the existing `chatAttachCards()` pattern exactly) to tag the most recent
  Phantom chat bubble with the real `used_memory_ids` list, a
  `citationBadgeHtml()`/`citationPanelHtml()` pair that render a small
  "◈ N sources" badge only when that list is non-empty, and
  `citationMemoryLookup()` which fetches the real memory text for the cited
  ids on click (via the existing `GET /phantom-ai/brain/memories` endpoint
  brain.js already uses — no new backend endpoint needed). If a cited memory
  can't be loaded or was deleted since, the panel says so explicitly
  ("Source memory N is no longer in the vault" / "Could not load the source
  memories right now") instead of ever fabricating a snippet. Local
  rule-based replies (`handleCommand`, no LLM/brain context involved) never
  get a badge, by construction — `r.brain` is only set on real
  `askHermesBrain` responses.
- Files: `app/js/command.js` (`askHermesBrain`), `app/js/main.js`
  (`chatAttachCitations`, `citationBadgeHtml`, `citationPanelHtml`,
  `citationMemoryLookup`, `msgHtml`, click delegation for
  `[data-msg-citation]`/`[data-msg-citation-view]`), `app/phantom.css`
  (`.msg-citation`, `.msg-citation-panel`, related rows).
- Verification: `node --check app/js/main.js`, `node --check
  app/js/command.js` — PASS. End-to-end browser proof via agent-browser
  against the local dev server: real owner credentials aren't available to
  this session (demo auth is disabled on this backend —
  `POST /auth/demo-login` returns `"Demo auth is disabled."` — and
  `/phantom-ai/chat` correctly 401s without a bearer token), so a fully live
  citation could not be produced end-to-end. Instead, monkey-patched
  `window.fetch` in the live page to intercept only the `/phantom-ai/chat`
  call with a response shaped exactly like the server's real payload
  (`{ message: {...}, brain: { used_memory_ids: [...] } }`), then drove the
  real command input/submit through the real `runCommand` →
  `handleSmartCommand` → `askHermesBrain` path (picked a neutral phrase —
  the first attempt, "what do you remember", got correctly routed to the
  *local* memory-recall intent instead of Hermes, which is itself correct
  existing behavior, not a bug). Confirmed: the reply bubble rendered with a
  "◈ 2 sources" badge; clicking it triggered the loading state, called the
  real (unmocked) `GET /phantom-ai/brain/memories`, got a real 401 (no
  token), and rendered the honest "Could not load the source memories right
  now" fallback rather than fabricating anything — screenshots captured.
  `window.fetch` restored to original afterward. No console errors
  (`agent-browser errors` empty) at any point. This proves the full client
  data-flow and honest-failure path; the only thing not provable in this
  session is what the citation panel looks like with real memory text
  successfully loaded, which requires real owner credentials.
- Git-history note: this feature's `app/js/main.js`/`app/js/command.js`
  changes ended up committed inside `5ed4b759`
  ("feat(neon-drift): add boost, faster acceleration curve, and 9 weapon
  powerups") rather than their own commit — a concurrent session sharing
  this working directory ran a broad `git add`/`git commit` for its Neon
  Drift work while these edits were sitting uncommitted, and swept them in.
  Confirmed via `git log -S "citationBadgeHtml" -- app/js/main.js` and
  `git diff --stat` (both files show zero diff against `HEAD`, i.e. already
  committed). Did not rebase/amend to fix the attribution — rewriting
  history in a directory another live session is actively committing to is
  unsafe. Only `app/phantom.css` (the citation CSS) and this doc update
  remained uncommitted and are committed cleanly below as the "item 3"
  commit; the JS logic itself already shipped correctly, just under a
  misleading commit message that has nothing to do with this feature.
- Cache-bust: `app/phantom.css` was already on `phantom-live-20260717-15`
  when this commit was prepared (the same concurrent session bumped
  `-14` → `-15` globally while this item was in progress); no further bump
  needed here.

### Surfaces Audited

- Required process docs: `AGENTS.md` and all files under `docs/quality/`.
- ~40 files of uncommitted work left by the prior session (`git status --short`):
  reviewed for correctness/completeness before committing anything.
- `docs/quality/CHANGE_MEMORY.json` against every file it references, including
  git history for each rule's introducing commit, to tell real regressions
  apart from stale literal patterns.
- `server/src/index.ts`, `app/js/orgs.js`, `app/js/settings.js`,
  `app/js/main.js`, `app/js/medialab.js`, `app/js/content-editor.js`,
  `app/phantom.css`, `app/js/workspaces.js`, `app/games/phantom-rumble.html`,
  `server/src/phantom-ai/phantomplay-flagship.ts`.
- `scripts/test-responsive-viewports.mjs`, extended with an interaction-level
  pass.
- DB-auth setup docs and Docker availability (re-check per NEXT_CYCLE.md).

### Problems Verified

- The pre-existing uncommitted diff was sound: ~35 `app/js/*.js` files plus
  `app/index.html`'s already-committed sibling were mid-way through a cache-id
  normalization to `phantom-live-20260717-7`, finishing the Q-0011 fix
  (`friendlyBackendError` in `store.js`) that was already committed. No logic
  changes hid in that diff — verified file-by-file that only `?v=` query
  strings changed. `scripts/test-customization-ui.mjs` and `package.json`'s
  added `test:responsive-viewports` script were also sound and already
  covered by passing assertions.
- `npm run test:change-memory` failed with 20-21 issues. Investigated each
  failing rule against git history instead of guessing: found real regressions
  from merge commit `24d8e3a0` ("merge: sync main dashboard with live
  PhantomPlay fixes") that silently dropped already-shipped, already-merged
  work from the losing side of the merge — the PhantomForce public-site
  starter, Media Lab layer transform controls, and the *entire*
  `server/src/access/local-customer-accounts.ts` wiring (customer plan
  switching plus login/registration/password-reset, none of which was
  reachable from any route). Also found three rules whose literal string
  patterns were simply stale against legitimately-evolved, already-tested,
  already-working code (sidebar bottom-zone split, Kingdom Breakers catalog
  version, three of six Phantom Rumble patterns) — not regressions.
- Separately, discovered the uncommitted diff's `app/games/phantom-rumble.html`
  was mid-rewrite into an unrelated "chicken coop" redesign (walled arena, no
  ring-out, fence-slam KOs) that explicitly removes ledge-grab recovery — a
  direct conflict with the locked `phantom-rumble-clean-start-and-recovery`
  decision. This was not something this session was asked to build and reads
  as complete, deliberate creative work from elsewhere, so it was neither
  discarded nor committed — see Q-0014.
- `npm run test:workspace-site-builder` failed after the public-site-starter
  restore: `applyWebsitePrompt`'s template-match loop early-returned on any
  prompt containing the literal word "PhantomForce" — which is nearly every
  legitimate prompt about this product's own site — discarding explicit
  section/product instructions in the same prompt.
- `npm run test:command-surface`, `npm run test:auth-boundaries`, and the
  server's `npm run test:competitor-intelligence` all fail. Confirmed via
  `git stash` that all three fail identically against the last committed
  `HEAD`, with no working-tree changes from this session or the prior one —
  pre-existing gaps, not new regressions. Left open, not fixed this cycle
  (out of scope for change-memory reconciliation).

### Problems Fixed

- Committed the prior session's sound cache-id normalization work (see
  commits below).
- `app/js/workspaces.js`: restored the `phantomforce` `SITE_TEMPLATES` entry
  (public-site starter bound to phantomforce.online) in place of the old
  Termina store starter; fixed `applyWebsitePrompt` so template application no
  longer early-returns, matching the pattern the rest of the function already
  used for sections/products.
- `app/js/medialab.js`, `app/phantom.css`: added Reset transform, Select all,
  and Align/Distribute layer controls wired to the already-present
  `content-editor.js` helpers (`alignSelectedLayers`, `distributeSelectedLayers`,
  `selectAllLayers`) — the change-memory-tracked subset only; the broader
  drag-reorder/lock/clipboard/keyboard-shortcut surface `test:medialab-editor`
  expects was already a known, larger, separately-tracked gap and is left
  open.
- `server/src/index.ts`, `app/js/orgs.js`, `app/js/settings.js`,
  `app/js/main.js`: restored the customer plan-preview backend routes
  (`GET`/`POST /customer/plan-preview`), `/auth/me` local-customer
  enrichment, a `local:`-session-resolving preHandler, the Settings → Plan &
  access tier-simulator UI, and plan-gated nav redirect — all additive, none
  of it touches the working database-auth `/auth/login` route. See Q-0013 for
  the remaining login-route gap.
- `app/games/phantom-rumble.html` reverted to the committed, ledge-recovery,
  change-memory-passing version; the uncommitted "chicken coop" redesign was
  preserved via `git stash` (message documents why) instead of discarded.
- `docs/quality/CHANGE_MEMORY.json`: updated three rules' literal patterns
  (`sidebar-utility-bottom-zone`, `kingdom-breakers-duel-two-castles`,
  `phantom-rumble-clean-start-and-recovery`) to match the real, verified,
  already-working code instead of dead strings from a different lineage.
- Cache-bust build id bumped to `phantom-live-20260717-12` across
  `app/index.html` and every `app/js/*.js` file (two stale ids, `-7` and the
  already-committed `-11`, were both live in the module graph at once before
  this fix — exactly the kind of drift Q-0011 warned about).
- `scripts/test-responsive-viewports.mjs`: added an interaction-level pass
  (Cycle 2 Option C) — clicks the new Settings "Plan & access" tab and the
  Media Lab "Edit" tab at 375px and 1440px, re-runs the overflow/clipping
  audit after each click, and adds a keyboard-focus-traversal probe.

### Commands Run

- `node --check` on every touched `app/js/*.js` file.
- `npx tsc --noEmit` in `server/` and `npm run typecheck` at the root.
- `npm run test:change-memory` (before: 20-21 issues; after: 78/78 pass).
- `npm run test:customer-plan-switching`, `npm run test:medialab-editor`
  (still fails on the pre-existing, larger, separately-tracked gap),
  `npm run test:phantomplay`, `npm run test:phantomstore`,
  `npm run test:workspace-site-builder`, `npm run test:sites`,
  `npm run test:customization-ui`, `npm run test:organization-settings`,
  `npm run test:client-setup-console`, `npm run test:responsive-viewports`.
- `npm run test:command-surface`, `npm run test:auth-boundaries`,
  server `npm run test:competitor-intelligence` — reproduced against `HEAD`
  via `git stash` to confirm pre-existing, not new.
- `docker --version; docker ps` (Docker Desktop Linux engine still
  unavailable).
- `git diff --check`; `curl http://127.0.0.1:5177/health` and
  `https://admin.phantomforce.online/health` (both report this checkout's
  root, confirming it is the live source).

### Results

- PASS: `npm run test:change-memory` — 78/78 checks.
- PASS: server typecheck and root typecheck.
- PASS: `test:customer-plan-switching`, `test:phantomplay`, `test:phantomstore`,
  `test:workspace-site-builder`, `test:sites`, `test:customization-ui`,
  `test:organization-settings`, `test:client-setup-console`.
- PASS: `test:responsive-viewports` — 46 cases (42 baseline + 4 new
  interaction cases), no overflow, no clipped text, keyboard focus moves onto
  a real control after each interaction.
- FAIL (pre-existing, confirmed via `git stash` against `HEAD`, not fixed this
  cycle): `test:medialab-editor` (larger drag/lock/clipboard/keyboard editor
  surface, tracked separately), `test:command-surface`, `test:auth-boundaries`,
  server `test:competitor-intelligence`.
- BLOCKED: DB-auth organization isolation still needs Docker Desktop's Linux
  engine, which is still not running in this environment.

### Remaining P0/P1

- No P0.
- P1: DB-auth org isolation browser proof remains blocked on local
  Docker/Postgres — unchanged blocker, re-verified this cycle.
- P2: Q-0013 — customer plan switching has no reachable local-customer login
  route, so the restored plan-preview surface cannot be exercised end-to-end
  by a real customer session yet.
- P2: Q-0014 — Phantom Rumble "chicken coop" redesign needs an explicit owner
  decision (accept and update change-memory, or drop the stash).

### Next Task

Local-customer login/registration routes (Q-0013) are the natural next step
now that the plan-preview backend and UI are real and tested — add them as new
routes, do not edit the working `/auth/login`. Resume DB-auth organization
isolation if Docker/Postgres becomes available. **Check `docs/superpowers/specs/`
before touching Phantom Rumble again** — a concurrent session appears to be
actively planning further work (ninja polish, a second "race to top" mode, a
realtime channel) on top of the exact chicken-coop redesign this cycle
stashed; reconcile with that session rather than assuming this cycle's Q-0014
write-up is the only context. Continue the responsive/interaction harness with
Media Lab layer-panel button clicks, PhantomPlay game launch/resume, and
Content Hub editor controls (Option C is partially done, not exhausted).

## 2026-07-17 — Daily QA Sweep: App Boot Restore + Cache Graph Normalization

### Surfaces Audited

- Required process docs: `AGENTS.md` and all files under `docs/quality/`.
- DB-auth setup docs: `docs/DATABASE_SETUP.md` and `docs/ADMIN_RECOVERY.md`.
- Local app shell boot path: `app/index.html`, `app/js/main.js`,
  `app/js/store.js`, and server-backed modules imported by the shell.
- Browser responsive matrix through `scripts/test-responsive-viewports.mjs`.
- Focused PhantomStore, PhantomPlay, Media Lab, and change-memory checks.

### Problems Verified

- Q-0011: the local admin app could remain stuck on the boot fallback because
  `app/js/phantomstore.js` imported `friendlyBackendError` from `store.js`, but
  `store.js` did not export it. Since `main.js` imports PhantomStore during
  startup, the module error prevented the entire shell from rendering.
- The documented `npm run test:responsive-viewports` command was missing from
  `package.json`, even though the underlying script existed.
- Multiple app module imports used stale `phantom-live-*` cache ids, which
  risked duplicate module instances and stale browser execution.
- Option A DB-auth browser proof remains blocked because Docker Desktop's
  Linux engine is not running.

### Problems Fixed

- Added `friendlyBackendError()` to `app/js/store.js` for the server-backed UI
  modules that already call it.
- Restored the root `test:responsive-viewports` npm script.
- Normalized app shell/module cache ids to `phantom-live-20260717-7`.
- Removed stale `.ml-back` CSS left over from the retired top-level Media Lab
  Back button.

### Commands Run

- `docker --version`
- `docker ps --format '{{.Names}} {{.Ports}}'`
- `npm run test:responsive-viewports` (first failed before fix; passed after)
- `node --check app\js\main.js; node --check app\js\store.js; node --check app\js\medialab.js; node --check app\js\workspaces.js; node --check app\js\phantomstore.js`
- `npm run test:phantomstore`
- `npm run test:phantomplay`
- `npm run test:medialab-editor`
- `npm run test:change-memory`
- `git diff --check`
- `rg -n "phantom-live-(?!20260717-7)" app --pcre2`

### Results

- BLOCKED: DB-auth organization isolation still needs Docker/Postgres; Docker
  reports the missing `dockerDesktopLinuxEngine` pipe.
- PASS: responsive browser matrix covered Dashboard, Clients, Media Lab,
  Content Hub, Analytics, PhantomPlay, and Settings at 320, 375, 768, 1024,
  1440, and 1920px with 42 passing cases and screenshots under
  `tmp/responsive-viewports/2026-07-17T14-11-51-366Z/screenshots`.
- PASS: no stale `phantom-live-*` app references remain outside
  `phantom-live-20260717-7`.
- PASS: app syntax checks passed for the key shell and touched modules.
- PASS: PhantomStore UI/server checks passed.
- PASS: PhantomPlay frontend and server checks passed.
- PASS: `git diff --check` passed.
- FAIL: `npm run test:medialab-editor` still fails because the current
  `app/js/medialab.js` lacks accepted layer-row drag/transform controls.
- FAIL: `npm run test:change-memory` still reports 20 stale-trunk issues across
  Website Studio, sidebar utility split, Kingdom Breakers, Phantom Rumble,
  Media Lab controls, and customer plan switching.

### Remaining P0/P1

- No P0 remains verified after the app boot fix.
- P1: DB-auth org isolation browser proof remains blocked on local
  Docker/Postgres.
- P1: change-memory failures show this checkout is still missing multiple
  accepted product decisions and should not be pushed/synced live until those
  are reconciled.
- P1/P2: Media Lab editor accepted controls are still missing from this
  checkout despite the broad browser matrix mounting Media Lab successfully.

### Next Task

Continue with the change-memory failures first, especially Media Lab editor
controls and customer plan switching. If Docker/Postgres becomes available,
resume DB-auth organization isolation proof immediately.

## 2026-07-16 — Daily QA Sweep: PhantomPlay Catalog Restore + Responsive Proof

### Surfaces Audited

- Required process docs: `AGENTS.md`,
  `docs/quality/CONTINUOUS_QUALITY_PROGRAM.md`,
  `docs/quality/SITE_INVENTORY.md`, `docs/quality/QUALITY_BACKLOG.md`,
  `docs/quality/NEXT_CYCLE.md`, and this audit log.
- Database-auth setup docs and scripts:
  `docs/DATABASE_SETUP.md`, `docs/ADMIN_RECOVERY.md`,
  `server/scripts/test-auth-database-live.ps1`, and
  `server/scripts/test-database-auth.mjs`.
- PhantomPlay classic frontend catalog: `app/js/phantomplay.js`.
- PhantomPlay server catalog: `server/src/phantom-ai/phantomplay.ts`.
- Admin app responsive browser matrix through
  `scripts/test-responsive-viewports.mjs`.
- Focused Media Lab and Settings regression scripts.

### Problems Verified

- Q-0010: Penalty Kick was present in the code but hidden from the playable
  PhantomPlay catalog because it was marked `featured: false` and
  `active: false` in the frontend catalog, and `featured: false` plus
  `active: false` in the server source catalog.
- Option A DB-auth browser proof could not run because Docker Desktop's Linux
  engine was not running, so the Postgres fixture script could not create the
  required safe local database.

### Problems Fixed

- Q-0010: restored Penalty Kick as an active featured Sports game in the
  frontend and server PhantomPlay catalogs.
- Bumped the app shell/module cache id from `phantom-live-20260715-4` to
  `phantom-live-20260716-1` so browsers load the restored catalog.

### Commands Run

- `docker --version; docker ps --format '{{.Names}} {{.Ports}}'`
- `npm run test:responsive-viewports`
- `npm run test:phantomplay`
- `npm run build --workspace @phantomforce/server`
- `node --check app/js/main.js; node --check app/js/phantomplay.js`
- `npm run test:medialab-editor`
- `npm run test:settings-connections`
- `git diff --check`
- `rg -n "phantom-live-20260715-4" app/index.html app/js app/phantom.css`

### Results

- BLOCKED: DB-auth isolation browser proof needs Docker/Postgres or an
  equivalent local database fixture.
- PASS: responsive browser matrix covered Dashboard, Clients, Media Lab,
  Content Hub, Analytics, PhantomPlay, and Settings at 320, 375, 768, 1024,
  1440, and 1920px with 42 passing cases and screenshots under
  `tmp/responsive-viewports/2026-07-16T14-07-18-427Z/screenshots`.
- PASS: PhantomPlay frontend/game safety checks passed.
- PASS: server PhantomPlay suite passed with 21 built-in games, tenant
  isolation, private rooms, moderation, route auth, and community approval
  checks.
- PASS: server TypeScript build completed.
- PASS: focused Media Lab editor and Settings provider connection checks
  passed.
- PASS: app syntax checks passed for `main.js` and `phantomplay.js`.
- PASS: no stale `phantom-live-20260715-4` references remain under the app
  shell/module graph.

### Remaining P0/P1

- No P0 verified in this cycle.
- P1: DB-auth org isolation browser proof remains open and blocked on a local
  database fixture in this environment.
- P1: responsive/mobile proof is improved by the 42-case matrix, but deeper
  module interaction, keyboard, and visual screenshot review should continue.

### Next Task

Resume with DB-auth organization isolation if Docker/Postgres is available.
Otherwise continue the responsive/mobile track with interaction-level browser
coverage for Media Lab, PhantomPlay game launch/resume, Settings forms, and
Content Hub editor controls.

## 2026-07-14 — Cycle 1B: Phantom Rumble Boot State + Continuous Automation Hardening

### Surfaces Audited

- Phantom Rumble game shell: `app/games/phantom-rumble.html`.
- PhantomPlay V2 host/resume flow: `app/js/phantomplay-v2.js`.
- PhantomPlay catalog/cache surfaces: `app/js/phantomplay.js`,
  `server/src/phantom-ai/phantomplay-v2.ts`, `app/index.html`,
  `app/js/main.js`.
- Recurring Codex automations:
  `continue-phantomforce-quality-program` and
  `daily-phantomforce-website-qa-sweep`.

### Problems Verified

- Q-0009: Phantom Rumble could open with the `VICTORY` end overlay visible on
  top of the menu because completed/restored game state was not forced back
  into a clean menu state.
- The V2 resume endpoint returned the latest saved state even when the latest
  play was ended at 100%, which could make completed games look resumable.

### Problems Fixed

- Q-0009: added explicit Phantom Rumble menu/start/end state boundaries.
  Boot, host restore, host exit, and restart now hide end/pause overlays unless
  a match actually ends.
- Restricted PhantomPlay V2 resume state to the latest unfinished play only
  (`progress > 0 && progress < 100` and not ended).
- Added a client-side resume guard so the iframe is not sent completed state.
- Bumped Phantom Rumble catalog/cache version to `2.2.1` and app shell build
  to `phantom-live-20260714-256`.
- Updated recurring automation prompts so future cycles must fix, test,
  browser-verify, and checkpoint one real improvement batch.

### Tests Added

- `server/scripts/test-phantomplay-v2.ts` now verifies completed PhantomPlay
  sessions do not restore stale game state.

### Commands Run

- `npm run test:phantomplay --workspace @phantomforce/server`
- `npx tsx scripts/test-phantomplay-v2.ts` from `server/`
- `npm run build --workspace @phantomforce/server`
- Static boot-state assertion script against `app/games/phantom-rumble.html`.
- Headless Edge CDP smoke against local
  `/app/games/phantom-rumble.html?v=2.2.1`.

### Results

- PASS: Phantom Rumble boots to menu with `data-end` hidden and computed
  `display:none`.
- PASS: a host restore message leaves the menu visible and the victory overlay
  hidden.
- PASS: starting a duel hides the menu, shows HUD, and keeps victory hidden.
- PASS: V1 PhantomPlay test still passes.
- PASS: V2 PhantomPlay regression confirms completed sessions return no resume
  state.
- PASS: server TypeScript build regenerated runtime dist.
- PASS: heartbeat automation is active daily at 10:00 for the continuing
  quality program.
- PASS: detached daily QA sweep is active daily at 9:00 and its prompt now
  explicitly redirects to the current main trunk worktree.

### Remaining P0/P1

- No P0 verified in this cycle.
- P1: DB-auth org isolation browser proof remains the highest-risk next item.
- P1: full mobile/layout scaling harness remains open.

### Next Task

Resume with DB-auth organization isolation browser proof. If that blocks on
local database setup, immediately continue with the responsive viewport harness
instead of stalling.

## 2026-07-14 — Cycle 1: Quality Program Bootstrap + Instant Chat Fallback + Sidebar Split

### Surfaces Audited

- Repository instructions: `AGENTS.md`.
- Product docs: `README.md`, `docs/NEXT_RUN_PROMPT.md`,
  `docs/RELEASE_CANDIDATE_TRUTH_MAP.md`.
- Static app shell: root public files, `app/index.html`, `app/js/main.js`.
- Server routes: extracted from `server/src/index.ts`.
- Headless Edge local browser smoke against `http://127.0.0.1:5190/app/`
  at 1440x1000 and 375x812.
- Runtime evidence reused from local first real run:
  `run-evidence/first-real-run-20260714-153002`.
- Authenticated nav: 17 visible module destinations mounted in local browser
  sweep from the previous run.

### Problems Verified

- Q-0001: safe instant chat failed completely when Local GLM/Ollama was
  unreachable.
- Q-0002: owner-run tenant separation passed, but DB-auth non-member isolation
  remains unproven in browser.
- Q-0003: mobile QA remains a real gap.
- Q-0004: internal send adapter is not implemented/enabled.
- Q-0005: public product clarity needs a full audit.
- Q-0008: desktop sidebar grouping had regressed into one long stream instead
  of a clear top business section and bottom operations/settings section.

### Problems Fixed

- Q-0001: added a bounded local instant fallback for harmless short prompts.
- Q-0008: restored the desktop/sidebar structural split by rendering separate
  `side-nav-main` and `side-nav-utility` groups and pinning the utility group
  near the bottom.

### Tests Added

- `server/scripts/test-instant-chat-fallback.ts`
- Root script: `npm run test:instant-chat-fallback`
- Server workspace script: `npm run test:instant-chat-fallback --workspace @phantomforce/server`

### Commands Run

- `npm run test:instant-chat-fallback`
- `npm run test:customization-ui`
- `node --check app\js\main.js; node --check app\js\customization.js`
- `git diff --check`
- `npm run typecheck`
- `npm run build`
- `npm run test:intent`
- Headless Edge CDP smoke at 1440x1000 and 375x812 against local server
  `127.0.0.1:5190`.
- `rg -n "phantom-live-20260714-254" app\index.html app\js app\phantom.css`
  to confirm the app shell was cache-busted to build `255`.
- Codex heartbeat automation created: `continue-phantomforce-quality-program`.

### Results

- PASS: instant chat fallback route returns `local_fallback` without provider
  or network execution for a safe casual prompt when local Ollama is unavailable.
- PASS: customization/navigation smoke test still passes after the split
  sidebar renderer.
- PASS: JS syntax checks for touched navigation modules.
- PASS: whitespace/diff check.
- PASS: root typecheck and production build.
- PASS: intent-router test.
- PASS: headless Edge desktop shows build `phantom-live-20260714-255`, two
  sidebar groups, top business labels, bottom operations/settings labels, bottom
  group 15px from sidebar bottom, and no horizontal overflow.
- PASS: headless Edge 375px mobile sanity shows sidebar hidden, mobile bottom
  nav visible, build `phantom-live-20260714-255`, and no horizontal overflow.
- PASS: recurring same-thread continuation is scheduled as
  `continue-phantomforce-quality-program`.
- No `lint` script is currently exposed by `npm run`.

### Remaining P0/P1

- No P0 verified in this cycle.
- P1: DB-auth org isolation browser proof is still required.
- P1: mobile layout/scaling proof is still required.

### Next Task

Run the DB-auth organization isolation browser pass. If this environment cannot
stand up safe database-auth fixtures, immediately switch to formalizing the
responsive viewport harness from the headless Edge smoke and sweep the required
320, 375, 768, 1024, 1440, and 1920px widths.
