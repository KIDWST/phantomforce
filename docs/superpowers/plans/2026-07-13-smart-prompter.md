# Smart Prompter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the objective box always defaulting every worker to Claude by teaching it to first classify the request as a literal "just open some terminals" instruction (handled directly, no AI agents) vs. a real objective (today's existing Mission decomposition, unchanged).

**Architecture:** One new module (`mission/classify.js`), one new API route, and a branch inserted at the top of the existing `mf-go` click handler in `public/mission.js` — the existing decompose/roles/launch path is otherwise untouched.

**Tech Stack:** `runClaudePrint` (existing), `node:test`, vanilla JS frontend matching existing conventions.

## Global Constraints

- No new npm dependencies.
- The existing `kind: "mission"` path (decompose → roles review → launch) must be byte-for-byte unchanged.
- `profileId` returned by the AI is never trusted for spawning without validation against the real, current `loadProfiles()` list.

---

### Task 1: `mission/classify.js`

**Files:**
- Create: `mission/classify.js`
- Test: `tests/mission/classify.test.mjs`

**Interfaces:**
- Produces: `classifyPrompt({objective, workspaceRoot, availableProfileIds, scratchDir}) -> Promise<{kind, tiles, costUsd}>`, `validateTiles(tiles, knownProfileIds) -> Array<{profileId, name, startupCommand}>`.

- [ ] **Step 1: Write the failing test**

```js
// tests/mission/classify.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { validateTiles } from "../../mission/classify.js";

test("a valid profileId passes through unchanged", () => {
  const tiles = [{ profileId: "codex", name: "Codex 1" }];
  assert.deepEqual(validateTiles(tiles, ["pwsh", "codex", "claude"]), [{ profileId: "codex", name: "Codex 1" }]);
});

test("an unrecognized profileId is replaced with pwsh", () => {
  const tiles = [{ profileId: "made-up-cli", name: "Whatever" }];
  const result = validateTiles(tiles, ["pwsh", "codex", "claude"]);
  assert.equal(result[0].profileId, "pwsh");
  assert.equal(result[0].name, "Whatever");
});

test("an undefined/empty tiles array passes through as []", () => {
  assert.deepEqual(validateTiles(undefined, ["pwsh"]), []);
  assert.deepEqual(validateTiles([], ["pwsh"]), []);
});

test("startupCommand is preserved when present, omitted stays omitted", () => {
  const tiles = [{ profileId: "pwsh", name: "A", startupCommand: "echo hi" }, { profileId: "pwsh", name: "B" }];
  const result = validateTiles(tiles, ["pwsh"]);
  assert.equal(result[0].startupCommand, "echo hi");
  assert.equal(result[1].startupCommand, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mission/classify.test.mjs`
Expected: FAIL — `Cannot find module '../../mission/classify.js'`

- [ ] **Step 3: Write the implementation**

```js
// mission/classify.js
// Classifies a mission-box objective BEFORE it ever reaches
// decomposeObjective: is this a literal "just open some terminals and run
// this" instruction (no AI agents needed — direct tiles), or a real
// objective that benefits from AI-agent decomposition (today's existing
// Mission Mode flow, unchanged)? Fixes the bug where every worker silently
// defaulted to Claude, since decomposeObjective's schema never asked for a
// provider at all.
import { runClaudePrint } from "./claude-print.js";

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

const CLASSIFY_BUDGET_USD = 1;

export async function classifyPrompt({ objective, workspaceRoot, availableProfileIds, scratchDir }) {
  const prompt =
    `Classify this request typed into a terminal-app's "objective" box, then respond with structured JSON.\n\n` +
    `REQUEST:\n${objective}\n\n` +
    `"direct" = the request is literally about opening/arranging terminal windows, running specific one-off ` +
    `commands, or displaying something — no multi-step investigation or code changes implied. For "direct", ` +
    `return a "tiles" array: one entry per terminal to open, each with a profileId chosen ONLY from this exact ` +
    `list (never invent one): ${availableProfileIds.join(", ")}. A "name" is a short label for the tile. An ` +
    `optional "startupCommand" is a literal shell command/script to type into that tile once it's open — write ` +
    `real, working code if the request implies visual output (e.g. a colored animation), don't describe it. ` +
    `If the request implies a count loosely ("a few", "different colors") rather than stating one exactly, use ` +
    `your judgment (typically 2-6).\n\n` +
    `"mission" = the request describes a goal that needs an agent to read/write files, run tests, or make real ` +
    `changes across multiple steps. For "mission", omit "tiles" entirely — a separate existing pipeline handles it.`;

  const result = await runClaudePrint({
    prompt,
    jsonSchema: CLASSIFY_SCHEMA,
    cwd: workspaceRoot,
    maxBudgetUsd: CLASSIFY_BUDGET_USD,
    scratchDir,
  });

  const kind = result.structured_output?.kind;
  if (kind !== "direct" && kind !== "mission") throw new Error("classification did not return a recognized kind");
  return {
    kind,
    tiles: kind === "direct" ? validateTiles(result.structured_output?.tiles, availableProfileIds) : [],
    costUsd: result.total_cost_usd ?? null,
  };
}

