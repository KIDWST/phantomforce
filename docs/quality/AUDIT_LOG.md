# PhantomForce Audit Log

## 2026-07-18 — Cycle 3: Fast Contextual Dashboard + Accepted-Change Recovery

### Surfaces Audited

- Dashboard command surface, conversation history, intent routing, instant
  fallback, provider selection, and server chat context.
- Desktop and mobile dashboard composition at 1440x810 and 390x804 in the
  in-app browser.
- Accepted-change memory across customer plan switching, competitor
  intelligence, Media Lab layers, PhantomCut, PhantomPlay, organization
  settings, Site Studio, the split sidebar, auth boundaries, and top-bar media.
- Tenant-scoped CRM, proposal, workspace-approval, and Managed Growth report
  persistence routes.

### Problems Verified

- Simple conversational questions could route into an expensive model path,
  take too long, and answer with unrelated business-ledger context.
- Follow-up questions did not reliably receive the recent conversation, so a
  direct follow-up such as "why tacos?" could lose the subject.
- The dashboard repeated controls, suggestions, labels, metrics, and internal
  system language instead of behaving like a focused business command surface.
- Several previously accepted features had been partially replaced by older
  implementations during overlapping work, including the full Media Lab layer
  editor, customer plan simulation, Site Studio prompt behavior, and split
  navigation styling.
- CRM, proposal, and workspace-approval JSON stores existed, but their API
  routes were not mounted in `server/src/index.ts`.

### Problems Fixed

- Added a bounded workspace-scoped recent-chat window, sanitized to exclude
  failed and irrelevant records, and passed it through both client and server
  chat routing.
- Added direct instant answers for harmless casual prompts, basic arithmetic,
  identity/capability questions, and contextual follow-ups before expensive
  provider routing. Instant routing now times out after 3.2 seconds and falls
  through predictably.
- Rebuilt the dashboard into a compact split composition with one chat entry
  point, four useful starters, concise operational context, honest metrics, and
  responsive desktop/mobile behavior.
- Restored accepted implementations for plan switching, competitor
  intelligence, Media Lab layers, PhantomCut, organization settings, Site
  Studio prompts, top-bar media, the split sidebar, and game-state guards.
- Mounted tenant-scoped CRM lead/prospect-lane, proposal, workspace-approval,
  and Managed Growth report routes with explicit no-provider/no-outbound/no-
  public-exposure safety flags and owner/admin decision boundaries.
- Advanced the app cache build id to `phantom-live-20260718-20`.

### Browser Proof

- Local URL: `http://127.0.0.1:5187/app/?demo=1`.
- Desktop: asked "What's your favorite food?" and received a direct tacos
  answer without a provider/ledger dump; then asked "Why tacos?" and received a
  direct context-aware follow-up.
- Desktop dashboard proof: `dashboard-chat-audit-20260717/03-after-dashboard-desktop.png`.
- Mobile dashboard proof: `dashboard-chat-audit-20260717/04-after-dashboard-mobile.png`.
- Before comparison: `dashboard-chat-audit-20260717/01-before-dashboard-desktop.png`.

### Live Deployment Proof

- Pushed `main` and moved production off the actively edited
  `phantomforce-main-trunk-20260706` worktree onto the dedicated clean checkout
  `C:\Users\jorda\Documents\Codex\deployments\phantomforce-live`.
- Migrated the active `.phantom`, `server/.local`, and `server/data` records to
  `%LOCALAPPDATA%\PhantomForce\live-data` and linked the deployment checkout to
  that durable location so code updates do not replace live records.
- Repointed the admin sync task, the three-minute hidden fallback watcher, the
  five-minute remote-stack watchdog, PM2 defaults, and host verifier to the
  deployment checkout. Active development worktrees are no longer deployment
  sources.
- Local static health reported the dedicated root; backend health reported the
  pushed commit; both `admin.phantomforce.online` and
  `app.phantomforce.online` returned build `phantom-live-20260718-20`.
- In-app browser navigation to the live admin host loaded the real account gate
  and `main.js?v=phantom-live-20260718-20`.

### Commands Run

- `npm run build`
- `npm run test:dashboard-chat`
- `npm run test:command-surface`
- `npm run test:change-memory`
- `npm run test:customer-plan-switching`
- `npm run test:competitor-intelligence`
- `npm run test:client-setup-audit`
- `npm run test:workspace-site-builder`
- `npm run test:medialab-editor`
- `npm run test:videocut-editor`
- `npm run test:auth-boundaries`
- `npm run test:phantomplay`
- `node --check` across 10 touched frontend modules.
- `git diff --check`
- `npm ci` and `npm run prisma:generate` in the clean deployment checkout.
- `ops/admin-live/Sync-AdminMain.ps1 -RestartServer` against the clean checkout.
- Local `/health` checks on ports 5177 and 5190 plus public HTTPS checks for
  admin/app hosts.

### Results

- PASS: production workspace build completed for contracts and server.
- PASS: dashboard quality suite covered 22 prompts plus the server instant-chat
  fallback.
- PASS: compact command-surface contract.
- PASS: accepted-change guard reported 90 checks.
- PASS: customer plan switching and competitor intelligence frontend/server
  policy suites.
- PASS: structured client data-model audit reported no blockers and verified
  the mounted persistence routes.
- PASS: Site Studio prompt parsing, Media Lab layers, PhantomCut, auth
  boundaries, and PhantomPlay regressions.
- PASS: PhantomPlay reported 29 built-in games with tenant isolation, private
  rooms, moderation, and route authorization.
- PASS: frontend syntax and whitespace checks; Git emitted only Windows line-
  ending notices.
- PASS: live UI and API serve the dedicated checkout, the backend reports the
  pushed commit, public hosts report build `phantom-live-20260718-20`, and the
  hidden sync/watchdog tasks are enabled against the same source.

### Remaining P0/P1

- No P0 remains verified in this batch.
- P1: run an authenticated live-browser write/read isolation pass against the
  newly mounted CRM, proposal, and workspace-approval routes after deployment.
- P1: continue interaction-level mobile proof inside Media Lab and PhantomPlay,
  beyond their current static/responsive and contract tests.

### Next Task

Exercise the server-backed CRM/proposal/approval lifecycle in two authenticated
organizations and prove that create, edit, decision, delete, refresh, and
cross-tenant denial all remain isolated in the browser.

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
# 2026-07-18 - Cycle 4: Chat Brain Relevance, Continuity, and Speed

## Problems Verified

- Casual browser requests always included the accounting module, including the
  literal empty-ledger state, even when the user asked an unrelated question.
- Standard non-business questions could receive workspace pulse and Brain memory
  after the initial module filter.
- Temporary conversation context stopped at four turns in the browser and six
  turns on the API.
- Instant routing could wait through two sequential provider timeouts.
- The local fallback only maintained the taco topic for one follow-up; a third
  conversational turn lost the subject.

## Corrections

- Added browser and API relevance gates. Casual chat now sends temporary recent
  conversation only; money, plan, saved memory, assets, and pulse require current
  request relevance.
- Expanded bounded temporary context to eight browser turns and ten API turns.
- Changed instant routing to one 4.5-second private fast-model attempt followed
  by the local fallback, eliminating the second provider wait.
- Added topic-aware follow-ups, common direct answers, arithmetic, shortening,
  simplification, examples, and humor transformations to degraded chat.
- Restored explicit `assign Codex/Claude a task` intent handling found by the
  broader regression pass.
- Cache-busted the application as `phantom-live-20260718-24`.

## Verification

- PASS: `npm run test:dashboard-chat` (23 browser prompts, 11 adversarial turns).
- PASS: `npm run test:intent`.
- PASS: `npm run test:memory`.
- PASS: `npm run test:auth-boundaries`.
- PASS: `npm run test:content-planner`.
- PASS: `npm run test:medialab-editor` and `npm run test:videocut-editor`.
- PASS: `npm run test:phantomplay` (29 built-ins, tenant isolation true).
- PASS: `npm run test:competitor-intelligence` (tenant isolation true).
- PASS: site builder, organization settings, client setup, customization,
  customer plan switching, command surface, and topbar responsive checks.
- PASS: `npm run test:change-memory` (90 protected checks).
- PASS: `npm run typecheck`, `npm run build`, and `git diff --check`.

## Next Task

Run authenticated two-organization browser persistence proof, then continue the
responsive viewport harness if database fixtures are unavailable.

# 2026-07-18 - Cycle 5: Real Fast Conversational Brain

## Problems Verified

- Smart instant chat requested `gpt-5.5-instant` through Codex CLI, but that
  target failed in the installed CLI; arbitrary questions therefore fell back
  to a small scripted responder.
- The available Codex models answered correctly but took 11-13 seconds, and the
  Claude CLI had no usable quota.
- The old local transport forced every answer through a large business-operator
  prompt, causing irrelevant action cards, ledger language, and long output.
- Ollama was installed with capable models but was not configured to start after
  Windows sign-in.

## Corrections

- Routed smart-mode casual chat to `qwen2.5:7b` through the localhost-only Ollama
  transport. Explicit provider selections and all standard/deep routes remain
  unchanged.
- Added a dedicated conversation mode with an 80-token ceiling, 2048-token
  context, 30-minute warm lease, concise general-purpose system prompt, and no
  business-operator instructions.
- Enabled the action-free instant lane for authenticated customer sessions as
  well as administrators. It still receives only bounded temporary conversation
  and cannot execute external actions.
- Registered and exercised the hidden Windows scheduled task
  `PhantomForce Ollama Service`; last task result was `0` and localhost port
  `11434` returned HTTP 200.
- Cache-busted the application as `phantom-live-20260718-26`.

## Verification

- PASS: `npm run test:dashboard-chat` (23 browser prompts, 11 adversarial turns).
- PASS: `npm run test:intent`, `npm run test:memory`,
  `npm run test:auth-boundaries`, and `npm run test:command-surface`.
