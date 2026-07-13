# Smart Prompter — Design

Status: approved, implementing.

## Goal

Fix a real bug and a real architecture gap in the mission-creation objective
box (what the user calls "the prompter"): every objective was routed
through `decomposeObjective`, which only ever produces AI-agent worker
roles — and since `mission/decompose.js`'s role schema never asked for a
`provider` at all, `role.provider` was always `undefined`, so
`createMissionWorkers` silently defaulted every worker to `"claude"`
regardless of what was actually asked for. A request like "open different
PowerShell prompts with different color matrix rain" — a literal,
direct instruction to open terminals and run something, not a task that
benefits from an AI agent investigating/editing anything — got turned into
4 Claude Code chat sessions.

The deeper fix isn't "let the AI agent pick pwsh as a worker" — plain
shells have no permission-mode concept (`mission/adapters.js` only defines
`claude`/`codex`/`openrouter` for exactly this reason: Termina can't
guarantee "plan mode" safety for a shell that has no such concept). The fix
is recognizing this class of request should never enter Mission Mode's
agentic pipeline at all.

## Architecture

### `mission/classify.js` (new)

One-shot `claude -p` call (same `runClaudePrint` pattern as
`decompose.js`/`synthesize.js` — full-quality default model, not the fast
one `enhance.js` uses, since generating a *correct* startup command matters
more here than raw speed) that classifies the objective before anything
else happens:

```js
const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["direct", "mission"] },
    tiles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          profileId: { type: "string" },
          name: { type: "string" },
          startupCommand: { type: "string" },
        },
        required: ["profileId", "name"],
      },
    },
  },
  required: ["kind"],
};
```

The prompt is given the caller's *real* list of available profile ids
(`loadProfiles().map(p => p.id)`, e.g. `pwsh, codex, claude, openrouter,
cmd, wsl, python, node`) so `profileId` can never be invented — a second,
pure exported function in the same module, `validateTiles(tiles,
knownProfileIds)`, substitutes `"pwsh"` for any returned `profileId` not in
that list before anything drives real process spawning. Kept as its own
exported function (not inlined into the API route) specifically so it's
directly unit-testable — nothing in this codebase's test suite imports
`server.js` itself.

Classification guidance in the prompt: `"direct"` = the objective is
literally about opening/arranging terminal windows, running specific
commands, or displaying something — no multi-step investigation or code
changes implied. `"mission"` = the objective describes a goal that needs an
agent to read/write files, run tests, or make real changes across steps.
If the objective doesn't specify how many tiles or their count is implied
loosely (e.g. "different colors"), use judgment the same way
`decomposeObjective` already does for worker count ("typically 2-6").

### API — `POST /api/prompter/classify`

Body `{ objective, workspaceRoot }` (same validation as `/api/missions/decompose`:
both required, workspace must exist — `workspaceRoot` is unused for
`direct` results but kept as a required field to avoid changing the
existing form validation). Returns `{ ok: true, kind, tiles, costUsd }`,
with `tiles` already passed through `validateTiles` before being sent.

## UI — `renderMissionCreateStepObjective`'s `mf-go` handler

Before today's `POST /api/missions/decompose` call, first call
`/api/prompter/classify`. On `kind === "mission"`: proceed exactly as
today, byte-for-byte unchanged (the entire roles-review/launch flow is
untouched). On `kind === "direct"`: skip Mission Mode entirely —

1. Close the mission modal immediately (`closeMissionModal()`), back to the wall.
2. For each tile spec, call the existing global `addCard({name, profileId}, {start:true})`
   (the exact function the `+` add-terminal button already uses) — this
   opens a real wall tile and starts a real session via the existing
   `/api/sessions/:id/start` route, no new session-management code needed.
3. If a tile has a `startupCommand`, wait ~700ms after `addCard` (generous
   for a local shell's cold-start — plain shells don't have the
   multi-second boot time an agentic CLI does, so no need for the
   heavier `waitForReady`/bracketed-paste machinery Mission dispatch uses)
   then send it directly over that card's own WebSocket
   (`card.ws.send(JSON.stringify({type:"input", data: command + "\r"}))`) —
   a plain single-line write is sufficient for a plain shell prompt,
   unlike the ink-based CLI UIs `mission/paste.js`'s bracketed-paste
   dance was built for.

No mission.json, no ledger, no worktree — direct tiles are exactly the
same kind of tile the `+` button already creates, just opened
programmatically from one text description instead of one at a time by
hand.

## Error handling

A failed classify call surfaces the same inline `mf-error` pattern the
Enhance button already uses — the user can retry, nothing silently falls
back to a possibly-wrong default (in particular, never silently falling
back to the old "always decompose as a mission" behavior, since that's the
literal bug this fixes).

## Testing

- `classifyPrompt` itself has no direct unit test — it wraps a real
  `claude -p` subprocess call, matching the exact same established
  convention as `decompose.js` and `enhance.js` (neither has one either).
- `tests/mission/classify.test.mjs` — `validateTiles`, the pure exported
  function: a valid profileId passes through unchanged; an
  invented/unknown profileId is replaced with `"pwsh"`; a missing/empty
  `tiles` array (the `kind: "mission"` case) passes through as `[]`
  untouched.
- Manual verification (implementation plan): type "open 3 PowerShell
  windows with matrix rain in different colors" into the mission box,
  confirm 3 plain `pwsh` tiles open (not Claude CLIs) each running a
  colored animation; type a real objective ("audit this repo's error
  handling") and confirm the existing roles-review Mission flow is
  completely unaffected.
