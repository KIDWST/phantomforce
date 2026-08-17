# Milestone 2 Browser Playtest

Date: 2026-08-17
Target: `http://127.0.0.1:4182`
Surface: Codex in-app browser
Data: isolated `.local/milestone2-playtest.json`

## Desktop result

All ten products completed the real browser path through the local service: grant purpose consent, load the reversible fixture, create a durable artifact, run the product-specific deterministic analysis, inspect the complete core-loop panel, and accept the result. The products were Oracle, Chronicle, Foundry, Twin, Dealroom, Blueprint, Terrain, Proof, Loom Dependency, and Causal.

Oracle also passed an edit-specific path. Revision 1 was loaded into the edit form, an assumption changed, revision 2 was saved, the prior analysis became stale and non-reviewable, and recomputation changed the product-specific ranking: `Single hub` moved to 88.64 while `Dual source` moved to 54.65. The recomputed result was then accepted.

That edit path initially exposed a browser defect: the provenance controls were not restored from the versioned source, so native required-field validation blocked the save. The controls now restore the immutable evidence note and label before saving a new revision, and the path was rechecked in the browser.

## 390 × 844 result

Oracle, Chronicle, Terrain, and Causal passed at the required viewport. For each product the product region, mobile Products control, persisted artifact, complete core-loop panel, and accepted human disposition were present. The drawer closed after product selection. Visual inspection of the Causal input/artifact/review layout and core-loop card found readable wrapped controls, contained tables, intact badges, and no page-level horizontal overflow. The temporary viewport override was reset.

## Browser diagnostics

- Console warnings: 0
- Console errors: 0
- External model calls: none
- Provider spend: $0

## Remaining independent/manual gates

Screen-reader traversal, touch hardware, 200%/400% zoom, Safari and Firefox behavior, interrupted-network timing, download-permission UX, independent light-theme contrast measurement, and an independent WCAG audit remain release gates.
