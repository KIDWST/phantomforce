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

## Verification

`npm run test:proposal-lifecycle` covers immutable history, minor-unit math, payload mismatch, expiration, receipt persistence, idempotent acceptance and conversion, Unicode data, and tenant isolation.

`npm run test:crm-lifecycle` covers merge previews, stale-preview detection, source/target preservation, international data, stage transitions, and tenant isolation.
