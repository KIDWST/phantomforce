# Milestone 2 Baseline

Captured: 2026-08-17, America/Chicago
Worktree: `C:\Users\jorda\Documents\Codex\2026-08-16\files-mentioned-by-the-user-phantom\work\phantomstore-ai-products`
Branch: `codex/phantomstore-ai-products-20260817`
Current HEAD: `fb5814749ae20f184bd890a0ed5f14c4f76eb874`

## Pre-change repository state

`git status --short` at 2026-08-17T01:22:56.5398060-05:00:

```text
 M package-lock.json
 M package.json
?? docs/phantomstore-ai-products/
?? packages/phantomstore-ai-products/
```

These are the bounded Milestone 1 changes. No unrelated content was detected. The delivered requirement ledger, completion ledger, browser evidence, store metadata, package source, tests and static interface were present.

Package manager: npm with the root `package-lock.json`.
Preview workspace: `packages/phantomstore-ai-products`.
Preview command: `npm run dev:phantomstore-ai-products`.
Existing preview URL: `http://127.0.0.1:4182`.

## Architecture discovered

- `src/catalog.mjs` defines exactly ten SKUs, distinct object types, fields, samples, modules and deterministic analysis contracts.
- `src/calculators.mjs` owns the ten bounded domain calculators and common output schema.
- `src/platform.mjs` owns local authorization, entitlements/flags, product consent, validation, artifacts, revisions, analyses, jobs, audit, metrics, idempotency, lifecycle and export.
- `src/server.mjs` exposes the loopback HTTP API and static interface with safe error envelopes, rate limiting, a one-megabyte body limit, CSP, traversal checks and request IDs.
- Milestone 1 persistence is a versioned single JSON document. `JsonFileAdapter` writes through a temporary file and atomic rename; `MemoryAdapter` supports tests. Domain services currently know the document shape directly.
- Fixed demo tokens map to owner, reviewer and outside-workspace sessions. Authorization is server-side and fails closed.
- Consent is product-level. Withdrawal restricts product artifacts and marks analyses stale, but Milestone 1 has no explicit source dependency graph.
- Jobs are persisted in the document, but Milestone 1 transitions queued → running → succeeded inside one mutation and lacks the full durable state contract and crash/retry simulation.
- Audit records exclude raw content, but request/job observability is not yet normalized into one trace structure.
- Repository production persistence uses Prisma at `server/prisma/schema.prisma`, with organization-scoped models and compound indexes/uniques. Milestone 2 will preserve that tenant-predicate convention through a relational-ready repository boundary without adding unused tables or fake production identity.
- Tests use Node's built-in test runner. Browser verification is performed through the local preview; no Playwright dependency is configured in this package.

## Pre-change verification

| Command | Started | Ended | Exit | Result |
|---|---|---|---:|---|
| `npm run test:phantomstore-ai-products` | 2026-08-17T01:23:31.7573013-05:00 | 2026-08-17T01:23:33.1284386-05:00 | 0 | 17/17 focused tests passed; static verification reported ten products, 5,400 ticket requirements, ten implemented vertical slices and external models disabled. |
| `npm run build:phantomstore-ai-products` | 2026-08-17T01:23:39.1432838-05:00 | 2026-08-17T01:23:40.1993200-05:00 | 0 | Focused static build passed; 41,893 bytes. |
| `npm run typecheck` | 2026-08-17T01:23:51.3316656-05:00 | 2026-08-17T01:24:00.9143114-05:00 | 0 | Contracts build and server TypeScript check passed. |
| `npm run build` | 2026-08-17T01:24:07.7997953-05:00 | 2026-08-17T01:24:18.2745146-05:00 | 0 | Contracts and server builds passed. |

Pre-existing failures: none in the four required baseline commands.

## Safety boundary

Milestone 2 continues in the same isolated worktree. It will not deploy, publish, enable payments, call paid/external providers, push remotely, create an eleventh SKU, or bulk-promote deferred requirements.
