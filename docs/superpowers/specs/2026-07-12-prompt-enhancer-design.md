# Mission Objective Prompt Enhancer — Design

Status: approved, implementing.

## Goal

Let a user type a rough mission objective and, with one click, get an
AI-improved version (clearer, more specific, better-scoped) before it's sent
to `decomposeObjective`. Reduces the "garbage in, garbage roles out" problem
at the very first step of Mission Mode.

Explicitly out of scope for this pass: enhancing prompts typed into live
worker/solo terminals (a different, larger surface — named as a possible
follow-up, not part of this spec).

## Architecture

One new module, `mission/enhance.js`, following the exact pattern of
`mission/decompose.js`: a one-shot `claude -p` call via the existing
`runClaudePrint` (`mission/claude-print.js`), requesting a JSON-schema
response so the result is structured, not free text.

```js
const ENHANCE_SCHEMA = {
  type: "object",
  properties: {
    enhancedObjective: { type: "string" },
    whatChanged: { type: "string", description: "One or two sentences on what was clarified/added, for the user's before/after review" },
  },
  required: ["enhancedObjective", "whatChanged"],
};
```

The prompt instructs Claude to preserve the user's actual intent and scope —
this is a clarity/specificity pass, not a chance to invent new goals the user
didn't ask for. Budget-capped the same way `decomposeObjective` is
(`ENHANCE_BUDGET_USD`, a small fixed ceiling passed to `runClaudePrint`).

## API

`POST /api/missions/enhance` — body `{ objective, workspaceRoot }` (mirrors
`/api/missions/decompose`'s existing validation: both required, workspace
must exist). Returns `{ ok: true, enhancedObjective, whatChanged, costUsd }`.
Errors follow the same shape as `/decompose`'s existing failure path
(`sendJson(res, 500, { ok:false, error: error.message })`).

## UI

In `renderMissionCreateStepObjective` (`public/mission.js`), an "✨ Enhance"
button sits next to the objective textarea, disabled while `objective` is
empty or `workspaceRoot` is empty (enhancement needs a workspace to inspect,
same precondition as decompose). Clicking it:

1. Disables the button, shows "Enhancing…".
2. Calls the new endpoint.
3. On success, replaces the textarea's rendering with a before/after view:
   the original text struck through/dimmed above, the enhanced text in the
   live editable textarea below, plus the one-line `whatChanged` note and
   two actions: "Use this" (already the default — just re-enables normal
   flow, textarea keeps the enhanced text, further edits allowed) and
   "Revert to original" (restores the original text into the textarea).
4. On failure, shows the same inline error pattern `mf-error` already uses,
   leaves the original text untouched.

No new state is persisted — this only affects the textarea's content before
the user proceeds to "Launch Mission →"; nothing about mission creation
itself changes downstream.

## Error handling

Consistent with the rest of Mission Mode: a failed enhancement call never
blocks mission creation — the user can always just click "Launch Mission →"
with their original (or partially edited) text regardless of whether
enhancement succeeded.

## Testing

- `tests/mission/enhance.test.mjs` — mirrors `mission/decompose.js`'s own
  testing gap (decompose.js is not directly unit-tested today since it calls
  a real `claude -p` subprocess; its schema shape is validated indirectly
  through the existing `/api/missions/decompose` route's manual verification
  instead). This spec follows the same convention: `mission/enhance.js`'s
  schema/prompt-building is simple enough that the meaningful test is a live
  manual check (Task in the implementation plan), not a mocked unit test
  that would just assert against its own hardcoded fixture.
