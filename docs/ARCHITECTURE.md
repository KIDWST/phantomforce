# PhantomForce — Architecture

This is how the vision in `docs/PHANTOM_VISION.md` is actually built. It
defines the core objects, the primary spaces, the execution flow between
them, and how the existing tool/worker/automation/model layer sits beneath
that architecture instead of replacing it.

A recurring failure mode in this codebase is building a second system for a
concept that already exists under a different name. Before adding a new
object or space, check the "Existing implementation" line below — it names
the real file. If nothing is listed, it's genuinely new.

## Core Objects

| Object | Definition | Existing implementation |
|---|---|---|
| **Outcome** | A business goal with a target result, deadline, success metric, strategy, workstreams, assigned departments, approvals, evidence, risks, costs, results. | Not yet first-class. Closest analogs today: CRM pipeline (`crmpipeline.js`), managed growth (`managedgrowth.js`), proposals (`proposals/`), Planner (`planner.js`). These need a unifying Outcome record, not replacement. |
| **Signal** | A meaningful, evidence-backed change that may require a decision: what happened, why it matters, evidence, confidence, recommended action, can-Phantom-handle-it, approval-required. | Generalized in `server/src/phantom-ai/signals.ts` — normalizes `organization-pulse.ts` opportunities + graph disconnections into one cross-department `Signal[]`, exposed as `getWhatChanged`/`getWhatMatters`/`getRecommendedActions`/`getBrainContract` (`/api/brain/signals`, `/api/brain/contract`). See `docs/BRAIN_SIGNAL_CONTRACT.md`. Competitor-specific signals (`competitor-intelligence.ts`) still feed in via the opportunity/graph layer underneath, not duplicated. |
| **Decision** | A structured recommendation the owner approves, modifies, or dismisses in one action — distinct from an Approval, which is the risk gate *after* a decision is made. | Implemented in `server/src/phantom-ai/decisions.ts` as a packaging layer over `signals.ts` (`GET /phantom-ai/decisions`, `POST /phantom-ai/decisions/:id/decide`), stored in `.phantom/decisions.json`, decided actions written to the Hermes ledger. Surfaced as the Decision deck on the Command home (`app/js/main.js` `renderDecisions`). Follow-through is honest navigation today — when Signals gain run-capable actions, execution routes through `agent-runs.ts`, not this layer. |
| **Evidence** | The data, dates, and reasoning backing a Signal or Decision, including confidence and alternative explanations. | Established pattern in `competitor-intelligence.ts` (dated public evidence, confidence, alternative explanations) — generalize this pattern, don't reinvent it. |
| **Approval** | The gate before any external/risky action executes: publish, send, spend, deploy, delete, connect accounts, change production/client data. | Live and enforced. `approval-queue.ts` / `approvalpipeline.js`, plus the agent-run engine's own approve/reject routes (`server/src/phantom-ai/agent-runs.ts`). See `docs/RELEASE_CANDIDATE_TRUTH_MAP.md` for exactly what is gated vs. live. Three approval lanes currently exist for different purposes (agent-run execution approvals, read-only triage/Vacation-Mode lane, client-access provisioning) — know which one you're extending. |
| **Memory** | Durable institutional knowledge: preferences, rejected approaches, high-performing assets, pricing exceptions, seasonal patterns, risk tolerance. | This is the Phase III "Brain" effort — `neural-spine.ts`, `hermes-ledger.ts`, `hermes-interaction-memory.ts`, `brain.js`. See `docs/PHASE_III_BRAIN_GAP_MAP.md` for exactly what exists vs. missing (editable memory vault, behavioral profile, and context-preview endpoint are the named gaps). Extend this; do not start a second memory system. |
| **Skill** | An owner-editable playbook (trigger + instructions) the brain engages by lexical match and injects into chat context visibly. Procedures, not facts; no execution authority of their own. | `neural-spine.ts` skill records (`.phantom/brain-skills.jsonl`), `/phantom-ai/brain/skills` CRUD, engagement in `composeBrainContext`, chips in dashboard chat. See `docs/PHANTOM_SKILLS.md`. |
| **Department** | A comprehensible grouping of capability the owner reasons about directly: Growth, Creative, Operations, Client Care, Finance, Intelligence, Technology. | Maps onto the existing agent-workforce parent categories (`agent-workforce.ts`, `agentops.js`). Renaming/regrouping for owner-facing clarity is fine; the underlying ledger-derived worker topology stays. |
| **Business Record** | Durable business-domain data: clients, media, sites, finances, calendar. | Exists across `crmprospects.js`, `content-asset-storage.ts`, `sites/`, `finance-recurring.js`, `client-setup/`. |
| **Asset** | A generated or uploaded media/creative artifact tied to a campaign, client, or outcome. | `content-asset-storage.ts`, Media Lab (`medialab.js`, `media-lab-image-toolchain.ts`). |
| **Execution** | The actual carrying-out of approved work: a render, a publish, a send, an automation run. | `agent-runs.ts` is the one execution engine — states, artifacts, receipts, ledger proof. Do not build a parallel execution path; `action-registry.ts`'s 11 action contracts are intentionally executor-less scaffolding for this same engine. |
| **Task** | A discrete unit of tracked work, created only on explicit request (never inferred from casual chat). | `client-tasks.js`, governed by `docs/PHANTOM_AI_BEHAVIOR_RULES.md`. |
| **Worker / Automation / Tool** | The execution substrate: agents, scheduled jobs, provider integrations. | `agent-workforce.ts`, `automation-engine.ts`, tool registry, n8n/Ruflo lanes. Truthfully labeled as topology vs. independently-executing per `docs/WORKFORCE_REALITY_AUDIT.md`. |

