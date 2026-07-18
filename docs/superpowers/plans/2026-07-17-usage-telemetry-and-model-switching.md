# Termina Usage Telemetry + Model Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Termina tile (solo or mission) shows model, provider, input/output/cache tokens, context use %, API cost; the app shows session/daily totals and enforces configurable spending limits — all from real CLI/API events. Users can switch model globally across all tabs or per-tab.

**Architecture:** Reuse the existing mission token pipeline (`mission/tokens.js` adapters reading real Claude JSONL transcripts + OpenRouter usage logs) by ungating it from missions, forwarding the cache-token data it already computes, and adding a shared model-catalog module that backs cost math, context-window math, and the model-switcher UI. Model switching = inject `--model` into launch args at spawn time and relaunch via the existing restart primitives.

**Tech Stack:** Node (no framework), Electron shell, xterm.js frontend in `public/`, tests via `node --test` in `tests/`.

## Global Constraints

- Repo: `C:\Users\jorda\Termina`. Tests: `npm test` (node --test). Do not break existing tests.
- No fake analytics: unknown model → cost null (never guessed); estimated values must keep the `estimated` flag and `~` prefix convention.
- Server binds 127.0.0.1 only; do not change auth/token model.
- Commit after each task with a conventional message.

---

### Task 1: Shared model catalog module

**Files:**
- Create: `mission/model-catalog.js`
- Test: `tests/mission/model-catalog.test.mjs`
- Modify: `mission/tokens.js` (replace `RATES_PER_MILLION_USD` at tokens.js:98-102 with catalog lookup)

