# OpenRouter Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, from-scratch interactive coding agent against OpenRouter's API, spawned by Termina exactly like `claude`/`codex`, usable as both a Mission Mode worker and a solo tile.

**Architecture:** A new `openrouter-agent/` directory with small, independently-testable modules (paste parsing, tools, usage logging, the OpenRouter HTTP client, and the entrypoint that wires them together), plus a dedicated detect pack, an `openrouter` entry in `mission/adapters.js`, an `openrouter` provider in `connections.js` (API key + model slug), a solo-tile profile, and a token-tracking adapter.

**Tech Stack:** Node's built-in `fetch`/`child_process`/`node:test`, no new dependencies.

## Global Constraints

- No new npm dependencies.
- No live network call to OpenRouter is unit-tested (no API key available) — every module around it is.
- `buildArgs(mode, opts)` across `mission/adapters.js` must stay backward compatible: Claude/Codex's existing `buildArgs(mode)` implementations are untouched.
- Follow existing conventions exactly: `psQuote`-style pwsh escaping (`mission/claude-print.js`), fixture-driven detect tests (`tests/detect/*.test.mjs`), `mkdtemp`-based temp-dir tests (every other test file in this repo).

---

### Task 1: `openrouter-agent/paste.mjs`

**Files:**
- Create: `openrouter-agent/paste.mjs`
- Test: `tests/openrouter-agent/paste.test.mjs`

**Interfaces:**
- Produces: `createPasteParser() -> { feed(chunk: string): {type:"buffering"} | {type:"submitted", text: string} }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/openrouter-agent/paste.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { createPasteParser } from "../../openrouter-agent/paste.mjs";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

test("a plain single-line submission (no bracketed paste) submits on Enter", () => {
  const parser = createPasteParser();
  assert.deepEqual(parser.feed("hello"), { type: "buffering" });
  assert.deepEqual(parser.feed("\r"), { type: "submitted", text: "hello" });
});

test("a bracketed-paste block with embedded newlines does not submit early", () => {
  const parser = createPasteParser();
  assert.deepEqual(parser.feed(`${PASTE_START}line one\nline two\nline three`), { type: "buffering" });
  assert.deepEqual(parser.feed("\n"), { type: "buffering" }); // still inside the paste block
  assert.deepEqual(parser.feed(PASTE_END), { type: "buffering" }); // paste closed, not yet submitted
  assert.deepEqual(parser.feed("\r"), { type: "submitted", text: "line one\nline two\nline three" });
});

test("after one submission, the parser resets and accepts the next input", () => {
  const parser = createPasteParser();
  parser.feed("first");
  parser.feed("\r");
  assert.deepEqual(parser.feed("second"), { type: "buffering" });
  assert.deepEqual(parser.feed("\r"), { type: "submitted", text: "second" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/openrouter-agent/paste.test.mjs`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```js
// openrouter-agent/paste.mjs
// Mirrors what mission/paste.js sends: a bracketed-paste block
// (\x1b[200~...\x1b[201~) followed by a separate \r once the paste
// settles. Embedded newlines inside an active paste block must never
// trigger early submission — only a \r/\n OUTSIDE the paste block does.
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export function createPasteParser() {
  let buffer = "";
  let inPaste = false;

  return {
    feed(chunk) {
      buffer += chunk;

      if (!inPaste && buffer.includes(PASTE_START)) {
        inPaste = true;
        buffer = buffer.slice(buffer.indexOf(PASTE_START) + PASTE_START.length);
      }

      if (inPaste) {
        const endIdx = buffer.indexOf(PASTE_END);
        if (endIdx === -1) return { type: "buffering" };
        // paste content is finalized, but submission still waits for a
        // separate \r — strip the end marker and keep buffering.
        buffer = buffer.slice(0, endIdx) + buffer.slice(endIdx + PASTE_END.length);
        inPaste = false;
      }

      const submitIdx = buffer.search(/[\r\n]/);
      if (submitIdx === -1) return { type: "buffering" };
      const text = buffer.slice(0, submitIdx);
      buffer = "";
      return { type: "submitted", text };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/openrouter-agent/paste.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add openrouter-agent/paste.mjs tests/openrouter-agent/paste.test.mjs
git commit -m "Add OpenRouter agent bracketed-paste parser"
```

---

### Task 2: `openrouter-agent/tools.mjs`

**Files:**
- Create: `openrouter-agent/tools.mjs`
- Test: `tests/openrouter-agent/tools.test.mjs`

**Interfaces:**
- Produces: `readFile({path}, {cwd}) -> Promise<{content}|{error}>`, `writeFile({path,content}, {cwd,mode}) -> Promise<{ok:true}|{error}>`, `listDirectory({path}, {cwd}) -> Promise<{entries}|{error}>`, `runCommand({command}, {cwd,mode}) -> Promise<{stdout,stderr,exitCode}|{error}>`.

- [ ] **Step 1: Write the failing test**

