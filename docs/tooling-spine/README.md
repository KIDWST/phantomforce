# PhantomForce Tooling Spine Sprint 0

Status: Sprint 0 plan only

This directory documents the safe tooling spine for PhantomForce. It does not install tools, enable workflows, start workers, call providers, execute approvals, write production ledger records, write queue records, expose public webhooks, or store credentials.

## Product Authority

Phantom AI remains the user-facing brain.

Hermes remains the memory, context, approval, budget, redaction, and audit layer.

n8n is only a proposed future automation worker. It must not become a second brain, autonomous dispatcher, public webhook surface, or approval bypass.

AgentLab remains a sandbox for evaluating Agent OS, OpenSpec, Serena, and Ruflo. AgentLab tools do not become active PhantomForce runtime dependencies during Sprint 0.

## Sprint 0 Scope

Sprint 0 adds documentation and a machine-readable registry only:

- `N8N_WORKER_PLAN.md`
- `AGENTLAB_TOOLS.md`
- `PHANTOM_AI_TOOL_LANE.md`
- `tool-registry.json`

No code scaffold, runtime scaffold, workflow export, credential template, or provider transport was added in this sprint.

## Done-Before Preflight Classification

| Check | Classification | Notes |
|---|---|---|
| Current branch, HEAD, clean/dirty status | unsafe to proceed in active worktree | Active source-of-truth worktree `C:\Users\jorda\Documents\Codex\worktrees\phantomforce-client-sim-truth-20260629` was on `client-sim/trainer-visible-truth-20260629` at `715712cf1e12643e20369ace8d7dd2946fc30972`, but it had unrelated live-provider/OpenRouter dirty work. Sprint 0 used an isolated worktree. |
| Recent commits | already complete | Latest base commit was `715712c Polish Phantom AI protected status copy`; `fa1b4a6 Add Hermes interaction memory recall (phase 1f)` was present before it. |
| Current dirty/untracked files | unsafe to proceed in active worktree | Dirty files included `.env.example`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `server/src/index.ts`, `server/src/phantom-ai/model-router.ts`, `server/src/phantom-ai/types.ts`, plus untracked OpenRouter live transport files. |
| Existing Phantom AI tool/provider/fetch/approval code | partially complete | Phantom AI has model routing, provider policy, provider readiness, budget hard gate, provider invocation firewall, OpenRouter dry-run adapter, live-smoke preflight, and approval queue preview/transition code. Clean base does not include a general online fetch lane. |
| Existing Hermes memory/context/approval queue code | partially complete | Hermes has memory context, memory recall, interaction memory, local interaction memory store, ledger helpers, live receipt contracts, approval queue previews, and approval transitions. These are not the same as an n8n worker or general tool lane. |
| AgentLab folder contents | partially complete | AgentLab has setup notes, safety gates, tool matrix, status/preflight scripts, and quarantine evidence for Agent OS, OpenSpec, Serena, and Ruflo. It remains sandbox/reference only. |
| Existing docs/scripts mentioning n8n/tooling spine | absent | Clean base had no tracked `docs/tooling-spine`, n8n plan, AgentLab incorporation plan, or tool registry. |
| Existing docs/scripts mentioning MCP, online fetch, web fetch, tool execution, OpenSpec, Serena, Ruflo | absent in clean PhantomForce repo | These terms were not present in the clean base search. AgentLab mentions MCP and candidate tools in sandbox docs. |
| Existing workflow/approval docs | partially complete | Core product docs and UI copy mention approval-gated workflows, but they are not a dedicated tooling spine plan. |

## What Already Exists

- Phantom AI protected brain framing.
- Hermes context, memory, recall, ledger, local approval preview, and safety metadata.
- Provider policy, readiness, budget hard gate, invocation firewall, and OpenRouter dry-run adapter contracts.
- `/phantom-ai/approvals/execute` remains intentionally absent; live-smoke preflight expects 404 for approval execution.
- AgentLab sandbox docs for Agent OS, OpenSpec, Serena, and Ruflo.
- AgentLab quarantine for accidental runtime/demo artifacts.

## What Is Duplicated

Some safety language already exists in README, CLAUDE notes, Phantom AI code, UI copy, and AgentLab safety docs. This directory consolidates that direction for the tooling spine without replacing those source files.

## What Is Missing

- n8n local worker install plan with explicit approval boundaries.
- Shared tool registry.
- Dedicated Phantom AI online fetch lane plan.
- Dedicated mapping from AgentLab tools into PhantomForce governance.
- Implementation specs for allowlisted fetch, cache/ledger design, budget accounting, and approval request handoff.

## What Is Unsafe Now

- Editing the dirty active worktree directly.
- Running or enabling live OpenRouter/provider transport from uncommitted Phase 1g work.
- Starting n8n, public webhooks, MCP servers, Serena health checks, Ruflo daemons, Agent OS sync, or OpenSpec init against PhantomForce.
- Adding credentials or credential templates that imply real secrets should be filled in.
- Executing sends, uploads, posts, live provider calls, queue actions, production ledger writes, or approval execution.

## Sprint 1 (implemented): dry-run Tool Lane preview

The smallest safe step is implemented and proof-tested. No n8n install/runtime,
no webhooks, no credentials, no execution.

- `server/src/phantom-ai/tool-lane.ts`: read-only `loadToolRegistry()` (reads and
  validates `docs/tooling-spine/tool-registry.json`) and `buildToolLanePreview()`
  which returns a dry-run "would-run" descriptor.
- `POST /phantom-ai/tool-lane/preview` (admin-only): returns the selected tool's
  `allowed_mode` + `blocked_actions` with `execution_disabled: true` and
  `would_run: false`. Unknown tool id returns a safe `unknown_tool` blocked
  response; a missing registry fails closed (`registry_unavailable`). Nothing is
  executed; no provider/network/credential/webhook/queue/ledger/approval action
  occurs.
- Proof: `server/scripts/test-tool-lane-preview.ts` plus a runtime auth proof
  (401 unauth / 403 non-admin / 200 admin) with `/phantom-ai/approvals/execute`
  remaining 404.

## Move To Later Phases

- Actual n8n local install and inactive workflow import.
- OpenSpec proposal/spec/task scaffolding inside PhantomForce.
- Agent OS standards and `AGENTS.md` or `CLAUDE.md` alignment.
- Serena read-only semantic navigation setup.
- Any Ruflo runtime evaluation.
- Phantom AI online fetch implementation.
- Hermes-backed cache, citation, budget, and audit record implementation.
- Any external write action integration.

## Approval Boundary

No workflow may send emails, post content, call clients, mutate CRM records, upload files, hit live providers, write production ledgers, execute approvals, or create external side effects without explicit approval through the relevant PhantomForce/Hermes approval path.
