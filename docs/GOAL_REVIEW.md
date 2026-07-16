# Goal Document Review

This review captures how the original monolithic Goal prompt should evolve into maintainable project documentation. It does not rewrite every idea; it identifies where structure improves execution.

# Repeated Ideas

## Chat is not the product

This appears in multiple forms: "not ChatGPT," "command-first," "smart not follow orders," "dashboard plus chat is not enough."

Recommendation: keep this once as a principle and reference it from architecture. Repetition caused agents to over-focus on chat UI changes instead of the underlying operating system.

Why it helps: future sessions can interpret chat as one surface of Command, not as the entire product.

## Approval-gated action

The Goal repeatedly says nothing should send, post, upload, deploy, charge, create invoices, or mutate production without approval.

Recommendation: move this into `docs/ARCHITECTURE.md` as a core safety boundary and keep `/goal` as an execution reminder.

Why it helps: safety becomes a system invariant, not a paragraph agents may miss.

## Hide backend tools

The owner repeatedly rejects user-facing Apify, Higgsfield, n8n, provider, and developer wording.

Recommendation: define "Hide The Machinery" as a principle and map tools beneath architecture.

Why it helps: future integrations can add power without leaking implementation detail into normal user UX.

## No fake data

The Goal repeatedly rejects mock tasks, fake workers, fake analytics, fake clients, and decorative activity.

Recommendation: make "Honest Empty States" a principle and require real source classification for signals/workers/analytics.

Why it helps: new accounts can feel clean and ready without hallucinating value.

# Conflicting Ideas

## "Everything live" vs approval control

Some instructions ask for live mode, all systems active, and no limitations; others require strict approval before external actions.

Recommendation: define live mode as "live data and live preparation," not silent external execution. External actions remain approval-gated unless a future permission model explicitly allows them.

Why it helps: agents can connect real feeds and tools without creating dangerous automation.

## Massive worker counts vs real activity

The Goal asks for 500 to 1000+ workers and also demands no fake activity.

Recommendation: separate mapped capacity, baseline lanes, subagents, and active runs. Counts can be large only when labeled as capacity/mapped network, while active work must come from real runs or records.

Why it helps: the workforce can feel powerful without lying.

## Magical UI vs practical usability

The Goal asks for magical, animated, living Phantom behavior while also criticizing bloat, wasted space, and mobile breakage.

Recommendation: treat animation as state communication. It should be secondary to task flow, mobile usability, and readable controls.

Why it helps: design stays premium instead of becoming decorative clutter.

# Ambiguous Wording

## "Smart"

"Smart" can mean reasoning, routing, memory, automation, suggestions, or agent execution.

Recommendation: define smart behavior as context composition, intent classification, signal routing, decision creation, approval gating, memory updates, and evidence logging.

Why it helps: agents can implement concrete capabilities instead of changing copy.

## "Neural network"

The phrase risks misleading claims about model weights or hidden transformer behavior.

Recommendation: define neural behavior as application-layer adaptation: memory, events, context, feedback, routing, proof, and policy.

Why it helps: keeps the vision ambitious and technically honest.

## "Automated business"

The phrase can be interpreted as autonomous external execution.

Recommendation: distinguish automatic observation/preparation from approval-gated external action.

Why it helps: automation becomes useful without unsafe sends, posts, payments, or writes.

# Missing Architectural Definitions

The original Goal needs stable definitions for:

- Outcome.
- Signal.
- Decision.
- Evidence.
- Approval.
- Memory.
- Department.
- Business Record.
- Asset.
- Execution.
- Task.

Recommendation: use `docs/ARCHITECTURE.md` as the source of truth for these objects.

Why it helps: features can share the same nouns and data flow instead of inventing new panels each session.

# Where Implementation Requirements Should Replace Vision Language

## Memory

Vision language: "remember everything important."

Implementation requirement: memory records must be scoped, typed, editable, deletable, confidence-weighted, safe, and separate from temporary history.

## Analytics

Vision language: "show analytics like the old page with graphs and colors."

Implementation requirement: analytics must use real live OAuth feeds or clearly labeled imports; empty states must guide setup; charts should produce decisions.

## Automations

Vision language: "make every business feel automated."

Implementation requirement: automations need configured parameters, schedule, risk level, approval requirements, status, run history, and surfaced output.

## Workforce

Vision language: "swarm network with 1000 workers."

Implementation requirement: workforce must distinguish active runs, baseline workers, mapped helper lanes, subagents, departments, and blocked/offline states.

## Media Editor

Vision language: "mini Adobe/Camera Raw with AI."

Implementation requirement: editor needs layer model, selection model, transform controls, undo/redo, keyboard shortcuts, AI subject detection, bokeh mask behavior, export, and asset persistence.

# Maintainability Recommendations

1. Keep `/goal` procedural and small.

Why: a command should tell agents how to operate, not contain the whole company.

2. Keep vision stable.

Why: the product philosophy should not churn every time a feature changes.

3. Keep current mission changeable.

Why: the active engineering priority evolves faster than the vision.

4. Add gap maps before major builds.

Why: PhantomForce already has many partial systems. Discovery prevents duplicate memory, ledger, automation, and worker layers.

5. Treat docs as source-of-truth inputs for agents.

Why: future Claude/Codex sessions can run `/goal Implement the highest-value missing capability` and start from the same architecture.

6. Use evidence and acceptance criteria in every major task.

Why: this prevents "changed something" from being mistaken for "made the product better."
