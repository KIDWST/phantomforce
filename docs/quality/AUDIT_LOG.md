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

## Next Task

Run the authenticated two-organization persistence proof in Recommended Cycle 14.
