# Print opportunity scanner

Owner request: add the REA-derived print opportunity scanner to PhantomForce (corrected from standalone PhantomBot). Build `phantom-live-20261026-238`.

## Location and behavior

Occasionally Odd → Production or Finance → **Print opportunities**. The existing commerce workspace, organization selector, navigation and permission boundaries remain in place. This is a local analysis surface, not an order, product or accounting mutation.

Select/drop up to 20 `.3mf` files, 128 MiB each. The browser reads only two bounded ZIP metadata members, validates headers and CRC, and rejects encrypted, split, ZIP64, ambiguous and oversized entries. Decompressed metadata is capped at 1 MiB per member. No files are uploaded, no REA/server process is launched, and no printing, slicing, listing or purchase is performed.

Retained slice weights/times produce whole-plate break-even, target-margin and target-hourly-contribution revenue thresholds. Identical file hashes count once. Empty slice headers and missing measurements are reported instead of becoming zero-cost estimates. Imported filament prices are exposed as unverified values and excluded from costing.

Costs can be adjusted and explicitly saved on the device under the immutable business ID. Selected file analysis remains only within the commerce mount; a workspace/business change disposes its view and prevents stale asynchronous completion from repainting another tenant. An explicit download exports the scenario, evidence hashes and calculated rows as JSON.

## Cost model

Example USD values are editable planning assumptions, not the business's measured costs. Full-attempt failures repeat machine/material cost and occupied hours; finishing labor, packing and a fixed fee are charged once per successful plate. Percentage fees apply to revenue. Margin and hourly targets are separate threshold columns, not cumulative claims of profitability.

One plate is not one finished product by implication. Mesh counts do not establish saleable units; multi-plate assemblies require complete bills of materials and finishing costs outside this first slice. Shipping, tax, ads, licensing, refunds, demand and other unlisted overhead remain unmodeled. Historical estimates may target a different printer. Possession of a model does not establish commercial rights. Contribution is not net business profit.

## Verification

- `npm run build`: contracts and server TypeScript build passed.
- `node scripts/test-print-opportunity.mjs`: 21 checks passed: known-value thresholds, failure adjustment, missing values, invalid rates, business-bound state/preferences, stored/deflated ZIP parsing, duplicate member rejection, encryption rejection, CRC integrity and malformed archives.
- Existing commerce experience: 135 checks passed, including scoped/versioned writes and rejected cross-tenant data. Business navigation checks passed.
- Change-memory: 514 checks passed. New guard records the local scanner, business binding, ZIP integrity and planning-estimate boundary.
- Native Brave on a local QA-only fixture: five real DOMParser assertions passed; a compressed synthetic 3MF plus identical duplicate produced one row with 64.20 g, 1.78 h, $9.32 break-even, $13.98 margin threshold, $31.26 hourly threshold and $7.15 contribution/hour under the shipped example scenario. The narrow 390px container was visually inspected. Fixture is in ignored `tmp/`, not shipped.
- Full release-critical suite stopped at `test:crm-growth-automation`: `Prepared drafts must carry explicit CRM identity`, expected `contact-ready`, actual undefined. The exact same failure was reproduced on the unchanged production checkout. No CRM source or test was changed to suppress it.
- Evolution preflight on the clean deployment checkout before integration: valid=true; branch main, clean tree, aligned upstream and required local endpoints healthy.
- Browser automation provider was unavailable, so visual proof used the existing Windows browser through the supported computer-use interface. No claim of an automated full-app mobile matrix or authenticated new commerce record creation is made.

## Rollback

Revert the dedicated integration commit and sync the canonical deployment checkout through the normal release path. Existing orders, products, credentials and printer records are untouched. Optional saved cost preferences use `phantomforce:print-costs:v1:<businessId>` and contain only numeric assumptions; there is no schema migration.
