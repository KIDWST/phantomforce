# Focused business picker and feature preservation

Owner direction, October 26, 2026: the workspace selector is cluttered with demo, QA, development and repeated Customer 1 entries; clean it up and retain previously accepted features. Build `phantom-live-20261026-244`.

## Workspace behavior

The platform owner can administer every database organization. The UI incorrectly treated that complete administrative catalog as the everyday business switcher. The normal picker now prioritizes PhantomForce, ChicagoShots and Occasionally Odd using their exact authorized IDs and explicit server profile mappings. The preserved `phantomforce-internal` ID takes precedence over a legacy PhantomForce alias. Explicitly configured additional businesses remain supported.

Other organizations remain under searchable **Manage other workspaces** in Workspaces and accounts. Same-named records have distinct ID hints and retain their own switching targets. No database row, membership, record, credential or organization name is deleted or merged. If another workspace is currently selected, it remains visible until the user changes businesses. Ordinary customer and organization-admin accounts retain all their actual memberships. Names and categories never grant authority.

## Accepted features and actual entry points

| Capability | Entry and verification | Boundaries |
| --- | --- | --- |
| Owner command center, Next Move and Workforce | Home and full tools Menu; existing owner/browser/work-graph checks | Scoped records and verified receipts remain authoritative. |
| PhantomBot, Hermes conversation, model controls and Automations | PhantomBot, Automations and Settings; existing chat/runtime/automation release checks | Saved provider/connector readiness remains truthful; no new provider call or purchase is performed by this release. |
| Automatic local print analysis | Print analysis shortcut and Occasionally Odd Production/Finance; existing file/folder/ZIP/intelligence/browser checks | No manual cost form required; imported files remain local. Missing costs, rights and demand are not invented. |
| Studio and commerce tools | ChicagoShots calendar/projects/gear/delivery; Occasionally Odd orders/products/inventory/production/shipping/finance; existing isolation and actual-form browser checks | Exact business namespaces remain separate. |
| Social accounts and media workflow | Social accounts, Creative studio, content and analytics; existing OAuth/publication/media checks | Actual external connections and publishing approvals still govern execution. |
| Prompt Library | Restored quiet tools Menu destination and existing saved-prompt renderer | Does not restore the rejected redundant chat utility row. |
| Production Core diagnostics | Restored existing panel inside Developer; actual browser mount plus scoped async panel tests | Owner-only entry, scoped reads and transaction diagnosis; no command executes merely by opening it. |
| PhantomPlay and native Engine | PhantomPlay menu and existing native Engine edit gate; release engine/identity/deployment tests | Native editing remains guarded; public browser access does not grant machine execution. |
| PhantomStore and ten integrated products | PhantomStore menu; existing product/entitlement/server tests | Platform access and customer purchase authority remain distinct. |
| Runtime, Memory, Planner, Away Mode and account administration | Existing complete owner Menu, Developer and Admin access | Existing role and API guards are retained. |

The audit found two concrete orphaned capabilities. Production Core remained in an old admin renderer overridden by the current People/access screen; it now mounts in the actual Developer route. Prompt Library had a registered page but no normal navigation entry; it now has a quiet menu destination. Production Core state is per mount, tenant, account token and request revision; stale reads/diagnoses cannot paint another business's data.

REA-derived print analysis is retained. No generic browser REA execution capability is invented. The accepted removed Earth/orbit and shell-pet decorations stay removed.

## Authentication finding carried forward

The user confirmed successful admin login while this work began. The earlier literal `true` failure was traced to stringifying an error flag. Its original upstream response was not reproduced: local API, static gateway and public endpoint returned matching validation results. The client now produces safe status-specific errors and validates complete account/challenge payloads before storing a session. This does not claim a password or production account was changed.

## Verification and undo

Directory tests cover exact core IDs, all-record preservation, duplicate labels, search, active nonbusiness scope and unchanged customer memberships. A sixteen-organization browser fixture at1440/390px exercises the actual picker, collapsed management, search, exact switching and preserved client access. Owner-route browser coverage includes Prompt Library and the restored Production Core panel across all three businesses.

Authentication tests reproduce boolean/object failures and malformed successful responses; actual forms retain password/2FA and retry behavior. Production Core tests cover late responses, detached mounts, account/tenant changes, malformed envelopes and scoped diagnosis. Existing size budgets remain unchanged; management CSS is lazy-loaded.

Full release and live-source results are recorded in the shared Obsidian note. Undo by reverting the dedicated release commit and syncing the canonical deployment. No data migration needs reversal.
