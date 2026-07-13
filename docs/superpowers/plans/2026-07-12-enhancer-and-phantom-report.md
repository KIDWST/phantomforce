# Prompt Enhancer + Phantom Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mission-objective AI enhancer, and restructure mission synthesis into "Phantom Report" — a structured summary with per-worker findings and individually approve/skip-able next steps.

**Architecture:** Two independent additions to Mission Mode. The enhancer is a new `mission/enhance.js` module (same one-shot `claude -p` pattern as `mission/decompose.js`) plus one API route and a UI button. Phantom Report changes `mission/synthesize.js`'s schema/rendering, adds a small approvals rollup file (`mission/store.js`, same pattern as the existing `tokens.json`), one new API route, and a UI rewrite of `renderMissionReport`.

**Tech Stack:** Node 20+ built-in `node:test`, existing `runClaudePrint`/`claude-print.js`, vanilla JS frontend (no framework, matches existing `public/*.js`).

## Global Constraints

- No new npm dependencies.
- All new mission-scoped files live under `.termina/missions/<id>/` (already gitignored).
- Every new store read function must handle a missing/corrupted file the same way every existing one in `mission/store.js` does (return an empty/default value, never throw).
- Neither feature blocks or changes existing mission-creation/synthesis behavior when unused — both are additive.
- Follow `public/mission.js`'s real conventions (plain global scripts, no ES `import`/`export`, `api(path, options)` fetch wrapper, `escapeHtml`, `smallMissionBtn`) — confirmed in the Mission DVR implementation; do not reintroduce ES module syntax in frontend files.

---

### Task 1: `mission/enhance.js`

**Files:**
- Create: `mission/enhance.js`

**Interfaces:**
- Consumes: `runClaudePrint` from `mission/claude-print.js` (existing, unchanged signature: `{prompt, jsonSchema, cwd, maxBudgetUsd, timeoutMs, scratchDir}`).
- Produces: `enhanceObjective({ objective, workspaceRoot, scratchDir }) -> Promise<{ enhancedObjective: string, whatChanged: string, costUsd: number|null }>`.

This mirrors `mission/decompose.js` exactly, including its testing
convention (no unit test — the meaningful check is live, since it wraps a
real `claude -p` subprocess call; see Task 6).

- [ ] **Step 1: Write the implementation**

