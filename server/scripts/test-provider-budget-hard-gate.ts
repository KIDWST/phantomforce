import { readFileSync } from "node:fs";

import { evaluateProviderBudgetHardGate } from "../src/phantom-ai/provider-budget-hard-gate.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import type { ModelRouterRequest, ProviderBudgetCaps } from "../src/phantom-ai/types.js";

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

function baseGate(overrides = {}) {
  return evaluateProviderBudgetHardGate({
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
    ...overrides,
  });
}

const source = readFileSync(new URL("../src/phantom-ai/provider-budget-hard-gate.ts", import.meta.url), "utf8");
assert(!/\bfetch\s*\(/i.test(source), "Budget hard gate must not add fetch calls.");
assert(!/\bhttps?\.request\b/i.test(source), "Budget hard gate must not add HTTP request calls.");
assert(!/\bappendHermesLedgerRecord\b/i.test(source), "Budget hard gate must not append Hermes ledger records.");
assert(!/\bpersistApprovalQueuePreview\b/i.test(source), "Budget hard gate must not write approval queue records.");
assert(!/\bappendApprovalQueueTransition\b/i.test(source), "Budget hard gate must not write approval transitions.");

const capMissing = baseGate({ budget_caps: null });
assert(capMissing.status === "blocked", "Missing cap must be blocked.");
assert(capMissing.blocked_reasons.includes("cap_missing"), "Missing cap reason must be explicit.");
assert(capMissing.machine_check.required_before_provider_transport, "Hard gate must be required before transport.");
assert(capMissing.machine_check.required_status_before_transport === "pass", "Machine check must require pass.");
assert(capMissing.machine_check.current_status === "blocked", "Machine check current status must be blocked.");
assert(capMissing.machine_check.bypass_allowed === false, "Machine check must forbid bypass.");

const unpaid = baseGate({ payment_status: "unpaid" });
assert(unpaid.blocked_reasons.includes("payment_not_confirmed"), "Unpaid status must block.");

const exceeded = baseGate({
  estimated_tokens: 5000,
  estimated_cost_usd: 0.25,
  current_daily_spend_usd: 4.9,
  current_monthly_spend_usd: 19.9,
});
assert(exceeded.blocked_reasons.includes("budget_exceeded"), "Exceeded budget must block.");

const unapproved = baseGate({ budget_approved: false });
assert(unapproved.blocked_reasons.includes("budget_not_approved"), "Unapproved budget must block.");

const missingCost = baseGate({ estimated_cost_usd: null });
assert(missingCost.blocked_reasons.includes("cost_estimate_missing"), "Missing cost estimate must block.");

const nominalButExecutionMissing = baseGate();
assert(
  nominalButExecutionMissing.blocked_reasons.includes("approval_execution_missing"),
  "Approval execution missing must keep hard gate blocked.",
);

for (const gate of [capMissing, unpaid, exceeded, unapproved, missingCost, nominalButExecutionMissing]) {
  assert(gate.route_allowed === false, "Budget hard gate must not allow route execution.");
  assert(gate.live_call_allowed === false, "Budget hard gate must not allow live calls.");
  assert(gate.hard_gate_passed === false, "Budget hard gate must not pass in this patch.");
  assert(gate.safety_flags.provider_called === false, "Budget hard gate must not call providers.");
  assert(gate.safety_flags.network_call_performed === false, "Budget hard gate must not perform network calls.");
  assert(gate.safety_flags.payment_collected === false, "Budget hard gate must not collect payment.");
  assert(gate.safety_flags.billing_launched === false, "Budget hard gate must not launch billing.");
  assert(gate.safety_flags.approval_execution_implemented === false, "Budget hard gate must not implement approval execution.");
}

const fakeProviderKey = ["sk", "or", "v1", "budgethardgate0123456789"].join("-");
const fakeToken = ["budget", "token", "123456789"].join("-");
const fakeCard = ["4242", "4242", "4242", "4242"].join(" ");
const request: ModelRouterRequest = {
  tenant_id: "demo-trainer",
  business_name: "West Loop Strength Lab",
  actor_user_id: "demo-owner",
  actor_role: "platform_admin",
  request_id: "budget-hard-gate-router-proof",
  task_type: "content_idea_summary",
  sensitivity_level: "low",
  user_request: `Summarize safe content ideas. Bearer ${fakeToken} ${fakeCard}`,
  business_summary: "Owner-only personal training simulation. External actions are approval-only.",
  module_data: [],
};
const routedPreview = previewModelRouterFoundation(request, {
  env: {
    PHANTOM_MODEL_ROUTER_MODE: "openrouter",
    OPENROUTER_API_KEY: fakeProviderKey,
    PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
    PHANTOM_AI_BUDGET_ENFORCEMENT_MODE: "future_live_guard",
  },
});
const firewallGate = routedPreview.provider_invocation.budget_hard_gate;
const serializedPreview = JSON.stringify(routedPreview);

assert(firewallGate.status === "blocked", "Router firewall hard budget gate must block.");
assert(firewallGate.provider_id === "openrouter_glm", "Hard gate must preserve provider id for admin proof.");
assert(firewallGate.model_id === "z-ai/glm-5.2", "Hard gate must preserve model id for admin proof.");
assert(firewallGate.route_allowed === false, "Router hard gate must not allow route.");
assert(firewallGate.live_call_allowed === false, "Router hard gate must not allow live calls.");
assert(routedPreview.provider_invocation.live_call_allowed === false, "Provider firewall must still block live calls.");
assert(
  routedPreview.provider_invocation.openrouter_adapter?.live_call_allowed === false,
  "OpenRouter adapter must still be dry-run blocked.",
);
assert(
  routedPreview.provider_invocation.openrouter_adapter?.transport_contract.ready_for_send === false,
  "OpenRouter transport contract must still not be ready for send.",
);
assert(!serializedPreview.includes(fakeProviderKey), "Hard gate/router result must not expose raw provider key.");
assert(!serializedPreview.includes(fakeToken), "Hard gate/router result must not expose fake token.");
assert(!serializedPreview.includes(fakeCard), "Hard gate/router result must not expose fake card.");

console.log(
  JSON.stringify(
    {
      ok: true,
      capMissing: capMissing.blocked_reasons.includes("cap_missing"),
      unpaid: unpaid.blocked_reasons.includes("payment_not_confirmed"),
      exceeded: exceeded.blocked_reasons.includes("budget_exceeded"),
      unapproved: unapproved.blocked_reasons.includes("budget_not_approved"),
      missingCost: missingCost.blocked_reasons.includes("cost_estimate_missing"),
      nominalStillBlocked: nominalButExecutionMissing.status,
      firewallGateStatus: firewallGate.status,
      firewallGateProvider: firewallGate.provider_id,
      firewallGateModel: firewallGate.model_id,
      providerCalled: routedPreview.provider_invocation.dry_run_result.provider_called,
      networkCallPerformed: routedPreview.provider_invocation.dry_run_result.network_call_performed,
      openRouterReadyForSend: routedPreview.provider_invocation.openrouter_adapter?.transport_contract.ready_for_send,
      secretsLeaked:
        serializedPreview.includes(fakeProviderKey) ||
        serializedPreview.includes(fakeToken) ||
        serializedPreview.includes(fakeCard),
    },
    null,
    2,
  ),
);
