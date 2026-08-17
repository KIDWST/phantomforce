# Milestone 2 Architecture

## Runtime boundary

The package remains a loopback-only Node.js local preview. `server.mjs` exposes authenticated local HTTP routes and static assets. `platform.mjs` is the application-service boundary. It applies identity, workspace membership, role, entitlement, feature and kill-switch checks before reaching repositories or domain engines.

## Persistence and tenancy

`RepositoryHub` exposes workspace-scoped artifact, analysis, job, source, consent, audit, metric, trace, and version repositories. Every lookup requires an explicit workspace predicate. The active adapter stores schema-v2 JSON with atomic replacement. `RelationalRepositoryBoundary` documents the production-shaped interface but intentionally fails closed until a real relational implementation, migrations, transactions, encryption, backups, and operations exist.

## Identity and policy

`IdentityAdapter` defines the session contract. The active local adapter maps fixed non-secret test tokens to owner, reviewer, and outsider fixtures. The production identity adapter is disabled. Central policy evaluates plans, limits, per-product entitlements, analysis/job flags, expensive-operation flags, and external-provider switches. External providers are off and provider spend remains $0.

## Consent, provenance, and lifecycle

Creation requires a granted purpose-and-retention consent record. Each artifact links to an immutable source record and content digest. Consent withdrawal or source deletion marks dependent artifacts restricted and their analyses stale. Editing creates a new source revision while preserving history. Archive is reversible. Deletion requires an exact identifier and creates a bounded recovery record.

## Jobs and observability

Analysis runs through durable local jobs with queued, running, awaiting-review, succeeded, failed, canceled, dead-letter, and stale states. Idempotency keys are scoped to workspace, actor, operation, and request digest; collisions fail closed. Metrics, audit events, and traces are bounded and exclude raw source or artifact text.

## Export boundary

Schema-v2 portable JSON exports include source and version identifiers, provenance digests, method and calculation metadata, review disposition, and lifecycle state. They do not claim compatibility with a production data plane.

## Deliberately unfinished production work

Real SSO, relational persistence, queue workers, object storage, file scanning, encryption/key management, backup and purge operations, distributed rate limiting, production telemetry, incident response, provider governance, independent accessibility/security review, public deployment, and production billing remain deferred.
