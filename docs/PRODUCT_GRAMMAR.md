# PhantomForce Product Grammar

PhantomForce keeps existing module stores and API payloads, but presents one
shared operational language across the product.

## Canonical operation status

Browser and server contracts share these meanings:

- `draft`, `queued`, `executing`, `verifying`, `needs-approval`, `scheduled`
- `verified`, `live`, `published`, `paid`, `connected`
- `partial`, `failed`, `cancelled`, `rejected`, `expired`
- `unavailable`, `stale`, `test`, `unknown`

Legacy values are normalized at presentation boundaries. `live`, `published`,
`paid`, and `connected` remain `verifying` unless the caller supplies verified
evidence. Missing counts render as `—`; a real count of zero renders as `0`.

## Action receipts

`packages/contracts/src/product-grammar.ts` owns the shared receipt schema.
Every durable consequential action can identify actor, organization, workspace,
module, object, action, timestamp, previous and next state, linked execution
references, verification evidence, a human summary, and an optional recovery
route. Terminal success claims fail validation without verified evidence.

## Browser ownership

`app/js/product-grammar.js` provides:

- a latest-operation owner that aborts superseded requests;
- organization-scoped selection that clears when context changes;
- one route registry with aliases and safe fallback;
- accessible loading, empty, error, permission, and unavailable states.

These helpers do not persist competing state. Modules retain their authoritative
tenant-backed stores and use the helpers only at interaction boundaries.
