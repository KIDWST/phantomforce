# PhantomStore AI Products — Paid Account Release

## Customer contract

The ten PhantomStore AI products are paid, one-time account licenses. A catalog
listing is visible before purchase, but every workspace mutation and read of
runnable product state is gated by a server-owned marketplace entitlement.
Opening a route directly does not bypass that gate.

Checkout is hosted by Stripe. PhantomForce selects a server-side Price ID,
redirects to Stripe Checkout, and grants ownership only after a signed Checkout
event reports `payment_status=paid`. Replayed events are idempotent. No card,
wallet, or payment credential is stored by PhantomForce.

The ownership record is scoped to the authenticated tenant and actor. It is
returned in the account library and is honored by the same web application used
inside the PhantomForce desktop shell.

## Portfolio

| Product | One-time display price | Primary cockpit | Example missions |
| --- | ---: | --- | --- |
| PHANTOM ORACLE | $39 | Scenario command table | Market entry, vendor selection, capital allocation |
| PHANTOM CHRONICLE | $29 | Evidence timeline desk | Incident review, claims chronology, documentary research |
| PHANTOM FOUNDRY | $49 | Benchmark fabrication line | Intent evals, regression suites, safety slices |
| PHANTOM TWIN | $49 | Operations twin floor | Service capacity, warehouse flow, support queues |
| PHANTOM DEALROOM | $39 | Negotiation strategy room | Enterprise renewal, suppliers, partnership terms |
| PHANTOM BLUEPRINT | $39 | System architecture compiler | SaaS MVPs, integrations, agency handoffs |
| PHANTOM TERRAIN | $39 | Geospatial decision map | Retail sites, field depots, event locations |
| PHANTOM PROOF | $29 | Evidence verification chamber | Executive claims, fact checks, policy research |
| PHANTOM LOOM | $39 | Dependency intelligence loom | Program plans, compliance impact, construction dependencies |
| PHANTOM CAUSAL | $39 | Experiment design laboratory | Conversion tests, operations pilots, feature rollouts |

Stripe remains the amount authority at payment time. The display prices above
must match the configured Stripe Prices before launch.

## Interface contract

Each product ships with custom key art, a three-playbook mission launchpad, a
product-specific command cockpit, a workflow pipeline, structured source input,
purpose consent, versioned artifacts, deterministic product analysis, inspectable
formula inputs, human disposition, history, and portable JSON export. The ten
domain calculators remain distinct and covered by their golden fixtures.

## Configuration

Set `PHANTOMFORCE_STRIPE_PRODUCT_CHECKOUT_ENABLED=true`, Stripe credentials,
the signed webhook secret, and the ten `STRIPE_PRICE_PRODUCT_AI_*` Price IDs in
the server environment. The shared Stripe webhook endpoint is:

```text
https://admin.phantomforce.online/billing/stripe/webhook
```

If a Price ID or verified webhook is unavailable, checkout fails closed and no
entitlement is created. Administrator entitlement grants remain an audited
support/recovery capability and are not presented as a customer checkout path.

## Verification

- `npm run test:phantomstore-ai-products`
- `npm run test:phantomstore`
- `npm run test:stripe-billing`
- `npm run build`
- desktop and mobile browser proof of locked catalog, owned library, and owned app launch
