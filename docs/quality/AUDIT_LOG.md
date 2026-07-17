# PhantomForce Audit Log

## 2026-07-17 (session 4) — Voice Channels: In-Game Party Voice + Standalone "Mini Discord" Workspace

Real native WebRTC voice for PhantomForce, requested because "it doesn't feel
like multiplayer without it": (1) automatic in-game party voice when players
join a PhantomPlay room together, and (2) a standalone Voice Channels
workspace — any authenticated user can create a text+voice channel and invite
specific real accounts, independent of any game. Explicitly no Discord
dependency, no external accounts, no downloads — audio is peer-to-peer WebRTC,
the server only relays signaling. Working directly in
`C:\Users\jorda\Documents\Codex\worktrees\phantomforce-main-trunk-20260706`,
confirmed live via `/health` (`root` matches this checkout) and
`GET /sessions` before editing. No `git push` performed (local commits only).
Full design rationale in
`docs/superpowers/specs/2026-07-17-voice-channels-design.md`.

### 1. Design spec

- File: `docs/superpowers/specs/2026-07-17-voice-channels-design.md`.
- Covers: signaling transport decision (reusing the NDJSON-over-fetch shape
  already proven by the PhantomPlay realtime channel, not a new WebSocket —
  this server has none installed, and one was already rejected in that
  sibling spec for Pangolin-tunnel reasons that apply equally here), the
  STUN-only mesh topology and its known no-TURN limitation (explicit,
  tracked, not silently shipped), the channel/membership/invite/voice-
  session data model, and how in-game party voice and standalone channels
  share one `VoiceCore` code path with different lifecycles.

### 2. Backend signaling relay + data model

- Files: `server/src/phantom-ai/voicechannels.ts` (new),
  `server/src/index.ts` (new `/api/voice/*` routes), `server/scripts/
  test-voicechannels.ts` (new regression test, `npm run test:voicechannels`).
- What shipped: a JSON-file-backed store (`.phantom/voicechannels.json`,
  same temp-file-then-rename pattern as `phantomplay.ts`) for channels/
  membership/invites/message history, plus an in-memory-only presence +
  signaling-subscriber layer (voice presence is never persisted — a server
  restart can never resurrect a stale "connected" participant). Routes:
  channel CRUD/invite/join/leave, text chat (recent-200-persisted), and
  voice-session start/stream(NDJSON)/signal(relay)/mute/leave. The signal
  relay is a pure pass-through — `payload` (SDP/ICE) is never inspected or
  decoded server-side.
- Deliberately no entitlement/plan gate beyond the platform-wide paywall
  preHandler every mutating route already goes through (see Q-0022) — any
  authenticated user, any role, per the explicit "no restriction" ask.
- Existing `server/scripts/test-phantomplay.ts` and
  `scripts/test-phantomplay.mjs` assertions were updated: PhantomPlay
  rooms' `safety.directPeerConnection`/`safety.voice` flipped from a
  type-locked `false` to `true` (party voice genuinely opens direct WebRTC
  peer connections now) — the room-principles UI copy and the "SAFE BY
  DEFAULT" bullet list were updated to match, rather than leaving a stale
  "no voice" claim in place post-ship.

### 3. Shared frontend voice core

- File: `app/js/voicecore.js` (new).
- `VoiceCore` class: mesh `RTCPeerConnection` manager (glare-avoided via
  lexicographic actorId comparison for who initiates each offer), STUN-only
  ICE, mic mute (`track.enabled` toggle + broadcast), basic Web-Audio-
  `AnalyserNode` speaking-indicator (RMS floor, not VAD) on local and every
  remote track, and the NDJSON signaling-stream client mirroring
  `phantomplay.js`'s `openRoomStream()` (same stall-watchdog/retry-budget
  pattern). One class, reused unmodified by both consumers below.

### 4. In-game party voice

