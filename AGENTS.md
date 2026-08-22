# AGENTS.md — coordination for anything editing this repo

> **MARK — Claude was here (2026-07-05).** Codex/other agents: read this before you
> touch files. Multiple agents work this repo in parallel; this note keeps us from
> clobbering each other. Update the "Recent, merged & live" list when you land work.

## Seven-day evolution mission (2026-07-19 through 2026-07-25)
- Read `docs/quality/EVOLUTION_MISSION.md` and
  `docs/quality/EVOLUTION_STATE.json` before UI or experience work.
- Continue from `docs/quality/NEXT_CYCLE.md`; use the existing scorecard, site
  inventory, decisions, audit log, and change-memory guard as source records.
- Record each scheduled checkpoint in `docs/quality/EVOLUTION_CYCLES.md`.
- Run `ops/evolution/Invoke-SevenDayEvolutionPreflight.ps1` before integrating,
  pushing, deploying, or claiming a cycle complete.
- This is a finite task, not an active Codex goal. The task schedule is limited
  to 21 cycles and must not be converted into hidden or indefinite persistence.

## Source of truth
- The canonical repo is **`github.com/KIDWST/phantomforce`**, branch **`main`**.
- The canonical Windows editing checkout is
  `C:\Users\jorda\Documents\Codex\worktrees\phantomforce-current`.
  The machine serving **`admin.phantomforce.online`**, **`app.phantomforce.online`**,
  and **`127.0.0.1:5177`** uses the clean deployment checkout at
  `C:\Users\jorda\Documents\Codex\deployments\phantomforce-live`. The scheduled
  sync fast-forwards that checkout to `origin/main`; do not serve an arbitrary
  feature worktree. Before declaring a change live, verify `/health` reports the
  deployment root and its commit matches `origin/main`.
- The deployment checkout is **serve/sync only**. Never run Unreal Editor,
  cook/package jobs, asset generators, recovery pipelines, or feature editing
  from `...\Codex\deployments\phantomforce-live`. Use a dedicated development
  worktree, commit and push the verified result, then let the clean deployment
  checkout fast-forward. If the deployment is dirty, stop the writer, preserve
  the work in a named recovery stash, restore cleanliness, and run the source
  doctor before claiming that sync is healthy.
- The Windows remote-stack watchdog also starts the admin services. Its host files
  live outside this repo at:
  `C:\Users\jorda\Documents\PhantomForce-Infrastructure\windows-host-pangolin-ai`.
  If `127.0.0.1:5177/health` ever reports `phantomforce-main-trunk-20260706`,
  update `Start-PhantomForce-RemoteStack.ps1` and `ecosystem.config.js` there before
  doing more UI work; that stale watchdog can otherwise resurrect the old admin app.
- If the owner says changes are not appearing, assume another agent edited a stale
  sibling worktree first. Run `/health`, compare the `root`, land the intended diff
  on `origin/main`, and sync the dedicated deployment before doing more design work.
- Before telling the owner "this is live" or before debugging a stale-looking admin
  UI, run the source doctor from the dedicated deployment checkout:
  ```powershell
  cd C:\Users\jorda\Documents\Codex\deployments\phantomforce-live
  powershell -NoProfile -ExecutionPolicy Bypass -File ops\admin-live\Test-LiveAdminSource.ps1
  ```
  It checks branch, `origin/main`, sync manifest, live build id, local service
  health, Hermes commit, sidebar utility pinning, and stale sibling worktrees.
- Do **not** make owner-facing admin UI edits in another local worktree and assume
  they are live. If you must work elsewhere, commit, push to `main`, then run
  `ops/admin-live/Sync-AdminMain.ps1` from the served worktree or point the admin
  server at the intended repo root.
- If your checkout has no `origin`, it's an isolated clone — wire it up before trusting local state:
  ```bash
  git remote add origin https://github.com/KIDWST/phantomforce.git
  git fetch origin && git log --oneline origin/main -1
  ```
