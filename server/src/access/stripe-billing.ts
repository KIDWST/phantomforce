/* Stripe Billing adapter — the only payment-provider integration point.
   Checkout is hosted by Stripe, so PhantomForce never handles card, Apple Pay,
   PayPal, or Link credentials. Provider IDs and signed-event hashes are the
   only payment references persisted locally. */

import { createHash } from "node:crypto";

import Stripe from "stripe";

import { assignOrgPlan, planDefinition } from "./entitlements.js";
import { prisma } from "./prisma-runtime.js";
import { ADMIN_PUBLIC_URL, CLIENT_PUBLIC_URL, publicHostFromHeaders, publicHostScope } from "./public-hosts.js";
import { recordOrgAuditEvent } from "./user-accounts.js";

export type StripeBillingInterval = "month" | "year";

type StripeBillingConfig = {
  enabled: boolean;
  secretKey: string;
  webhookSecret: string;
  portalConfigurationId: string;
  automaticTax: boolean;
  taxIdCollection: boolean;
  prices: Record<string, Partial<Record<StripeBillingInterval, string>>>;
};

const CHECKOUT_PLAN_KEYS = ["professional", "developer", "elite", "developer_elite"] as const;

const PRICE_ENV: Record<(typeof CHECKOUT_PLAN_KEYS)[number], Record<StripeBillingInterval, string>> = {
  professional: { month: "STRIPE_PRICE_PRO_MONTHLY", year: "STRIPE_PRICE_PRO_YEARLY" },
  developer: { month: "STRIPE_PRICE_DEVELOPER_MONTHLY", year: "STRIPE_PRICE_DEVELOPER_YEARLY" },
  elite: { month: "STRIPE_PRICE_ELITE_MONTHLY", year: "STRIPE_PRICE_ELITE_YEARLY" },
  developer_elite: { month: "STRIPE_PRICE_DEVELOPER_ELITE_MONTHLY", year: "STRIPE_PRICE_DEVELOPER_ELITE_YEARLY" },
};

function enabled(value: string | undefined) {
  return /^(1|true|yes|on)$/iu.test(String(value || "").trim());
}

function text(value: string | undefined) {
  return String(value || "").trim();
}

function stripeConfig(): StripeBillingConfig {
  const prices: StripeBillingConfig["prices"] = {};
  for (const planKey of CHECKOUT_PLAN_KEYS) {
    const monthly = text(process.env[PRICE_ENV[planKey].month]);
    const yearly = text(process.env[PRICE_ENV[planKey].year]);
    prices[planKey] = {
      ...(monthly ? { month: monthly } : {}),
      ...(yearly ? { year: yearly } : {}),
    };
  }
  return {
    enabled: enabled(process.env.PHANTOMFORCE_STRIPE_BILLING_ENABLED),
    secretKey: text(process.env.STRIPE_SECRET_KEY),
    webhookSecret: text(process.env.STRIPE_WEBHOOK_SECRET),
    portalConfigurationId: text(process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID),
    automaticTax: enabled(process.env.PHANTOMFORCE_STRIPE_AUTOMATIC_TAX),
    taxIdCollection: enabled(process.env.PHANTOMFORCE_STRIPE_TAX_ID_COLLECTION),
    prices,
  };
}

function configuredPricePlanKeys(config = stripeConfig()) {
  return CHECKOUT_PLAN_KEYS.filter((planKey) => Boolean(config.prices[planKey]?.month || config.prices[planKey]?.year));
}

function configuredForCheckout(config = stripeConfig()) {
  return config.enabled && config.secretKey.startsWith("sk_") && configuredPricePlanKeys(config).length > 0;
}

function configuredForWebhooks(config = stripeConfig()) {
  return configuredForCheckout(config) && config.webhookSecret.startsWith("whsec_");
}

function shortProviderId(value: string | null | undefined) {
  const normalized = String(value || "");
  return normalized.length > 10 ? `…${normalized.slice(-8)}` : normalized || "unknown";
}

function paymentMethodGuidance() {
  return {
    mode: "stripe_dashboard_dynamic" as const,
    supported: ["Card", "Apple Pay (eligible devices/browsers)", "PayPal (eligible Stripe account, region, currency, and transaction)"],
    detail:
      "Stripe Checkout chooses eligible payment methods dynamically. Enable Card, Apple Pay, and PayPal in the Stripe Dashboard; PhantomForce never collects payment credentials.",
  };
}