- File: `app/js/phantomplay.js`.
- What shipped: `syncPartyVoice()` hooked into `upsertRoom()` (the single
  funnel every room join/leave/poll/stream update already passes through)
  auto-connects a `VoiceCore` once a room has 2+ active participants; mic-
  mute button added to `.pp-player-actions` (mirrors the gamepad-toggle
  button pattern exactly) plus a small speaking-indicator participant strip
  under the player header. All voice-state UI updates are targeted DOM
  patches (`renderPartyVoiceStrip()`), never a full `render()` while the
  game iframe is mounted (would reload the game mid-match) — same
  discipline as the existing `[data-pp-live-score]` pattern.
- Voice session lifecycle is tied to room membership, not to the player
  screen being open (per the explicit task instruction) — flagged as
  Q-0023 since this can outlive closing the game screen.

### 5. Standalone "mini Discord" workspace

- Files: `app/js/voicechannels.js` (new), `app/js/main.js` (`BASE_NAV`
  entry under Operations department alongside Planner/Automations/
  Workforce, `CUSTOM.voicechannels` registration, matching exactly how
  Planner itself was made reachable — see Q-0018).
- What shipped: channel list, create-channel flow (name + public/invite-
  only), an invite flow that searches real PhantomForce accounts via the
  existing `GET /orgs/:orgId/members` route (reused, not reinvented) with
  an honest fallback to a manual account-id invite when no live directory
  is available (non-`database` auth providers — see Q-0022), a text-chat
  panel, and a "Join voice"/mute button using the same `VoiceCore` class
  as in-game party voice.

### Surfaces Audited

- `server/src/phantom-ai/voicechannels.ts`, `server/src/index.ts` (new
  routes only — existing routes untouched).
- `app/js/voicecore.js`, `app/js/voicechannels.js` (new files).
- `app/js/phantomplay.js` (player chrome, room join/leave, `upsertRoom`).
- `app/js/main.js` (nav entry, workspace registration, import).
- `app/phantomplay.css`, `app/phantom.css` (new voice UI styles).
- `server/src/phantom-ai/phantomplay.ts`, `server/scripts/
  test-phantomplay.ts`, `scripts/test-phantomplay.mjs` (safety-contract
  update for the new `voice`/`directPeerConnection` flags).

### Problems Verified

- None pre-existing in this area (voice did not exist before this session).
- Discovered while verifying: `scripts/test-phantomplay.mjs` failed on an
  assertion unrelated to this session's changes (`accel=.000055*W` no
  longer matches `app/games/neon-drift.html`, a game file this session did
  not touch) — confirmed pre-existing by re-running the same test against
  a `git stash` of this session's changes, which failed identically. Not
  fixed here (out of scope: a different session's concurrent Neon Drift
  boost-mechanic edit drifted from this baseline assertion).

### Problems Fixed

- N/A — this is new-feature work, not a bugfix cycle.

### Tests Added

- `server/scripts/test-voicechannels.ts` (`npm run test:voicechannels` /
  `npm run test:voicechannels --workspace @phantomforce/server`): channel
  tenant isolation, invite-only visibility/join gating, membership-gated
  chat + recent-N history, voice-session presence accuracy, signal-relay
  addressing (including rejecting a signal from a non-participant),
  mute-broadcast reflection in the live snapshot, empty-session cleanup
  (never fabricate stale presence), and game-room-kind session-key
  derivation shared with the channel path.

### Commands Run

- `npm run typecheck` — PASS.
- `node --check` on every touched/new `.js` file
  (`app/js/main.js`, `app/js/phantomplay.js`, `app/js/voicecore.js`,
  `app/js/voicechannels.js`) — PASS.
- `npm run test:phantomplay` (root, chains the `.mjs` UI-copy test and the
  server-side `tsx scripts/test-phantomplay.ts`) — server-side suite PASS
  (including the updated voice-safety assertions); root `.mjs` suite hit
  the pre-existing unrelated Neon Drift failure described above.
