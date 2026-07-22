import type { PaymentStatus } from "./client-access-state.js";
import { getStripeBillingStatus } from "./stripe-billing.js";

export type BillingProviderId = "manual-json-file" | "stripe";
export type BillingSourceOfTruth = "local-manual-provider" | "stripe-verified-webhooks";

export type BillingProviderStatus = {
  provider: BillingProviderId;
  providerLabel: string;
  sourceOfTruth: BillingSourceOfTruth;
  status: "local_demo_only" | "configuration_required" | "ready_for_live_activation";
  configured: boolean;
  readOnly: boolean;
  productionReady: boolean;
  liveWebhooksAllowed: boolean;
  supportedPaymentStatuses: PaymentStatus[];
  checkedAt: string;
  reason: string;
};

const manualProvider = "manual-json-file" satisfies BillingProviderId;
const manualSourceOfTruth = "local-manual-provider" satisfies BillingSourceOfTruth;
const supportedPaymentStatuses: PaymentStatus[] = ["paid", "due", "failed"];

export function getBillingProviderStatus(): BillingProviderStatus {
  const stripe = getStripeBillingStatus();
  if (stripe.configured || stripe.liveWebhooksAllowed || stripe.status === "ready_for_live_activation") {
    return {
      provider: "stripe",
      providerLabel: stripe.providerLabel,
      sourceOfTruth: stripe.liveWebhooksAllowed ? "stripe-verified-webhooks" : "local-manual-provider",
      status: stripe.status,
      configured: stripe.configured,
      readOnly: !stripe.checkoutEnabled,
      productionReady: stripe.productionReady,
      liveWebhooksAllowed: stripe.liveWebhooksAllowed,
      supportedPaymentStatuses: ["paid", "due", "failed"],
      checkedAt: stripe.checkedAt,
      reason: stripe.reason,
    };
  }
  return {
    provider: manualProvider,
    providerLabel: "Local manual JSON billing",
    sourceOfTruth: manualSourceOfTruth,
    status: "local_demo_only",
    configured: true,
    readOnly: true,
    productionReady: false,
    liveWebhooksAllowed: false,
    supportedPaymentStatuses,
    checkedAt: new Date().toISOString(),
    reason:
      "Billing is currently a local manual provider for demos. Production needs Stripe, invoice, CRM, or another authoritative payment source before access revocation can be live.",
  };
}

export function getProvisioningBillingMetadata(): {
  billingProvider: BillingProviderId;
  billingSourceOfTruth: BillingSourceOfTruth;
} {
  const status = getBillingProviderStatus();
  return {
    billingProvider: status.provider,
    billingSourceOfTruth: status.sourceOfTruth,
  };
}

/* ============================================================================
   Billing provider adapter boundary.
   The entitlement engine (entitlements.ts) is deliberately billing-agnostic.
   Stripe Checkout and its signed-event adapter live in stripe-billing.ts;
   this file exposes only provider-readiness metadata to the rest of the
   product. Manual super-admin entitlement assignment remains a separate,
   audited administrative capability. */

export type BillingEvent =
  | { type: "subscription_activated"; orgId: string; planKey: string; provider: string }
  | { type: "subscription_cancelled"; orgId: string; provider: string }
  | { type: "payment_failed"; orgId: string; provider: string };

export type BillingProviderAdapter = {
  id: string;
  label: string;
  /** true only when real credentials/webhook secrets are configured */
  configured: boolean;
  liveWebhooksAllowed: boolean;
  /** Verify + translate a provider webhook into a neutral BillingEvent.
      Absent on the manual adapter — manual assignment happens via
      POST /admin/orgs/:orgId/plan. */
  parseWebhook?: (headers: Record<string, unknown>, body: unknown) => BillingEvent | undefined;
};

const manualAdapter: BillingProviderAdapter = {
  id: "manual",
  label: "Manual super-admin assignment (no billing provider)",
  configured: true,
  liveWebhooksAllowed: false,
};

const stripeAdapter: BillingProviderAdapter = {
  id: "stripe",
  label: "Stripe Checkout + verified webhooks",
  get configured() {
    return getStripeBillingStatus().configured;
  },
  get liveWebhooksAllowed() {
    return getStripeBillingStatus().liveWebhooksAllowed;
  },
};

const adapters = new Map<string, BillingProviderAdapter>([
  [manualAdapter.id, manualAdapter],
  [stripeAdapter.id, stripeAdapter],
]);

export function listBillingAdapters() {
  return [...adapters.values()].map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    configured: adapter.configured,
    liveWebhooksAllowed: adapter.liveWebhooksAllowed,
  }));
}

export function getBillingAdapter(id: string) {
  return adapters.get(id);
}