```js
// tests/openrouter-agent/tools.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, readFile as fsReadFile, rm, writeFile as fsWriteFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { listDirectory, readFile, runCommand, writeFile } from "../../openrouter-agent/tools.mjs";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-openrouter-tools-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readFile returns file contents", async () => {
  await withTempDir(async (cwd) => {
    await fsWriteFile(path.join(cwd, "a.txt"), "hello world", "utf8");
    const result = await readFile({ path: "a.txt" }, { cwd });
    assert.equal(result.content, "hello world");
  });
});

test("readFile on a missing file returns an error, not a throw", async () => {
  await withTempDir(async (cwd) => {
    const result = await readFile({ path: "nope.txt" }, { cwd });
    assert.ok(result.error);
  });
});

test("writeFile is blocked in plan mode", async () => {
  await withTempDir(async (cwd) => {
    const result = await writeFile({ path: "b.txt", content: "x" }, { cwd, mode: "plan" });
    assert.match(result.error, /plan mode/i);
    await assert.rejects(fsReadFile(path.join(cwd, "b.txt"), "utf8"));
  });
});

test("writeFile succeeds in auto mode", async () => {
  await withTempDir(async (cwd) => {
    const result = await writeFile({ path: "b.txt", content: "hello" }, { cwd, mode: "auto" });
    assert.equal(result.ok, true);
    assert.equal(await fsReadFile(path.join(cwd, "b.txt"), "utf8"), "hello");
  });
});

test("listDirectory lists entries in a populated directory", async () => {
  await withTempDir(async (cwd) => {
    await fsWriteFile(path.join(cwd, "one.txt"), "", "utf8");
    await fsWriteFile(path.join(cwd, "two.txt"), "", "utf8");
    const result = await listDirectory({ path: "." }, { cwd });
    assert.deepEqual(result.entries.sort(), ["one.txt", "two.txt"]);
  });
});

test("runCommand executes a real command and captures stdout/exitCode", async () => {
  await withTempDir(async (cwd) => {
    const result = await runCommand({ command: "echo hi" }, { cwd, mode: "auto" });
    assert.match(result.stdout, /hi/);
    assert.equal(result.exitCode, 0);
  });
});

test("runCommand is blocked in plan mode", async () => {
  await withTempDir(async (cwd) => {
    const result = await runCommand({ command: "echo hi" }, { cwd, mode: "plan" });
    assert.match(result.error, /plan mode/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/openrouter-agent/tools.test.mjs`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```js
// openrouter-agent/tools.mjs
// The four tools available to the OpenRouter agent. plan/approval/auto
// gating for write_file/run_command happens here for "plan" (outright
// blocked); the "approval" y/n gate itself lives in agent.mjs (needs
// access to the raw-mode stdin loop, which these pure functions
// deliberately don't touch, so they stay unit-testable without faking
// terminal input).
import { execFile } from "node:child_process";
import { readdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_READ_BYTES = 100 * 1024;
const MAX_COMMAND_BUFFER = 4 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 60000;

function resolveWithin(cwd, relPath) {
  return path.resolve(cwd, relPath);
}

export async function readFile({ path: relPath }, { cwd }) {
  try {
    const full = resolveWithin(cwd, relPath);
    const content = await fsReadFile(full, "utf8");
    return { content: content.length > MAX_READ_BYTES ? content.slice(0, MAX_READ_BYTES) + "\n...(truncated)" : content };
  } catch (error) {
    return { error: error.message };
  }
}

export async function writeFile({ path: relPath, content }, { cwd, mode }) {
  if (mode === "plan") return { error: "blocked: plan mode is read-only" };
  try {
    const full = resolveWithin(cwd, relPath);
    await fsWriteFile(full, content, "utf8");
    return { ok: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function listDirectory({ path: relPath }, { cwd }) {
  try {
    const full = resolveWithin(cwd, relPath ?? ".");
    const entries = await readdir(full);
    return { entries };
  } catch (error) {
    return { error: error.message };
  }
}

export async function runCommand({ command }, { cwd, mode }) {
  if (mode === "plan") return { error: "blocked: plan mode is read-only" };
  try {
    const { stdout, stderr } = await run("pwsh.exe", ["-NoLogo", "-NoProfile", "-Command", command], {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_COMMAND_BUFFER,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", exitCode: typeof error.code === "number" ? error.code : 1 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/openrouter-agent/tools.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add openrouter-agent/tools.mjs tests/openrouter-agent/tools.test.mjs
git commit -m "Add OpenRouter agent tool implementations (read/write/list/run)"
```

---

### Task 3: `openrouter-agent/usage-log.mjs`

**Files:**
- Create: `openrouter-agent/usage-log.mjs`
- Test: `tests/openrouter-agent/usage-log.test.mjs`

**Interfaces:**
- Produces: `appendUsage(logPath, {ts,promptTokens,completionTokens,model,costUsd}) -> Promise<void>`, `readUsage(logPath) -> Promise<Array<{...}>>`.

- [ ] **Step 1: Write the failing test**

