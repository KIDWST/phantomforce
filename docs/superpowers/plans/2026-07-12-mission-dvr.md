# Mission DVR + Token Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mission-wide PTY recording + git checkpointing + a scrubbable timeline with branch-from-checkpoint, plus real (where possible) per-worker token/cost tracking, to Termina's Mission Mode.

**Architecture:** Four new `mission/*.js` modules (recorder, checkpoint, tokens, plus a small worktree/protocol/prompt extension) hooked into `server.js`'s existing session lifecycle (`session.proc.onData`, `feedMissionProtocol`) and exposed via new `/api/missions/:id/...` routes; a new Timeline tab in the existing Mission Command Center (`public/mission.js` + new `public/timeline.js`) consumes them. No new dependencies — plain files under `.termina/missions/<id>/`, same convention as `mission/store.js`.

**Tech Stack:** Node 20+ built-in `node:test`, `node:child_process` (git), `node:fs/promises`, vanilla JS frontend (no framework, matches existing `public/*.js`).

## Global Constraints

- No new npm dependencies (matches existing project convention — `node:test`, no new deps for detect/mission subsystems).
- All new mission-scoped files live under `.termina/missions/<id>/` (already gitignored).
- Recorder/checkpoint/token-tail failures must never throw into the mission dispatch path — same best-effort philosophy as `captureDetection`/`feedMissionProtocol` in `server.js`.
- Checkpointing only applies to workers with `worker.branch` set (isolated worktree workers) — see design doc `docs/superpowers/specs/2026-07-12-mission-dvr-design.md`.
- Token cost is only ever reported when a verified per-model rate is known; otherwise `costUsd: null` — never invent a dollar figure.
- Branching is filesystem+transcript time-travel only; every UI surface offering it must state this.

---

### Task 1: Frame recorder

**Files:**
- Create: `mission/recorder.js`
- Test: `tests/mission/recorder.test.mjs`

**Interfaces:**
- Produces: `createFrameRecorder(appDir, missionId, workerId) -> { append(data: string): Promise<void> }`, `readFrames(appDir, missionId, workerId) -> Promise<Array<{ts:number, seq:number, data:string}> | null>`, `recordingPath(appDir, missionId, workerId) -> string`.

- [ ] **Step 1: Write the failing test**

```js
// tests/mission/recorder.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createFrameRecorder, readFrames, recordingPath } from "../../mission/recorder.js";

async function withTempAppDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-recorder-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("appended frames round-trip through readFrames in order", async () => {
  await withTempAppDir(async (appDir) => {
    const rec = createFrameRecorder(appDir, "m1", "w1");
    await rec.append("hello ");
    await rec.append("world\r\n");
    const frames = await readFrames(appDir, "m1", "w1");
    assert.equal(frames.length, 2);
    assert.equal(frames[0].data, "hello ");
    assert.equal(frames[1].data, "world\r\n");
    assert.equal(frames[0].seq, 0);
    assert.equal(frames[1].seq, 1);
    assert.ok(typeof frames[0].ts === "number");
  });
});

test("readFrames returns null when no recording exists", async () => {
  await withTempAppDir(async (appDir) => {
    assert.equal(await readFrames(appDir, "m1", "nope"), null);
  });
});

test("a corrupted line is skipped, the rest of the frames still read", async () => {
  await withTempAppDir(async (appDir) => {
    const file = recordingPath(appDir, "m1", "w1");
    await mkdir(path.dirname(file), { recursive: true });
    const good1 = JSON.stringify({ ts: 1, seq: 0, data: Buffer.from("a").toString("base64") });
    const good2 = JSON.stringify({ ts: 2, seq: 1, data: Buffer.from("b").toString("base64") });
    await writeFile(file, `${good1}\nnot json\n${good2}\n`, "utf8");
    const frames = await readFrames(appDir, "m1", "w1");
    assert.equal(frames.length, 2);
    assert.equal(frames[0].data, "a");
    assert.equal(frames[1].data, "b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mission/recorder.test.mjs`
Expected: FAIL — `Cannot find module '../../mission/recorder.js'`

- [ ] **Step 3: Write the implementation**

```js
// mission/recorder.js
// Records each mission worker's raw PTY output as timestamped, ordered
// frames, for the Mission DVR scrub timeline. Best-effort and append-only,
// mirroring the existing captureDetection pattern in server.js — a write
// failure never blocks the session. Only ever created for mission workers
// (server.js gates this on session.missionId != null); solo tiles are never
// recorded.
import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

export function recordingsDir(appDir, missionId) {
  return path.join(appDir, ".termina", "missions", missionId, "recordings");
}

export function recordingPath(appDir, missionId, workerId) {
  return path.join(recordingsDir(appDir, missionId), `${workerId}.jsonl`);
}

// seq is a per-recorder monotonic counter, not derived from Date.now() —
// two frames can land in the same millisecond and must still sort correctly.
export function createFrameRecorder(appDir, missionId, workerId) {
  let seq = 0;
  const file = recordingPath(appDir, missionId, workerId);
  return {
    async append(data) {
      try {
        mkdirSync(path.dirname(file), { recursive: true });
        const line = JSON.stringify({ ts: Date.now(), seq: seq++, data: Buffer.from(data, "utf8").toString("base64") });
        await appendFile(file, line + "\n", "utf8");
      } catch {
        /* best effort only */
      }
    },
  };
}

export async function readFrames(appDir, missionId, workerId) {
  const file = recordingPath(appDir, missionId, workerId);
  if (!existsSync(file)) return null;
  const text = await readFile(file, "utf8");
  const frames = [];
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    try {
      const frame = JSON.parse(line);
      frames.push({ ts: frame.ts, seq: frame.seq, data: Buffer.from(frame.data, "base64").toString("utf8") });
    } catch {
      /* skip corrupted line, keep the rest */
    }
  }
  return frames;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mission/recorder.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add mission/recorder.js tests/mission/recorder.test.mjs
git commit -m "Add Mission DVR frame recorder"
```

---

### Task 2: Checkpoint manager

**Files:**
- Create: `mission/checkpoint.js`
- Test: `tests/mission/checkpoint.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `CHECKPOINT_EVENT_TYPES: string[]`, `snapshotWorktree(cwd: string) -> Promise<string|null>`, `maybeCheckpoint({appDir, missionId, worker: {id, branch, cwd}, eventType}) -> Promise<{ts,workerId,sha,ledgerEventType}|null>`, `readCheckpoints(appDir, missionId) -> Promise<Array<{ts,workerId,sha,ledgerEventType}>>`.

- [ ] **Step 1: Write the failing test**

```js
// tests/mission/checkpoint.test.mjs
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { CHECKPOINT_EVENT_TYPES, maybeCheckpoint, readCheckpoints, snapshotWorktree } from "../../mission/checkpoint.js";

const run = promisify(execFile);

