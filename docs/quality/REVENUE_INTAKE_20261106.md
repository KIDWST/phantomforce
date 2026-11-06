# Revenue intake and evidence — November 6, 2026

## Problem and behavior

Occasionally Odd's public storefront previously copied the bag and sent the buyer to Instagram, leaving PhantomForce without the request. The new exact public intake route validates a small contact form and the existing catalog references, fixes the tenant server-side, and persists a draft in the existing Occasionally Odd workroom. No customer payment, inventory reservation, commerce-order confirmation or external message occurs.

The route enforces exact storefront origins, strict fields, allowed product/option pairs, quantity/line limits, honeypot, timing, bounded IP rate limiting, payload size, no-store responses and retry idempotency under the existing record lock. Public responses contain only a receipt ID, not customer details. Owner edits survive retries. Store failures return a visible failure rather than a success receipt. Real customer inquiries use the normal private business records and existing membership checks.

Finance wording now distinguishes recorded cash inflow/outflow/net from verified customer revenue. Manual/import persistence and owner reconciliation do not prove payment. Existing records and amounts stay intact. No actual revenue is established by these changes.

New social OAuth authorizations default to the working app hostname. Explicit registered provider/global overrides and saved redirects for in-flight authorizations retain precedence. Separate likes remain unverified and must never be inferred from aggregate engagement.

## Validation

- Focused Odd route tests: allowed CORS, denied origins, invalid/unknown/duplicate item checks, forced business scope, no-store private receipt, draft visibility, retry/concurrency, owner-edit preservation, rate limit and corrupt-store failure.
- Storefront tests use isolated mock transport, not production fake inquiries.
- Social analytics and OAuth lifecycle suites verify default callback and override/state/role/tenant/replay behavior.
- Finance UI and store suites preserve tenant boundaries, audited voids, amount calculations, deduplication and historical read behavior.
- Full release gate and canonical live source checks required before rollout.

## Deployment

Deploy PhantomForce API/gateway first, verify public OPTIONS and invalid POST behavior, then rebuild only the existing Occasionally Odd web container. Preserve the running tunnel and all unrelated dirty storefront work. Verify public served asset hashes. Do not send fake production inquiries as a smoke test.

Rollback: revert the verified PhantomForce change and sync the canonical deployment. Storefront baseline copies and hashes are preserved outside its dirty checkout; restore only the three changed UI files and rebuild the web image if rollback is needed. Existing business records remain durable.