```js
// tests/openrouter-agent/usage-log.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { appendUsage, readUsage } from "../../openrouter-agent/usage-log.mjs";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-openrouter-usage-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("appendUsage is a no-op when logPath is undefined", async () => {
  await assert.doesNotReject(appendUsage(undefined, { ts: 1, promptTokens: 1, completionTokens: 1, model: "x", costUsd: null }));
});

test("appendUsage/readUsage round-trip, entries in order", async () => {
  await withTempDir(async (dir) => {
    const logPath = path.join(dir, "usage.jsonl");
    await appendUsage(logPath, { ts: 1, promptTokens: 10, completionTokens: 5, model: "z-ai/glm-5.2", costUsd: null });
    await appendUsage(logPath, { ts: 2, promptTokens: 20, completionTokens: 8, model: "z-ai/glm-5.2", costUsd: 0.002 });
    const all = await readUsage(logPath);
    assert.equal(all.length, 2);
    assert.equal(all[0].promptTokens, 10);
    assert.equal(all[1].costUsd, 0.002);
  });
});

test("readUsage on a missing file returns an empty array", async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await readUsage(path.join(dir, "does-not-exist.jsonl")), []);
  });
});

test("readUsage tolerates a corrupted line, keeps the rest", async () => {
  await withTempDir(async (dir) => {
    const logPath = path.join(dir, "usage.jsonl");
    const good = JSON.stringify({ ts: 1, promptTokens: 1, completionTokens: 1, model: "x", costUsd: null });
    await writeFile(logPath, `${good}\nnot json\n${good}\n`, "utf8");
    const all = await readUsage(logPath);
    assert.equal(all.length, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/openrouter-agent/usage-log.test.mjs`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```js
// openrouter-agent/usage-log.mjs
// Best-effort JSONL logger, same never-block philosophy as every other
// logger in this codebase. A no-op when logPath is undefined — solo-tile
// usage (outside Mission Mode) isn't tracked, matching how Mission DVR
// recording is already mission-only.
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function appendUsage(logPath, entry) {
  if (!logPath) return;
  try {
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    /* best effort only */
  }
}

export async function readUsage(logPath) {
  if (!existsSync(logPath)) return [];
  let text;
  try {
    text = await readFile(logPath, "utf8");
  } catch {
    return [];
  }
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

Run: `node --test tests/openrouter-agent/usage-log.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add openrouter-agent/usage-log.mjs tests/openrouter-agent/usage-log.test.mjs
git commit -m "Add OpenRouter agent usage logger"
```

---

### Task 4: `openrouter-agent/openrouter-client.mjs` (untestable without a live key — kept minimal and isolated)

**Files:**
- Create: `openrouter-agent/openrouter-client.mjs`

No test file — this is the one piece that requires a live network call. Keeping it
to one small function is the mitigation: everything around it (Tasks 1-3) is fully
tested, so this is the smallest possible untested surface.

- [ ] **Step 1: Write the implementation**

```js
// openrouter-agent/openrouter-client.mjs
// The one piece of this feature that requires a live OPENROUTER_API_KEY to
// verify — no key was available while building this, so this function is
// deliberately minimal and isolated. Standard OpenAI-compatible chat-
// completions shape, per OpenRouter's documented API.
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export async function chatCompletion({ apiKey, model, messages, tools }) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, tools, tool_choice: tools?.length ? "auto" : undefined }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error?.message || `OpenRouter request failed: HTTP ${res.status}`);
  }
  return body;
}

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file's contents, relative to the current working directory.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file, relative to the current working directory. Creates or overwrites.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List entries in a directory, relative to the current working directory.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the current working directory and return its output.",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    },
  },
];
```

- [ ] **Step 2: Syntax-check**

Run: `node --check openrouter-agent/openrouter-client.mjs`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add openrouter-agent/openrouter-client.mjs
git commit -m "Add OpenRouter chat-completions client and tool definitions"
```

---

### Task 5: `openrouter-agent/agent.mjs` (entrypoint)

**Files:**
- Create: `openrouter-agent/agent.mjs`

No dedicated unit test (it's the raw-mode stdin wiring itself — the logic
inside it is already tested via Tasks 1-3; this task's own verification is
the manual check in Task 10). Follows the exact shape `mission/prompt.js`'s
`REPORTING PROTOCOL` section already expects from any worker: no
special-casing needed for Mission Mode to treat this like any other
provider.

- [ ] **Step 1: Write the implementation**

