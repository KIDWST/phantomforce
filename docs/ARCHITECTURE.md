# Architecture

PhantomForce is an adaptive operator brain with controlled hands and feet. It coordinates AI models, tools, workers, automations, memory, approvals, assets, analytics, and business records through a durable application-layer nervous system.

It does not claim to modify model weights or read hidden transformer state. The neural behavior is real at the software layer: memory, context composition, event history, task routing, feedback, permission gating, proof logs, and adaptive prompts.

# Core Objects

## Outcome

A business result the system is trying to move forward. Outcomes connect goals, signals, decisions, approvals, workers, evidence, memory, and progress.

## Signal

An observed event or data point that may matter. Signals have source, timestamp, scope, confidence, and evidence.

## Decision

A recommended move derived from one or more signals. Decisions become Decision Cards when owner review is useful.

## Evidence

Proof that supports a signal, decision, run, or outcome: source URLs, metrics, logs, screenshots, receipts, local files, ledger entries, and timestamps.

## Approval

A control gate required before risky or external action. Approvals preserve owner control and create an auditable decision history.

## Memory

Durable business knowledge: facts, preferences, rules, corrections, workflows, brand details, client context, media style, tool state, and recurring patterns.

## Department

A business capability area such as Command, Clients, Media, Websites, Money, Memory, Automations, Approvals, Workforce, Analytics, Away Mode, Developer, Security, or Competitor Intelligence.

## Business Record

A structured durable record such as client, lead, proposal, task, automation, transaction, website, social account, campaign, asset, approval, or worker run.

## Asset

A usable media or business file: image, video, prompt, template, brand item, thumbnail, document, site file, audio, or generated output. Assets have ownership, retention, source, and usage metadata.

## Execution

A real action performed by a tool, worker, automation, local bridge, or provider. Execution must produce evidence and respect permissions.

## Task

A unit of work that may be drafted, assigned, approved, executed, blocked, completed, or archived.

# Main Spaces

## Command

The primary input and orchestration space. It interprets intent, uses memory, routes to departments, creates drafts or decisions, and avoids turning casual chat into fake tasks.

## Outcomes

The state of meaningful business goals. Outcomes should show progress, next action, blockers, evidence, and related decisions.

## Workforce

The capability map of departments, workers, subagents, automations, tools, and helper lanes. Workforce should distinguish real activity from mapped capacity.

## Business

The operational records: clients, leads, money, content, websites, assets, analytics, memory, approvals, and account configuration.

# Execution Flow

```text
Signals
↓
Decision
↓
Approval
↓
Execution
↓
Evidence
↓
Memory
↓
Outcome Progress
```

This flow is the spine of PhantomForce. Features should attach to it rather than bypass it.

# Tool Layer

Existing tools fit beneath the architecture as execution lanes, evidence sources, or signal sources. They do not replace the architecture.

- LLM providers reason, draft, classify, summarize, and plan.
- Codex/Claude lanes help implement and inspect code.
- Local Ollama provides private local reasoning where available.
- Media Lab creates and edits assets.
- Content Hub organizes media and content workflows.
- Social OAuth and analytics provide real account signals.
- Apify-like collectors can become backend signal sources when lawful and configured.
- n8n and automation engines can run approved workflow recipes.
- Security tools provide risk signals and evidence.
- Asset Cloud stores and indexes reusable files.
- Hermes and ledgers record events, context, proof, and memory.
- Vacation/Away Mode monitors signals and queues safe action.

Normal users should not have to know which tool handled the job. The architecture should present the business meaning: signal, decision, approval, execution, evidence, memory, and outcome.

# Safety Boundaries

PhantomForce must not expose secrets, leak cross-tenant memory, fabricate analytics, pretend disconnected tools are live, or perform external actions without permission.

Every high-impact capability needs:

- Scope.
- Tenant boundary.
- Permission model.
- Dry-run or preview where possible.
- Approval gate.
- Execution receipt.
- Evidence trail.
- Memory update rules.

# Implementation Bias

Prefer adapters around existing modules. Do not duplicate memory, ledger, worker, automation, or analytics systems when a close source of truth already exists.

Architecture first. UI second. Polish should clarify the system, not hide missing foundations.