- **Direct pushes to `main` are in use** (the owner asked for it; several agents now
  push straight to `main`). Deploy is automatic (GitHub Pages) on any push to `main`.
  Before you push: `git fetch origin main && git rebase origin/main` — main moves under
  you often, so expect to rebase (conflicts land mostly in `app/js/main.js`). A PR is
  still fine if you prefer review, but it is no longer required.
- **Change memory is mandatory.** Before pushing, syncing live admin, or claiming a
  user-facing admin change is live, run `npm run test:change-memory`. When Jordan
  accepts a change that has been lost before, add required patterns to
  `docs/quality/CHANGE_MEMORY.json`. When Jordan rejects or removes old behavior, add
  forbidden patterns there so another stale worktree cannot resurrect it.

## Recent, merged & live (newest first)
- **PhantomPlay 0.3.4 control center candidate (2026-08-21)** — keeps Play,
  Code, and Split available for Unreal and browser projects; adds native launch
  and side-by-side source workflows; and replaces the shallow settings panel
  with an app-wide green-and-black control center for secure OpenRouter vault
  setup, exact model/fallback routing, timeouts, workspace behavior, runtime
  origin, connection checks, and diagnostics. AI Apply now stays actionable,
  reports exact key, credit, permission, provider, timeout, API, project, file,
  and instruction failures, and can recover through an owner-selected fallback.
  Rust passed 41/41 tests and warning-free clippy; server typecheck, AI routing,
  shell contract, change-memory, bundle, and Windows identity gates passed. The
  verified 0.3.4 installer is ready; replacing an open 0.3.2 desktop process is
  intentionally left pending until PhantomPlay is closed.
- **PhantomStrike V19R1 Operation Nightglass candidate (2026-08-20)** —
  additive source and persistent-world upgrade on the verified V18R1 installed
  floor. PhantomStrike now has staged insertion, street advance, command-center
  breach, physical uplink, marina extraction, friendly squad presence, tactical
  enemy repositioning, a mission-aware HUD, upgraded route lighting, and 122
  reproducible V19 world actors. Unreal 5.8.1 Development and Shipping builds,
  the 4,818-package cook, production-world validation, IoStore archive, and a
  hidden packaged startup smoke pass succeeded. Candidate remains unpromoted;
  installed V18R1 was not touched while visual, real-input, and performance gates
  remain open.
- **Giant translucent PhantomBot presence (2026-08-19)** — browser build
  `phantom-live-20260819-172`. Removed the late desktop-parity regression that
  shrank PhantomBot to a 190px mascot. The shared web/desktop surface now renders
  a 430–680px translucent full-body apparition, with the workspace prompt layered
  over the character and responsive phone sizing from the same contract. The
  presence renderer now cycles deterministic painted welcome, present, point,
  laugh, thinking, speaking, success, warning, error, and paused gestures based
  on live state. Change-memory, Phantom presence, PhantomBot, command-surface,
  desktop 17/17, phone/desktop Chrome visual sweeps, and release-critical 32/32
  gates passed.
- **PhantomPlay V18R1 installed promotion (2026-08-19)** — exact user
  authorization `PROMOTE` replaced the installed V11R15 four-game set with the
  reviewed V18R1 Windows Shipping builds through an atomic, fail-closed promotion.
  Every installed launcher matches its reviewed SHA-256; all four installed games
  launched into real gameplay, generated fresh 1920 × 1080 captures, passed the
  4/4 flat/blank/prototype visual gate, and passed human frame review. PhantomPlay
  shell `0.3.2` launched against the V18R1 marker and its native contract passed
  34/34. The prior installed set is recoverable at
  `C:\Users\jorda\Documents\Codex\backups\phantomplay-unreal-v11r15-to-v18r1-20260819-065922\Windows`.
