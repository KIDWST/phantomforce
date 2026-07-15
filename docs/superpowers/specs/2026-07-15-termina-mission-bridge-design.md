# Termina Mission Bridge — Vertical Slice Design

Status: Approved for planning
Date: 2026-07-15
Scope: First implementation milestone only (see "PhantomForce ↔ Termina — full mission spec" for the full 12-section long-term architecture this slice is carved out of). Not a general multi-user/multi-node bridge — see "Explicit non-goals" below.

## 1. Problem

PhantomBot (PhantomForce's chat assistant, `server/src/phantom-ai/`) can plan and advise but cannot execute real, multi-step work on the user's machine. Termina (`C:\Users\jorda\Termina`) already has a working local mission-orchestration engine — LLM-driven objective decomposition, per-worker git-worktree isolation, PTY-based CLI worker sessions (Claude/Codex/PowerShell profiles), a structured `TERMINA_EVENT:` ledger, and mission synthesis/report generation — but it is a disconnected tool the user has to drive by hand. `app/js/missioncontrol.js` already has a Mission/Worker/Task UI and explicitly says in its own header comment that Termina can be "wired underneath later." This design wires it.

## 2. Deployment reality this design assumes

PhantomForce's server (`server/src/`, Fastify) and Termina (`server.js`) both already run on the same physical machine (`admin.phantomforce.online` / `app.phantomforce.online` are Pangolin tunnels into this local stack, not a hosted multi-tenant deployment). Given that, this slice treats the "Local Phantom Bridge" from the full spec as **a module inside the existing PhantomForce server**, not a separate companion process — it calls Termina's existing local HTTP API directly over `127.0.0.1`. The general multi-user/multi-machine bridge (node registration, per-user auth handshake, reconnect protocol) is deferred to a later phase and is **not** built here.

## 3. Architecture

```
PhantomForce Dashboard (missioncontrol.js)
        │  HTTP: start mission (via /phantom-ai/chat mission intent)
        │  WS:   GET /phantom-ai/missions/ws  (live worker/ledger updates)
        ▼
PhantomForce Server (server/src/phantom-ai/termina-bridge.ts)  — NEW
        │  HTTP, header x-termina-token: $TERMINA_TOKEN
        ▼
Termina server.js  (already running locally; TERMINA_TOKEN pinned via env,
                     not the default random-per-launch token)
        │  node-pty
        ▼
CLI worker sessions (claude / codex / pwsh Termina profiles)
        ▼
Scratch test repo (sole entry in the approved-workspace allow-list)
```

Termina already provides: `POST /api/missions/decompose` (objective → worker roles via LLM), `POST /api/missions` (spawns workers, worktree-isolated), `GET /api/missions/:id` (mission + ledger + token usage), `POST /api/missions/:id/workers/:id/stop|retry`, `POST /api/missions/:id/synthesize`, `GET /api/missions/:id/report`. PhantomForce does not reimplement any of this — it is a client of it.

## 4. Server-side: `server/src/phantom-ai/termina-bridge.ts` (new)

- Typed client wrapping the Termina endpoints listed above. Reads `TERMINA_BASE_URL` (default `http://127.0.0.1:7420`) and `TERMINA_TOKEN` from env. Every request sends `x-termina-token: $TERMINA_TOKEN`.
- A health check (e.g. `GET /api/profiles`) used to detect "Termina is running." If unreachable, PhantomBot tells the user to start Termina rather than silently failing or queuing work. This check is the entire "Phantom Node" concept for this slice — no separate registration/handshake protocol.
- **Mission intent** is a new branch in the existing `model-router.ts` intent classification (alongside its current advice-vs-execution / destructive-task detection), not a new free-form endpoint. It fires when the user's `/phantom-ai/chat` message reads as an objective for real execution against an approved project, as opposed to a question or a request for a plan only.
- **Approval gate (two tiers only for this slice):**
  - *Observe*: calling `decomposeObjective()` to plan and describe the mission back to the user requires no approval.
  - *Work inside approved projects*: calling `createMission()` (starts workers that write files / run commands) requires one approval record through the existing `approval-queue.ts`, scoped to the specific objective + the one approved workspace path, expiring if unconfirmed within 15 minutes. There is no per-command approval inside a running mission — the single mission-start approval is the gate, consistent with the "hired a team, not a terminal" UX goal.
  - Operate-approved-apps, External actions, and Protected system actions tiers are **not implemented** in this slice (see non-goals).
- **Approved workspace allow-list**: a small new config listing directories PhantomBot may pass as `workspaceRoot`. For this slice, exactly one entry: the new scratch test repo (§7). Any objective targeting a path outside the allow-list gets an explicit "not an approved project yet" response.
- **WebSocket relay**: `GET /phantom-ai/missions/ws` (new, `@fastify/websocket`, mirroring Termina's own WS pattern). Termina doesn't push, so the bridge polls `GET /api/missions/:id` every 1.5 seconds per active mission (only while ≥1 dashboard client is subscribed) and pushes diffs to subscribed clients. Forwarded message shapes map directly onto missioncontrol.js's existing state fields:
  - `{type: "worker_update", missionId, workerId, status, progress, latestEvent}`
  - `{type: "ledger_event", missionId, workerId, source, type, detail, at}`
  - `{type: "mission_status", missionId, status}`
  - Termina's own mission JSON remains the source of truth; PhantomForce does not maintain a duplicate mission database for this slice.

## 5. Dashboard UI: `app/js/missioncontrol.js`

- Every existing localStorage-simulated code path is left intact as the fallback for missions not backed by a real Termina mission. A new `mission.backend: "termina" | "simulated"` field distinguishes them.
- When a mission is created via the new mission intent, missioncontrol.js opens the WS connection and subscribes by `missionId`. Incoming `worker_update`/`ledger_event` messages patch the existing `workers[]` / `tasks[]` / `commander[]` arrays in place — the render code (cards, progress bars, status pills, expand/collapse) is unchanged because the patched shape matches what it already expects.
- Ledger `detail` text is appended to each worker's existing chat/log list. Raw PTY terminal output is **not** proxied into the browser for this slice — structured ledger events are sufficient to show meaningful progress, and avoids double-hopping Termina's own PTY WebSocket through PhantomForce.
- The single mission-start approval renders through the existing Approval Center / `approvals[]` UI already in missioncontrol.js — no new approval UI component.
- On WS disconnect, the client retries with backoff and re-subscribes; mission state is recoverable from `GET /phantom-ai/missions/:id` (a thin new REST passthrough to Termina's own `GET /api/missions/:id`) on reconnect, so a dashboard refresh does not lose mission state (Termina keeps running regardless of dashboard connection).

## 6. Evidence and mission report

When every worker reaches a terminal ledger state (`COMPLETE`/`FAILED`), the bridge calls Termina's `/synthesize` then `/report` and forwards the result as a `mission_status: "verifying" → "completed"` transition, with the markdown report attached and displayed in missioncontrol.js's existing deliverables section.

Success criteria are evidence-based, not "a worker said done": the mission's own acceptance criteria for this slice's test run are `npm run build` exits 0 and `npm test` exits 0 inside the scratch repo, checked by a dedicated verification worker (reusing the existing "Inspector" role) as the final step before the mission is marked complete.

## 7. Scratch test project

A new minimal repo, `C:\Users\jorda\Documents\phantom-vertical-slice-test` — a small Vite or plain Node app, git-initialized, with one intentionally incomplete feature (e.g. a stubbed utility function with a currently-failing test) so the first real mission has a genuine, verifiable "finish this" objective with a pass/fail signal. This is the sole entry in the approved-workspace allow-list (§4). Production repos (`phantomforce-main-trunk-20260706`, the PhantomPlay v2 worktree, etc.) are explicitly **not** targeted by this slice's first live mission.

## 8. Worker roles

Reuse missioncontrol.js's existing taxonomy as-is: Strategist, Researcher, Builder, Operator, Inspector. No renaming to the full spec's illustrative role names (Lead Engineer, QA Specialist, etc.) — the existing five already cover discovery/implementation/verification, and renaming would touch more of the existing schema for no functional gain in this slice.

## 9. Explicit non-goals for this slice

Deferred to later phases of the full 12-section spec, not silently assumed done:

- Separate Local Phantom Bridge companion process / multi-machine Phantom Node registration and reconnect protocol.
- Operate-approved-apps, External actions, and Protected system actions permission tiers.
- Browser-automation workers.
- Cost/latency-based model routing beyond what Termina's existing `decomposeObjective` already performs.
- Persistent worker identity/context beyond a single mission's lifetime.
- PhantomBot answering unrelated questions concurrently with a running mission (redirection is limited to Termina's existing worker stop/retry controls).
- Raw PTY terminal streaming into the PhantomForce dashboard (structured ledger events only).

## 10. Testing plan for this slice itself

1. Unit-level: `termina-bridge.ts` client against a running local Termina instance (health check, decompose, create, get, synthesize, report).
2. Approval gate: verify `createMission()` is unreachable without a confirmed approval record, and that an objective targeting a path outside the allow-list is rejected with a clear message.
3. End-to-end: from the dashboard, ask PhantomBot to "inspect and finish the scratch project"; confirm mission intent fires, plan is described back, approval is requested and granted, ≥3 workers spawn in Termina against the scratch repo, live progress streams into missioncontrol.js, one worker makes the code change, the Inspector worker's build+test run is the final evidence, and the mission report appears in the dashboard's deliverables section with the actual diff/commands visible on request.
4. Reconnection: refresh the dashboard mid-mission, confirm the mission workspace reattaches via the WS resubscribe + REST passthrough without losing state, and Termina's workers were unaffected by the refresh.
