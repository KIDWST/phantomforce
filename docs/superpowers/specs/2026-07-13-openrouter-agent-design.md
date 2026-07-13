# OpenRouter Agent — Design

Status: approved, implementing.

## Goal

Give Mission Mode (and the solo wall) a fourth worker/tile type — an
interactive coding agent running against OpenRouter's API (e.g. GLM 5.2) —
without OpenRouter having any first-party CLI of its own. Reuses Termina's
entire existing PTY/tile/detection/ledger/DVR infrastructure by being just
another spawned process, not a special case anywhere else in the app.

Explicitly out of scope for this pass: streaming token-by-token output
(non-streaming request/response, matching how `claude -p` is already used
elsewhere in this codebase), a model picker UI beyond a single configured
slug, and multi-turn conversation persistence across a tile restart (a
restarted tile starts a fresh OpenRouter conversation, same as today's
"retry" behavior for other providers).

## Known limitation, stated plainly

This cannot be live-verified against the real OpenRouter API during
implementation — there is no `OPENROUTER_API_KEY` available in this
environment. Every piece that doesn't require a live network call (tool
execution, bracketed-paste parsing, permission-mode gating, usage-log
parsing, detection rules) is unit-tested directly. The actual HTTP
round-trip to OpenRouter is implemented against OpenRouter's documented
OpenAI-compatible `/api/v1/chat/completions` shape and isolated behind one
function so it's easy to exercise once a real key is available, but it is
**not** confirmed working end-to-end the way today's Claude-backed features
were. State this in the plan's manual-verification step rather than
claiming false confidence.

## Architecture

### `openrouter-agent/agent.mjs` (new, standalone script)

Spawned by Termina as `pwsh -NoLogo -NoExit -Command "node <abs path to
agent.mjs> --mode <plan|approval|auto> [--usage-log <path>]"`, mirroring
exactly how `claude`/`codex` profiles are already invoked
(`mission/adapters.js`). Reads `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`
from its environment (populated via `connections.js`, see below) — exits
immediately with a clear one-line error to its own PTY output if either is
missing, so the failure is visible in the tile itself rather than a silent
hang.

Structure, each piece independently testable by extracting it as a pure
function/module rather than inlining everything in the raw-mode input loop:

- `openrouter-agent/paste.mjs` — a small state machine: `feed(byte) ->
  {type: "buffering"} | {type: "submitted", text}`. Watches for the exact
  `\x1b[200~`/`\x1b[201~` bracketed-paste markers Termina's
  `mission/paste.js` already sends; buffers everything between them as one
  block; a bare `\r`/`\n` outside an active paste block finalizes
  submission. This is the same problem `mission/paste.js`'s own comments
  describe solving for real CLIs — here Termina controls both sides, so the
  state machine can be exact rather than best-effort.
- `openrouter-agent/tools.mjs` — the four tool implementations as plain
  async functions taking `(args, {cwd, mode})`:
  - `readFile({path})` — reads and returns file contents (bounded to
    ~100KB, matching a sane tool-output size).
  - `writeFile({path, content})` — in `plan` mode returns
    `{error: "blocked: plan mode is read-only"}` without writing; in
    `approval` mode, the caller (agent loop) is responsible for the y/n
    gate *before* calling this (keeps the tool function itself simple and
    testable without needing to fake stdin); in `auto` mode writes
    directly.
  - `listDirectory({path})` — non-recursive listing, matches what a coding
    agent needs to orient itself.
  - `runCommand({command})` — same plan/approval/auto gating as
    `writeFile`, executes via `child_process.execFile`("pwsh.exe", ["-NoLogo","-NoProfile","-Command", command])`
    bounded by a timeout (60s) and output size cap (matching
    `claude-print.js`'s existing `maxBuffer` convention), returns
    `{stdout, stderr, exitCode}`.
- `openrouter-agent/usage-log.mjs` — `appendUsage(logPath, {ts, promptTokens, completionTokens, model, costUsd})`
  — best-effort JSONL append, same never-block philosophy as every other
  logger in this codebase; a no-op if `logPath` is undefined (solo-tile
  usage, outside Mission Mode, isn't tracked — matches how Mission DVR
  recording is already mission-only).
- `openrouter-agent/openrouter-client.mjs` — `chatCompletion({apiKey, model, messages, tools}) -> Promise<responseJson>`,
  a single `fetch` call to `https://openrouter.ai/api/v1/chat/completions`
  with standard OpenAI-compatible body shape (`messages`, `tools`,
  `tool_choice: "auto"`). Isolated in its own module specifically so the
  one genuinely un-verifiable piece (the live network call) has the
  smallest possible surface area — every other module can be fully tested
  without it.
