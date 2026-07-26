# PhantomBot 0.4 ecosystem knowledge and capability registry

Date: 2026-07-26

## Outcome

Hermes planning now receives a bounded, source-backed Phantom ecosystem
context assembled by
`server/src/phantom-ai/hermes-ecosystem-knowledge.ts`. It covers the
canonical PhantomForce/PhantomBot control plane, Hermes ACP, Termina,
execution governance, provider routing, PhantomPlay/PhantomStore, skills,
plugins, connectors, agent definitions, and automation.

The context contains environment-variable names but never values. It does
not ingest Codex conversations. Changing runtime facts must still be
validated through typed read operations.

## Durable source records

Seven evidence-bearing records answer the core orientation questions:

- canonical repository and inspected live deployment;
- stabilization worktree meaning and direct-production edit prohibition;
- PhantomBot supervision and Hermes ACP roles;
- PhantomForce ownership of approvals, execution, receipts, and memory;
- Termina's separate mission-orchestration role and current real-runtime
  blockers;
- provider transports and their configuration-vs-readiness distinction;
- PhantomPlay, PhantomStore, skills, agent definitions, and automations.

Each record carries identity, relationships, entry points, commands, tests,
environment names, boundaries, and evidence sources.

## Authoritative capability registry

`docs/tooling-spine/phantom-capability-registry.json` supersedes source-only
inference for the inspected operator surface. Every entry records the
required Phase 7 fields and uses the mission's status vocabulary.

Validated totals:

| Status | Count |
|---|---:|
| production-ready | 5 |
| functional but incomplete | 4 |
| experimental | 1 |
| disconnected | 1 |
| unknown | 1 |
| test-only / simulated / deprecated | 0 |

The disconnected legacy tooling-spine entry preserves its own declared
read-only/scaffolded truth. The MCP runtime entry remains unknown because
no canonical runtime wiring or test was established in the inspected
repository.

## Verification

```text
npm run test:hermes-ecosystem-knowledge --workspace @phantomforce/server
  7 records; canonical orientation; evidence required; environment values excluded

npm run test:phantom-capability-registry --workspace @phantomforce/server
  12 unique entries; required fields and status vocabulary validated

npm run build
  contracts and server TypeScript build passed
```

## Security posture

- Facts are selected lexically and capped before prompt composition.
- Evidence is repository-native or an explicitly documented inspected
  runtime fact.
- No secret values or raw chats are stored.
- Skills and provider transports carry no execution authority.
- Runtime status is not inferred from file presence.
