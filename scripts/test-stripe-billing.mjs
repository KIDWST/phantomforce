import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const server = read("server/src/index.ts");
const billing = read("server/src/access/stripe-billing.ts");
const settings = read("app/js/settings.js");
const schema = read("server/prisma/schema.prisma");
const migration = read("server/prisma/migrations/20260722094500_stripe_billing/migration.sql");

assert.match(server, /await app\.register\(fastifyRawBody,[\s\S]*encoding: false[\s\S]*runFirst: true/u,
  "Stripe webhook signatures require raw request bytes before parsing.");
assert.match(server, /app\.post\("\/billing\/stripe\/webhook", \{ config: \{ rawBody: true \} \}/u,
  "Stripe webhooks must use a dedicated raw-body endpoint.");
assert.match(server, /verifyStripeWebhook\(rawBody, signature\)/u,
  "Stripe webhook requests must verify the Stripe signature.");
assert.match(server, /error: "plan_change_requires_billing"/u,
  "Workspace owners must not self-assign a paid plan outside billing.");
assert.match(server, /app\.post\("\/orgs\/:orgId\/billing\/stripe\/checkout-session"/u,
  "Owners/admins need a scoped Checkout Session endpoint.");
assert.match(server, /app\.post\("\/orgs\/:orgId\/billing\/stripe\/portal"/u,
  "Existing subscriptions must use a secure Billing Portal endpoint.");

assert.match(billing, /mode: "subscription"/u, "Checkout must create Stripe subscriptions, not unaudited one-off payments.");
assert.match(billing, /allow_promotion_codes: true/u, "Checkout should support controlled Stripe promotion codes.");
assert.match(billing, /event\.type === "invoice\.paid"/u, "Verified paid invoices must drive entitlement activation.");
assert.match(billing, /recoverSubscriptionFromStripe/u, "Webhook delivery ordering must be recoverable.");
assert.match(billing, /constructEvent\(rawBody, signature, config\.webhookSecret\)/u, "Webhook validation must use Stripe's signed event construction.");
assert.doesNotMatch(billing, /payment_method_types\s*:/u, "Payment methods must stay dynamically eligible in Stripe Dashboard, not be hardcoded.");

assert.match(settings, /createStripeCheckout\(button\.dataset\.billingCheckout, billingInterval\)/u,
  "The Plan & access UI must redirect only to a server-created Checkout Session.");
assert.match(settings, /createStripeBillingPortal\(\)/u,
  "The Plan & access UI must support Stripe-hosted subscription management.");
assert.match(settings, /signed Stripe webhook verifies the payment/u,
  "The UI must not promise access before signed payment verification.");

assert.match(schema, /model BillingCustomer/u, "Provider customer references must be persistent and org-scoped.");
assert.match(schema, /model BillingSubscription/u, "Subscription state must be persistent and org-scoped.");
assert.match(schema, /model BillingWebhookEvent/u, "Webhook idempotency must be persistent.");
assert.match(migration, /CREATE TABLE "BillingWebhookEvent"/u, "The billing idempotency table must be migrated.");

console.log("Stripe billing source boundary checks passed.");