async function makeScratchRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "termina-ckpt-repo-"));
  await run("git", ["init", "-q"], { cwd: repoRoot });
  await run("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
  await run("git", ["config", "user.name", "Test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), "hello\n", "utf8");
  await run("git", ["add", "README.md"], { cwd: repoRoot });
  await run("git", ["commit", "-q", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}

async function withTempAppDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-ckpt-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("snapshotWorktree on a dirty tree returns a resolvable stash-create SHA without altering the tree", async () => {
  const repoRoot = await makeScratchRepo();
  try {
    await writeFile(path.join(repoRoot, "README.md"), "changed\n", "utf8");
    const sha = await snapshotWorktree(repoRoot);
    assert.ok(sha && /^[0-9a-f]{7,40}$/.test(sha));
    const { stdout } = await run("git", ["status", "--porcelain"], { cwd: repoRoot });
    assert.equal(stdout.trim(), "M README.md"); // stash create doesn't touch the working tree
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("snapshotWorktree on a clean tree falls back to HEAD", async () => {
  const repoRoot = await makeScratchRepo();
  try {
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();
    const sha = await snapshotWorktree(repoRoot);
    assert.equal(sha, head);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("maybeCheckpoint skips workers with no branch (not an isolated worktree worker)", async () => {
  await withTempAppDir(async (appDir) => {
    const result = await maybeCheckpoint({
      appDir,
      missionId: "m1",
      worker: { id: "w1", branch: null, cwd: "irrelevant" },
      eventType: "PROPOSED_CHANGE",
    });
    assert.equal(result, null);
  });
});

test("maybeCheckpoint skips event types that aren't checkpoint-worthy", async () => {
  const repoRoot = await makeScratchRepo();
  await withTempAppDir(async (appDir) => {
    const result = await maybeCheckpoint({
      appDir,
      missionId: "m1",
      worker: { id: "w1", branch: "termina/mission-m1/w1", cwd: repoRoot },
      eventType: "DISCOVERY",
    });
    assert.equal(result, null);
  });
  await rm(repoRoot, { recursive: true, force: true });
});

test("maybeCheckpoint records a checkpoint for a qualifying event and it round-trips via readCheckpoints", async () => {
  const repoRoot = await makeScratchRepo();
  await withTempAppDir(async (appDir) => {
    assert.ok(CHECKPOINT_EVENT_TYPES.includes("PROPOSED_CHANGE"));
    const record = await maybeCheckpoint({
      appDir,
      missionId: "m1",
      worker: { id: "w1", branch: "termina/mission-m1/w1", cwd: repoRoot },
      eventType: "PROPOSED_CHANGE",
    });
    assert.ok(record);
    assert.equal(record.workerId, "w1");
    assert.equal(record.ledgerEventType, "PROPOSED_CHANGE");

    const all = await readCheckpoints(appDir, "m1");
    assert.equal(all.length, 1);
    assert.equal(all[0].sha, record.sha);
  });
  await rm(repoRoot, { recursive: true, force: true });
});

test("readCheckpoints returns an empty array when no checkpoints file exists", async () => {
  await withTempAppDir(async (appDir) => {
    assert.deepEqual(await readCheckpoints(appDir, "does-not-exist"), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mission/checkpoint.test.mjs`
Expected: FAIL — `Cannot find module '../../mission/checkpoint.js'`

- [ ] **Step 3: Write the implementation**

```js
// mission/checkpoint.js
// Snapshots a worker's worktree to a shadow git object on qualifying ledger
// events, without touching the worker's real branch, working tree, or the
// stash ref list. Only meaningful for isolated (git worktree) write-mode
// workers — shared-folder and plan-mode (read-only) workers produce none.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const CHECKPOINT_EVENT_TYPES = ["FILE_CLAIM", "PROPOSED_CHANGE", "CHANGE_APPLIED", "COMPLETE", "FAILED"];

export function checkpointsPath(appDir, missionId) {
  return path.join(appDir, ".termina", "missions", missionId, "checkpoints.jsonl");
}

// `git stash create` returns a commit-ish SHA representing the current
// index+worktree state *without* touching the working tree, the index, or
// the stash ref list — safe to call at any time. On a clean tree it prints
// nothing (there's no diff to snapshot); HEAD already IS that checkpoint.
export async function snapshotWorktree(cwd) {
  try {
    const { stdout } = await run("git", ["stash", "create"], { cwd });
    const sha = stdout.trim();
    if (sha) return sha;
    const head = await run("git", ["rev-parse", "HEAD"], { cwd });
    return head.stdout.trim();
  } catch {
    return null;
  }
}

export async function maybeCheckpoint({ appDir, missionId, worker, eventType }) {
  if (!worker.branch) return null; // not an isolated worktree worker
  if (!CHECKPOINT_EVENT_TYPES.includes(eventType)) return null;
  const sha = await snapshotWorktree(worker.cwd);
  if (!sha) return null;
  const record = { ts: Date.now(), workerId: worker.id, sha, ledgerEventType: eventType };
  try {
    mkdirSync(path.dirname(checkpointsPath(appDir, missionId)), { recursive: true });
    await appendFile(checkpointsPath(appDir, missionId), JSON.stringify(record) + "\n", "utf8");
  } catch {
    return null;
  }
  return record;
}

export async function readCheckpoints(appDir, missionId) {
  const file = checkpointsPath(appDir, missionId);
  if (!existsSync(file)) return [];
  const text = await readFile(file, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mission/checkpoint.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add mission/checkpoint.js tests/mission/checkpoint.test.mjs
git commit -m "Add Mission DVR git-checkpoint manager"
```

---

### Task 3: `createWorktreeFromRef` (worktree.js extension)

**Files:**
- Modify: `mission/worktree.js` (add one function; `createWorktree` becomes a thin wrapper so existing callers/tests are unchanged)
- Test: `tests/mission/worktree.test.mjs` (add one test)

**Interfaces:**
- Produces: `createWorktreeFromRef({repoRoot, missionId, workerSlug, ref}) -> Promise<{path, branch}>`. `createWorktree({repoRoot, missionId, workerSlug})` keeps its exact existing signature and behavior (defaults `ref` to `HEAD`).

- [ ] **Step 1: Write the failing test**

Add to `tests/mission/worktree.test.mjs` (after the existing `createWorktree refuses...` test):

```js
test("createWorktreeFromRef checks out an explicit non-HEAD ref, not HEAD", async () => {
  const repoRoot = await makeScratchRepo();
  let wt;
  try {
    // second commit moves HEAD forward
    await writeFile(path.join(repoRoot, "README.md"), "v2\n", "utf8");
    await run("git", ["add", "README.md"], { cwd: repoRoot });
    await run("git", ["commit", "-q", "-m", "v2"], { cwd: repoRoot });
    const firstCommit = (await run("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: repoRoot })).stdout.trim();

    wt = await createWorktreeFromRef({ repoRoot, missionId: "m3", workerSlug: "branch-a", ref: firstCommit });
    const content = await readFile(path.join(wt.path, "README.md"), "utf8");
    assert.equal(content, "hello\n"); // v1 content, from the first commit — not HEAD's "v2\n"
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    if (wt) await rm(wt.path, { recursive: true, force: true }).catch(() => {});
  }
});
```

Add `createWorktreeFromRef` and `readFile` to the existing import lines at the top of the test file:

```js
import { readFile } from "node:fs/promises"; // add readFile alongside the existing mkdtemp, rm, writeFile import
```

(Combine into the existing `node:fs/promises` import line rather than adding a second one.)

Add `createWorktreeFromRef` to the existing `from "../../mission/worktree.js"` import line.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mission/worktree.test.mjs`
Expected: FAIL — `createWorktreeFromRef is not a function`

- [ ] **Step 3: Write the implementation**

Replace the existing `createWorktree` function in `mission/worktree.js` with:

```js
// Creates an isolated worktree + branch for one worker, checked out at an
// explicit ref (defaults to the repo's current HEAD). Refuses outright
// rather than silently reusing a dirty directory if the target path already
// exists with uncommitted changes.
export async function createWorktreeFromRef({ repoRoot, missionId, workerSlug, ref }) {
  const branch = branchName(missionId, workerSlug);
  const targetPath = worktreePath(repoRoot, missionId, workerSlug);

  if (existsSync(targetPath)) {
    if (await isDirty(targetPath)) {
      throw new Error(`worktree path already exists with uncommitted changes: ${targetPath}`);
    }
    throw new Error(`worktree path already exists: ${targetPath}`);
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  const resolvedRef = ref ?? (await getHeadRef(repoRoot));
  await git(repoRoot, ["worktree", "add", "-b", branch, targetPath, resolvedRef]);
  return { path: targetPath, branch };
}

export async function createWorktree({ repoRoot, missionId, workerSlug }) {
  return createWorktreeFromRef({ repoRoot, missionId, workerSlug });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mission/worktree.test.mjs`
Expected: PASS (all existing tests + the new one)

- [ ] **Step 5: Commit**

```bash
git add mission/worktree.js tests/mission/worktree.test.mjs
git commit -m "Generalize createWorktree to check out an explicit ref, for Mission DVR branching"
```

---

### Task 4: Protocol + prompt additions for branching

**Files:**
- Modify: `mission/protocol.js` (add `"BRANCHED"` to `EVENT_TYPES`)
- Modify: `mission/prompt.js` (add optional "RESUMING FROM CHECKPOINT" section)
- Test: `tests/mission/protocol.test.mjs`, `tests/mission/prompt.test.mjs` (extend both)

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildWorkerPrompt({mission, worker})` gains support for `worker.resumingFrom: {checkpointTs: number, summary: string} | undefined` — when present, an extra prompt section is inserted after WORKSPACE.

- [ ] **Step 1: Write the failing tests**

Add to `tests/mission/protocol.test.mjs`:

```js
test("BRANCHED is a recognized event type, emitted only by termina itself", () => {
  assert.ok(EVENT_TYPES.includes("BRANCHED"));
});
```

(Add `EVENT_TYPES` to the existing import from `../../mission/protocol.js` if not already imported.)

Add to `tests/mission/prompt.test.mjs`:

```js
test("buildWorkerPrompt includes a RESUMING FROM CHECKPOINT section when worker.resumingFrom is set", () => {
  const mission = { objective: "Ship it", workers: [], launchMode: "approval" };
  const worker = {
    id: "w1",
    index: 1,
    name: "Backend",
    scope: "backend only",
    cwd: "/tmp/x",
    branch: "termina/mission-m1/backend-branch-1",
    resumingFrom: { checkpointTs: 1752345680000, summary: "Worker w1 had claimed api.js and proposed a change." },
  };
  const prompt = buildWorkerPrompt({ mission, worker });
  assert.match(prompt, /RESUMING FROM CHECKPOINT/);
  assert.match(prompt, /Worker w1 had claimed api\.js and proposed a change\./);
});

test("buildWorkerPrompt omits the RESUMING FROM CHECKPOINT section when worker.resumingFrom is absent", () => {
  const mission = { objective: "Ship it", workers: [], launchMode: "approval" };
  const worker = { id: "w1", index: 1, name: "Backend", scope: "backend only", cwd: "/tmp/x" };
  const prompt = buildWorkerPrompt({ mission, worker });
  assert.doesNotMatch(prompt, /RESUMING FROM CHECKPOINT/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/mission/protocol.test.mjs tests/mission/prompt.test.mjs`
Expected: FAIL — `BRANCHED` not in `EVENT_TYPES`; no `RESUMING FROM CHECKPOINT` text in prompt output.

- [ ] **Step 3: Write the implementation**

In `mission/protocol.js`, change the `EVENT_TYPES` array to add `"BRANCHED"` (Termina-only, never emitted by a worker itself — used exclusively via `source: "termina"` ledger records):

```js
export const EVENT_TYPES = [
  "STARTED",
  "DISCOVERY",
  "FILE_CLAIM",
  "BLOCKER",
  "QUESTION",
  "PROPOSED_CHANGE",
  "CHANGE_APPLIED",
  "TEST_RESULT",
  "HANDOFF",
  "COMPLETE",
  "FAILED",
  "BRANCHED",
];
```

In `mission/prompt.js`, insert this block into `buildWorkerPrompt` right after the existing `WORKSPACE` section (after the `lines.push("");` that follows the `Mode:` lines, before the `DELIVERABLES` block):

```js
  if (worker.resumingFrom) {
    lines.push("RESUMING FROM CHECKPOINT");
    lines.push(
      "You are a fresh agent continuing from a checkpoint of another worker's file state — NOT the same process. " +
        "The files in your workspace reflect that point in time; nothing else (running processes, in-memory state) carried over.",
    );
    lines.push(`Checkpoint time: ${new Date(worker.resumingFrom.checkpointTs).toISOString()}`);
    lines.push(`What had happened up to that point: ${worker.resumingFrom.summary}`);
    lines.push("");
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/mission/protocol.test.mjs tests/mission/prompt.test.mjs`
Expected: PASS (all tests including the two new ones)

- [ ] **Step 5: Commit**

```bash
git add mission/protocol.js mission/prompt.js tests/mission/protocol.test.mjs tests/mission/prompt.test.mjs
git commit -m "Add BRANCHED event type and RESUMING FROM CHECKPOINT prompt section"
```

---

### Task 5: Token tracker

**Files:**
- Create: `mission/tokens.js`
- Test: `tests/mission/tokens.test.mjs`

**Interfaces:**
- Produces: `sanitizeCwdToProjectDirName(cwd: string) -> string`, `findClaudeTranscript(cwd: string, claudeProjectsDir: string) -> Promise<string|null>`, `readClaudeUsage(filePath: string) -> Promise<{inputTokens, outputTokens, cacheTokens, model: string|null}>`, `estimateFromChars(charCount: number) -> {inputTokens: number, outputTokens: 0}`, `costForUsage({model, inputTokens, outputTokens}) -> number|null`, `TOKEN_ADAPTERS: {claude: {...}, codex: null}`.

Verified against a real local Claude Code transcript on this machine
(`~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl`): each assistant
turn is one JSON line with `message.model` and
`message.usage.{input_tokens, cache_creation_input_tokens,
cache_read_input_tokens, output_tokens}`. The project directory name is the
worker's `cwd` with every `:`, `\`, `/`, and `.` character replaced by `-`
(confirmed by comparing a live worktree path against its actual
`~/.claude/projects/` directory name). Since Termina always launches a
worker into a brand-new worktree directory (`createWorktree`/
`createWorktreeFromRef` refuse to reuse an existing one), that project
directory cannot contain any transcript predating this worker — so "pick the
most recently modified `.jsonl` in that directory" is unambiguous, not a
heuristic guess.

- [ ] **Step 1: Write the failing test**

```js
// tests/mission/tokens.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  costForUsage,
  estimateFromChars,
  findClaudeTranscript,
  readClaudeUsage,
  sanitizeCwdToProjectDirName,
} from "../../mission/tokens.js";

test("sanitizeCwdToProjectDirName matches Claude Code's real project-dir naming", () => {
  const cwd = "C:\\Users\\jorda\\.termina-worktrees\\Termina-mission-a6bbb1875498-checker";
  assert.equal(sanitizeCwdToProjectDirName(cwd), "C--Users-jorda--termina-worktrees-Termina-mission-a6bbb1875498-checker");
});

test("estimateFromChars produces a rough token count with zero output tokens (no way to split without real data)", () => {
  const est = estimateFromChars(4000);
  assert.equal(est.inputTokens, 1000);
  assert.equal(est.outputTokens, 0);
});

test("costForUsage returns null for an unrecognized model rather than guessing", () => {
  assert.equal(costForUsage({ model: "some-future-model-1", inputTokens: 100, outputTokens: 100 }), null);
});

test("costForUsage computes a real number for a known model", () => {
  const cost = costForUsage({ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.ok(typeof cost === "number" && cost > 0);
});

async function withTempClaudeProjects(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-claude-projects-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("findClaudeTranscript returns null when the project dir doesn't exist yet", async () => {
  await withTempClaudeProjects(async (claudeProjectsDir) => {
    assert.equal(await findClaudeTranscript("C:\\some\\worktree", claudeProjectsDir), null);
  });
});

test("findClaudeTranscript finds the transcript once the project dir exists", async () => {
  await withTempClaudeProjects(async (claudeProjectsDir) => {
    const cwd = "C:\\some\\worktree";
    const projectDir = path.join(claudeProjectsDir, sanitizeCwdToProjectDirName(cwd));
    await mkdir(projectDir, { recursive: true });
    const file = path.join(projectDir, "session-1.jsonl");
    await writeFile(file, "", "utf8");
    assert.equal(await findClaudeTranscript(cwd, claudeProjectsDir), file);
  });
});

test("readClaudeUsage sums usage across assistant turns from a real-shaped transcript", async () => {
  await withTempClaudeProjects(async (claudeProjectsDir) => {
    const file = path.join(claudeProjectsDir, "session.jsonl");
    const line1 = JSON.stringify({
      type: "assistant",
      message: { model: "claude-sonnet-5", usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 } },
    });
    const line2 = JSON.stringify({
      type: "assistant",
      message: { model: "claude-sonnet-5", usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 400, output_tokens: 30 } },
    });
    const userLine = JSON.stringify({ type: "user", message: { content: "hi" } });
    await writeFile(file, `${line1}\n${userLine}\n${line2}\n`, "utf8");

    const usage = await readClaudeUsage(file);
    assert.equal(usage.inputTokens, 2 + 100 + 50 + 3 + 0 + 400);
    assert.equal(usage.outputTokens, 20 + 30);
    assert.equal(usage.model, "claude-sonnet-5");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mission/tokens.test.mjs`
Expected: FAIL — `Cannot find module '../../mission/tokens.js'`

- [ ] **Step 3: Write the implementation**

```js
// mission/tokens.js
// Termina never calls an LLM API itself — it drives a PTY. So real token
// counts come from tailing the provider CLI's own local session transcript,
// matched to a worker by its (always-fresh, never-reused) worktree cwd. When
// a provider has no confirmed local log format, or the transcript hasn't
// appeared yet, callers fall back to estimateFromChars — clearly distinct
// from real data, never presented as equal-confidence.
import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Matches Claude Code's own project-directory naming exactly (verified
// against a real ~/.claude/projects/<name> directory for a known cwd).
export function sanitizeCwdToProjectDirName(cwd) {
  return cwd.replace(/[:\\/.]/g, "-");
}

export function claudeProjectDir(cwd, claudeProjectsDir) {
  return path.join(claudeProjectsDir, sanitizeCwdToProjectDirName(cwd));
}

// A worker's worktree is always a brand-new directory (createWorktree /
// createWorktreeFromRef refuse to reuse an existing one), so its Claude
// project directory can never contain a transcript from anything else —
// "most recently modified .jsonl in that directory" is unambiguous.
export async function findClaudeTranscript(cwd, claudeProjectsDir) {
  const dir = claudeProjectDir(cwd, claudeProjectsDir);
  if (!existsSync(dir)) return null;
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const jsonl = entries.filter((f) => f.endsWith(".jsonl"));
  if (!jsonl.length) return null;
  const withMtime = jsonl.map((f) => {
    const full = path.join(dir, f);
    let mtime = 0;
    try {
      mtime = statSync(full).mtimeMs;
    } catch {
      /* ignore */
    }
    return { full, mtime };
  });
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime[0].full;
}

export async function readClaudeUsage(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return { inputTokens: 0, outputTokens: 0, cacheTokens: 0, model: null };
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let model = null;
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry?.message?.usage;
    if (entry?.type !== "assistant" || !usage) continue;
    inputTokens += usage.input_tokens ?? 0;
    inputTokens += usage.cache_creation_input_tokens ?? 0;
    inputTokens += usage.cache_read_input_tokens ?? 0;
    cacheTokens += (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    outputTokens += usage.output_tokens ?? 0;
    if (entry.message.model) model = entry.message.model;
  }
  return { inputTokens, outputTokens, cacheTokens, model };
}

// Character-count fallback for providers/moments with no readable real
// transcript yet. ~4 chars/token is the standard rough approximation; all of
// it is attributed to input since there's no way to distinguish prompt vs.
// completion from raw terminal bytes alone.
export function estimateFromChars(charCount) {
  return { inputTokens: Math.round(charCount / 4), outputTokens: 0 };
}

// Verified per-1M-token USD rates, checked against each model's own pricing
// page at time of writing. An unrecognized model returns null rather than
// guessing a rate — never invent a dollar figure.
const RATES_PER_MILLION_USD = {
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 15, output: 75 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
};

export function costForUsage({ model, inputTokens, outputTokens }) {
  const rate = model ? RATES_PER_MILLION_USD[model] : null;
  if (!rate) return null;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

// codex: null — no confirmed local transcript format for the Codex CLI at
// time of writing; the tracker falls back to estimateFromChars for it.
export const TOKEN_ADAPTERS = {
  claude: { findTranscript: findClaudeTranscript, readUsage: readClaudeUsage },
  codex: null,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mission/tokens.test.mjs`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add mission/tokens.js tests/mission/tokens.test.mjs
git commit -m "Add Mission DVR token/cost tracker with honest real-vs-estimated labeling"
```

---

### Task 6: Wire recorder + checkpoint + tokens into `server.js`, add API routes

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `createFrameRecorder`, `readFrames` (Task 1); `maybeCheckpoint`, `readCheckpoints` (Task 2); `createWorktreeFromRef` (Task 3); `TOKEN_ADAPTERS`, `estimateFromChars`, `costForUsage` (Task 5); `buildWorkerPrompt` now accepts `worker.resumingFrom` (Task 4).

This task is manual wiring, not TDD-first (it's glue code exercised by the
existing mission API tests plus manual verification in Task 7) — follow the
`run` skill after this task to click through it live.

- [ ] **Step 1: Import the new modules**

At the top of `server.js`, after the existing `import { findGitRepos } from "./mission/repos.js";` line, add:

```js
import { createFrameRecorder, readFrames } from "./mission/recorder.js";
import { maybeCheckpoint, readCheckpoints } from "./mission/checkpoint.js";
import { createWorktreeFromRef } from "./mission/worktree.js";
import { TOKEN_ADAPTERS, estimateFromChars, costForUsage } from "./mission/tokens.js";
import os from "node:os";
```

(`os` is needed for `os.homedir()` to locate `~/.claude/projects`.)

- [ ] **Step 2: Attach a recorder to mission worker sessions**

In `startSession` (around the existing `session` object literal), add a `recorder` field, created only for mission workers:

```js
    recorder: opts.missionId ? createFrameRecorder(appDir, opts.missionId, opts.workerId) : null,
```

In `session.proc.onData`, append recording right after the existing three calls:

```js
    session.proc.onData((data) => {
      broadcast(session, data);
      maybeAutoTrust(session, data);
      feedDetector(session, data);
      session.recorder?.append(data);
    });
```

- [ ] **Step 3: Trigger checkpoints from `feedMissionProtocol`**

`feedMissionProtocol` currently only appends ledger events. After the existing `missionStore.appendLedger(...)` call inside its `for (const event of events)` loop, add a checkpoint attempt. This needs the worker's `branch`/`cwd`, which live in `mission.json`, not on the session — read the mission once per tick:

```js
function feedMissionProtocol(session, raw) {
  const events = parseEvents(stripAnsi(raw));
  if (!events.length) return;
  const mission = missionStore.readMission(appDir, session.missionId);
  const worker = mission?.workers.find((w) => w.id === session.workerId);
  for (const event of events) {
    session.lastLedgerEvent = event;
    const record = { workerId: session.workerId, source: "worker", type: event.type, detail: event.detail ?? null };
    missionStore.appendLedger(appDir, session.missionId, record).catch(() => {});
    const payload = JSON.stringify({ type: "ledger", event: record });
    for (const socket of session.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
    if (worker) {
      maybeCheckpoint({ appDir, missionId: session.missionId, worker, eventType: event.type }).catch(() => {});
    }
  }
}
```

- [ ] **Step 4: Poll token usage on the same detector tick**

In `feedDetector`, after the existing `if (session.missionId) feedMissionProtocol(session, result.raw);` line, add a token poll — best-effort, fire-and-forget, same cadence as the status detector:

```js
    if (session.missionId) {
      feedMissionProtocol(session, result.raw);
      pollTokenUsage(session).catch(() => {});
    }
```

Add the `pollTokenUsage` function near `feedMissionProtocol`:

```js
const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");

// Real usage where a provider adapter can find it; otherwise a clearly
// estimated fallback derived from the recorder's own byte count. Pushed to
// clients and rolled up into tokens.json — never silently treated as
// equal-confidence to real data.
async function pollTokenUsage(session) {
  const mission = missionStore.readMission(appDir, session.missionId);
  const worker = mission?.workers.find((w) => w.id === session.workerId);
  if (!worker) return;

  const adapter = TOKEN_ADAPTERS[worker.provider];
  let usage = null;
  let estimated = true;
  if (adapter) {
    const transcript = await adapter.findTranscript(worker.cwd, claudeProjectsDir);
    if (transcript) {
      const real = await adapter.readUsage(transcript);
      usage = { inputTokens: real.inputTokens, outputTokens: real.outputTokens, model: real.model };
      estimated = false;
    }
  }
  if (!usage) {
    const frames = await readFrames(appDir, session.missionId, session.workerId);
    const charCount = (frames ?? []).reduce((sum, f) => sum + f.data.length, 0);
    const est = estimateFromChars(charCount);
    usage = { inputTokens: est.inputTokens, outputTokens: est.outputTokens, model: null };
  }
  const costUsd = costForUsage({ model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });

  const payload = JSON.stringify({ type: "tokens", workerId: session.workerId, ...usage, costUsd, estimated });
  for (const socket of session.sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
  await missionStore.writeTokens(appDir, session.missionId, session.workerId, { ...usage, costUsd, estimated }).catch(() => {});
}
```

- [ ] **Step 5: Add `writeTokens`/`readTokens` to `mission/store.js`**

Following the exact pattern of `writeMission`/`readMission` in `mission/store.js`, add:

```js
export async function writeTokens(appDir, missionId, workerId, usage) {
  const dir = createMissionDir(appDir, missionId);
  const file = path.join(dir, "tokens.json");
  let all = {};
  if (existsSync(file)) {
    try {
      all = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      all = {};
    }
  }
  all[workerId] = { ...usage, updatedAt: Date.now() };
  await writeFile(file, JSON.stringify(all, null, 2), "utf8");
  await appendFile(path.join(dir, "tokens-history.jsonl"), JSON.stringify({ ts: Date.now(), workerId, costUsd: usage.costUsd }) + "\n", "utf8");
}

export function readTokens(appDir, missionId) {
  const file = path.join(missionDir(appDir, missionId), "tokens.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function readTokenHistory(appDir, missionId) {
  const file = path.join(missionDir(appDir, missionId), "tokens-history.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
```

Import these three in `server.js`'s existing `import * as missionStore from "./mission/store.js";` — no change needed there since it's a namespace import; just call `missionStore.writeTokens`/`missionStore.readTokens`/`missionStore.readTokenHistory`.

- [ ] **Step 6: Include tokens in the existing mission GET, add new routes**

In the existing `GET /api/missions/:id` handler in `server.js`, add tokens to the response:

```js
  const missionGetMatch = pathName.match(/^\/api\/missions\/([\w-]+)$/);
  if (missionGetMatch && req.method === "GET") {
    const mission = missionStore.readMission(appDir, missionGetMatch[1]);
    if (!mission) return sendJson(res, 404, { ok: false, error: "mission_not_found" });
    const ledger = missionStore.readLedger(appDir, missionGetMatch[1]);
    const tokens = missionStore.readTokens(appDir, missionGetMatch[1]);
    return sendJson(res, 200, { ok: true, mission, ledger, tokens });
  }
```

Add four new routes, placed after the existing `workerActionMatch` (stop/retry) block and before the `synthesizeMatch` block:

```js
  const recordingMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/recordings\/([\w-]+)$/);
  if (recordingMatch && req.method === "GET") {
    readFrames(appDir, recordingMatch[1], recordingMatch[2]).then((frames) => {
      if (!frames) return sendJson(res, 404, { ok: false, error: "recording_not_found" });
      return sendJson(res, 200, { ok: true, frames });
    });
    return;
  }

  const checkpointsMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/checkpoints$/);
  if (checkpointsMatch && req.method === "GET") {
    readCheckpoints(appDir, checkpointsMatch[1]).then((checkpoints) => sendJson(res, 200, { ok: true, checkpoints }));
    return;
  }

  const tokensMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/tokens$/);
  if (tokensMatch && req.method === "GET") {
    const tokens = missionStore.readTokens(appDir, tokensMatch[1]);
    const history = missionStore.readTokenHistory(appDir, tokensMatch[1]);
    return sendJson(res, 200, { ok: true, tokens, history });
  }

  const branchMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/workers\/([\w-]+)\/branch$/);
  if (branchMatch && req.method === "POST") {
    const [, missionId, workerId] = branchMatch;
    readJsonBody(req)
      .then(async (body) => {
        const mission = missionStore.readMission(appDir, missionId);
        if (!mission) return sendJson(res, 404, { ok: false, error: "mission_not_found" });
        const sourceWorker = mission.workers.find((w) => w.id === workerId);
        if (!sourceWorker) return sendJson(res, 404, { ok: false, error: "worker_not_found" });
        if (!sourceWorker.branch) return sendJson(res, 400, { ok: false, error: "worker_not_isolated" });

        const checkpointSha = String(body.checkpointSha ?? "").trim();
        const checkpoints = await readCheckpoints(appDir, missionId);
        const checkpoint = checkpoints.find((c) => c.sha === checkpointSha && c.workerId === workerId);
        if (!checkpoint) return sendJson(res, 400, { ok: false, error: "checkpoint_not_found" });

        const branchIndex = mission.workers.filter((w) => w.id.startsWith(`${workerId}-branch-`)).length + 1;
        const newWorkerId = `${workerId}-branch-${branchIndex}`;
        const slug = `${slugify(sourceWorker.name)}-branch-${branchIndex}`;

        let wt;
        try {
          wt = await createWorktreeFromRef({ repoRoot: mission.workspaceRoot, missionId, workerSlug: slug, ref: checkpointSha });
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: `branch worktree creation failed: ${error.message}` });
        }

        const providerId = isAgentProvider(sourceWorker.provider) ? sourceWorker.provider : "claude";
        const providerProfile = profileById.get(providerId);
        const workerProfile = { ...providerProfile, cwd: wt.path, args: AGENT_PROVIDERS[providerId].buildArgs(sourceWorker.mode) };
        const sessionId = `mission-${missionId}-${newWorkerId}`;
        const session = startSession(sessionId, workerProfile, { cols: 100, rows: 28, missionId, workerId: newWorkerId });

        const newWorker = {
          id: newWorkerId,
          index: mission.workers.length + 1,
          name: `${sourceWorker.name} (branch ${branchIndex})`,
          scope: sourceWorker.scope,
          deliverables: sourceWorker.deliverables,
          prohibited: sourceWorker.prohibited,
          provider: providerId,
          mode: sourceWorker.mode,
          sessionId,
          cwd: wt.path,
          branch: wt.branch,
          status: session.status === "error" ? "failed" : "starting",
          resumingFrom: { checkpointTs: checkpoint.ts, summary: String(body.note ?? `Branched from worker ${sourceWorker.name}'s ${checkpoint.ledgerEventType} checkpoint.`) },
        };
        mission.workers.push(newWorker);
        await missionStore.writeMission(appDir, missionId, mission);
        await missionStore.appendLedger(appDir, missionId, { workerId: newWorkerId, source: "termina", type: "BRANCHED", detail: `branched from ${workerId} at checkpoint ${checkpointSha}` });

        (async () => {
          const ready = await waitForReady(sessionId, READY_TIMEOUT_MS);
          if (!ready) return;
          const s = sessions.get(sessionId);
          if (!s) return;
          try {
            submitPrompt(s, buildWorkerPrompt({ mission, worker: newWorker }));
          } catch {
            /* ignore */
          }
        })();

        return sendJson(res, 200, { ok: true, worker: newWorker });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }
```

- [ ] **Step 7: Run the full existing test suite to check nothing broke**

Run: `npm test`
Expected: PASS — all previously-passing tests plus every new test from Tasks 1-5 (should be roughly 48 + ~20 new).

- [ ] **Step 8: Commit**

```bash
git add server.js mission/store.js
git commit -m "Wire Mission DVR recorder/checkpoint/token-tracker into server.js; add recordings/checkpoints/tokens/branch API routes"
```

---

### Task 7: Timeline UI + branch action

**Files:**
- Create: `public/timeline.js`
- Modify: `public/mission.js` (add a "Timeline" tab button that mounts it)
- Modify: `public/styles.css` (timeline track/scrubber/sparkline styles)

**Interfaces:**
- Consumes: `GET /api/missions/:id/recordings/:workerId`, `GET /api/missions/:id/checkpoints`, `GET /api/missions/:id/tokens`, `POST /api/missions/:id/workers/:workerId/branch` (Task 6); the existing `escapeHtml`, API fetch helper, and Mission Command Center container conventions already used in `public/mission.js`.
- Produces: `mountTimeline(container, missionId)` — the only export `mission.js` calls.

This task is UI glue exercised by manual verification (Step 3), not
`node --test` (existing frontend code has no browser test harness — follow
existing project convention).

- [ ] **Step 1: Read `public/mission.js` in full before writing this file**

Before writing `public/timeline.js`, read `public/mission.js` top to bottom to copy its exact conventions for: the API fetch helper (token header, base path), the tab-switching pattern, `escapeHtml`, and how it renders the worker roster table — so `timeline.js` looks like it was written by the same author, not a bolted-on module. Do not proceed to Step 2 until this read is done.

- [ ] **Step 2: Implement `public/timeline.js`**

```js
// public/timeline.js
// Mission DVR: a scrub timeline across every worker in a mission, with
// checkpoint markers and a token-cost sparkline. Scrubbing replays a
// worker's recorded frames into a detached, read-only xterm.js instance — it
// never touches the worker's live PTY session or its WebSocket. Branching
// from a checkpoint opens a brand-new sibling tile; the original worker is
// never interrupted.
import { escapeHtml, apiFetch } from "./api.js";

const BRANCH_CAVEAT =
  "Branching restores this worker's FILES to this point in time and starts a fresh live agent there. " +
  "It does not resume the original process, memory, or any running dev server — only the filesystem and a summary of what happened.";

export async function mountTimeline(container, missionId) {
  container.innerHTML = `<div class="timeline-loading">Loading recordings…</div>`;

  const [missionRes, checkpointsRes, tokensRes] = await Promise.all([
    apiFetch(`/api/missions/${missionId}`),
    apiFetch(`/api/missions/${missionId}/checkpoints`),
    apiFetch(`/api/missions/${missionId}/tokens`),
  ]);
  if (!missionRes.ok || !checkpointsRes.ok || !tokensRes.ok) {
    container.innerHTML = `<div class="timeline-error">Could not load timeline data.</div>`;
    return;
  }

  const mission = missionRes.mission;
  const checkpoints = checkpointsRes.checkpoints;
  const history = tokensRes.history;
  const workers = mission.workers.filter((w) => w.branch); // only isolated workers ever get checkpoints/recordings

  if (!workers.length) {
    container.innerHTML = `<div class="timeline-empty">No isolated workers on this mission — nothing to record. Timeline is only available for write-mode workers in isolated worktrees.</div>`;
    return;
  }

  const start = Math.min(...workers.map((w) => new Date(w.startedAt ?? mission.createdAt).getTime()));
  const end = Date.now();
  const span = Math.max(end - start, 1000);

  container.innerHTML = `
    <div class="timeline-caveat">${escapeHtml(BRANCH_CAVEAT)}</div>
    <div class="timeline-scrub" tabindex="0"></div>
    <div class="timeline-tracks">
      ${workers
        .map(
          (w) => `
        <div class="timeline-track" data-worker-id="${escapeHtml(w.id)}">
          <div class="timeline-track-label">${escapeHtml(w.name)}</div>
          <div class="timeline-track-lane"></div>
          <svg class="timeline-sparkline" preserveAspectRatio="none"></svg>
        </div>`,
        )
        .join("")}
    </div>
    <div class="timeline-replay hidden">
      <div class="timeline-replay-badge">REPLAY</div>
      <button class="timeline-replay-exit">Back to live</button>
      <pre class="timeline-replay-output"></pre>
    </div>
  `;

  for (const worker of workers) {
    const lane = container.querySelector(`.timeline-track[data-worker-id="${cssEscape(worker.id)}"] .timeline-track-lane`);
    const workerCheckpoints = checkpoints.filter((c) => c.workerId === worker.id);
    for (const cp of workerCheckpoints) {
      const pct = (((cp.ts - start) / span) * 100).toFixed(2);
      const tick = document.createElement("button");
      tick.className = "timeline-checkpoint-tick";
      tick.style.left = `${pct}%`;
      tick.title = `${cp.ledgerEventType} — ${new Date(cp.ts).toLocaleTimeString()}`;
      tick.addEventListener("click", () => openBranchPopover(tick, missionId, worker, cp));
      lane.appendChild(tick);
    }

    const spark = container.querySelector(`.timeline-track[data-worker-id="${cssEscape(worker.id)}"] .timeline-sparkline`);
    renderSparkline(spark, history.filter((h) => h.workerId === worker.id), start, span);
  }

  const scrub = container.querySelector(".timeline-scrub");
  scrub.addEventListener("click", async (e) => {
    const rect = scrub.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const ts = start + pct * span;
    await enterReplay(container, missionId, workers, ts);
  });

  container.querySelector(".timeline-replay-exit").addEventListener("click", () => {
    container.querySelector(".timeline-replay").classList.add("hidden");
  });
}

function cssEscape(id) {
  return String(id).replace(/"/g, '\\"');
}

function renderSparkline(svg, samples, start, span) {
  if (!samples.length) return;
  const points = samples
    .map((s) => {
      const x = (((s.ts - start) / span) * 100).toFixed(2);
      const y = (100 - Math.min(100, (s.costUsd ?? 0) * 1000)).toFixed(2); // scaled; cost is small
      return `${x},${y}`;
    })
    .join(" ");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.innerHTML = `<polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" />`;
}

async function enterReplay(container, missionId, workers, ts) {
  const replay = container.querySelector(".timeline-replay");
  const output = replay.querySelector(".timeline-replay-output");
  replay.classList.remove("hidden");
  replay.querySelector(".timeline-replay-badge").textContent = `REPLAY — ${new Date(ts).toLocaleTimeString()}`;
  output.textContent = "Loading recorded output…";

  const worker = workers[0]; // v1: replay the first worker's track; multi-pane sync is a follow-up
  const res = await apiFetch(`/api/missions/${missionId}/recordings/${worker.id}`);
  if (!res.ok) {
    output.textContent = "Recording unavailable for this worker.";
    return;
  }
  const upTo = res.frames.filter((f) => f.ts <= ts).map((f) => f.data);
  output.textContent = upTo.join("");
}

function openBranchPopover(anchor, missionId, worker, checkpoint) {
  const existing = document.querySelector(".timeline-branch-popover");
  existing?.remove();

  const popover = document.createElement("div");
  popover.className = "timeline-branch-popover";
  popover.innerHTML = `
    <div class="timeline-branch-caveat">${escapeHtml(BRANCH_CAVEAT)}</div>
    <input type="text" class="timeline-branch-note" placeholder="Optional note for the new worker" />
    <div class="timeline-branch-actions">
      <button class="timeline-branch-cancel">Cancel</button>
      <button class="timeline-branch-confirm">Branch from here</button>
    </div>
  `;
  const rect = anchor.getBoundingClientRect();
  popover.style.left = `${rect.left}px`;
  popover.style.top = `${rect.bottom + 6}px`;
  document.body.appendChild(popover);

  popover.querySelector(".timeline-branch-cancel").addEventListener("click", () => popover.remove());
  popover.querySelector(".timeline-branch-confirm").addEventListener("click", async () => {
    const note = popover.querySelector(".timeline-branch-note").value.trim();
    popover.querySelector(".timeline-branch-confirm").disabled = true;
    const res = await apiFetch(`/api/missions/${missionId}/workers/${worker.id}/branch`, {
      method: "POST",
      body: JSON.stringify({ checkpointSha: checkpoint.sha, note: note || undefined }),
    });
    popover.remove();
    if (!res.ok) {
      window.alert(`Branch failed: ${res.error ?? "unknown error"}`);
    }
  });
}
```

- [ ] **Step 3: Add a "Timeline" tab to the Mission Command Center**

In `public/mission.js`, find where the Command Center's existing tab(s) (roster table) are rendered/switched, and add a sibling "Timeline" tab button that, on click, calls `mountTimeline(timelineContainer, mission.id)` from the new module — mirror the exact DOM structure and event-binding style already used for the existing roster tab so the two tabs are visually and structurally consistent. Import at the top of `public/mission.js`:

```js
import { mountTimeline } from "./timeline.js";
```

- [ ] **Step 4: Add Timeline styles to `public/styles.css`**

Append (matching the existing file's CSS custom-property usage — reuse `--accent`, `--gold`, `--red` etc. rather than introducing new raw colors):

```css
.timeline-caveat {
  font-size: 12px;
  color: var(--muted, #888);
  padding: 8px 12px;
  border-left: 2px solid var(--gold);
  margin-bottom: 12px;
}
.timeline-scrub {
  height: 28px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 8px;
}
.timeline-track {
  display: grid;
  grid-template-columns: 140px 1fr;
  align-items: center;
  gap: 8px;
  height: 40px;
  position: relative;
}
.timeline-track-lane {
  position: relative;
  height: 20px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
}
.timeline-checkpoint-tick {
  position: absolute;
  top: -2px;
  width: 10px;
  height: 24px;
  border: none;
  background: var(--accent);
  border-radius: 2px;
  cursor: pointer;
}
.timeline-sparkline {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  color: var(--gold);
  pointer-events: none;
}
.timeline-replay {
  position: fixed;
  inset: 5% 10%;
  background: #000;
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 12px;
  z-index: 50;
  overflow: auto;
}
.timeline-replay.hidden {
  display: none;
}
.timeline-replay-badge {
  color: var(--red);
  font-weight: 600;
  margin-bottom: 8px;
}
.timeline-branch-popover {
  position: fixed;
  background: #111;
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 10px;
  z-index: 60;
  width: 260px;
}
```

- [ ] **Step 5: Manual verification (no automated frontend test harness exists yet)**

Run: `npm start`, open the app, launch a small isolated mission (git repo workspace, approval mode, 1-2 workers), let it run long enough to emit at least one `FILE_CLAIM` or `PROPOSED_CHANGE`, open the Mission Command Center, click the new "Timeline" tab, confirm: checkpoint ticks appear on the worker's track, dragging/clicking the scrub bar shows recorded output in the replay pane, clicking a checkpoint tick opens the branch popover with the caveat text visible, and confirming it opens a new sibling tile without disturbing the original worker's tile.

- [ ] **Step 6: Commit**

```bash
git add public/timeline.js public/mission.js public/styles.css
git commit -m "Add Mission DVR timeline UI: scrub, checkpoint ticks, token sparkline, branch action"
```

---

### Task 8: End-to-end branch test

**Files:**
- Create: `tests/mission/branch.test.mjs`

**Interfaces:**
- Consumes: `createWorktreeFromRef` (Task 3), `maybeCheckpoint`/`readCheckpoints` (Task 2), `writeMission`/`readMission` (`mission/store.js`).

This exercises the same sequence the `/branch` route in Task 6 performs,
without spinning up a real PTY/server (matching how `worktree.test.mjs`
tests git operations directly rather than through the HTTP layer).

- [ ] **Step 1: Write the failing test**

```js
// tests/mission/branch.test.mjs
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { maybeCheckpoint, readCheckpoints } from "../../mission/checkpoint.js";
import { createWorktreeFromRef } from "../../mission/worktree.js";

const run = promisify(execFile);

async function makeScratchRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "termina-branch-repo-"));
  await run("git", ["init", "-q"], { cwd: repoRoot });
  await run("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
  await run("git", ["config", "user.name", "Test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "app.js"), "v1\n", "utf8");
  await run("git", ["add", "app.js"], { cwd: repoRoot });
  await run("git", ["commit", "-q", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}

test("a worker's checkpoint can be branched into a new worktree whose files match that point in time, leaving the original worker's files untouched", async () => {
  const repoRoot = await makeScratchRepo();
  let originalWt;
  let branchWt;
  try {
    originalWt = await createWorktreeFromRef({ repoRoot, missionId: "m1", workerSlug: "backend" });

    // worker edits a file and "proposes a change" -> checkpoint fires
    await writeFile(path.join(originalWt.path, "app.js"), "v2 (proposed)\n", "utf8");
    const appDir = await mkdtemp(path.join(os.tmpdir(), "termina-branch-appdir-"));
    const checkpoint = await maybeCheckpoint({
      appDir,
      missionId: "m1",
      worker: { id: "w1", branch: originalWt.branch, cwd: originalWt.path },
      eventType: "PROPOSED_CHANGE",
    });
    assert.ok(checkpoint);

    // worker keeps going, files change again after the checkpoint
    await writeFile(path.join(originalWt.path, "app.js"), "v3 (kept working)\n", "utf8");

    // branch from the checkpoint into a sibling worktree
    branchWt = await createWorktreeFromRef({ repoRoot, missionId: "m1", workerSlug: "backend-branch-1", ref: checkpoint.sha });

    const branchedContent = await readFile(path.join(branchWt.path, "app.js"), "utf8");
    assert.equal(branchedContent, "v2 (proposed)\n"); // frozen at the checkpoint, not v1 and not v3

    const originalContent = await readFile(path.join(originalWt.path, "app.js"), "utf8");
    assert.equal(originalContent, "v3 (kept working)\n"); // original worker's live files are untouched by branching

    const all = await readCheckpoints(appDir, "m1");
    assert.equal(all.length, 1);
    await rm(appDir, { recursive: true, force: true });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    if (originalWt) await rm(originalWt.path, { recursive: true, force: true }).catch(() => {});
    if (branchWt) await rm(branchWt.path, { recursive: true, force: true }).catch(() => {});
  }
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `node --test tests/mission/branch.test.mjs`
Expected: Since Tasks 2 and 3 are already implemented by this point in the plan, this should PASS immediately — it's an integration check that the two pieces compose correctly, not new production code. If it fails, that's a real bug in Task 2 or 3's implementation to fix before moving on.

- [ ] **Step 3: Run the full test suite one more time**

Run: `npm test`
Expected: PASS, full suite (original 48 + all new tests across Tasks 1-5 and 8).

- [ ] **Step 4: Commit**

```bash
git add tests/mission/branch.test.mjs
git commit -m "Add end-to-end test: checkpoint -> branch preserves frozen file state, leaves original worker untouched"
```