export function getStripeBillingStatus() {
  const config = stripeConfig();
  const pricePlans = CHECKOUT_PLAN_KEYS.map((planKey) => ({
    key: planKey,
    monthlyConfigured: Boolean(config.prices[planKey]?.month),
    yearlyConfigured: Boolean(config.prices[planKey]?.year),
  }));
  const checkoutReady = configuredForCheckout(config);
  const webhookReady = configuredForWebhooks(config);
  return {
    provider: "stripe" as const,
    providerLabel: "Stripe Checkout + Billing Portal",
    sourceOfTruth: checkoutReady && webhookReady ? "stripe-verified-webhooks" as const : "manual-until-stripe-verified" as const,
    status: checkoutReady && webhookReady ? "ready_for_live_activation" as const : "configuration_required" as const,
    configured: checkoutReady,
    checkoutEnabled: checkoutReady,
    liveWebhooksAllowed: webhookReady,
    productionReady: checkoutReady && webhookReady,
    // A configuration ID is optional: Stripe can use its Dashboard-managed
    // default customer portal configuration when this is blank.
    portalConfigurationIdConfigured: Boolean(config.portalConfigurationId),
    portalUsesDashboardDefault: !config.portalConfigurationId,
    automaticTax: config.automaticTax,
    taxIdCollection: config.taxIdCollection,
    pricePlans,
    paymentMethods: paymentMethodGuidance(),
    checkedAt: new Date().toISOString(),
    reason:
      checkoutReady && webhookReady
        ? "Stripe Checkout can create subscriptions. Verified Stripe webhooks are the only path that grants, changes, or revokes paid entitlements."
        : "Stripe code is installed but disabled until PHANTOMFORCE_STRIPE_BILLING_ENABLED, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and at least one Stripe Price ID are configured server-side.",
  };
}

export function listStripeCheckoutPlans() {
  const config = stripeConfig();
  return CHECKOUT_PLAN_KEYS.map((key) => {
    const plan = planDefinition(key);
    return {
      key,
      name: plan.name,
      description: plan.description,
      intervals: {
        month: Boolean(config.prices[key]?.month),
        year: Boolean(config.prices[key]?.year),
      },
    };
  });
}

export function resolveStripePrice(planKey: string, interval: StripeBillingInterval, config = stripeConfig()) {
  if (!CHECKOUT_PLAN_KEYS.includes(planKey as (typeof CHECKOUT_PLAN_KEYS)[number])) {
    return { ok: false as const, error: "plan_not_available_for_checkout" };
  }
  const priceId = config.prices[planKey]?.[interval];
  if (!priceId) return { ok: false as const, error: "stripe_price_not_configured" };
  return { ok: true as const, priceId };
}

function requireStripeClient(config = stripeConfig()) {
  if (!configuredForCheckout(config)) {
    throw Object.assign(new Error("Stripe Checkout is not configured."), { code: "stripe_not_configured" });
  }
  return new Stripe(config.secretKey);
}

function configuredReturnOrigin(headers: Record<string, unknown>) {
  const scope = publicHostScope(publicHostFromHeaders(headers));
  if (scope === "client") return CLIENT_PUBLIC_URL;
  if (scope === "admin") return ADMIN_PUBLIC_URL;

  const configured = text(process.env.PHANTOMFORCE_STRIPE_RETURN_ORIGIN).replace(/\/$/u, "");
  if (/^https:\/\/(admin|app)\.phantomforce\.online$/iu.test(configured) || /^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?$/iu.test(configured)) {
    return configured;
  }
  return ADMIN_PUBLIC_URL;
}

function returnUrls(headers: Record<string, unknown>) {
  const origin = configuredReturnOrigin(headers);
  const base = `${origin}/app/index.html`;
  return {
    successUrl: `${base}?billing=success&session_id={CHECKOUT_SESSION_ID}#/ws/settings`,
    cancelUrl: `${base}?billing=cancelled#/ws/settings`,
    portalReturnUrl: `${base}?billing=portal#/ws/settings`,
  };
}

function metadataOrgId(metadata: Stripe.Metadata | null | undefined) {
  const value = String(metadata?.phantomforce_org_id || "").trim();
  return value && value.length <= 120 ? value : null;
}

function metadataPlanKey(metadata: Stripe.Metadata | null | undefined) {
  const value = String(metadata?.phantomforce_plan_key || "").trim();
  return CHECKOUT_PLAN_KEYS.includes(value as (typeof CHECKOUT_PLAN_KEYS)[number]) ? value : null;
}