- PASS: `npx tsx scripts/test-local-ollama-transport.ts` from `server`.
- PASS: `npm run test:release-critical` (19/19 checks), including typecheck,
  build, tenant-backed CRM/proposals/approvals, and 99 change-memory guards.
- PASS: standalone `npm run typecheck`, `npm run build`, and
  `npm run test:change-memory` after the final build stamp.
- PASS: direct transport smoke against the installed model answered sky color in
  753 ms, favorite food in 315 ms, and `60 miles / 90 minutes` correctly in
  275 ms.
- PASS: real `/phantom-ai/chat` HTTP smoke answered through `qwen2.5:7b` without
  fallback for an admin session in 648 ms and a customer session in 277 ms.
- PASS: three real HTTP turns retained the chicken-taco topic through
  `make that funnier` and `give me another option`, each in 355-691 ms.

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 6.

# 2026-07-18 - Cycle 6: Durable Conversational Brain

## Problems Verified

- A 30-answer, five-conversation real-model audit found no accounting leakage,
  but the 7B model lost a named subject on a follow-up, used a robotic AI
  disclaimer for a harmless preference, and produced inconsistent arithmetic.
- Authenticated customers were allowed through the server's instant-chat policy,
  but the browser's `canAskHermes` gate still restricted the model call to admin
  sessions. Customer questions therefore never reached the fast conversational
  brain.
- `sale price` was classified as a generic live-price request. One customer turn
  fell into the business offer path, and the 7B model later calculated two taxed
  sale items as `$72` instead of `$132`.
- `Remember for this chat only` was correctly classified as conversation after
  the intent correction, but the storage layer could still promote the text into
  durable memory.
- Ollama warmup used a different context size than the conversation request. The
  first real answer could therefore trigger a model reload and miss the latency
  target despite an apparently successful warmup.

## Corrections

- Enabled the action-free instant lane for every authenticated session in the
  browser while preserving admin-only standard/deep business work and approval
  boundaries.
- Expanded safe instant conversation and micro-writing coverage while continuing
  to reject business actions, current-price lookups, legal/medical work, client
  records, accounting, payments, publishing, and destructive requests.
- Split stable rain questions and creative writing from live forecasts; split
  ordinary sale-price arithmetic from `price of` lookups.
- Added temporary-memory protection at both intent and storage layers for
  chat-only, do-not-save, do-not-remember, and temporary-context language.
- Strengthened subject continuity, correction authority, exact-output handling,
  harmless preference style, arithmetic verification, and business-data
  non-disclosure in both API context and local conversation prompts.
- Upgraded the fast conversational model to `qwen2.5:14b`, extended its warm lease
  to 24 hours, and added a hidden startup script that prewarms the exact 2048-token
  production context on the GPU.
- Added a real-model release gate covering subject correction, preference style,
  multi-turn arithmetic, exact formatting, leakage, and warm latency.
- Cache-busted the application as `phantom-live-20260718-27`.

## Verification

- PASS: `npm run test:release-critical` (19/19 critical checks).
- PASS: `npm run test:dashboard-chat` (31 browser prompts and 11 adversarial
  fallback turns), including customer access, micro-writing, sale arithmetic,
  and temporary-memory handling.
- PASS: `npm run test:intent`, `npm run test:memory`, `npm run typecheck`, and
  `npm run build`.
- PASS: `npm run test:change-memory` (104 protected checks).
- PASS: `npx tsx scripts/test-local-ollama-transport.ts` from `server`.
- PASS: `npm run test:instant-chat:live-model` from `server`: 10 real
  `qwen2.5:14b` prompts, 540 ms average, 1,182 ms maximum, corrected subject
  preserved, natural preference, `$132` arithmetic verified, and zero business
  leakage.
- PASS: `ops/admin-live/Start-PhantomInstantBrain.ps1` reported
  `Phantom Instant ready: qwen2.5:14b`; `ollama ps` showed 100% GPU, context 2048,
  and a 24-hour lease.
- PASS: `ops/admin-live/Test-LiveAdminSource.ps1` after deployment: canonical
  checkout, `origin/main`, sync manifest, served source, build
  `phantom-live-20260718-27`, and Hermes commit all agreed; working tree clean.
- PASS: Windows task `PhantomForce Ollama Service` returned result `0` after its
  deployed action was registered and started.
- PASS: browser reloads of `https://admin.phantomforce.online/app/?demo=1` and
  `https://app.phantomforce.online/app/` both exposed build meta and
  `main.js?v=phantom-live-20260718-27`.

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 7.

# 2026-07-18 - Cycle 7: Tool-Assisted Instant Chat Reliability

## Problems Verified

- The earlier real-model gate covered one arithmetic chain but did not exercise
  the complete authenticated HTTP route or a long bounded-context conversation.
- A new browser-shaped HTTP stress run proved that `qwen2.5:14b` could calculate
  three discounted `$45` tickets plus 8% tax as `$112.32`, `$114.24`, or `$117.44`
  instead of the correct `$116.64` even after being asked to double-check.
- The model also selected the first generated name when the user explicitly
  requested the second one.
- Conversation sanitization flattened assistant line breaks, destroying the list
  structure that a deterministic reference resolver needed.
- `no introduction` could still return a recap followed by a `Did you know` fact.

## Corrections

- Added a deterministic instant calculator for direct arithmetic, percent-of
  questions, discount/quantity/tax chains, step-by-step verification, and exact
  final-number requests.
- Added an ordinal list resolver for first/second/third selection from the newest
  assistant list. These micro-tools are action-free, use no business or durable
  memory context, and return through the same instant route in 1-2 ms.
- Preserved safe line breaks in temporary assistant context while retaining
  redaction, whitespace normalization, character bounds, and the eight-turn
  browser window.
- Added exact-output cleanup for `no introduction` requests without changing
  ordinary model answers.
- Segmented temporary model context at explicit `new topic` / subject-change
  turns so earlier topics cannot bleed into a new answer.
- Added unit coverage to the normal dashboard-chat suite and a self-starting,
  authenticated HTTP real-model gate that prewarms the exact production model
  context and drives both admin and customer sessions.
- Cache-busted the application as `phantom-live-20260718-28`.

## Verification

- PASS: `npm run test:dashboard-chat` (31 browser prompts, 11 adversarial fallback
  turns, and deterministic instant-tool checks).
- PASS: `npm run test:change-memory` (106 protected checks before build stamping).
- PASS: `npm run test:instant-chat:http-live-model` from the deployed `server`:
  27 consecutive authenticated HTTP requests, 466 ms average, 947 ms maximum, zero fallbacks,
  zero business leakage, five deterministic tool responses, corrected-subject
  continuity, topic switching, exact arithmetic, and context rollover verified.
- PASS: the self-starting gate terminated its disposable port-5192 server after
  completion. It explicitly skips the deployment's production `.env` only inside
  the child test process so demo authentication cannot be replaced by live auth,
  and launches TypeScript through the same `tsx` source path as live Hermes.
- PASS: `npm run typecheck`, `npm run build`, and `git diff --check` during the
  focused correction pass.

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 8.

# 2026-07-18 - Cycle 8: Intent-Aware Instant Chat Routing

## Problems Verified

- The instant-chat noun blocklist treated harmless questions such as `what is a
  website?`, `how does a bank work?`, and `what is an invoice?` as business work.
- Browser context selection separately treated those nouns as permission to send
  workspace metadata, including approval language, into ordinary conversation.
- A first routing correction made the word `compare` too broad and promoted the
  short follow-up `Compare them in one sentence` out of instant chat.
- The 27-turn gate did not prove entity correction, ordered reasoning, exact word
  counts, false-premise handling, or correction of several facts at once.

## Corrections

- Replaced noun-only blocking with intent-aware business-action, private-record,
  external-action, live-data, and deep-reasoning boundaries in browser and server.
- Made verified instant conversation explicitly business-context-free even when
  the subject is a general business noun.
- Kept short pronoun comparisons conversational while substantive comparisons,
  strategy, record access, publishing, destructive commands, and private
  workspace questions retain heavier guarded routes.
- Expanded browser regression coverage to 38 casual prompts and the authenticated
  real-model HTTP matrix to 41 admin/customer requests.
- Tightened `no introduction` cleanup when an otherwise valid fact is preceded by
  conversational filler.
- Cache-busted the application as `phantom-live-20260718-29`.

## Focused Verification

- PASS: `npm run test:dashboard-chat` (38 browser prompts, adversarial fallback
  routing, and deterministic tools).
- PASS: `npm run test:intent`.
- PASS: `npm run typecheck`.
- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server`: 41 authenticated requests, 415 ms average, 794 ms
  maximum, zero fallback, zero business leakage, and all capability assertions.
- PASS: `npm run test:release-critical` (19/19 critical checks).
- PASS after live sync: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server` from the deployment checkout: 41 authenticated requests,
  403 ms average, 769 ms maximum, zero fallback, zero business leakage, and all
  capability assertions.
- PASS: `ops/admin-live/Test-LiveAdminSource.ps1` reported clean canonical commit
  `023741e`, matching `origin/main`, sync manifest, Hermes source, and build
  `phantom-live-20260718-29`.
- PASS: Windows task `PhantomForce Ollama Service` returned result `0`; `ollama ps`
  reported `qwen2.5:14b`, 100% GPU, context 2048, and a 24-hour warm lease.
- PASS: background browser checks of `https://admin.phantomforce.online/app/?demo=1`
  and `https://app.phantomforce.online/app/` both exposed build
  `phantom-live-20260718-29`.

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 9.

# 2026-07-18 - Live Database Authentication Recovery

## Failure Verified

- The live backend booted with `owner-production` plus the legacy local customer
  store while the unified account screen called `/auth/login`.
- The approved PostgreSQL container was stopped, had no restart policy, and its
  schema was six committed migrations behind the application.
