# PhantomForce Quality Backlog

Last updated: 2026-07-18

## Verified Issues

### Q-0001 — P2 — Instant casual chat can fail when selected local provider is down

- Route/component: `/phantom-ai/chat`, instant admin route.
- Journey affected: user asks a harmless tiny question such as "What's your
  favorite food?"
- Reproduction: force `route_tier: "instant"`, `model_lane: "glm_5_2"`,
  `allowed_providers: ["local_ollama"]`, and point `OLLAMA_BASE_URL` at an
  unavailable local endpoint.
- Expected: harmless casual prompt still receives a fast local answer and does
  not invoke external actions.
- Actual before fix: returned "I couldn't complete that just now."
- Evidence: first real run report, `api-business-run.json`, call
  `chat.instant.basic-food-question`.
- Likely cause: instant route attempted only the selected provider and used the
  generic all-providers-failed copy when it failed.
- Correction: add bounded local instant fallback for safe casual prompts.
- Regression requirement: route-level test with unavailable local provider.
- Status: Fixed and verified in Cycle 1.

### Q-0008 — P2 — Desktop sidebar lost its top/bottom information architecture

- Route/component: `app/js/main.js` sidebar renderer and `app/phantom.css`
  sidebar layout.
- Journey affected: desktop Business Manager navigation.
- Reproduction: load local admin shell and inspect the sidebar; all nav entries
  render in one stream with only weak visual separation.
- Expected: primary business sections stay near the brand while memory,
  automations, approvals, workforce, intelligence, analytics, away mode,
  developer, and settings sit as a lower operations/settings group.
- Actual before fix: bottom-intended items were not structurally separated and
  could visually collapse into the same stream.
- Evidence: user report plus headless Edge smoke after fix proving two groups.
- Likely cause: `n.bottom` existed in data but `renderNav()` rendered one flat
  list and CSS relied on sibling selectors.
- Correction: render explicit `side-nav-main` and `side-nav-utility` groups;
  pin the utility group with flex layout; cache-bust app shell to build `255`.
- Regression requirement: customization/navigation smoke plus browser check for
  two groups and mobile sidebar-hidden behavior.
- Status: Fixed and verified in Cycle 1.

### Q-0009 — P1 — Phantom Rumble can boot into stale victory state

- Route/component: PhantomPlay V2, `app/games/phantom-rumble.html`,
  `/api/phantomplay/v2/resume/:gameId`.
- Journey affected: opening Phantom Rumble after a completed match.
- Reproduction: load Phantom Rumble with a saved/completed state available; the
  `VICTORY` overlay could appear over the mode menu before any new match.
- Expected: fresh game load shows the mode menu only; completed sessions stay
  in history/score records and are not treated as resumable state.
- Actual before fix: stale end overlay could remain visible on boot.
- Evidence: user screenshot and headless Edge CDP verification after fix.
- Likely cause: game startup relied on implicit hidden state, and the V2 resume
  endpoint returned latest state even for ended 100% sessions.
- Correction: explicit menu/start/end overlay state, server resume restricted
  to latest unfinished play, client-side resume guard, cache bump to Rumble
  `2.2.1`.
- Regression requirement: V2 resume test for completed sessions plus browser
  boot smoke proving `data-end` is hidden on load and after host restore.
- Status: Fixed and verified in Cycle 1B.

### Q-0010 — P2 — Penalty Kick was hidden from PhantomPlay catalog

- Route/component: `app/js/phantomplay.js`,
  `server/src/phantom-ai/phantomplay.ts`, PhantomPlay built-in catalog.
- Journey affected: users browsing PhantomPlay Sports or the ready strip could
  not launch the Penalty Kick game.
- Reproduction: run `npm run test:phantomplay`; the catalog assertion failed
  because Penalty Kick was not a featured Sports game in the server catalog,
  and the frontend row also had `active: false`.
- Expected: Penalty Kick remains an active, featured Sports game with launch
  URL `/app/games/penalty-kick.html?v=1.0.3`.
