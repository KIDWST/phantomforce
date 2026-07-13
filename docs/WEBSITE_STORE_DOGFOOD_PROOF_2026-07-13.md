# PhantomForce Website + Store Dogfood Proof

Date: 2026-07-13

## Scope

PhantomForce used its own Site Studio to build a complete PhantomForce website and test store from one natural-language brief.

## Result

- Built `phantomforce.shop` with the requested premium black and neon-green direction.
- Rendered Home, Services, How it works, Pricing, Store, About, FAQ, Contact, Privacy, Refunds, and Checkout in the requested order.
- Rendered Starter Setup Sprint ($750), Core Setup Sprint ($1,500), Pro Setup Sprint ($2,500), and Operator Support ($775/month).
- Added Starter Setup Sprint to cart and completed safe test checkout for $750.
- Created test receipt `PF-TEST-MRJI25K1`; the UI confirmed that no payment was charged.
- Reloaded the app and confirmed the catalog, order, receipt, and store settings persisted.
- Added and removed a temporary product to prove product create/delete behavior.
- Phone preview rendered all 11 sections with `clientWidth` equal to `scrollWidth` (596px), proving no horizontal overflow in the active phone layout.

## Verification

The strict release suite passed:

```text
npm run test:page-worker
node --check app/js/*.js
npm run test:sites
npm run test:intent
npm run typecheck
npm run build
git diff --check
```

Coverage includes page-worker prompts, exact site section ordering, exact products and prices, billing cadence, cart and test-checkout rendering, hidden products, no-payment messaging, intent routing, server type checking, and the full workspace build.

## Payment Boundary

This proof uses the complete test-checkout path. It creates a durable local order and receipt without charging a card or calling an external provider. Live payment processing remains a separate adapter and credential step.
