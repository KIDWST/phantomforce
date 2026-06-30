# AgentLab Tools Plan

Status: sandbox/reference only

AgentLab is located at:

`C:\Users\jorda\Documents\PhantomForce-AgentLab\workflow-stack`

Sprint 0 treats AgentLab as evidence and planning context only. It does not run AgentLab scripts, install tools, initialize MCP servers, start daemons, or write candidate tool config into PhantomForce.

## Current AgentLab Inventory

Observed safe planning files:

- `README.md`
- `SAFETY_GATES.md`
- `TOOL_MATRIX.md`
- `AGENT_OS_SETUP_NOTES.md`
- `OPENSPEC_SETUP_NOTES.md`
- `SERENA_SETUP_NOTES.md`
- `RUFLO_SANDBOX_RULES.md`
- `scripts\agentlab-preflight.ps1`
- `scripts\agentlab-status.ps1`
- `scripts\check-tools.ps1`
- `scripts\run-agent-os-sandbox.ps1`
- `scripts\run-openspec-sandbox.ps1`
- `scripts\run-serena-sandbox.ps1`
- `scripts\run-ruflo-planning-only.ps1`

Observed quarantine:

- `_quarantine\claude-readonly-mutation-2026-06-28`

The quarantine contains prior accidental demo/runtime artifacts and must not be activated without a separate approval.

## Tool Classifications

| Tool | Current mode | Intended PhantomForce role | Sprint 0 classification |
|---|---|---|---|
| OpenSpec | Reference-only in AgentLab | Controlled proposal/spec/task workflow before implementation | partially complete in sandbox, absent in PhantomForce |
| Agent OS | Reference-only in AgentLab | Standards and workflow layer aligned with project docs | partially complete in sandbox, absent in PhantomForce |
| Serena | Reference-only in AgentLab | Read-only semantic repo navigation for Claude/Codex | partially complete in sandbox, absent in PhantomForce |
| Ruflo | Planning-only candidate | Quarantined idea source for agent squad vocabulary | unsafe for production, sandbox-only |

## OpenSpec Incorporation

OpenSpec should be used later to make implementation proposals explicit before code changes.

Future allowed use:

- Draft feature proposals.
- Track specs and tasks.
- Require review before implementation.

Blocked until separately approved:

- `openspec init`
- `openspec update`
- `openspec validate` against PhantomForce
- Package installation
- Auto-generated changes to production repo files

## Agent OS Incorporation

Agent OS may later provide standards, workflow structure, and alignment across `AGENTS.md`, `CLAUDE.md`, and project docs.

Future allowed use:

- Read standards from the sandbox candidate.
- Draft proposed PhantomForce standards.
- Propose documentation alignment.

Blocked until separately approved:

- Project install/sync.
- Global profile sync.
- Claude/Codex command installation.
- Any write into active repos or global agent config.

## Serena Incorporation

Serena may later support read-only semantic code navigation for Claude/Codex.

Future allowed use:

- Read-only code map.
- Symbol search.
- Reference navigation.
- No shell execution.
- No write tools.

Blocked until separately approved:

- Health checks that write config.
- MCP server startup.
- Global Claude/Codex registration.
- Shell/write/edit tools.
- Background language server activity that is not reviewed.

## Ruflo Incorporation

Ruflo remains quarantine/sandbox only.

Allowed now:

- Planning vocabulary.
- Manual review of docs.
- No runtime.

Blocked:

- CLI execution.
- Claude Flow execution.
- MCP server.
- Daemon.
- Hooks.
- Swarms.
- Federation/cloud/IPFS features.
- Memory imports.
- Any production use.

## Current Sprint 0 Result

AgentLab is documented as a controlled sandbox. No AgentLab tool was installed into PhantomForce, run against PhantomForce, registered with MCP, or made active.
