/* Stripe billing contract checks. No network, database, or real credential is
   used: test keys exercise only configuration and Stripe's signed-payload
   verification helper. */

import assert from "node:assert/strict";

import Stripe from "stripe";

const ENV_KEYS = [
  "PHANTOMFORCE_STRIPE_BILLING_ENABLED",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_YEARLY",
  "STRIPE_PRICE_DEVELOPER_MONTHLY",
  "STRIPE_PRICE_DEVELOPER_YEARLY",
  "STRIPE_PRICE_ELITE_MONTHLY",
  "STRIPE_PRICE_ELITE_YEARLY",
  "STRIPE_PRICE_DEVELOPER_ELITE_MONTHLY",
  "STRIPE_PRICE_DEVELOPER_ELITE_YEARLY",
] as const;

const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
for (const key of ENV_KEYS) delete process.env[key];

try {
  const billing = await import("../src/access/stripe-billing.js");

  const disabled = billing.getStripeBillingStatus();
  assert.equal(disabled.checkoutEnabled, false, "Stripe Checkout must default to disabled");
  assert.equal(disabled.productionReady, false, "Stripe must not be production-ready without a signed webhook secret");
  assert.equal(billing.resolveStripePrice("professional", "month").ok, false, "Unconfigured prices must never be selectable");
  assert.equal(billing.resolveStripePrice("enterprise", "month").ok, false, "Only explicit checkout plans may be sold");

  process.env.PHANTOMFORCE_STRIPE_BILLING_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = "sk_test_51PhantomForceBillingContractOnly";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_phantomforce_billing_contract_only";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_monthly_contract";
  process.env.STRIPE_PRICE_PRO_YEARLY = "price_pro_yearly_contract";

  const ready = billing.getStripeBillingStatus();
  assert.equal(ready.checkoutEnabled, true, "A server-held test secret and allowed price enable Checkout");
  assert.equal(ready.liveWebhooksAllowed, true, "A whsec secret is required before live billing is declared ready");
  assert.equal(ready.productionReady, true, "Checkout plus signed webhooks is the readiness boundary");
  assert.deepEqual(billing.resolveStripePrice("professional", "year"), { ok: true, priceId: "price_pro_yearly_contract" });
  assert.deepEqual(billing.resolveStripePrice("elite", "month"), { ok: false, error: "stripe_price_not_configured" });
  assert.equal(ready.paymentMethods.mode, "stripe_dashboard_dynamic", "Payment-method eligibility must remain Stripe Dashboard-controlled");

  const payload = JSON.stringify({
    id: "evt_contract_checkout_completed",
    object: "event",
    api_version: "2025-06-30.basil",
    created: 1_773_884_800,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: "checkout.session.completed",
    data: { object: { id: "cs_contract", object: "checkout.session" } },
  });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const verified = billing.verifyStripeWebhook(Buffer.from(payload), signature);
  assert.equal(verified.id, "evt_contract_checkout_completed", "A correctly signed raw Stripe event must verify");
  assert.throws(() => billing.verifyStripeWebhook(Buffer.from(payload), "t=1,v1=not-a-signature"), /signature/i, "An invalid Stripe signature must be rejected");

  console.log("Stripe billing contract checks passed.");
} finally {
  for (const key of ENV_KEYS) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