- `npx tsx scripts/test-phantomplay.ts` (server workspace, run directly to
  isolate from the unrelated `.mjs` failure) — PASS, all assertions
  including the new `directPeerConnection === true && voice === true` /
  `chat === false` split.
- `npm run test:voicechannels` — PASS.
- `rg -n "phantom-live-20260717-17"` across `app/` before bumping (found
  41 files, confirming `-17` was the highest suffix in use), then a
  scripted bump to `phantom-live-20260717-18` across `app/index.html` and
  every `app/js/*.js` file; re-confirmed zero remaining `-17` references
  and 43 files now on `-18` (including the two new files, which were
  authored directly against `-18`).
- Live-server verification (see Results below) against both the shared
  local dev stack and a disposable, isolated `tsx server/src/index.ts`
  instance on an unused port, using only demo-auth fixtures and a
  temp-directory store — no shared state touched.

### Results

- PASS: `agent-browser` against the shared local dev stack
  (`127.0.0.1:5177`, confirmed live via `/health` matching this checkout)
  shows the "Voice Channels" nav entry under the Operations department
  exactly as registered, and opening it renders the full workspace shell
  (header, create-channel button, empty channel list, empty channel-view
  placeholder) with no layout breakage — screenshot captured.
- **Could not fully verify the live shared server's new `/api/voice/*`
  routes in-browser**: the shared API process on port 5190 was already
  running (started before this session, no file-watcher — a plain
  `tsx` invocation, not `tsx watch`) and therefore serving code from before
  this session's changes. Restarting that shared process was correctly
  blocked by the environment's permission system as a shared-
  infrastructure risk to other concurrently-committing sessions, and this
  session did not attempt to work around that block. This also means the
  "Business Manager" quick-login flow available in this sandbox does not
  yield a working bearer token against that shared process for *any*
  route, old or new (confirmed: the pre-existing `/api/phantomplay` route
  also 401s / falls back to "Offline mode" under that same login path in
  this environment) — an environment/session-provisioning limitation
  unrelated to this session's code.
- PASS (real, live, two-independent-authenticated-peers verification):
  spun up a disposable `tsx server/src/index.ts` instance on an unused
  port with demo auth and a temp-directory store (no shared files/ports
  touched, torn down afterward). Using the two built-in demo identities
  (`admin-jordan`, `client-sports-demo`) as two independent real HTTP
  clients: created a channel, invited/joined across the invite-only gate,
  posted and read tenant-isolated messages, both peers joined the same
  voice session and saw accurate live presence, peer B's `POST .../signal`
  offer was received in real time on peer A's **open, live NDJSON stream**
  addressed correctly (`from`/`kind`/`payload` all matched exactly), and
  peer A's mute broadcast was observed by peer B's independently-open
  stream as a live presence update. This is a genuine end-to-end proof of
  the signaling relay, presence, and mute-broadcast layers over real HTTP
  between two distinct authenticated identities — the piece explicitly
  called out as sufficient verification without physical microphone
  hardware.
- Also discovered during this live pass (not a bug — see Q-0022): the
  platform-wide paywall preHandler blocks the free-tier demo client from
  any mutating Voice Channels call exactly as it already blocks that same
  fixture from `POST /api/phantomplay/rooms` — confirmed both behave
  identically, so the two-peer proof above was re-run with
  `PHANTOM_FREE_WRITE=true` set only on the disposable verify instance.
- **Not verified in this session**: real two-browser `RTCPeerConnection`
  reaching `connected` ICE state with actual audio flowing (would require
  either the shared server restart that was correctly blocked, or a
  browser-automation setup with fake-media-device flags that wasn't built
  in the time available). Stated plainly per the task's honesty
  requirement, not claimed as working.

### Remaining P0/P1

- No P0.
- P1 (carried, unrelated to this session): DB-auth org isolation browser
  proof is still required (pre-existing, see prior cycles).

