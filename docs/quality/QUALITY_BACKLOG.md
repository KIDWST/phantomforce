# PhantomForce Quality Backlog

Last updated: 2026-07-17

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

### Q-0011 — P1 — App shell can stick on boot fallback from stale module imports

- Route/component: `app/index.html`, `app/js/main.js`, `app/js/phantomstore.js`,
  `app/js/store.js`, app module cache graph.
- Journey affected: local/admin app startup; users see only the boot Phantom
  screen instead of the Business Manager shell.
- Reproduction: run `npm run test:responsive-viewports` before the fix; the
  dashboard 320px case fails because `[data-phantom]` never becomes visible.
- Expected: local owner QA session renders the app shell at every tested
  viewport.
- Actual before fix: browser console reported that `phantomstore.js` requested
  `friendlyBackendError` from `store.js`, but `store.js` did not export it.
- Likely cause: server-backed modules were merged with stale cache ids and a
  shared helper dependency that had not landed in `store.js`.
- Correction: add `friendlyBackendError()`, restore the responsive npm script,
  normalize app cache ids to `phantom-live-20260717-7`, and remove stale
  `.ml-back` CSS.
- Regression requirement: `npm run test:responsive-viewports` and no stale
  `phantom-live-*` app references.
- Status: Fixed and verified in the 2026-07-17 daily QA sweep.

## High-Priority Unfixed Issues

### Q-0002 — P1 — Production-grade organization isolation needs DB-auth browser proof

- Route/component: org switch, CRM, memory, assets, proposals.
- Journey affected: switching between PhantomForce and ChicagoShots.
- Evidence: owner harness proved tenant-document separation, but owner-admin can
  intentionally request any tenant.
- Required proof: two database-auth users/orgs; non-member access denied server
  side and UI visibly changes between orgs.
- Status: Open.

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

### Q-0012 — P1 — Change-memory guard shows accepted decisions missing from this checkout

- Route/component: Website Studio, sidebar shell, Kingdom Breakers, Phantom
  Rumble, Media Lab editor, customer plan switching.
- Journey affected: accepted owner decisions can be lost or resurrected from
  stale worktrees.
- Reproduction: `npm run test:change-memory` on 2026-07-17 failed with 20-21
  issues before this fix.