```js
// mission/enhance.js
// One-shot `claude -p` call that clarifies/sharpens a rough mission
// objective before decomposition — a specificity pass, not license to
// invent goals the user didn't ask for. Same pattern as decompose.js.
import { runClaudePrint } from "./claude-print.js";

const ENHANCE_SCHEMA = {
  type: "object",
  properties: {
    enhancedObjective: { type: "string" },
    whatChanged: {
      type: "string",
      description: "One or two sentences on what was clarified/added, for the user's before/after review",
    },
  },
  required: ["enhancedObjective", "whatChanged"],
};

const ENHANCE_BUDGET_USD = 1;

export async function enhanceObjective({ objective, workspaceRoot, scratchDir }) {
  const prompt =
    `You are sharpening a rough mission objective for a team of parallel Claude Code agents, ` +
    `BEFORE it gets split into worker roles. Make it clearer and more specific — add concrete scope, ` +
    `success criteria, or constraints that are obviously implied but unstated. ` +
    `Do NOT invent new goals, requirements, or scope the user didn't ask for; ` +
    `preserve their actual intent exactly, just make it sharper.\n\n` +
    `ROUGH OBJECTIVE:\n${objective}\n\n` +
    `If useful, inspect the actual working directory before answering.`;

  const result = await runClaudePrint({
    prompt,
    jsonSchema: ENHANCE_SCHEMA,
    cwd: workspaceRoot,
    maxBudgetUsd: ENHANCE_BUDGET_USD,
    scratchDir,
  });

  const enhanced = result.structured_output?.enhancedObjective;
  if (!enhanced) throw new Error("enhancement did not return an enhanced objective");
  return {
    enhancedObjective: enhanced,
    whatChanged: result.structured_output?.whatChanged || "",
    costUsd: result.total_cost_usd ?? null,
  };
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check mission/enhance.js`
Expected: no output (valid syntax).

- [ ] **Step 3: Commit**

```bash
git add mission/enhance.js
git commit -m "Add mission objective prompt enhancer"
```

---

### Task 2: `/api/missions/enhance` route

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `enhanceObjective` (Task 1).

- [ ] **Step 1: Import it**

Add alongside the existing `import { decomposeObjective } from "./mission/decompose.js";` line in `server.js`:

```js
import { enhanceObjective } from "./mission/enhance.js";
```

- [ ] **Step 2: Add the route**

Insert directly after the existing `/api/missions/decompose` route block in `server.js` (same validation shape as that route):

```js
  if (pathName === "/api/missions/enhance" && req.method === "POST") {
    readJsonBody(req)
      .then(async (body) => {
        const objective = String(body.objective ?? "").trim();
        const workspaceRoot = String(body.workspaceRoot ?? "").trim();
        if (!objective) return sendJson(res, 400, { ok: false, error: "objective_required" });
        if (!workspaceRoot || !existsSync(workspaceRoot)) return sendJson(res, 400, { ok: false, error: "workspace_root_invalid" });
        const { enhancedObjective, whatChanged, costUsd } = await enhanceObjective({ objective, workspaceRoot, scratchDir: missionScratchDir });
        return sendJson(res, 200, { ok: true, enhancedObjective, whatChanged, costUsd });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }
```

- [ ] **Step 3: Syntax-check**

Run: `node --check server.js`
Expected: no output.

- [ ] **Step 4: Run the existing full test suite (nothing should break)**

Run: `npm test`
Expected: PASS, same count as before this plan (69).

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "Add /api/missions/enhance route"
```

---

### Task 3: Enhance button UI

**Files:**
- Modify: `public/mission.js` (inside `renderMissionCreateStepObjective`)

**Interfaces:**
- Consumes: `POST /api/missions/enhance` (Task 2); existing globals `api`, `escapeHtml`.

- [ ] **Step 1: Read the current `renderMissionCreateStepObjective` in full before editing**

It's at `public/mission.js` around line 267 — read the whole function (through where `mf-go`'s click handler ends) so the new button's markup/handler matches its existing style and doesn't duplicate the `mf-error` element.

- [ ] **Step 2: Add the button markup**

In the template string inside `renderMissionCreateStepObjective`, change:

```html
    <label>What's the objective?<textarea id="mf-objective" rows="3" placeholder="Prepare PhantomForce for launch. Audit the frontend, backend, security, tests, and deployment readiness.">${escapeHtml(state.objective)}</textarea></label>
```

to:

```html
    <label>What's the objective?<textarea id="mf-objective" rows="3" placeholder="Prepare PhantomForce for launch. Audit the frontend, backend, security, tests, and deployment readiness.">${escapeHtml(state.objective)}</textarea></label>
    <div class="mission-enhance-row">
      <button type="button" id="mf-enhance" class="ghost">✨ Enhance</button>
      <span id="mf-enhance-note" class="mission-enhance-note"></span>
    </div>
```

- [ ] **Step 3: Wire up the handler**

Add this after the existing `document.getElementById("mf-cancel").addEventListener(...)` block (before the `mf-go` handler), in `renderMissionCreateStepObjective`:

```js
  document.getElementById("mf-enhance").addEventListener("click", async () => {
    const textarea = document.getElementById("mf-objective");
    const workspaceRoot = document.getElementById("mf-workspace").value.trim();
    const objective = textarea.value.trim();
    const errorEl = document.getElementById("mf-error");
    const noteEl = document.getElementById("mf-enhance-note");
    errorEl.classList.add("hidden");

    if (!objective || !workspaceRoot) {
      errorEl.textContent = "Type an objective and choose a workspace first.";
      errorEl.classList.remove("hidden");
      return;
    }

    const btn = document.getElementById("mf-enhance");
    const original = objective;
    btn.disabled = true;
    btn.textContent = "Enhancing…";
    try {
      const res = await api("/api/missions/enhance", {
        method: "POST",
        body: JSON.stringify({ objective, workspaceRoot }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "enhancement failed");
      textarea.value = res.enhancedObjective;
      noteEl.innerHTML = `${escapeHtml(res.whatChanged)} <button type="button" id="mf-enhance-revert" class="ghost">Revert to original</button>`;
      document.getElementById("mf-enhance-revert").addEventListener("click", () => {
        textarea.value = original;
        noteEl.textContent = "";
      });
    } catch (err) {
      errorEl.textContent = `Couldn't enhance the objective: ${friendlyError(err.message)}`;
      errorEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "✨ Enhance";
    }
  });