### Next Task

Restart the shared local API dev server (`server/src/index.ts`, port 5190)
so the new `/api/voice/*` routes go live for the shared stack, then finish
the last-mile verification this session could not complete: a real two-
browser `RTCPeerConnection` handshake reaching `connected` with actual
audio (ideally two real `agent-browser` sessions with fake-media-device
flags, or a manual two-tab pass), plus a click-through of the standalone
Voice Channels workspace's create/invite/chat/join-voice flow against a
`database`-auth-provider session so the real member-directory invite path
(not the manual-id fallback) gets exercised. Also worth a decision pass on
Q-0020 (TURN relay) before this reaches real users on restrictive networks.

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

### 4. 3-lane Planner rebuild with dependency recalculation

- Discovery: `app/js/planner.js` (`renderPlanner`) was **not wired into the
  app at all** — not in `WORKSPACE_DEFS` (`app/js/workspaces.js`), not in
  `CUSTOM` (`app/js/main.js`), no nav entry. It's real, complete-looking
  code (hero, week board, AI prep queue, saved-plan list, automation stock)
  but was dead/unreachable. Separately, `app/js/contenthub.js` has its own,
  entirely different "Business Planner" (`renderContentPlanner`, a
  date/time calendar scheduler for meetings/calls/deadlines/content, its own
  `CH_PLANNER_ITEMS_KEY` storage, no relation to `planner.js`'s data model)
  which *is* live inside Content Hub. These are two unrelated features that
  happen to share the word "planner" — this item only touches
  `app/js/planner.js`; the Content Hub calendar planner was left alone.
- Decision: wired `renderPlanner` up for real (`CUSTOM.planner` in
  `app/js/main.js`, a `dept: "Operations"` sidebar entry alongside
  Automations/Approvals/Workforce) rather than leaving the 3-lane rebuild
  invisible — shipping a feature nobody can reach isn't really shipping it.
  Logged as a judgment call (Q-0018) since the task didn't explicitly ask
  for new nav wiring.
- 3-lane design: rather than inventing a generic Kanban (Now/Next/Later),
  the lanes extend the *existing* plan-block data model directly — blocks
  already had a binary `status: "open" | "done"`; this adds a real
  `dependsOn: string[]` field (ids of other saved plan blocks) and derives
  three lanes live at render time: **Blocked** (has an unmet dependency),
  **Ready** (no unmet dependency, not done), **Done**. Lane membership is
  never stored — `deriveLane()`/`unmetDependencies()` compute it from
  current `status` + `dependsOn` on every render, so there is no separate
  "recalculate" step to forget: completing or reopening any block
  immediately changes what's Blocked vs. Ready for everything that depends
  on it, and deleting a block silently un-blocks anything that depended on
  it (a missing dependency id resolves as satisfied rather than blocking
  forever).
- Files: `app/js/planner.js` (`unmetDependencies`, `deriveLane`, `LANES`,
  `depCandidates`, `dependencyPicker`, `plannerItemCard`, `laneBoard`,
  `plannerForm` dependency multi-select, `data-pl-dep` change handler,
  `data-pl-done` handler now logs which dependents were unblocked),
  `app/js/main.js` (`CUSTOM.planner`, `BASE_NAV` planner entry, `renderPlanner`
  import), `app/phantom.css` (`.planner-*` — the page previously had zero
  CSS at all, consistent with being unreachable).
- Verification: `node --check app/js/planner.js`, `app/js/main.js`,
  `app/js/workspaces.js` — PASS. Full browser click-through via
  agent-browser against the local dev server: opened the new sidebar
  "Planner" entry under Operations, confirmed the hero/metrics/week
  board/AI prep queue render with real store data (screenshots captured);
  created two real plan blocks through the actual form ("Draft Q3 proposal",
  "Send proposal to client"), set "Send proposal to client" to depend on
  "Draft Q3 proposal" via the real dependency picker checkbox, confirmed it
  rendered in the Blocked lane with "Blocked by Draft Q3 proposal" and the
  Ready lane correctly held only the non-dependent block; clicked Reopen/Done
  through several cycles and confirmed the dependent block moved
  Blocked → Ready the instant its dependency was marked Done (and back to
  Blocked on reopen) with no manual recalculation step — this is the actual
  dependency-recalculation proof, not just a code-review claim. Removed all
  test data afterward (`Remove` on each block) so no test artifacts were
  left in the live app's local storage. No console errors at any point.
- Cache-bust: bumped `phantom-live-20260717-15` → `-16`.

### 5. Explanatory Analytics — Accounting "why + what to do"

- Surface chosen: Accounting (`app/js/workspaces.js` `renderMoney`), not the
  social-analytics surface the task suggested checking
  (`organizationpulse.js`/`competitor-intelligence.js`/`contenthub.js`
  `renderAnalytics`). Reason: social analytics and Organization Pulse/Brain
  Contract both require a live signed-in server session and (for social)
  live OAuth-connected accounts — this session has no real owner
  credentials (same constraint hit in items 2 and 3), so any explanation
  built on top of them would be untestable this round and, worse, would
  render against an empty state in most real sessions too. Accounting's
  data (`moneyView()` in `store.js`) is 100% local — real transactions the
  owner enters or imports — so it's the one metric surface guaranteed to
  have real, testable data without any live backend dependency, and it
  still satisfies "at least one meaningful chart/metric view."
- What shipped: a "Why these numbers" panel between the stat tiles and the
  rest of the Accounting page. `financeExplainer()` derives, from the same
  `moneyView()` data the stat tiles already use — never invented numbers:
  which direction net cash is moving and by how much (cash in vs. cash out,
  both real sums); which expense category is the single biggest driver of
  spend and its real percentage share of total cash out; a note when
  transactions are still "Uncategorized" (explains why the read is
  incomplete). Below that, "What to do about it" lists concrete next
  actions with a real `Open` button wired to `data-open-ws` (the app's
  existing global click-delegation convention) — categorize uncategorized
  transactions, follow up on real open-proposal pipeline value, or draft a
  proposal if there's no pipeline at all. Returns nothing (no panel at all)
  when the ledger is empty — matches the honesty-over-completeness pattern
  used elsewhere in this app (Workforce's "No desk assigned yet," Command
  Briefing's omit-rather-than-pad rule) instead of fabricating insight for
  zero data.
- Files: `app/js/workspaces.js` (`financeExplainer`, `financeExplainerHtml`,
  wired into `renderMoney`), `app/phantom.css` (`.finance-explain`,
  `.finance-why-list`, `.finance-action-list`, `.finance-action`).
- Verification: `node --check app/js/workspaces.js` — PASS. Full browser
  proof via agent-browser: confirmed the panel is absent on an empty ledger
  (no fabricated insight); added three real transactions through the actual
  form (one $2,500 income, two expenses: $60 Software, $900 Contractors);
  confirmed the panel appeared with correct, checkable math — "Net cash is
  positive: cash in ($2,500) is ahead of cash out ($960)" (2500-960=1540,
  matches the Net Cashflow tile exactly) and "'Contractors' is the single
  biggest driver of spend — $900, 94% of everything recorded as cash out"
  (900/960 = 93.75%, rounds to 94% correctly); confirmed the "what to do"
  action ("No pipeline on record — draft a proposal," since this test
  session had zero proposals) had a real, working `Open` button that
  navigated to the actual Offer Desk (proposals) workspace. Deleted all
  three test transactions afterward (stubbed `window.confirm` to clear the
  browser confirm dialog agent-browser's coordinate click couldn't reach,
  same short-viewport quirk noted in item 1) so no test data was left in
  the live app's local storage. No console errors at any point.
- Cache-bust: bumped `phantom-live-20260717-16` → `-17`.

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