// Never trust model output blindly for something that drives real process
// spawning — any profileId not in the caller's actual, current profile
// list is replaced with "pwsh" (always present, always safe to open).
export function validateTiles(tiles, knownProfileIds) {
  if (!Array.isArray(tiles)) return [];
  return tiles.map((tile) => ({
    ...tile,
    profileId: knownProfileIds.includes(tile.profileId) ? tile.profileId : "pwsh",
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mission/classify.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mission/classify.js tests/mission/classify.test.mjs
git commit -m "Add Smart Prompter classification (direct terminals vs. AI-agent mission)"
```

---

### Task 2: `/api/prompter/classify` route

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `classifyPrompt` (Task 1).

- [ ] **Step 1: Import it**

Add alongside the existing `import { decomposeObjective } from "./mission/decompose.js";` line:

```js
import { classifyPrompt } from "./mission/classify.js";
```

- [ ] **Step 2: Add the route**

Insert directly before the existing `/api/missions/decompose` route in `server.js`:

```js
  if (pathName === "/api/prompter/classify" && req.method === "POST") {
    readJsonBody(req)
      .then(async (body) => {
        const objective = String(body.objective ?? "").trim();
        const workspaceRoot = String(body.workspaceRoot ?? "").trim();
        if (!objective) return sendJson(res, 400, { ok: false, error: "objective_required" });
        if (!workspaceRoot || !existsSync(workspaceRoot)) return sendJson(res, 400, { ok: false, error: "workspace_root_invalid" });
        const availableProfileIds = profiles.map((p) => p.id);
        const { kind, tiles, costUsd } = await classifyPrompt({ objective, workspaceRoot, availableProfileIds, scratchDir: missionScratchDir });
        return sendJson(res, 200, { ok: true, kind, tiles, costUsd });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }
```

- [ ] **Step 3: Syntax-check and run the full suite**

Run: `node --check server.js && npm test`
Expected: no syntax errors; full suite passes (prior count + 4 from Task 1).

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Add /api/prompter/classify route"
```

---

### Task 3: Branch the `mf-go` handler in `public/mission.js`

**Files:**
- Modify: `public/mission.js`

**Interfaces:**
- Consumes: `POST /api/prompter/classify` (Task 2); existing globals `addCard`, `closeMissionModal`, `api`, `friendlyError`.

- [ ] **Step 1: Read the current `mf-go` click handler in full before editing**

It's in `renderMissionCreateStepObjective` (`public/mission.js`) — read from
`document.getElementById("mf-go").addEventListener(...)` through the end of
that handler, so the inserted branch matches its existing validation and
button-state conventions exactly.

- [ ] **Step 2: Insert the classify call and direct-kind branch**

Immediately after the existing validation block (`if (!objective ||
!workspaceRoot) { ... return; }`) and the `btn.disabled = true; btn.textContent
= "Analyzing your objective…";` lines, insert a classify call before the
existing `/api/missions/decompose` call:

```js
    try {
      const classifyRes = await api("/api/prompter/classify", {
        method: "POST",
        body: JSON.stringify({ objective, workspaceRoot }),
      }).then((r) => r.json());
      if (!classifyRes.ok) throw new Error(classifyRes.error || "classification failed");

      if (classifyRes.kind === "direct") {
        closeMissionModal();
        for (const tile of classifyRes.tiles) {
          const card = addCard({ name: tile.name, profileId: tile.profileId }, { start: true });
          if (tile.startupCommand) {
            setTimeout(() => {
              if (card.ws && card.ws.readyState === WebSocket.OPEN) {
                card.ws.send(JSON.stringify({ type: "input", data: tile.startupCommand + "\r" }));
              }
            }, 700);
          }
        }
        return;
      }

      const res = await api("/api/missions/decompose", {
        method: "POST",
        body: JSON.stringify({ objective, workerCount, workspaceRoot }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "decomposition failed");
      rememberWorkspaceRoot(workspaceRoot);
      // ...existing code continues unchanged from here (building nextState, etc.)
```

The existing `try { const res = await api("/api/missions/decompose", ...`
line that was already there is now nested inside this same `try` block,
right after the classify call — do not duplicate the `try`/`catch`
wrapper, extend the existing one. Everything after the original
`decompose` call (building `nextState`, setting `missionCreateState`,
`renderMissionView()`, the `catch`/`finally` blocks) stays exactly as it
was.

- [ ] **Step 3: Syntax-check**

Run: `node --check public/mission.js`
Expected: no output.

- [ ] **Step 4: Run the full suite one more time**

Run: `npm test`
Expected: PASS, unchanged count from Task 2 (this task is UI-only, no new tests).

- [ ] **Step 5: Manual verification**

Run: `npm start`, open the app, open Missions → New Mission. Type "open 3
PowerShell windows with matrix rain in different colors", pick a
workspace, click "Launch Mission →" — confirm 3 plain PowerShell tiles
open directly on the wall (not Claude CLI sessions), each running a
distinct colored animation, and the mission modal never shows a roles
review step. Then open Missions → New Mission again, type a real objective
("audit this repo's test coverage and report gaps"), confirm the existing
decompose → roles review → launch flow behaves exactly as before this
change.

- [ ] **Step 6: Commit**

```bash
git add public/mission.js
git commit -m "Route the mission objective box through Smart Prompter classification before deciding direct-tiles vs. AI-agent mission"
```
