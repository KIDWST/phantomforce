import { createHash } from "node:crypto";

import { redactSensitiveText } from "./hermes-ledger.js";
import type {
  ProviderBudgetCaps,
  ProviderBudgetHardGateContract,
  ProviderBudgetHardGateInput,
  ProviderBudgetHardGateReason,
  ProviderPolicyEvaluationResult,
} from "./types.js";

function normalizeMoney(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined ? Math.max(0, value) : 0;
}

function normalizeTokens(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}

function normalizeCost(value: number | null) {
  return value === null || !Number.isFinite(value) ? null : Math.max(0, value);
}

function createGateId(input: ProviderBudgetHardGateInput, checkedAt: string) {
  const digest = createHash("sha256")
    .update(
      [
        input.tenant_id,
        input.provider_id,
        input.model_id,
        input.estimated_tokens,
        input.estimated_cost_usd ?? "unknown-cost",
        checkedAt,
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 24);

  return `budget-hard-gate-${digest}`;
}

function isOverBudget(options: {
  caps: ProviderBudgetCaps;
  estimatedTokens: number;
  estimatedCostUsd: number | null;
  currentDailySpendUsd: number;
  currentMonthlySpendUsd: number;
}) {
  if (options.estimatedTokens > options.caps.per_request_estimated_token_cap) return true;
  if (options.estimatedCostUsd !== null && options.estimatedCostUsd > options.caps.per_request_estimated_cost_cap_usd) {
    return true;
  }
  if (options.estimatedCostUsd !== null) {
    if (options.currentDailySpendUsd + options.estimatedCostUsd > options.caps.daily_budget_cap_usd) return true;
    if (options.currentMonthlySpendUsd + options.estimatedCostUsd > options.caps.monthly_budget_cap_usd) return true;
  }

  return false;
}

function getBlockedReasons(options: {
  budgetCaps: ProviderBudgetCaps | null;
  estimatedTokens: number;
  estimatedCostUsd: number | null;
  currentDailySpendUsd: number;
  currentMonthlySpendUsd: number;
  paymentStatus: ProviderBudgetHardGateInput["payment_status"];
  budgetApproved: boolean;
}): ProviderBudgetHardGateReason[] {
  const reasons: ProviderBudgetHardGateReason[] = [];

  if (!options.budgetCaps) {
    reasons.push("cap_missing");
  } else if (
    isOverBudget({
      caps: options.budgetCaps,
      estimatedTokens: options.estimatedTokens,
      estimatedCostUsd: options.estimatedCostUsd,
      currentDailySpendUsd: options.currentDailySpendUsd,
      currentMonthlySpendUsd: options.currentMonthlySpendUsd,
    })
  ) {
    reasons.push("budget_exceeded");
  }

  if (options.estimatedCostUsd === null) {
    reasons.push("cost_estimate_missing");
  }

  if (options.paymentStatus !== "paid") {
    reasons.push("payment_not_confirmed");
  }

  if (!options.budgetApproved) {
    reasons.push("budget_not_approved");
  }

  reasons.push("approval_execution_missing");

  return Array.from(new Set(reasons));
}

function detailForReason(reason: ProviderBudgetHardGateReason) {
  switch (reason) {
    case "cap_missing":
      return "A tenant/provider/model budget cap must exist before provider transport can run.";
    case "payment_not_confirmed":
      return "Payment or funding status is not confirmed. This gate does not collect payment.";
    case "budget_exceeded":
      return "Estimated usage would exceed at least one configured budget cap.";
    case "budget_not_approved":
      return "Budget approval is missing. Approval execution is not implemented in this patch.";
    case "cost_estimate_missing":
      return "A live provider route needs a concrete cost estimate before transport can run.";
    case "approval_execution_missing":
      return "Approval execution is not implemented, so this hard gate cannot pass.";
  }
}

export function evaluateProviderBudgetHardGate(
  input: ProviderBudgetHardGateInput,
): ProviderBudgetHardGateContract {
  const checkedAt = input.checked_at ?? new Date().toISOString();
  const gateId = createGateId(input, checkedAt);
  const estimatedTokens = normalizeTokens(input.estimated_tokens);
  const estimatedCostUsd = normalizeCost(input.estimated_cost_usd);
  const currentDailySpendUsd = normalizeMoney(input.current_daily_spend_usd);
  const currentMonthlySpendUsd = normalizeMoney(input.current_monthly_spend_usd);
  const blockedReasons = getBlockedReasons({
    budgetCaps: input.budget_caps,
    estimatedTokens,
    estimatedCostUsd,
    currentDailySpendUsd,
    currentMonthlySpendUsd,
    paymentStatus: input.payment_status,
    budgetApproved: input.budget_approved,
  });
  const requiredBeforeTransport = [
    "Create a tenant/provider/model hard budget cap.",
    "Confirm payment or funding outside this code path.",
    "Record explicit budget approval without enabling approval execution here.",
    "Enforce per-request, daily, and monthly limits before transport.",
    "Keep provider transport blocked until this hard gate reports pass in a separately reviewed patch.",
  ].map((item) => redactSensitiveText(item));

  return {
    gate_id: gateId,
    checked_at: checkedAt,
    status: "blocked",
    tenant_id: redactSensitiveText(input.tenant_id),
    business_name: redactSensitiveText(input.business_name),
    provider_id: redactSensitiveText(input.provider_id),
    model_id: redactSensitiveText(input.model_id),
    route_allowed: false,
    live_call_allowed: false,
    hard_gate_passed: false,
    estimated_tokens: estimatedTokens,
    estimated_cost_usd: estimatedCostUsd,
    current_daily_spend_usd: currentDailySpendUsd,
    current_monthly_spend_usd: currentMonthlySpendUsd,
    budget_caps: input.budget_caps,
    payment_status: input.payment_status,
    budget_approved: input.budget_approved,
    approval_status: input.approval_status,
    blocked_reasons: blockedReasons,
    blocked_reason_details: blockedReasons.map((reason) => redactSensitiveText(detailForReason(reason))),
    required_before_transport: requiredBeforeTransport,
    machine_check: {
      required_before_provider_transport: true,
      required_status_before_transport: "pass",
      current_status: "blocked",
      bypass_allowed: false,
      transport_must_reference_gate_id: gateId,
      failure_code: "provider_budget_hard_gate_blocked",
    },
    client_safe_summary: "Phantom AI can preview this safely, but live provider budget approval is not active.",
    admin_debug_summary: redactSensitiveText(
      `Budget hard gate ${gateId} blocked ${input.provider_id}/${input.model_id} for tenant ${input.tenant_id}.`,
    ),
    safety_flags: {
      admin_only: true,
      hard_gate: true,
      contract_only: true,
      route_allowed: false,
      live_call_allowed: false,
      provider_called: false,
      network_call_performed: false,
      payment_collected: false,
      payment_setup_started: false,
      billing_launched: false,
      approval_execution_implemented: false,
      raw_secret_exposed: false,
    },
  };
}

export function evaluateProviderBudgetHardGateFromPolicy(options: {
  tenant_id: string;
  business_name: string;
  provider_id: string;
  model_id: string;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  approval_status: ProviderBudgetHardGateInput["approval_status"];
  policy_result: ProviderPolicyEvaluationResult;
  checked_at?: string;
}) {
  return evaluateProviderBudgetHardGate({
    tenant_id: options.tenant_id,
    business_name: options.business_name,
    provider_id: options.provider_id,
    model_id: options.model_id,
    estimated_tokens: options.estimated_tokens,
    estimated_cost_usd: options.estimated_cost_usd,
    current_daily_spend_usd: 0,
    current_monthly_spend_usd: 0,
    budget_caps: options.policy_result.policy.budget_guard.caps,
    payment_status: "unknown",
    budget_approved: false,
    approval_status: options.approval_status,
    checked_at: options.checked_at,
  });
}
