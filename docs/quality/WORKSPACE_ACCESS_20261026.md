# Workspace access recovery — October 26, 2026

The owner's public browser was signed into Customer 1 Workspace. Its native business selector was disabled with one option and no explanation. The earlier print scanner was reachable only through Occasionally Odd's commerce sections, so the instructions handed to the owner led to an inaccessible workflow. No account was promoted or membership created to mask this problem.

Build `phantom-live-20261026-239` adds an always-enabled workspace panel beside the current business selector. It shows the current account, authorized workspace cards, current selection, loading/failure states, a bounded refresh, account-change action, owner sign-in entry and installed-PC fallback. The native select remains available for accounts with multiple businesses. Cards use the same guarded switching path and document reload that clears the former business's transient state.

The server workspace catalog now drives both options and client selection validation, including database accounts; membership snapshots remain a disconnected fallback. Local customer accounts remain pinned to their actual organization. Signout clears the catalog and invalidates its pending response. Catalog reads time out after 10 seconds; organization switch calls after 12 seconds. An unconfirmed switch returns a visible recovery panel. Server membership enforcement is unchanged.

Print analysis is available directly from the workspace panel in every account and from the desktop header. It uses only files selected locally by that account, with numeric preferences bound to its current business. It does not expose Occasionally Odd's orders, products, credentials or files. Native dialog Escape/focus behavior and scanner disposal apply on close. The file-processing code remains the previous reviewed scanner.

## Verification

- Build passed. Auth boundaries passed.
- Business workspace suite: 24 store/client checks, 189 experience checks, 27 media-boundary checks and 70 server assertions passed, including authenticated switching and denied cross-business access.
- New workspace access unit suite: 11 checks passed for catalog precedence, customer scope, stale memberships, deduplication and recovery explanations.
- New isolated browser suite: all three businesses at 1440, 768 and 390px switched through cards, retained selection across reload, opened local print analysis, contained its width, closed with Escape and restored focus. A separate single-customer fixture retained one scope, explained the limitation, recovered from failed refresh and opened print analysis without switching. Screenshots visually inspected; print-dialog scroll reset fixed after review.
- Existing commerce: 135 checks passed. Navigation and 21 scanner checks passed. Change memory: 519 checks passed. Diff whitespace check passed.
- The older business browser suite stops at its already-stale `data-business-home` click after its first successful desktop audit; the current dashboard no longer has that selector. The new focused suite exercises this release's actual controls rather than skipping that suite's unrelated work-item checks.
- The full release-critical suite has a previously reproduced baseline CRM draft-identity failure, recorded in PRINT_OPPORTUNITY_20261026.md. No claim of a green full-release suite.

## Remaining conditions and undo

The observed customer account cannot become the owner's operator account through a workspace selector. Owner authentication is required; the public admin hostname had a DNS failure during the previous release. The installed-PC link opens the normal login on the canonical local service. No saved credentials were read or used, and no authentication dialog was automated.

Revert this dedicated release commit and sync the canonical deployment to undo. There is no migration, membership change, new service or recurring job. Existing print-analysis saved numeric assumptions remain compatible.