## Primary Spaces

- **Command** — the living business briefing. Signals surface here as
  Decision Cards; "handled while you were away" reports live here.
  (`missioncontrol.js`, `command.js`, `organizationpulse.js`.)
- **Outcomes** — every active business goal, each opening into its full
  operational room.
- **Workforce** — the department view of agents/automations: what's
  assigned, what's active, what's blocked. (`agentops.js`.)
- **Business** — permanent records: clients, media, sites, finance,
  calendar.
- **Memory** — institutional memory: what Phantom knows and why.
  (`brain.js`, backed by `neural-spine.ts`.)
- **Analytics** — explains *why* a number moved, not just that it moved.
  (`social-analytics.js`, `contenthub.js`.)
- **Automations** — the automation engine's job list and outcomes.
- **Media / Content** — Media Lab + Content Hub creative production.
- **Approvals** — the queue of everything waiting on a human yes.
- **Settings / Developer** — owner-only controls, system health, provider
  status. Tucked at the bottom of navigation, per the standing nav
  preference in this worktree's `CLAUDE.md`.

## Execution Flow

```
Signals → Decision → Approval → Execution → Evidence → Memory → Outcome Progress
```

A Signal is detected (department-scoped or cross-department). It's packaged
into a Decision Card with evidence and a recommendation. The owner approves,
modifies, or dismisses. An approved Decision that involves risk (publish,
send, spend, deploy, delete) routes through the Approval gate before
`agent-runs.ts` executes it. Execution produces Evidence (what ran, what
changed, receipts). Evidence feeds back into Memory (durable knowledge) and
into the originating Outcome's progress. The loop is continuous — an
Outcome's progress can itself generate new Signals.

## How Existing Capability Sits Beneath This

AI models (Claude/OpenAI/OpenRouter/local), the agent-run engine, the
automation engine, Media Lab's provider lanes, the tool registry, and n8n/
Ruflo-style workers are the *execution substrate* — they carry out
Executions once a Decision clears Approval. They do not define the
architecture; they serve it. Adding a new model provider, tool, or
automation type should never require inventing a new object or space — it
plugs into Execution, and its output flows through the same Evidence →
Memory → Outcome path as everything else.

## Safety Boundaries (non-negotiable)

- Send, post, upload, spend, deploy, or any destructive/production action
  requires an explicit Approval — no exceptions for convenience.
- Secrets, tokens, and credentials never appear in docs, logs, or Memory
  records.
- Tenant/workspace boundaries are enforced server-side
  (`requireAccessSession`, `clientId` scoping) — Memory, Signals, and
  Outcomes are tenant-scoped, not global.
- No fake activity, fake metrics, or fake completion — gated/absent
  capability is labeled honestly (see `docs/RELEASE_CANDIDATE_TRUTH_MAP.md`).