function asProviderId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return "";
}

function secondsToDate(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : null;
}

function planKeyForPriceId(priceId: string | null | undefined, config = stripeConfig()) {
  const normalized = String(priceId || "");
  for (const planKey of CHECKOUT_PLAN_KEYS) {
    if (Object.values(config.prices[planKey] || {}).includes(normalized)) return planKey;
  }
  return null;
}

function subscriptionPlanKey(subscription: Stripe.Subscription, config = stripeConfig()) {
  const metadataPlan = metadataPlanKey(subscription.metadata);
  if (metadataPlan) return metadataPlan;
  const priceId = subscription.items.data[0]?.price?.id;
  return planKeyForPriceId(priceId, config);
}

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const raw = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null;
  };
  const direct = raw.subscription;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object" && typeof direct.id === "string") return direct.id;
  const nested = raw.parent?.subscription_details?.subscription;
  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object" && typeof nested.id === "string") return nested.id;
  return "";
}

function invoicePlanKey(invoice: Stripe.Invoice, config = stripeConfig()) {
  const firstPrice = invoice.lines.data
    .map((line) => asProviderId(line.pricing?.price_details?.price))
    .find(Boolean);
  return planKeyForPriceId(firstPrice, config);
}

async function requireDb() {
  if (!prisma) throw Object.assign(new Error("Stripe Billing requires Prisma/Postgres."), { code: "billing_database_required" });
  return prisma;
}

async function customerForOrg(orgId: string) {
  const db = await requireDb();
  return db.billingCustomer.findUnique({ where: { orgId } });
}

async function activeSubscriptionForOrg(orgId: string) {
  const db = await requireDb();
  return db.billingSubscription.findFirst({
    where: { orgId, status: { in: ["checkout_completed", "trialing", "active", "past_due", "requires_action"] } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getStripeBillingSummary(orgId: string) {
  const db = await requireDb();
  const [customer, subscriptions, openSubscription] = await Promise.all([
    db.billingCustomer.findUnique({ where: { orgId } }),
    db.billingSubscription.findMany({
      where: { orgId },
      orderBy: { updatedAt: "desc" },
      take: 4,
      select: { planKey: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, updatedAt: true },
    }),
    db.billingSubscription.findFirst({
      where: { orgId, status: { in: ["checkout_completed", "trialing", "active", "past_due", "requires_action"] } },
      select: { id: true },
    }),
  ]);
  const status = getStripeBillingStatus();
  return {
    ...status,
    checkoutPlans: listStripeCheckoutPlans(),
    customerOnFile: Boolean(customer),
    hasOpenSubscription: Boolean(openSubscription),
    subscriptions: subscriptions.map((subscription) => ({
      ...subscription,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      updatedAt: subscription.updatedAt.toISOString(),
    })),
  };
}

export async function createStripeCheckoutSession(input: {
  orgId: string;
  actorUserId: string;
  actorEmail: string;
  planKey: string;
  interval: StripeBillingInterval;
  headers: Record<string, unknown>;
}) {
  const config = stripeConfig();
  const price = resolveStripePrice(input.planKey, input.interval, config);
  if (!price.ok) throw Object.assign(new Error(price.error), { code: price.error });
  const db = await requireDb();
  const [org, customer, existingSubscription] = await Promise.all([
    db.org.findUnique({ where: { id: input.orgId }, select: { id: true, name: true } }),
    customerForOrg(input.orgId),
    activeSubscriptionForOrg(input.orgId),
  ]);
  if (!org) throw Object.assign(new Error("Organization not found."), { code: "org_not_found" });
  if (existingSubscription) {
    throw Object.assign(new Error("Manage the existing subscription through the billing portal."), { code: "billing_portal_required" });
  }

  const stripe = requireStripeClient(config);
  const urls = returnUrls(input.headers);
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: price.priceId, quantity: 1 }],
    ...(customer ? { customer: customer.providerCustomerId } : { customer_email: input.actorEmail }),
    client_reference_id: input.orgId,
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: config.automaticTax ? "required" : "auto",
    automatic_tax: { enabled: config.automaticTax },
    tax_id_collection: { enabled: config.taxIdCollection },
    subscription_data: {
      metadata: {
        phantomforce_org_id: input.orgId,
        phantomforce_plan_key: input.planKey,
      },
    },
    metadata: {
      phantomforce_org_id: input.orgId,
      phantomforce_plan_key: input.planKey,
      phantomforce_interval: input.interval,
      phantomforce_actor_user_id: input.actorUserId,
    },
  });
  if (!checkout.url) throw Object.assign(new Error("Stripe did not return a Checkout URL."), { code: "stripe_checkout_url_missing" });

  await recordOrgAuditEvent({
    orgId: input.orgId,
    actor: input.actorEmail,
    eventType: "billing.checkout_started",
    targetType: "stripe_checkout",
    targetId: shortProviderId(checkout.id),
    payload: { planKey: input.planKey, interval: input.interval, provider: "stripe", paymentCredentialStored: false },
  });
  return { checkoutUrl: checkout.url, sessionId: checkout.id };
}