```

- [ ] **Step 4: Add minimal styles**

Append to `public/styles.css` (reusing existing `--muted`/`--line` variables):

```css
.mission-enhance-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: -6px;
}
.mission-enhance-note {
  font-size: 12px;
  color: var(--muted);
}
.mission-enhance-note button {
  margin-left: 6px;
}
```

- [ ] **Step 5: Syntax-check**

Run: `node --check public/mission.js`
Expected: no output.

- [ ] **Step 6: Manual verification**

Run: `npm start`, open the app, open Missions → New Mission, type a rough
objective, choose a workspace, click "✨ Enhance", confirm the textarea
updates with a sharper objective and the "what changed" note + "Revert to
original" appear and both work.

- [ ] **Step 7: Commit**

```bash
git add public/mission.js public/styles.css
git commit -m "Add Enhance button to mission-creation objective step"
```

---

### Task 4: Phantom Report schema + rendering changes

**Files:**
- Modify: `mission/synthesize.js`

**Interfaces:**
- Produces: `synthesizeMission(...)` now returns `report.workerFindings: {workerId,workerName,found}[]` and `report.nextSteps: {id,description,rationale}[]` (id assigned server-side, `"step-<n>"` by index) in place of the old `suggestedNextMission: string`. `renderReportMarkdown(mission, report, costUsd)` keeps its exact existing signature.

- [ ] **Step 1: Update `REPORT_SCHEMA` and the prompt**

In `mission/synthesize.js`, replace the `REPORT_SCHEMA` object with:

```js
const REPORT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    workerFindings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          workerId: { type: "string" },
          workerName: { type: "string" },
          found: { type: "string" },
        },
        required: ["workerId", "workerName", "found"],
      },
    },
    workCompleted: { type: "array", items: { type: "string" } },
    filesChanged: { type: "array", items: { type: "string" } },
    testsRun: { type: "array", items: { type: "string" } },
    verifiedCompletion: { type: "array", items: { type: "string" }, description: "Claims you independently verified (e.g. by inspecting the diff/files yourself)" },
    claimedCompletion: { type: "array", items: { type: "string" }, description: "Worker self-reported as done, not independently verified" },
    proposedWork: { type: "array", items: { type: "string" } },
    unresolvedWork: { type: "array", items: { type: "string" } },
    conflictingFindings: { type: "array", items: { type: "string" } },
    failedOrIncomplete: { type: "array", items: { type: "string" } },
    recommendedIntegrationOrder: { type: "array", items: { type: "string" } },
    decisionsNeedingUser: { type: "array", items: { type: "string" } },
    nextSteps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["description", "rationale"],
      },
    },
  },
  required: [
    "summary",
    "workerFindings",
    "workCompleted",
    "verifiedCompletion",
    "claimedCompletion",
    "proposedWork",
    "unresolvedWork",
    "decisionsNeedingUser",
    "nextSteps",
  ],
};
```

- [ ] **Step 2: Assign step ids and update `synthesizeMission`**

Replace the body of `synthesizeMission` from `const report = result.structured_output;` down to its `return` with:

```js
  const report = result.structured_output;
  if (!report) throw new Error("synthesis did not return a structured report");
  report.nextSteps = (report.nextSteps ?? []).map((step, i) => ({ id: `step-${i + 1}`, ...step }));
  return { report, costUsd: result.total_cost_usd ?? null };
```

- [ ] **Step 3: Update `renderReportMarkdown`**

Replace the `## Suggested next mission` section at the end of
`renderReportMarkdown`'s template string with (inserted right after the
existing `**Cost:**` line, before `## Summary`, since findings-per-worker
reads best right up front — and replacing the final section):

