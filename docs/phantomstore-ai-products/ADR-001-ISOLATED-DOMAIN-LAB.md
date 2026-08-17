# ADR-001: Isolated Domain Lab Package

Status: accepted for local preview

## Decision

Add `@phantomforce/phantomstore-ai-products` as a Node 22 workspace package. Use a versioned local JSON adapter behind a repository interface, a versioned HTTP API, a frozen browser client, and ten independently registered calculators. Keep model/provider and long-job contracts visible while routing the preview through real deterministic analysis with zero external provider calls.

## Why

- Preserves the live marketplace and production server while the new products are incomplete.
- Makes every product independently testable without inventing external integrations.
- Separates calculations from narrative review and exposes formulas, units, inputs, provenance, and uncertainty.
- Supports a complete evidence-to-analysis-to-human-review journey with durable local state.
- Allows the 5,400-ticket ledger to remain truthful instead of equating a page render with product completion.

## Consequences

The local file adapter is single-process and loopback-only. Fixed demo tokens are non-secret fixtures, not authentication. The active providers are deterministic analytical engines, not foundation models. Production identity, relational storage, queues, object storage, encryption infrastructure, external data/model paths, commerce, and deployment remain release blockers.
