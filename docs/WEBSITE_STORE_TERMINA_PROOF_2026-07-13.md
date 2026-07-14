# PhantomForce Termina Store Proof

Date: 2026-07-13

## Scope

PhantomForce used its own Site Studio to keep a durable first-party store visible in the admin Websites area.

## Result

- Seeded `Termina - Terminal Workflow Manager Store` as the default PhantomForce store project.
- Migrated old `phantomforce.shop` proof-store records into Termina instead of keeping a generic dogfood store.
- Rendered Home, Workflow Manager, Templates, Pricing, Store, Checkout, and Support in order.
- Rendered Termina Workflow Manager ($49/month), Termina Pro Command Seat ($149/month), Terminal Setup Sprint ($750), and Workflow Automation Buildout ($1,500).
- Kept checkout in safe test mode with `paymentsConnected:false`.
- Updated Site Studio so store projects open directly into the Store panel unless the operator manually switches panels.

## Verification

The workspace site-builder test now asserts that Termina exists in the seeded admin Sites state with the exact title, store mode, checkout boundary, and products.

## Payment Boundary

This proof uses the complete test-checkout path only. It creates local store state without charging a card or calling an external payment provider. Live payment processing remains a separate adapter and credential step.
