# Milestone 2 Priority Map

Generated: 2026-08-17
Deferred tickets classified: 5390
Status transitions performed by this prioritization step: 0

This map sequences the existing deferred ticket bank. It does not mark any requirement implemented. Source prompt hashes, source lines, titles and prior evidence remain intact in the requirement ledger.

## By priority

| Priority | Count |
|---|---:|
| P0_CORE_LOOP | 314 |
| P0_SHARED_FOUNDATION | 3060 |
| P1_ACCESSIBILITY | 360 |
| P1_OPERATIONS | 1080 |
| P1_PRODUCT_COMPLETION | 396 |
| P3_OPTIONAL_OR_POST_LAUNCH | 180 |

## By dependency class

| Dependency class | Count |
|---|---:|
| ACCESSIBILITY | 360 |
| AI_ANALYSIS_RELIABILITY | 360 |
| DURABLE_JOBS | 360 |
| ENTITLEMENTS | 180 |
| OBSERVABILITY_OPERATIONS | 720 |
| PERSISTENCE_LIFECYCLE | 900 |
| PRODUCT_DOMAIN | 890 |
| PROVENANCE_EXPORT | 360 |
| SECURITY_PRIVACY | 720 |
| VERSION_CONCURRENCY | 540 |

## By product

| Product | Count |
|---|---:|
| PHANTOM BLUEPRINT | 539 |
| PHANTOM CAUSAL | 539 |
| PHANTOM CHRONICLE | 539 |
| PHANTOM DEALROOM | 539 |
| PHANTOM FOUNDRY | 539 |
| PHANTOM LOOM | 539 |
| PHANTOM ORACLE | 539 |
| PHANTOM PROOF | 539 |
| PHANTOM TERRAIN | 539 |
| PHANTOM TWIN | 539 |

## Release criticality

| Class | Count |
|---|---:|
| Release critical | 4814 |
| Not release critical | 576 |

## Top shared blockers

- PERSISTENCE_LIFECYCLE: 900
- OBSERVABILITY_OPERATIONS: 720
- SECURITY_PRIVACY: 720
- VERSION_CONCURRENCY: 540
- AI_ANALYSIS_RELIABILITY: 360
- DURABLE_JOBS: 360
- PROVENANCE_EXPORT: 360
- ENTITLEMENTS: 180

## Top product-specific blockers

- PHANTOM BLUEPRINT: 125
- PHANTOM CAUSAL: 125
- PHANTOM CHRONICLE: 125
- PHANTOM DEALROOM: 125
- PHANTOM FOUNDRY: 125
- PHANTOM LOOM: 125
- PHANTOM ORACLE: 125
- PHANTOM PROOF: 125
- PHANTOM TERRAIN: 125
- PHANTOM TWIN: 125

## Classification policy

- P0 shared foundation covers tenant-safe persistence/lifecycle, authorization, provenance/export, versioning/concurrency, durable jobs, entitlements and reusable failure behavior.
- P0 core loop covers modules explicitly named by the Milestone 2 execution contract.
- Accessibility and operations behaviors stay P1 release-critical until their required automated and manual evidence exists.
- Advanced and optional module behaviors remain post-Milestone 2.