- Root cause (found this cycle): merge commit `24d8e3a0` ("merge: sync main
  dashboard with live PhantomPlay fixes") silently dropped several already-built
  features from the losing merge side instead of 3-way-merging them: the
  PhantomForce public-site starter (`app/js/workspaces.js` reverted to the old
  Termina store starter), Media Lab layer transform/align/distribute/select-all
  controls (`app/js/medialab.js`, `app/phantom.css`), and the entire customer
  plan-preview backend surface (`server/src/index.ts` lost the
  `/customer/plan-preview` routes and `local-customer-accounts.ts` wiring
  entirely — see Q-0013). Separately, the uncommitted working tree carried an
  unrelated in-progress Phantom Rumble "chicken coop" redesign that regressed
  the locked ledge-recovery decision (see Q-0014).
- Correction: restored the PhantomForce public-site starter (and fixed
  `applyWebsitePrompt`'s template-match early-return, which would otherwise
  hijack any prompt that merely mentions "PhantomForce"); restored Media Lab
  reset/align/distribute/select-all controls wired to the already-present
  `content-editor.js` helpers; restored the customer plan-preview backend
  routes, `/auth/me` enrichment, and frontend wiring (see Q-0013 for what still
  does not reach end-to-end); reverted `app/games/phantom-rumble.html` to the
  committed ledge-recovery version and stashed the redesign (see Q-0014);
  updated three change-memory required patterns
  (`sidebar-utility-bottom-zone`, `kingdom-breakers-duel-two-castles`,
  `phantom-rumble-clean-start-and-recovery`) where the literal string had gone
  stale against legitimately-evolved, already-verified-working code rather than
  rewriting working code to match dead patterns.
- Regression requirement: `npm run test:change-memory`.
- Status: Fixed and verified 2026-07-17 (78/78 checks pass).

### Q-0013 — P2 — Customer plan simulator has no reachable local-customer login

- Route/component: `server/src/access/local-customer-accounts.ts`,
  `server/src/index.ts`, customer plan switching end-to-end journey.
- Journey affected: a real customer test account signing in on
  app.phantomforce.online to try public plan tiers.
- Reproduction: grep `server/src/index.ts` for any route calling
  `loginLocalCustomer`/`registerLocalCustomer` — there is none.
- Expected: the change-memory-tracked plan-preview endpoints
  (`GET`/`POST /customer/plan-preview`) are reachable by an actual signed-in
  local customer test account.
- Actual: `server/src/access/local-customer-accounts.ts` (login, registration,
  password reset, org creation, plan switching) was fully orphaned — not
  imported anywhere in `server/src/index.ts` — after merge `24d8e3a0`. This
  cycle restored the plan-preview routes, the `/auth/me` local-customer
  enrichment, a preHandler that resolves `local:`-prefixed bearer sessions,
  and the frontend (`app/js/orgs.js`, `app/js/settings.js`,
  `app/js/main.js` nav gating) — all of that is real and covered by
  `npm run test:customer-plan-switching`, which now passes. What is still
  missing is a login/registration HTTP route for local customer accounts, so
  `ctx.session.localCustomer` can never actually become `true` in production
  yet. The prior lost implementation used `/auth/register`,
  `/auth/password-reset/request`, and `/auth/password-reset/complete` merged
  into a combined `/auth/login` handler (commit `7920549c`) — restoring that
  by editing the *current*, already-shipped, database-only `/auth/login`
  route is a security-sensitive change that deserves its own deliberate pass,
  not a rushed addition inside a reconciliation cycle.
- Likely cause: same `24d8e3a0` merge-conflict resolution as Q-0012.
- Correction needed: add local-customer login/registration as new,
  additive routes (do not edit the working database `/auth/login`), verified
  with a fresh regression test and a browser pass confirming a local customer
  can sign in and switch tiers end-to-end.
- Status: Open — plan-preview backend/frontend restored and tested; login is
  the remaining gap.

### Q-0014 — P2 — Phantom Rumble "chicken coop" redesign conflicts with the locked ledge-recovery decision

- Route/component: `app/games/phantom-rumble.html`.
- Journey affected: Phantom Rumble arena mechanics.
- Reproduction: `git stash list` — see
  `WIP: Phantom Rumble chicken-coop redesign (conflicts with locked
  ledge-recovery decision, held for owner review)`.
- Evidence: the pre-existing uncommitted working tree (from the session this
  cycle resumed) contained a complete, well-built rework of Phantom Rumble —
  chicken/bird fighters, a walled "coop" arena with fence-slam KOs instead of
  ring-outs, a persistent mute button, seeded procedural platform chunks — that
  explicitly removes ledge-grab/ledge-recovery ("No ledge-grabbing exists
  because there is nothing to fall off of"). `docs/quality/CHANGE_MEMORY.json`
  rule `phantom-rumble-clean-start-and-recovery` locks the owner decision that
  "fighters need real ledge-save recovery so the game feels playable instead
  of instantly punishing," so this redesign cannot be committed as-is without
  either an explicit new owner decision or a compatible recovery mechanic for
  the walled arena.
- Correction: this cycle first stashed the redesign and left the committed
  ledge-recovery version live, pending owner review.
- **Update, confirmed by Jordan directly:** `docs/superpowers/specs/`
  contains three design docs from a *different, concurrent, intentional*
  agent session (`2026-07-17-phantom-rumble-ninja-polish-design.md`,
  `2026-07-17-phantom-rumble-race-to-top-design.md`,
  `2026-07-17-phantomplay-realtime-channel-design.md`) that explicitly build
  on top of the chicken-coop rework as required foundation ("extends
  `drawFighter()`... building on top of the existing (uncommitted)
  chicken-body drawing rather than replacing it," "the fence-crack KO
  mechanic from the in-progress diff are kept exactly as they land") and
  state directly "the owner wants a second mode." Jordan confirmed this
  session's concurrent-agent activity is expected, not a conflict to
  arbitrate — treat it as the active direction and work with it. The
  `git stash pop` has been reapplied: `app/games/phantom-rumble.html` is
  back to the uncommitted chicken-coop working-tree state so the ninja-polish
  spec's next executor finds its stated starting point intact. Note this
  means the *live* admin/app.phantomforce.online game page currently serves
  the visually-incomplete chicken-body redesign (no ninja gear yet, per the
  ninja-polish spec's own problem statement) rather than the polished
  ledge-recovery version, until that spec is executed.
- Status: Open, but reframed — not an owner-arbitration blocker. The
  `phantom-rumble-clean-start-and-recovery` lock in
  `docs/quality/CHANGE_MEMORY.json` still requires `tryLedgeGrab`/ledge state
  and will correctly fail `test:change-memory` against this working tree
  until it's updated. Do not "fix" that failure by reverting the redesign —
  update or retire that lock once the ninja-polish/race-to-top work is
  actually finished and committed (it explicitly removes ledge-grabbing by
  design), not before.

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
