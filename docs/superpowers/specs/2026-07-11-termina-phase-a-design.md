# Termina Phase A — Mission Control Foundation

Status: approved, implementing.

## Goal

Improve situational awareness across the terminal wall without turning Termina into
an AI dashboard or redesigning the app. A user should be able to glance at Termina
and know what every terminal is doing, which one needs attention, and how long it's
been running — without reading terminal output.

This is Phase A of a larger effort. Explicitly out of scope here (deferred to later
phases): branch/worktree detection, the global CPU/Memory status bar, the
notification drawer, per-terminal timeline feed, and auto-extracted mission titles /
live progress-phase parsing ("Searching… Editing… Testing…"). Those all need
backend or heuristic work that doesn't belong in this pass.

## 1. Detection engine (server-side)

New `detect/` module, owned by `server.js` (which already holds the raw PTY stream
and a rolling output buffer per session).

- `detect/strip-ansi.js` — regex-based ANSI stripper, no new dependency.
- `detect/packs/{generic,claude,codex}.js` — each pack is an ordered list of rule
  objects: `{ id, label, test(strippedWindow) => bool, state, confidence, describe(match) }`.
  Adding a new provider is a new pack file + one registration line; the engine core
  never changes.
- `detect/index.js` — per-session detector. Keeps a rolling ~4KB plain-text window,
  runs the profile's pack first, then the generic pack as fallback, returns the
  highest-confidence match. Below a 0.4 confidence floor, returns
  `{ state: "unknown", confidence: 0 }` — it never guesses. Runs debounced
  (~every 200ms of buffered output per session) to bound CPU cost across many tiles.
- v0 rule sets for Claude/Codex are best-guess from known CLI conventions (spinner
  glyphs, boxed idle prompt, tool-call bullets) and are explicitly provisional.
  The generic pack (shell-prompt-return, y/n phrasing, error keywords) covers every
  profile today, including ones with no dedicated pack.

### Training mode

Opt-in per session, off by default, local-only. When enabled, every
`{ ts, provider, raw, stripped, state, confidence, ruleId }` is appended as one
JSONL line to `training/captures/<profile>/<session>.jsonl`. This directory is
gitignored — raw session transcripts never get committed.

### Replay harness

`scripts/replay-detector.mjs <fixture>` reruns the *current* detector code over a
captured file and diffs the freshly computed state against the originally recorded
state, so a rule change can be verified as an improvement rather than assumed.

### Regression tests

`tests/detect/*.test.mjs` on Node's built-in `node:test` (Node 20+, no new
dependency) against a small, curated, git-tracked fixture set — hand-picked and
promoted from real captures, not raw transcripts dumped wholesale.

### Developer view

Per-tile drawer, reached via the header's `⋯` menu → "Inspect detection": shows
current state, confidence %, matched rule id, and the raw snippet that triggered
it. Reuses the same `{type:"status", ...}` WebSocket payload already pushed for the
status pill.

## 2. Header redesign

Two compact rows, replacing today's single row (name input + type select + remove
button):

```
[icon] Terminal Name (editable, existing)  ····  ● Thinking  ⋯  ×
Mission (editable, optional)  ···········  PhantomForce · 6m42s
```

- Row A: provider glyph, the existing editable name field, status pill, overflow
  menu, close button.
- Row B (smaller/muted): new editable Mission field (separate from Name — Name is
  "what to call this tile", Mission is "what task it's doing"), project name
  (derived from `profile.cwd`, now exposed via `/api/profiles`), elapsed runtime
  (already free — server tracks `session.startedAt`).

The `⋯` menu absorbs today's bottom action row (Restart / Clear / Expand) plus
Collapse and the dev-only "Inspect detection" entry — removing that row reclaims
vertical space for the terminal viewport. Empty/unconfigured tiles keep today's
simpler form (name input + type picker) until a session starts, then swap to the
rich header.

Branch/worktree and the global stats bar are explicitly out of scope (Phase B).

## 3. Status pill language

Icon + text always — never color-only, never border-color-only:

- ○ Unknown/indeterminate — dim, shimmer
- ● Thinking — violet
- ⚡ Running — blue
- ✓ Complete — green (reuses existing `--accent`)
- ⏸ Waiting — slate
- 👤 Needs Approval — gold (reuses existing `--gold`), pulses
- ❌ Failed — red (reuses existing `--red`)

## 4. Collapse mode

Manual only — no auto-hiding a finished terminal the user still wants visible.
Offered via the `⋯` menu, meaningful once a card reaches Complete/Failed. Collapsed
state is a single strip: status pill, name/mission, provider glyph, runtime. Click
anywhere on it to re-expand.

## 5. Visual polish

Not a repaint. The existing theme (dark, blurred sticky topbar, green accent, 14px
radius, real shadows) is already close to the target. This pass tightens spacing,
extends consistent hover/focus states to the new header fields, and layers the new
status colors onto the existing palette.
