# Mission DVR + Token Tracker — Design

Status: approved, implementing.

## Goal

Give Mission Mode a capability no other terminal manager has: a scrubbable,
synchronized recording of every worker in a mission, the ability to branch a
brand-new live worker from any past checkpoint, and honest real-time
token/cost tracking per worker and per mission. This is deliberately built to
be hard to copy — it requires the exact combination Termina already has
uniquely (raw ConPTY access via node-pty, the Mission Mode ledger, and git
worktree isolation) rather than any single new UI widget.

Explicitly out of scope for this pass: full OS/process-memory snapshotting
(no CRIU-equivalent on Windows), cross-machine/cloud sync of recordings,
editing/trimming recordings, and non-git workspaces (checkpointing requires a
git repo, same precondition Mission Mode's worktree isolation already has).

## Non-goal clarification (read this first)

"Branch from a checkpoint" is **filesystem + transcript time-travel, not
process resurrection**. A branched worker gets the worktree's files restored
to that point in time, plus a summary of what happened, and starts a *fresh*
live agent process from there. It does not resume a paused Node process, an
in-memory REPL, a running dev server, or an open network connection. This
must be stated in the UI wherever branching is offered, not just in this doc.

## Architecture

Four new modules under `mission/`, following the existing plain-file,
no-database convention (`mission/store.js`), plus surgical additions to
`server.js` and `public/mission.js`. No new dependencies.

### 1. Recorder (`mission/recorder.js`)

Per worker session, appends raw PTY output frames to
`.termina/missions/<id>/recordings/<workerId>.jsonl`:

```
{"ts": 1752345678901, "seq": 42, "data": "<raw PTY bytes, base64>"}
```

Hooked into the existing `session.proc.onData` callback in `server.js`
(alongside `broadcast`, `maybeAutoTrust`, `feedDetector`), gated by
`session.missionId != null` — solo (non-mission) tiles are never recorded.
Best-effort: a write failure is caught and swallowed, exactly like
`captureDetection` today. `seq` is a per-session monotonic counter (not
`Date.now()`-derived) so frame order survives even if the clock doesn't
strictly increase between two same-millisecond writes.

### 2. Checkpoint manager (`mission/checkpoint.js`)

Listens to the same parsed `TERMINA_EVENT` stream `feedMissionProtocol`
already produces in `server.js`. On a qualifying event type — `FILE_CLAIM`,
`PROPOSED_CHANGE`, `CHANGE_APPLIED`, `COMPLETE`, `FAILED` — snapshots the
worker's worktree via `git stash create` (produces a commit-ish object
without touching the index, the working tree, or the worker's real branch;
safe to call on a clean tree too, where it simply resolves to `HEAD`).  The
resulting SHA is appended to `.termina/missions/<id>/checkpoints.jsonl`:

```
{"ts": 1752345680000, "workerId": "w1", "sha": "a1b2c3d", "ledgerEventType": "PROPOSED_CHANGE"}
```

Only applies to workers with `worker.branch` set (i.e., `mission.isolated`
worktree workers) — shared-folder (non-isolated) or plan-mode (read-only)
workers produce no checkpoints, since there's nothing meaningful to branch
into for either (plan mode never writes; shared-folder branching would
collide with every other worker's live files). Checkpoint failures (e.g.
`git stash create` erroring on a mid-operation repo) are caught, logged as a
`{type: "termina_debug"}` ledger note, and never block the mission.

### 3. Token tracker (`mission/tokens.js`)

Per-provider adapter, same shape as `AGENT_PROVIDERS` in `mission/adapters.js`:

```js
export const TOKEN_ADAPTERS = {
  claude: { findTranscript(cwd, startedAt) => filePath|null, readUsage(filePath) => {inputTokens, outputTokens, cacheTokens, costUsd}[] },
  codex:  { ... same shape, or null if no local log format is confirmed },
};
```

Claude Code writes per-turn transcripts to a local JSONL log Termina can tail
by matching cwd + session start time; each turn's `usage` block gives real
input/output/cache token counts, and cost is computed via Claude Code's own
documented per-model rates. Where a provider has no confirmed local log
format (or the adapter can't find/parse it), the tracker falls back to a
`chars-seen / 4` estimate against the recorder's own frame log, and every
value derived this way is tagged `estimated: true` end to end — the UI must
render an "≈" prefix and a tooltip explaining it's an estimate, never present
it as equal-confidence to real usage data.

Polled on the same debounce cadence as the status detector (every
`DETECTOR_TICK_MS`, piggybacked onto the existing `feedDetector` timer rather
than a second timer), and pushed to clients as a new WebSocket message type:

```
{"type": "tokens", "workerId": "w1", "inputTokens": 8213, "outputTokens": 2117, "costUsd": 0.31, "estimated": false}
```

Also aggregated mission-wide and included in the existing
`GET /api/missions/:id` response and the ledger-adjacent
`.termina/missions/<id>/tokens.json` (a small rollup file, rewritten on each
poll — not append-only like the ledger, since it's current totals, not
events).

### 4. Timeline UI + branch action (`public/mission.js`, `public/timeline.js`)

New "Timeline" tab in the existing Mission Command Center (alongside the
current roster table), reusing its data-fetch/render pattern:

- A horizontal scrub bar spanning the mission's elapsed duration, with one
  track per worker underneath the bar itself.
- Checkpoint tick marks on each worker's track, positioned by timestamp,
  colored by the ledger event type that produced them (reuses the existing
  `STATUS_META`-style icon/color convention from `app.js`).
- A thin token-cost sparkline rendered under each worker's track (cumulative
  `costUsd` over time from `tokens.json` history — the rollup file above
  additionally appends one `{ts, workerId, costUsd}` sample per poll to
  `tokens-history.jsonl` for this purpose), so cost spikes visually line up
  with checkpoints.
