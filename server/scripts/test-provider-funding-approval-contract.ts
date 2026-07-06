import { readFileSync } from "node:fs";

import {
  buildProviderBudgetApprovalRecordContract,
  buildProviderFundingRecordContract,
  evaluateProviderFundingApprovalContract,
} from "../src/phantom-ai/provider-funding-approval-contract.js";
import { evaluateProviderBudgetHardGate } from "../src/phantom-ai/provider-budget-hard-gate.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import type {
  ModelRouterRequest,
  ProviderBudgetApprovalState,
  ProviderBudgetCaps,
  ProviderFundingApprovalState,
} from "../src/phantom-ai/types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const caps: ProviderBudgetCaps = {
  monthly_budget_cap_usd: 20,
  daily_budget_cap_usd: 5,
  per_request_estimated_token_cap: 4000,
  per_request_estimated_cost_cap_usd: 0.1,
};

function fundingRecord(
  fundingState: ProviderFundingApprovalState,
  overrides: Partial<Parameters<typeof buildProviderFundingRecordContract>[0]> = {},
) {
  return buildProviderFundingRecordContract({
    tenant_id: "demo-trainer",
    provider_id: "openrouter_glm",
    model_id: "z-ai/glm-5.2",
    funding_state: fundingState,
    funded_budget_cap_usd: 0.1,
    current_daily_spend_usd: 0,
    current_monthly_spend_usd: 0,
    ...overrides,
  });
}

function approvalRecord(
  approvalState: ProviderBudgetApprovalState,
  overrides: Partial<Parameters<typeof buildProviderBudgetApprovalRecordContract>[0]> = {},
) {
  return buildProviderBudgetApprovalRecordContract({
    tenant_id: "demo-trainer",
    provider_id: "openrouter_glm",
    model_id: "z-ai/glm-5.2",
    approval_state: approvalState,
    approved_budget_cap_usd: 0.1,
    approved_by: "admin-contract-preview",
    approved_at: "2026-06-29T00:00:00.000Z",
    ...overrides,
  });
}

function contract(overrides = {}) {
  return evaluateProviderFundingApprovalContract({
    tenant_id: "demo-trainer",
    business_name: "West Loop Strength Lab",
    provider_id: "openrouter_glm",
    model_id: "z-ai/glm-5.2",
    estimated_tokens: 1200,
    estimated_cost_usd: 0.02,
    budget_caps: caps,
    funding_record: fundingRecord("funded"),
    approval_record: approvalRecord("approved"),
    checked_at: "2026-06-29T00:00:00.000Z",
    ...overrides,
  });
}

