# Stripe billing setup

PhantomForce uses hosted Stripe Checkout for subscriptions and the Stripe Customer Portal for billing management. The app never collects or stores card, Apple Pay, PayPal, Link, bank, or wallet credentials. The only authority for a paid entitlement is a successfully verified, signed Stripe webhook.

## What is implemented

- Organization-scoped Checkout Sessions for Pro, Developer, Elite, and Developer + Elite.
- Monthly and annual server-side Price allowlists. A browser cannot send an amount or arbitrary Stripe Price ID.
- Dynamic payment methods: enable Card, Apple Pay, and PayPal in Stripe Dashboard. Stripe Checkout decides which eligible methods appear for the customer’s device, account, region, currency, and transaction.
- Stripe Billing Portal entry for invoices, payment methods, cancellation, and plan changes configured in Stripe.
- HMAC-verified raw webhooks with durable idempotency records; no raw payment payload or payment credentials are stored locally.
- Entitlements activate only on `invoice.paid`; payment failure enters the plan grace path, and cancelled/unpaid/expired subscriptions suspend access.
- A late `invoice.paid` webhook can recover the provider subscription mapping, so event delivery order cannot silently lose a paid entitlement.

## Dashboard setup

1. In Stripe, create recurring Products and Prices for the plans and intervals you intend to sell. Copy only their `price_...` IDs into server environment variables—never into browser code.
2. In **Settings → Payment methods**, enable Card. Enable Apple Pay and PayPal only after confirming they are available for the Stripe account, business location, currency, and intended transactions. Keep Stripe’s dynamic payment methods enabled; PhantomForce deliberately does not hardcode a payment-method list.
3. Configure **Billing → Customer portal**. Allow the plans, cancellation behavior, payment-method updates, invoice history, and any plan-switch/proration rules you actually want customers to manage. A custom portal configuration ID is optional; the server uses Stripe’s Dashboard default when it is blank.
4. Configure tax registrations in Stripe before turning on `PHANTOMFORCE_STRIPE_AUTOMATIC_TAX` or tax-ID collection.
5. Register payment-method domains if Stripe asks for them, and before moving to an embedded payment UI. Hosted Checkout itself is Stripe-hosted; do not claim Apple Pay availability until its Stripe Dashboard/domain requirements are satisfied.

## Server configuration

Copy the commented Stripe block in `server/.env.example` into the actual server environment. Set:

- `PHANTOMFORCE_STRIPE_BILLING_ENABLED=true`
- `STRIPE_SECRET_KEY` (test key first, then a live key only at launch)
- `STRIPE_WEBHOOK_SECRET` for the exact receiving endpoint
- the `STRIPE_PRICE_*` values for the plans/intervals you sell

Set the public webhook endpoint in Stripe to:

```text
https://admin.phantomforce.online/billing/stripe/webhook
```

The reverse proxy must pass the untouched request body and `Stripe-Signature` header to the PhantomForce server. Subscribe that endpoint to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `invoice.finalization_failed`

Use a distinct webhook secret for test and live mode. Do not paste either key or a webhook signing secret into chat, source control, or a client-side environment variable.

## Validation before enabling live payments

1. Apply the Prisma migration `20260722094500_stripe_billing` to the production PostgreSQL database.
2. In Stripe test mode, complete Checkout with a Stripe test payment method. Confirm the app does not grant paid access on the success redirect alone.
3. Confirm the signed `invoice.paid` delivery returns HTTP 200, creates a `BillingWebhookEvent`, records a subscription, and updates the organization entitlement.
4. Re-send the same Stripe event from Dashboard. Confirm it is idempotent and does not duplicate the entitlement/audit change.
5. Test a failed payment, cancellation, and portal-return flow. Confirm the correct grace/suspension behavior for the selected plan.
6. Verify the configured Stripe Customer Portal shows only the plans, cancellation options, and invoices you intend to expose.
7. Run `npm run test:stripe-billing`, `npm run typecheck`, `npm run security:secrets`, and the release checks.

## Launch guardrails

- Do not turn on live mode until the Stripe webhook endpoint is reachable over HTTPS and its live `whsec_...` secret is set server-side.
- Keep Stripe test and live Prices separate. A test Price cannot be used with a live secret key.
- Start with the payment methods Stripe marks eligible. PayPal availability is account-, region-, currency-, and transaction-dependent; the app accurately labels it as eligible rather than guaranteed.
- Use Stripe Dashboard for refunds, disputes, tax configuration, and payment-method activation. PhantomForce receives only the minimum verified subscription state needed to enforce access.