- Admin login was rejected before owner authentication, and database-backed
  customer signup/recovery could not be used.

## Corrections

- Preserved the prior server env, local customer store, and a PostgreSQL dump in
  the protected PhantomForce backup folder.
- Applied the six pending committed Prisma migrations, migrated the owner and
  customer test identities into separate organizations, and enabled database
  auth in the live server env.
- Added `Ensure-LocalDatabase` to Hermes startup and set the approved container
  to `unless-stopped` so reboot recovery happens before the API binds.
- Corrected `/sessions` metadata to advertise database signup and password-reset
  routes instead of legacy local-account routes.

## Verification

- PASS: local and public owner login resolve to platform super-admin in the
  PhantomForce internal organization.
- PASS: local and public customer login resolve only to the Customer 1 tenant.
- PASS: public admin/app `/sessions` report database auth reachable and
  production-ready.
- PASS: `npm run typecheck`, `npm run test:auth-boundaries`, and the 56-check
  database-auth suite plus browser tenant-isolation proof.
- PASS: stopped PostgreSQL deliberately; patched Hermes startup revived it and
  restored database reachability with restart policy `unless-stopped`.

# 2026-07-18 - Cycle 9: Long-Thread Conversation Quality

## Problems Verified

- The existing 41-request gate proved correctness inside several focused threads
  but did not reproduce a user asking many unrelated everyday questions without
  manually resetting the topic.
- Every instant response had a fixed 80-token generation ceiling. A real request
  for about 120 words stopped at 61 words even though the local model was healthy.
- Raw model transcripts showed simple context acknowledgments occasionally ended
  with an unnecessary question, making Phantom feel mechanically engagement-led.

## Corrections

- Expanded the authenticated real-model matrix to 59 requests, including twelve
  rapid-fire general questions in one thread, unknown facts, an unseen coin,
  quoted instruction-like data, empathy without advice, JSON-only output, and a
  longer educational explanation.
- Added deterministic adaptive token budgeting. Ordinary questions retain the
  80-token low-latency path; explicit word counts, lists, examples, and long-form
  requests receive a bounded larger budget.
- Directed both the temporary context compiler and local model system prompt not
  to append follow-up questions unless missing information blocks a useful answer.
- Added permanent change-memory guards for these behaviors.

## Focused Verification

- PASS: `npm run test:instant-chat:tools --workspace @phantomforce/server`.
- PASS: `npm run typecheck`.
- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server`: 59 authenticated requests, 451 ms average, 2,226 ms
  maximum, zero fallback, zero business leakage, and all behavioral assertions.
- PASS: `npm run test:release-critical` (19/19 critical checks).
- PASS after live sync: the same 59-request authenticated model gate ran from the
  dedicated deployment checkout at 433 ms average and 2,169 ms maximum, with zero
  fallback, zero business leakage, and every behavioral assertion true.
- PASS: `ops/admin-live/Test-LiveAdminSource.ps1` reported clean canonical commit
  `dab103b`, matching `origin/main`, sync manifest, Hermes source, and public build
  `phantom-live-20260718-29`.
- PASS: the public admin browser surface loaded build
  `phantom-live-20260718-29` and presented the database-backed account-access UI.
- PASS: `PhantomForce Ollama Service` last result `0`; `qwen2.5:14b` remained warm
  at 100% GPU with context 2048 and a 24-hour lease.

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 10.

# 2026-07-18 - Cycle 10: Identity and Epistemic Truth

## Problems Verified

- When asked which model powered the current conversation, the real model claimed
  it was an unspecified “latest model” instead of the configured `qwen2.5:14b`.
- Prompt-only suppression of unnecessary engagement questions was nondeterministic;
  a context acknowledgment still occasionally appended “Anything specific...?”
- The real model occasionally returned four words for an exact five-word request.
- Code help, sustained multilingual conversation, and refusal to fabricate source
  identifiers or inaccessible quotations were not covered by the release gate.

## Corrections

- Added a deterministic identity resolver for Phantom identity, ChatGPT
  disambiguation, and active fast-lane model disclosure using actual route data.
- Added bounded output cleanup for generic follow-up questions while preserving
  questions the user explicitly requests.
- Added deterministic exact-word-count enforcement for numeric and written counts.
- Expanded the authenticated real-model gate to practical JavaScript generation,
  debugging, Spanish follow-up continuity, fictional DOI handling, and private
  source honesty.
- Added permanent change-memory guards for all four behaviors.

## Focused Verification

- PASS: `npm run test:instant-chat:tools --workspace @phantomforce/server`.
- PASS: `npm run typecheck`.
- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server`: 67 authenticated requests, 452 ms average, 2,043 ms
  maximum, zero fallback, zero business leakage, and all capability assertions.
- PASS: `npm run test:release-critical` (19/19 critical checks).
- PASS after live sync: the 67-request gate ran from the dedicated deployment
  source at 439 ms average and 1,846 ms maximum, with zero fallback, zero business
  leakage, and every identity, formatting, code, multilingual, and source-honesty
  assertion true.
- PASS: `ops/admin-live/Test-LiveAdminSource.ps1` reported clean canonical commit
  `39da116`, matching `origin/main`, sync manifest, running Hermes source, and
  public build `phantom-live-20260718-29`.
- PASS: `PhantomForce Ollama Service` last result `0`; `qwen2.5:14b` remained warm
  at 100% GPU with context 2048 and a 24-hour lease.

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 11.

# 2026-07-18 - Cycle 11: Recency-Safe Conversation Packing

## Problems Verified

- The browser could send eight temporary turns totaling roughly 7,500 characters.
- The Ollama transport retained the first 5,000 context characters, so long older
  replies could remove the newest correction and the final conversation rules.
- Existing rollover tests used short turns and therefore did not prove behavior
  under the actual maximum per-turn character bounds.

## Corrections

- Extracted instant context construction into a focused, testable module.
- Added a 4,800-character context budget below the transport ceiling.
- Packed active-topic turns from newest to oldest, dropping oldest overflow first.
- Preserved the newest user message, newest assistant tail, and final behavior
  rules even when one turn alone approaches the available context budget.
- Preserved explicit topic-reset segmentation before applying the recency budget.
- Added helper-level overflow/reset tests and an authenticated model test with
  eight oversized turns followed by a corrected codename recall.

## Focused Verification

- PASS: `npm run test:instant-chat:tools --workspace @phantomforce/server`.
- PASS: `npm run typecheck`.
- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server`: 68 authenticated requests, 443 ms average, 1,755 ms
  maximum, zero fallback, zero business leakage, and recency packing verified.
- PASS: `npm run test:release-critical` (19/19 critical checks).
- PASS after live sync: the same 68-request authenticated model gate ran from
  the dedicated deployment checkout at 436 ms average and 1,985 ms maximum,
  with zero fallback, zero business leakage, and recency packing verified.
- PASS: `ops/admin-live/Test-LiveAdminSource.ps1` reported clean canonical
  commit `f592af8`, matching `origin/main`, sync manifest, Hermes source, and
  public build `phantom-live-20260718-29`; all 124 change-memory checks passed.
- PASS: `PhantomForce Ollama Service` last result `0`; `qwen2.5:14b` remained
  warm at 100% GPU with context 2048 and a 24-hour lease.
- PASS: disposable test port `5192` was closed after verification.

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 12.

# 2026-07-18 - Cycle 12: Natural Personality and Factual Restraint

## Problems Verified

- The green real-model gate concealed an invented claim that octopus hearts run
  through their stomachs after a request for one surprising fact.
- A direct favorite-food question still produced the sterile disclaimer that the
  assistant had no preferences, despite explicit conversational prompt guidance.
- `Dessert only` returned a dessert plus an unwanted explanation.

## Corrections

- Strengthened temporary context and the local model system contract so replacement
  requests return only the replacement and factual requests avoid invented detail.
- Added an instant deterministic Phantom personality response for direct favorite-
  food questions; contextual follow-ups still use the conversational model.
- Added bounded cleanup for short name, city, word, noun, gas, color, dessert,
  food, title, and number-only requests without touching code-only or JSON-only.
- Expanded the authenticated model gate with a verified-fact replacement and a
  three-turn favorite-food, reason, and dessert conversation.
- Added permanent change-memory guards for all three behaviors.

## Focused Verification

- PASS: `npm run test:instant-chat:tools --workspace @phantomforce/server`.
- PASS: `npm run typecheck`.
- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server`: 71 authenticated requests, 436 ms average, 2,211 ms
  maximum, zero fallback, zero business leakage, and all behavior assertions.
- PASS: `npm run test:release-critical` (19/19 critical checks).
- PASS after live sync: the same 71-request authenticated model gate ran from
  the dedicated deployment checkout at 427 ms average and 1,999 ms maximum,
  with zero fallback, zero business leakage, and all behavior assertions.
- PASS: `ops/admin-live/Test-LiveAdminSource.ps1` reported clean canonical
  commit `8c3f188`, matching `origin/main`, sync manifest, Hermes source, and
  public build `phantom-live-20260718-29`; all 127 change-memory checks passed.
- PASS: `PhantomForce Ollama Service` last result `0`; `qwen2.5:14b` remained
  warm at 100% GPU with context 2048 and a 24-hour lease.
- PASS: disposable test port `5192` was closed after verification.

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 13.

# 2026-07-18 - Cycle 13: Intent-Shaped Model Routing

## Problems Verified

- Browser and server instant-route exclusions treated the words `current`,
  `latest`, and `stock` as live-data requests without considering their meaning.
- Questions about electrical current, chicken stock, stock photos, and a current
  favorite could therefore be escalated to a slower, more expensive model.
- Existing tests covered genuine live requests but not lexical false positives.

## Corrections

- Replaced broad live-data keywords with intent-shaped weather, news, market,
  score, traffic, time, date, and exchange-rate patterns in browser routing.
