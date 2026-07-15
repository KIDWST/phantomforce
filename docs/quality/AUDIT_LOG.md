# PhantomForce Audit Log

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
