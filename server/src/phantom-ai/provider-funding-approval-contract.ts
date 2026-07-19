import { createHash } from "node:crypto";

import { redactSensitiveText, redactPersonalDataText } from "./hermes-ledger.js";
import type {
  ProviderBudgetApprovalRecordContract,
  ProviderBudgetApprovalState,
  ProviderBudgetCaps,
  ProviderFundingApprovalBlockedReason,
  ProviderFundingApprovalContract,
  ProviderFundingApprovalContractInput,
  ProviderFundingApprovalState,
  ProviderFundingRecordContract,
} from "./types.js";

function normalizeTokens(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}

function normalizeCost(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(0, value);
}

function normalizeMoney(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined ? Math.max(0, value) : 0;
}

function createContractId(input: ProviderFundingApprovalContractInput, checkedAt: string) {
  const digest = createHash("sha256")
    .update(
      [
        input.tenant_id,
        input.provider_id,
        input.model_id,
        input.estimated_tokens,
        input.estimated_cost_usd ?? "unknown-cost",
        input.funding_record?.funding_id ?? "missing-funding",
        input.approval_record?.approval_id ?? "missing-approval",
        checkedAt,
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 24);

  return `provider-funding-approval-${digest}`;
}

function detailForReason(reason: ProviderFundingApprovalBlockedReason) {
  switch (reason) {
    case "funding_record_missing":
      return "A tenant/provider/model funding record must exist before provider transport can be considered.";
    case "funding_not_confirmed":
      return "Funding exists but is not explicitly marked funded. This contract does not collect payment.";
    case "budget_approval_missing":
      return "Explicit budget approval is missing or not approved.";
    case "cost_estimate_missing":
      return "A concrete estimated provider cost is required before funding preflight can pass.";
    case "estimated_cost_exceeds_cap":
      return "Estimated provider cost exceeds the effective approved/funded per-request cap.";
    case "daily_cap_exceeded":
      return "Estimated provider cost would exceed the configured daily cap.";
    case "monthly_cap_exceeded":
      return "Estimated provider cost would exceed the configured monthly cap.";
  }
}

function getFundingState(record: ProviderFundingRecordContract | null): ProviderFundingApprovalState {
  return record?.funding_state ?? "missing";
}

function getApprovalState(record: ProviderBudgetApprovalRecordContract | null): ProviderBudgetApprovalState {
  return record?.approval_state ?? "missing";
}

function minKnown(values: Array<number | null | undefined>) {
  const known = values.filter((value): value is number => Number.isFinite(value) && value !== null && value !== undefined);
  return known.length ? Math.min(...known.map((value) => Math.max(0, value))) : null;
}

function getEffectivePerRequestCap(options: {
  budgetCaps: ProviderBudgetCaps | null;
  fundingRecord: ProviderFundingRecordContract | null;
  approvalRecord: ProviderBudgetApprovalRecordContract | null;
}) {
  return minKnown([
    options.budgetCaps?.per_request_estimated_cost_cap_usd,
    options.fundingRecord?.funded_budget_cap_usd,
    options.approvalRecord?.approved_budget_cap_usd,
  ]);
}

function getBlockedReasons(options: {
  fundingState: ProviderFundingApprovalState;
  approvalState: ProviderBudgetApprovalState;
  estimatedCostUsd: number | null;
  effectivePerRequestCapUsd: number | null;
  budgetCaps: ProviderBudgetCaps | null;
  currentDailySpendUsd: number;
  currentMonthlySpendUsd: number;
}): ProviderFundingApprovalBlockedReason[] {
  const reasons: ProviderFundingApprovalBlockedReason[] = [];

  if (options.fundingState === "missing") {
    reasons.push("funding_record_missing");
  } else if (options.fundingState !== "funded") {
    reasons.push("funding_not_confirmed");
  }

  if (options.approvalState !== "approved") {
    reasons.push("budget_approval_missing");
  }

  if (options.estimatedCostUsd === null) {
    reasons.push("cost_estimate_missing");
  } else {
    if (options.effectivePerRequestCapUsd !== null && options.estimatedCostUsd > options.effectivePerRequestCapUsd) {
      reasons.push("estimated_cost_exceeds_cap");
    }

    if (
      options.budgetCaps &&
      options.currentDailySpendUsd + options.estimatedCostUsd > options.budgetCaps.daily_budget_cap_usd
    ) {
      reasons.push("daily_cap_exceeded");
    }

    if (
      options.budgetCaps &&
      options.currentMonthlySpendUsd + options.estimatedCostUsd > options.budgetCaps.monthly_budget_cap_usd
    ) {
      reasons.push("monthly_cap_exceeded");
    }
  }

  return Array.from(new Set(reasons));
}

function redactFundingRecord(record: ProviderFundingRecordContract | null): ProviderFundingRecordContract | null {
  if (!record) return null;

  return {
    ...record,
    funding_id: redactSensitiveText(record.funding_id),
    tenant_id: redactSensitiveText(record.tenant_id),
    provider_id: redactSensitiveText(record.provider_id),
    model_id: redactSensitiveText(record.model_id),
    funded_budget_cap_usd: normalizeCost(record.funded_budget_cap_usd),
    current_daily_spend_usd: normalizeMoney(record.current_daily_spend_usd),
    current_monthly_spend_usd: normalizeMoney(record.current_monthly_spend_usd),
    payment_collected: false,
  };
}

function redactApprovalRecord(
  record: ProviderBudgetApprovalRecordContract | null,
): ProviderBudgetApprovalRecordContract | null {
  if (!record) return null;

  return {
    ...record,
    approval_id: redactSensitiveText(record.approval_id),
    tenant_id: redactSensitiveText(record.tenant_id),
    provider_id: redactSensitiveText(record.provider_id),
    model_id: redactSensitiveText(record.model_id),
    approved_budget_cap_usd: normalizeCost(record.approved_budget_cap_usd),
    approved_by: record.approved_by ? redactSensitiveText(record.approved_by) : null,
    approved_at: record.approved_at ? redactSensitiveText(record.approved_at) : null,
    approval_execution_implemented: false,
  };
}

export function buildProviderFundingRecordContract(input: {
  tenant_id: string;
  provider_id: string;
  model_id: string;
  funding_state: ProviderFundingApprovalState;
  funded_budget_cap_usd: number | null;
  current_daily_spend_usd?: number;
  current_monthly_spend_usd?: number;
}): ProviderFundingRecordContract {
  const digest = createHash("sha256")
    .update([input.tenant_id, input.provider_id, input.model_id, input.funding_state].join(":"))
    .digest("hex")
    .slice(0, 16);

  return {
    funding_id: `funding-${digest}`,
    tenant_id: input.tenant_id,
    provider_id: input.provider_id,
    model_id: input.model_id,
    funding_state: input.funding_state,
    funded_budget_cap_usd: normalizeCost(input.funded_budget_cap_usd),
    current_daily_spend_usd: normalizeMoney(input.current_daily_spend_usd),
    current_monthly_spend_usd: normalizeMoney(input.current_monthly_spend_usd),
    source: input.funding_state === "missing" ? "missing" : "admin_contract_preview",
    local_dev_only: true,
    payment_collected: false,
  };
}

export function buildProviderBudgetApprovalRecordContract(input: {
  tenant_id: string;
  provider_id: string;
  model_id: string;
  approval_state: ProviderBudgetApprovalState;
  approved_budget_cap_usd: number | null;
  approved_by?: string | null;
  approved_at?: string | null;
}): ProviderBudgetApprovalRecordContract {
  const digest = createHash("sha256")
    .update([input.tenant_id, input.provider_id, input.model_id, input.approval_state].join(":"))
    .digest("hex")
    .slice(0, 16);

  return {
    approval_id: `budget-approval-${digest}`,
    tenant_id: input.tenant_id,
    provider_id: input.provider_id,
    model_id: input.model_id,
    approval_state: input.approval_state,
    approved_budget_cap_usd: normalizeCost(input.approved_budget_cap_usd),
    approved_by: input.approved_by ?? null,
    approved_at: input.approved_at ?? null,
    local_dev_only: true,
    approval_execution_implemented: false,
  };
}

export function evaluateProviderFundingApprovalContract(
  input: ProviderFundingApprovalContractInput,
): ProviderFundingApprovalContract {
  const checkedAt = input.checked_at ?? new Date().toISOString();
  const contractId = createContractId(input, checkedAt);
  const fundingState = getFundingState(input.funding_record);
  const approvalState = getApprovalState(input.approval_record);
  const estimatedTokens = normalizeTokens(input.estimated_tokens);
  const estimatedCostUsd = normalizeCost(input.estimated_cost_usd);
  const currentDailySpendUsd = normalizeMoney(input.funding_record?.current_daily_spend_usd);
  const currentMonthlySpendUsd = normalizeMoney(input.funding_record?.current_monthly_spend_usd);
  const effectivePerRequestCapUsd = getEffectivePerRequestCap({
    budgetCaps: input.budget_caps,
    fundingRecord: input.funding_record,
    approvalRecord: input.approval_record,
  });
  const blockedReasons = getBlockedReasons({
    fundingState,
    approvalState,
    estimatedCostUsd,
    effectivePerRequestCapUsd,
    budgetCaps: input.budget_caps,
    currentDailySpendUsd,
    currentMonthlySpendUsd,
  });
  const fundingPreflightAllowed = blockedReasons.length === 0;
  const status = fundingPreflightAllowed ? "preflight_allowed_transport_disabled" : "blocked";
  const requiredBeforeTransport = [
    "Provider transport must reference this funding approval contract id.",
    "Provider transport must still pass provider readiness, policy, budget hard gate, redaction, receipt, approval, and live-smoke gates.",
    "A separate reviewed transport implementation must keep request body preparation disabled until all live gates pass.",
    "OpenRouter payment or funding remains outside this code path and must never be collected here.",
    "Approval execution and queue execution remain unimplemented by this contract.",
  ].map((item) => redactPersonalDataText(item));

  return {
    contract_id: contractId,
    checked_at: checkedAt,
    status,
    tenant_id: redactSensitiveText(input.tenant_id),
    business_name: redactSensitiveText(input.business_name),
    provider_id: redactSensitiveText(input.provider_id),
    model_id: redactSensitiveText(input.model_id),
    estimated_tokens: estimatedTokens,
    estimated_cost_usd: estimatedCostUsd,
    funding_record_present: Boolean(input.funding_record),
    explicit_funded_budget_state: fundingState === "funded",
    explicit_budget_approval_state: approvalState === "approved",
    funding_state: fundingState,
    approval_state: approvalState,
    effective_per_request_cap_usd: effectivePerRequestCapUsd,
    current_daily_spend_usd: currentDailySpendUsd,
    current_monthly_spend_usd: currentMonthlySpendUsd,
    funding_preflight_allowed: fundingPreflightAllowed,
    provider_transport_allowed: false,
    live_call_allowed: false,
    execution_disabled: true,
    ready_for_send: false,
    blocked_reasons: blockedReasons,
    blocked_reason_details: blockedReasons.map((reason) => redactPersonalDataText(detailForReason(reason))),
    required_before_transport: requiredBeforeTransport,
    funding_record: redactFundingRecord(input.funding_record),
    approval_record: redactApprovalRecord(input.approval_record),
    machine_check: {
      required_before_provider_transport: true,
      required_contract_status_before_transport: "preflight_allowed_transport_disabled",
      current_status: status,
      transport_must_reference_contract_id: contractId,
      bypass_allowed: false,
      transport_still_disabled_after_preflight: true,
      failure_code: fundingPreflightAllowed
        ? "provider_transport_not_implemented"
        : "provider_funding_approval_blocked",
    },
    client_safe_summary: fundingPreflightAllowed
      ? "A future provider budget preflight is satisfied, but live AI transport is still disabled."
      : "A future provider budget preflight is blocked. No live AI transport can run.",
    admin_debug_summary: redactPersonalDataText(
      `Funding approval contract ${contractId} ${status} for ${input.provider_id}/${input.model_id} tenant ${input.tenant_id}.`,
    ),
    safety_flags: {
      admin_only: true,
      contract_only: true,
      funding_preflight_allowed: fundingPreflightAllowed,
      provider_transport_allowed: false,
      live_call_allowed: false,
      provider_called: false,
      network_call_performed: false,
      payment_collected: false,
      payment_setup_started: false,
      billing_launched: false,
      approval_execution_implemented: false,
      queue_execution_implemented: false,
      production_ledger_written: false,
      request_body_prepared: false,
      ready_for_send: false,
      raw_secret_exposed: false,
    },
  };
}