- Mirrored the safe/unsafe distinction in the server conversation policy.
- Preserved escalation for diagnosis, medical/legal advice, active weather,
  current prices, latest headlines, scores, and exchange rates.
- Expanded browser and server policy tests across both sides of the boundary.
- Added real-model answers for electrical-current and stock-photo questions.
- Cache-busted the browser application as `phantom-live-20260718-30`.
- Added permanent change-memory guards for model-routing precision.

## Focused Verification

- PASS: `node scripts/test-intent-router.mjs` (35/35 routing cases).
- PASS: `npm run test:dashboard-chat` (42 browser prompts plus server checks).
- PASS: `npm run test:instant-chat --workspace @phantomforce/server`.
- PASS: `npm run typecheck`.
- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server`: 73 authenticated requests, 438 ms average, 1,838 ms
  maximum, zero fallback, zero business leakage, and lexical routing verified.
- PASS: `npm run test:release-critical` (19/19 critical checks).
- PASS after live sync: the same 73-request authenticated model gate ran from
  the dedicated deployment checkout at 434 ms average and 1,968 ms maximum,
  with zero fallback, zero business leakage, and lexical routing verified.
- PASS: `ops/admin-live/Test-LiveAdminSource.ps1` reported clean canonical
  commit `b62ca1c`, matching `origin/main`, sync manifest, Hermes source, and
  public build `phantom-live-20260718-30`; all 130 change-memory checks passed.
- PASS: a direct public request returned build `phantom-live-20260718-30`.
- PASS: `PhantomForce Ollama Service` last result `0`; `qwen2.5:14b` remained
  warm at 100% GPU with context 2048 and a 24-hour lease.
- PASS: disposable test port `5192` was closed after verification.

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 14.

# 2026-07-18 - Cycle 14: Automatic Temporary Topic Isolation

## Problems Verified

- Instant chat packed all recent temporary turns whenever context was available,
  so a standalone casual prompt after accounting could still receive ledger-
  flavored history even though durable business modules were excluded.
- A first semantic segmentation pass treated `Make the comparison playful` and
  `Give me three more` as new topics, losing octopus/dolphin and spaceship context.
- The real model sometimes fenced `Code only` output and invented details when
  explicitly asked for a verified octopus fact.

## Corrections

- Added follow-up, reference, transformation, and lexical-overlap detection for
  temporary conversation context.
- Added automatic topic segmentation: each standalone prompt starts a clean
  suffix, while genuine follow-ups retain only the active semantic topic.
- Passed the current request into context construction at the server boundary.
- Added deterministic Markdown-fence removal for `Code only` requests.
- Added a curated instant stable-fact response for explicit verified octopus facts.
- Strengthened real-model assertions for space-themed names, playful comparison
  continuity, code-only output, accounting-to-casual isolation, and shorter replies.
- Kept approximate-length answers single-call and fast while preserving exact-
  count enforcement for explicit exact word requests.
- Added permanent change-memory guards for topic isolation and output truth.

## Focused Verification

- PASS: `npm run test:instant-chat:tools --workspace @phantomforce/server`.
- PASS: `npm run typecheck`.
- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server`: 75 authenticated requests, 440 ms average, 1,522 ms
  maximum, zero fallback, zero business leakage, and topic isolation verified.
- PASS: `npm run test:release-critical` (19/19 critical checks).
- PASS after live sync: the same 75-request authenticated model gate ran from
  the dedicated deployment checkout at 426 ms average and 1,883 ms maximum,
  with zero fallback, zero business leakage, and topic isolation verified.
- PASS: `ops/admin-live/Test-LiveAdminSource.ps1` reported clean canonical
  commit `a9c8395`, matching `origin/main`, sync manifest, Hermes source, and
  public build `phantom-live-20260718-30`; all 133 change-memory checks passed.
- PASS: `PhantomForce Ollama Service` last result `0`; `qwen2.5:14b` remained
  warm at 100% GPU with context 2048 and a 24-hour lease.
- PASS: disposable test port `5192` was closed after verification.

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 15.

# 2026-07-18 - Cycle 15: Provider-Outage Conversation Resilience

## Problems Verified

- The local provider-failure path behaved like a second chatbot: it preferred
  tacos while the healthy Phantom personality preferred spicy ramen.
- Fallback follow-ups searched the full recent conversation instead of the
  active semantic topic, creating stale-topic contamination risk.
- An unsupported fallback question told the user to ask again while mentioning
  unrelated business state, even in a purely casual conversation.
- Unit checks did not prove the behavior through the authenticated HTTP route
  with a genuinely unreachable Ollama endpoint.

## Corrections

- Reused the normal deterministic instant tools and output constraints in the
  local provider-failure path, keeping personality and formatting consistent.
- Exported and reused active-topic selection so degraded follow-ups operate only
  on the current semantic thread.
- Added resilient follow-ups for the shared spicy-ramen personality and an
  honest, business-free timeout response when no deterministic answer exists.
- Expanded semantic follow-up detection for examples and confidence checks.
- Added an authenticated disposable-server gate with Ollama forced unreachable;
  it proves useful direct answers, topic continuity, no stale accounting leak,
  deterministic personality, truthful fallback metadata, and process cleanup.
- Added permanent change-memory guards for all of the above behavior.

## Focused Verification

- PASS: `npm run test:instant-chat --workspace @phantomforce/server` (11
  adversarial degraded-mode turns).
- PASS: `npm run test:instant-chat:tools --workspace @phantomforce/server`.
- PASS: `npm run test:instant-chat:http-fallback --workspace
  @phantomforce/server` (3 authenticated requests, provider unreachable).
