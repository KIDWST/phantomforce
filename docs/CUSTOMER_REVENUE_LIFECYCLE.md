# Customer and Revenue Lifecycle

## Proposal authority

Proposal content is stored as immutable, SHA-256-bound versions. Editing content appends a version; changing workflow status does not rewrite history. Money is represented as integer minor units plus an ISO 4217-style currency code.

Acceptance requires the active version ID and its exact payload hash. Expired or changed payloads fail closed. A successful acceptance returns a persisted receipt with the tenant, proposal, version, actor, timestamp, currency, and total.

Accepted proposals can be converted once to an invoice-ready record. Conversion is owner/admin gated at the HTTP boundary and idempotent. It does not claim to send an invoice, charge a card, or contact a customer.

## Honest boundaries

- Proposal creation and editing are internal record operations.
- Acceptance records consent to the reviewed version; it does not collect payment.
- Conversion creates an invoice-ready internal state; external accounting and payment actions remain separate approved integrations.
- Tenant IDs come from the authenticated session boundary, not client-supplied record fields.

## CRM authority

CRM writes require an organization owner or administrator; client-role memberships remain view-only. Status/stage transitions are recorded in the organization hash-chained audit trail.

Duplicate contact merges are two-step. Preview returns the exact retained record, filled fields, and a hash over both current records. Apply fails if either record changed. The merge event stores protected before-snapshots, and rollback restores both records only while the merged target still matches the applied fingerprint. This prevents rollback from erasing newer work.

## Accounting authority

Accounting transactions are tenant-scoped server records. Every amount is stored once as a signed integer minor-unit value with an explicit currency. Manual records, file imports, and future provider syncs share one duplicate fingerprint boundary.

File imports require a deterministic idempotency key. Repeating the same batch returns its persisted receipt, while duplicate rows are skipped. Test-mode records remain visible to administrators but never enter actual cash totals. Voiding preserves the original record and audit entry instead of deleting financial history.

An empty ledger reports unknown totals as `null`; it never invents `$0`. Mixed-currency ledgers also withhold aggregate money totals until a conversion authority exists. Reconciliation state, actor, and time persist beside each transaction. HTTP writes are limited to the workspace owner or administrator; client roles remain read-only.

## Store order authority

Store orders use immutable line-item snapshots and integer minor-unit totals. Digital-only orders omit shipping fields and shipping charges. Test and live modes remain explicit; test orders never enter actual revenue.

Provider events can change payment or refund state only after a payment adapter has verified the provider signature. Event IDs are persisted and idempotent. Fulfillment is a separate owner-controlled transition, and partial/full refunds cannot exceed the verified payment amount.

This lifecycle is provider-neutral foundation, not a claim that merchant checkout is configured. Published sites continue to label checkout as test-only until a seller has a verified payment account, webhook signing secret, and activation approval.

## Verification

`npm run test:proposal-lifecycle` covers immutable history, minor-unit math, payload mismatch, expiration, receipt persistence, idempotent acceptance and conversion, Unicode data, and tenant isolation.

`npm run test:crm-lifecycle` covers merge previews, stale-preview detection, source/target preservation, international data, stage transitions, and tenant isolation.

`npm run test:finance-ledger` covers currency arithmetic, unknown-vs-zero behavior, duplicate imports, batch idempotency, test-data exclusion, reconciliation, reversible voiding, Unicode data, and tenant isolation.

`npm run test:commerce-order-lifecycle` covers immutable snapshots, minor-unit math, digital shipping omission, verified-event enforcement, webhook idempotency, test-revenue exclusion, fulfillment, refunds, and tenant isolation.