- `openrouter-agent/agent.mjs` — the entrypoint wiring the above together:
  print a welcome + idle-prompt marker (`"openrouter▸ "`, printed literally
  so the detect pack can match it exactly), read stdin in raw mode through
  the paste state machine, on each submitted block run the tool-calling
  loop (call `chatCompletion`, execute any `tool_calls` via `tools.mjs`
  gated by `--mode`, feed `tool` role results back, repeat until a
  response has no `tool_calls`), print the assistant's final text, print
  the idle-prompt marker again, and log usage via `usage-log.mjs` after
  every `chatCompletion` call. In `approval` mode, before executing a
  write/run tool call, prints `"APPROVE <toolName>? (y/n) "` (exact string,
  matched by the detect pack as `needs_approval`) and waits for a single
  `y`/`n` keypress before calling the tool.

### `detect/packs/openrouter.js`

Rules matching the agent's own literal output, high-confidence since both
sides are controlled by this codebase:

- idle prompt (`"openrouter▸ "` at the end of the buffer) → `waiting`,
  confidence 0.95.
- `"APPROVE "` + `"? (y/n) "` → `needs_approval`, confidence 0.95.
- a line starting with `"→ "` (the tool-call announcement the agent prints,
  e.g. `"→ read_file(app.js)"`) → `running`, confidence 0.9.
- `"[error]"` prefix → `failed`, confidence 0.8.
- falls through to the existing generic pack otherwise, same as every
  other provider pack.

### `mission/tokens.js` — `openrouter` adapter

```js
findTranscript: async (cwd, _claudeProjectsDir, usageLogPath) => usageLogPath ?? null,
readUsage: async (logPath) => { /* sum promptTokens/completionTokens, last-seen costUsd, across the JSONL */ },
```

