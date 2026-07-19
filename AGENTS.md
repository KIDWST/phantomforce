# AGENTS.md — coordination for anything editing this repo

> **MARK — Claude was here (2026-07-05).** Codex/other agents: read this before you
> touch files. Multiple agents work this repo in parallel; this note keeps us from
> clobbering each other. Update the "Recent, merged & live" list when you land work.

## Source of truth
- The canonical repo is **`github.com/KIDWST/phantomforce`**, branch **`main`**.
- The canonical Windows editing checkout is
  `C:\Users\jorda\Documents\Codex\worktrees\phantomforce-live-social-analytics-20260712`.
  The machine serving **`admin.phantomforce.online`**, **`app.phantomforce.online`**,
  and **`127.0.0.1:5177`** uses the clean deployment checkout at
  `C:\Users\jorda\Documents\Codex\deployments\phantomforce-live`. The scheduled
  sync fast-forwards that checkout to `origin/main`; do not serve an arbitrary
  feature worktree. Before declaring a change live, verify `/health` reports the
  deployment root and its commit matches `origin/main`.
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
- Current cache-bust build id: **`phantom-live-20260718-44`**.

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
