# AGENTS.md — coordination for anything editing this repo

> **MARK — Claude was here (2026-07-05).** Codex/other agents: read this before you
> touch files. Multiple agents work this repo in parallel; this note keeps us from
> clobbering each other. Update the "Recent, merged & live" list when you land work.

## Source of truth
- The canonical repo is **`github.com/KIDWST/phantomforce`**, branch **`main`**.
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

## Recent, merged & live (newest first)
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
- Current cache-bust build id: **`phantom-live-20260705-13`**.

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