export async function createStripePortalSession(input: { orgId: string; headers: Record<string, unknown> }) {
  const config = stripeConfig();
  const customer = await customerForOrg(input.orgId);
  if (!customer) throw Object.assign(new Error("No Stripe customer exists for this workspace."), { code: "stripe_customer_not_found" });
  const stripe = requireStripeClient(config);
  const urls = returnUrls(input.headers);
  const portal = await stripe.billingPortal.sessions.create({
    customer: customer.providerCustomerId,
    return_url: urls.portalReturnUrl,
    ...(config.portalConfigurationId ? { configuration: config.portalConfigurationId } : {}),
  });
  return { portalUrl: portal.url };
}

export function verifyStripeWebhook(rawBody: Buffer, signature: string | undefined) {
  const config = stripeConfig();
  if (!configuredForWebhooks(config)) throw Object.assign(new Error("Stripe webhooks are not configured."), { code: "stripe_webhook_not_configured" });
  if (!signature) throw Object.assign(new Error("Stripe signature is missing."), { code: "stripe_signature_missing" });
  return new Stripe(config.secretKey).webhooks.constructEvent(rawBody, signature, config.webhookSecret);
}

async function resolveWebhookOrg(input: { orgId?: string | null; customerId?: string | null }) {
  const db = await requireDb();
  if (input.orgId) {
    const org = await db.org.findUnique({ where: { id: input.orgId }, select: { id: true } });
    if (org) return org.id;
  }
  if (input.customerId) {
    const customer = await db.billingCustomer.findUnique({ where: { providerCustomerId: input.customerId }, select: { orgId: true } });
    return customer?.orgId ?? null;
  }
  return null;
}

async function upsertBillingCustomer(orgId: string, providerCustomerId: string) {
  const db = await requireDb();
  return db.billingCustomer.upsert({
    where: { orgId },
    create: { orgId, provider: "stripe", providerCustomerId },
    update: { provider: "stripe", providerCustomerId },
  });
}

async function upsertBillingSubscription(input: {
  orgId: string;
  billingCustomerId: string;
  providerSubscriptionId: string;
  providerCheckoutSessionId?: string | null;
  planKey: string;
  status: string;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  eventCreatedAt?: Date | null;
}) {
  const db = await requireDb();
  const existing = await db.billingSubscription.findUnique({ where: { providerSubscriptionId: input.providerSubscriptionId } });
  if (existing?.lastEventCreatedAt && input.eventCreatedAt && existing.lastEventCreatedAt.getTime() > input.eventCreatedAt.getTime()) {
    return existing;
  }
  return db.billingSubscription.upsert({
    where: { providerSubscriptionId: input.providerSubscriptionId },
    create: {
      orgId: input.orgId,
      billingCustomerId: input.billingCustomerId,
      provider: "stripe",
      providerSubscriptionId: input.providerSubscriptionId,
      providerCheckoutSessionId: input.providerCheckoutSessionId || null,
      planKey: input.planKey,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      lastEventCreatedAt: input.eventCreatedAt ?? null,
    },
    update: {
      orgId: input.orgId,
      billingCustomerId: input.billingCustomerId,
      ...(input.providerCheckoutSessionId ? { providerCheckoutSessionId: input.providerCheckoutSessionId } : {}),
      planKey: input.planKey,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      lastEventCreatedAt: input.eventCreatedAt ?? null,
    },
  });
}