- Actual before fix: frontend catalog hid it with `active: false`; server
  catalog also marked it unfeatured/inactive.
- Evidence: `npm run test:phantomplay` failure on 2026-07-16 before the fix.
- Likely cause: catalog visibility flags regressed after recent PhantomPlay
  catalog/category changes.
- Correction: restore Penalty Kick to active featured status in both frontend
  and server catalogs; cache-bust the app shell to `phantom-live-20260716-1`.
- Regression requirement: `npm run test:phantomplay`.
- Status: Fixed and verified in the 2026-07-16 daily QA sweep.

### Q-0002 — P1 — Database-auth browser context leaked across organizations

- Route/component: authenticated organization switch, browser store, Memory,
  and dashboard chat.
- Journey affected: a legitimate user switches between PhantomForce and
  ChicagoShots.
- Reproduction before fix: sign in with memberships in both organizations,
  store temporary and durable context in organization A, then switch to B.
- Expected: browser storage, visible transcript, request context, and model
  answers use the active organization id and contain no A data in B.
- Actual before fix: database sessions retained `ws: "phantomforce"`; the
  browser store preferred that legacy workspace over `orgId`, and in-memory
  chat bubbles were not cleared during the switch.
- Correction: database and local-customer sessions derive `currentWs()` from
  the active `orgId`; organization switches clear the visible chat history;
  workspace labels resolve from database memberships.
- Evidence: disposable PostgreSQL fixture passed 56 authorization/API checks
  and eight browser checks, including a valid two-org switch, forged non-member
  rejection, two-way UI/storage/request/model isolation, reload persistence,
  20 mixed chat turns, and 1440x900 plus 390x844 viewport checks.
- Regression requirement: `powershell -NoProfile -ExecutionPolicy Bypass -File
  server\scripts\test-auth-database-live.ps1` and `npm run test:memory`.
- Status: Fixed and verified in Cycle 18.

### Q-0011 — P1 — Stale watchdog could overwrite a successful live deployment

- Route/component: Windows admin sync, remote-stack watchdog, ports 5177/5190.
- Journey affected: any newly pushed admin or customer-app correction.
- Reproduction before fix: sync the dedicated deployment, observe build 34,
  then wait for the hidden sync/watchdog; public health returned the July 6
  worktree and build 3 again.
- Expected: every scheduled helper and watchdog serves only the clean
  `deployments\phantomforce-live` checkout.
- Actual before fix: hidden VBS launchers, PM2 config, remote-stack PowerShell,
  a persisted repository environment override, and a live watcher still
  referenced `phantomforce-main-trunk-20260706`.
- Correction: pin watchdogs and the user environment to the deployment, replace
  the recurring task's mutable AppData launcher with a tracked self-locating
  hidden runner, terminate stale process trees, and make the strict source
  doctor audit every resurrection source.
- Evidence: multiple post-fix scheduled task runs returned result 0; public and
  local health remained on the deployment root and build 34; resurrection guard
  passed with zero stale helpers/processes.
- Regression requirement: `ops/admin-live/Test-LiveAdminSource.ps1 -Strict`.
- Status: Fixed and verified in Cycle 18.

### Q-0012 — P1 — Business records could be mislabeled or retained across organizations

- Route/component: CRM, proposals, approvals, Asset Cloud, Accounting, and
  connection requests during authenticated organization switching.
- Journey affected: a user legitimately manages two separate businesses.
- Reproduction before fix: send an authorized tenant id with a forged foreign
  `ws`, delete a server-backed row, or request a nonmember tenant through one
  of the generic workspace APIs.
- Expected: server tenant authority wins, deleted server rows stay deleted,
  connector/accounting state uses the active organization, and nonmember
  requests fail visibly.
- Actual before fix: three stores trusted client `ws`; proposal/approval
  hydration retained missing server rows; finance connector state was global;
  generic APIs silently substituted the active tenant and returned 200.