- **Phantom Rumble 3.0: Overdrive (2026-08-19)** — browser build
  `phantom-live-20260819-171`. Rebuilt held SMASH into a real keyboard, touch,
  and gamepad charge/release seam that arms four-impact WALLBREAKER ricochet
  physics across fences, floors, ceilings, and platforms. Added Overdrive,
  adaptive procedural music, layered combat SFX, hit-stop, camera punch,
  shockwaves, feathers, debris, arena scars, upgraded bot heavy attacks,
  responsive mobile controls, and custom chicken-ninja store artwork. The
  release-critical suite passed 32/32, visual gates passed phone and desktop,
  and the installed `PhantomPlay.exe` gate loaded `3.0.0-overdrive` and executed
  the live ricochet/VFX engine through the native security wrapper.
- **PhantomPlay Windows identity repair (2026-08-19)** — native shell `0.3.2`.
  Embedded the Phantom icon and PhantomForce version identity into the executable,
  added a dedicated Windows taskbar icon path, and branded the NSIS installer,
  uninstaller, desktop/Start shortcuts, and Windows Apps registration. The packaged
  and installed identity gates passed, 34 native shell tests passed, and a live
  installed-app capture verified the current 35-project library and Vespergate 3.1.
- **Unrestricted internal admin products (2026-08-19)** — commit `643a4d11`,
  browser build `phantom-live-20260819-170`. The authenticated platform admin
  now opens every available PhantomForce product and all ten AI workspaces on
  `admin.phantomforce.online` without checkout or fabricated purchase records.
  Customer ownership remains purchase-gated on `app.phantomforce.online`.
  Release-critical passed 32/32; live authenticated probes confirmed 15 admin
  library products, 10 runnable admin AI products, zero admin commerce controls,
  and zero unpurchased AI products for the customer account.
- **Vespergate 3.1 canonical recovery (2026-08-19)** — browser build
  `phantom-live-20260819-169`. Reunified the richer Aug 9 Vespergate branch with
  the later 3.0 systems so the illustrated pointed-hood bearer, asymmetric
  mantle, split cloak tails, profession-readable villagers, denser living-world
  art, expanded rooms, checkpoints, encounter objectives, bell sequences,
  mirror relays, and sanctums ship together with mastery, wayfinding, Vesper
  Sense, touch/gamepad controls, autosave migration, and portable saves. Added
  visual-profile and change-memory guards so a smaller legacy source cannot
  silently replace the canonical desktop/web build again. Vespergate world
  verification passed 196/196, the release-critical gate passed 32/32, phone and
  desktop gameplay/map captures passed, and the native PhantomPlay host launched
  3.1.0 with all 14 rooms.
- **PhantomPlay V18 recovery + Vespergate 3.0 (2026-08-19)** — product commits
  `f7a3c441` and `8eee40c5`, browser build `phantom-live-20260819-168`.
  Recovered the missing Unreal V13–V17 content and world passes, CubeTown
  Memorycraft V16 and Diorama Adventure V17, and PhantomPlay AI V18 provider
  routing. Four V18R1 Windows Shipping candidates package and pass 4/4 automated
  visual acceptance plus human screenshot review; the installed four-game set
  truthfully remains V11R15 until literal `PROMOTE` authorization. Vespergate 3.0
  adds touch play, persistent wayfinding, Vesper Sense, mastery, autosave/migration,
  and portable PhantomPlay state. Release-critical passed 32/32, responsive Chrome
  passed 66/66 across eleven surfaces and six viewports, and the strict history
  secret scan found 0 verified/unknown findings.
- **Atomic workspace transitions + recoverable PhantomHunter/AI routing (2026-08-18)** —
  product commit `79e4b371`, browser build `phantom-live-20260817-163`.
  Workspace routes now warm and await their complete style bundles, preserve the
  prior rendered page, and use a branded accessible transition so raw markup is
  never exposed during navigation. PhantomHunter follow-ups stay pinned to the
  server-returned organization, stale scan IDs self-heal, interrupted work
  becomes a durable actionable failure, local paths stay redacted, and Windows
  Git history uses the working TruffleHog URI. Smart PhantomBot reasoning now
  enforces provider budgets through ChatGPT Bridge, records real call truth, and
  treats user corrections as authoritative over assistant embellishment.
  Release-critical passed 31/31, responsive Chrome passed 60/60 plus a post-
  rebase PhantomPlay/PhantomStore 12-case sweep, database auth passed 57/57 and
  the 139-turn two-organization browser journey, CRM persistence passed 18/18,
  strict history scanning found 0 verified/unknown secrets, and the canonical
  source doctor confirmed commit/build/service alignment.