The existing `TOKEN_ADAPTERS[provider].findTranscript(cwd, claudeProjectsDir)`
call site in `server.js`'s `pollTokenUsage` needs a third argument for
providers (like this one) where the log path is *given*, not discovered by
scanning a directory — passed through from the worker's stored
`usageLogPath` (see below), `undefined` for Claude (which ignores the extra
argument, matching this codebase's established "extra unused parameter is
harmless" pattern already used for `AGENT_PROVIDERS[...].buildArgs`).

### `mission/adapters.js`

```js
// psQuote: single-quote escaping for a pwsh -Command string — same helper
// shape already established in mission/claude-print.js, duplicated locally
// (adapters.js has no existing dependency on claude-print.js and shouldn't
// gain one just for this).
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

openrouter: {
  label: "OpenRouter",
  buildArgs: (mode, opts = {}) => {
    let command = `node ${psQuote(agentScriptPath)} --mode ${mode}`;
    if (opts.usageLogPath) command += ` --usage-log ${psQuote(opts.usageLogPath)}`;
    return ["-NoLogo", "-NoExit", "-Command", command];
  },
},
```

`buildArgs`'s signature gains an optional second `opts` parameter across
*all* providers (Claude/Codex's existing `buildArgs(mode)` implementations
are unaffected — they simply don't declare or use the second parameter,
matching every other "harmless extra argument" pattern already established
in this codebase). Call sites in `server.js` (`createMissionWorkers`, the
worker `retry` handler, and the Mission DVR `branch` handler) compute a
`usageLogPath` under `.termina/missions/<id>/openrouter-usage/<workerId>.jsonl`
and pass it through — three call sites, all of which already have
`missionId`/`workerId` in scope.

### `connections.js` — `openrouter` provider + a plain-text extra field

`CONNECTION_PROVIDERS` gains:

```js
openrouter: { label: "OpenRouter", envVar: "OPENROUTER_API_KEY", extraField: { name: "model", envVar: "OPENROUTER_MODEL", label: "Model", placeholder: "z-ai/glm-5.2" } },
```

`saveConnection(appDir, provider, apiKey, extra)` gains an optional fourth
parameter; when the provider declares an `extraField`, `extra` (a plain,
non-secret string) is stored **unencrypted** alongside the encrypted key
entry (it's a model slug, not a secret) and `getApiKeyEnv` includes it
under `extraField.envVar` in its returned env object when present. Claude
and Codex don't declare an `extraField`, so this is fully backward
compatible — their `saveConnection` calls simply never pass a fourth
argument.

### `profiles.js` — solo-tile profile

A new `BUILT_IN` entry (Windows branch), matching the shape of the
existing `claude`/`codex` entries:

```js
{
  id: "openrouter",
  label: "OpenRouter CLI",
  command: PWSH,
  args: ["-NoLogo", "-NoExit", "-Command", `node ${JSON.stringify(agentScriptPathForSoloTile)} --mode approval`],
  cwd: HOME,
  detector: "openrouter",
  note: "Launches the OpenRouter agent (GLM 5.2 or whatever model is configured) in a shell.",
},
```

No `--usage-log` for the solo-tile profile — matches how Mission DVR
recording/token-tracking is already mission-only, not solo-tile.

## Error handling

- Missing `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`: the agent script prints
  one clear line to its own PTY output and exits non-zero — visible
  directly in the tile, exactly how a misconfigured `claude`/`codex`
  profile would already surface a problem, no special-casing needed
  elsewhere in Termina.
- A failed `chatCompletion` call (network error, non-200 response): caught,
  printed as `"[error] <message>"` (matched by the detect pack as
  `failed`), loop continues waiting for the next input rather than crashing
  the whole process — one bad turn shouldn't kill the tile.
- Tool execution errors (e.g. `readFile` on a missing path): returned as a
  `{error: "..."}` tool result fed back to the model, exactly like a real
  coding agent's own tool-error handling — the model sees the failure and
  can adapt, same pattern Claude Code/Codex already use.
- `usage-log.mjs` append failures: best-effort, swallowed, never block a
  turn — same philosophy as every other logger in this codebase.

## Testing

- `tests/openrouter-agent/paste.test.mjs` — the bracketed-paste state
  machine: a plain single-line submission, a multi-line pasted block with
  embedded newlines that must NOT submit early, a bare Enter after the
  paste-end marker actually submitting.
- `tests/openrouter-agent/tools.test.mjs` — each tool against a real
  temp directory (`mkdtemp`, matching every other test file's convention
  in this codebase): `readFile` round-trip and missing-file error;
  `writeFile` blocked in `plan` mode, succeeds in `auto` mode; `listDirectory`
  against a populated temp dir; `runCommand` executing a trivial real
  command and capturing stdout/exitCode.
- `tests/openrouter-agent/usage-log.test.mjs` — append/read round-trip,
  no-op when `logPath` is undefined, corrupted-line tolerance (matches
  every other JSONL reader in this codebase).
- `tests/detect/openrouter.test.mjs` — the new detect pack's rules against
  hand-written fixture strings matching the agent's exact literal output,
  following the exact fixture-driven pattern `tests/detect/claude.test.mjs`
  already uses.
- `tests/mission/adapters.test.mjs` (extended) — `buildArgs("auto", {usageLogPath: "..."})`
  includes the log path in the resulting command string;
  `buildArgs("plan")` with no `opts` still works (backward compatible).
- `tests/connections.test.mjs` (extended) — `saveConnection` with an
  `extraField`-declaring provider stores and returns the extra value;
  `getApiKeyEnv` includes it under the right env var name.
- **Not tested**: `openrouter-client.mjs`'s actual `fetch` call — no live
  key available, stated as a known gap in the plan's manual-verification
  step rather than skipped silently.