async function setBillingEntitlement(input: { orgId: string; planKey: string; status: "active" | "grace" | "suspended"; eventType: string; providerId: string }) {
  const plan = planDefinition(input.planKey);
  const now = Date.now();
  const graceUntil = input.status === "grace" ? new Date(now + plan.graceDays * 86400000).toISOString() : null;
  const assigned = await assignOrgPlan({
    orgId: input.orgId,
    planKey: input.planKey,
    status: input.status,
    graceUntil,
    overrides: undefined,
    note: `Stripe verified ${input.eventType} (${shortProviderId(input.providerId)}).`,
  });
  if (!assigned.ok) throw Object.assign(new Error(assigned.error), { code: assigned.error });
  await recordOrgAuditEvent({
    orgId: input.orgId,
    actor: "stripe:webhook",
    eventType: `billing.${input.eventType}`,
    targetType: "stripe_subscription",
    targetId: shortProviderId(input.providerId),
    payload: { planKey: input.planKey, entitlementStatus: input.status, provider: "stripe", paymentCredentialStored: false },
  });
}

async function markWebhookEvent(eventId: string, status: "processed" | "ignored" | "error", input?: { orgId?: string | null; errorCode?: string }) {
  const db = await requireDb();
  await db.billingWebhookEvent.update({
    where: { providerEventId: eventId },
    data: { status, orgId: input?.orgId ?? undefined, errorCode: input?.errorCode ?? null, processedAt: new Date() },
  });
}

async function beginWebhookEvent(event: Stripe.Event, rawBody: Buffer) {
  const db = await requireDb();
  const existing = await db.billingWebhookEvent.findUnique({ where: { providerEventId: event.id } });
  if (existing?.status === "processed" || existing?.status === "ignored") return { duplicate: true as const };
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  if (existing) {
    await db.billingWebhookEvent.update({ where: { providerEventId: event.id }, data: { status: "received", errorCode: null, payloadHash } });
    return { duplicate: false as const };
  }
  try {
    await db.billingWebhookEvent.create({ data: { provider: "stripe", providerEventId: event.id, type: event.type, payloadHash } });
    return { duplicate: false as const };
  } catch (error) {
    if (String(error).includes("Unique constraint")) return { duplicate: true as const };
    throw error;
  }
}

async function recoverSubscriptionFromStripe(subscriptionId: string) {
  // Stripe does not promise ordering across distinct event types. In
  // particular, an invoice.paid delivery can reach us before the corresponding
  // Checkout/session or subscription event. Retrieve only the provider
  // subscription reference in that narrow case, then establish the local map
  // before deciding the entitlement. A retrieval failure bubbles so Stripe
  // retries the signed event instead of silently losing a paid invoice.
  return requireStripeClient().subscriptions.retrieve(subscriptionId);
}

