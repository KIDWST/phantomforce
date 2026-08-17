# Ten Product Specifications

| Product | Prescribed primary module | Durable object | Implemented calculation | Primary metric |
| --- | --- | --- | --- | --- |
| PHANTOM ORACLE | Decision Canvas | Decision simulation | Equal-scenario option mean with uncertainty/spread penalty | Stability-adjusted option score (points) |
| PHANTOM CHRONICLE | Evidence Intake | Source-linked chronology | Stable date ordering, gap detection, observed/inferred preservation | Maximum chronology gap (days) |
| PHANTOM FOUNDRY | Schema Studio | Benchmark recipe | Deduplicated taxonomy coverage and deterministic recipe IDs | Planned taxonomy coverage (%) |
| PHANTOM TWIN | Process Mapper | Operational twin | Step capacity, utilization, bottleneck, and unqueued cycle time | Bottleneck utilization (%) |
| PHANTOM DEALROOM | Deal Map | Negotiation plan | Geometric package balance and reservation-floor check | Balanced package value (points) |
| PHANTOM BLUEPRINT | Requirements Compiler | Traceable system specification | Exact requirement-to-component traceability | Requirement traceability (%) |
| PHANTOM TERRAIN | Layer Catalog | Site comparison | Normalized weighted candidate scoring plus source age | Transparent site score (points) |
| PHANTOM PROOF | Claim Decomposer | Proof packet | Quality-weighted support-versus-oppose balance | Weighted evidence balance (points) |
| PHANTOM LOOM | Corpus Intake | Dependency graph | Commitment source coverage, dependency validation, contradiction preservation | Traceable commitment coverage (%) |
| PHANTOM CAUSAL | Hypothesis Studio | Experiment record | Difference in proportions and unadjusted 95% interval | Observed absolute difference (percentage points) |

## Shared governed lifecycle

1. Entitled owner grants product-specific purpose consent.
2. Reviewer or owner creates the prescribed primary object with required domain fields and a provenance note.
3. The platform stores immutable original evidence content/hash, tenant ID, revision, and version-history event.
4. A retry-safe analysis request creates a durable job record, validates inputs, runs the product calculator, validates the output contract, and persists the analysis separately from source fields.
5. The interface exposes value, unit, formula, inputs, rounding, method, warnings, provenance, provider path, external-model truth, and cost.
6. A human accepts, corrects, or rejects. Corrected output records the correction without silently changing source fields.
7. The user can duplicate, archive, export, delete, and recover artifacts. Consent withdrawal restricts artifacts and stales analyses.

## Boundaries

These are not ten skins of a chatbot. The package has no chat input and each product owns a different field schema, object type, module list, calculator, output table, metric definition, non-goal set, and golden fixture.

The master prompt specifies twelve feature modules and 540 engineering tickets per product. Only the tested create-from-blank path for each prescribed primary module is marked implemented. The remaining module behaviors stay deferred in the requirement ledger.

The dependency-intelligence PHANTOM LOOM uses internal SKU `phantom-loom-dependency`. Its public name collides with a separate operational-knowledge Loom prototype and requires an owner naming decision before store publication.
