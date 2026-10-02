# PhantomForce multi-business workspace implementation

Local review candidate, completed September 26, 2026. **Not deployed.**

## Verified source and preserved site

The old June path was not assumed current. The actual served checkout was identified as `G:\Codex\Documents\Codex\deployments\phantomforce-live`, at commit `ac9e419a43e946a62b8dbe844c8665b7c41389dd`. The older editing checkout had unrelated unfinished work.

Implementation is in the clean matching development clone:

`C:\Users\jorda\Documents\Codex\2026-09-11\ji-k\work\phantomforce-chicagoshots-clone`

Branch: `feature/business-workspaces-20260924`. Browser build: `phantom-live-20260925-234`.

No production source, running deployment configuration, database, account credentials or channels were changed. Nothing was pushed. Changes remain local and are also included in the accompanying patch.

## What changes when you switch

The persistent global business selector changes the business identity, dashboard, navigation, terminology, workflow records, templates, assets/channels context and assistant context.

| Business | Experience |
| --- | --- |
| PhantomForce | Existing operations dashboard and integrations preserved; websites, leads, projects and approval-gated automation. |
| ChicagoShots | Navy/lime sports studio; media-day bookings, clients, shoots, editing/deliverables, campaign studio, social channels and production templates. |
| Occasionally Odd | Plum/peach maker workspace; seasonal made-to-order decor, custom/bulk orders, production, marketplace channels, licensing records and special freebie campaign drafts. Contact: occasionallyoddsupport@gmail.com. |

Work can be created, edited and retained across business switches and reloads. Authenticated work uses server-backed records; service failures never silently become local-only saves. Local draft mode is explicitly separated. A documented rights reference is required before licensed merchandise progresses into production. Campaign tracker status cannot invent approval, publication or delivery receipts.

Switching locks the old workspace, aborts requests and reloads the document after authorization, removing previous-business module state, chats, modal handlers and background timers. A refused switch keeps the original business selected.

## Separation and migration

- The server validates the selected business against account membership and rejects conflicting request scopes. Organization IDs are exact; similar names and old aliases do not grant access or collapse records.
- Records, AI context/history, notifications, assets, financial receipts, channel tokens, preferences and mutation lookups use the active business. Duplicate record IDs in different businesses cannot target each other's records.
- New durable operational records use validated, atomically replaced per-business document files with version-checked edits, following the repository's existing document-store pattern. Existing organization-keyed PostgreSQL records remain in their existing stores.
- PhantomForce credentials are not fallback credentials for ChicagoShots or Occasionally Odd. New businesses need their own authorized connections. Shared machine automation, asset-library and execution tools require a dedicated business integration before becoming available there.
- Existing owner-private data stays in `phantomforce-owner`, exposed to authorized owners as **PhantomForce — legacy private records**. Nothing is silently merged into another company.
- Explicit local legacy aliases can be normalized; server-owned IDs and ambiguous legacy records remain intact. Unassigned records are withheld rather than assigned to whichever company opens first.
- The additive organization/membership bootstrap has an offline dry-run and an explicit apply mode requiring a verified existing super-admin. Only the dry-run was performed.
- Future businesses can be configured with explicit tenant/profile mappings. Display names never determine authority.

## Verification

| Check | Result |
| --- | --- |
| Existing release-critical suite, including build and typecheck | 46/46 passed |
| Switching, records, memory, approvals, notifications and request boundaries | 24/24 passed |
| Business experience, permissions, templates, rights gates and edit conflicts | 82 checks passed |
| Media credential and job boundaries | 18 passed; zero provider calls |
| Authenticated backend business-scope suite | 66 assertions passed |
| Change-memory architecture guard | 486 checks passed |
| Browser switching, real forms, reloads and record separation | 9/9 passed at 1440, 390 and 320 pixels; zero uncaught errors |
| AI operator streams | 15 behaviors passed, including business mismatch and revoked-token rejection |
| Final build after streaming changes | Passed |

Browser fixtures use a disposable profile and a static-only local server with API/provider traffic disabled. Backend tests use isolated fixtures; no production database or real channel is used. Stream authentication requires the active business before emitting events, and revalidates access before updates and cancellation.

One additional legacy test outside the release-critical suite, `scripts/test-finance-recurring-store.mjs`, fails because `finance.recurringRules` is absent. The same failure was reproduced against the unchanged base commit and the candidate. The current finance-ledger release checks pass; this unrelated legacy failure was left unchanged.

## Review and activation limits

The implementation is ready for local review. Deployment, production migration and real account connection remain separate, explicitly approved actions.

Actual PostgreSQL migration/integration was not run against a live database. Existing organization IDs should be mapped and reviewed before applying the additive bootstrap. The new document store assumes one writer process; multiple server writers would require a transactional store.

See `changed-files.md` for every changed file, `business-workspaces.patch` for the complete local diff, `architecture-and-migration.md` for setup details, and `screenshots/report.json` for browser evidence. Screenshot customer/order names are synthetic test fixtures.