- **Future command shell material pass (2026-08-18)** — product commit
  `24e6f1ed`, browser build `phantom-live-20260817-162`. The desktop command
  rail is now one continuous glass surface instead of painting a rectangular
  block behind Search and Approvals. Active navigation, utility actions,
  account access, Menu, and the bottom system line use a consistent rounded
  instrument language; laptop widths switch utilities to icon-first density,
  while standard desktop keeps every primary division visible. Release-critical
  passed 31/31 and responsive Chrome passed 60/60 across ten surfaces and six
  viewports, including direct regression assertions for utility background,
  vertical inset, overlap, control radius, and primary-navigation visibility.
- **Unified PhantomBot workspace polish (2026-08-18)** — product release commit
  `903a518e`, browser build `phantom-live-20260817-161`. PhantomBot now uses one
  intent-adaptive composer with a real organization-wide model picker for
  automatic, local, Codex, Claude, ChatGPT Bridge, and OpenRouter runtimes;
  exposes truthful availability before selection; restores archived sessions;
  preserves attachments across retry; and adds modal focus containment and
  restoration across the session, context, model, and compact-navigation
  surfaces. The release-critical suite passed 31/31, responsive Chrome passed
  60/60, PhantomBot desktop passed 17/17, change memory passed 275 live checks,
  strict repository-history scanning found 0 verified/unknown secrets, and the
  canonical UI, Hermes, sync manifest, and public build all agree on this
  release.
- **PhantomPlay native studio + truthful AI/connect runtime (2026-08-17)** —
  product commit `423c88e1`, browser build `phantom-live-20260817-152`.
  PhantomPlay now ships the native Dioxus studio, Unreal/Unity/Panda3D project
  surfaces, production registries, discovery, AI-edit contracts, native mods,
  and four V11R15 Unreal Shipping candidates whose candidate and installed
  gameplay captures passed 4/4 visual gates. PhantomForce adds organization-
  scoped provider/model choice across auto, local, Codex, Claude, OpenRouter,
  and ChatGPT lanes, with saved organization choices powering standard member
  chat without granting platform-admin execution; one-click customer connection initiation; truthful runtime
  state; stronger conversational continuity; and a corrected mobile PhantomBot
  composer. Release-critical passed 31/31, responsive Chrome passed 60/60,
  database/auth passed 57 API checks plus the 139-turn two-organization browser
  journey, strict history scanning found 0 verified/unknown secrets, and the
  canonical UI/API health checks reported this commit. Installed PhantomPlay
  `0.3.0` and V11R15 have a recoverable backup at
  `C:\Users\jorda\Documents\Codex\backups\phantomplay-v11r15-20260817-145647`.
