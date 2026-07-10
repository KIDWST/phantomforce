# PhantomForce Workforce Reality Audit

Build baseline: `phantom-live-20260710-138`

## Finding

The previous 1,226-node number was a topology count, not a count of 1,226 independent autonomous workers. The mapped network is useful as an operating graph only if the product names it truthfully.

## Truthful Breakdown

- Parent worker definitions: 12
- Curated subagent definitions: 12
- Template-generated subagent mappings: 108
- Template-generated neural-cell mappings: 1,080
- Automation job definitions: derived from the automation engine
- Runtime executable admin-safe actions: derived from AgentLab action definitions

Generated subagents and neural cells are contracts and topology relationships. They are not independent runtime processes, do not execute external actions, and do not receive task/token counts unless a real ledger/action route produces evidence.

## Node Categories

- Parent worker definitions observe real Hermes ledger records through route/task matching.
- Curated subagents name concrete helper capabilities and safe action lanes.
- Template-generated subagents define reusable helper lanes such as Signal, Research, Plan, Draft, QA, Relay, Proof, Ledger, and Feedback.
- Neural cells define processing contracts such as Intake, Memory, Rank, Compose, Verify, Guard, Route, Archive, Feedback, and Health.
- Automation job definitions remain read-only/prep-only unless explicit automation routes run.

## Representative Request Traces

1. Casual chat: stays in PhantomAI/chat and must not create worker activity.
2. Explicit business task: routes to a parent category, drafts/plans, and approval-gates external action.
3. Media generation: routes through Media Lab and honest provider/rembg status.
4. External action: queues/previews approval; does not send, post, upload, deploy, or spend silently.
5. Vacation Mode: uses its own permissioned away-coverage and automation rules.
6. Memory/brand-context request: routes through Brain memory/Hermes and remains tenant scoped.
7. Missing integration: returns blocked/scaffolded/manual state instead of fake success.

## Audit Changes

- Added explicit `backing_type`, `runtime_role`, `executable`, `routable`, `independent_runtime`, `metric_source`, and `contract` metadata to workforce nodes.
- Removed inherited fake task/token metrics from generated subagents and neural cells.
- Added `node_truth`, `contracts`, and `request_traces` to the admin workforce status payload.
- Updated Workers UI language from live activity claims to mapped topology and ledger signals.
- Updated Developer Control Room statistics to separate mapped topology from executable safe actions.
- Extended workforce tests to validate contracts, identity uniqueness, non-executable generated cells, and truthful topology stats.

## Safety Boundaries

- No provider calls are made by the workforce status audit.
- n8n is not started.
- Workflows are not executed.
- External sends, posts, uploads, deployments, payments, and destructive actions remain approval-gated.
- Generated nodes are explicitly labeled as not independently executable.
