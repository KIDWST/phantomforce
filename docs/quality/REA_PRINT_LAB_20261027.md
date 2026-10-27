# REA-assisted Print Lab — 2026-10-27

Build `phantom-live-20261027-247` adds automatic production decisions to the existing Occasionally Odd Bambu feed in Production and Finance. No new navigation, setup form, provider, endpoint, storage schema or service is introduced.

## Problem and behavior

A similarly named re-slice can be faster while printing different parts on a different machine. Raw fastest/lightest sorting cannot establish equivalent finished output. The lab groups possible same-title versions and explicitly linked recipe versions, computes changes in total captured mass/runtime/production cost, and explains the cost of releasing printer time. Part count, plate count, printer family, nozzle, support and named slice-profile changes prevent an automatic resource recommendation. A complete-product recipe with explicit linked files is required before ranking resource use; physical quality still needs validation.

Print cost covers material and machine time with the existing full-reprint allowance. Finishing, hardware and packaging are separate. Exact, uniquely associated same-currency material costs replace the generic rate. Unknown or malformed measurements remain unknown. Frozen quotes and source records are never mutated.

The same view computes resource-substitution thresholds from saved planning rates. At $15/kg PLA, $1/machine-hour, $20/hands-on hour and 10% reprint allowance, one saved printer-hour covers 66.67g extra material at machine cost alone, while one saved finishing minute covers20g extra material after reprint risk. The target-return scenario is separate from cash-cost equivalence and never claims income or demand.

Configured48 printer-hours/day and120 hands-on minutes/day imply a global crossover of2.5 finishing minutes per occupied printer-hour. Recipe throughput uses only printers matching that slice's actual family and explicit compatibility constraints. It is a theoretical long-run ceiling, not a queue-aware delivery promise or authorization to run P2S instructions on P1S. Zero finishing is distinct from unknown finishing.

## Actual REA use

Installed `rea-agents6.5.0` was used locally, rather than an invented connector. REA's generic ZIP inspection does not admit `.3mf` directly, so three captured archives were copied byte-for-byte to bounded `.zip` aliases with verified SHA-256 equality. REA recognized27,33 and33 container members, verified all member hashes and left original archives unchanged. Two captures had identical model-member digest sets despite different overall archives and selected print composition. This supports source-relatedness, not interchangeable Gcode or physical-quality equivalence.

An isolated staging directory contained only the current parser's selected JS/TS sources and an authored minimal manifest. REA parsed both sources:18,542text bytes,3,337AST nodes,21findings, zero parse failures. Selection alone would still inventory the parent directory, so the whole checkout was not passed to REA. No target execution, upload, private credential scan or native/remote provider was used. Full private evidence stays on the owner's machine; sanitized process memory records its location and digests.

REA supplied the investigation evidence. The shipped feature uses deterministic existing slice metadata and recipe declarations; it does not silently install or run REA against future private folders.

## Verification and limits

- Focused core regression:60 checks for misleading title matches, differing parts/printers, complete recipe relationships, quality-profile changes, material-cost association/currency, missing/null/NaN data, resource substitution, same-family capacity, immutable source snapshots and bounded comparisons.
- Focused browser:20 checks using actual modules with isolated synthetic records, keyboard disclosure,390px containment, escaped titles, cross-business exclusion, zero fetches/storage writes and inspected desktop/mobile screenshots.
- Existing full Production/Finance feed browser flow passes, including authenticated history, saved mappings, download integrity, draft-safe refresh and late account-response isolation.
- Release gate and live proof are recorded in the process vault after execution; passing synthetic tests never establishes actual completed jobs, revenue or physical quality.

The decision layer is bounded to200 valid files,8 comparison groups,6 representative variants/group and100 recipes; the UI shows at most8 recipe ceilings. Bounds are disclosed. Title-only grouping is a conservative proposal; differently named re-slices need an explicit recipe link. The feature does not establish geometric equivalence or automatically alter slicer settings.

## Undo

Revert this feature commit, preserving the captured archives, shop settings and workflow journals; sync the canonical live checkout. The new code has no persistent state or schema to migrate back. Collapse Print lab to hide the view during a session. Existing Bambu capture and paired read-only monitoring remain independent.