```js
#!/usr/bin/env node
// OpenRouter Agent — a from-scratch interactive coding agent, spawned by
// Termina exactly like claude/codex (same PTY, same wall tile, same
// detection/ledger/DVR infrastructure). Reads OPENROUTER_API_KEY and
// OPENROUTER_MODEL from its environment (populated by connections.js via
// terminalEnv()); exits with a clear one-line error in its own PTY output
// if either is missing.
import { createPasteParser } from "./paste.mjs";
import { chatCompletion, TOOL_DEFINITIONS } from "./openrouter-client.mjs";
import { listDirectory, readFile, runCommand, writeFile } from "./tools.mjs";
import { appendUsage } from "./usage-log.mjs";

const IDLE_PROMPT = "openrouter▸ ";

function parseArgs(argv) {
  const args = { mode: "approval", usageLogPath: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--mode") args.mode = argv[++i];
    else if (argv[i] === "--usage-log") args.usageLogPath = argv[++i];
  }
  return args;
}

const TOOL_FNS = { read_file: readFile, write_file: writeFile, list_directory: listDirectory, run_command: runCommand };
const WRITE_TOOLS = new Set(["write_file", "run_command"]);

async function askApproval(toolName) {
  process.stdout.write(`APPROVE ${toolName}? (y/n) `);
  return new Promise((resolve) => {
    const onData = (chunk) => {
      const answer = chunk.toString("utf8").toLowerCase();
      process.stdin.off("data", onData);
      process.stdout.write("\r\n");
      resolve(answer.startsWith("y"));
    };
    process.stdin.on("data", onData);
  });
}

async function runTool(name, toolArgs, { cwd, mode }) {
  const fn = TOOL_FNS[name];
  if (!fn) return { error: `unknown tool: ${name}` };
  if (mode === "approval" && WRITE_TOOLS.has(name)) {
    const approved = await askApproval(`${name}(${JSON.stringify(toolArgs)})`);
    if (!approved) return { error: "denied by user" };
  }
  process.stdout.write(`\r\n→ ${name}(${JSON.stringify(toolArgs)})\r\n`);
  return fn(toolArgs, { cwd, mode });
}

async function handleSubmission(text, state) {
  state.messages.push({ role: "user", content: text });
  for (let turn = 0; turn < 20; turn += 1) {
    let response;
    try {
      response = await chatCompletion({
        apiKey: state.apiKey,
        model: state.model,
        messages: state.messages,
        tools: TOOL_DEFINITIONS,
      });
    } catch (error) {
      process.stdout.write(`\r\n[error] ${error.message}\r\n`);
      break;
    }
    const usage = response.usage ?? {};
    await appendUsage(state.usageLogPath, {
      ts: Date.now(),
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      model: state.model,
      costUsd: typeof response.usage?.cost === "number" ? response.usage.cost : null,
    });

    const choice = response.choices?.[0];
    const message = choice?.message ?? {};
    state.messages.push(message);

    if (!message.tool_calls?.length) {
      process.stdout.write(`\r\n${message.content ?? ""}\r\n`);
      break;
    }
    for (const call of message.tool_calls) {
      const toolArgs = JSON.parse(call.function.arguments || "{}");
      const result = await runTool(call.function.name, toolArgs, { cwd: process.cwd(), mode: state.mode });
      state.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  process.stdout.write(`\r\n${IDLE_PROMPT}`);
}

function main() {
  const { mode, usageLogPath } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!apiKey || !model) {
    process.stdout.write("[error] OPENROUTER_API_KEY and OPENROUTER_MODEL must be set (Connections panel) — exiting.\r\n");
    process.exit(1);
  }

  const state = {
    apiKey,
    model,
    mode,
    usageLogPath,
    messages: [{ role: "system", content: "You are a capable coding agent operating inside a real project directory via read_file/write_file/list_directory/run_command tools." }],
  };

  process.stdout.write(`OpenRouter agent — model ${model}, mode ${mode}\r\n${IDLE_PROMPT}`);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  const parser = createPasteParser();
  process.stdin.on("data", async (chunk) => {
    const result = parser.feed(chunk.toString("utf8"));
    if (result.type === "submitted" && result.text.trim()) {
      await handleSubmission(result.text, state);
    }
  });
}

main();
```

- [ ] **Step 2: Syntax-check**

Run: `node --check openrouter-agent/agent.mjs`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add openrouter-agent/agent.mjs
git commit -m "Add OpenRouter agent entrypoint"
```

---

### Task 6: `detect/packs/openrouter.js`

**Files:**
- Create: `detect/packs/openrouter.js`
- Modify: `detect/index.js` (register the pack)
- Create: `tests/detect/fixtures/openrouter.jsonl`
- Create: `tests/detect/openrouter.test.mjs`

**Interfaces:**
- Produces: `openrouterPack: Array<{id,label,state,confidence,pattern,describe}>` (same shape as `codexPack`).

- [ ] **Step 1: Write the failing test + fixtures**

```jsonl
{"name": "idle prompt", "raw": "OpenRouter agent — model z-ai/glm-5.2, mode auto\r\nopenrouter▸ ", "expect": "waiting"}
{"name": "approval prompt", "raw": "APPROVE write_file({\"path\":\"app.js\"})? (y/n) ", "expect": "needs_approval"}
{"name": "tool call announcement", "raw": "→ read_file({\"path\":\"app.js\"})\r\n", "expect": "running"}
{"name": "error line", "raw": "[error] OpenRouter request failed: HTTP 500\r\n", "expect": "failed"}
```

(This is a real file, `tests/detect/fixtures/openrouter.jsonl` — write it
with a text editor / Write tool, not a shell heredoc, so the `▸`/`→`
Unicode characters are encoded correctly as UTF-8, not escaped oddly.)

```js
// tests/detect/openrouter.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { createDetector } from "../../detect/index.js";
import { loadFixtures } from "./fixtures.mjs";