- **Confirmation exceptions + corrected membership (2026-07-19)** — server
  commit `e15d6dc5`, browser build `phantom-live-20260719-45` (the build was
  advanced by Jordan's preserved gold admin navigation commit). Phantom now
  resolves `everyone except`, `only`, and `neither/nor` as bounded tri-state
  confirmation sets; returns exact names, counts, and yes/no answers; applies
  person-level corrections and double negation; and clarifies missing rosters,
  unknown people, out-of-roster updates, and contradictions. The canonical
  187-request gate, 116-turn two-organization Chrome journey, strict live
  doctor, and 205 live guards passed with zero fallback or business leakage.
- **Isolated follow-ups + exact comparisons/events (2026-07-19)** — commit
  `5b9c713a`, browser build `phantom-live-20260718-44`. Vague transformations
  now carry only the immediately preceding topic instead of six unrelated
  turns; named quantities support winners, rankings, differences, ties,
  corrections, missing values, and unit checks; explicit timelines support
  before/after callbacks and repeated-event clarification. The canonical
  157-request gate, 90-turn two-organization Chrome journey, scheduled sync,
  and 201 live guards passed with zero fallback or business leakage.
- **Respectively mappings + named-entity undo (2026-07-19)** — server commit
  `315608de`, browser build remains `phantom-live-20260718-43`. Phantom now
  preserves ordered mappings for named, ordinal, and reverse callbacks, asks a
  useful question when list lengths conflict, and rolls back only the named
  person's property while retaining everyone else's accepted changes. The
  canonical 140-request gate, 73-turn two-organization Chrome journey,
  scheduled sync, and 197 live guards passed with zero fallback or business
  leakage.
- **Causal references + scoped rollback (2026-07-19)** — server commits
  `d12ce4ce` and `fcb62c8e`, browser build remains
  `phantom-live-20260718-43`. Phantom extracts explicit causes, follows
  reason-to-outcome callbacks, restores the newest structured base or only the
  requested fields, and keeps exact correction repair in the user's language.
  The canonical 130-request gate, 63-turn two-organization Chrome journey,
  scheduled sync, and 194 live guards passed with zero fallback or business
  leakage.
- **Exact multi-object references + correction chains (2026-07-19)** — server
  commit `5439ffe2`, browser build remains `phantom-live-20260718-43`. Phantom
  resolves explicit former/latter facts, moves and swaps actual numbered
  options, retains plural ownership, and preserves the newest values across
  chained corrections. The canonical 117-request gate, 50-turn
  two-organization Chrome journey, scheduled sync, and 190 live guards passed
  with zero fallback or business leakage.
- **Useful ambiguity + correction repair (2026-07-18)** — server commit
  `f1923f80`, browser build remains `phantom-live-20260718-43`. Phantom asks one
  concise clarification naming genuinely ambiguous people, ignores format words
  and older candidates when the current subject is explicit, and preserves a
  selected idea when borrowing another answer's tone. The canonical 105-request
  gate, 38-turn two-organization Chrome journey, scheduled sync, and 187 live
  guards passed with zero fallback or business leakage.
- **Bounded long-distance chat recall (2026-07-18)** — build
  `phantom-live-20260718-43`. The browser packs six newest temporary turns plus
  up to four turns from a named older thread, still capped at ten and scoped to
  the active organization. Exact corrected colors and codenames use an
  extractive context tool instead of model guessing. Chrome proves a corrected
  fact after nine unrelated subjects; the live-model gate covers 102 requests.
- **Relevant-thread conversational recall (2026-07-18)** — backend-only Cycle
  20 on app build `phantom-live-20260718-37`. Natural implicit follow-ups now
  inherit the current casual topic, and named returns retrieve the matching
  recent thread plus its correction instead of blindly packing the newest
  unrelated subject. Real-model coverage is 90 requests; the authenticated
  browser proof is 28 consecutive turns across two organizations.
- **Business-record organization isolation (2026-07-18)** — build
  `phantom-live-20260718-37`. CRM leads, proposals, approvals, assets,
  accounting transactions, and connector requests are proven separate across
  two legitimate database organizations. Server records ignore forged `ws`
  labels, nonmember tenant requests fail with 403, and reload cannot resurrect
  stale server-backed rows.
- **Authenticated organization context isolation (2026-07-18)** — build
  `phantom-live-20260718-34`. Database/customer sessions scope local memory and
  temporary chat to active `orgId`, switches clear stale visible transcripts,
  and a disposable-Postgres browser fixture proves two-way organization
  isolation, reload persistence, forged-switch rejection, and mobile/desktop
  rendering for a legitimate multi-organization user.
- **Real instant conversational brain (2026-07-18)** — build
  `phantom-live-20260718-29`. Smart-mode casual chat uses the localhost-only
  `qwen2.5:14b` lane with bounded temporary context, concise output, no business
  module leakage, and sub-second warm responses. Standard/deep work retains its
  existing role, approval, and provider controls. A hidden Windows logon task
  keeps Ollama available after restart.
- **Dedicated live checkout + tenant-backed revenue truth (2026-07-18)** — build
  `phantom-live-20260718-25`. CRM discovery refuses to invent contacts when no
  verified public-research adapter is connected; manual CRM records, proposal
  drafts, and workspace approvals persist by organization; Analytics restores the
  source-backed Managed Growth report. The live watchdog and scheduled sync use the
  clean deployment checkout. `npm run test:release-full` covers the 19-check product
  gate plus disposable-Postgres auth/tenant and Easy CRM suites.
- **Customer plan simulator + setup routing guard (2026-07-16)** — build
  `phantom-live-20260716-289`. Customer test accounts can switch public
  Free/Pro/Elite/Enterprise tiers from Settings → Plan & access, local customer
  auth returns real entitlement summaries, restricted nav items open the plan
  panel, and the empty setup CTA routes to Settings instead of Clients.
- **Org-owner social connections (2026-07-14)** — build
  `phantom-live-20260714-267`. Social analytics status, OAuth account start,
  and live sync are now workspace-manager routes, so database-auth org
  owners/admins can connect their own social accounts. Provider app credential
  setup remains platform-owner only.
- **Social OAuth refresh loop (2026-07-14)** — build
  `phantom-live-20260714-259`. Analytics and Media & Social settings now poll and
  refresh after a provider OAuth sign-in, so connected accounts move into live
  sync without relying on a detached browser tab to notify the admin app.
- **Scoped social OAuth + live analytics prep (2026-07-14)** — social analytics is
  now live-feed first, with workspace-scoped stored connections and callback
  support for TikTok, X, and LinkedIn in addition to the existing providers. The
  admin app build is `phantom-live-20260714-256`. Provider app credentials are
  still required before real accounts can authorize.
- **Competitor Intelligence + optional Aggressive Mode (2026-07-12)** —
  tenant-scoped public-signal evidence, labeled weak-signal inferences,
  aggregated audience-gap mining, originality-risk checks, bounded market
  interception packages, search/offer/timing opportunities, authorized
  customer-experience evidence, plan gates, and a durable blocked-action audit.
  No scraping, outreach, publishing, impersonation, or external action is
  performed. See `docs/COMPETITOR_INTELLIGENCE.md`.
- **PhantomPlay product foundation (2026-07-12)** — native entertainment module
  with three real network-free games, secure sandboxed launch, tenant-scoped
  favorites/progress/history/preferences, plan and age controls, developer release
  submission/versioning, and platform-admin moderation. See `docs/PHANTOMPLAY.md`.
- **Content Hub planner + unified post preview (2026-07-11)** — Creator Hub follows
  `Library → Ideas → Drafts → Publish → Planner`; Publish renders one combined
  destination preview instead of duplicate platform cards. Planner combines
  scheduled content with tenant-local meetings, calls, follow-ups, deadlines, and
  honest email/calendar connector setup states. The old Workflow tab is removed.
- **ChicagoShots workspace isolation (2026-07-11)** — the live Business Manager
  now requires both `phantomforce` and `chicagoshots` workspaces. Existing browser
  state is migrated without reset; each workspace has its own brain, memory, and
  asset namespace identifiers.
- **UNIFICATION (2026-07-06)** — main's `app/` is now the merge of BOTH forks:
  Codex's `client-sim/trainer-visible-truth-20260629` admin app (Memory, Workers,
  Developer, compact hero, page-based nav, mobile shell — their 233-commit line)
  PLUS main's post-absorb features (agent-ops ticker/console, hero typewriter,
  pointer-parallax ghost, Brand Memory + Automation true pages, preview entrance
  `?demo=1`, automation approval flow). Build id scheme: `phantom-live-20260706-N`.
  Codex: main is the canonical deployable trunk (Pages serves it; root public site
  lives here). Please build on main's `app/` from now on — your branch is preserved
  as reference but is now BEHIND main.
