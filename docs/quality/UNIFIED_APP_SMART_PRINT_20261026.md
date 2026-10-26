# Unified app, reliable switching and automatic print analysis

Owner request, October 26, 2026: use app.phantomforce.online as the main application, fix workspace switching, and replace the mandatory manual print-cost setup with useful automatic analysis. Build `phantom-live-20261026-241`.

## Account and workspace behavior

The app and old admin hostname already share the canonical backend/database. No production records, accounts, memberships or credentials were copied or changed. The canonical app now accepts a server-verified platform owner as well as ordinary business/customer accounts. The old admin hostname remains an owner-restricted alias. Owner UI capability follows verified server flags rather than a display name or hostname. Local demo shortcuts remain local-only; 2FA, token checks, tenant boundaries and owner-only API guards remain enforced.

Public boot verifies the tab token through `/session` with a bounded request. Invalid/revoked sessions are cleared. Temporary network, gateway or interrupted-body failures keep the token available for retry while leaving the UI closed. Browser storage is origin-specific; users sign in normally on the new origin. No cookie/token transfer is attempted.

Database workspace catalogs now use actual organization rows returned by the existing organization-list service. IDs such as `phantomforce-internal` remain exact. Synthetic legacy namespaces are not advertised as switchable DB organizations. A shared validator covers catalog membership and actual switching. Account-level catalog discovery does not receive a selected-business header, so an owner with no active organization can choose one. Record and commerce requests remain pinned to their selected business.

The business picker stays usable even for a one-workspace account: its account-options entry opens the workspace panel. This does not grant additional businesses to Customer 1. Catalog reads are cancelled on signout, supersession and token loss, and late account/token/tenant responses cannot repopulate another account's options.

## Automatic print workflow

Selecting projects or a folder immediately reads local 3MF metadata and produces usable-estimate, missing-slice and duplicate counts; quickest/lightest saved plates; printer/material requirements; warnings; and a prioritized next step. Folder selection ignores other file types, reads at most 20 projects and explicitly reports truncation. Files are never uploaded or executed.

The parser retains filament usage, profile/vendor/color, nozzle and slicing evidence. The existing bounded ZIP/CRC checks remain. Saved business cost assumptions load automatically. Already authorized commerce material records can refine material-only costs when the tenant, exact profile/descriptor, positive g/kg cost and full filament-weight accounting match. Imported preset prices have unverified currency and never become actual purchase costs. Zero or missing mass/time receives no financial estimate.

The cost scenario is optional and collapsed. Raw refinements survive file/folder selection and asynchronous business-context updates, including blank/invalid drafts; they do not block analysis or silently become applied prices. Slices and part counts do not establish product yield, rights, demand or profit. The brief is deterministic and source-backed; no cloud/local model is invoked to invent missing facts.

## Draft continuity

Reproduced before correction: a project editor opened and disappeared within milliseconds without a store save, because the hash probe repeated completed navigation. Separately, `store.save()` discarded unsaved fields by remounting the active page.

The route observer now distinguishes acknowledged, mounted and pending routes, including Home/Back, fast Back/Forward and legacy links. Obsolete transitions are cancelled. Background redraws defer while an editor, local read, print results or unsaved cost scenario is active; a visible notice explains pending updates. Saving/closing releases the update. Tenant/view changes invalidate the pending observer. Closing an overlay uses the same guarded refresh.

## Verification and practical limits

- Canonical app session suite: 22 checks; signed host/API owner/customer guards; DB catalog/shared-validator suite: 20 checks.
- Route continuity: 14 deterministic checks; catalog cancellation/isolation: 55 checks.
- Print intelligence: 92 checks; existing cost/ZIP suite: 21 checks; existing commerce experience: 135 checks.
- Browser: real project form saves and three-business switching/reload at 1440/390/320px; continuity through background updates, cursor selection, in-flight file read, overlay close and business changes; automatic folder brief without cost edits, duplicate exclusion, invalid optional refinements and scan limits. Phone screenshots inspected.
- Nexus performance/accessibility checks pass without raising budgets. Full release-gate outcome and live-source proof are recorded in the shared process note after deployment.

Browser runs use disposable profiles and isolated local test services. No authenticated owner click-through against the production account is claimed; it requires the user's own sign-in. No purchases, external messages, new recurring jobs, printer commands or new services were created.

Undo by reverting this dedicated release commit and syncing the canonical deployment. No database migration is involved. Existing v1 numeric print preferences remain compatible within their original browser origin and business.
