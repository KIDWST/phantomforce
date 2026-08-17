# Risk Register

| Risk | Current control | Remaining work |
| --- | --- | --- |
| Calculator mistaken for prediction or truth | Formula, inputs, units, method, warnings, explicit product non-goals, human review | Domain validation, calibration and customer-language review |
| Cross-tenant disclosure | Workspace-scoped object lookup and outsider tests | Re-prove across database, cache, object storage, support and exports |
| Human source overwritten | Analysis stored separately, revision conflicts, source-change staleness | Apply invariants to future imports and collaboration paths |
| Source authenticity assumed | Evidence hash/provenance and explicit user-provided class | Signature verification, custody records and connector attestations where appropriate |
| Sensitive local file exposure | Loopback default, ignored `.local`, no telemetry/provider calls | Production identity, encryption, database/storage, secrets and host controls |
| Fixed token treated as authentication | UI/docs label tokens as demo fixtures | Replace before shared/network use |
| Concurrent writers corrupt local state | Serialized process writes and atomic rename | Transactional relational store, concurrency tests, backup/restore drill |
| Stale geospatial/evidence input | Source date and freshness warnings | Approved public-data connectors, license review and freshness SLOs |
| Negotiation misuse | No impersonation/outreach/deception generation; declared counterpart estimates | Safety policy, abuse monitoring, red-team and consent controls |
| Causal overclaim | Unadjusted difference/interval and confounder warnings; no causal verdict | Experiment-design validation, robust methods and statistical review |
| Dataset misuse | Recipe/coverage planning only; no generated training content | Rights/consent, contamination, safety, bias and benchmark governance |
| Dependency/name collision | Internal Loom SKU distinguishes dependency product | Owner must resolve public PHANTOM LOOM collision before store publication |
| Destructive mistake | Exact confirmation, separate archive, recovery, audit | Timed purge, legal hold, support authorization and recovery drills |
| Accessibility regression | Semantic/static tests, responsive CSS, browser playtest gate | Assistive-technology and independent WCAG review |
| Dependency vulnerability | New package adds no third-party dependency | Remediate inherited repository advisories under separate compatibility review |

## Tested abuse and failure cases

Invalid identity, insufficient role, absent/expired entitlement, paused analysis, wrong-tenant ID, missing consent, invalid fields, missing idempotency, duplicate retry, stale revision, source edit after analysis, invalid deletion confirmation, static traversal, unknown API route, consent withdrawal, raw-content audit leakage, and schema-too-new migration.