**Interfaces:**
- Produces: `MODEL_CATALOG` (array of `{id, label, provider, contextWindow, inputPerM, outputPerM, cachePerM}`), `getModel(id)` → entry or null, `costForUsage(model, {inputTokens, outputTokens, cacheTokens})` → number|null, `contextPercent(model, lastTurnInputTokens)` → number|null.
- Catalog entries (from current tokens.js rates plus context windows): `claude-fable-5` (provider anthropic, 200000 ctx, in 5, out 25, cacheRead 0.50), `claude-opus-4-8` (anthropic, 200000, in 5, out 25, cacheRead 0.50), `claude-sonnet-5` (anthropic, 200000, in 3, out 15, cacheRead 0.30), `claude-haiku-4-5-20251001` (anthropic, 200000, in 1, out 5, cacheRead 0.10), plus a `codex` provider entry `gpt-5-codex` (openai, 400000, rates null → cost null), and `openrouter:*` passthrough (cost comes from OpenRouter's own reported cost, catalog only supplies label/context when known). Keep existing rates from `RATES_PER_MILLION_USD` verbatim where they exist; do NOT invent rates for models not already priced — return null cost.
- `mission/tokens.js` `costForUsage` becomes a re-export/thin wrapper of the catalog version so existing imports keep working (check `pollTokenUsage` in server.js:134 and tests).

- [x] Step 1: Write failing tests in `tests/mission/model-catalog.test.mjs`: getModel known/unknown; costForUsage matches existing tokens.test.mjs expectations for sonnet/opus/haiku; costForUsage returns null for unknown model; contextPercent(claude-sonnet-5, 100000) === 50; contextPercent unknown model → null.
- [x] Step 2: `node --test tests/mission/model-catalog.test.mjs` → FAIL (module missing).
- [x] Step 3: Implement `mission/model-catalog.js`; rewire `mission/tokens.js` to use it.
- [x] Step 4: `npm test` → all pass (existing tokens tests unchanged and green).
- [x] Step 5: Commit `feat(telemetry): add shared model catalog with rates and context windows`.

### Task 2: Solo-tile telemetry (ungate polling) + cache tokens + last-turn input

**Files:**
- Modify: `mission/tokens.js` (`readClaudeUsage` tokens.js:56-85 — add `cacheTokens` (already summed at line 80) and new `lastTurnInputTokens` = input+cache of the最新 assistant message to the returned object; `findClaudeTranscript` tokens.js:28 unchanged)
- Modify: `server.js` (`pollTokenUsage` server.js:110-141: poll ALL sessions with a resolvable cwd, not just `session.missionId` (gate at server.js:76-77); forward `cacheTokens`, `lastTurnInputTokens`, `contextPercent` in the `tokens` WS message at server.js:136; for solo tiles resolve cwd from the profile/spawn cwd recorded on the session at `startSession` server.js:222)
- Test: `tests/mission/tokens.test.mjs` (extend), `tests/server-usage.test.mjs` (new, unit-test the poll gating decision function — extract `shouldPollSession(session)` so it's testable without a PTY)

**Interfaces:**
- Consumes: Task 1 `contextPercent`.
- Produces: WS `tokens` message shape `{type:"tokens", sessionId, workerId?, provider, model, inputTokens, outputTokens, cacheTokens, lastTurnInputTokens, contextPercent, costUsd, estimated}`. Session object gains `.cwd` (recorded at spawn) and `.usage` (latest snapshot, for the summary endpoint in Task 3).
- IMPORTANT honesty constraint: for a solo tile whose cwd maps to a Claude project dir shared with other sessions (e.g. plain `C:\Users\jorda`), transcript attribution is ambiguous — in that case pick the transcript whose mtime advanced in step with this session's PTY activity if determinable; otherwise set `estimated:true` and `attribution:"ambiguous"` in the payload. Never present ambiguous data as real (this exact failure is documented in the QA ledger as TQA-03).

- [x] Step 1: Write failing tests: `readClaudeUsage` returns cacheTokens + lastTurnInputTokens from a fixture JSONL with 2 assistant turns; `shouldPollSession` true for mission worker AND solo claude/openrouter tile with cwd, false for pwsh/cmd/wsl profiles with no adapter; ambiguous-attribution → estimated true.
- [x] Step 2: Run → FAIL.
- [x] Step 3: Implement.
- [x] Step 4: `npm test` → pass.
- [x] Step 5: Commit `feat(telemetry): live token/cost telemetry for solo tiles with honest attribution`.

### Task 3: Session + daily totals, summary endpoint, spending limits

**Files:**
- Create: `usage-limits.js` (root, next to profiles.js/connections.js)
- Modify: `server.js` (new REST: `GET /api/usage/summary`; limit check inside `pollTokenUsage` after cost compute ~server.js:134)
- Modify: `termina.config.example.json` (document `usage: {sessionLimitUsd, dailyLimitUsd}`)
- Test: `tests/usage-limits.test.mjs`

**Interfaces:**
- Produces: `summarizeUsage(sessions, historyByDay)` → `{perSession:[{sessionId,name,provider,model,inputTokens,outputTokens,cacheTokens,costUsd,estimated}], sessionTotalUsd, todayTotalUsd, date, limits:{sessionLimitUsd,dailyLimitUsd}, limitState:"ok"|"warn"|"over"}`; `checkLimits(totals, limits)` → `{state, breached:[...]}` (warn at 80%).
- Daily bucketing: reuse `tokens-history.jsonl` pattern (`mission/store.js:168`) — add an app-level append `usage-history.jsonl` under the `.termina` data dir with `{ts, sessionId, costUsd}` per poll delta; day = local date string.
- Limit behavior: emit WS `{type:"limit", state, message}` to all clients when crossing warn/over. Do NOT auto-kill sessions; over-limit shows a red banner + blocks NEW session starts (`/api/sessions/:id/start` returns 409 with `{error:"daily spending limit reached"}`) until the user raises the limit in config. No silent kills.

- [x] Step 1: Failing tests for summarizeUsage aggregation, checkLimits thresholds (ok/warn at 80%/over), day bucketing, and start-block decision function.
- [x] Step 2: Run → FAIL. Step 3: Implement. Step 4: `npm test` → pass.
- [x] Step 5: Commit `feat(telemetry): session/daily spend totals, summary API, spending limits`.

### Task 4: Frontend tile telemetry readout + totals bar

**Files:**
- Modify: `public/app.js` (tile meta block app.js:349-353, `renderModel()` app.js:531 → extend to `renderUsage()`; `tokens` WS handler app.js:661-666; add `limit` WS handler; top-bar totals element)
- Modify: `public/index.html` + stylesheet (totals bar + tile usage row styles)
- Test: extend `tests/` with a DOM-free unit test for the formatter: create `public/usage-format.js` (pure functions, importable by node --test) — `formatTokens(n)` (1234→"1.2k"), `formatUsd(x)` ("$0.0312"→"$0.03", <$0.01 → "<$0.01"), `usageLine({...})` → e.g. `"claude · Sonnet 5 · in 12.4k out 3.1k cache 41.0k · 37% ctx · $0.42"` with `~` prefix when estimated.

**Interfaces:**
- Consumes: WS `tokens` payload (Task 2 shape), `GET /api/usage/summary` (Task 3), `limit` WS message.
- Tile shows: provider icon (existing `providerIcon()` app.js:61) + model label + in/out/cache + ctx% + cost. Totals bar shows session total, today total, limit state (green/amber/red); clicking opens a details popover listing per-tile spend.

- [x] Step 1: Failing tests for the three formatters. Step 2: FAIL. Step 3: Implement formatters + wire into app.js/index.html. Step 4: `npm test` pass; manual smoke: `npm start`, open a claude tile, observe live usage line. Step 5: Commit `feat(ui): per-tile usage readout and session/daily totals bar`.

### Task 5: Per-tab model override + one-click global model switch

**Files:**
- Modify: `profiles.js` (dynamic arg builder: `buildProfileArgs(profile, {model})` — claude profile appends `claude --model <id>` into the `-Command` string built at profiles.js:46; openrouter sets `OPENROUTER_MODEL` env for the spawn; codex appends `--model` if supported, else ignore)
- Modify: `mission/adapters.js` (`buildArgs(mode, opts)` adapters.js:31-55 gains `opts.model` → `--model`; precedent: `claude-print.js:41-42`)
- Modify: `server.js` (`/api/sessions/:id/start` server.js:573 accepts `{model}`; `startSession` server.js:222 records `session.model` and passes through; worker `retry` server.js:762 keeps the worker's model)
- Modify: `public/app.js` (card model app.js:148 gains `model`; per-tile model dropdown next to the profile select, populated from `MODEL_CATALOG` via new `GET /api/models`; changing it calls `restartCard()` app.js:710 with the new model; global switcher in the top bar sets `defaultModel` and restarts every running tile via the existing broadcast loop pattern app.js:678/812 — one click, all tabs)
- Test: `tests/profiles-model.test.mjs` (arg injection for each profile type), extend `tests/mission/adapters.test.mjs` (model passthrough)

**Interfaces:**
- Consumes: Task 1 `MODEL_CATALOG` (served at new `GET /api/models`).
- Produces: session start body `{profile, cols, rows, model?}`; per-tab override wins over global default; tiles with no override follow the next global switch.
- Switching = relaunch (no in-band swap exists). Confirm dialog only when the tile has an active PTY with recent output (<60s) — otherwise switch immediately; global switch always shows one confirm listing affected tiles.

- [x] Step 1: Failing tests: claude profile args contain `--model claude-opus-4-8` when requested and are unchanged when not; openrouter spawn env gets `OPENROUTER_MODEL`; adapters pass model on retry.
- [x] Step 2: FAIL. Step 3: Implement backend, then frontend. Step 4: `npm test` pass; smoke: switch model per-tab and globally, verify relaunch + new model appears in usage line after first turn. Step 5: Commit `feat(models): per-tab model override and one-click global model switching`.

### Task 6: Verification sweep

- [x] `npm test` full suite green.
- [x] `node scripts/smoke.mjs` (if runnable) green.
- [x] Manual: `npm start`; open claude + pwsh + openrouter tiles; verify pwsh tile shows no usage line (no adapter, no fake data); claude tile shows real tokens after a prompt; totals bar updates; set `dailyLimitUsd: 0.01` in config → red banner + new-session 409; global switch relaunches tiles.
- [x] Commit any fixes; final commit `chore: telemetry + model switching verification pass`.
