# PhantomForce Quality Backlog

Last updated: 2026-07-16

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
