# Security and Privacy Decisions

## Implemented local controls

- Loopback binding and zero external data/model/telemetry destinations.
- Server-side membership, role, entitlement, rollout, analysis and job authorization.
- Workspace-scoped artifacts, analyses, jobs, audit, export, archive, deletion and recovery.
- Purpose-specific consent; withdrawal restricts artifacts and stales dependent analyses.
- 1 MB body cap, bounded text, numeric validation, stable safe errors and request IDs.
- Idempotency for retryable mutations and optimistic revisions for edits.
- Restrictive CSP, no-sniff, no-referrer, frame denial, no-store API caching and traversal rejection.
- Raw private content excluded from audit payloads.
- Exact deletion confirmation, recoverable deletion and immutable-original evidence marker.

## Roles

| Capability | Reviewer | Owner |
| --- | --- | --- |
| View and export entitled artifact | Yes | Yes |
| Create, update, analyze, review, duplicate, archive | Yes after consent | Yes after consent |
| Grant/withdraw consent | No | Yes |
| Delete/recover | No | Yes |
| Change entitlements/flags | No public route | No public route |

## Production blockers

The preview lacks production identity/session/CSRF design, relational storage, platform encryption, object storage, secret management, file-type detection, malware scanning, distributed policy, WAF/network controls, verified retention purge, backups, key rotation, security monitoring, incident response, disaster recovery, support tooling and independent review. It must not be exposed by changing `HOST`.