const source = readFileSync(
  new URL("../src/phantom-ai/provider-funding-approval-contract.ts", import.meta.url),
  "utf8",
);
assert(!/\bfetch\s*\(/i.test(source), "Funding approval contract must not add fetch calls.");
assert(!/\bhttps?\.request\b/i.test(source), "Funding approval contract must not add HTTP request calls.");
assert(!/\baxios\s*\(/i.test(source), "Funding approval contract must not add axios calls.");
assert(!/\bwriteFile\b|\bappendFile\b|\bmkdir\b/i.test(source), "Funding approval contract must not write files.");
assert(!/\bappendHermesLedgerRecord\b/i.test(source), "Funding approval contract must not append Hermes ledger records.");
assert(!/\bpersistApprovalQueuePreview\b/i.test(source), "Funding approval contract must not write approval queue records.");
assert(!/\bappendApprovalQueueTransition\b/i.test(source), "Funding approval contract must not write approval transitions.");

const noFunding = contract({ funding_record: null });
assert(noFunding.status === "blocked", "Missing funding record must block.");
assert(noFunding.blocked_reasons.includes("funding_record_missing"), "Missing funding reason must be explicit.");

const unpaid = contract({ funding_record: fundingRecord("unfunded") });
assert(unpaid.status === "blocked", "Unfunded record must block.");
assert(unpaid.blocked_reasons.includes("funding_not_confirmed"), "Unfunded reason must be explicit.");

const noApproval = contract({ approval_record: null });
assert(noApproval.status === "blocked", "Funded route without explicit approval must block.");
assert(noApproval.blocked_reasons.includes("budget_approval_missing"), "Approval missing reason must be explicit.");

const missingCost = contract({ estimated_cost_usd: null });
assert(missingCost.status === "blocked", "Missing estimated cost must block.");
assert(missingCost.blocked_reasons.includes("cost_estimate_missing"), "Missing cost reason must be explicit.");

const exceedsCap = contract({ estimated_cost_usd: 0.15 });
assert(exceedsCap.status === "blocked", "Estimated cost above cap must block.");
assert(exceedsCap.blocked_reasons.includes("estimated_cost_exceeds_cap"), "Cost cap reason must be explicit.");

const dailyExceeded = contract({
  funding_record: fundingRecord("funded", { current_daily_spend_usd: 4.99 }),
  estimated_cost_usd: 0.02,
});
assert(dailyExceeded.blocked_reasons.includes("daily_cap_exceeded"), "Daily cap reason must be explicit.");

const monthlyExceeded = contract({
  funding_record: fundingRecord("funded", { current_monthly_spend_usd: 19.99 }),
  estimated_cost_usd: 0.02,
});
assert(monthlyExceeded.blocked_reasons.includes("monthly_cap_exceeded"), "Monthly cap reason must be explicit.");

const allowedPreflight = contract();
assert(
  allowedPreflight.status === "preflight_allowed_transport_disabled",
  "Funded, approved, cost-known, within-cap state may pass preflight.",
);
assert(allowedPreflight.funding_preflight_allowed === true, "Allowed state must be preflight-only allowed.");
assert(allowedPreflight.provider_transport_allowed === false, "Allowed preflight must not allow transport.");
assert(allowedPreflight.live_call_allowed === false, "Allowed preflight must not allow live calls.");
assert(allowedPreflight.execution_disabled === true, "Allowed preflight must keep execution disabled.");
assert(allowedPreflight.ready_for_send === false, "Allowed preflight must not become sendable.");
assert(
  allowedPreflight.machine_check.current_status === "preflight_allowed_transport_disabled",
  "Machine check must expose preflight-only status.",
);
assert(
  allowedPreflight.machine_check.transport_still_disabled_after_preflight === true,
  "Machine check must explicitly keep transport disabled after preflight.",
);

const stillBlockedHardGate = evaluateProviderBudgetHardGate({
  tenant_id: "demo-trainer",
  business_name: "West Loop Strength Lab",
  provider_id: "openrouter_glm",
  model_id: "z-ai/glm-5.2",
  estimated_tokens: 1200,
  estimated_cost_usd: 0.02,
  current_daily_spend_usd: 0,
  current_monthly_spend_usd: 0,
  budget_caps: caps,
  payment_status: "paid",
  budget_approved: true,
  approval_status: "approved",
  checked_at: "2026-06-29T00:00:00.000Z",
});
assert(
  stillBlockedHardGate.funding_approval_contract.status === "preflight_allowed_transport_disabled",
  "Hard gate should include the preflight-allowed funding contract.",
);
assert(stillBlockedHardGate.status === "blocked", "Hard gate must still block provider transport.");
assert(stillBlockedHardGate.live_call_allowed === false, "Hard gate must still block live calls.");
assert(stillBlockedHardGate.hard_gate_passed === false, "Hard gate must not pass.");
assert(
  stillBlockedHardGate.blocked_reasons.includes("approval_execution_missing"),
  "Approval execution missing must still block transport.",
);

const fakeProviderKey = ["sk", "or", "v1", "fundingapproval0123456789"].join("-");
const fakeTokenValue = ["funding", "token", "123456789"].join("-");
const fakeCard = ["4242", "4242", "4242", "4242"].join(" ");
const providerKeyLabel = ["OPENROUTER", "API", "KEY"].join("_");
const secretContract = evaluateProviderFundingApprovalContract({
  tenant_id: `demo-trainer ${providerKeyLabel}=${fakeProviderKey}`,
  business_name: `West Loop Strength Lab TOKEN=${fakeTokenValue} ${fakeCard}`,
  provider_id: "openrouter_glm",
  model_id: "z-ai/glm-5.2",
  estimated_tokens: 1200,
  estimated_cost_usd: 0.02,
  budget_caps: caps,
  funding_record: fundingRecord("funded", {
    tenant_id: `tenant ${providerKeyLabel}=${fakeProviderKey}`,
  }),
  approval_record: approvalRecord("approved", {
    approved_by: `Bearer ${fakeTokenValue}`,
  }),
  checked_at: "2026-06-29T00:00:00.000Z",
});
const serializedSecretContract = JSON.stringify(secretContract);
assert(!serializedSecretContract.includes(fakeProviderKey), "Funding contract must not expose raw provider keys.");
assert(!serializedSecretContract.includes(fakeTokenValue), "Funding contract must not expose raw tokens.");
assert(!serializedSecretContract.includes(fakeCard), "Funding contract must not expose raw card values.");

const providerKeyEnvName = ["OPENROUTER", "API", "KEY"].join("_");
const request: ModelRouterRequest = {
  tenant_id: "demo-trainer",
  business_name: "West Loop Strength Lab",
  actor_user_id: "demo-owner",
  actor_role: "platform_admin",
  request_id: "funding-approval-router-proof",
  task_type: "content_idea_summary",
  sensitivity_level: "low",
  user_request: `Summarize safe content ideas. Bearer ${fakeTokenValue} ${fakeCard}`,
  business_summary: "Owner-only personal training simulation. External actions are approval-only.",
  module_data: [],
};
const routedPreview = previewModelRouterFoundation(request, {
  env: {
    PHANTOM_MODEL_ROUTER_MODE: "openrouter",
    [providerKeyEnvName]: fakeProviderKey,
    PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
    PHANTOM_AI_BUDGET_ENFORCEMENT_MODE: "future_live_guard",
  },
});
const serializedPreview = JSON.stringify(routedPreview);

assert(routedPreview.provider_invocation.live_call_allowed === false, "Firewall must still block live calls.");
assert(routedPreview.provider_invocation.execution_disabled === true, "Firewall must still disable execution.");
assert(
  routedPreview.provider_invocation.budget_hard_gate.funding_approval_contract.status === "blocked",
  "Router preview must not invent funded/approved state.",
);
assert(
  routedPreview.provider_invocation.openrouter_adapter?.transport_contract.ready_for_send === false,
  "OpenRouter transport must still not be ready for send.",
);
assert(!serializedPreview.includes(fakeProviderKey), "Router preview must not expose raw provider key.");
assert(!serializedPreview.includes(fakeTokenValue), "Router preview must not expose raw token.");
assert(!serializedPreview.includes(fakeCard), "Router preview must not expose raw card.");

for (const result of [
  noFunding,
  unpaid,
  noApproval,
  missingCost,
  exceedsCap,
  dailyExceeded,
  monthlyExceeded,
  allowedPreflight,
]) {
  assert(result.provider_transport_allowed === false, "Funding contract must never allow provider transport.");
  assert(result.live_call_allowed === false, "Funding contract must never allow live calls.");
  assert(result.safety_flags.provider_called === false, "Funding contract must not call providers.");
  assert(result.safety_flags.network_call_performed === false, "Funding contract must not call network.");
  assert(result.safety_flags.payment_collected === false, "Funding contract must not collect payment.");
  assert(result.safety_flags.billing_launched === false, "Funding contract must not launch billing.");
  assert(
    result.safety_flags.approval_execution_implemented === false,
    "Funding contract must not implement approval execution.",
  );
  assert(result.safety_flags.queue_execution_implemented === false, "Funding contract must not implement queue execution.");
  assert(result.safety_flags.request_body_prepared === false, "Funding contract must not prepare request bodies.");
  assert(result.safety_flags.ready_for_send === false, "Funding contract must not be ready for send.");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      noFunding: noFunding.blocked_reasons.includes("funding_record_missing"),
      unpaid: unpaid.blocked_reasons.includes("funding_not_confirmed"),
      noApproval: noApproval.blocked_reasons.includes("budget_approval_missing"),
      missingCost: missingCost.blocked_reasons.includes("cost_estimate_missing"),
      exceedsCap: exceedsCap.blocked_reasons.includes("estimated_cost_exceeds_cap"),
      dailyExceeded: dailyExceeded.blocked_reasons.includes("daily_cap_exceeded"),
      monthlyExceeded: monthlyExceeded.blocked_reasons.includes("monthly_cap_exceeded"),
      allowedPreflight: allowedPreflight.status,
      allowedPreflightTransportAllowed: allowedPreflight.provider_transport_allowed,
      hardGateStatus: stillBlockedHardGate.status,
      hardGateLiveCallAllowed: stillBlockedHardGate.live_call_allowed,
      routerLiveCallAllowed: routedPreview.provider_invocation.live_call_allowed,
      routerReadyForSend: routedPreview.provider_invocation.openrouter_adapter?.transport_contract.ready_for_send,
      secretsLeaked:
        serializedSecretContract.includes(fakeProviderKey) ||
        serializedSecretContract.includes(fakeTokenValue) ||
        serializedSecretContract.includes(fakeCard) ||
        serializedPreview.includes(fakeProviderKey) ||
        serializedPreview.includes(fakeTokenValue) ||
        serializedPreview.includes(fakeCard),
    },
    null,
    2,
  ),
);
