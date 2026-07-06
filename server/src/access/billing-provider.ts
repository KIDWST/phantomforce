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
