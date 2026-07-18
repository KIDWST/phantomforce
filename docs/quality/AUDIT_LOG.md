# PhantomForce Audit Log

## 2026-07-17 — Cycle 2: DB-Auth Organization Isolation + Browser Switcher Proof

### Surfaces Audited

- Required process docs: `AGENTS.md`, every file under `docs/quality/`,
  `docs/DATABASE_SETUP.md`, and `docs/ADMIN_RECOVERY.md`.
- Database-auth live fixture runner:
  `server/scripts/test-auth-database-live.ps1`.
- Database-auth API boundary probe:
  `server/scripts/test-database-auth.mjs`.
- Admin/customer shell auth and organization switching:
  `app/js/main.js`, `app/js/orgs.js`, and `app/js/store.js`.
- Full frontend ESM cache-bust graph under `app/index.html` and `app/js/*.js`.
- New browser proof harness:
  `scripts/test-database-auth-org-browser.mjs`.

### Problems Verified

- Q-0002: DB-auth API organization isolation had no browser proof even though
  org leakage is a real security/business risk.
- The disposable DB-auth live runner applied migrations but did not regenerate
  Prisma Client before building the server, causing stale-client TypeScript
  failures when schema enums/models changed.
- The top-bar business switcher used local demo workspaces for database-auth
  admins, which allowed the visible UI selector to drift away from the
  server-scoped active organization.
- Secondary app modules used mixed `?v=phantom-live-*` query strings, which
  created multiple ESM instances of `store.js`/`ctx` and could make auth/org
  state appear to update and then revert.
- Newer server-backed modules imported `friendlyBackendError`, but `store.js`
  did not export it, so the browser app could fail before the sign-in gate.

### Problems Fixed

- Added `npx prisma generate --schema server/prisma/schema.prisma` to the
  disposable DB-auth live runner before the server build.
- Added a DB-auth browser smoke harness that signs in as
  `owner@chicagoshots.local`, verifies the header switcher and profile menu
  only show `dev-org-chicagoshots`, confirms a direct cross-org switch to
  `dev-org-phantomforce` returns 403, and proves a tampered local selector
  cannot change the server active org.
- Changed the top-bar organization switcher to render from
  `ctx.session.memberships` for database-auth sessions and to route all DB
  organization changes through `/auth/switch-org`.
- Reused the same server-checked switch routine from the profile menu so the
  header and account menu cannot diverge.
- Normalized the app shell/module cache id to `phantom-live-20260717-5` across
  `app/index.html` and all `app/js/*.js` import URLs.
- Added `friendlyBackendError()` to `app/js/store.js`.

### Commands Run

- `docker --version; docker ps --format '{{.Names}} {{.Ports}}'`
- `powershell -NoProfile -ExecutionPolicy Bypass -File server\scripts\test-auth-database-live.ps1`
- `node --check app\js\store.js; node --check app\js\approvalpipeline.js; node --check app\js\main.js; node --check scripts\test-database-auth-org-browser.mjs`
- `Get-ChildItem app\js -Filter *.js | ForEach-Object { node --check $_.FullName ... }`
- `npm run test:organization-settings`
- `git diff --check`
- `npm run test:change-memory`

### Results

- PASS: disposable Postgres 16 fixture started and all 8 Prisma migrations
  applied.
- PASS: Prisma Client regenerated before server build.
- PASS: `npm run build --workspace @phantomforce/server` completed inside the
  live DB-auth runner.
- PASS: DB-auth API probe reported `ALL 40 PASS`, including non-member
  cross-org CRM/audit/entitlement/invite/switch denials, super-admin switching,
  invitation lifecycle, role boundaries, plan gates, suspended-org write block,
  and logout revocation.
- PASS: Chrome browser proof reported `ok: true` with report:
  `tmp/database-auth-org-browser/2026-07-17T15-33-25-314Z/report.json`.
- PASS: browser proof checked database login, ChicagoShots owner sign-in,
  header/profile switcher membership scoping, direct cross-org 403, and
  tampered-selector recovery back to `dev-org-chicagoshots`.
- PASS: `node --check` passed for every `app/js/*.js` file and the new browser
  proof script.
- PASS: `npm run test:organization-settings` reported "Organization Settings
  boundary checks passed."
- PASS: `git diff --check` exited 0. Git printed line-ending warnings for
  touched files, but no whitespace errors.
- FAIL, pre-existing backlog: `npm run test:change-memory` still reports 20
  missing/forbidden memory-guard patterns across the public-site starter,
  sidebar bottom zone, Kingdom Breakers, Phantom Rumble, Media Lab layer
  controls, and customer plan switching.

### Remaining P0/P1

- No P0 verified in this cycle.
- P1: customer plan switching is still listed by `test:change-memory` as
  missing backend/frontend coverage and matches the current app-user report
  that Free/Pro switching hangs.
- P1: competitor intelligence still needs live endpoint verification and
  graceful fallback proof for the user-reported 502.
- P1: game and Media Lab memories remain red in `test:change-memory`; handle
  them in focused batches rather than overwriting unrelated surfaces.

### Next Task

Resume with the customer-facing app failures: plan-tier switching first, then
competitor-intelligence 502 handling. Keep the new DB-auth live/browser command
as a regression check after any auth/org/session change.

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