- Dragging the playhead re-renders every worker's terminal pane from that
  worker's `recordings/<workerId>.jsonl`, replaying frames up to the
  scrubbed timestamp into a **read-only, detached xterm.js instance** — this
  never touches the live PTY session or its WebSocket; the live wall tile is
  completely unaffected by scrubbing. A visible "REPLAY — <timestamp>" badge
  distinguishes this from the live view, with a one-click "Back to live" exit.
- Clicking a checkpoint tick opens a small popover: "Branch from here" with
  a one-line explanation of the filesystem-only caveat above, plus a text
  field for an optional extra note to the new worker. Confirming calls a new
  endpoint (below), which opens a brand-new wall tile for the branched
  worker — the original worker's tile and process are untouched.

## API additions

- `GET /api/missions/:id/recordings/:workerId` — returns the raw frame JSONL
  (or a 404 if recording was never enabled for that worker, e.g. it predates
  this feature or was a non-isolated/plan worker).
- `GET /api/missions/:id/checkpoints` — returns `checkpoints.jsonl` parsed.
- `GET /api/missions/:id/tokens` — returns the current rollup plus history
  samples for the sparkline.
- `POST /api/missions/:id/workers/:workerId/branch` — body
  `{ checkpointSha, note? }`. Validates the SHA resolves in the worker's
  repo (`git cat-file -e`), creates a new worktree from it via a new
  `createWorktreeFromRef` in `mission/worktree.js` (a thin generalization of
  the existing `createWorktree`, which currently always branches from
  `HEAD` — this pass adds an explicit `ref` parameter, defaulting to `HEAD`
  so existing callers are unchanged), assigns a new worker id/branch name
  (`termina/mission-<id>/<slug>-branch-<n>`), launches it with the same
  provider/mode as the original plus the ledger-derived context block
  (reuses `buildWorkerPrompt`, extended with an optional "RESUMING FROM
  CHECKPOINT" section), and appends the new worker to `mission.json` and a
  `BRANCHED` ledger event type (added to `EVENT_TYPES` in
  `mission/protocol.js`, source `"termina"`, since only Termina itself emits
  it, never a worker).

## Error handling

Consistent with the rest of Mission Mode's "best-effort, never block the
mission, never fake data" philosophy already established in
`captureDetection` and `feedMissionProtocol`:

- Recorder/checkpoint/token-tail failures: caught, swallowed or logged as a
  debug ledger note, never thrown into the mission dispatch path.
- Missing/corrupted recording file for a worker: that worker's timeline
  track renders "recording unavailable" instead of breaking the whole
  timeline view.
- Branch request against a checkpoint SHA that no longer resolves (e.g. `git
  gc` ran): the branch endpoint returns a clear `400 checkpoint_not_found`
  rather than silently creating an empty worktree.
- Storage: recordings and checkpoints live under the existing
  `.termina/missions/<id>/` tree (already gitignored), user-owned, never
  auto-deleted.

## Testing

Extends the existing `node --test` suite (`tests/`), following the same
fixture-driven style as `tests/detect/*.test.mjs` and the current worktree
tests ("createWorktree creates a real isolated branch + worktree, removeWorktree
tears it down"):

- `tests/mission/recorder.test.mjs` — frame append/read round-trip,
  corrupted-line handling (one bad JSON line doesn't drop the rest).
- `tests/mission/checkpoint.test.mjs` — given a sequence of ledger events,
  the correct checkpoints are created; non-isolated/plan workers produce
  none; a `git stash create` failure doesn't throw.
- `tests/mission/tokens.test.mjs` — estimated-fallback math is correct and
  always tagged `estimated: true`; real-adapter parsing against a fixture
  transcript file produces the right totals.
- `tests/mission/worktree.test.mjs` (extended) — `createWorktreeFromRef`
  with an explicit non-HEAD ref produces a worktree whose file contents
  match that ref, not HEAD.
- `tests/mission/branch.test.mjs` — end-to-end: fixture mission + fixture
  checkpoint SHA → branch endpoint → new worktree's files match the
  checkpoint, new worker appended to `mission.json`, original worker
  untouched.
