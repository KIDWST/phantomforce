/* One-time PhantomStore product checkout. Stripe hosts every payment surface;
   PhantomForce receives only a signed Checkout event and stores the resulting
   account entitlement. Card and wallet credentials never enter this service. */

import Stripe from "stripe";

import type { AccessSession } from "../access/session.js";
import { ADMIN_PUBLIC_URL, CLIENT_PUBLIC_URL, publicHostFromHeaders, publicHostScope } from "../access/public-hosts.js";
import { fulfillPhantomStoreProductPurchase } from "../phantom-ai/phantomstore.js";

const PRODUCT_PRICE_ENV = Object.freeze({
  "product-ai-oracle": "STRIPE_PRICE_PRODUCT_AI_ORACLE",
  "product-ai-chronicle": "STRIPE_PRICE_PRODUCT_AI_CHRONICLE",
  "product-ai-foundry": "STRIPE_PRICE_PRODUCT_AI_FOUNDRY",
  "product-ai-twin": "STRIPE_PRICE_PRODUCT_AI_TWIN",
  "product-ai-dealroom": "STRIPE_PRICE_PRODUCT_AI_DEALROOM",
  "product-ai-blueprint": "STRIPE_PRICE_PRODUCT_AI_BLUEPRINT",
  "product-ai-terrain": "STRIPE_PRICE_PRODUCT_AI_TERRAIN",
  "product-ai-proof": "STRIPE_PRICE_PRODUCT_AI_PROOF",
  "product-ai-loom": "STRIPE_PRICE_PRODUCT_AI_LOOM",
  "product-ai-causal": "STRIPE_PRICE_PRODUCT_AI_CAUSAL",
});

const truthy = (value: string | undefined) => /^(1|true|yes|on)$/iu.test(String(value || "").trim());
const text = (value: string | undefined) => String(value || "").trim();
const cleanId = (value: unknown, max: number) => String(value || "").trim().replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, max);

function enabled() {
  return truthy(process.env.PHANTOMFORCE_STRIPE_PRODUCT_CHECKOUT_ENABLED)
    || truthy(process.env.PHANTOMFORCE_STRIPE_BILLING_ENABLED);
}

function priceId(productId: string) {
  const envName = PRODUCT_PRICE_ENV[productId as keyof typeof PRODUCT_PRICE_ENV];
  return envName ? text(process.env[envName]) : "";
}

export function hasConfiguredStripeProductPrices() {
  return Object.keys(PRODUCT_PRICE_ENV).some((productId) => priceId(productId).startsWith("price_"));
}