```js
export function renderReportMarkdown(mission, report, costUsd) {
  const list = (items) => (items && items.length ? items.map((i) => `- ${i}`).join("\n") : "_none_");
  const findings = report.workerFindings?.length
    ? report.workerFindings.map((f) => `- **${f.workerName}:** ${f.found}`).join("\n")
    : "_none_";
  const steps = report.nextSteps?.length
    ? report.nextSteps.map((s, i) => `${i + 1}. ${s.description} — ${s.rationale}`).join("\n")
    : "_none_";
  return `# Phantom Report — ${mission.name}

**Objective:** ${mission.objective}

**Cost:** ${costUsd != null ? `$${costUsd.toFixed(4)}` : "unknown"}

## What each worker found
${findings}

## Summary
${report.summary}

## Work completed
${list(report.workCompleted)}

## Files changed
${list(report.filesChanged)}

## Tests run
${list(report.testsRun)}

## Verified completion (independently checked)
${list(report.verifiedCompletion)}

## Claimed completion (self-reported, not independently verified)
${list(report.claimedCompletion)}

## Proposed work (not yet applied)
${list(report.proposedWork)}

## Unresolved work
${list(report.unresolvedWork)}

## Conflicting findings
${list(report.conflictingFindings)}

## Failed or incomplete work
${list(report.failedOrIncomplete)}

## Recommended integration order
${list(report.recommendedIntegrationOrder)}

## Decisions still requiring the user
${list(report.decisionsNeedingUser)}

## Next steps
${steps}
`;
}
```

- [ ] **Step 4: Syntax-check**

Run: `node --check mission/synthesize.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add mission/synthesize.js
git commit -m "Restructure mission synthesis into Phantom Report shape: per-worker findings + approvable next steps"
```

---

### Task 5: Report + approvals persistence in `mission/store.js`

**Files:**
- Modify: `mission/store.js`
- Create: `tests/mission/report-approvals.test.mjs`
- Modify: `tests/mission/store.test.mjs` (add `report.json` round-trip test)

**Interfaces:**
- Produces: `writeReportJson(appDir, id, report)`, `readReportJson(appDir, id) -> object|null`, `writeReportApproval(appDir, id, stepId, decision: "approved"|"skipped") -> Promise<object>` (returns the full updated approvals map), `readReportApprovals(appDir, id) -> object`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/mission/store.test.mjs`, after the existing `"reading a report that was never written returns null"` test:

```js
test("report.json round-trips through writeReportJson/readReportJson", async () => {
  await withTempAppDir(async (appDir) => {
    const report = { summary: "did stuff", nextSteps: [{ id: "step-1", description: "x", rationale: "y" }] };
    await writeReportJson(appDir, "m1", report);
    assert.deepEqual(readReportJson(appDir, "m1"), report);
  });
});

test("reading report.json that was never written returns null", async () => {
  await withTempAppDir(async (appDir) => {
    assert.equal(readReportJson(appDir, "does-not-exist"), null);
  });
});
```

Add `readReportJson` and `writeReportJson` to the existing import line at
the top of `tests/mission/store.test.mjs`.

Create `tests/mission/report-approvals.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { readReportApprovals, writeReportApproval } from "../../mission/store.js";

async function withTempAppDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-report-approvals-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readReportApprovals returns an empty object when nothing was ever approved", async () => {
  await withTempAppDir(async (appDir) => {
    assert.deepEqual(readReportApprovals(appDir, "m1"), {});
  });
});

test("writeReportApproval records a decision and round-trips via readReportApprovals", async () => {
  await withTempAppDir(async (appDir) => {
    const all = await writeReportApproval(appDir, "m1", "step-1", "approved");
    assert.equal(all["step-1"], "approved");
    assert.deepEqual(readReportApprovals(appDir, "m1"), { "step-1": "approved" });
  });
});