- Correction: derive record `ws` from authorized tenant, replace active-org
  server-backed collections authoritatively, scope finance connectors by org,
  and reject database nonmember tenant ids with 403.
- Evidence: 57/57 disposable database API checks and a real two-membership
  Chrome journey covering distinct CRM, proposal, approval, asset,
  transaction, and connector fixtures in both organizations, reload, forged
  labels, direct nonmember requests, and 1440x900 plus 390x844 layouts.
- Regression requirement: `npm run test:organization-record-isolation` and
  `npm run test:database-auth`.
- Status: Fixed and verified in Cycle 19.

### Q-0013 — P1 — Long chat could recognize a return but pack the wrong topic

- Route/component: instant chat context selection and provider-outage fallback.
- Journey affected: natural follow-ups and returning to a named subject after
  discussing several unrelated topics.
- Reproduction before fix: discuss Nova's corrected purple raincoat, then
  volcanoes, jazz, and Saturn; ask `Back to Nova: what color is her raincoat?`.
- Expected: the bounded context contains Nova and the purple correction, with
  none of the intervening subjects.
- Actual before fix: the request was recognized as contextual, but the packer
  supplied only the newest Saturn turn. `How long should I stay?` after a Japan
  discussion was incorrectly classified as standalone.
- Correction: detect natural implicit follow-ups and select lexically relevant
  turns plus nearby corrections from the bounded temporary window; reuse the
  same selector in provider-outage fallback.
- Evidence: deterministic packet tests, 90 authenticated real-model requests,
  and a 28-turn database-auth Chrome journey all pass with zero business
  leakage; the named return answers `purple` after organization round trips.
- Regression requirement: `npm run test:dashboard-chat`,
  `npm run test:instant-chat:http-live-model --workspace @phantomforce/server`,
  and `npm run test:database-auth`.
- Status: Fixed and verified in Cycle 20.

## High-Priority Unfixed Issues

### Q-0003 — P1 — Mobile layout and scaling are not fully proven

- Route/component: whole app, especially Media Lab, Creator Hub, sidebar/bottom nav.
- Journey affected: mobile admin use.
- Evidence: repeated user screenshots/complaints; Cycle 1 proved a 375px shell
  sanity check, and the 2026-07-16 daily sweep ran 42 browser cases across
  Dashboard, Clients, Media Lab, Content Hub, Analytics, PhantomPlay, and
  Settings at 320, 375, 768, 1024, 1440, and 1920px with no overflow or clipped
  visible control text.
- Required proof: viewport sweep at 320, 375, 768, 1024, 1440, 1920px with
  screenshots and overflow/text-overlap checks.
- Status: Partially proven; keep open for interaction-level mobile/game/editor
  checks and visual screenshot review.

### Q-0004 — P2 — PhantomForce send adapter is planned-disabled

- Route/component: send readiness, proposals/approvals/outbound actions.
- Journey affected: approved email/outreach from inside PhantomForce.
- Evidence: `/phantom-ai/ops/send-readiness/status` reports
  `planned_disabled`.
- Required correction: approval-gated send adapter, test allowlist, explicit
  confirmation phrase, redacted send receipts.
- Status: Open.

### Q-0005 — P2 — Public product clarity needs route-level audit

- Route/component: public landing, pricing/subscription/module explanation.
- Journey affected: new visitor understands PhantomForce, PhantomPlay,
  workspace type, role, modules, pricing, and customization.
- Evidence: quality objective and static inventory; no complete public audit yet.
- Status: Open.

### Q-0006 — P2 — Accessibility coverage is too shallow

- Route/component: all app/public surfaces.
- Journey affected: keyboard, screen reader, reduced motion, focus-visible users.
- Evidence: no WCAG 2.2 AA pass or automated accessibility checks in this cycle.
- Status: Open.

### Q-0007 — P3 — `server/src/index.ts` is a large route monolith

- Route/component: server route architecture.
- Journey affected: maintainability/reviewability.
- Evidence: 150+ routes in one file.
- Status: Open; do not refactor broadly without tests and a focused plan.