export function getStripeProductCheckoutStatus() {
  const secretKey = text(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = text(process.env.STRIPE_WEBHOOK_SECRET);
  const products = Object.entries(PRODUCT_PRICE_ENV).map(([productId, envName]) => ({
    productId,
    configured: priceId(productId).startsWith("price_"),
    configurationKey: envName,
  }));
  const checkoutReady = enabled() && secretKey.startsWith("sk_") && products.some((product) => product.configured);
  const webhookReady = checkoutReady && webhookSecret.startsWith("whsec_");
  return {
    provider: "stripe" as const,
    mode: "one_time_payment" as const,
    checkoutReady,
    webhookReady,
    productionReady: checkoutReady && webhookReady,
    products,
    ownership: "account" as const,
    reason: checkoutReady && webhookReady
      ? "Stripe Checkout and signed purchase fulfillment are ready."
      : "Configure Stripe credentials, the signed webhook, and a server-side Price ID for each product sold.",
  };
}

function stripeClient() {
  const status = getStripeProductCheckoutStatus();
  const secretKey = text(process.env.STRIPE_SECRET_KEY);
  if (!status.checkoutReady || !secretKey.startsWith("sk_")) {
    throw Object.assign(new Error("Secure product checkout is not configured."), { code: "stripe_product_checkout_not_configured" });
  }
  return new Stripe(secretKey);
}

function accountIdentity(session: AccessSession) {
  const tenantId = cleanId(session.orgId || session.clientId || session.id, 100);
  const actorId = cleanId(session.userId || session.id, 120);
  if (!tenantId || !actorId) throw Object.assign(new Error("A signed-in account is required."), { code: "account_identity_required" });
  return { tenantId, actorId };
}

function returnOrigin(headers: Record<string, unknown>) {
  const scope = publicHostScope(publicHostFromHeaders(headers));
  if (scope === "client") return CLIENT_PUBLIC_URL;
  if (scope === "admin") return ADMIN_PUBLIC_URL;
  const configured = text(process.env.PHANTOMFORCE_STRIPE_RETURN_ORIGIN).replace(/\/$/u, "");
  if (/^https:\/\/(admin|app)\.phantomforce\.online$/iu.test(configured) || /^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?$/iu.test(configured)) return configured;
  return ADMIN_PUBLIC_URL;
}

export async function createStripeProductCheckoutSession(input: {
  session: AccessSession;
  productId: string;
  headers: Record<string, unknown>;
}) {
  const productId = cleanId(input.productId, 180);
  if (!(productId in PRODUCT_PRICE_ENV)) throw Object.assign(new Error("That product is not available for secure checkout."), { code: "product_checkout_not_available" });
  const configuredPriceId = priceId(productId);
  if (!configuredPriceId.startsWith("price_")) throw Object.assign(new Error("Secure checkout is not configured for this product yet."), { code: "stripe_product_price_not_configured" });
  const { tenantId, actorId } = accountIdentity(input.session);
  const origin = returnOrigin(input.headers);
  const storeRoute = `${origin}/app/index.html?store_purchase=success&checkout_session_id={CHECKOUT_SESSION_ID}#page/phantomstore`;
  const cancelRoute = `${origin}/app/index.html?store_purchase=cancelled#page/phantomstore`;
  const checkout = await stripeClient().checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: configuredPriceId, quantity: 1 }],
    ...(input.session.email ? { customer_email: input.session.email } : {}),
    client_reference_id: tenantId,
    success_url: storeRoute,
    cancel_url: cancelRoute,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    invoice_creation: { enabled: true },
    metadata: {
      phantomforce_purchase_type: "phantomstore_product",
      phantomforce_product_id: productId,
      phantomforce_tenant_id: tenantId,
      phantomforce_actor_id: actorId,
    },
  });
  if (!checkout.url) throw Object.assign(new Error("Stripe did not return a secure Checkout URL."), { code: "stripe_checkout_url_missing" });
  return { checkoutUrl: checkout.url, sessionId: checkout.id, provider: "stripe" as const, fulfillment: "signed_webhook" as const };
}

export async function processVerifiedStripeProductCheckout(event: Stripe.Event) {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return null;
  const checkout = event.data.object as Stripe.Checkout.Session;
  if (String(checkout.metadata?.phantomforce_purchase_type || "") !== "phantomstore_product") return null;
  if (checkout.payment_status !== "paid") {
    return { ok: true as const, duplicate: false, outcome: "payment_pending", purchaseType: "phantomstore_product" };
  }
  const productId = cleanId(checkout.metadata?.phantomforce_product_id, 180);
  const tenantId = cleanId(checkout.metadata?.phantomforce_tenant_id, 100);
  const actorId = cleanId(checkout.metadata?.phantomforce_actor_id, 120);
  if (!(productId in PRODUCT_PRICE_ENV) || !tenantId || !actorId) {
    return { ok: true as const, duplicate: false, outcome: "ignored_invalid_product_metadata", purchaseType: "phantomstore_product" };
  }
  const result = await fulfillPhantomStoreProductPurchase({
    tenantId,
    actorId,
    productId,
    purchaseReference: `stripe-checkout:${cleanId(checkout.id, 150)}`,
  });
  return {
    ok: true as const,
    duplicate: result.idempotent,
    outcome: result.restored ? "entitlement_restored" : result.idempotent ? "entitlement_already_active" : "entitlement_granted",
    purchaseType: "phantomstore_product",
    productId,
  };
}