test("concurrent writes to two different step ids both land", async () => {
  await withTempAppDir(async (appDir) => {
    await Promise.all([
      writeReportApproval(appDir, "m1", "step-1", "approved"),
      writeReportApproval(appDir, "m1", "step-2", "skipped"),
    ]);
    const all = readReportApprovals(appDir, "m1");
    assert.equal(all["step-1"], "approved");
    assert.equal(all["step-2"], "skipped");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/mission/store.test.mjs tests/mission/report-approvals.test.mjs`
Expected: FAIL — `writeReportJson`/`readReportJson`/`writeReportApproval`/`readReportApprovals` are not exported yet.

- [ ] **Step 3: Write the implementation**

Add to `mission/store.js`, after the existing `readReport` function:

```js
export async function writeReportJson(appDir, id, report) {
  const dir = createMissionDir(appDir, id);
  await writeFile(path.join(dir, "report.json"), JSON.stringify(report, null, 2), "utf8");
}

export function readReportJson(appDir, id) {
  const file = path.join(missionDir(appDir, id), "report.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Same read-modify-write-with-per-file-lock shape as writeTokens above —
// concurrent Approve/Skip clicks on different steps are just as possible as
// concurrent worker token polls.
const reportApprovalWriteLocks = new Map();
export async function writeReportApproval(appDir, id, stepId, decision) {
  const dir = createMissionDir(appDir, id);
  const file = path.join(dir, "report-approvals.json");
  const prev = reportApprovalWriteLocks.get(file) || Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    let all = {};
    if (existsSync(file)) {
      try {
        all = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        all = {};
      }
    }
    all[stepId] = decision;
    await writeFile(file, JSON.stringify(all, null, 2), "utf8");
    return all;
  });
  reportApprovalWriteLocks.set(file, run);
  try {
    return await run;
  } finally {
    if (reportApprovalWriteLocks.get(file) === run) reportApprovalWriteLocks.delete(file);
  }
}

export function readReportApprovals(appDir, id) {
  const file = path.join(missionDir(appDir, id), "report-approvals.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/mission/store.test.mjs tests/mission/report-approvals.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add mission/store.js tests/mission/store.test.mjs tests/mission/report-approvals.test.mjs
git commit -m "Add report.json and report-approvals.json persistence for Phantom Report"
```

---

### Task 6: Wire persistence + approval route into `server.js`

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `writeReportJson`, `readReportJson`, `writeReportApproval`, `readReportApprovals` (Task 5).

- [ ] **Step 1: Persist `report.json` alongside `report.md` on synthesis**

In the existing `POST /api/missions/:id/synthesize` route handler in
`server.js`, change:

```js
    synthesizeMission({ mission, ledger, scratchDir: missionScratchDir })
      .then(async ({ report, costUsd }) => {
        const markdown = renderReportMarkdown(mission, report, costUsd);
        await missionStore.writeReport(appDir, missionId, markdown);
        return sendJson(res, 200, { ok: true, report, markdown, costUsd });
      })
```

to:

```js
    synthesizeMission({ mission, ledger, scratchDir: missionScratchDir })
      .then(async ({ report, costUsd }) => {
        const markdown = renderReportMarkdown(mission, report, costUsd);
        await missionStore.writeReport(appDir, missionId, markdown);
        await missionStore.writeReportJson(appDir, missionId, report);
        return sendJson(res, 200, { ok: true, report, markdown, costUsd });
      })
```

- [ ] **Step 2: Include structured report + approvals on the existing report GET**

Change the existing `GET /api/missions/:id/report` route from:

```js
  const reportMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/report$/);
  if (reportMatch && req.method === "GET") {
    const markdown = missionStore.readReport(appDir, reportMatch[1]);
    if (!markdown) return sendJson(res, 404, { ok: false, error: "report_not_found" });
    return sendJson(res, 200, { ok: true, markdown });
  }
```

to:

```js
  const reportMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/report$/);
  if (reportMatch && req.method === "GET") {
    const markdown = missionStore.readReport(appDir, reportMatch[1]);
    if (!markdown) return sendJson(res, 404, { ok: false, error: "report_not_found" });
    const report = missionStore.readReportJson(appDir, reportMatch[1]);
    const approvals = missionStore.readReportApprovals(appDir, reportMatch[1]);
    return sendJson(res, 200, { ok: true, markdown, report, approvals });
  }
```

- [ ] **Step 3: Add the approve/skip route**

Add directly after the `reportMatch` block:

```js
  const reportStepMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/report\/steps\/([\w-]+)$/);
  if (reportStepMatch && req.method === "POST") {
    const [, missionId, stepId] = reportStepMatch;
    readJsonBody(req)
      .then(async (body) => {
        const decision = body.decision;
        if (decision !== "approved" && decision !== "skipped") {
          return sendJson(res, 400, { ok: false, error: "invalid_decision" });
        }
        const report = missionStore.readReportJson(appDir, missionId);
        if (!report || !report.nextSteps?.some((s) => s.id === stepId)) {
          return sendJson(res, 400, { ok: false, error: "step_not_found" });
        }
        const approvals = await missionStore.writeReportApproval(appDir, missionId, stepId, decision);
        return sendJson(res, 200, { ok: true, approvals });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }
```

- [ ] **Step 4: Syntax-check and run the full suite**

Run: `node --check server.js && npm test`
Expected: no syntax errors; all tests pass (69 existing + new ones from
Task 5, so the total should now be higher than 69 — check the printed
count matches what Task 5 added).

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "Wire report.json/approvals persistence and add report/steps approve-skip route"
```

---

### Task 7: Phantom Report UI

**Files:**
- Modify: `public/mission.js` (`renderMissionReport` and its call sites)

**Interfaces:**
- Consumes: `GET /api/missions/:id/report` now returning `{markdown, report, approvals}` (Task 6); `POST /api/missions/:id/report/steps/:stepId` (Task 6); existing globals `api`, `escapeHtml`, `smallMissionBtn`.

- [ ] **Step 1: Read the current `renderMissionReport` and its two call sites in full before editing**

`renderMissionReport` is at `public/mission.js` around line 596; it's called
from the synthesis button's success handler and from the initial
`reportRes` fetch in `renderMissionDetail`. Both currently pass only
`markdown`; both need to pass the fuller response instead.

- [ ] **Step 2: Change the two call sites to pass the full response**

In `renderMissionDetail`, change:

```js
      if (!r.ok) throw new Error(r.error);
      renderMissionReport(body, r.markdown);
```

to:

```js
      if (!r.ok) throw new Error(r.error);
      renderMissionReport(body, mission.id, r);
```

And change:

```js
  const reportRes = await api(`/api/missions/${mission.id}/report`).then((r) => r.json()).catch(() => ({ ok: false }));
  if (reportRes.ok) renderMissionReport(body, reportRes.markdown);
```

to:

```js
  const reportRes = await api(`/api/missions/${mission.id}/report`).then((r) => r.json()).catch(() => ({ ok: false }));
  if (reportRes.ok) renderMissionReport(body, mission.id, reportRes);
```

- [ ] **Step 3: Rewrite `renderMissionReport`**

Replace the existing function:

```js
function renderMissionReport(body, markdown) {
  let pre = body.querySelector(".mission-report");
  if (!pre) {
    pre = document.createElement("pre");
    pre.className = "mission-report";
    body.appendChild(pre);
  }
  pre.textContent = markdown;
}
```

with:

```js
function renderMissionReport(body, missionId, { markdown, report, approvals }) {
  let container = body.querySelector(".phantom-report");
  if (!container) {
    container = document.createElement("div");
    container.className = "phantom-report";
    body.appendChild(container);
  }
  container.innerHTML = "";

  const heading = document.createElement("h3");
  heading.textContent = "Phantom Report";
  container.appendChild(heading);

  // report/approvals are only present once synthesis has produced a
  // structured result (Task 4-6); a report.md written before this feature
  // shipped has neither — fall back to the old raw-markdown rendering so
  // history isn't lost.
  if (!report) {
    const pre = document.createElement("pre");
    pre.className = "mission-report";
    pre.textContent = markdown;
    container.appendChild(pre);
    return;
  }

  const summary = document.createElement("p");
  summary.className = "phantom-report-summary";
  summary.textContent = report.summary;
  container.appendChild(summary);

  if (report.workerFindings?.length) {
    const findingsHeading = document.createElement("h4");
    findingsHeading.textContent = "What each worker found";
    container.appendChild(findingsHeading);
    const findingsList = document.createElement("ul");
    findingsList.className = "phantom-report-findings";
    for (const f of report.workerFindings) {
      const li = document.createElement("li");
      li.innerHTML = `<b>${escapeHtml(f.workerName)}:</b> ${escapeHtml(f.found)}`;
      findingsList.appendChild(li);
    }
    container.appendChild(findingsList);
  }

  if (report.nextSteps?.length) {
    const stepsHeading = document.createElement("h4");
    stepsHeading.textContent = "Next steps";
    container.appendChild(stepsHeading);
    const stepsList = document.createElement("div");
    stepsList.className = "phantom-report-steps";
    for (const step of report.nextSteps) {
      stepsList.appendChild(renderPhantomStepRow(missionId, step, approvals?.[step.id]));
    }
    container.appendChild(stepsList);
  }

  const rawToggle = document.createElement("button");
  rawToggle.type = "button";
  rawToggle.className = "ghost";
  rawToggle.textContent = "Show full report";
  const rawPre = document.createElement("pre");
  rawPre.className = "mission-report hidden";
  rawPre.textContent = markdown;
  rawToggle.addEventListener("click", () => {
    rawPre.classList.toggle("hidden");
    rawToggle.textContent = rawPre.classList.contains("hidden") ? "Show full report" : "Hide full report";
  });
  container.appendChild(rawToggle);
  container.appendChild(rawPre);
}

function renderPhantomStepRow(missionId, step, decision) {
  const row = document.createElement("div");
  row.className = "phantom-step-row";
  row.innerHTML = `
    <div class="phantom-step-text">
      <div class="phantom-step-desc">${escapeHtml(step.description)}</div>
      <div class="phantom-step-rationale">${escapeHtml(step.rationale)}</div>
    </div>
    <div class="phantom-step-actions"></div>
  `;
  const actions = row.querySelector(".phantom-step-actions");

  if (decision === "approved" || decision === "skipped") {
    const tag = document.createElement("span");
    tag.className = `phantom-step-tag phantom-step-tag-${decision}`;
    tag.textContent = decision === "approved" ? "✓ Approved" : "Skipped";
    actions.appendChild(tag);
    return row;
  }

  const errorEl = document.createElement("span");
  errorEl.className = "phantom-step-error hidden";

  const decide = async (nextDecision) => {
    errorEl.classList.add("hidden");
    try {
      const res = await api(`/api/missions/${missionId}/report/steps/${step.id}`, {
        method: "POST",
        body: JSON.stringify({ decision: nextDecision }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "failed");
      const replacement = renderPhantomStepRow(missionId, step, nextDecision);
      row.replaceWith(replacement);
    } catch (err) {
      errorEl.textContent = friendlyError(err.message);
      errorEl.classList.remove("hidden");
    }
  };

  actions.appendChild(smallMissionBtn("Approve", () => decide("approved")));
  actions.appendChild(smallMissionBtn("Skip", () => decide("skipped")));
  actions.appendChild(errorEl);
  return row;
}
```

- [ ] **Step 4: Add styles**

Append to `public/styles.css`:

```css
.phantom-report {
  margin-top: 16px;
  padding: 12px;
  border-radius: 11px;
  border: 1px solid var(--line);
  background: var(--panel);
}
.phantom-report h4 {
  margin: 14px 0 6px;
  font-size: 13px;
  color: var(--soft);
}
.phantom-report-summary {
  color: var(--soft);
}
.phantom-report-findings {
  margin: 0;
  padding-left: 18px;
}
.phantom-step-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.phantom-step-desc {
  font-weight: 600;
}
.phantom-step-rationale {
  font-size: 12px;
  color: var(--muted);
}
.phantom-step-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.phantom-step-tag-approved {
  color: var(--accent);
}
.phantom-step-tag-skipped {
  color: var(--muted);
}
.phantom-step-error {
  color: var(--red);
  font-size: 11px;
}
```

- [ ] **Step 5: Syntax-check**

Run: `node --check public/mission.js`
Expected: no output.

- [ ] **Step 6: Manual verification**

Run: `npm start`, open a mission with at least one worker, trigger
synthesis, confirm the Phantom Report heading, per-worker findings list,
and next-steps rows with working Approve/Skip buttons appear; confirm
clicking Approve/Skip persists across closing and reopening the mission
detail view (re-fetching `GET /api/missions/:id/report` reflects the
decision).

- [ ] **Step 7: Commit**

```bash
git add public/mission.js public/styles.css
git commit -m "Add Phantom Report UI: per-worker findings and approve/skip next-step rows"
```
