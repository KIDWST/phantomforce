# PhantomBot ⇄ Termina Mission Bridge

## Problem

Termina's Mission Mode (`mission/`) already decomposes an objective into
multiple worker roles and dispatches each to an isolated Claude/Codex CLI
worker in its own git worktree — but the only way to use it is the Termina
GUI's "Missions" modal. PhantomBot (`Phantombot-Unleashed`, a separate local
AI operator with a desktop chat GUI and Discord/voice bridges) has no
connection to it at all.

Goal: trigger a Termina mission — 2 to 20 parallel CLI agent workers — from a
single chat message to PhantomBot, from the desktop or from Discord, without
touching Termina's UI.

## Architecture

Two separate processes, unchanged from today — no code is ported or merged
between the two codebases:

```
Discord (phone) ──► PhantomBot Discord bridge ──► PhantomBot process (this PC)
                                                          │
Desktop chat ─────────────────────────────────────────►  │  HTTP, 127.0.0.1 only
                                                          ▼
                                              Termina server.js (:7420)
                                                          │
                                          mission/decompose.js → mission/*.js
                                                          │
                                        N × Claude/Codex CLI worker processes
                                            (isolated git worktrees)
```

PhantomBot becomes an HTTP client of Termina's existing mission API
(`/api/missions/decompose`, `/api/missions`, `/api/missions/:id`). No mission
logic is duplicated into PhantomBot. Termina keeps binding to `127.0.0.1`
only — Discord's cloud relay never touches it directly; only the local
PhantomBot process does.

### Auth

Termina currently generates a random `TERMINA_TOKEN` per launch unless the
env var is pre-set. The bridge requires a **pinned, shared token**: both
processes read the same value from a local config file
(`termina-bridge.config.json`, gitignored, holds `{ "terminaToken": "...",
"terminaUrl": "http://127.0.0.1:7420" }`). This is required so PhantomBot can
auto-launch Termina and know its token before Termina has generated one.

### Auto-launch

New `ensureTerminaRunning()` in PhantomBot:
1. `GET /api/health`. If it responds, proceed.
2. If unreachable, spawn Termina's Electron shell the same way
   `Install-Termina-StartMenu.ps1` does (`electron.exe .` from
   `C:\Users\jorda\Termina`, not a packaged build).
3. Retry health check for up to 30s (backoff), then fail with a clear error
   if it still isn't up.

## PhantomBot changes

### New tools (added to the existing LLM tool-loop)

- **`start_mission(objective, mode, workspaceHint?)`**
  - `mode` is required: `"auto" | "approval" | "plan"`. Never defaulted or
    inferred from phrasing — always either explicit in the command, from the
    stored user default (see below), or asked for.
  - Calls `POST /api/missions/decompose` then `POST /api/missions` on
    Termina. Returns `{ missionId, missionName, roles }`.
- **`get_mission_status(missionId)`**
  - Calls `GET /api/missions/:id`. Returns worker statuses + ledger tail.

Both tools sit alongside PhantomBot's existing tools (`run_visible_terminal`,
`write_and_run`, etc.) in the same schema, so the bot's own LLM can choose
`start_mission` for a plain-language request ("go fix the leaderboard bug and
audit the payment webhook") exactly as it already chooses between its other
tools today.

### Trigger syntax

`/mission` and `/termina` are aliases, both forcing `start_mission`
immediately:

```
/mission auto fix the leaderboard race condition and audit the payment webhook
/termina approval refactor the asset loader
```

First token after the command is the mode. If missing/invalid, PhantomBot
asks a single follow-up ("auto or approval?") rather than guessing — unless
a stored default exists (see below).

Plain-language triggering (no slash command) always asks for the mode before
calling `start_mission`, unless a stored default exists.

### Persistent mode default

`/mission set-default auto|approval|ask` stores a preference in PhantomBot's
local config. When set to `auto` or `approval`, future missions (slash or
plain-language) skip the mode question and use it. `ask` (the initial
default) always asks.

### Workspace inference

A small LLM call matches the objective text against known project roots,
sourced from Termina's `GET /api/repos` plus a small PhantomBot-side
allowlist for anything outside Termina's scan roots. Below a confidence
threshold, or on a tie between two projects, PhantomBot asks the user to
confirm/pick. No match at all → asks the user to name the folder. Never
silently guesses and proceeds on a low-confidence match, since a mission can
edit files.

### Status relay

Once a mission starts, PhantomBot polls `GET /api/missions/:id` every 7s
while `status === "running"`. On each poll it diffs worker statuses against
the last-seen snapshot and posts an update **only on a state transition**
(worker started/blocked/completed/failed) — not every tick, to avoid
spamming Discord. Local desktop-chat missions render the same updates inline
in PhantomBot's own window.

On mission completion, the synthesized report (`mission/synthesize.js`'s
`renderReportMarkdown`) is posted as the final message. If it exceeds
Discord's 2000-character message limit, it's attached as a `.md` file instead
of being split across multiple messages.

## Termina-side change: worker cap 10 → 20

- `server.js`, `/api/missions/decompose` handler: change
  `Math.max(2, Math.min(10, rawCount))` to `Math.max(2, Math.min(20, rawCount))`.
- `mission/decompose.js` prompt text: update the "typically 2-6" guidance to
  note the ceiling is now 20, while keeping "don't split into more roles than
  there is real independent work" unchanged. The cap is a ceiling, not a
  target — a 2-role bugfix objective must still get 2 workers, not 20 padded
  ones. This is existing, deliberate behavior and is not being changed by
  this work.

## Error handling

- Termina unreachable after auto-launch retries → clear error surfaced to
  the user (Discord or desktop), no infinite retry loop.
- `objective_required` / `workspace_root_invalid` from Termina's API →
  translated to plain English, not raw JSON, and surfaced to the user.
- Ambiguous/no workspace match → confirmation question (see above).
- Missing/invalid mode → confirmation question (see above), unless a stored
  default applies.
- A worker fails/blocks after mission creation → already surfaced via
  Termina's own ledger/status mechanism; the status-relay poller reports it
  like any other state transition. No special-case handling needed in
  PhantomBot.
- Token mismatch on first-time setup (shared config not yet created) → a
  one-time setup error directing the user to create
  `termina-bridge.config.json` with a token, rather than a generic 401.

## Testing

- **Unit**: `start_mission` / `get_mission_status` tool handlers tested
  against a mocked Termina HTTP server — correct API calls, error
  translation, mode-required enforcement, workspace-confidence threshold
  behavior.
- **Worker-cap change**: `/api/missions/decompose` accepts `workerCount` up
  to 20 and clamps above it; a simple objective with `workerCount` omitted
  still returns 2-6 roles (confirms raising the ceiling didn't change default
  decomposition behavior).
- **Auto-launch**: with Termina not running, PhantomBot starts it and
  proceeds; with Termina already running, it's detected and not
  double-launched.
- **Integration (manual)**: real Termina running locally, `/mission approval
  <small test objective>` against a scratch repo — confirm workers launch,
  status updates arrive, final report posts correctly.
- **Discord (manual)**: trigger a mission from the Discord bridge, confirm
  the full round-trip including status updates and final report/attachment.

## Out of scope

- Porting mission logic into PhantomBot (rejected during design — see
  Architecture).
- A push/event feed from Termina (webhooks/SSE) for mission status — polling
  is sufficient for chat-relay latency needs; building push infrastructure
  for this is not justified.
- Changing Termina's default decomposition role count (2-6) — only the
  ceiling moves, not the target.
