# Mission Mode Phase 1 — MVP Vertical Slice

Status: approved, implementing.

## Goal

Let the user enter one high-level objective, have Termina decompose it into
distinct non-duplicative worker roles, dispatch an individualized prompt to a
real Claude CLI terminal per role, track status/ledger events as they run, and
produce a synthesized final report — as a real, end-to-end working slice, not
a UI mockup.

This is Phase 1 of a larger effort. Explicitly deferred to later phases:
dependency-graph execution (v1 is fully-parallel only), shared-workspace
ownership/conflict-queue UI, the full approval-profile system (many
separately-controllable action categories), live process reconciliation across
a Termina restart, and the dependency/approvals/evidence sub-tabs of the
command center.

## Architecture

Workers are existing Termina wall tiles, not a separate terminal grid — each
worker is a card tagged with `card.role = {missionId, workerId, name, scope}`,
reusing the full Phase A stack (PTY session, detect engine, status pill,
header). The Mission Command Center is a modal/panel opened from a new
topbar "Missions" button, showing a worker roster table for one mission plus
mission-level controls. The wall itself is the terminal grid view — no
separate ten-panes screen.

Claude CLI plays two distinct roles:
- **Worker terminals** run Claude Code interactively, exactly like today's
  `claude` profile — unchanged, so the user can always take manual control.
- **Termina-driven one-shot calls** (`claude -p --output-format json
  --json-schema ...`, run as a detached child process, no PTY, no wall tile)
  handle role decomposition and final report synthesis. Verified live against
  the real Termina repo: `claude -p` with a JSON schema returns a validated
  `structured_output` object — no free-text parsing needed for decomposition.

## Data model

`.termina/missions/<id>/` per mission, plain files, no new dependency:

- `mission.json` — objective, workspace root, workspace strategy
  (`worktrees` | `audit`), worker roster (id, role name, scope, deliverables,
  prohibited actions, tile session id, branch/worktree path if applicable),
  status, timestamps.
- `ledger.jsonl` — append-only structured events (`STARTED`, `FILE_CLAIM`,
  `BLOCKER`, `QUESTION`, `PROPOSED_CHANGE`, `CHANGE_APPLIED`, `TEST_RESULT`,
  `HANDOFF`, `COMPLETE`, `FAILED`), parsed from worker output by a resilient
  line-matcher (`TERMINA_EVENT: {json}`). Malformed or missing markers just
  leave status as whatever the Phase A detector last saw; the user can
  manually correct a worker's status from the command center.
- `report.md` — final synthesis output, written once triggered.

## Dispatch mechanism

1. Launch each worker on the existing `claude` profile, cwd'd into its
   worktree (or the shared read-only path for audit missions). Audit workers
   launch with `--permission-mode plan`; write-mode (worktree) workers launch
   with `--permission-mode default` (Claude Code's own interactive
   tool-permission prompts still apply).
2. Wait for readiness, not a fixed delay: a worker is "ready for input" once
   the existing Phase A detector reports `state === "waiting"` (the
   claude-idle-input-box rule), polled with a bounded ~20s timeout.
3. Deliver the individualized prompt via bracketed paste
   (`\x1b[200~...\x1b[201~`) over the same PTY input channel used today, so
   embedded newlines don't prematurely submit mid-prompt, followed by one
   explicit Enter once the paste block closes.
4. Approval story for v1: audit workers can't write (enforced by
   `--permission-mode plan`); write-mode workers keep Claude Code's own
   interactive permission prompts, which the Phase A detector already
   classifies as `needs_approval` and surfaces as a status pill.
5. Recovery in v1 is honest: mission files survive a restart and are always
   shown as historical/stopped, never fake-live, since PTYs die with the
   server today.

## Worker prompt structure

Each worker receives:

```
SHARED MISSION
[objective]

YOUR ROLE
Worker <n> — <role name>

YOUR EXCLUSIVE SCOPE
[scope]

WORKSPACE
[cwd, branch/worktree if applicable]

DELIVERABLES
[deliverables]

DO NOT
[prohibited]

REPORTING PROTOCOL
Periodically emit a line of the form:
TERMINA_EVENT: {"type":"<STARTED|DISCOVERY|FILE_CLAIM|BLOCKER|QUESTION|
PROPOSED_CHANGE|CHANGE_APPLIED|TEST_RESULT|HANDOFF|COMPLETE|FAILED>", ...}
so Termina's command center can track your progress.
```

## Git worktree handling

Branch naming: `termina/mission-<id>/<worker-slug>`. Worktree path:
`<parent-of-repo>/.termina-worktrees/<repo-name>-mission-<id>-<worker-slug>`
(kept outside the tracked repo so it never pollutes `git status`). Before
creating: verify the workspace root is a git repo; if the target worktree
path already exists, check it for uncommitted changes and refuse rather than
silently reusing a dirty directory. Removing a worktree is a manual,
user-confirmed action; branches are never deleted automatically.

## Command center (v1 scope)

One view: a worker roster table (role, tile, status, current activity from
the last ledger event, files claimed if reported, elapsed time) with
open-terminal / stop / retry actions per worker, plus a mission-level
"Trigger Synthesis" action and a plain report viewer. Dependency graph,
approval-profile UI, and diff/evidence viewer are Phase 2+.