- **Content Hub + Analytics** (`4742880`) — `app/js/contenthub.js`: aggregates every
  social post/image/video. Self-contained (own localStorage lib, seeded/deterministic)
  and exports an `analyze()` data API. Content Hub tabs split by **platform** and by
  **content/engagement type** (Overview | Social platforms | Content types | Engagement
  {Likes/Comments/Reactions/Shares&saves} | Scheduled), post-detail modal with metrics,
  reactions, hashtags, sentiment-tagged comments. **Analytics** now fetches the exact
  same `analyze()` output (reach chart, content-mix donut, per-platform bars, KPIs, top
  posts). Wired in `main.js` as the `content` + `analytics` custom workspaces.
- **Media Lab** (`060e69f`) — `app/js/medialab.js`: AI image/video generator + canvas
  editor + pluggable providers; backend `POST /generate` in `ai-proxy/` (Higgsfield,
  OpenAI; add your own = one `MEDIA_PROVIDERS` entry + one `DEFAULT_PROVIDERS` entry).
- **Command center** — ⌘K palette, live pulse, proactive briefing, notifications,
  insights, stat sparklines (`app/js/main.js`).
- **Phase-2 AI Operations Console** — sidebar + topbar + hero + rail dashboard
  (`app/index.html`, `app/phantom.css`, `app/js/main.js`).