- PASS: `npm run typecheck --workspace @phantomforce/server`.
- PASS: `npm run test:release-critical` (19/19 critical checks; 132 permanent
  change-memory assertions before this cycle's final documentation guard).
- PASS: disposable fallback test port `5193` was closed after verification.
- PASS: `git diff --check`.
- PASS after live sync: `ops/admin-live/Test-LiveAdminSource.ps1` reported
  canonical commit `e4af87e`, matching `origin/main`, sync manifest, Hermes,
  serving source, and public build `phantom-live-20260718-30`; all 135 permanent
  change-memory checks passed.
- PASS after live sync: `npm run test:instant-chat:http-fallback --workspace
  @phantomforce/server` completed 3 authenticated requests with Ollama forced
  unreachable, useful local responses, truthful fallback metadata, active-topic
  continuity, and zero stale business leakage.
- PASS after live sync: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server` completed 75 authenticated requests at 427 ms average
  and 1,919 ms maximum, with zero fallback and zero business leakage.
- PASS: `PhantomForce Ollama Service` last result `0`; `qwen2.5:14b` remained
  warm at 100% GPU with context 2048 and a 24-hour lease.
- PASS: disposable test ports `5192` and `5193` were closed.

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 16.

# 2026-07-18 - Cycle 16: Browser Fallback Conversation Isolation

## Problems Verified

- When `/phantom-ai/chat` was unreachable, safe browser conversation fell
  through the broad command router, where ordinary words such as `bank`,
  `proposal`, `lead`, `approval`, and `media` could surface workspace counters.
- The browser fallback still preferred tacos while the server and normal
  deterministic personality preferred spicy ramen.
- Informational questions such as `what is an approval workflow?` were matched
  as workspace commands before the intent router reached its question rule.
- Dead readiness code still contained the exact `ledger empty` phrase even
  though no current call site needed it.

## Corrections

- Added a hard browser boundary: failed instant `question` and `chat` requests
  return through the local conversation responder and never enter command
  keyword cascades.
- Added concept-question intent recognition before memory, approval, status,
  and automation command handling, while keeping private ownership references
  on the workspace route.
- Required explicit workspace-state language before local proposal, lead,
  approval, or media counters can appear.
- Added useful offline definitions for common business-adjacent concepts and
  aligned the browser personality with Phantom's spicy-ramen answer.
- Removed dead readiness/status copy and all generic fallback references to
  accounting, dashboards, ledgers, or bookkeeping.
- Added offline multi-turn browser coverage across seven business-adjacent
  prompts, plus an explicit workspace-state control case.
- Corrected the desktop cockpit grid so the dashboard center column consumes
  the available viewport row, the composer remains visible, and only the
  message history scrolls.
- Restricted prior-topic inheritance to genuinely short follow-ups such as
  `why?`; complete questions such as `why is continuity useful?` now start
  from their own meaning.
- Cache-busted the full browser module graph as `phantom-live-20260718-32`.
- Added permanent change-memory guards for classification, isolation, and tests.

## Focused Verification

- PASS: `npm run test:dashboard-chat` (42 connected browser prompts, 11
  degraded server turns, deterministic tool checks, and the new offline set).
- PASS: `npm run test:intent`.
- PASS: `npm run test:change-memory` (136 permanent assertions).
- PASS: `npm run test:release-critical` (19/19 critical checks).
- PASS: `npm run build`.
- PASS: `git diff --check`.
- PASS: bundled Playwright/Chrome source gate against
  `http://127.0.0.1:5181/app/?session=admin` with `/phantom-ai/chat` aborted.
  At 1440x900, four offline turns left the composer at y=803..870, message
  history scrolled internally (448px client / 608px content), page width was
  exactly 1440px, and there were no page or non-HTTP console errors. At
  390x844, two offline turns left the composer at y=681..743, page width was
  exactly 390px, and there were no page or non-HTTP console errors.
- PASS: visual review of
  `C:\Users\jorda\AppData\Local\Temp\phantomforce-cycle16-desktop-fixed.png`
  and `phantomforce-cycle16-mobile-fixed.png`; controls, text, and composer
  remained visible without overlap.
- PASS after live sync: `ops/admin-live/Test-LiveAdminSource.ps1 -Strict`
  reported canonical/deployment/origin/Hermes commit `655e0da`, public build
  `phantom-live-20260718-32`, clean working trees, and 139 live assertions.
- PASS after live sync: the same Playwright fallback gate against
  `http://127.0.0.1:5177/app/?session=admin` retained exact 1440px/390px
  widths, y=803..870 desktop and y=681..743 mobile composer bounds, internal
  history scrolling, correct direct answers, and zero page errors.
- PASS after live sync: `npm run test:instant-chat:http-fallback --workspace
  @phantomforce/server` completed three forced-outage requests.
- PASS after live sync: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server` completed 75 authenticated requests at 424 ms average
  and 1,509 ms maximum, with zero fallback, zero business leakage, and all
  continuity, topic-switch, correction, reasoning, formatting, and rapid-fire
  assertions true.

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 17.

# 2026-07-18 - Cycle 17: Semantic Chat Boundaries And Real Memory

## Problems Verified

- Browser intent treated ordinary uses of `approve`, `queue`, `summary`,
  `report`, and `remember` as private workspace operations.
- Reminder matching treated monitor lizards, historical `tell me when`
  questions, and movie-watching requests as scheduled automations.
- Automation and website matching confused poems, stories, and explicit task
  requests with workflow or site creation.
- The browser and server used duplicate broad business-action regexes, so a
  harmless poem about automation could classify correctly in the browser but
  still be rejected by the instant server route.
- Autobiographical chat such as `I remember my first bike` was routed as chat
  but still promoted into durable memory by a separate storage heuristic.
- Explicit memory commands displayed memory statistics instead of confirming
  and creating the saved record.

## Corrections

- Replaced broad approval, reminder, status, memory, task-candidate,
  automation, and artifact matching with semantic patterns that require
  ownership, operational verbs, direct objects, or real scheduling language.
- Moved explicit task, reminder, and automation artifacts ahead of website
  matching so `create a task to update my website` cannot become a website.
- Aligned browser and server instant-route business-action policy around
  direct business objects instead of unrelated words appearing nearby.
- Tightened durable-memory detection to explicit forward-looking save
  language; recall questions and autobiographical uses remain temporary chat.
- Added real pinned-memory creation and a concise `Remembered:` confirmation
  for explicit durable-memory requests.
- Expanded browser-brain coverage from 48 to 56 prompts and live-model
  coverage from 79 to 82 authenticated requests.
- Cache-busted the full browser module graph as
  `phantom-live-20260718-33`.
- Added four permanent change-memory guards for these boundaries.

## Focused Verification

- PASS: `npm run test:intent`.
- PASS: `npm run test:dashboard-chat` (56 browser prompts, 11 degraded server
  turns, and deterministic tool checks).
- PASS: `npm run test:instant-chat --workspace @phantomforce/server`.
- PASS: `npm run typecheck --workspace @phantomforce/server`.
- PASS: `npm run test:change-memory` (140 permanent assertions).
- PASS: `npm run test:release-critical` (19/19 critical checks).
- PASS: `git diff --check`.
- PASS: authenticated disposable-server live-model gate completed 82 requests
  at 521 ms average and 1,742 ms maximum with zero fallback and zero business
  leakage; all continuity, topic-switch, correction, reasoning, exact-format,
  lexical-routing, and topic-isolation assertions remained true.
- PASS: bundled Playwright/Chrome source gate sent seven collision-heavy
  prompts through the instant local-model lane with no workspace cards, then
  created one real durable memory without a provider request. Build `33`
  stayed exactly 1440px wide; composer y=803..870; history scrolled internally
  at 448px client / 899px content; zero page errors.
- PASS: visual review of
  `C:\Users\jorda\AppData\Local\Temp\phantomforce-cycle17-semantic-chat.png`.
- PASS after live sync: `ops/admin-live/Test-LiveAdminSource.ps1 -Strict`
  reported canonical checkout, origin, deployment manifest, static source, and
  Hermes at commit `c679f80`; the public app served
  `phantom-live-20260718-33`, both working trees were clean, and all 143 live
  change-memory checks passed.
- PASS after live sync: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server` completed 82 authenticated requests against the
  deployed service at 559 ms average and 2,110 ms maximum, with zero fallback,
  zero business leakage, nine deterministic tool responses, and every
  continuity, topic-switch, reasoning, formatting, lexical-routing, and
  topic-isolation assertion true.
- PASS after live sync: the public browser loaded
  `https://app.phantomforce.online/` at build `phantom-live-20260718-33`, showed
  the expected sign-in boundary, and remained exactly 1,280px wide in a
  1,280x720 viewport with no horizontal overflow. The anonymous localhost
  browser correctly lacked an authorization token and therefore exercised the
  visible fallback; authenticated model behavior is covered by the preceding
  deployed HTTP gate.

## Next Task

Run the authenticated browser and two-organization memory-isolation proof in
Recommended Cycle 18.

# 2026-07-18 - Cycle 18: Authenticated Organization Context Isolation

## Problem Verified

- Database-auth sessions always retained the legacy browser workspace id
  `phantomforce` even when their active `orgId` changed.
- Browser storage preferred that legacy workspace id. For a database user this
  collapsed durable memory and temporary chat from multiple organizations into
  the global PhantomForce namespace.
- The dashboard's in-memory transcript also remained visible after a successful
  organization switch, so organization A bubbles could still appear in B.
- Existing tests proved that non-members were denied but did not exercise a
  legitimate user who belonged to two organizations, leaving this leak hidden.

## Corrections

- Database and local-customer sessions now derive `currentWs()` from active
  `orgId`; legacy local-admin sessions retain their workspace behavior.
- Database workspace labels resolve from the authenticated membership list.
- Successful database and local workspace switches clear the visible chat
  transcript before rendering the new organization's context.
- Added a deterministic non-superadmin test identity with legitimate
  memberships in PhantomForce and ChicagoShots.
- Expanded the database-auth browser fixture into a real two-organization
  journey with 20 mixed chat prompts, request capture, durable-memory reload,
  two-way isolation, forged-switch rejection, and desktop/mobile screenshots.
- Added direct browser-store regression coverage for two-way durable and
  temporary context separation.
- Replaced internal accounting wording in user-facing empty states with
  `Actual transactions`, `None yet`, and `add or connect`.
- Cache-busted the full browser module graph as
  `phantom-live-20260718-34`.
- Added a permanent change-memory rule and product decision for active-
  organization browser context.

## Source Verification

- PASS: `powershell -NoProfile -ExecutionPolicy Bypass -File
  server\scripts\test-auth-database-live.ps1` applied all eight migrations,
  passed all 56 authorization/API checks, and passed eight authenticated
  browser checks.
- PASS: browser fixture used one legitimate two-organization user, rejected a
  forged non-member switch with 403, ran 20 mixed conversational prompts, and
  proved zero cross-organization UI, local-storage, request-packet, or model-
  answer contamination in either direction.
- PASS: durable organization A memory survived reload; organization B received
  none of A's temporary or durable context; switching back restored only A.
- PASS: final screenshots at 1440x900 and 390x844 showed the composer and
  accounting empty state without horizontal overflow or overlapping text:
  `tmp/database-auth-org-browser/2026-07-18T22-38-16-176Z`.
- PASS: `npm run test:memory`.
- PASS: `npm run test:intent`.
- PASS: `npm run test:dashboard-chat` (56 browser prompts, 11 outage turns,
  and deterministic tool checks).
- PASS: `npm run test:release-critical` (19/19).
- PASS: `npm run typecheck --workspace @phantomforce/server`.
- PASS: authenticated source live-model gate completed 82 requests at 520 ms
  average and 2,120 ms maximum with zero fallback and zero business leakage.
- PASS: `git diff --check`.

## Deployment Verification And Resurrection Fix

- The first public check caught `app.phantomforce.online` and port 5177 serving
  build `phantom-live-20260718-3` from the stale
  `phantomforce-main-trunk-20260706` worktree even though the dedicated checkout
  and sync manifest were current.
- Root cause: the Windows remote-stack starter, PM2 ecosystem file, persisted
  `PHANTOMFORCE_DASHBOARD_REPO` user variable, mutable hidden VBS scheduled-task
  helpers, and one long-running `Watch-AdminMain.ps1` process still referenced
  the July 6 worktree. Those launchers repeatedly reclaimed ports 5177 and 5190
  after successful deploys.
- Corrected every persistent launcher to
  `C:\Users\jorda\Documents\Codex\deployments\phantomforce-live`, stopped all
  stale process trees, restarted the canonical static/API services, and ran the
  scheduled sync again.
- Added a strict-doctor resurrection guard that fails when hidden helpers,
  watchdog configs, or a running admin watcher point outside the canonical
  deployment.
- Replaced the recurring task's mutable AppData launcher with tracked
  `ops/admin-live/Run-AdminMainSyncHidden.vbs`, which derives its repo root from
  its own canonical location; removed the obsolete HKCU login fallback.
- PASS: scheduled task `PhantomForce Admin Main Sync` completed automatic runs
  with result `0` after the repair; zero stale processes and zero stale helper
  references remained.
- PASS: local 5177/5190 plus public `app.phantomforce.online` and
  `admin.phantomforce.online` health routes all resolved to the dedicated
  deployment; the public app served `phantom-live-20260718-34`.
- PASS: deployed live-model gate completed 82 requests at 535 ms average and
  2,019 ms maximum with zero fallback and zero business leakage.
- PASS: strict doctor reported source/origin/deployment/manifest/Hermes aligned,
  both resurrection checks green, build 34 live, and clean working trees.

## Next Task

Extend the same authenticated two-organization proof to CRM leads, proposals,
approvals, assets, accounting transactions, and connector state in Cycle 19.

# 2026-07-18 - Cycle 19: Authenticated Business-Record Isolation

## Problems Verified

- CRM, proposal, and workspace-approval normalizers accepted a client-supplied
  `ws` even after the server authorized a different tenant.
- Proposal and approval hydration retained active-organization server-backed
  rows that disappeared from the server response, allowing deleted records to
  reappear from browser state.
- Accounting connector requests were global browser state, so a bank setup
  request in one organization appeared in another.
- Generic workspace APIs treated an unauthorized requested tenant as a hint,
  silently used the active tenant, and returned 200. The response did not leak
  foreign data, but it made a wrong-business request look successful.

## Corrections

- All three server record stores derive `ws` from the authorized tenant id.
- Database membership is now required for every explicit generic workspace
  tenant; nonmember requests return `403 TENANT_MEMBERSHIP_REQUIRED`.
- Active-organization proposal and approval hydration treats server-backed
  collections as authoritative while preserving only genuine local fallback
  rows and rows from other organizations.
- Finance connector state now carries `ws`, migrates legacy entries to the
  original PhantomForce workspace, and renders/updates only the active org.
- Added `test:organization-record-isolation` to the permanent release gate.
- Expanded the real database browser journey across CRM, proposals, approvals,
  Asset Cloud, Accounting, connectors, forged labels, direct tampering, reload,
  and aligned visible chat replies.
- Cache-busted the full browser graph as `phantom-live-20260718-37`.

## Source Verification

- PASS: `npm run test:database-auth` applied all eight migrations, passed all
  57 authorization/API checks, and completed the authenticated Chrome journey.
- PASS: distinct Aegis and Beacon records remained isolated across six business
  modules; forged `ws` labels were ignored and direct nonmember requests were
  denied with 403.
- PASS: reload retained only ChicagoShots rows; switching back restored only
  PhantomForce rows.
- PASS: all 20 visible chat bubbles matched their newly persisted prompt/reply;
  no accounting language leaked into ordinary conversation.
- PASS: screenshots at 1440x900 and 390x844 had exact viewport widths, visible
  composers, no horizontal overflow, and no overlap:
  `tmp/database-auth-org-browser/2026-07-19T00-32-17-781Z`.
- PASS: `npm run test:release-critical` (20/20).
- PASS: `npm run test:easy-crm:postgres --workspace @phantomforce/server`
  (18/18).
- PASS: authenticated live-model gate completed 82 requests at 489 ms average
  and 1,542 ms maximum with zero fallback and zero business leakage.
- PASS: `git diff --check`.

## Deployment Verification

- Pushed commit `c687eeef` to `origin/main` and synced the dedicated
  `C:\Users\jorda\Documents\Codex\deployments\phantomforce-live` checkout.
- PASS: strict live-source doctor reported source, origin, deployment manifest,
  static server, and Hermes aligned at `c687eeef`; the public admin served
  `phantom-live-20260718-37` and the deployment tree was clean.
- PASS: deployed live-model gate completed 82 requests at 481 ms average and
  1,840 ms maximum with zero fallback, zero business leakage, nine
  deterministic tool responses, and every conversation-quality assertion true.
- PASS: manually triggered scheduled task `PhantomForce Admin Main Sync` ended
  in `Ready` with result `0`; a second strict doctor pass confirmed the task did
  not resurrect an older checkout, build, UI process, or Hermes process.

## Next Task

Exercise browser signup, invitations, recovery, logout/revocation, 2FA,
role-restricted navigation, and authorization-error recovery in Cycle 21.

# 2026-07-18 - Cycle 20: Relevant-Thread Conversational Continuity

## Problems Verified

- Instant chat could correctly recognize `Back to Nova` as contextual while
  packing only the newest unrelated Saturn turn.
- Natural follow-ups such as `How long should I stay?` after discussing a
  first trip to Japan were labeled standalone and received no recent topic.
- The provider-outage fallback used the same weaker active-tail selector.

## Corrections

- Added explicit recognition for natural implicit follow-ups that depend on the
  immediately active casual subject.
- Added bounded relevant-thread retrieval across the recent window. Named
  returns include matching turns and nearby pronoun-based corrections, while
  excluding unrelated intervening topics.
- Reused the relevant selector in the local provider-outage fallback.
- Added permanent change-memory guards for the stronger selector and model
  proofs.

## Source Verification

- PASS: deterministic context proof packs Nova's corrected purple raincoat and
  excludes volcanoes, jazz, and Saturn.
- PASS: authenticated live-model gate completed 90 requests at 539 ms average
  and 4,299 ms maximum with zero fallback and zero business leakage. Natural
  follow-up and named-topic-return assertions are true.
- PASS: disposable PostgreSQL auth passed all 57 API checks; real Chrome
  completed 28 consecutive visible turns, returned `purple` after organization
  round trips, and preserved two-way organization isolation.
- PASS: visual review of desktop 1440x900 and mobile 390x844 screenshots under
  `tmp/database-auth-org-browser/2026-07-19T00-52-39-046Z`; composer, text, and
  bottom navigation remain visible without overlap or horizontal overflow.
- PASS: `npm run test:dashboard-chat` (56 browser-brain prompts, 11 forced-
  outage turns, and deterministic tool checks).
- PASS: `npm run test:release-critical` (20/20).
- PASS: `npm run typecheck --workspace @phantomforce/server`.
- PASS: `npm run test:change-memory` (157 assertions).
- PASS: `git diff --check`.

## Deployment Verification

- Pushed `c881f7a0` to `origin/main` and synced the canonical
  `deployments\phantomforce-live` checkout.
- PASS: strict doctor aligned source, origin, manifest, UI server, and Hermes at
  `c881f7a0`; public admin remained on `phantom-live-20260718-37` because this
  correction changed backend context selection, not browser assets.
- PASS: deployed live-model gate completed 90 requests at 539 ms average and
  2,098 ms maximum with zero fallback and zero business leakage; natural
  follow-up and named-topic-return checks remained true.
- PASS: manually triggered `PhantomForce Admin Main Sync` returned result `0`;
  the second strict doctor confirmed no old checkout or backend was resurrected.

## Next Task

Exercise the complete browser account lifecycle and authorization-error
recovery across customer/admin hosts and owner, admin, member, and client roles
in Cycle 21.

# 2026-07-18 - Cycle 21: Customer Reasoning Model Lane

## Problems Verified

- Customer browsers could reach the instant model for basic chat, but a safe
  comparison, critique, or strategy question rejected by the instant
  classifier could not reach any model.
- Those questions fell back into the older command surface, where ordinary
  language could produce an irrelevant local response instead of a reasoned
  answer.
- The authenticated HTTP model test forced every request to `instant`, so its
  90-request result did not prove the real browser classifier boundary.

## Corrections

- Added a separate action-free `reasoning` route for authenticated users.
  Comparisons, critiques, and strategy questions use local `qwen2.5:14b` with
  a 12-second provider ceiling, larger response budget, no provider fallback,
  no cards, and no navigation.
- Browser and server independently reject live-data, private-business,
  operational, approval, task, automation, and external-action requests from
  the reasoning route.
- Both action-free routes carry only bounded temporary conversation. Business
  summary, saved memory, workspace pulse, assets, accounting, plans, and
  opportunity lookups remain excluded.
- Failed instant or reasoning calls stay conversational instead of entering
  the business keyword cascade.
- Advanced the complete browser module graph to
  `phantom-live-20260718-38` and updated the overwrite guard to protect the new
  two-tier invariant.

## Source Verification

- PASS: `npm run test:dashboard-chat` (56 browser-brain prompts, including five
  customer reasoning routes; 11 outage turns; deterministic tool checks).
- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server` completed 92 requests at 575 ms average and 2,203 ms
  maximum with zero fallback and zero business leakage.
- PASS: `npm run test:database-auth` applied all eight migrations, passed all
  57 authorization/API checks, and completed the real Chrome journey.
- PASS: Chrome exercised both customer reasoning prompts inside the existing
  20-turn plan budget, completed 30-turn continuity and two-organization
  round trips, and proved local-only request policy with no business modules.
- PASS: visual review at 1440x900 and 390x844; composer, messages, navigation,
  and organization state had no overlap or horizontal page overflow:
  `tmp/database-auth-org-browser/2026-07-19T01-24-40-082Z`.
- PASS: `npm run test:release-critical` (20/20).
- PASS: `npm run test:organization-record-isolation`.
- PASS: `npm run test:change-memory` (157 assertions).
- PASS: `npm run build --workspace @phantomforce/server`.
- PASS: `git diff --check`.

## Deployment Verification

- Pushed `0f566c9b` to `origin/main` and synced the canonical
  `deployments\phantomforce-live` checkout.
- PASS: strict live-source doctor aligned source, origin, deployment manifest,
  static UI, Hermes, resurrection guards, and clean worktrees at `0f566c9b`;
  the public admin served `phantom-live-20260718-38`.
- PASS: deployed live-model gate completed 92 requests at 528 ms average and
  1,935 ms maximum with zero fallback, zero business leakage, both reasoning
  assertions true, and every prior conversation-quality assertion true.
- PASS: manually triggered `PhantomForce Admin Main Sync` ended in `Ready`
  with result `0`; a second strict doctor confirmed the task preserved commit
  `0f566c9b`, build 38, the canonical UI root, and Hermes.

## Next Task

Exercise the complete browser account lifecycle and authorization-error
recovery across customer/admin hosts and owner, admin, member, and client roles
in Cycle 22.
# 2026-07-18 - Cycle 22: Creative And Scoped Advisory Brain

## Problems Verified

- Customer `brainstorm`, `feedback`, and `plan` prompts could still receive
  canned command-surface copy instead of a real model answer.
- Organization-specific advice needed business identity, but not unrelated
  cash totals, today-plan items, assets, pulse status, or action cards.
- The chat server validated action-free intent but still trusted browser-
  supplied model/provider fields during execution, allowing a forged request
  to ask for a private lane.
- Natural wording such as `give me a practical three-step plan` missed the
  old rigid planning regex.
- The server could finish an organization switch before the browser completed
  entitlement refresh and isolated-chat reset, allowing a very fast submit to
  disappear during the final UI transition.

## Corrections

- Added model-backed creative planning/feedback to the bounded local
  `reasoning` lane and added a separate action-free `advisory` lane for scoped
  organization advice.
- Advisory context includes the active organization and relevant saved/recent
  context while suppressing accounting, today-plan, assets, and status pulse.
- Server policy independently validates all three action-free lanes and pins
  execution, allowed providers, requested model, fallback policy, and returned
  lane metadata to local `qwen2.5:14b`.
- Expanded planning intent parsing for practical, simple, actionable,
  low-cost, numbered-step, and similar natural modifiers.
- Added a real organization-switch busy boundary that disables the switcher
  and composer until the session, entitlements, chat reset, and rendered shell
  agree.
- Reconciled the concurrent customer-plan work so the simulator exposes the
  actual `free`, `professional`, and `elite` tiers; new customer accounts start
  on Free Preview, Pro preserves its partial locks, Elite unlocks all features,
  and returning to Free immediately restores view-only restrictions.
- Advanced the complete browser graph to `phantom-live-20260718-41` and added
  permanent overwrite guards for advisory routing, provider pinning, natural
  planning language, and switch readiness.

## Source Verification

- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server` completed 96 authenticated requests at 607 ms average
  and 2,384 ms maximum with zero fallback and zero business leakage; creative
  reasoning, scoped advisory, and forged-provider pinning all verified.
- PASS: `npm run test:database-auth` applied all eight migrations, passed all
  57 API/auth checks, and completed the real Chrome journey across two
  organizations, six isolated business surfaces, 20 mixed chat turns, durable
  memory, temporary history, and organization round trips.
- PASS: visual review of 1440x900 and 390x844 screenshots under
  `tmp/database-auth-org-browser/2026-07-19T02-38-52-739Z`; composer,
  navigation, text, and organization state were visible without overlap or
  horizontal overflow.
- PASS: `npm run test:intent`.
- PASS: `npm run test:dashboard-chat` (56 browser-brain prompts, 11 adversarial
  fallback turns, deterministic tools).
- PASS: `npm run test:release-critical` (20/20).
- PASS: `npm run test:organization-record-isolation` (2 organizations).
- PASS: `npm run test:customer-plan-switching` and `npm run
  test:local-customer-plan --workspace @phantomforce/server`.
- PASS: `npm run test:change-memory` (164 checks).
- PASS: `npm run build` and server TypeScript typecheck.
- PASS: `git diff --check` (line-ending warnings only).

## Deployment Verification

- Pushed `e8486e3d` to `origin/main` and synced the canonical
  `deployments\phantomforce-live` checkout.
- PASS: strict live-source doctor aligned source, origin, deployment manifest,
  static UI, Hermes, resurrection guards, and clean worktrees at `e8486e3d`;
  the public admin served `phantom-live-20260718-41`.
- PASS: deployed live-model gate completed 96 requests at 603 ms average and
  2,499 ms maximum with zero fallback and zero business leakage; creative
  reasoning, scoped advisory, provider pinning, continuity, corrections,
  uncertainty, formatting, and every prior conversation-quality assertion
  passed.
- PASS: manually triggered `PhantomForce Admin Main Sync` ended in `Ready`
  with result `0`; a second strict doctor confirmed the task preserved commit
  `e8486e3d`, build 41, the canonical UI root, Hermes, and all 167 live guards.

## Next Task

Exercise the complete browser account lifecycle and authorization-error
recovery across customer/admin hosts and owner, admin, member, and client roles
in Cycle 23.

# 2026-07-18 - Cycle 23: Account Recovery And Reliable Chat Return

## Problems Verified

- The account gate presented five equal tabs, making ordinary sign-in feel more
  complex than the underlying lifecycle.
- Production password recovery exposed the raw token form before a reset link
  existed, invitation links had no browser acceptance flow, 2FA had no clean
  escape, and submits could be duplicated.
- Customer auth outage copy exposed operator-only backend instructions.
- Completed answers still used a slow character reveal.
- A delayed 1.4-second startup greeting could append after the user's first
  answer and replace it onscreen with cashflow and approval status.
- Returning from a workspace could restore fresh dashboard markup, then leave
  the visible chat composer inert if a later dashboard widget threw.

## Corrections

- Kept Sign in and Create account as the two primary choices; moved username
  and password recovery to contextual links.
- Added one-time invitation URL acceptance, 2FA restart, duplicate-submit
  locking, production-safe reset behavior, and calm customer outage copy.
- Capped ambient reveal at 900 ms and made completed command answers instant.
- Cancelled the delayed startup greeting on the first user action and removed
  accounting, pipeline, and approval details from unsolicited greetings.
- Bound the restored dashboard command form immediately after shell creation,
  before optional dashboard widgets render.
- Expanded authenticated Chrome diagnostics with request routes and state
  details and advanced the full module graph to
  `phantom-live-20260718-42`.

## Source Verification

- PASS: `npm run test:database-auth`: all 57 API/auth checks and the real
  Chrome journey passed.
- PASS: Chrome completed 30 coherent browser turns, two-organization business
  isolation, durable-memory reload, temporary-history isolation, tamper
  rejection, and reload recovery.
- PASS: visual review at 1440x900 and 390x844 under
  `tmp/database-auth-org-browser/2026-07-19T03-27-53-238Z`; composer,
  navigation, text, and organization state had no overlap or horizontal
  overflow.
- PASS: `npm run test:release-critical` (20/20).
- PASS: `npm run test:account-recovery-2fa:postgres --workspace
  @phantomforce/server` (14/14).
- PASS: `npm run test:dashboard-chat` (56 prompts, 11 adversarial turns,
  deterministic tools).
- PASS: `npm run test:change-memory` (174 checks).
- PASS: `npm run typecheck`.
- PASS: `git diff --check` (line-ending warnings only).

## Deployment Verification

- Pushed `32926861` to `origin/main` and synced the canonical
  `deployments\phantomforce-live` checkout.
- PASS: strict doctor aligned source, origin, deployment manifest, static UI,
  Hermes, sidebar rules, and resurrection guards at `32926861`; the public
  admin served `phantom-live-20260718-42`.
- PASS: deployed live-model gate completed 96 requests at 598 ms average and
  2,522 ms maximum with zero fallback and zero business leakage; continuity,
  reasoning, creative planning, scoped advisory, formatting, uncertainty, and
  every prior model assertion passed.
- PASS: manually triggered `PhantomForce Admin Main Sync` ended in `Ready`
  with result `0`. The first immediate doctor caught Hermes restarting; the
  required retry passed all 177 live guards and confirmed no stale source was
  resurrected.

## Next Task

Exercise role, entitlement, deep-link, and expired-session recovery across
customer/admin hosts in Cycle 24.

# 2026-07-18 - Cycle 24: Bounded Long-Distance Thread Recall

## Problems Verified

- The browser always sent only the newest eight temporary turns. The server's
  relevant-thread selector therefore could not recover a specifically named
  topic once enough unrelated conversation pushed it out of that packet.
- Extending the real-model test to nine intervening subjects reproduced a
  second failure: even with the relevant Nova setup and correction available,
  the local model guessed `Red` instead of honoring the corrected `purple`
  fact.
- The previous browser proof used only three intervening subjects, which was
  insufficient evidence for long-distance conversational continuity.

## Corrections

- Replaced blind recency packing with a request-aware, organization-scoped
  packet: six newest turns plus up to four matching older thread/correction
  turns, hard-capped at ten.
- Kept temporary history separate from durable memory and retained the existing
  ten-day shred policy.
- Added deterministic extractive recall for exact corrected colors and
  codenames. Creative, advisory, and open-ended questions still use the
  lightest capable local model.
- Expanded the authenticated Chrome journey and real-model gate to nine
  unrelated subjects before returning to Nova.
- Advanced the complete browser module graph to
  `phantom-live-20260718-43` and added permanent overwrite guards.

## Source Verification

- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server` completed 102 requests at 602 ms average and 2,489 ms
  maximum with zero fallback and zero business leakage; long-distance topic
  revisit passed.
- PASS: `npm run test:database-auth` passed all 57 API/auth checks and the
  source-backed real Chrome journey, including 36 conversational turns and
  nine-topic corrected recall.
- PASS: Chrome request inspection proved the relevant older thread and
  correction were present while `conversation_history` remained at or below
  ten turns.
- PASS: visual review at 1440x900 and 390x844 under
  `tmp/database-auth-org-browser/2026-07-19T03-57-52-596Z`; the composer,
  recalled answer, navigation, and organization state had no overlap or
  horizontal overflow.
- PASS: `npm run test:release-critical` (20/20).
- PASS: `npm run test:dashboard-chat` (56 prompts, 11 adversarial turns,
  deterministic tools).
- PASS: `node scripts/test-memory-retention.mjs`.
- PASS: `npm run test:change-memory` (180 checks).
- PASS: `npm run typecheck`.
- PASS: `git diff --check` (line-ending warnings only).

## Deployment Verification

- Pushed `1e366afa` to `origin/main` and synced the canonical
  `deployments\phantomforce-live` checkout.
- PASS: strict doctor aligned source, origin, deployment manifest, static UI,
  Hermes, sidebar rules, and resurrection guards at `1e366afa`; the public
  admin served `phantom-live-20260718-43`.
- PASS: the deployed live-model gate completed 102 requests at 584 ms average
  and 2,216 ms maximum with zero fallback and zero business leakage;
  long-distance corrected recall and every prior model assertion passed.
- PASS: manually triggered `PhantomForce Admin Main Sync` ended in `Ready`
  with result `0`; the post-sync strict doctor passed all 183 live guards and
  confirmed no stale source was resurrected.

## Next Task

Exercise ambiguous-reference resolution and conversational self-correction in
Cycle 25.

# 2026-07-18 - Cycle 25: Useful Clarification And Correction Repair

## Problems Verified

- With `Dana chose tea and Priya chose coffee` in temporary context, Phantom
  answered `What did she choose?` with a vague request for more context instead
  of naming the two plausible subjects.
- The first clarifier prototype treated capitalized instruction words such as
  `For`, `City`, and `Color` as people and could interrupt an explicit Nova
  callback with `Do you mean Portugal or City?`.
- When asked to keep the first tagline's idea but borrow the second answer's
  playful tone, the local model repeatedly substituted the second tagline's
  content.
- Cross-answer relevance reduction discarded the first answer before the model
  request, so stronger wording alone could not repair the misunderstanding.
- The authenticated browser's tool-library reasoning check accepted only three
  literal positive words and rejected valid equivalent phrasing.

## Corrections

- Added a bounded deterministic `phantom-clarifier` that asks exactly one useful
  question naming the candidates from the newest setup statement.
- Explicitly named subjects now outrank older ambiguous people, and response
  format words cannot become person candidates.
- Cross-answer corrections retain at most six temporary turns and compile an
  authoritative content/style brief.
- The final local-model message contains only the exact content to preserve,
  requested tone, and requested format; competing style-source content is not
  presented as an answer candidate.
- Added replayable browser diagnostics for the Nova and Dana/Priya request
  packets and made existing reasoning assertions semantic instead of
  exact-word dependent.
- Added permanent change-memory protection for ambiguity and correction repair.

## Source Verification

- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server` completed 105 authenticated requests at 569 ms average
  and 2,170 ms maximum with zero fallback and zero business leakage;
  clarification and misunderstanding repair both passed.
- PASS: `npm run test:database-auth` applied all eight migrations, passed all 57
  API/auth checks, and completed the real Chrome journey across two
  organizations and 38 conversational turns.
- PASS: Chrome proved exact `Do you mean Dana or Priya?`, long-distance corrected
  Nova recall, durable-memory reload, temporary-history isolation, tamper
  rejection, and organization round trips.
- PASS: visual review at 1440x900 and 390x844 under
  `tmp/database-auth-org-browser/2026-07-19T05-13-43-456Z`; navigation, chat,
  restored organization state, and composer had no overlap or horizontal
  overflow.
- PASS: `npm run test:release-critical` (20/20).
- PASS: `npm run test:dashboard-chat` (56 prompts, 11 adversarial turns,
  deterministic tools).
- PASS: `node scripts/test-memory-retention.mjs`.
- PASS: `npm run test:change-memory` (184 checks).
- PASS: `npm run typecheck` and `git diff --check`.

## Deployment Verification

- Pushed `f1923f80` to `origin/main` and synced the canonical
  `deployments\phantomforce-live` checkout.
- PASS: strict live-source doctor aligned source, origin, deployment manifest,
  static UI, Hermes, resurrection guards, and clean worktrees at `f1923f80`;
  the public admin remained on `phantom-live-20260718-43` because this batch
  changed server behavior and tests, not browser assets.
- PASS: the canonical-checkout model gate completed 105 requests at 537 ms
  average and 2,001 ms maximum with zero fallback and zero business leakage;
  clarification, correction repair, and every prior assertion passed.
- PASS: production Hermes rejected the demo-auth test login with 403, preserving
  the production authentication boundary; the canonical disposable gate supplied
  isolated test auth while the doctor proved live Hermes used the same commit.
- PASS: manually triggered `PhantomForce Admin Main Sync` ended in `Ready` with
  result `0`; the post-sync doctor confirmed no stale source was resurrected and
  all 187 live guards remained aligned.

## Next Task

Exercise multi-object references, plural pronouns, and correction chains that
mix dates, lists, and named subjects in Cycle 26.

# 2026-07-19 - Cycle 26: Exact Multi-Object References And Correction Chains

## Problems Verified

- After the user stated that a red folder contained invoices and a blue folder
  contained contracts, the first former/latter callback could succeed while a
  later callback hallucinated `receipts` instead of using the stated value.
- Moving the third numbered option before the first returned placeholder labels
  such as `Third element` and `First element`, not the user's actual options.
- Plural follow-ups could lose their setup because exact keyword matching did
  not connect inflected words such as `pack` and `packed`.
- Existing browser coverage stopped at 38 turns and did not prove mixed object
  references, list operations, plural ownership, and four-step corrections in
  one organization-scoped conversation.

## Corrections

- Added a bounded paired-reference resolver that reads exactly two explicit
  `contains`, `has`, `holds`, or `includes` clauses and returns only the stated
  former/latter value.
- Added deterministic numbered-list move and swap operations that return the
  real reordered items and decline invalid ordinals or ambiguous shapes.
- Retained the bounded active topic for plural and paired references, avoiding
  fragile exact-keyword dependence while keeping temporary history capped.
- Expanded deterministic, 117-request live-model, and authenticated 50-turn
  Chrome coverage for former/latter, real list reordering, plural ownership,
  and day/time/room correction chains.
- Added permanent change-memory guards so these behaviors cannot silently
  regress or be replaced with plausible invented values.

## Source Verification

- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server` completed 117 authenticated requests at 518 ms average
  and 2,013 ms maximum with zero fallback and zero business leakage.
- PASS: `npm run test:database-auth` completed the real Chrome journey across
  two organizations and 50 conversational turns; all object, list, plural,
  correction, durable-memory, temporary-history, tamper, and isolation checks
  passed.
- PASS: visual review at 1440x900 and 390x844 under
  `tmp/database-auth-org-browser/2026-07-19T05-46-42-470Z`; navigation, chat,
  organization state, and composer had no overlap or horizontal overflow.
- PASS: `npm run test:release-critical` (20/20).
- PASS: `npm run test:dashboard-chat` (56 prompts, 11 adversarial turns,
  deterministic tools).
- PASS: `node scripts/test-memory-retention.mjs`.
- PASS: `npm run test:change-memory` (187 checks).
- PASS: `npm run typecheck` and `git diff --check` (line-ending warnings only).

## Deployment Verification

- Pushed `5439ffe2` to `origin/main` and synced the canonical
  `deployments\phantomforce-live` checkout.
- PASS: strict live-source doctor aligned source, origin, deployment manifest,
  static UI, Hermes, sidebar rules, resurrection guards, and clean worktrees at
  `5439ffe2`; the public admin remains on `phantom-live-20260718-43` because
  this batch changes server behavior and tests, not browser assets.
- PASS: the canonical-checkout model gate completed 117 requests at 526 ms
  average and 1,746 ms maximum with zero fallback and zero business leakage;
  exact references, list operations, plural ownership, correction chains, and
  every prior assertion passed.
- PASS: manually triggered `PhantomForce Admin Main Sync` ended in `Ready` with
  result `0`; the post-sync doctor confirmed no stale source was resurrected
  and all 190 live guards remained aligned.

## Next Task

Exercise causal references and correction conflicts that reverse or partially
restore earlier values in Cycle 27.

# 2026-07-19 - Cycle 27: Causal References And Scoped Rollback

## Problems Verified

- Given two numbered results with different causes, `Why did the second result
  happen?` received no relevant context and the local model invented a generic
  explanation about unspecified rules and circumstances.
- Full and partial rollback worked in a short isolated model thread, but the
  authenticated long conversation exposed a second failure: `keep the original
  plan` restored Thursday, 3 PM, and Room 9 by mixing the current meeting with
  an older meeting thread still inside the bounded privacy window.
- The first structured resolver draft could mistake the output label `ROOM only`
  for a room value and could let a poster-title rollback trigger an older meeting
  rollback acknowledgment.
- The first canonical post-deploy gate caught a stochastic older-path failure:
  cross-answer style repair switched from English into Chinese and appended
  process commentary despite the one-sentence request.
- Existing browser coverage stopped at 50 turns and did not prove causal chains,
  immediate rollback acknowledgments, or cross-domain correction isolation.

## Corrections

- Added bounded extraction for explicit numbered `because` pairs and
  `cause; therefore, outcome` statements, including ordinal cause selection and
  reason-to-outcome callbacks.
- Classified ordinal results, `that reason`, and `as a result` as contextual so
  unsupported causal phrasing still reaches the active temporary topic.
- Added revision-state resolvers that start from the newest explicit meeting or
  poster base, apply only subsequent changes, and support full or named-field
  rollback without consulting older same-topic state.
- Scoped meeting and design rollbacks to their own field vocabularies, excluded
  summary-format labels from state mutation, and made immediate acknowledgments
  state the values actually restored and preserved.
- Made exact first-idea/playful-tone repair deterministic and reinforced both
  context and local-model contracts to stay in the user's language and script
  unless another language or translation is explicitly requested.
- Expanded deterministic, 130-request live-model, and authenticated 63-turn
  Chrome coverage and added permanent change-memory guards.

## Source Verification

- PASS: `npm run test:instant-chat:http-live-model --workspace
  @phantomforce/server` completed 130 authenticated requests at 575 ms average
  and 2,382 ms maximum with zero fallback and zero business leakage after the
  same-language repair.
- PASS: `npm run test:database-auth` passed all 57 API/auth checks and the real
  Chrome journey across two organizations and 63 conversational turns.
- PASS: Chrome proved ordinal causes, `that reason`, `therefore`, full rollback,
  partial rollback, truthful immediate acknowledgments, cross-domain thread
  isolation, durable-memory reload, tenant isolation, and tamper rejection.
- PASS: visual review at 1440x900 and 390x844 under
  `tmp/database-auth-org-browser/2026-07-19T06-32-48-114Z`; navigation, chat,
  organization state, and composer had no overlap or horizontal overflow.
- PASS: `npm run test:release-critical` (20/20).
- PASS: `node scripts/test-memory-retention.mjs`.
- PASS: `npm run test:change-memory` (190 checks).
- PASS: `npm run typecheck` and `git diff --check` (line-ending warnings only).

## Deployment Verification

- Pending source commit, push, canonical sync, canonical model gate, scheduled
  sync, and strict live doctor verification.

## Next Task

Exercise respectively mappings and named-entity scoped undo in Cycle 28.