export async function processVerifiedStripeWebhook(event: Stripe.Event, rawBody: Buffer) {
  const received = await beginWebhookEvent(event, rawBody);
  if (received.duplicate) return { ok: true as const, duplicate: true, outcome: "already_processed" };

  try {
    const eventCreatedAt = secondsToDate(event.created);
    if (event.type === "checkout.session.completed") {
      const checkout = event.data.object as Stripe.Checkout.Session;
      const orgId = metadataOrgId(checkout.metadata) || String(checkout.client_reference_id || "").trim() || null;
      const planKey = metadataPlanKey(checkout.metadata);
      const customerId = asProviderId(checkout.customer);
      const subscriptionId = asProviderId(checkout.subscription as string | Stripe.Subscription | null | undefined);
      if (!orgId || !planKey || !customerId || !subscriptionId) {
        await markWebhookEvent(event.id, "ignored", { errorCode: "checkout_metadata_or_provider_reference_missing" });
        return { ok: true as const, duplicate: false, outcome: "ignored" };
      }
      const resolvedOrgId = await resolveWebhookOrg({ orgId, customerId });
      if (!resolvedOrgId) {
        await markWebhookEvent(event.id, "ignored", { errorCode: "organization_not_found" });
        return { ok: true as const, duplicate: false, outcome: "ignored" };
      }
      const customer = await upsertBillingCustomer(resolvedOrgId, customerId);
      await upsertBillingSubscription({
        orgId: resolvedOrgId,
        billingCustomerId: customer.id,
        providerSubscriptionId: subscriptionId,
        providerCheckoutSessionId: checkout.id,
        planKey,
        status: "checkout_completed",
        eventCreatedAt,
      });
      await recordOrgAuditEvent({
        orgId: resolvedOrgId,
        actor: "stripe:webhook",
        eventType: "billing.checkout_completed",
        targetType: "stripe_checkout",
        targetId: shortProviderId(checkout.id),
        payload: { planKey, provider: "stripe", paymentCredentialStored: false, entitlementChanged: false },
      });
      await markWebhookEvent(event.id, "processed", { orgId: resolvedOrgId });
      return { ok: true as const, duplicate: false, outcome: "checkout_recorded" };
    }

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = asProviderId(subscription.customer);
      const orgId = await resolveWebhookOrg({ orgId: metadataOrgId(subscription.metadata), customerId });
      const planKey = subscriptionPlanKey(subscription);
      if (!orgId || !customerId || !planKey) {
        await markWebhookEvent(event.id, "ignored", { errorCode: "subscription_mapping_missing" });
        return { ok: true as const, duplicate: false, outcome: "ignored" };
      }
      const customer = await upsertBillingCustomer(orgId, customerId);
      await upsertBillingSubscription({
        orgId,
        billingCustomerId: customer.id,
        providerSubscriptionId: subscription.id,
        planKey,
        status: subscription.status,
        currentPeriodEnd: secondsToDate((subscription as unknown as { current_period_end?: number }).current_period_end),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        eventCreatedAt,
      });
      if (["canceled", "unpaid", "incomplete_expired"].includes(subscription.status)) {
        await setBillingEntitlement({ orgId, planKey, status: "suspended", eventType: `subscription_${subscription.status}`, providerId: subscription.id });
      } else if (subscription.status === "past_due") {
        await setBillingEntitlement({ orgId, planKey, status: "grace", eventType: "subscription_past_due", providerId: subscription.id });
      }
      await markWebhookEvent(event.id, "processed", { orgId });
      return { ok: true as const, duplicate: false, outcome: "subscription_recorded" };
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required" || event.type === "invoice.finalization_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = asProviderId(invoice.customer);
      const subscriptionId = invoiceSubscriptionId(invoice);
      const db = await requireDb();
      const knownSubscription = subscriptionId ? await db.billingSubscription.findUnique({ where: { providerSubscriptionId: subscriptionId } }) : null;
      const recoveredSubscription = !knownSubscription && subscriptionId ? await recoverSubscriptionFromStripe(subscriptionId) : null;
      const providerCustomerId = customerId || asProviderId(recoveredSubscription?.customer);
      const orgId = await resolveWebhookOrg({
        orgId: knownSubscription?.orgId || metadataOrgId(recoveredSubscription?.metadata),
        customerId: providerCustomerId,
      });
      const planKey = knownSubscription?.planKey || (recoveredSubscription ? subscriptionPlanKey(recoveredSubscription) : null) || invoicePlanKey(invoice);
      if (!orgId || !planKey || !subscriptionId || !providerCustomerId) {
        await markWebhookEvent(event.id, "ignored", { errorCode: "invoice_mapping_missing" });
        return { ok: true as const, duplicate: false, outcome: "ignored" };
      }
      const existingCustomer = await customerForOrg(orgId);
      if (existingCustomer && existingCustomer.providerCustomerId !== providerCustomerId) {
        await markWebhookEvent(event.id, "ignored", { errorCode: "invoice_customer_mismatch" });
        return { ok: true as const, duplicate: false, outcome: "ignored" };
      }
      const customer = existingCustomer || await upsertBillingCustomer(orgId, providerCustomerId);
      const status = event.type === "invoice.paid" ? "active" : event.type === "invoice.payment_failed" ? "past_due" : event.type === "invoice.payment_action_required" ? "requires_action" : "finalization_failed";
      await upsertBillingSubscription({
        orgId,
        billingCustomerId: customer.id,
        providerSubscriptionId: subscriptionId,
        planKey,
        status,
        currentPeriodEnd: secondsToDate((recoveredSubscription as unknown as { current_period_end?: number } | null)?.current_period_end),
        cancelAtPeriodEnd: Boolean(recoveredSubscription?.cancel_at_period_end),
        eventCreatedAt,
      });
      if (event.type === "invoice.paid") {
        await setBillingEntitlement({ orgId, planKey, status: "active", eventType: "invoice_paid", providerId: subscriptionId });
      } else if (event.type === "invoice.payment_failed") {
        await setBillingEntitlement({ orgId, planKey, status: "grace", eventType: "invoice_payment_failed", providerId: subscriptionId });
      }
      await markWebhookEvent(event.id, "processed", { orgId });
      return { ok: true as const, duplicate: false, outcome: status };
    }

    await markWebhookEvent(event.id, "ignored", { errorCode: "event_not_required" });
    return { ok: true as const, duplicate: false, outcome: "ignored" };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code || "processing_failed") : "processing_failed";
    await markWebhookEvent(event.id, "error", { errorCode: code }).catch(() => undefined);
    throw error;
  }
}
