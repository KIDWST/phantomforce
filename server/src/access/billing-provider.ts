import type { PaymentStatus } from "./client-access-state.js";

export type BillingProviderId = "manual-json-file";
export type BillingSourceOfTruth = "local-manual-provider";

export type BillingProviderStatus = {
  provider: BillingProviderId;
  providerLabel: string;
  sourceOfTruth: BillingSourceOfTruth;
  status: "local_demo_only";
  configured: boolean;
  readOnly: true;
  productionReady: boolean;
  liveWebhooksAllowed: boolean;
  supportedPaymentStatuses: PaymentStatus[];
  checkedAt: string;
  reason: string;
};

const provider = "manual-json-file" satisfies BillingProviderId;
const sourceOfTruth = "local-manual-provider" satisfies BillingSourceOfTruth;
const supportedPaymentStatuses: PaymentStatus[] = ["paid", "due", "failed"];

export function getBillingProviderStatus(): BillingProviderStatus {
  return {
    provider,
    providerLabel: "Local manual JSON billing",
    sourceOfTruth,
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
  return {
    billingProvider: provider,
    billingSourceOfTruth: sourceOfTruth,
  };
}

/* ============================================================================
   Billing provider adapter boundary.
   The entitlement engine (entitlements.ts) is deliberately billing-agnostic:
   plans are assigned by the super-admin (or, later, by a billing adapter
   translating provider webhooks into these neutral events). Integrating
   Stripe/another provider means adding ONE adapter here — the product's
   permission logic never changes. No adapter is integrated today, no
   checkout exists, and nothing below pretends a payment happened. */

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

const adapters = new Map<string, BillingProviderAdapter>([[manualAdapter.id, manualAdapter]]);

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
