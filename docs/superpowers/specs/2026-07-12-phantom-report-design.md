# Phantom Report — Design

Status: approved, implementing.

## Goal

Replace today's freeform-markdown mission synthesis with a structured
"Phantom Report": a fixed-shape summary — what happened, what each worker
found, and a concrete list of next steps the user can approve or skip one at
a time. Today's `synthesizeMission`/`renderReportMarkdown` already do real
synthesis (independently verifying worker claims via `claude -p`); this pass
restructures its *output shape* so next steps become individually
actionable UI items instead of one prose paragraph.

Explicitly out of scope: auto-launching an approved next step as a new
mission (a much bigger scope reusing the whole mission-creation pipeline
programmatically) — approving is bookkeeping only in this pass; the user
still acts on it manually.

## Architecture

### Schema change (`mission/synthesize.js`)

`REPORT_SCHEMA` changes shape: the existing fields
(`workCompleted`/`filesChanged`/`testsRun`/`verifiedCompletion`/
`claimedCompletion`/`unresolvedWork`/`conflictingFindings`/
`failedOrIncomplete`/`recommendedIntegrationOrder`) are kept as-is — this is
still the same independently-verified synthesis, not a weaker one — but two
fields change shape:

- `workerFindings`: **new**, replaces treating findings as scattered across
  the generic arrays above with one explicit per-worker array:
  `{ workerId: string, workerName: string, found: string }[]` — "what this
  specific worker found," directly answering "these workers found this."
- `nextSteps`: **replaces** the old freeform `suggestedNextMission: string`
  with a structured array of `{ description: string, rationale: string }[]`
  — each one individually approvable, instead of one paragraph. The model is
  *not* asked to generate an `id` for each step (unreliable — could collide
  or be omitted); `synthesizeMission` assigns `id: "step-<n>"` by array index
  right after the schema response comes back, before anything is persisted
  or returned to the client, so ids are always present and always unique.

`decisionsNeedingUser` (existing field) is kept separately — those are
open questions the synthesis explicitly couldn't resolve, distinct from
`nextSteps`, which are concrete proposed actions.

### Approval state (new: `mission/report-approvals.js` + store functions)

Mirrors the exact pattern Mission DVR already established for
`tokens.json` in `mission/store.js`: a small rollup file,
`.termina/missions/<id>/report-approvals.json`, `{ [stepId]: "approved" |
"skipped" }`, overwritten (not appended) on each change — this is current
state, not an event log. `writeReportApproval`/`readReportApprovals` follow
`writeTokens`/`readTokens`'s exact read-modify-write-with-per-file-lock
shape (reusing the same `tokenWriteLocks`-style pattern, since concurrent
button clicks are just as possible here as concurrent worker token polls).

### API

- `POST /api/missions/:id/synthesize` (existing route) — unchanged request
  shape; response now includes the new `workerFindings`/`nextSteps` fields
  automatically since they come from the schema change above.
- `POST /api/missions/:id/report/steps/:stepId` — **new**. Body `{ decision:
  "approved" | "skipped" }`. Validates `decision` is one of those two
  values and that `stepId` exists in the last-synthesized report's
  `nextSteps` (report.md's structured form is also persisted as
  `report.json` alongside the existing `report.md`, so the server can look
  up valid step ids without re-parsing markdown). Returns `{ ok: true,
  approvals }`.

`writeReport` (existing, `mission/store.js`) gains a sibling
`writeReportJson`/`readReportJson` pair, following `writeReport`/
`readReport`'s exact existing shape — `report.md` stays the
human-readable rendering (still produced by `renderReportMarkdown`, updated
for the new sections below); `report.json` is the same `report` object the
schema returns, stored so `nextSteps` ids survive a page reload without
re-running synthesis.

## Rendering

`renderReportMarkdown` (`mission/synthesize.js`) gains two sections,
replacing the old single "Suggested next mission" section:

```
## What each worker found
- Worker 1 (Backend Auditor): <found>
- Worker 2 (Frontend Auditor): <found>

## Next steps
1. <description> — <rationale>
2. <description> — <rationale>
```

In `public/mission.js`, `renderMissionReport` (currently a single `<pre>` of
raw markdown) is replaced with a structured renderer: the heading becomes
"Phantom Report" (not "Mission Report"), the summary/findings sections
render as today's markdown-in-a-`<pre>` still does (no need to reinvent
prose rendering), but the "Next steps" section renders as a real list, one
row per step: description + rationale text, plus **Approve**/**Skip**
buttons (reusing the existing `smallMissionBtn` helper). A step already
recorded in `report-approvals.json` shows its resolved state (a green
"✓ Approved" / muted "Skipped" tag) instead of the two buttons, and clicking
either button calls the new endpoint then re-renders just that row from the
response — not a full report re-fetch, so approving one step doesn't cause
a jarring full re-render of the whole report while you're still reading it.

## Error handling

Consistent with the rest of Mission Mode: an approval-state write failure
surfaces as a small inline error next to that row (not a modal, not a
blocked UI) and leaves the row in its pre-click state so the user can retry;
it never blocks reading the rest of the report or re-triggering synthesis.

## Testing

- `tests/mission/store.test.mjs` (extended) — `writeReportJson`/
  `readReportJson` round-trip, mirroring the existing `report.md` round-trip
  test already in that file.
- `tests/mission/report-approvals.test.mjs` — `writeReportApproval`/
  `readReportApprovals` round-trip; concurrent writes to two different step
  ids both land (mirrors the concurrency guarantee `writeTokens` already
  has, and should reuse its exact locking approach); an unknown-shaped
  existing file doesn't crash the reader (matches every other `read*`
  function's corrupted-file handling in `mission/store.js`).
- Manual verification (Task in the implementation plan): trigger a real
  synthesis on a small live mission, confirm `nextSteps` render as
  individually-clickable rows, confirm Approve/Skip persists across a
  mission-detail re-render.