- **Living Phantom character** — `app/js/character.js`: 11 painted poses, emotional
  inertia (`governMood`), hologram depth. Shared by admin + public site.
- Current cache-bust build id: **`phantom-live-20260719-49`**.

## Repo map
- `app/` — the **admin console** (`admin.phantomforce.online`). `index.html`,
  `phantom.css`, and `js/{main,character,medialab,workspaces,store,command,flowmap}.js`.
- root `index.html` + `void.js` + `void.css` — the **public site** (`phantomforce.online`).
- `ai-proxy/` — server-side key proxy (`server.mjs` Node, `worker.js` Cloudflare).
  Routes text to Claude/OpenAI/OpenRouter (`/chat`) and media to Higgsfield/OpenAI
  (`/generate`). Keys live in env, never in the browser. See `ai-proxy/README.md`.
- `ops/admin-live/sync-admin-app.sh` — pushes `app/` to the live admin server
  (owner runs `PF_ADMIN_APP_DIR=… ops/admin-live/sync-admin-app.sh`).

## Cache-bust convention (IMPORTANT — do not skip)
Any change under `app/index.html`, `app/js/*.js`, or `app/phantom.css` must bump the
build id **everywhere** or browsers serve stale assets. Bump `phantom-live-YYYYMMDD-N`
(increment `N`) in all of:
- `app/index.html`: `window.PHANTOM_BUILD`, `<meta name="phantom-build">`, and every
  `?v=` (favicon, `phantom.css`, `js/main.js`).
- `app/js/main.js`: the `import … from "./character.js?v=…"` and `"./medialab.js?v=…"`.
- (public site changes: same idea in root `index.html` + `void.js`.)

## Pending / not-yet-landed work
- **`client-sim/trainer-visible-truth-20260629`** — local commit
  `66bcc31 "Add Phantom 3D character stage"` (adds `phantom-3d.js`, touches `main.js`).
  It was made in a checkout with no remote. To land it:
  ```bash
  git remote add origin https://github.com/KIDWST/phantomforce.git
  git fetch origin
  git rebase origin/main       # main.js changed heavily — EXPECT conflicts here
  git push -u origin client-sim/trainer-visible-truth-20260629
  ```
  Then open a PR. If that environment can't authenticate to push, export it and hand
  it to an agent/env that can:
  ```bash
  git bundle create /tmp/phantom-3d.bundle origin/main..HEAD   # or: git format-patch origin/main..HEAD
  ```