test("openrouter pack classifies representative output", () => {
  for (const fixture of loadFixtures("openrouter.jsonl")) {
    const detector = createDetector({ detector: "openrouter" });
    detector.feed(fixture.raw);
    const result = detector.evaluate();
    assert.equal(
      result.state,
      fixture.expect,
      `${fixture.name}: expected "${fixture.expect}", got "${result.state}" (rule ${result.ruleId})`,
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/detect/openrouter.test.mjs`
Expected: FAIL — `detect/packs/openrouter.js` doesn't exist / not registered.

- [ ] **Step 3: Write the implementation**

```js
// detect/packs/openrouter.js
// Rules matching the OpenRouter agent's OWN literal output (openrouter-
// agent/agent.mjs prints these exact strings) — high confidence is
// justified here, unlike the necessarily-heuristic Claude/Codex packs,
// because both sides of this match are controlled by this codebase.
export const openrouterPack = [
  {
    id: "openrouter-idle-prompt",
    label: "Idle input prompt",
    state: "waiting",
    confidence: 0.95,
    pattern: /openrouter▸ $/,
    describe: () => "the agent's own idle-prompt marker",
  },
  {
    id: "openrouter-approval-prompt",
    label: "Tool approval prompt",
    state: "needs_approval",
    confidence: 0.95,
    pattern: /APPROVE .+\? \(y\/n\) $/,
    describe: (m) => `matched approval prompt "${m[0]}"`,
  },
  {
    id: "openrouter-tool-call",
    label: "Tool call announcement",
    state: "running",
    confidence: 0.9,
    pattern: /^→ /m,
    describe: () => "a tool-call announcement line",
  },
  {
    id: "openrouter-error",
    label: "Error line",
    state: "failed",
    confidence: 0.8,
    pattern: /^\[error\]/m,
    describe: (m) => `matched error line "${m[0]}"`,
  },
];
```

Register it in `detect/index.js`:

```js
import { openrouterPack } from "./packs/openrouter.js";
```

```js
const PACKS = {
  claude: claudePack,
  codex: codexPack,
  openrouter: openrouterPack,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/detect/openrouter.test.mjs`
Expected: PASS (1 test, 4 fixtures).

- [ ] **Step 5: Run the full detect suite to check nothing broke**

Run: `node --test tests/detect/`
Expected: PASS, all prior detect tests plus the new one.

- [ ] **Step 6: Commit**

```bash
git add detect/packs/openrouter.js detect/index.js tests/detect/fixtures/openrouter.jsonl tests/detect/openrouter.test.mjs
git commit -m "Add OpenRouter detect pack"
```

---

### Task 7: `connections.js` — `extraField` support + `openrouter` provider

**Files:**
- Modify: `connections.js`
- Modify: `tests/connections.test.mjs`

**Interfaces:**
- Produces: `CONNECTION_PROVIDERS.openrouter` with an `extraField` descriptor; `saveConnection(appDir, provider, apiKey, extra?)`; `getApiKeyEnv` includes the extra field's env var when present.

- [ ] **Step 1: Write the failing tests**

Add to `tests/connections.test.mjs`:

```js
test("CONNECTION_PROVIDERS.openrouter declares a model extraField", () => {
  assert.equal(CONNECTION_PROVIDERS.openrouter.envVar, "OPENROUTER_API_KEY");
  assert.equal(CONNECTION_PROVIDERS.openrouter.extraField.envVar, "OPENROUTER_MODEL");
});

test("saveConnection stores and getApiKeyEnv returns an extraField value", async () => {
  await withTempAppDir(async (appDir) => {
    await saveConnection(appDir, "openrouter", "sk-or-test123", "z-ai/glm-5.2");
    const env = getApiKeyEnv(appDir, "openrouter");
    assert.equal(env.OPENROUTER_API_KEY, "sk-or-test123");
    assert.equal(env.OPENROUTER_MODEL, "z-ai/glm-5.2");
  });
});

test("readConnections exposes the extra value as metadata (it's not a secret)", async () => {
  await withTempAppDir(async (appDir) => {
    await saveConnection(appDir, "openrouter", "sk-or-test123", "z-ai/glm-5.2");
    assert.equal(readConnections(appDir).openrouter.extra, "z-ai/glm-5.2");
  });
});
```

Add `CONNECTION_PROVIDERS` to the existing import line in `tests/connections.test.mjs`
if not already imported (it already is, per Task 1 of the Connections plan).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/connections.test.mjs`
Expected: FAIL — `CONNECTION_PROVIDERS.openrouter` is undefined.

- [ ] **Step 3: Write the implementation**

In `connections.js`, update `CONNECTION_PROVIDERS`:

```js
export const CONNECTION_PROVIDERS = {
  claude: { label: "Claude (Anthropic)", envVar: "ANTHROPIC_API_KEY" },
  codex: { label: "Codex (OpenAI)", envVar: "OPENAI_API_KEY" },
  openrouter: {
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    extraField: { name: "model", envVar: "OPENROUTER_MODEL", label: "Model", placeholder: "z-ai/glm-5.2" },
  },
};
```

Update `saveConnection` to accept and store the extra value:

```js
export async function saveConnection(appDir, provider, apiKey, extra) {
  const key = getOrCreateKey(appDir);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const all = readRaw(appDir);
  all[provider] = {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    last4: apiKey.slice(-4),
    connectedAt: Date.now(),
    extra: extra ?? null,
  };
  writeRaw(appDir, all);
}
```

Update `readConnections` to surface `extra` (it's a plain non-secret value,
safe to expose):

```js
export function readConnections(appDir) {
  const all = readRaw(appDir);
  const out = {};
  for (const [provider, entry] of Object.entries(all)) {
    out[provider] = { connected: true, last4: entry.last4, connectedAt: entry.connectedAt, extra: entry.extra ?? null };
  }
  return out;
}
```

Update `getApiKeyEnv` to include the extra field's env var:

```js
export function getApiKeyEnv(appDir, provider) {
  const meta = CONNECTION_PROVIDERS[provider];
  if (!meta) return {};
  const all = readRaw(appDir);
  const entry = all[provider];
  if (!entry) return {};
  try {
    const key = getOrCreateKey(appDir);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "base64"));
    decipher.setAuthTag(Buffer.from(entry.authTag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, "base64")), decipher.final()]);
    const env = { [meta.envVar]: plain.toString("utf8") };
    if (meta.extraField && entry.extra) env[meta.extraField.envVar] = entry.extra;
    return env;
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/connections.test.mjs`
Expected: PASS (all prior tests plus 3 new).

- [ ] **Step 5: Commit**

```bash
git add connections.js tests/connections.test.mjs
git commit -m "Add OpenRouter connection provider with a model extraField"
```

---

### Task 8: `mission/adapters.js` — `openrouter` agent provider

**Files:**
- Modify: `mission/adapters.js`
- Modify: `tests/mission/adapters.test.mjs`

**Interfaces:**
- Produces: `AGENT_PROVIDERS.openrouter.buildArgs(mode, opts?)`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/mission/adapters.test.mjs`:

```js
test("claude/codex/openrouter are all recognized agent providers", () => {
  assert.equal(isAgentProvider("openrouter"), true);
});

test("openrouter buildArgs runs the agent script with the given mode", () => {
  const args = AGENT_PROVIDERS.openrouter.buildArgs("auto").join(" ");
  assert.ok(args.includes("--mode auto"));
  assert.ok(args.includes("agent.mjs"));
});

test("openrouter buildArgs includes --usage-log when a path is given", () => {
  const args = AGENT_PROVIDERS.openrouter.buildArgs("approval", { usageLogPath: "C:\\some\\path\\usage.jsonl" }).join(" ");
  assert.ok(args.includes("--usage-log"));
  assert.ok(args.includes("usage.jsonl"));
});

test("openrouter buildArgs with no opts still works (backward compatible default)", () => {
  assert.doesNotThrow(() => AGENT_PROVIDERS.openrouter.buildArgs("plan"));
});
```

Update `assert.equal(isAgentProvider("claude"), true); assert.equal(isAgentProvider("codex"), true);`
test to also assert `isAgentProvider("openrouter")` — the plan's Step 1
above adds a new dedicated test rather than editing that one, either is
fine; don't duplicate the assertion if editing the existing test instead.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/mission/adapters.test.mjs`
Expected: FAIL — `AGENT_PROVIDERS.openrouter` is undefined.

- [ ] **Step 3: Write the implementation**

In `mission/adapters.js`, add near the top (after the existing imports/comments):

```js
import path from "node:path";
import { fileURLToPath } from "node:url";

const agentScriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "openrouter-agent", "agent.mjs");

// Single-quote escaping for a pwsh -Command string — same shape already
// established in mission/claude-print.js, duplicated locally since
// adapters.js has no existing dependency on claude-print.js.
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
```

Add to `AGENT_PROVIDERS`:

```js
  openrouter: {
    label: "OpenRouter",
    buildArgs: (mode, opts = {}) => {
      let command = `node ${psQuote(agentScriptPath)} --mode ${mode}`;
      if (opts.usageLogPath) command += ` --usage-log ${psQuote(opts.usageLogPath)}`;
      return ["-NoLogo", "-NoExit", "-Command", command];
    },
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/mission/adapters.test.mjs`
Expected: PASS (all prior tests plus 4 new).

- [ ] **Step 5: Commit**

```bash
git add mission/adapters.js tests/mission/adapters.test.mjs
git commit -m "Add OpenRouter as a Mission Mode agent provider"
```

---

### Task 9: `mission/tokens.js` — OpenRouter adapter, `profiles.js` solo-tile entry, `server.js` wiring

**Files:**
- Modify: `mission/tokens.js`
- Modify: `profiles.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `readUsage` (`openrouter-agent/usage-log.mjs`, Task 3); `AGENT_PROVIDERS.openrouter` (Task 8).
- Produces: `TOKEN_ADAPTERS.openrouter`.

- [ ] **Step 1: Add the OpenRouter token adapter**

In `mission/tokens.js`, add near the existing `TOKEN_ADAPTERS` export:

```js
import { readUsage } from "../openrouter-agent/usage-log.mjs";

// Unlike Claude's adapter (which discovers a transcript by scanning a
// directory), the usage log's path is already known — Termina itself
// chose it at spawn time (mission/adapters.js's buildArgs --usage-log) —
// so findTranscript here just returns what it's given.
async function findOpenrouterTranscript(_cwd, _claudeProjectsDir, usageLogPath) {
  return usageLogPath ?? null;
}

async function readOpenrouterUsage(logPath) {
  const entries = await readUsage(logPath);
  let inputTokens = 0;
  let outputTokens = 0;
  let model = null;
  let costUsd = null;
  for (const e of entries) {
    inputTokens += e.promptTokens ?? 0;
    outputTokens += e.completionTokens ?? 0;
    if (e.model) model = e.model;
    if (typeof e.costUsd === "number") costUsd = (costUsd ?? 0) + e.costUsd;
  }
  return { inputTokens, outputTokens, cacheTokens: 0, model, costUsd };
}
```

Update the `TOKEN_ADAPTERS` export:

```js
export const TOKEN_ADAPTERS = {
  claude: { findTranscript: findClaudeTranscript, readUsage: readClaudeUsage },
  codex: null,
  openrouter: { findTranscript: findOpenrouterTranscript, readUsage: readOpenrouterUsage },
};
```

Note: `readOpenrouterUsage` returns its own `costUsd` directly (summed from
whatever OpenRouter's response actually reported, `null` if none of the
entries had one) — this bypasses `costForUsage`'s per-model rate table
entirely for this provider, since OpenRouter's own reported cost (when
present) is more accurate than a guessed rate table Termina would have to
maintain per OpenRouter model. `server.js`'s `pollTokenUsage` (Task 2 in
this same task, below) needs a small adjustment to prefer an adapter-
reported `costUsd` over `costForUsage`'s calculation when the adapter
provides one.

- [ ] **Step 2: Wire `pollTokenUsage` in `server.js` to pass the usage-log path and prefer adapter-reported cost**

Find the existing `pollTokenUsage` function in `server.js`. Change:

```js
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
```

to:

```js
  const adapter = TOKEN_ADAPTERS[worker.provider];
  let usage = null;
  let estimated = true;
  let adapterCostUsd = null;
  if (adapter) {
    const transcript = await adapter.findTranscript(worker.cwd, claudeProjectsDir, worker.usageLogPath);
    if (transcript) {
      const real = await adapter.readUsage(transcript);
      usage = { inputTokens: real.inputTokens, outputTokens: real.outputTokens, model: real.model };
      adapterCostUsd = typeof real.costUsd === "number" ? real.costUsd : null;
      estimated = false;
    }
  }
  if (!usage) {
    const frames = await readFrames(appDir, session.missionId, session.workerId);
    const charCount = (frames ?? []).reduce((sum, f) => sum + f.data.length, 0);
    const est = estimateFromChars(charCount);
    usage = { inputTokens: est.inputTokens, outputTokens: est.outputTokens, model: null };
  }
  const costUsd = adapterCostUsd ?? costForUsage({ model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
```

`worker.usageLogPath` needs to exist on the worker object — add it in
`createMissionWorkers` (`server.js`), the worker `retry` handler, and the
Mission DVR `branch` handler: each already computes `workerId`/`missionId`
in scope, so add one line right before constructing the `workerProfile`/
`session` in each of those three places:

```js
const usageLogPath = providerId === "openrouter" ? path.join(appDir, ".termina", "missions", mission.id, "openrouter-usage", `${workerId}.jsonl`) : undefined;
```

(adjust `mission.id`/`workerId` variable names per each call site's actual
local variable names — `createMissionWorkers` uses `mission.id`/`workerId`
already in scope from its loop; the retry handler uses `missionId`/`workerId`
from its route match; the branch handler uses `missionId`/`newWorkerId`)

and pass it both into `AGENT_PROVIDERS[providerId].buildArgs(mode, { usageLogPath })`
and store it on the worker object (`workers.push({..., usageLogPath})` /
`worker.usageLogPath = usageLogPath` / `newWorker.usageLogPath = usageLogPath`
respectively) so `pollTokenUsage` can read it back later.

- [ ] **Step 3: Add the solo-tile profile**

In `profiles.js`, add to the Windows `BUILT_IN` array (after the existing
`claude` entry):

```js
      {
        id: "openrouter",
        label: "OpenRouter CLI",
        command: PWSH,
        args: ["-NoLogo", "-NoExit", "-Command", `node ${JSON.stringify(path.join(appDir, "openrouter-agent", "agent.mjs"))} --mode approval`],
        cwd: HOME,
        detector: "openrouter",
        note: "Launches the OpenRouter agent (model configured via Connections) in a shell.",
      },
```

- [ ] **Step 4: Syntax-check and run the full suite**

Run: `node --check server.js && node --check profiles.js && node --check mission/tokens.js && npm test`
Expected: no syntax errors; full suite passes (prior count + all new tests
from Tasks 1-3, 6-8).

- [ ] **Step 5: Commit**

```bash
git add mission/tokens.js profiles.js server.js
git commit -m "Wire OpenRouter token tracking, solo-tile profile, and usage-log path plumbing"
```

---

### Task 10: Connections UI extraField support + manual verification

**Files:**
- Modify: `public/connections.js`

**Interfaces:**
- Consumes: `GET /api/connections` (now includes `extra` per Task 7); `POST /api/connections/:provider` (now accepts an optional extra value).

- [ ] **Step 1: Update `public/connections.js` to render/send the extra field**

Change `CONNECTION_PROVIDER_LABELS` (a plain label map) to also carry each
provider's `extraField` descriptor, fetched from `GET /api/connections`'s
own metadata rather than hand-duplicated client-side — simplest: fetch
`CONNECTION_PROVIDERS`' shape isn't exposed by the API today (only
`readConnections`' per-saved-provider metadata is), so hardcode the same
three providers' extra-field descriptors client-side, mirroring
`connections.js`'s `CONNECTION_PROVIDERS` shape:

```js
const CONNECTION_PROVIDER_META = {
  claude: { label: "Claude (Anthropic)" },
  codex: { label: "Codex (OpenAI)" },
  openrouter: { label: "OpenRouter", extraField: { label: "Model", placeholder: "z-ai/glm-5.2" } },
};
```

Replace the existing `CONNECTION_PROVIDER_LABELS` usage in `renderConnections`/
`renderConnectionRow` accordingly — `Object.entries(CONNECTION_PROVIDER_META)`
in place of `Object.entries(CONNECTION_PROVIDER_LABELS)`, and `label` now
read from `meta.label`.

In `renderConnectionRow(provider, meta, entry)`, add the extra input when
`meta.extraField` is set:

```js
    <div class="connection-row-actions">
      <input type="password" class="connection-key-input" placeholder="Paste API key" />
      ${meta.extraField ? `<input type="text" class="connection-extra-input" placeholder="${escapeHtml(meta.extraField.placeholder)}" value="${escapeHtml(entry?.extra ?? "")}" />` : ""}
      <button type="button" class="mw-btn connection-save">Save</button>
      ${entry ? `<button type="button" class="mw-btn connection-remove">Remove</button>` : ""}
    </div>
```

And in the save handler, include the extra value in the POST body:

```js
    const extraInput = row.querySelector(".connection-extra-input");
    const res = await api(`/api/connections/${provider}`, {
      method: "POST",
      body: JSON.stringify({ apiKey, extra: extraInput?.value.trim() || undefined }),
    }).then((r) => r.json());
```

`server.js`'s `POST /api/connections/:provider` handler needs the matching
one-line change to read and pass `body.extra` through to `saveConnection`:

```js
        await saveConnection(appDir, provider, apiKey, body.extra ? String(body.extra) : undefined);
```

- [ ] **Step 2: Syntax-check**

Run: `node --check public/connections.js && node --check server.js`
Expected: no output.

- [ ] **Step 3: Run the full suite one more time**

Run: `npm test`
Expected: PASS, full count.

- [ ] **Step 4: Manual verification (documented limitation: no live OpenRouter key available)**

Run: `npm start`, open the app, open Connections, confirm the OpenRouter
row shows both the API-key and Model inputs, save a throwaway/fake value in
each, confirm the status line and both fields round-trip correctly through
a reload. Launch a solo `openrouter` tile: **without** a real key, confirm
it fails exactly as designed — the tile shows the one-line
`[error] OPENROUTER_API_KEY and OPENROUTER_MODEL must be set` (or, if a
fake key was saved, that the fetch call to OpenRouter fails and prints
`[error] OpenRouter request failed: ...` rather than hanging or crashing
the process) — this confirms the error-handling path works even without a
real key. **Full happy-path verification (a real conversation turn actually
completing) requires a real `OPENROUTER_API_KEY` and has not been done** —
note this explicitly when reporting this task as complete, don't imply it's
been fully verified when it hasn't.

- [ ] **Step 5: Commit**

```bash
git add public/connections.js server.js
git commit -m "Add OpenRouter model field to the Connections UI"
```
